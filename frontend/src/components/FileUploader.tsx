"use client";

import React, { useState, useRef } from "react";
import { Upload, FileText, Trash2, CheckCircle2, AlertCircle, Loader2, Database, ShieldCheck } from "lucide-react";
import { DocumentMeta, uploadDocument, deleteDocument } from "@/lib/api";

interface FileUploaderProps {
  documents: DocumentMeta[];
  onDocumentsChange: () => void;
  selectedDocIds: string[];
  onSelectDocIdsChange: (ids: string[]) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  documents,
  onDocumentsChange,
  selectedDocIds,
  onSelectDocIdsChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    setIsUploading(true);
    setUploadStatus(null);

    try {
      const res = await uploadDocument(file);
      setUploadStatus({ type: "success", msg: res.message });
      onDocumentsChange();
    } catch (err: any) {
      setUploadStatus({ type: "error", msg: err.message || "File ingestion failed." });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    try {
      await deleteDocument(docId);
      onDocumentsChange();
      onSelectDocIdsChange(selectedDocIds.filter(id => id !== docId));
    } catch (err: any) {
      alert("Failed to delete document: " + err.message);
    }
  };

  const toggleSelectDoc = (docId: string) => {
    if (selectedDocIds.includes(docId)) {
      onSelectDocIdsChange(selectedDocIds.filter(id => id !== docId));
    } else {
      onSelectDocIdsChange([...selectedDocIds, docId]);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border p-4 w-80 shrink-0 select-none">
      {/* Sidebar Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
        <Database className="w-5 h-5 text-accent-cyan" />
        <h2 className="font-semibold text-slate-100 text-sm tracking-wide uppercase">Document Index</h2>
      </div>

      {/* Drag & Drop Ingestion Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFileSelect(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 mb-4 ${
          isDragging
            ? "border-primary-500 bg-primary-500/10 shadow-glow-indigo"
            : "border-slate-700 hover:border-slate-500 bg-slate-900/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        
        {isUploading ? (
          <div className="flex flex-col items-center py-2">
            <Loader2 className="w-8 h-8 text-accent-purple animate-spin mb-2" />
            <p className="text-xs text-slate-300 font-medium">Ingesting & Indexing...</p>
            <p className="text-[10px] text-slate-500">Generating FastEmbed vectors</p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center py-1">
            <Upload className="w-7 h-7 text-primary-500 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-medium text-slate-200">
              Drop document or <span className="text-primary-500 underline">browse</span>
            </p>
            <p className="text-[10px] text-slate-500 mt-1">PDF, TXT, MD, DOCX (Up to 15MB)</p>
          </div>
        )}
      </div>

      {/* Status Feedback Alert */}
      {uploadStatus && (
        <div
          className={`p-2.5 rounded-lg text-xs mb-3 flex items-start gap-2 ${
            uploadStatus.type === "success"
              ? "bg-emerald-950/60 border border-emerald-800/80 text-emerald-300"
              : "bg-rose-950/60 border border-rose-800/80 text-rose-300"
          }`}
        >
          {uploadStatus.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="leading-snug">{uploadStatus.msg}</span>
        </div>
      )}

      {/* Filter Scope Control */}
      <div className="flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
        <span>Uploaded Files ({documents.length})</span>
        {selectedDocIds.length > 0 && (
          <button
            onClick={() => onSelectDocIdsChange([])}
            className="text-[11px] text-accent-cyan hover:underline"
          >
            Clear filter ({selectedDocIds.length})
          </button>
        )}
      </div>

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {documents.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-lg border border-slate-800/50 bg-slate-900/30">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">No documents ingested</p>
            <p className="text-[11px] text-slate-500 mt-1">Upload files above to begin context vector search</p>
          </div>
        ) : (
          documents.map((doc) => {
            const isSelected = selectedDocIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                onClick={() => toggleSelectDoc(doc.id)}
                className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-primary-950/40 border-primary-500/80 shadow-glow-indigo"
                    : "bg-surface-card/60 border-slate-800 hover:border-slate-700 hover:bg-surface-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 overflow-hidden">
                    <FileText className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? "text-primary-400" : "text-slate-400"}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                        <span className="bg-slate-800 px-1.5 py-0.5 rounded text-accent-cyan font-mono">
                          {doc.chunk_count} chunks
                        </span>
                        <span>{formatBytes(doc.file_size)}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, doc.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-950/60 hover:text-rose-400 text-slate-500 rounded transition-all"
                    title="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Embedding Info Footer */}
      <div className="mt-4 pt-3 border-t border-border/80 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-accent-emerald" />
          <span>FastEmbed BGE-Small (384d)</span>
        </div>
      </div>
    </div>
  );
};
