"use client";
import { useState } from "react";
import { Search, Code, Loader2, ChevronRight, FileCode, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";

const MOCK_FILES = [
  "src/main.py", "src/api/routes.py", "src/models/user.py",
  "src/services/auth.py", "frontend/components/App.tsx",
  "frontend/pages/index.tsx", "package.json", "requirements.txt",
];

export default function ExplorerPage() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState(MOCK_FILES[0]);

  const handleExplain = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query }) }
      );
      setAnswer(data.answer || "No explanation returned.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-indigo-500/10">
            <Code size={24} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">System-Aware Code Explorer</h1>
            <p className="text-slate-400 text-sm mt-1">RAG-powered explanations using your ingested codebase</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* File Tree */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileCode size={12} /> Repository Files
            </div>
            <div className="space-y-1">
              {MOCK_FILES.map((f) => (
                <button key={f} onClick={() => setSelectedFile(f)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                    selectedFile === f ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}>
                  <ChevronRight size={12} />
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Main Panel */}
          <div className="col-span-2 space-y-4">
            {/* Query Input */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <label className="text-slate-300 font-semibold text-sm mb-3 flex items-center gap-2">
                <Search size={14} className="text-indigo-400" />
                Ask about the codebase
              </label>
              <div className="flex gap-3 mt-3">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExplain()}
                  placeholder="e.g. Explain the authentication flow, How does the API route work?"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm"
                  disabled={loading}
                />
                <button onClick={handleExplain} disabled={loading || !query.trim()}
                  className="flex items-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold text-sm hover:from-indigo-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {loading ? "Thinking..." : "Explain with RAG"}
                </button>
              </div>
            </div>

            {/* Answer */}
            {(answer || loading || error) && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                <div className="text-slate-300 font-semibold text-sm mb-3 flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  AI Explanation
                </div>
                {loading && (
                  <div className="flex items-center gap-2 text-indigo-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Searching codebase and generating explanation...</span>
                  </div>
                )}
                {error && <div className="text-red-400 text-sm">❌ {error}</div>}
                {answer && (
                  <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-slate-950/50 rounded-lg p-4 max-h-96 overflow-y-auto">
                    {answer}
                  </div>
                )}
              </div>
            )}

            {!answer && !loading && !error && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
                <Sparkles size={32} className="text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">Ask a question above to get RAG-powered code explanations</p>
                <p className="text-slate-600 text-xs mt-2">Make sure you have ingested a repo first</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
