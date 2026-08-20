import json
import logging
from datetime import datetime, timezone
from typing import Optional, Any

import asyncpg
from app.config import settings

logger = logging.getLogger("rag_engine.db")

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """
    Return (or lazily create) the global asyncpg connection pool.
    Pool configuration: min 2, max 10 connections, 30s command timeout.
    """
    global _pool
    if _pool is None:
        db_host = settings.DATABASE_URL.split("@")[-1]
        logger.info(f"Initializing database connection pool → {db_host}")
        _pool = await asyncpg.create_pool(
            dsn=settings.DATABASE_URL,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("Database connection pool initialized.")
    return _pool


async def close_pool() -> None:
    """Gracefully close the connection pool on application shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Database connection pool closed.")


async def init_db() -> None:
    """
    Bootstrap the database schema if it does not already exist.
    - Installs pgvector & uuid-ossp extensions.
    - Creates `documents` and `document_chunks` tables.
    - Creates HNSW cosine similarity index on the embedding column.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Enable required extensions
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        await conn.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

        # Documents master table
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                filename VARCHAR(255) NOT NULL,
                content_type VARCHAR(100) NOT NULL,
                file_size INTEGER NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        # Document chunks table with pgvector column
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS document_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding vector({settings.EMBEDDING_DIM}) NOT NULL,
                metadata JSONB DEFAULT '{{}}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        # Ingest jobs. Ingestion runs in the background rather than inside the
        # upload request, so the client needs somewhere to read progress from.
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
                filename VARCHAR(255) NOT NULL,
                file_size INTEGER NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'queued',
                chunks_total INTEGER NOT NULL DEFAULT 0,
                chunks_done INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ingest_jobs_active
            ON ingest_jobs(created_at DESC)
            WHERE status IN ('queued', 'parsing', 'embedding');
            """
        )

        # Index for fast document-scoped chunk lookups
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id
            ON document_chunks(document_id);
            """
        )

        # HNSW index for approximate nearest-neighbour cosine similarity search
        try:
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
                ON document_chunks USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
                """
            )
            logger.info("HNSW vector index confirmed/created.")
        except Exception as e:
            logger.warning(
                f"HNSW index creation warning (may already exist or pgvector version "
                f"doesn't support hnsw — IVFFlat fallback recommended): {e}"
            )

    logger.info("Database schema initialization complete.")


async def create_document(filename: str, content_type: str, file_size: int) -> str:
    """
    Insert a new document record and return its UUID as a string.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO documents (filename, content_type, file_size)
            VALUES ($1, $2, $3)
            RETURNING id::text;
            """,
            filename,
            content_type,
            file_size,
        )
        doc_id: str = row["id"]
        logger.info(f"Created document record: id={doc_id}, filename={filename!r}")
        return doc_id


async def update_document_chunk_count(doc_id: str, count: int) -> None:
    """Update the chunk_count field for a document after ingestion."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE documents SET chunk_count = $1 WHERE id = $2::uuid;",
            count,
            doc_id,
        )


async def insert_chunks(doc_id: str, chunks_data: list[dict[str, Any]]) -> None:
    """
    Bulk-insert document chunks with their vector embeddings into `document_chunks`.

    The embedding is serialised to pgvector's text representation: '[f1,f2,...,f384]'.
    asyncpg's executemany is used for efficiency.

    Args:
        doc_id: UUID string of the parent document.
        chunks_data: List of dicts with keys: chunk_index, content, embedding (list[float]), metadata (dict).
    """
    if not chunks_data:
        logger.warning(f"insert_chunks called with empty chunks list for doc_id={doc_id}.")
        return

    pool = await get_pool()
    async with pool.acquire() as conn:
        records = []
        for chunk in chunks_data:
            # Serialize the float list to pgvector text format: [f1,f2,...,fn]
            embedding_list: list[float] = chunk["embedding"]
            embedding_str = "[" + ",".join(f"{v:.8f}" for v in embedding_list) + "]"

            records.append(
                (
                    doc_id,                             # $1 — document_id UUID
                    chunk["chunk_index"],               # $2 — chunk_index INT
                    chunk["content"],                   # $3 — content TEXT
                    embedding_str,                      # $4 — embedding VECTOR (text cast)
                    json.dumps(chunk.get("metadata", {})),  # $5 — metadata JSONB
                )
            )

        await conn.executemany(
            """
            INSERT INTO document_chunks (document_id, chunk_index, content, embedding, metadata)
            VALUES ($1::uuid, $2, $3, $4::vector, $5::jsonb);
            """,
            records,
        )
        logger.info(f"Inserted {len(records)} chunks for document {doc_id}.")


