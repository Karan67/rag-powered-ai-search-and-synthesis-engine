from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"
    DATABASE_URL: str = "postgresql://rag_user:rag_password@localhost:5432/rag_db"
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIM: int = 384
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 100
    # A chunk shorter than this carries too little context to answer from, and
    # short chunks skew cosine similarity — they get merged at ingest, and
    # filtered out at query time for documents indexed before that fix.
    MIN_CHUNK_CHARS: int = 120
    MIN_CONTEXT_CHARS: int = 160
    SIMILARITY_THRESHOLD: float = 0.3
    TOP_K: int = 5
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    MAX_UPLOAD_MB: int = 15
    EMBEDDING_THREADS: int = 4
    EMBED_BATCH_SIZE: int = 64
    # Reply budget for a normal, narrowly-retrieved question. Deliberately high:
    # gpt-oss is a reasoning model and spends part of this budget thinking before
    # it emits anything, so a small cap can yield an empty answer.
    MAX_ANSWER_TOKENS: int = 4096
    # Wide retrieval already spends most of the free-tier 8,000 TPM budget on
    # context, and Groq counts prompt + max_completion_tokens in full whether or
    # not the reply uses it. These tiers therefore get a smaller reply budget so
    # the request is accepted at all; retrieval width is untouched.
    BROAD_ANSWER_TOKENS: int = 1200
    ENTITY_ANSWER_TOKENS: int = 1536

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
