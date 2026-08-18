# Enterprise RAG Document Search & Synthesis Engine

[![Stack](https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Embeddings](https://img.shields.io/badge/FastEmbed-BAAI%2Fbge--small--en--v1.5-6366F1)](https://github.com/qdrant/fastembed)
[![VectorDB](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791?logo=postgresql)](https://github.com/pgvector/pgvector)
[![LLM](https://img.shields.io/badge/Groq-openai%2Fgpt--oss--120b-F59E0B)](https://groq.com/)
[![Frontend](https://img.shields.io/badge/Next.js-14%20(App%20Router)-000000?logo=nextdotjs)](https://nextjs.org/)

An enterprise-grade Retrieval-Augmented Generation (RAG) platform that enables high-performance document parsing, vector indexing with `fastembed` and `pgvector` HNSW indexes, streaming LLM synthesis with Groq, and an interactive citation drawer.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph Client["Next.js 14 Frontend"]
        UI[Chat Interface & File Uploader]
        SSE[SSE Stream Consumer]
        Drawer[Citation Drawer]
    end

    subgraph API["FastAPI Backend"]
        Endpoint[FastAPI Async Endpoints]
        Parser[PDF/TXT/MD/DOCX Parser & Chunker]
        FastEmbed[FastEmbed BAAI/bge-small-en-v1.5 384d]
        Engine[RAG Orchestrator]
    end

    subgraph Data["Database & Services"]
        PgVector[(PostgreSQL 16 + pgvector HNSW Index)]
        Groq[Groq Cloud SDK - openai/gpt-oss-120b]
    end

    UI -->|Multipart Upload| Endpoint
    UI -->|SSE Query Stream| SSE
    Endpoint --> Parser
    Parser --> FastEmbed
    FastEmbed -->|Store Vectors| PgVector
    SSE -->|Stream API| Engine
    Engine -->|HNSW Cosine Vector Search <=>| PgVector
    Engine -->|Stream Synthesis| Groq
    Groq -->|SSE Tokens| Engine
    Engine -->|Token & Citations Events| SSE
    Drawer <--> UI
```

---

## 2. Directory Structure

```text
rag-document-engine/
├── .env.example
├── README.md
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── schema.sql
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       ├── models/
│       │   ├── __init__.py
│       │   └── schemas.py
│       └── services/
│           ├── __init__.py
│           ├── db.py
│           ├── parser.py
│           ├── vector_store.py
│           └── rag_engine.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   └── page.tsx
        ├── components/
        │   ├── FileUploader.tsx
        │   ├── ChatWindow.tsx
        │   ├── MessageBubble.tsx
        │   └── CitationDrawer.tsx
        └── lib/
            └── api.ts
```

---

## 3. Quick Start (Local Staging with Docker Compose)

### Step 1: Clone & Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update `.env` with your Groq API key:
```env
GROQ_API_KEY=gsk_your_actual_groq_api_key_here
DATABASE_URL=postgresql://rag_user:rag_password@postgres:5432/rag_db
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### Step 2: Build & Start Services
```bash
docker-compose up --build -d
```

- **Frontend Application**: `http://localhost:3000`
- **FastAPI OpenAPI Documentation**: `http://localhost:8000/docs`
- **PostgreSQL Vector DB**: `localhost:5432`

---

## 4. Manual Local Development Setup

### Backend Setup (Python 3.11+)
```bash
cd backend
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Database Setup (PostgreSQL 16 with pgvector)
Ensure PostgreSQL is running locally with the `vector` extension, then run:
```bash
psql -U rag_user -d rag_db -f schema.sql
```

### Frontend Setup (Next.js 14)
```bash
cd frontend
npm install
npm run dev
```

---

## 5. API Reference

### Document Management
- **`POST /api/upload`**: Ingest PDF, TXT, MD, or DOCX document. Returns parsed metadata and chunk count.
- **`GET /api/documents`**: Returns array of all ingested document records.
- **`DELETE /api/documents/{doc_id}`**: Delete document and cascade delete vector embeddings.

### Search & Synthesis
- **`POST /api/query`**: Non-streaming RAG query execution. Returns JSON response with `answer` and `citations`.
- **`POST /api/query/stream`**: Server-Sent Events (SSE) streaming endpoint returning `token` events and `citations` metadata payload.

### System
- **`GET /health`**: Health check for database pool, FastEmbed model, and API status.

---

## 6. Production Deployment Strategy

### Option A: Serverless & Managed Services (Vercel + Railway/Render + Supabase)
1. **Database**: Provision a free PostgreSQL instance on **Supabase** or **Neon**. Run `backend/schema.sql` via Query Editor. Enable `vector` extension.
2. **Backend Service**: Deploy `backend/` to **Railway** or **Render**. Set environment variables `DATABASE_URL` (Supabase connection string) and `GROQ_API_KEY`.
3. **Frontend Application**: Deploy `frontend/` to **Vercel**. Set `NEXT_PUBLIC_API_BASE_URL` to your backend Render/Railway URL.

### Option B: Unified Containerized Deployment
Deploy using `docker-compose.yml` on AWS EC2, GCP Compute Engine, or DigitalOcean Droplet with automated SSL via Docker Nginx Reverse Proxy.