async def vector_search(
    query_embedding: list[float],
    top_k: int = 5,
    similarity_threshold: float = 0.3,
    document_ids: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """
    Perform HNSW cosine-similarity vector search in pgvector.

    Cosine similarity = 1 - cosine_distance (pgvector <=> operator returns distance).
    Only returns chunks with similarity >= similarity_threshold.

    Args:
        query_embedding: 384-dimensional query vector.
        top_k: Maximum number of chunks to return.
        similarity_threshold: Minimum cosine similarity score (0.0–1.0).
        document_ids: Optional list of document UUIDs to restrict search scope.

    Returns:
        List of result dicts sorted by descending similarity.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Serialise embedding to pgvector text format
        embedding_str = "[" + ",".join(f"{v:.8f}" for v in query_embedding) + "]"

        if document_ids:
            rows = await conn.fetch(
                """
                SELECT
                    c.id::text            AS chunk_id,
                    c.document_id::text   AS document_id,
                    d.filename,
                    c.chunk_index,
                    c.content,
                    c.metadata,
                    (1.0 - (c.embedding <=> $1::vector)) AS similarity
                FROM document_chunks c
                JOIN documents d ON d.id = c.document_id
                WHERE c.document_id = ANY($4::uuid[])
                  AND (1.0 - (c.embedding <=> $1::vector)) >= $2
                ORDER BY c.embedding <=> $1::vector ASC
                LIMIT $3;
                """,
                embedding_str,
                similarity_threshold,
                top_k,
                document_ids,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT
                    c.id::text            AS chunk_id,
                    c.document_id::text   AS document_id,
                    d.filename,
                    c.chunk_index,
                    c.content,
                    c.metadata,
                    (1.0 - (c.embedding <=> $1::vector)) AS similarity
                FROM document_chunks c
                JOIN documents d ON d.id = c.document_id
                WHERE (1.0 - (c.embedding <=> $1::vector)) >= $2
                ORDER BY c.embedding <=> $1::vector ASC
                LIMIT $3;
                """,
                embedding_str,
                similarity_threshold,
                top_k,
            )

        results = []
        for r in rows:
            meta = (
                json.loads(r["metadata"])
                if isinstance(r["metadata"], str)
                else dict(r["metadata"] or {})
            )
            results.append(
                {
                    "chunk_id": r["chunk_id"],
                    "document_id": r["document_id"],
                    "filename": r["filename"],
                    "chunk_index": r["chunk_index"],
                    "content": r["content"],
                    "metadata": meta,
                    "similarity": float(r["similarity"]),
                }
            )

        logger.debug(
            f"Vector search returned {len(results)} results "
            f"(top_k={top_k}, threshold={similarity_threshold}, "
            f"doc_filter={'yes' if document_ids else 'no'})."
        )
        return results


async def list_documents() -> list[dict[str, Any]]:
    """
    Return all document records ordered by creation date (newest first).
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id::text, filename, content_type, file_size, chunk_count, created_at
            FROM documents
            ORDER BY created_at DESC;
            """
        )
        return [dict(r) for r in rows]


async def delete_document(doc_id: str) -> bool:
    """
    Delete a document and cascade-delete all its chunks (FK cascade).

    Returns:
        True if a document was deleted, False if the document was not found.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM documents WHERE id = $1::uuid;",
            doc_id,
        )
        deleted = result != "DELETE 0"
        if deleted:
            logger.info(f"Deleted document {doc_id} and its chunks.")
        else:
            logger.warning(f"Delete requested for non-existent document {doc_id}.")
        return deleted


async def check_db_health() -> str:
    """
    Health probe for the database connection.

    Returns:
        'connected' on success, or 'disconnected: <error>' on failure.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            val = await conn.fetchval("SELECT 1;")
            return "connected" if val == 1 else "unhealthy"
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return f"disconnected: {str(e)}"


