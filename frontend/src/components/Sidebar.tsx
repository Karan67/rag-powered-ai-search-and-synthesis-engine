"use client";

import React from "react";
import { Github, PanelLeftClose, Plus, Search } from "lucide-react";
import { ChatSession } from "@/lib/chatHistory";
import { DocumentMeta, IngestJob } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChatList } from "./ChatList";
import { DocumentPanel, UploadStatus } from "./DocumentPanel";
import { ThemeToggle } from "./ThemeToggle";

export type SidebarTab = "chats" | "files";

const REPO_URL = "https://github.com/Karan67/rag-powered-ai-search-and-synthesis-engine";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;

  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;

  documents: DocumentMeta[];
  selectedDocIds: string[];
  isUploading: boolean;
  uploadStatus: UploadStatus | null;
  jobs: IngestJob[];
  onDismissJob: (id: string) => void;
  onUpload: (file: File) => void;
  onDeleteDocument: (id: string) => void;
  onSelectDocIdsChange: (ids: string[]) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  open,
  onClose,
  tab,
  onTabChange,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  documents,
  selectedDocIds,
  isUploading,
  uploadStatus,
  jobs,
  onDismissJob,
  onUpload,
  onDeleteDocument,
  onSelectDocIdsChange,
}) => {
  const [search, setSearch] = React.useState("");

  return (
    <>
      {/* Scrim: only meaningful below md, where the sidebar overlays the chat. */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 animate-fade-in md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 shrink-0 overflow-hidden bg-gray-50 transition-[width,transform] duration-200 ease-out dark:bg-gray-950 md:relative md:z-auto md:translate-x-0",
          open ? "w-[260px] translate-x-0" : "w-[260px] -translate-x-full md:w-0"
        )}
      >
        <div className="flex h-full w-[260px] flex-col">
          {/* Brand */}
          <div className="flex items-center justify-between px-3 pb-1 pt-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-900 text-[11px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">
                R
              </span>
              <span className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                RAG Engine
              </span>
            </div>
            <button onClick={onClose} className="icon-btn" title="Close sidebar">
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* New chat */}
          <div className="px-3 pt-2">
            <button
              onClick={onNewChat}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-200/70 dark:text-gray-200 dark:hover:bg-gray-850"
            >
              <Plus className="h-4 w-4" />
              New chat
            </button>
          </div>

          {/* Tabs */}
          <div className="px-3 pt-3">
            <div className="flex rounded-lg bg-gray-200/60 p-0.5 dark:bg-gray-900">
              {(
                [
                  ["chats", "Chats", sessions.length],
                  ["files", "Files", documents.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => onTabChange(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-xs font-medium transition-colors",
                    tab === key
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-850 dark:text-gray-100"
                      : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] tabular-nums",
                      tab === key
                        ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        : "text-gray-500"
                    )}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Panel body */}
          <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
            {tab === "chats" ? (
              <>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search chats"
                    className="w-full rounded-lg bg-gray-200/50 py-1.5 pl-8 pr-2.5 text-xs text-gray-900 outline-none transition-colors placeholder:text-gray-500 focus:bg-gray-200 dark:bg-gray-900 dark:text-gray-100 dark:focus:bg-gray-850"
                  />
                </div>
                <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
                  <ChatList
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    query={search}
                    onSelectSession={onSelectSession}
                    onDeleteSession={onDeleteSession}
                    onRenameSession={onRenameSession}
                  />
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1">
                <DocumentPanel
                  documents={documents}
                  selectedDocIds={selectedDocIds}
                  isUploading={isUploading}
                  uploadStatus={uploadStatus}
                  jobs={jobs}
                  onDismissJob={onDismissJob}
                  onUpload={onUpload}
                  onDelete={onDeleteDocument}
                  onSelectDocIdsChange={onSelectDocIdsChange}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-850">
            <ThemeToggle />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="View the source on GitHub"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-850 dark:hover:text-gray-100"
            >
              <Github className="h-4 w-4 shrink-0" />
              <span>Source on GitHub</span>
            </a>
            <p className="px-2.5 pb-1 pt-1 text-[10px] leading-relaxed text-gray-500">
              gpt-oss-120b on Groq
              <br />
              bge-small-en-v1.5 &middot; 384d &middot; pgvector
            </p>
          </div>
        </div>
      </aside>
    </>
  );
};
