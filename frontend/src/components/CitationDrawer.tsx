"use client";

import React from "react";
import { X, FileText, Bookmark, Percent } from "lucide-react";
import { Citation } from "@/lib/api";

interface CitationDrawerProps {
  citation: Citation | null;
  onClose: () => void;
}

export const CitationDrawer: React.FC<CitationDrawerProps> = ({ citation, onClose }) => {
  if (!citation) return null;

  const scorePercentage = Math.min(100, Math.round(citation.score * 100));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-surface border-l border-border h-full flex flex-col shadow-2xl animate-slide-left">
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary-500/20 border border-primary-500/50 flex items-center justify-center text-xs font-bold text-primary-400">
              [{citation.citation_index}]
            </span>
            <h3 className="font-semibold text-slate-100 text-sm">Source Citation Reference</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Metadata Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <FileText className="w-5 h-5 text-accent-cyan shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Document</p>
                <p className="text-sm font-medium text-slate-100 truncate">{citation.filename}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 block">Page Number</span>
                <span className="font-mono text-slate-300">
                  Page {citation.metadata?.page_number || 1}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Chunk Index</span>
                <span className="font-mono text-slate-300">#{citation.chunk_index}</span>
              </div>
            </div>

            {/* Relevance Score Bar */}
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <Percent className="w-3.5 h-3.5 text-accent-emerald" /> Cosine Similarity
                </span>
                <span className="font-mono font-bold text-accent-emerald">{scorePercentage}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-cyan to-accent-emerald rounded-full transition-all duration-500"
                  style={{ width: `${scorePercentage}%` }}
                />
              </div>
            </div>
          </div>

          {/* Snippet Context Card */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
              <Bookmark className="w-4 h-4 text-primary-400" />
              <span>Extracted Context Passage</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-200 text-xs font-mono leading-relaxed whitespace-pre-wrap selection:bg-primary-900">
              {citation.content_snippet}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-slate-900/60 text-center">
          <p className="text-[11px] text-slate-500">
            Vector matched via PostgreSQL <code className="text-accent-cyan">pgvector</code> HNSW Index
          </p>
        </div>
      </div>
    </div>
  );
};
