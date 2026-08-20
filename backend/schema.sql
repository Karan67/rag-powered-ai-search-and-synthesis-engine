-- Enterprise RAG Schema with pgvector & HNSW index

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Documents Master Table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Document Chunks Table with Vector Embedding (384-dimensional for BAAI/bge-small-en-v1.5)
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ingest Jobs. Ingestion runs in the background rather than inside the upload
-- request: embedding a book-sized PDF takes minutes, and holding an HTTP
-- connection open that long means a dropped connection or browser timeout loses
-- the work with no way to resume or even find out what happened.
CREATE TABLE IF NOT EXISTS ingest_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Set to NULL rather than deleting the job if the document goes away, so a
    -- client still polling gets a terminal answer instead of a 404.
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    -- queued -> parsing -> embedding -> completed | failed
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    chunks_total INTEGER NOT NULL DEFAULT 0,
    chunks_done INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- The UI polls active jobs constantly; this keeps that a small index scan.
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_active
ON ingest_jobs(created_at DESC)
WHERE status IN ('queued', 'parsing', 'embedding');

-- Foreign Key Index
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id ON document_chunks(document_id);

-- HNSW Vector Index for Fast Cosine Similarity Search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);
