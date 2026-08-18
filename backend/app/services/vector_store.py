import logging
from typing import Optional
from fastembed import TextEmbedding
from app.config import settings

logger = logging.getLogger("rag_engine.vector_store")

_embedding_model: Optional[TextEmbedding] = None


def get_embedding_model() -> TextEmbedding:
    """
    Lazy-initialize and cache the FastEmbed TextEmbedding model.
    Thread-safe for single-process async workloads (FastAPI/uvicorn default).
    """
    global _embedding_model
    if _embedding_model is None:
        logger.info(
            f"Loading FastEmbed model: '{settings.EMBEDDING_MODEL}' "
            f"(expected dim={settings.EMBEDDING_DIM})"
        )
        try:
            _embedding_model = TextEmbedding(
                model_name=settings.EMBEDDING_MODEL,
                threads=settings.EMBEDDING_THREADS,
            )
            logger.info(
                f"FastEmbed model '{settings.EMBEDDING_MODEL}' loaded successfully."
            )
        except Exception as e:
            logger.error(
                f"CRITICAL: Failed to load FastEmbed model '{settings.EMBEDDING_MODEL}': {e}",
                exc_info=True,
            )
            raise RuntimeError(
                f"Could not initialize embedding model '{settings.EMBEDDING_MODEL}': {e}"
            ) from e
    return _embedding_model


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

    Args:
        texts: List of non-empty text strings to embed.

    Returns:
        List of float lists, each of length settings.EMBEDDING_DIM (384 for BGE-small).

    Raises:
        RuntimeError: If the embedding model fails to load.
        ValueError: If text list is empty or embedding dimensions are wrong.
    """
    if not texts:
        logger.warning("embed_texts called with empty texts list — returning empty result.")
        return []

    model = get_embedding_model()
    logger.debug(f"Embedding batch of {len(texts)} text chunks...")

    try:
        embeddings_generator = model.embed(texts)
        embeddings = [embedding.tolist() for embedding in embeddings_generator]
    except Exception as e:
        logger.error(f"Batch embedding failed for {len(texts)} texts: {e}", exc_info=True)
        raise RuntimeError(f"FastEmbed batch embedding error: {e}") from e

    if not embeddings:
        raise RuntimeError("FastEmbed returned no embeddings for the provided text batch.")

    # Validate dimension of first embedding as a representative check
    _validate_embedding_dim(embeddings[0])

    logger.debug(f"Successfully embedded {len(embeddings)} chunks (dim={len(embeddings[0])}).")
    return embeddings


def embed_query(query: str) -> list[float]:
    """
    Generate a single EMBEDDING_DIM-dimensional embedding for a search query string.

    Args:
        query: The query string to embed.

    Returns:
        A float list of length settings.EMBEDDING_DIM.

    Raises:
        RuntimeError: If the embedding model fails to load or embed.
        ValueError: If the query is empty or embedding dimensions are wrong.
    """
    if not query or not query.strip():
        raise ValueError("embed_query received an empty query string.")

    model = get_embedding_model()
    logger.debug(f"Embedding query: '{query[:80]}...' " if len(query) > 80 else f"Embedding query: '{query}'")

    try:
        embeddings_generator = model.embed([query])
        embedding = list(next(embeddings_generator))
    except StopIteration:
        raise RuntimeError("FastEmbed returned no embedding for the query — generator was empty.")
    except Exception as e:
        logger.error(f"Query embedding failed: {e}", exc_info=True)
        raise RuntimeError(f"FastEmbed query embedding error: {e}") from e

    _validate_embedding_dim(embedding)
    return embedding
