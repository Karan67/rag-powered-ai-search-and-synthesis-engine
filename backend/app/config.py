from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-120b"
    DATABASE_URL: str = "postgresql://rag_user:rag_password@localhost:5432/rag_db"
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIM: int = 384
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 100
    SIMILARITY_THRESHOLD: float = 0.3
    TOP_K: int = 5
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    MAX_UPLOAD_MB: int = 15
    EMBEDDING_THREADS: int = 4
    EMBED_BATCH_SIZE: int = 64
    MAX_ANSWER_TOKENS: int = 4096

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
