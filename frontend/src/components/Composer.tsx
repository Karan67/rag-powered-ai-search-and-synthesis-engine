"use client";

import React, { useEffect, useRef } from "react";
import { ArrowUp, Loader2, Paperclip, X } from "lucide-react";
import { DocumentMeta } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isGenerating: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void;
  documents: DocumentMeta[];
  selectedDocIds: string[];
  onSelectDocIdsChange: (ids: string[]) => void;
  autoFocus?: boolean;
}

const MAX_TEXTAREA_HEIGHT = 200;

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSubmit,
  isGenerating,
  isUploading,
  onUpload,
  documents,
  selectedDocIds,
  onSelectDocIdsChange,
  autoFocus,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Grow with content, then scroll internally once it hits the cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const selectedDocs = documents.filter((d) => selectedDocIds.includes(d.id));
  const canSend = value.trim().length > 0 && !isGenerating;

  return (
    <div className="mx-auto w-full max-w-chat">
      {selectedDocs.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-500">Only searching:</span>
          {selectedDocs.map((doc) => (
            <span
              key={doc.id}
              className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-gray-100 py-1 pl-2.5 pr-1 text-[11px] text-gray-700 dark:bg-gray-850 dark:text-gray-300"
            >
              <span className="truncate">{doc.filename}</span>
              <button
                onClick={() => onSelectDocIdsChange(selectedDocIds.filter((id) => id !== doc.id))}
                className="rounded-full p-0.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                title="Remove filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-3xl border border-gray-200 bg-gray-50 shadow-sm transition-colors focus-within:border-gray-300 dark:border-gray-800 dark:bg-gray-850 dark:focus-within:border-gray-700">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          placeholder="Ask anything about your documents"
          aria-label="Message"
          className="block w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100"
        />

        <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Upload a document"
              className="icon-btn rounded-full p-2 disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </button>
          </div>

          <button
            onClick={() => canSend && onSubmit()}
            disabled={!canSend}
            title={isGenerating ? "Generating" : "Send"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              canSend
                ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                : "cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-600"
            )}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>

      <p className="pt-2 text-center text-[11px] text-gray-500">
        Answers are generated from your uploaded documents. Check the citations.
      </p>
    </div>
  );
};
