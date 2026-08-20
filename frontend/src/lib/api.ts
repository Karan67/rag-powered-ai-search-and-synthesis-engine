export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

// fetch() rejects with a bare "Failed to fetch" for both a down backend and a
// CORS rejection, which tells the user nothing. Name both causes instead.
const NETWORK_ERROR = `Cannot reach the API at ${API_BASE_URL}. Check that the backend is running, and that this page origin is listed in the backend CORS_ORIGINS setting.`;

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}

export interface DocumentMeta {
  id: string;
  filename: string;
  content_type: string;
  file_size: number;
  chunk_count: number;
  created_at: string;
}

export interface Citation {
  citation_index: number;
  document_id: string;
  filename: string;
  chunk_index: number;
  score: number;
  content_snippet: string;
  metadata: {
    page_number?: number;
    start_char?: number;
    end_char?: number;
    [key: string]: any;
  };
}

export interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  citations?: Citation[];
  isStreaming?: boolean;
}

export interface QueryRequestOptions {
  top_k?: number;
  similarity_threshold?: number;
  document_ids?: string[];
}

export async function uploadDocument(file: File): Promise<{ message: string; document: DocumentMeta }> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await apiFetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(errData.detail || "Failed to upload document");
  }

  return res.json();
}

export async function fetchDocuments(): Promise<DocumentMeta[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/documents`);
  if (!res.ok) {
    throw new Error("Failed to fetch document index");
  }
  return res.json();
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/documents/${docId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to delete document");
  }
}

export async function streamQuery(
  query: string,
  options: QueryRequestOptions = {},
  callbacks: {
    onToken: (token: string) => void;
    onCitations: (citations: Citation[]) => void;
    onError: (err: string) => void;
    onDone: () => void;
  }
): Promise<void> {
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/query/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        top_k: options.top_k || 5,
        similarity_threshold: options.similarity_threshold || 0.3,
        document_ids: options.document_ids && options.document_ids.length > 0 ? options.document_ids : null,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      callbacks.onError(`HTTP Error ${response.status}: ${errText}`);
      callbacks.onDone();
      return;
    }

    if (!response.body) {
      callbacks.onError("No response body received for streaming.");
      callbacks.onDone();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || ""; // keep incomplete tail in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);
            if (data.event === "citations" && data.citations) {
              callbacks.onCitations(data.citations);
            } else if (data.event === "token" && data.token !== undefined) {
              callbacks.onToken(data.token);
            } else if (data.event === "done") {
              callbacks.onDone();
              return;
            }
          } catch (e) {
            console.warn("Failed to parse SSE payload line:", jsonStr);
          }
        }
      }
    }

    callbacks.onDone();
  } catch (err: any) {
    callbacks.onError(err.message || "Network error during SSE stream connection.");
    callbacks.onDone();
  }
}
