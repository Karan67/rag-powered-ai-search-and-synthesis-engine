"use client";

import React, { useRef, useState } from "react";
import { AlertCircle, Check, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { DocumentMeta } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

export interface UploadStatus {
  type: "success" | "error";
  msg: string;
}

interface DocumentPanelProps {
  documents: DocumentMeta[];
  selectedDocIds: string[];
  isUploading: boolean;
  uploadStatus: UploadStatus | null;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onSelectDocIdsChange: (ids: string[]) => void;
}

export const DocumentPanel: React.FC<DocumentPanelProps> = ({
  documents,
  selectedDocIds,
  isUploading,
  uploadStatus,
  onUpload,
  onDelete,
  onSelectDocIdsChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleDoc = (id: string) => {
    onSelectDocIdsChange(
      selectedDocIds.includes(id)
        ? selectedDocIds.filter((d) => d !== id)
        : [...selectedDocIds, id]
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onUpload(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "mb-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
          isDragging
            ? "border-gray-500 bg-gray-100 dark:bg-gray-850"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-100/60 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-850/60"
        )}
      >
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
        {isUploading ? (
          <>
            <Loader2 className="mb-2 h-5 w-5 animate-spin text-gray-500" />
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Indexing</p>
            <p className="mt-0.5 text-[11px] text-gray-500">Embedding and storing chunks</p>
          </>
        ) : (
          <>
            <Upload className="mb-2 h-5 w-5 text-gray-500" />
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Drop a file or <span className="underline underline-offset-2">browse</span>
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">PDF, DOCX, TXT, MD &middot; up to 15 MB</p>
          </>
        )}
      </div>

      {uploadStatus && (
        <div
          className={cn(
            "mb-3 flex animate-fade-in items-start gap-2 rounded-lg px-2.5 py-2 text-xs leading-snug",
            uploadStatus.type === "success"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          )}
        >
          {uploadStatus.type === "success" ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{uploadStatus.msg}</span>
        </div>
      )}

      <div className="mb-1.5 flex items-center justify-between px-1">
        <h3 className="text-[11px] font-medium text-gray-500">
          {documents.length} {documents.length === 1 ? "document" : "documents"}
        </h3>
        {selectedDocIds.length > 0 && (
          <button
            onClick={() => onSelectDocIdsChange([])}
            className="text-[11px] text-gray-500 underline underline-offset-2 transition-colors hover:text-gray-900 dark:hover:text-gray-200"
          >
            Clear filter
          </button>
        )}
      </div>

      <div className="-mr-1 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {documents.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-gray-500">
            Nothing indexed yet.
            <br />
            Upload a file to start asking questions.
          </p>
        ) : (
          documents.map((doc) => {
            const isSelected = selectedDocIds.includes(doc.id);
            const isConfirming = confirmDeleteId === doc.id;
            const isIndexing = doc.chunk_count === 0;

            return (
              <div
                key={doc.id}
                onClick={() => toggleDoc(doc.id)}
                title={doc.filename}
                className={cn(
                  "group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors",
                  isSelected
                    ? "bg-gray-100 dark:bg-gray-850"
                    : "hover:bg-gray-100 dark:hover:bg-gray-850/70"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected
                      ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                      : "border-gray-300 dark:border-gray-600"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>

                <FileText className="h-4 w-4 shrink-0 text-gray-500" />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                    {doc.filename}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                    {isIndexing ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> indexing
                      </span>
                    ) : (
                      <span>{doc.chunk_count} chunks</span>
                    )}
                    <span>&middot;</span>
                    <span>{formatBytes(doc.file_size)}</span>
                  </span>
                </span>

                {isConfirming ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(doc.id);
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
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(doc.id);
                    }}
                    title="Delete document"
                    className="icon-btn shrink-0 p-1 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
