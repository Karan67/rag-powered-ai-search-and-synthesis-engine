import io
import re
from typing import Any
import pypdf
import docx
from app.config import settings

def extract_text_from_pdf(file_bytes: bytes) -> list[dict[str, Any]]:
    """
    Extracts text page by page from a PDF document.
    Returns list of page items with page_number and text.
    """
    pdf_reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    pages = []
    for idx, page in enumerate(pdf_reader.pages):
        text = page.extract_text() or ""
        # Clean extra whitespace / non-printable characters
        cleaned = re.sub(r'\s+', ' ', text).strip()
        if cleaned:
            pages.append({
                "page_number": idx + 1,
                "text": cleaned
            })
    return pages

def extract_text_from_docx(file_bytes: bytes) -> list[dict[str, Any]]:
    """
    Extracts text from a DOCX document.
    """
    doc = docx.Document(io.BytesIO(file_bytes))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    full_text = "\n\n".join(paragraphs)
    return [{"page_number": 1, "text": full_text}]

def extract_text_from_plain_text(file_bytes: bytes) -> list[dict[str, Any]]:
    """
    Extracts text from TXT or MD document.
    """
    decoded = file_bytes.decode("utf-8", errors="ignore")
    cleaned = decoded.strip()
    return [{"page_number": 1, "text": cleaned}]

def parse_document(file_bytes: bytes, filename: str, content_type: str) -> list[dict[str, Any]]:
    """
    Route document parsing based on file extension / content-type.
    """
    lower_filename = filename.lower()
    
    if lower_filename.endswith(".pdf") or "pdf" in content_type:
        return extract_text_from_pdf(file_bytes)
    elif lower_filename.endswith(".docx") or "officedocument" in content_type:
        return extract_text_from_docx(file_bytes)
    else: # Default text / md / unknown
        return extract_text_from_plain_text(file_bytes)

def _flatten_pages(pages: list[dict[str, Any]]) -> tuple[str, list[tuple[int, int]]]:
    """
    Join pages into one continuous stream, recording the offset each page starts
    at so a chunk can still report the page it came from.

    Chunking pages in isolation is what produced runt chunks: a page whose length
    is not a clean multiple of the stride emits a tiny leftover tail (e.g. 32
    chars), and prose that runs across a page break gets cut mid-sentence. Those
    fragments then dominate similarity search for short queries, because a
    32-character chunk containing a name is almost entirely "about" that name.
    """
    parts: list[str] = []
    offsets: list[tuple[int, int]] = []
    cursor = 0
    for page_info in pages:
        text = page_info["text"]
        if not text:
            continue
        offsets.append((cursor, page_info["page_number"]))
        parts.append(text)
        cursor += len(text) + 1  # +1 for the space joining pages
    return " ".join(parts), offsets


def _page_for_offset(offsets: list[tuple[int, int]], position: int) -> int:
    """Page number containing a character offset in the flattened stream."""
    page = offsets[0][1] if offsets else 1
    for start, page_number in offsets:
        if start > position:
            break
        page = page_number
    return page


def chunk_text_sliding_window(
    pages: list[dict[str, Any]],
    chunk_size: int = settings.CHUNK_SIZE,
    chunk_overlap: int = settings.CHUNK_OVERLAP,
    min_chunk_chars: int = settings.MIN_CHUNK_CHARS,
) -> list[dict[str, Any]]:
    """
    Creates overlapping text chunks with character position and page metadata.
    """
    text, offsets = _flatten_pages(pages)
    text_len = len(text)
    if text_len == 0:
        return []

    chunks: list[dict[str, Any]] = []
    start = 0

    while start < text_len:
        end = min(start + chunk_size, text_len)

        # Prefer a word boundary so chunks do not end mid-word.
        if end < text_len:
            last_space = text.rfind(" ", start + int(chunk_size * 0.7), end)
            if last_space != -1 and last_space > start:
                end = last_space

        content = text[start:end].strip()

        if content:
            # A trailing fragment too short to carry meaning is folded into the
            # previous chunk rather than stored as its own searchable record.
            if len(content) < min_chunk_chars and chunks:
                previous = chunks[-1]
                previous["content"] = f"{previous['content']} {content}".strip()
                previous["metadata"]["end_char"] = end
                previous["metadata"]["length"] = len(previous["content"])
            else:
                chunks.append({
                    "chunk_index": len(chunks),
                    "content": content,
                    "metadata": {
                        "page_number": _page_for_offset(offsets, start),
                        "start_char": start,
                        "end_char": end,
                        "length": len(content),
                    },
                })

        if end >= text_len:
            break

        # Step from where this chunk actually ended, not from a fixed stride —
        # otherwise a chunk shortened to a word boundary leaves a gap of dropped
        # text before the next one begins.
        start = max(end - chunk_overlap, start + 1)

    return chunks
