"use client";

import React, { useEffect } from "react";
import { FileText, X } from "lucide-react";
import { Citation } from "@/lib/api";

interface CitationDrawerProps {
  citation: Citation | null;
  onClose: () => void;
}

export const CitationDrawer: React.FC<CitationDrawerProps> = ({ citation, onClose }) => {
  useEffect(() => {
    if (!citation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [citation, onClose]);

  if (!citation) return null;

  const score = Math.min(100, Math.round(citation.score * 100));
  const page = citation.metadata?.page_number;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/30" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-md animate-slide-left flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-850 dark:bg-gray-900">
        <header className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] font-medium text-white dark:bg-gray-100 dark:text-gray-900">
              {citation.citation_index}
            </span>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Source</h2>
          </div>
          <button onClick={onClose} className="icon-btn" title="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 p-3.5 dark:bg-gray-850">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {citation.filename}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {page ? `Page ${page} · ` : ""}Chunk {citation.chunk_index}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-gray-500">Similarity</span>
              <span className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
                {score}%
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-850">
              <div
                className="h-full rounded-full bg-gray-900 transition-all duration-500 dark:bg-gray-100"
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          <h3 className="mb-2 mt-5 text-xs font-medium text-gray-500">Retrieved passage</h3>
          <blockquote className="whitespace-pre-wrap border-l-2 border-gray-200 pl-3.5 text-[13px] leading-relaxed text-gray-700 dark:border-gray-800 dark:text-gray-300">
            {citation.content_snippet}
          </blockquote>
        </div>

        <footer className="shrink-0 border-t border-gray-200 px-4 py-2.5 dark:border-gray-850">
          <p className="text-[11px] text-gray-500">
            Matched by cosine similarity over a pgvector HNSW index.
          </p>
        </footer>
      </aside>
    </div>
  );
};
