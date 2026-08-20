"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ChatSession } from "@/lib/chatHistory";
import { cn } from "@/lib/utils";

interface ChatListProps {
  sessions: ChatSession[];
  activeSessionId: string;
  query: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
}

const DAY = 86400000;

function groupLabel(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - DAY) return "Yesterday";
  if (ts >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (ts >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export const ChatList: React.FC<ChatListProps> = ({
  sessions,
  activeSessionId,
  query,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const q = query.trim().toLowerCase();
  const visible = sessions
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const grouped = GROUP_ORDER.map((label) => ({
    label,
    items: visible.filter((s) => groupLabel(s.updatedAt) === label),
  })).filter((g) => g.items.length > 0);

  const commitEdit = () => {
    if (editingId) {
      const trimmed = editValue.trim();
      if (trimmed) onRenameSession(editingId, trimmed);
    }
    setEditingId(null);
  };

  if (visible.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-gray-500">
        {q ? "No chats match that search." : "No chats yet."}
      </p>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      {grouped.map((group) => (
        <div key={group.label}>
          <h3 className="px-2.5 pb-1.5 text-[11px] font-medium text-gray-500">{group.label}</h3>
          <div className="space-y-0.5">
            {group.items.map((session) => {
              const isActive = session.id === activeSessionId;
              const isEditing = editingId === session.id;
              const isConfirming = confirmDeleteId === session.id;

              if (isEditing) {
                return (
                  <div
                    key={session.id}
                    className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 dark:bg-gray-850"
                  >
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="min-w-0 flex-1 bg-transparent py-1 text-sm text-gray-900 outline-none dark:text-gray-100"
                    />
                    <button onMouseDown={(e) => e.preventDefault()} onClick={commitEdit} className="icon-btn">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  onDoubleClick={() => {
                    setEditingId(session.id);
                    setEditValue(session.title);
                  }}
                  className={cn(
                    "group relative flex cursor-pointer items-center rounded-lg px-2.5 py-2 transition-colors",
                    isActive ? "bg-gray-100 dark:bg-gray-850" : "hover:bg-gray-100 dark:hover:bg-gray-850/70"
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 truncate pr-2 text-sm",
                      isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"
                    )}
                  >
                    {session.title}
                  </span>

                  {isConfirming ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                          setConfirmDeleteId(null);
                        }}
                        title="Confirm delete"
                        className="rounded p-1 text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        title="Cancel"
                        className="icon-btn p-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    // Absolutely positioned over the title with a matching gradient
                    // mask so long titles fade out under the buttons rather than
                    // colliding with them.
                    <span className="absolute right-1.5 flex items-center gap-0.5 bg-gradient-to-l from-gray-100 via-gray-100 pl-8 opacity-0 transition-opacity group-hover:opacity-100 dark:from-gray-850 dark:via-gray-850">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(session.id);
                          setEditValue(session.title);
                        }}
                        title="Rename"
                        className="icon-btn p-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(session.id);
                        }}
                        title="Delete"
                        className="icon-btn p-1 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
