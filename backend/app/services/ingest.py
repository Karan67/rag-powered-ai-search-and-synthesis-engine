"""Background document ingestion.

Ingestion used to run inside the upload request. Embedding a book-sized PDF
takes minutes, so that meant holding an HTTP connection open for the duration: a
dropped connection, a proxy timeout or a browser tab closing lost the work with
no way to resume and no record of what happened. Uploads now return immediately
with a job id, and the client polls.

This is a single in-process worker draining an asyncio queue, not a distributed
task system. That is a deliberate trade: it needs no broker, no second service
and no extra hosting, which matters on a free tier where background workers are
not offered at all. The cost is that queued work does not survive a restart -
handled by failing interrupted jobs on startup rather than letting them appear
to run forever.
"""
import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional

from app.config import settings
from app.services import db, parser, vector_store

logger = logging.getLogger("rag_engine.ingest")


@dataclass(slots=True)
class IngestTask:
    job_id: str
    filename: str
    content_type: str
    file_bytes: bytes


# Queued tasks hold their file bytes in memory, so the depth is bounded: at
# MAX_UPLOAD_MB each, an unbounded queue is an out-of-memory kill waiting for a
# burst of uploads. Full means the caller gets a clear 503 instead.
_queue: Optional[asyncio.Queue] = None
_worker: Optional[asyncio.Task] = None


def _get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue(maxsize=settings.INGEST_QUEUE_SIZE)
    return _queue


def queue_depth() -> int:
    return _get_queue().qsize() if _queue is not None else 0


async def enqueue(task: IngestTask) -> bool:
    """Add a task to the queue. False if the queue is full."""
    try:
        _get_queue().put_nowait(task)
        return True
    except asyncio.QueueFull:
        return False


async def _run_task(task: IngestTask) -> None:
    """Parse, chunk, embed and store one document, recording progress as it goes."""
    doc_id: Optional[str] = None
    try:
        await db.update_job(task.job_id, status="parsing")

        # CPU-bound, so off the event loop: otherwise a large file freezes every
        # other request, including health checks.
        parse_start = time.monotonic()
        pages = await asyncio.to_thread(
            parser.parse_document,
            file_bytes=task.file_bytes,
            filename=task.filename,
            content_type=task.content_type,
        )
        parse_seconds = time.monotonic() - parse_start

        if not pages:
            raise ValueError("Could not extract any text from this document.")

        chunks = parser.chunk_text_sliding_window(pages)
        if not chunks:
            raise ValueError("Document contained no parseable text.")

        logger.info(
            f"Parsed {task.filename!r}: {len(pages)} pages -> {len(chunks)} chunks "
            f"in {parse_seconds:.1f}s"
        )

        # The document row is created only once there is something to store, so
        # a file that fails to parse never leaves an empty record behind.
        doc_id = await db.create_document(
            filename=task.filename,
            content_type=task.content_type,
            file_size=len(task.file_bytes),
        )
        await db.update_job(
            task.job_id,
            status="embedding",
            document_id=doc_id,
            chunks_total=len(chunks),
        )

        # Embed and insert in bounded batches. Holding every embedding for a
        # document before writing anything makes peak memory scale with document
        # size; batching keeps it flat and lets progress be reported as it goes.
        embed_start = time.monotonic()
        batch_size = settings.EMBED_BATCH_SIZE
        inserted = 0

        for start in range(0, len(chunks), batch_size):
            batch = chunks[start : start + batch_size]
            contents = [c["content"] for c in batch]
            embeddings = await asyncio.to_thread(vector_store.embed_texts, contents)

            await db.insert_chunks(
                doc_id,
                [
                    {
                        "chunk_index": c["chunk_index"],
                        "content": c["content"],
                        "embedding": emb,
                        "metadata": c["metadata"],
                    }
                    for c, emb in zip(batch, embeddings)
                ],
            )

            inserted += len(batch)
            await db.update_document_chunk_count(doc_id, inserted)
            await db.update_job(task.job_id, chunks_done=inserted)
            logger.info(
                f"Progress: {inserted}/{len(chunks)} chunks for {task.filename!r} "
                f"({time.monotonic() - embed_start:.1f}s elapsed)"
            )

        await db.update_job(task.job_id, status="completed", chunks_done=inserted)
        logger.info(f"Ingest complete for {task.filename!r}: {inserted} chunks.")

    except asyncio.CancelledError:
        # Shutdown mid-job. Leave the row running so the startup reaper reports
        # it as interrupted, which is the truth.
        raise
    except Exception as e:
        logger.error(f"Ingest failed for {task.filename!r}: {e}", exc_info=True)
        await db.update_job(task.job_id, status="failed", error=str(e)[:500])
        # A half-written document is worse than none: it would answer queries
        # from partial content with no indication anything is missing.
        if doc_id:
            try:
                await db.delete_document(doc_id)
            except Exception as cleanup_error:
                logger.error(f"Could not clean up partial document: {cleanup_error}")
    finally:
        # Release the file bytes promptly rather than at the next GC pass.
        task.file_bytes = b""


async def _worker_loop() -> None:
    logger.info("Ingest worker started.")
    queue = _get_queue()
    while True:
        task = await queue.get()
        try:
            await _run_task(task)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # _run_task handles its own errors; this is the last line of defence
            # so one bad job cannot kill the worker and stall every later upload.
            logger.error(f"Unhandled ingest worker error: {e}", exc_info=True)
        finally:
            queue.task_done()


async def start_worker() -> None:
    global _worker
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_worker_loop())


async def stop_worker() -> None:
    global _worker
    if _worker is not None and not _worker.done():
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        logger.info("Ingest worker stopped.")
    _worker = None
