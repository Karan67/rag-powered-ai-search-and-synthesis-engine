import json
import logging
import re
from typing import AsyncGenerator, Any, Optional
from groq import AsyncGroq, APIStatusError
from app.config import settings
from app.services.vector_store import embed_query
from app.services.db import vector_search
from app.models.schemas import Citation

logger = logging.getLogger("rag_engine.orchestrator")

# Pure top-K similarity search falls apart on broad/enumerative questions
# ("list all characters") — the 5 most *semantically similar* chunks to that
# query are rarely the chunks that actually cover the full list. Widen the net
# for these instead of leaving the LLM to judge 5 thin chunks as "not enough".
#
# Note: this many chunks plus MAX_ANSWER_TOKENS can occasionally exceed
# Groq's free-tier 8,000 TPM cap on a single heavy request (HTTP 413) — that's
# handled gracefully below via _friendly_groq_error rather than avoided by
# shrinking retrieval, since a narrower net would just make broad answers
# worse across the board to avoid an occasional, clearly-explained failure.
_BROAD_QUERY_PATTERN = re.compile(
    r"\b(all|every|entire|complete|list|summarize|summary|overview)\b",
    re.IGNORECASE,
)
_BROAD_QUERY_TOP_K = 40
_BROAD_QUERY_SIMILARITY_THRESHOLD = 0.1


def _friendly_groq_error(e: Exception) -> str:
    """Translate Groq API errors into something a user can actually act on."""
    if isinstance(e, APIStatusError) and e.status_code in (413, 429):
        return (
            "That question needs more context than the current plan allows in a "
            "single request. Try narrowing it — ask about specific characters or "
            "chapters instead of everything at once — or split it into smaller "
            "questions."
        )
    return "I'm sorry, something went wrong generating a response. Please try asking again."


def _widen_for_broad_query(query: str, top_k: int, similarity_threshold: float) -> tuple[int, float]:
    if _BROAD_QUERY_PATTERN.search(query):
        return max(top_k, _BROAD_QUERY_TOP_K), min(similarity_threshold, _BROAD_QUERY_SIMILARITY_THRESHOLD)
    return top_k, similarity_threshold

def format_rag_context(chunks: list[dict[str, Any]]) -> tuple[str, list[Citation]]:
    """
    Format vector search results into numbered context blocks for prompt & citation schemas.
    """
    context_passages = []
    citations = []
    
    for idx, chunk in enumerate(chunks, start=1):
        citation = Citation(
            citation_index=idx,
            document_id=chunk["document_id"],
            filename=chunk["filename"],
            chunk_index=chunk["chunk_index"],
            score=round(chunk["similarity"], 4),
            content_snippet=chunk["content"],
            metadata=chunk.get("metadata", {})
        )
        citations.append(citation)
        
        passage_str = (
            f"[Citation {idx}] (Document: {chunk['filename']}, Page: {chunk.get('metadata', {}).get('page_number', 1)})\n"
            f"{chunk['content']}"
        )
        context_passages.append(passage_str)
        
    formatted_context = "\n\n".join(context_passages)
    return formatted_context, citations

SYSTEM_PROMPT = """You are an Enterprise RAG Assistant specializing in document synthesis and analysis.
Your primary objective is to accurately answer the user's question using ONLY the provided context passages below.

RESPONSE LENGTH & FORMAT — match the shape of your answer to the shape of the question:
- A specific factual question ("which page does X first appear on?") gets a short, direct answer — one or two sentences, no preamble, no restating the question.
- A question asking for a list, enumeration, or "all/every X" gets a structured bullet or numbered list of everything the context actually supports.
- A question asking to summarize or explain gets a fuller structured answer with headings or bullets where that actually helps readability.
- Never pad a simple answer to sound more thorough than it needs to be.

STRICT CITATION RULES:
1. Every claim, fact, or metric you extract MUST be accompanied by an inline citation tag like [1], [2], etc., corresponding to the context passage index.
2. If multiple passages support a statement, combine citations like [1][3].
3. Answer using only what the context passages actually contain. If the context only covers part of what was asked (e.g. some but not all items in a list), give what's there and note it may be incomplete — don't refuse outright just because the coverage isn't total.
4. Only if the context contains genuinely nothing relevant to the question, say exactly: "I'm sorry, I can't help with that based on the documents you've uploaded — please try asking something else." Do NOT extrapolate or fabricate facts.

CONTEXT PASSAGES:
{context}
"""

