"use client";

import React, { useState, useEffect, useCallback } from "react";
import { FileUploader } from "@/components/FileUploader";
import { ChatWindow } from "@/components/ChatWindow";
import { CitationDrawer } from "@/components/CitationDrawer";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { DocumentMeta, Citation, Message, fetchDocuments } from "@/lib/api";
import { ChatSession, createSession, loadSessions, saveSessions, deriveTitle } from "@/lib/chatHistory";

export default function Home() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // Load saved chat sessions from localStorage on first mount (client-only).
  useEffect(() => {
    const stored = loadSessions();
    const initial = stored.length > 0 ? stored : [createSession()];
    setSessions(initial);
    setActiveSessionId(initial[0].id);
    setHydrated(true);
  }, []);

  // Persist sessions after hydration so we never overwrite storage with the
  // empty initial state on first render.
  useEffect(() => {
    if (hydrated) saveSessions(sessions);
  }, [sessions, hydrated]);

  const loadDocuments = async () => {
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
    } catch (err) {
      console.warn("Could not fetch documents (backend may still be starting):", err);
    }
  };

  useEffect(() => {
    loadDocuments();
    const interval = setInterval(loadDocuments, 10000);
    return () => clearInterval(interval);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const updateActiveMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const nextMessages = updater(s.messages);
          const firstUserMsg = nextMessages.find((m) => m.sender === "user");
          const nextTitle = s.title === "New Chat" && firstUserMsg ? deriveTitle(firstUserMsg.text) : s.title;
          return { ...s, messages: nextMessages, title: nextTitle, updatedAt: Date.now() };
        })
      );
    },
    [activeSessionId]
  );

  const handleNewChat = () => {
    const fresh = createSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s))
    );
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (id === activeSessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  if (!hydrated || !activeSession) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-background text-slate-500 text-sm">
        Loading...
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Document Ingestion & List Sidebar */}
      <FileUploader
        documents={documents}
        onDocumentsChange={loadDocuments}
        selectedDocIds={selectedDocIds}
        onSelectDocIdsChange={setSelectedDocIds}
      />

      {/* Chat History Sidebar */}
      <ChatHistorySidebar
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={setActiveSessionId}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />

      {/* Main RAG Interactive Chat Window */}
      <ChatWindow
        key={activeSession.id}
        messages={activeSession.messages}
        onMessagesChange={updateActiveMessages}
        selectedDocIds={selectedDocIds}
        onSelectCitation={(citation) => setActiveCitation(citation)}
        documentCount={documents.length}
      />

      {/* Slide-over Context & Citation Drawer */}
      <CitationDrawer
        citation={activeCitation}
        onClose={() => setActiveCitation(null)}
      />
    </main>
  );
}
