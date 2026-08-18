import { Message } from "./api";

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "rag_chat_sessions";

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  sender: "assistant",
  text: "Welcome to the Enterprise RAG Engine! Upload PDF, TXT, MD, or DOCX files in the left panel and ask any question. Every answer will be synthesized with precise vector citations.",
};

export function createSession(): ChatSession {
  const now = Date.now();
  return {
    id: now.toString(),
    title: "New Chat",
    messages: [{ ...WELCOME_MESSAGE }],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed as ChatSession[];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage unavailable or over quota — history just won't persist across reloads
  }
}

export function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 42 ? trimmed.slice(0, 42) + "..." : trimmed;
}

export function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