# --- Ingest jobs -----------------------------------------------------------
# Ingestion is tracked in the database rather than in process memory so a client
# can poll it, and so a job left running by a crashed process is still visible
# afterwards instead of vanishing.

_ACTIVE_JOB_STATUSES = ("queued", "parsing", "embedding")


async def create_job(filename: str, file_size: int) -> str:
    """Record a queued ingest job and return its UUID as a string."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO ingest_jobs (filename, file_size, status)
            VALUES ($1, $2, 'queued')
            RETURNING id::text;
            """,
            filename,
            file_size,
        )
        job_id: str = row["id"]
        logger.info(f"Created ingest job: id={job_id}, filename={filename!r}")
        return job_id


async def update_job(
    job_id: str,
    *,
    status: Optional[str] = None,
    document_id: Optional[str] = None,
    chunks_total: Optional[int] = None,
    chunks_done: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Patch whichever job fields were supplied, always bumping updated_at."""
    sets: list[str] = ["updated_at = CURRENT_TIMESTAMP"]
    args: list[Any] = []

    def add(fragment: str, value: Any) -> None:
        args.append(value)
        sets.append(f"{fragment} = ${len(args)}")

    if status is not None:
        add("status", status)
    if document_id is not None:
        add("document_id", document_id)
        sets[-1] += "::uuid"
    if chunks_total is not None:
        add("chunks_total", chunks_total)
    if chunks_done is not None:
        add("chunks_done", chunks_done)
    if error is not None:
        add("error", error)

    args.append(job_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE ingest_jobs SET {', '.join(sets)} WHERE id = ${len(args)}::uuid;",
            *args,
        )


async def get_job(job_id: str) -> Optional[dict[str, Any]]:
    """Fetch one job, or None if the id does not exist."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id::text, document_id::text, filename, file_size, status,
                   chunks_total, chunks_done, error, created_at, updated_at
            FROM ingest_jobs WHERE id = $1::uuid;
            """,
            job_id,
        )
        return dict(row) if row else None


async def list_active_jobs() -> list[dict[str, Any]]:
    """Jobs still queued or running, newest first."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id::text, document_id::text, filename, file_size, status,
                   chunks_total, chunks_done, error, created_at, updated_at
            FROM ingest_jobs
            WHERE status = ANY($1::varchar[])
            ORDER BY created_at DESC;
            """,
            list(_ACTIVE_JOB_STATUSES),
        )
        return [dict(r) for r in rows]


async def fail_interrupted_jobs() -> int:
    """
    Mark jobs that were mid-flight when the process died as failed.

    Work is held in an in-process queue, so anything still marked running at
    startup can never resume - the queue it was waiting on no longer exists.
    Without this they would appear to be progressing forever.

    Any document such a job had started writing is deleted too. A job killed
    mid-ingest leaves a document holding only the chunks that made it in, and
    the in-process cleanup cannot run when the process itself died. A partial
    document is worse than no document: it answers queries from a fraction of
    its content while looking complete.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Before the jobs are updated, while document_id still points at the
            # partial rows. Chunks go with it via ON DELETE CASCADE.
            partial = await conn.execute(
                """
                DELETE FROM documents d
                USING ingest_jobs j
                WHERE j.document_id = d.id
                  AND j.status = ANY($1::varchar[]);
                """,
                list(_ACTIVE_JOB_STATUSES),
            )
            result = await conn.execute(
                """
                UPDATE ingest_jobs
                SET status = 'failed',
                    error = 'Interrupted: the server restarted while this job was running.',
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = ANY($1::varchar[]);
                """,
                list(_ACTIVE_JOB_STATUSES),
            )

        count = int(result.split()[-1]) if result else 0
        discarded = int(partial.split()[-1]) if partial else 0
        if count:
            logger.warning(
                f"Marked {count} interrupted ingest job(s) as failed; "
                f"discarded {discarded} partially-written document(s)."
            )
        return count
