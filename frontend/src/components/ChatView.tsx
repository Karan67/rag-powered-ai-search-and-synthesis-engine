"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, FileStack, PanelLeft, Plus, SquarePen } from "lucide-react";
import { Citation, DocumentMeta, Message, streamQuery } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";

interface ChatViewProps {
  title: string;
  messages: Message[];
  onMessagesChange: (updater: (prev: Message[]) => Message[]) => void;
  onSelectCitation: (citation: Citation) => void;
  onNewChat: () => void;

  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onOpenFiles: () => void;

  documents: DocumentMeta[];
  selectedDocIds: string[];
  onSelectDocIdsChange: (ids: string[]) => void;
  isUploading: boolean;
  onUpload: (file: File) => void;
}

const SUGGESTIONS = [
  { title: "Summarise", body: "Give me the key takeaways across my documents." },
  { title: "Find the numbers", body: "Pull out the important metrics, dates and deadlines." },
  { title: "Risks and caveats", body: "What risks, limitations or warnings are mentioned?" },
  { title: "Explain simply", body: "Explain the main argument in plain language." },
];

export const ChatView: React.FC<ChatViewProps> = ({
  title,
  messages,
  onMessagesChange,
  onSelectCitation,
  onNewChat,
  sidebarOpen,
  onOpenSidebar,
  onOpenFiles,
  documents,
  selectedDocIds,
  onSelectDocIdsChange,
  isUploading,
  onUpload,
}) => {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isEmpty = messages.length === 0;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Follow the stream only while the user is already parked at the bottom, so
  // scrolling up to re-read something does not get yanked back down.
  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [messages, atBottom, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const handleSend = async (queryText?: string) => {
    const text = (queryText ?? input).trim();
    if (!text || isGenerating) return;

    // Both ids come from one timestamp: reading Date.now() twice can land on
    // the same millisecond and collide, which duplicates React keys.
    const stamp = Date.now();
    const assistantId = `${stamp}-a`;

    onMessagesChange((prev) => [
      ...prev,
      { id: `${stamp}-u`, sender: "user", text },
      { id: assistantId, sender: "assistant", text: "", citations: [], isStreaming: true },
    ]);

    if (!queryText) setInput("");
    setIsGenerating(true);
    setAtBottom(true);

    let streamed = "";
    const patch = (fields: Partial<Message>) =>
      onMessagesChange((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, ...fields } : m))
      );

    await streamQuery(
      text,
      { document_ids: selectedDocIds },
      {
        onToken: (token) => {
          streamed += token;
          patch({ text: streamed });
        },
        onCitations: (citations) => patch({ citations }),
        onError: (err) => {
          streamed += `\n\n${err}`;
          patch({ text: streamed });
        },
        onDone: () => {
          patch({ isStreaming: false });
          setIsGenerating(false);
        },
      }
    );
  };

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSubmit={() => handleSend()}
      isGenerating={isGenerating}
      isUploading={isUploading}
      onUpload={onUpload}
      documents={documents}
      selectedDocIds={selectedDocIds}
      onSelectDocIdsChange={onSelectDocIdsChange}
      autoFocus={isEmpty}
    />
  );

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {!sidebarOpen && (
            <>
              <button onClick={onOpenSidebar} className="icon-btn" title="Open sidebar">
                <PanelLeft className="h-[18px] w-[18px]" />
              </button>
              <button onClick={onNewChat} className="icon-btn" title="New chat">
                <SquarePen className="h-[18px] w-[18px]" />
              </button>
            </>
          )}
          <span className="truncate px-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            {isEmpty ? "New chat" : title}
          </span>
        </div>

        <button
          onClick={onOpenFiles}
          title="Manage documents"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
            selectedDocIds.length > 0
              ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-850 dark:hover:text-gray-100"
          )}
        >
          <FileStack className="h-3.5 w-3.5" />
          {selectedDocIds.length > 0
            ? `${selectedDocIds.length} of ${documents.length} selected`
            : `${documents.length} indexed`}
        </button>
      </header>

      {isEmpty ? (
        /* Landing state: composer sits in the middle of the canvas. */
        <div className="flex flex-1 flex-col justify-center overflow-y-auto px-4 pb-16">
          <div className="mx-auto w-full max-w-chat animate-fade-up">
            <h1 className="mb-7 text-center text-[26px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
              {documents.length === 0
                ? "Add a document to get started"
                : "What do you want to know?"}
            </h1>

            {composer}

            {documents.length === 0 ? (
              <button
                onClick={onOpenFiles}
                className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-gray-200 px-3.5 py-2 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-850"
              >
                <Plus className="h-3.5 w-3.5" />
                Upload a PDF, DOCX, TXT or MD file
              </button>
            ) : (
              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => handleSend(s.body)}
                    className="rounded-xl border border-gray-200 px-3.5 py-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-850"
                  >
                    <span className="block text-xs font-medium text-gray-900 dark:text-gray-100">
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                      {s.body}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-chat px-4 pb-6 pt-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onSelectCitation={onSelectCitation} />
              ))}
            </div>
          </div>

          <div className="relative shrink-0 px-4 pb-3">
            {!atBottom && (
              <button
                onClick={() => scrollToBottom(true)}
                title="Scroll to latest"
                className="absolute -top-11 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-850 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            )}
            {composer}
          </div>
        </>
      )}
    </div>
  );
};
