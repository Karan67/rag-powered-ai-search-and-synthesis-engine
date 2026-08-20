import logging

from app.config import settings
from app.services.embedding_provider import get_provider

logger = logging.getLogger("rag_engine.vector_store")


def get_embedding_model():
    """
    Warm the configured embedding backend.

    Called at startup so the first upload does not pay model-load time, and so a
    misconfigured backend fails loudly on boot rather than mid-ingest.
    """
    provider = get_provider()
    # Round-trip one short string: for the local backend this forces the ONNX
    # graph to load, and for the HTTP backend it proves credentials work.
    provider.embed(["warmup"])
    return provider


def _validate_embedding_dim(embedding: list[float]) -> None:
    """Validate that the embedding dimension matches the configured EMBEDDING_DIM."""
    actual_dim = len(embedding)
    if actual_dim != settings.EMBEDDING_DIM:
        logger.error(
            f"Embedding dimension mismatch: expected {settings.EMBEDDING_DIM}, "
            f"got {actual_dim}. Check EMBEDDING_MODEL matches EMBEDDING_DIM in config."
        )
        raise ValueError(
            f"Embedding dimension {actual_dim} does not match configured "
            f"EMBEDDING_DIM={settings.EMBEDDING_DIM}. "
            f"Model '{settings.EMBEDDING_MODEL}' may not produce {settings.EMBEDDING_DIM}d vectors."
        )


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Generate EMBEDDING_DIM-dimensional embeddings for a batch of text chunks.

    Raises:
        RuntimeError: If the embedding backend fails.
        ValueError: If the embedding dimensions are wrong.
    """
    if not texts:
        logger.warning("embed_texts called with empty texts list — returning empty result.")
        return []

    logger.debug(f"Embedding batch of {len(texts)} text chunks...")
    embeddings = get_provider().embed(texts)

    if not embeddings:
        raise RuntimeError("Embedding backend returned no embeddings for the provided batch.")

    # Representative check; a backend returning mixed dimensions is broken anyway.
    _validate_embedding_dim(embeddings[0])

    logger.debug(f"Successfully embedded {len(embeddings)} chunks (dim={len(embeddings[0])}).")
    return embeddings


def embed_query(query: str) -> list[float]:
    """
    Generate a single EMBEDDING_DIM-dimensional embedding for a search query.

    Raises:
        RuntimeError: If the embedding backend fails.
        ValueError: If the query is empty or embedding dimensions are wrong.
    """
    if not query or not query.strip():
        raise ValueError("embed_query received an empty query string.")

    embeddings = get_provider().embed([query])
    if not embeddings:
        raise RuntimeError("Embedding backend returned no embedding for the query.")

    embedding = embeddings[0]
    _validate_embedding_dim(embedding)
    return embedding
