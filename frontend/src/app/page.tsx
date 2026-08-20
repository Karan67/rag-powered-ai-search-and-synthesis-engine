"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChatView } from "@/components/ChatView";
import { CitationDrawer } from "@/components/CitationDrawer";
import { UploadStatus } from "@/components/DocumentPanel";
import { Sidebar, SidebarTab } from "@/components/Sidebar";
import {
  Citation,
  DocumentMeta,
  Message,
  deleteDocument,
  fetchDocuments,
  uploadDocument,
} from "@/lib/api";
import {
  ChatSession,
  createSession,
  deriveTitle,
  loadSessions,
  saveSessions,
} from "@/lib/chatHistory";

export default function Home() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("chats");

  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout>>();

  // Restore chats from localStorage on first mount (client only).
  useEffect(() => {
    const stored = loadSessions();
    const initial = stored.length > 0 ? stored : [createSession()];
    setSessions(initial);
    setActiveSessionId(initial[0].id);
    setSidebarOpen(window.innerWidth >= 768);
    setHydrated(true);
  }, []);

  // Persist only after hydration, so the empty initial state never overwrites
  // real saved history.
  useEffect(() => {
    if (hydrated) saveSessions(sessions);
  }, [sessions, hydrated]);

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await fetchDocuments());
    } catch (err) {
      console.warn("Could not fetch documents (backend may still be starting):", err);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    const interval = setInterval(loadDocuments, 10000);
    return () => clearInterval(interval);
  }, [loadDocuments]);

  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const updateActiveMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const messages = updater(s.messages);
          const firstUserMsg = messages.find((m) => m.sender === "user");
          const title =
            s.title === "New chat" && firstUserMsg ? deriveTitle(firstUserMsg.text) : s.title;
          return { ...s, messages, title, updatedAt: Date.now() };
        })
      );
    },
    [activeSessionId]
  );

  const handleNewChat = () => {
    // Reuse the current chat if it is already blank rather than stacking up
    // identical empty entries in the sidebar.
    const current = sessions.find((s) => s.id === activeSessionId);
    if (current && current.messages.length === 0) return;
    const fresh = createSession();
    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    setSidebarTab("chats");
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (id === activeSessionId) setActiveSessionId(remaining[0].id);
      return remaining;
    });
  };

  const showStatus = (status: UploadStatus) => {
    clearTimeout(statusTimer.current);
    setUploadStatus(status);
    statusTimer.current = setTimeout(() => setUploadStatus(null), 8000);
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setUploadStatus(null);
    // Surface the document list so indexing progress is visible.
    setSidebarTab("files");
    setSidebarOpen(true);

    try {
      const res = await uploadDocument(file);
      showStatus({ type: "success", msg: res.message });
      loadDocuments();
    } catch (err) {
      showStatus({
        type: "error",
        msg: err instanceof Error ? err.message : "Upload failed.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteDocument(id);
      setSelectedDocIds((prev) => prev.filter((d) => d !== id));
      loadDocuments();
    } catch (err) {
      showStatus({
        type: "error",
        msg: err instanceof Error ? err.message : "Could not delete document.",
      });
    }
  };

  if (!hydrated || !activeSession) {
    return <main className="h-screen w-screen bg-white dark:bg-gray-900" />;
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-white dark:bg-gray-900">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tab={sidebarTab}
        onTabChange={setSidebarTab}
        sessions={sessions}
        activeSessionId={activeSession.id}
        onSelectSession={(id) => {
          setActiveSessionId(id);
          if (window.innerWidth < 768) setSidebarOpen(false);
        }}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={(id, title) =>
          setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
        }
        documents={documents}
        selectedDocIds={selectedDocIds}
        isUploading={isUploading}
        uploadStatus={uploadStatus}
        onUpload={handleUpload}
        onDeleteDocument={handleDeleteDocument}
        onSelectDocIdsChange={setSelectedDocIds}
      />

      <ChatView
        key={activeSession.id}
        title={activeSession.title}
        messages={activeSession.messages}
        onMessagesChange={updateActiveMessages}
        onSelectCitation={setActiveCitation}
        onNewChat={handleNewChat}
        sidebarOpen={sidebarOpen}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenFiles={() => {
          setSidebarOpen(true);
          setSidebarTab("files");
        }}
        documents={documents}
        selectedDocIds={selectedDocIds}
        onSelectDocIdsChange={setSelectedDocIds}
        isUploading={isUploading}
        onUpload={handleUpload}
      />

      <CitationDrawer citation={activeCitation} onClose={() => setActiveCitation(null)} />
    </main>
  );
}
