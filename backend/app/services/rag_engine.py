import asyncio
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
# Note: 40 full-size chunks cost roughly 6,200 tokens of context, so on Groq's
# free-tier 8,000 TPM cap the reply budget is what has to give — see
# _answer_tokens_for_query. Retrieval width stays as-is deliberately: a narrower
# net would make every broad answer worse. Anything that still exceeds the cap
# is reported through _friendly_groq_error rather than as raw JSON.
_BROAD_QUERY_PATTERN = re.compile(
    r"\b(all|every|entire|complete|list|summarize|summary|overview)\b",
    re.IGNORECASE,
)
_BROAD_QUERY_TOP_K = 40
_BROAD_QUERY_SIMILARITY_THRESHOLD = 0.1

# "Who is X" has the opposite failure mode to a narrow factual lookup: no single
# passage defines a character or concept, so the top 5 nearest chunks are just
# the 5 places the name happens to appear. A characterisation has to be built
# from many mentions, so widen — but only moderately, well short of the broad
# tier, to stay inside the free-tier token budget.
_ENTITY_QUERY_PATTERN = re.compile(
    r"\b(?:who|what)\s+(?:is|are|was|were)\b|\btell me about\b|\bdescribe\b",
    re.IGNORECASE,
)
_ENTITY_QUERY_TOP_K = 16
_ENTITY_QUERY_SIMILARITY_THRESHOLD = 0.25

# Fetch extra candidates so short, low-information fragments can be dropped
# without starving the answer of context.
_OVERFETCH_FACTOR = 4


_TRUNCATION_NOTE = (
    "\n\n*(Answer cut short — a question this broad pulls in a lot of context, "
    "which leaves limited room for the reply. Ask about fewer items at a time "
    "for a complete answer.)*"
)


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


def _answer_tokens_for_query(query: str) -> int:
    """
    Reply budget to request for this question.

    Groq charges prompt + max_completion_tokens against the per-minute cap in
    full, even when the answer comes back a fraction of that size. The widened
    tiers already spend most of the free-tier budget on context, so asking for a
    4,096-token reply on top of 40 passages is rejected outright with a 413
    before the model produces anything. Narrow questions retrieve little and keep
    the full budget.
    """
    if _BROAD_QUERY_PATTERN.search(query):
        return settings.BROAD_ANSWER_TOKENS
    if _ENTITY_QUERY_PATTERN.search(query):
        return settings.ENTITY_ANSWER_TOKENS
    return settings.MAX_ANSWER_TOKENS


def _widen_for_query(query: str, top_k: int, similarity_threshold: float) -> tuple[int, float]:
    """Pick a retrieval width based on the shape of the question."""
    if _BROAD_QUERY_PATTERN.search(query):
        return max(top_k, _BROAD_QUERY_TOP_K), min(similarity_threshold, _BROAD_QUERY_SIMILARITY_THRESHOLD)
    if _ENTITY_QUERY_PATTERN.search(query):
        return max(top_k, _ENTITY_QUERY_TOP_K), min(similarity_threshold, _ENTITY_QUERY_SIMILARITY_THRESHOLD)
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

ANSWERING STANCE — write about the subject, not about the passages:
- The passages are your evidence, not your topic. Never describe what the passages themselves do. Phrases like "X is a character who speaks in the passages", "the document mentions X", or "according to the text provided" are wrong — state what is true about X.
- Never quote a stray line of dialogue or a sentence fragment as if it were a definition.
- For "who is X" or "what is X", build a characterisation by synthesising across ALL the passages: what role X holds, who X relates to, what X consistently does, and what X is like. Draw the picture from the combined evidence rather than reporting one fragment of it.
- If the passages only show the subject in passing, say what can reasonably be concluded and note that the documents cover it only incidentally — that is far more useful than describing the fragments you were given.

RESPONSE LENGTH & FORMAT — match the shape of your answer to the shape of the question:
- A specific factual question ("which page does X first appear on?") gets a short, direct answer — one or two sentences, no preamble, no restating the question.
- A question asking for a list, enumeration, or "all/every X" gets a structured bullet or numbered list of everything the context actually supports.
- A question asking to summarize or explain gets a fuller structured answer with headings or bullets where that actually helps readability.
- Never pad a simple answer to sound more thorough than it needs to be.
- Prefer compact bullet lists to wide markdown tables. A table spends much of a limited reply budget on formatting scaffolding instead of content, and a long one gets cut off part-way through. Put the item name in bold, then its detail after a dash.
- For a long enumeration, cover every item briefly rather than a few items richly — a complete short list beats a detailed list that stops halfway.

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
    top_k, similarity_threshold = _widen_for_query(query, top_k, similarity_threshold)
    # Embedding is CPU-bound ONNX work. Called directly it would block the event
    # loop for its whole duration, stalling every other request (including health
    # checks) — the same failure the ingest path already avoids via to_thread.
    query_vector = await asyncio.to_thread(embed_query, query)
    candidates = await vector_search(
        query_embedding=query_vector,
        top_k=top_k * _OVERFETCH_FACTOR,
        similarity_threshold=similarity_threshold,
        document_ids=document_ids
    )
    if not candidates:
        return "", []

    # Drop fragments too short to answer from. Documents indexed before the
    # chunker fix are full of these, and they outrank real passages on short
    # queries because a tiny chunk containing a name is almost purely "about"
    # that name. Fall back to the raw ranking when a document is legitimately
    # short and every chunk is below the bar.
    substantive = [c for c in candidates if len(c["content"]) >= settings.MIN_CONTEXT_CHARS]
    chunks = (substantive or candidates)[:top_k]

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
            max_completion_tokens=_answer_tokens_for_query(query),
            reasoning_effort="low",
            include_reasoning=False,
        )
        answer = completion.choices[0].message.content or ""
        if completion.choices[0].finish_reason == "length":
            answer += _TRUNCATION_NOTE
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
            max_completion_tokens=_answer_tokens_for_query(query),
            reasoning_effort="low",
            include_reasoning=False,
            stream=True
        )
        
        finish_reason: Optional[str] = None
        async for chunk in stream:
            if chunk.choices:
                if chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'event': 'token', 'token': token})}\n\n"
                if chunk.choices[0].finish_reason:
                    finish_reason = chunk.choices[0].finish_reason

        # Wide retrieval leaves only a small reply budget, so a long enumeration
        # can stop mid-sentence. Say so rather than letting it look like the
        # model simply had nothing more to add.
        if finish_reason == "length":
            yield f"data: {json.dumps({'event': 'token', 'token': _TRUNCATION_NOTE})}\n\n"

    except Exception as e:
        logger.error(f"Streaming error from Groq SDK: {e}")
        err_msg = _friendly_groq_error(e)
        yield f"data: {json.dumps({'event': 'token', 'token': err_msg})}\n\n"
        
    yield f"data: {json.dumps({'event': 'done'})}\n\n"
