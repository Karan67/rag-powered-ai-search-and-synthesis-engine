"use client";

import React, { useState, useRef, useEffect } from "react";
import { Plus, MessageSquare, Trash2, History, Pencil } from "lucide-react";
import { ChatSession, timeAgo } from "@/lib/chatHistory";

interface ChatHistorySidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
}) => {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const startEditing = (session: ChatSession) => {
    setEditingId(session.id);
    setEditValue(session.title);
  };

  const commitEdit = () => {
    if (editingId) {
      const trimmed = editValue.trim();
      if (trimmed) {
        onRenameSession(editingId, trimmed);
      }
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border w-64 shrink-0 select-none">
      <div className="flex items-center gap-2 p-4 pb-3 border-b border-border">
        <History className="w-5 h-5 text-accent-purple" />
        <h2 className="font-semibold text-slate-100 text-sm tracking-wide uppercase">Chat History</h2>
      </div>

      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white rounded-lg py-2 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {sorted.map((session) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingId === session.id;
          return (
            <div
              key={session.id}
              onClick={() => !isEditing && onSelectSession(session.id)}
              onDoubleClick={() => startEditing(session)}
              className={`group relative p-2.5 rounded-lg border transition-all ${
                isEditing ? "cursor-default" : "cursor-pointer"
              } ${
                isActive
                  ? "bg-primary-950/40 border-primary-500/80"
                  : "bg-surface-card/60 border-slate-800 hover:border-slate-700 hover:bg-surface-card"
              }`}
            >
              <div className="flex items-start gap-2 overflow-hidden pr-11">
                <MessageSquare
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isActive ? "text-primary-400" : "text-slate-500"}`}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      onBlur={commitEdit}
                      className="w-full bg-slate-950 border border-primary-500/60 rounded px-1.5 py-0.5 text-xs font-medium text-slate-100 focus:outline-none"
                    />
                  ) : (
                    <p className="text-xs font-medium text-slate-200 truncate">{session.title}</p>
                  )}
                  <p className="text-[10px] text-slate-500 mt-0.5">{timeAgo(session.updatedAt)}</p>
                </div>
              </div>

              {!isEditing && (
                <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(session);
                    }}
                    className="p-1 hover:bg-slate-800 hover:text-slate-200 text-slate-500 rounded transition-all"
                    title="Rename chat"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="p-1 hover:bg-rose-950/60 hover:text-rose-400 text-slate-500 rounded transition-all"
                    title="Delete chat"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