async def retrieve_context(
    query: str,
    top_k: int = settings.TOP_K,
    similarity_threshold: float = settings.SIMILARITY_THRESHOLD,
    document_ids: Optional[list[str]] = None
) -> tuple[str, list[Citation]]:
    """
    Embed query and search vector store for matching passages.
    """
    top_k, similarity_threshold = _widen_for_broad_query(query, top_k, similarity_threshold)
    query_vector = embed_query(query)
    chunks = await vector_search(
        query_embedding=query_vector,
        top_k=top_k,
        similarity_threshold=similarity_threshold,
        document_ids=document_ids
    )
    if not chunks:
        return "", []
    return format_rag_context(chunks)

async def execute_rag_query(
    query: str,
    top_k: int = settings.TOP_K,
    similarity_threshold: float = settings.SIMILARITY_THRESHOLD,
    document_ids: Optional[list[str]] = None
) -> dict[str, Any]:
    """
    Non-streaming full query execution.
    """
    context_str, citations = await retrieve_context(query, top_k, similarity_threshold, document_ids)
    
    if not context_str:
        return {
            "query": query,
            "answer": "I'm sorry, I can't help with that based on the documents you've uploaded — please try asking something else.",
            "citations": []
        }
        
    prompt = SYSTEM_PROMPT.format(context=context_str)
    
    client = AsyncGroq(api_key=settings.GROQ_API_KEY or "dummy_key")
    
    try:
        completion = await client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": query}
            ],
            temperature=0.2,
            max_completion_tokens=settings.MAX_ANSWER_TOKENS,
            reasoning_effort="low",
            include_reasoning=False,
        )
        answer = completion.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"Groq API call error: {e}")
        answer = _friendly_groq_error(e)

    return {
        "query": query,
        "answer": answer,
        "citations": citations
    }

async def stream_rag_query(
    query: str,
    top_k: int = settings.TOP_K,
    similarity_threshold: float = settings.SIMILARITY_THRESHOLD,
    document_ids: Optional[list[str]] = None,
) -> AsyncGenerator[str, None]:
    """
    Server-Sent Events (SSE) streaming query async generator.

    Yields SSE-formatted string frames:
      - `data: {"event": "citations", "citations": [...]}\\n\\n`  (first, always)
      - `data: {"event": "token", "token": "..."}\\n\\n`          (one per LLM token)
      - `data: {"event": "done"}\\n\\n`                           (terminal frame)

    FastAPI StreamingResponse consumes this generator directly with
    media_type="text/event-stream".
    """
    context_str, citations = await retrieve_context(query, top_k, similarity_threshold, document_ids)
    
    # 1. Send Citations event first so UI can load citations drawer immediately
    citations_data = [c.model_dump() for c in citations]
    yield f"data: {json.dumps({'event': 'citations', 'citations': citations_data})}\n\n"
    
    if not context_str:
        no_ctx_msg = "I'm sorry, I can't help with that based on the documents you've uploaded — please try asking something else."
        yield f"data: {json.dumps({'event': 'token', 'token': no_ctx_msg})}\n\n"
        yield f"data: {json.dumps({'event': 'done'})}\n\n"
        return

    prompt = SYSTEM_PROMPT.format(context=context_str)
    
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "gsk_your_groq_api_key_here":
        # Fallback simulated streaming for local testing when API key is unconfigured
        simulated_response = (
            f"Here is the synthesized information based on your query '{query}':\n\n"
            f"According to [1], the document contains key details regarding this topic. "
            f"Further analysis in [2] supports these findings.\n\n"
            f"*Note: Add your actual `GROQ_API_KEY` in `.env` for full Groq LLM inference.*"
        )
        for word in simulated_response.split(" "):
            yield f"data: {json.dumps({'event': 'token', 'token': word + ' '})}\n\n"
        yield f"data: {json.dumps({'event': 'done'})}\n\n"
        return

    client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    
    try:
        stream = await client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": query}
            ],
            temperature=0.2,
            max_completion_tokens=settings.MAX_ANSWER_TOKENS,
            reasoning_effort="low",
            include_reasoning=False,
            stream=True
        )
        
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                yield f"data: {json.dumps({'event': 'token', 'token': token})}\n\n"
                
    except Exception as e:
        logger.error(f"Streaming error from Groq SDK: {e}")
        err_msg = _friendly_groq_error(e)
        yield f"data: {json.dumps({'event': 'token', 'token': err_msg})}\n\n"
        
    yield f"data: {json.dumps({'event': 'done'})}\n\n"
