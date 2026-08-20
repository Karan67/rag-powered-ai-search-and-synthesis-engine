"""Pluggable embedding backends.

Local ONNX inference needs no credentials but is CPU-bound: embedding one 4MB PDF
costs roughly 34 TFLOP, which a 0.1 vCPU host cannot deliver in any reasonable
time. The HTTP backend calls the *same* model on a hosted inference endpoint, so
vectors land in the same space as everything already indexed and no existing
document has to be re-embedded.

Selected by EMBEDDING_BACKEND. "local" is the default so nothing changes unless
the HTTP backend is deliberately configured.
"""
import logging
import math
import time
from typing import Optional, Protocol

import httpx

from app.config import settings

logger = logging.getLogger("rag_engine.embedding_provider")


class EmbeddingProvider(Protocol):
    """Turns text into vectors of settings.EMBEDDING_DIM floats."""

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def _l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


class LocalProvider:
    """FastEmbed ONNX inference in-process."""

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is None:
            from fastembed import TextEmbedding

            logger.info(
                "Loading FastEmbed model %r (dim=%d, threads=%d)",
                settings.EMBEDDING_MODEL,
                settings.EMBEDDING_DIM,
                settings.EMBEDDING_THREADS,
            )
            try:
                self._model = TextEmbedding(
                    model_name=settings.EMBEDDING_MODEL,
                    threads=settings.EMBEDDING_THREADS,
                )
            except Exception as e:
                logger.error("Failed to load FastEmbed model: %s", e, exc_info=True)
                raise RuntimeError(
                    f"Could not initialize embedding model {settings.EMBEDDING_MODEL!r}: {e}"
                ) from e
            logger.info("FastEmbed model loaded.")
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        try:
            return [v.tolist() for v in model.embed(texts)]
        except Exception as e:
            logger.error("Local embedding failed for %d texts: %s", len(texts), e, exc_info=True)
            raise RuntimeError(f"FastEmbed batch embedding error: {e}") from e


class HTTPProvider:
    """
    Hosted inference over HTTP, for hosts without the CPU to run the model.

    Points at the same model id as the local backend by default, which is the
    whole point: identical weights mean identical vector space, so previously
    indexed documents stay valid.
    """

    def __init__(self) -> None:
        if not settings.EMBED_API_TOKEN:
            raise RuntimeError(
                "EMBEDDING_BACKEND=http requires EMBED_API_TOKEN to be set."
            )
        self._url = settings.EMBED_API_URL or (
            "https://router.huggingface.co/hf-inference/models/"
            f"{settings.EMBEDDING_MODEL}/pipeline/feature-extraction"
        )
        self._client = httpx.Client(
            timeout=settings.EMBED_HTTP_TIMEOUT,
            headers={
                "Authorization": f"Bearer {settings.EMBED_API_TOKEN}",
                "Content-Type": "application/json",
            },
        )
        logger.info("HTTP embedding backend -> %s", self._url)

    def _coerce(self, payload, expected: int) -> list[list[float]]:
        """
        Normalise the provider's response shape into one vector per input.

        Sentence-transformers endpoints return one vector per input, but some
        return per-token vectors instead. bge pools on the CLS token, so take
        index 0 rather than mean-pooling, or the vectors would not match what the
        local backend produced for already-indexed documents.
        """
        if not isinstance(payload, list) or not payload:
            raise RuntimeError(f"Unexpected embedding response type: {type(payload).__name__}")

        if isinstance(payload[0], list) and payload[0] and isinstance(payload[0][0], list):
            logger.warning("Endpoint returned token-level vectors; pooling on CLS token.")
            payload = [rows[0] for rows in payload]

        if len(payload) != expected:
            raise RuntimeError(f"Asked for {expected} embeddings, received {len(payload)}")

        return [_l2_normalize([float(x) for x in vec]) for vec in payload]

    def _post(self, batch: list[str]) -> list[list[float]]:
        body = {"inputs": batch, "options": {"wait_for_model": True}}
        delay = 2.0
        last: Optional[Exception] = None

        for attempt in range(1, settings.EMBED_HTTP_RETRIES + 1):
            try:
                resp = self._client.post(self._url, json=body)
                # 503 means the model is spinning up; 429 is rate limiting. Both
                # are worth waiting out rather than failing the whole ingest.
                if resp.status_code in (429, 503):
                    raise httpx.HTTPStatusError(
                        f"transient {resp.status_code}", request=resp.request, response=resp
                    )
                resp.raise_for_status()
                return self._coerce(resp.json(), len(batch))
            except Exception as e:
                last = e
                if attempt == settings.EMBED_HTTP_RETRIES:
                    break
                logger.warning(
                    "Embedding request failed (attempt %d/%d): %s - retrying in %.0fs",
                    attempt,
                    settings.EMBED_HTTP_RETRIES,
                    e,
                    delay,
                )
                time.sleep(delay)
                delay *= 2

        raise RuntimeError(f"Embedding endpoint failed after {settings.EMBED_HTTP_RETRIES} attempts: {last}")

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        size = max(1, settings.EMBED_HTTP_BATCH)
        for i in range(0, len(texts), size):
            out.extend(self._post(texts[i : i + size]))
        return out


_provider: Optional[EmbeddingProvider] = None


def get_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        backend = (settings.EMBEDDING_BACKEND or "local").strip().lower()
        if backend == "http":
            _provider = HTTPProvider()
        elif backend == "local":
            _provider = LocalProvider()
        else:
            raise RuntimeError(
                f"Unknown EMBEDDING_BACKEND {backend!r}; expected 'local' or 'http'."
            )
        logger.info("Embedding backend: %s", backend)
    return _provider


def reset_provider() -> None:
    """Drop the cached provider. Only used by tests."""
    global _provider
    _provider = None
