"use client";

import React from "react";
import { User, Bot, FileSearch } from "lucide-react";
import { Citation, Message } from "@/lib/api";

interface MessageBubbleProps {
  message: Message;
  onSelectCitation: (citation: Citation) => void;
}

// Renders a single line of text: citation markers become clickable badges,
// **bold** spans become <strong>. Order matters — citations are split first
// so a "**...[1]"** span can't accidentally swallow the badge.
function renderInline(
  text: string,
  citations: Citation[] | undefined,
  onSelectCitation: (citation: Citation) => void,
  keyPrefix: string
): React.ReactNode {
  // Some Groq reasoning models (e.g. gpt-oss) inconsistently emit full-width
  // brackets (【1】) instead of the ASCII [1] the prompt asks for — match both
  // so citation badges don't silently stop working depending on model mood.
  const citationParts = text.split(/([\[【]\d+[\]】])/g);

  return citationParts.map((part, i) => {
    const key = `${keyPrefix}-c${i}`;
    const citeMatch = part.match(/^[\[【](\d+)[\]】]$/);

    if (citeMatch && citations && citations.length > 0) {
      const citationNum = parseInt(citeMatch[1], 10);
      const matchingCitation = citations.find((c) => c.citation_index === citationNum);

      return (
        <button
          key={key}
          onClick={() => matchingCitation && onSelectCitation(matchingCitation)}
          disabled={!matchingCitation}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-bold font-mono bg-primary-900/60 border border-primary-500/60 text-primary-300 hover:bg-primary-600 hover:text-white transition-all transform hover:scale-105"
          title={matchingCitation ? `View Citation [${citationNum}]: ${matchingCitation.filename}` : `Citation [${citationNum}]`}
        >
          [{citationNum}]
        </button>
      );
    }

    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={key}>
        {boldParts.map((seg, j) => {
          const boldMatch = seg.match(/^\*\*([^*]+)\*\*$/);
          if (boldMatch) {
            return (
              <strong key={`${key}-b${j}`} className="font-semibold text-slate-50">
                {boldMatch[1]}
              </strong>
            );
          }
          return seg ? <React.Fragment key={`${key}-b${j}`}>{seg}</React.Fragment> : null;
        })}
      </React.Fragment>
    );
  });
}

// Splits the full message into block-level pieces (paragraphs vs. "- " bullet
// lists) then renders each line's inline content (bold + citations).
function renderFormattedText(
  content: string,
  citations: Citation[] | undefined,
  onSelectCitation: (citation: Citation) => void
): React.ReactNode {
  if (!content) return null;

  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let currentList: string[] = [];
  let blockIdx = 0;

  const flushList = () => {
    if (currentList.length === 0) return;
    blocks.push(
      <ul key={`ul-${blockIdx++}`} className="list-disc list-outside pl-4 space-y-1 my-1.5">
        {currentList.map((item, idx) => (
          <li key={idx}>{renderInline(item, citations, onSelectCitation, `li-${blockIdx}-${idx}`)}</li>
        ))}
      </ul>
    );
    currentList = [];
  };

  lines.forEach((line) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      return;
    }
    flushList();
    if (line.trim() === "") {
      blocks.push(<div key={`sp-${blockIdx++}`} className="h-2" />);
    } else {
      blocks.push(
        <p key={`p-${blockIdx++}`} className="leading-relaxed">
          {renderInline(line, citations, onSelectCitation, `p-${blockIdx}`)}
        </p>
      );
    }
  });
  flushList();

  return blocks;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onSelectCitation }) => {
  const isUser = message.sender === "user";

  return (
    <div className={`flex gap-3 my-4 max-w-4xl ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
      {/* Sender Avatar */}
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${
          isUser
            ? "bg-gradient-to-br from-primary-600 to-primary-800 text-white"
            : "bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 text-accent-cyan"
        }`}
      >
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      {/* Message Box */}
      <div className={`flex flex-col max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`p-4 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-primary-600 text-white rounded-tr-none shadow-glow-indigo"
              : "bg-surface-card border border-slate-800 text-slate-100 rounded-tl-none shadow-md"
          }`}
        >
          <div className="font-sans">
            {isUser ? message.text : renderFormattedText(message.text, message.citations, onSelectCitation)}
            {message.isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-accent-cyan animate-pulse align-middle" />
            )}
          </div>
        </div>

        {/* Source Citations Pill Footer */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2 px-1">
            <span className="text-[10px] text-slate-500 flex items-center gap-1 font-medium">
              <FileSearch className="w-3 h-3 text-accent-cyan" /> Sources ({message.citations.length}):
            </span>
            {message.citations.map((c) => (
              <button
                key={c.citation_index}
                onClick={() => onSelectCitation(c)}
                className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white transition-colors"
              >
                [{c.citation_index}] {c.filename.length > 18 ? c.filename.slice(0, 15) + "..." : c.filename}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
