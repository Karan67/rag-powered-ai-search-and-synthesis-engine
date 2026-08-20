"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Citation, Message } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
  onSelectCitation: (citation: Citation) => void;
}

/* ------------------------------------------------------------------ */
/* Lightweight markdown                                                */
/* ------------------------------------------------------------------ */

// Some Groq reasoning models (gpt-oss in particular) inconsistently emit
// full-width brackets (fullwidth 1) instead of the ASCII [1] the prompt asks
// for, so both forms have to match or citation badges silently stop working.
const CITATION_SPLIT = /([\[【]\d+[\]】])/g;
const CITATION_MATCH = /^[\[【](\d+)[\]】]$/;
const INLINE_SPLIT = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function renderInline(
  text: string,
  citations: Citation[] | undefined,
  onSelectCitation: (citation: Citation) => void,
  keyPrefix: string
): React.ReactNode {
  // Citations are split off first so a bold span cannot swallow a badge.
  return text.split(CITATION_SPLIT).map((part, i) => {
    const key = `${keyPrefix}-c${i}`;
    const citeMatch = part.match(CITATION_MATCH);

    if (citeMatch) {
      const num = parseInt(citeMatch[1], 10);
      const citation = citations?.find((c) => c.citation_index === num);
      return (
        <button
          key={key}
          onClick={() => citation && onSelectCitation(citation)}
          disabled={!citation}
          title={citation ? `Source ${num}: ${citation.filename}` : `Source ${num}`}
          className="ml-0.5 mr-px inline-flex h-[17px] min-w-[17px] translate-y-[-1px] items-center justify-center rounded-full bg-gray-200 px-1 align-middle text-[10px] font-medium tabular-nums text-gray-600 transition-colors hover:bg-gray-900 hover:text-white disabled:cursor-default disabled:opacity-60 disabled:hover:bg-gray-200 disabled:hover:text-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-100 dark:hover:text-gray-900"
        >
          {num}
        </button>
      );
    }

    return (
      <React.Fragment key={key}>
        {part.split(INLINE_SPLIT).map((seg, j) => {
          const segKey = `${key}-s${j}`;
          if (!seg) return null;
          if (seg.startsWith("**") && seg.endsWith("**")) {
            return (
              <strong key={segKey} className="font-semibold text-gray-900 dark:text-gray-50">
                {seg.slice(2, -2)}
              </strong>
            );
          }
          if (seg.startsWith("`") && seg.endsWith("`") && seg.length > 2) {
            return (
              <code
                key={segKey}
                className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-800 dark:bg-gray-850 dark:text-gray-200"
              >
                {seg.slice(1, -1)}
              </code>
            );
          }
          if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
            return <em key={segKey}>{seg.slice(1, -1)}</em>;
          }
          return <React.Fragment key={segKey}>{seg}</React.Fragment>;
        })}
      </React.Fragment>
    );
  });
}

type ListItem = { text: string; ordered: boolean };

