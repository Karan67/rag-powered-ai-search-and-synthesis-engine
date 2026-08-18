from datetime import datetime
from typing import Optional, Any, Union
from pydantic import BaseModel, Field


class DocumentMeta(BaseModel):
    id: str
    filename: str
    content_type: str
    file_size: int
    chunk_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FileUploadResponse(BaseModel):
    message: str
    document: DocumentMeta


class Citation(BaseModel):
    citation_index: int
    document_id: str
    filename: str
    chunk_index: int
    score: float
    content_snippet: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Search & synthesis query string")
    top_k: Optional[int] = Field(default=5, ge=1, le=20)
    similarity_threshold: Optional[float] = Field(default=0.3, ge=0.0, le=1.0)
    document_ids: Optional[list[str]] = Field(
        default=None, description="Optional document ID filtering"
    )


class QueryResponse(BaseModel):
    query: str
    answer: str
    citations: list[Citation]


class HealthResponse(BaseModel):
    status: str
    database: str
    embedding_model: str
