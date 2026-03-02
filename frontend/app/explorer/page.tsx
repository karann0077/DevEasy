"use client";
import { useState, useEffect, useRef } from "react";
import { Globe, Loader2, Send, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { simpleMarkdownToHtml } from "@/lib/markdown";

interface Message {
  role: "user" | "ai";
  content: string;
}

const PILLS = [
  "Extracting JSDoc from auth.ts...",
  "Mapping Prisma Schema...",
];

export default function ExplorerPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("synced_repo_url");
    setRepoUrl(stored);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleAsk = async () => {
    if (!query.trim() || loading) return;
    const userMsg = query.trim();
    setQuery("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: userMsg }) }
      );
      setMessages((prev) => [...prev, { role: "ai", content: data.answer || "No answer returned." }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#020617]">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-xl bg-cyan-500/10">
            <Globe size={24} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">Your Codebase, Demystified.</h1>
            <p className="text-slate-400 text-sm mt-0.5">Interact with your repository naturally.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {PILLS.map((p) => (
            <span key={p} className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs">
              {p}
            </span>
          ))}
        </div>
        {!repoUrl && (
          <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
            No repo synced yet — paste a GitHub URL and click &quot;Sync Repo&quot; in the header first.
          </div>
        )}
        {repoUrl && (
          <div className="mt-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800 text-slate-400 text-xs">
            Repo: <span className="text-cyan-400">{repoUrl}</span>
          </div>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-8 py-2 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Sparkles size={36} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm">Ask how the routing works, or where the DB schema is defined!</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[70%] px-4 py-3 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-indigo-600/20 border border-cyan-500/30 text-slate-100 text-sm">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[80%] px-4 py-3 rounded-2xl bg-slate-900/60 border border-slate-800">
                <div
                  className="prose-dark text-sm text-slate-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(msg.content) }}
                />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin text-cyan-400" />
              Thinking...
            </div>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            ❌ {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-8 py-4 shrink-0 border-t border-slate-800 bg-slate-950/50">
        <div className="flex gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            placeholder="Ask the AI anything about the synced codebase..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all text-sm"
            disabled={loading}
          />
          <button
            onClick={handleAsk}
            disabled={loading || !query.trim()}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-semibold text-sm hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Ask AI
          </button>
        </div>
      </div>
    </div>
  );
}