function renderMarkdown(
  content: string,
  citations: Citation[] | undefined,
  onSelectCitation: (citation: Citation) => void
): React.ReactNode {
  if (!content) return null;

  const blocks: React.ReactNode[] = [];
  let list: ListItem[] = [];
  let table: string[] = [];
  let fence: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    const ordered = list[0].ordered;
    const items = list.map((item, i) => (
      <li key={i} className="pl-1 marker:text-gray-400">
        {renderInline(item.text, citations, onSelectCitation, `li${key}-${i}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`ol${key++}`} className="my-2 list-decimal space-y-1.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`ul${key++}`} className="my-2 list-disc space-y-1.5 pl-5">
          {items}
        </ul>
      )
    );
    list = [];
  };

  const flushTable = () => {
    if (table.length === 0) return;
    const rows = table
      .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
      // Drop the |---|---| separator row.
      .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
    table = [];
    if (rows.length === 0) return;

    const [head, ...body] = rows;
    blocks.push(
      <div key={`tb${key++}`} className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th
                  key={i}
                  className="border-b border-gray-300 px-2 py-1.5 font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  {renderInline(cell, citations, onSelectCitation, `th${key}-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="border-b border-gray-100 px-2 py-1.5 align-top dark:border-gray-850"
                  >
                    {renderInline(cell, citations, onSelectCitation, `td${key}-${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const flushAll = () => {
    flushList();
    flushTable();
  };

  for (const line of content.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (fence === null) {
        flushAll();
        fence = [];
      } else {
        blocks.push(
          <pre
            key={`pre${key++}`}
            className="my-2.5 overflow-x-auto rounded-lg bg-gray-100 p-3 font-mono text-xs leading-relaxed text-gray-800 dark:bg-gray-850 dark:text-gray-200"
          >
            {fence.join("\n")}
          </pre>
        );
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2) {
      flushList();
      table.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push(
        <p
          key={`h${key++}`}
          className={cn(
            "mb-1 mt-3 font-semibold text-gray-900 first:mt-0 dark:text-gray-50",
            heading[1].length <= 2 ? "text-[15px]" : "text-sm"
          )}
        >
          {renderInline(heading[2], citations, onSelectCitation, `h${key}`)}
        </p>
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      flushTable();
      if (list.length > 0 && list[0].ordered) flushList();
      list.push({ text: bullet[1], ordered: false });
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushTable();
      if (list.length > 0 && !list[0].ordered) flushList();
      list.push({ text: numbered[1], ordered: true });
      continue;
    }

    flushAll();
    if (line.trim() === "") continue;

    blocks.push(
      <p key={`p${key++}`} className="my-2 first:mt-0 last:mb-0">
        {renderInline(line, citations, onSelectCitation, `p${key}`)}
      </p>
    );
  }

  flushAll();
  if (fence !== null && fence.length > 0) {
    // Unclosed fence, most likely because the answer is still streaming.
    blocks.push(
      <pre
        key={`pre${key++}`}
        className="my-2.5 overflow-x-auto rounded-lg bg-gray-100 p-3 font-mono text-xs leading-relaxed text-gray-800 dark:bg-gray-850 dark:text-gray-200"
      >
        {fence.join("\n")}
      </pre>
    );
  }

  return blocks;
}

/* ------------------------------------------------------------------ */

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin or denied permission) - no-op.
    }
  };

  return (
    <button onClick={copy} title={copied ? "Copied" : "Copy"} className="icon-btn p-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
};

const VISIBLE_SOURCES = 5;

const SourceList: React.FC<{
  citations: Citation[];
  onSelectCitation: (citation: Citation) => void;
}> = ({ citations, onSelectCitation }) => {
  const [expanded, setExpanded] = useState(false);
  // Broad and entity questions retrieve well over a dozen passages; showing
  // every chip pushes the answer itself off the screen.
  const shown = expanded ? citations : citations.slice(0, VISIBLE_SOURCES);
  const hidden = citations.length - shown.length;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-500">Sources</span>
      {shown.map((c) => (
        <button
          key={c.citation_index}
          onClick={() => onSelectCitation(c)}
          title={`${c.filename} - chunk ${c.chunk_index}`}
          className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-gray-200 py-1 pl-1.5 pr-2.5 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-850"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-[9px] font-medium tabular-nums dark:bg-gray-800">
            {c.citation_index}
          </span>
          <span className="truncate">{c.filename}</span>
        </button>
      ))}
      {(hidden > 0 || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-full px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-850 dark:hover:text-gray-100"
        >
          {expanded ? "Show fewer" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
};

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onSelectCitation }) => {
  if (message.sender === "user") {
    return (
      <div className="flex justify-end py-2.5">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl bg-gray-100 px-4 py-2.5 text-[15px] leading-6 text-gray-900 dark:bg-gray-850 dark:text-gray-100">
          {message.text}
        </div>
      </div>
    );
  }

  const waiting = message.isStreaming && !message.text;

  return (
    <div className="group flex gap-3 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">
        R
      </span>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[15px] leading-7 text-gray-800 dark:text-gray-200",
            message.isStreaming && message.text && "streaming"
          )}
        >
          {waiting ? (
            <span className="flex h-7 items-center gap-1">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          ) : (
            renderMarkdown(message.text, message.citations, onSelectCitation)
          )}
        </div>

        {message.citations && message.citations.length > 0 && !message.isStreaming && (
          <SourceList citations={message.citations} onSelectCitation={onSelectCitation} />
        )}

        {!message.isStreaming && message.text && (
          <div className="mt-1 -ml-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={message.text} />
          </div>
        )}
      </div>
    </div>
  );
};
