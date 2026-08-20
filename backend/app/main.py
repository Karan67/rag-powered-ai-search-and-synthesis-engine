import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import settings
from app.models.schemas import (
    DocumentMeta, QueryRequest, QueryResponse, HealthResponse,
    IngestJob, UploadAcceptedResponse
)
from app.services import db
from app.services import ingest
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
        
    # Warm the embedding backend so the first upload does not pay model load
    # time, and a misconfigured backend fails on boot rather than mid-ingest.
    try:
        vector_store.get_embedding_model()
        logger.info("Embedding backend ready.")
    except Exception as e:
        logger.warning(f"Embedding backend warm-up warning: {e}")

    # Anything still marked running belongs to a process that no longer exists;
    # its queue died with it, so it can never resume.
    try:
        await db.fail_interrupted_jobs()
    except Exception as e:
        logger.warning(f"Could not reconcile interrupted jobs: {e}")

    await ingest.start_worker()

    yield

    logger.info("Shutting down RAG Engine service...")
    await ingest.stop_worker()
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

@app.post(
    "/api/upload",
    response_model=UploadAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(file: UploadFile = File(...)):
    """
    Accept a document and queue it for ingestion.

    Returns 202 with a job id rather than waiting for the work. Embedding a
    book-sized PDF takes minutes, and a request held open that long is lost to
    any dropped connection or proxy timeout, with no way to resume it. Poll
    /api/jobs/{job_id} for progress.
    """
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

    job_id = await db.create_job(filename=file.filename, file_size=file_size)

    accepted = await ingest.enqueue(
        ingest.IngestTask(
            job_id=job_id,
            filename=file.filename,
            content_type=file.content_type or "application/octet-stream",
            file_bytes=content_bytes,
        )
    )
    if not accepted:
        # Queued files sit in memory, so the depth is capped. Refusing clearly
        # beats accepting the work and then being killed for it.
        await db.update_job(
            job_id,
            status="failed",
            error="Server is busy ingesting other documents. Please try again shortly.",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Server is busy ingesting other documents. "
                "Please try again in a few minutes."
            ),
        )

    job = await db.get_job(job_id)
    return UploadAcceptedResponse(
        message=f"'{file.filename}' queued for indexing.",
        job=IngestJob(**job),
    )


@app.get("/api/jobs/{job_id}", response_model=IngestJob)
async def get_ingest_job(job_id: str):
    """Progress of a single ingest job."""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such ingest job.")
    return IngestJob(**job)


@app.get("/api/jobs", response_model=list[IngestJob])
async def list_ingest_jobs():
    """Jobs still queued or running, so a reloaded page can pick them back up."""
    return [IngestJob(**j) for j in await db.list_active_jobs()]


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
