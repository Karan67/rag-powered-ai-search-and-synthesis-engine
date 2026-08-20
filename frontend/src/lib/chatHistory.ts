import { Message } from "./api";

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "rag_chat_sessions";

export function createSession(): ChatSession {
  const now = Date.now();
  return {
    id: now.toString(),
    title: "New chat",
    messages: [],
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
    // Sessions saved before the landing-screen redesign start with a canned
    // assistant greeting; drop it so those chats render like new ones.
    return (parsed as ChatSession[]).map((s) => ({
      ...s,
      messages: (s.messages ?? []).filter((m) => m.id !== "welcome"),
    }));
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage unavailable or over quota - history just will not persist.
  }
}

export function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > 42 ? trimmed.slice(0, 42) + "..." : trimmed;
}
