import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import settings
from app.models.schemas import (
    FileUploadResponse, DocumentMeta, QueryRequest, QueryResponse, HealthResponse
)
from app.services import db
from app.services import parser
from app.services import vector_store
from app.services import rag_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("rag_engine.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Enterprise RAG Engine FastAPI service...")
    try:
        await db.init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.warning(f"Database initialization deferred or failed: {e}")
        
    # Pre-warm FastEmbed model
    try:
        vector_store.get_embedding_model()
        logger.info("FastEmbed model loaded successfully.")
    except Exception as e:
        logger.warning(f"FastEmbed model pre-warming warning: {e}")
        
    yield
    
    logger.info("Shutting down RAG Engine service...")
    await db.close_pool()

app = FastAPI(
    title="Enterprise RAG Document Engine API",
    description="FastAPI Backend for RAG Document Ingestion, Embedding, Vector Search, and Groq Synthesis",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS — restricted to settings.CORS_ORIGINS (defaults to local dev
# origins only). Set CORS_ORIGINS in production to your real frontend domain;
# allow_origins=["*"] combined with allow_credentials=True would let any site
# make credentialed requests to this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", response_model=HealthResponse)
async def health_check():
    db_status = await db.check_db_health()
    return HealthResponse(
        status="healthy" if "connected" in db_status else "degraded",
        database=db_status,
        embedding_model=settings.EMBEDDING_MODEL
    )

@app.post("/api/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")
        
    content_bytes = await file.read()
    file_size = len(content_bytes)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file cannot be empty.")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if file_size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File is {file_size / (1024 * 1024):.1f}MB, which exceeds the "
                f"{settings.MAX_UPLOAD_MB}MB upload limit. Split large documents "
                f"into smaller files (e.g. one book instead of a full series) and "
                f"upload them separately."
            ),
        )

    try:
        # 1. Save Document record
        doc_id = await db.create_document(
            filename=file.filename,
            content_type=file.content_type or "application/octet-stream",
            file_size=file_size
        )
        
        # 2. Parse text page-by-page (CPU-bound — run off the event loop so a
        # large file doesn't freeze every other request, including health checks)
        parse_start = time.monotonic()
        pages = await asyncio.to_thread(
            parser.parse_document,
            file_bytes=content_bytes,
            filename=file.filename,
            content_type=file.content_type or ""
        )
        parse_seconds = time.monotonic() - parse_start

        if not pages:
            raise HTTPException(status_code=400, detail="Could not extract text content from document.")

        # 3. Chunk text using sliding window
        chunks = parser.chunk_text_sliding_window(pages)

        if not chunks:
            raise HTTPException(status_code=400, detail="Document contained no parseable text chunks.")

        logger.info(
            f"Parsed '{file.filename}': {len(pages)} pages -> {len(chunks)} chunks "
            f"in {parse_seconds:.1f}s"
        )
        embed_start = time.monotonic()

        # 4-5. Generate embeddings and insert in bounded batches instead of all
        # at once. Holding every embedding for a whole document in memory before
        # writing anything makes peak memory scale with document size — this is
        # what pushed a 3.5GB container toward its limit on a single 1MB PDF.
        # Batching keeps peak memory flat regardless of file size, and updates
        # chunk_count as it goes so progress is visible in the UI in real time
        # instead of jumping from 0 straight to done.
        batch_size = settings.EMBED_BATCH_SIZE
        inserted = 0
        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start:batch_start + batch_size]
            contents = [c["content"] for c in batch]
            embeddings = await asyncio.to_thread(vector_store.embed_texts, contents)

            chunks_data = [
                {
                    "chunk_index": c["chunk_index"],
                    "content": c["content"],
                    "embedding": emb,
                    "metadata": c["metadata"],
                }
                for c, emb in zip(batch, embeddings)
            ]
            await db.insert_chunks(doc_id, chunks_data)

            inserted += len(batch)
            await db.update_document_chunk_count(doc_id, inserted)
            logger.info(
                f"Progress: {inserted}/{len(chunks)} chunks embedded+inserted "
                f"for '{file.filename}' ({time.monotonic() - embed_start:.1f}s elapsed)"
            )
        
        doc_meta = DocumentMeta(
            id=doc_id,
            filename=file.filename,
            content_type=file.content_type or "application/octet-stream",
            file_size=file_size,
            chunk_count=len(chunks),
            created_at=datetime.now(timezone.utc)
        )
        
        return FileUploadResponse(
            message=f"Document '{file.filename}' processed and indexed successfully into {len(chunks)} chunks.",
            document=doc_meta
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ingesting document {file.filename}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing document: {str(e)}"
        )

@app.get("/api/documents", response_model=list[DocumentMeta])
async def get_documents():
    docs = await db.list_documents()
    return [
        DocumentMeta(
            id=d["id"],
            filename=d["filename"],
            content_type=d["content_type"],
            file_size=d["file_size"],
            chunk_count=d["chunk_count"],
            created_at=d["created_at"]
        )
        for d in docs
    ]

@app.delete("/api/documents/{doc_id}", status_code=status.HTTP_200_OK)
async def delete_document(doc_id: str):
    success = await db.delete_document(doc_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"message": f"Document {doc_id} deleted successfully."}

@app.post("/api/query", response_model=QueryResponse)
async def query_documents(req: QueryRequest):
    result = await rag_engine.execute_rag_query(
        query=req.query,
        top_k=req.top_k or settings.TOP_K,
        similarity_threshold=req.similarity_threshold or settings.SIMILARITY_THRESHOLD,
        document_ids=req.document_ids
    )
    return QueryResponse(**result)

@app.post("/api/query/stream")
async def stream_query_documents(req: QueryRequest):
    generator = rag_engine.stream_rag_query(
        query=req.query,
        top_k=req.top_k or settings.TOP_K,
        similarity_threshold=req.similarity_threshold or settings.SIMILARITY_THRESHOLD,
        document_ids=req.document_ids
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
