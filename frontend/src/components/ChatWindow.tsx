"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Trash2, Cpu, ShieldCheck, HelpCircle } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { Citation, Message, streamQuery } from "@/lib/api";

interface ChatWindowProps {
  messages: Message[];
  onMessagesChange: (updater: (prev: Message[]) => Message[]) => void;
  selectedDocIds: string[];
  onSelectCitation: (citation: Citation) => void;
  documentCount: number;
}

const SAMPLE_PROMPTS = [
  "Summarize the key takeaways across all uploaded documents.",
  "Extract important metrics, statistics, or deadlines mentioned.",
  "What are the main risks or recommendations identified?",
];

export const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  onMessagesChange,
  selectedDocIds,
  onSelectCitation,
  documentCount,
}) => {
  const [inputQuery, setInputQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || isGenerating) return;

    const userMessageId = Date.now().toString();
    const userMsg: Message = {
      id: userMessageId,
      sender: "user",
      text: textToSend.trim(),
    };

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMessageId,
      sender: "assistant",
      text: "",
      citations: [],
      isStreaming: true,
    };

    onMessagesChange((prev) => [...prev, userMsg, assistantMsg]);
    if (!queryText) setInputQuery("");
    setIsGenerating(true);

    let streamedText = "";
    let receivedCitations: Citation[] = [];

    await streamQuery(
      textToSend.trim(),
      { document_ids: selectedDocIds },
      {
        onToken: (token) => {
          streamedText += token;
          onMessagesChange((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, text: streamedText }
                : msg
            )
          );
        },
        onCitations: (citations) => {
          receivedCitations = citations;
          onMessagesChange((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, citations: receivedCitations }
                : msg
            )
          );
        },
        onError: (err) => {
          streamedText += `\n\n[Error: ${err}]`;
          onMessagesChange((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, text: streamedText }
                : msg
            )
          );
        },
        onDone: () => {
          onMessagesChange((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, isStreaming: false }
                : msg
            )
          );
          setIsGenerating(false);
        },
      }
    );
  };

  const clearChat = () => {
    onMessagesChange(() => [
      {
        id: Date.now().toString(),
        sender: "assistant",
        text: "Chat history cleared. How can I assist you with your documents?",
      },
    ]);
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-background relative overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary-500/10 border border-primary-500/30 text-primary-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-slate-100 text-sm tracking-wide flex items-center gap-2">
              Enterprise RAG Synthesis Engine
              {selectedDocIds.length > 0 ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-cyan/10 border border-accent-cyan/40 text-accent-cyan">
                  {selectedDocIds.length} doc filter active
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  {documentCount} docs indexed
                </span>
              )}
            </h1>
            <p className="text-[11px] text-slate-400 flex items-center gap-2">
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3 text-accent-purple" /> Groq GPT-OSS-120B
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-accent-emerald" /> FastEmbed BGE (384d)
              </span>
            </p>
          </div>
        </div>

        <button
          onClick={clearChat}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
          title="Clear Conversation"
        >
          <Trash2 className="w-4 h-4" /> Clear
        </button>
      </div>

      {/* Message Feed Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onSelectCitation={onSelectCitation}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompt Chips */}
      {messages.length <= 2 && (
        <div className="px-6 pb-2">
          <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1">
            <HelpCircle className="w-3 h-3" /> Suggested Analysis Queries:
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt)}
                className="text-xs bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-slate-300 px-3 py-1.5 rounded-full transition-all text-left"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Input Control Bar */}
      <div className="p-4 border-t border-border bg-surface/50 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="relative flex items-center max-w-4xl mx-auto"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="Ask anything about your uploaded documents..."
            disabled={isGenerating}
            className="w-full bg-slate-900/90 border border-slate-700 focus:border-primary-500 rounded-xl px-4 py-3.5 pr-12 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isGenerating}
            className="absolute right-2 p-2 bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-all shadow-glow-indigo"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
