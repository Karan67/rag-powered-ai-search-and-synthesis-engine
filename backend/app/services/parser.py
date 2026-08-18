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

def chunk_text_sliding_window(
    pages: list[dict[str, Any]],
    chunk_size: int = settings.CHUNK_SIZE,
    chunk_overlap: int = settings.CHUNK_OVERLAP
) -> list[dict[str, Any]]:
    """
    Creates overlapping text chunks with character position and page metadata.
    """
    chunks = []
    global_chunk_idx = 0
    
    for page_info in pages:
        text = page_info["text"]
        page_num = page_info["page_number"]
        
        if not text:
            continue
            
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = min(start + chunk_size, text_len)
            
            # If not at the end of string, try to break at space or newline boundary
            if end < text_len:
                last_space = text.rfind(' ', start + int(chunk_size * 0.7), end)
                if last_space != -1 and last_space > start:
                    end = last_space
                    
            chunk_content = text[start:end].strip()
            
            if chunk_content:
                chunks.append({
                    "chunk_index": global_chunk_idx,
                    "content": chunk_content,
                    "metadata": {
                        "page_number": page_num,
                        "start_char": start,
                        "end_char": end,
                        "length": len(chunk_content)
                    }
                })
                global_chunk_idx += 1
                
            start += (chunk_size - chunk_overlap)
            if start >= text_len:
                break
                
    return chunks
