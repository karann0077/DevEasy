"use client";
import { useState } from "react";
import {
  GitBranch,
  AlertTriangle,
  FileText,
  Loader2,
  Search,
  CheckCircle,
  XCircle,
} from "lucide-react";

const EXAMPLE_COMMITS = [
  "https://github.com/vercel/next.js/commit/abc1234",
  "https://github.com/tiangolo/fastapi/commit/def5678",
];

function DiffLine({ line }: { line: string }) {
  const isAdd = line.startsWith("+") && !line.startsWith("+++");
  const isRemove = line.startsWith("-") && !line.startsWith("---");
  const isHeader = line.startsWith("@@") || line.startsWith("diff") || line.startsWith("index");

  return (
    <div
      className={`font-mono text-xs px-3 py-0.5 ${
        isAdd
          ? "diff-add text-emerald-300"
          : isRemove
          ? "diff-remove text-red-300"
          : isHeader
          ? "text-cyan-400 bg-slate-900/50"
          : "diff-neutral"
      }`}
    >
      {line || " "}
    </div>
  );
}

function renderMarkdown(text: string) {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-indigo-400 font-bold text-sm mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-cyan-400 font-bold text-base mt-5 mb-2">$2</h2>'.replace("$2", "$1"))
    .replace(/^# (.+)$/gm, '<h1 class="text-white font-black text-lg mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-cyan-300 px-1 py-0.5 rounded text-xs">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-300 text-sm mb-1">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/⚠️/g, '<span class="text-yellow-400">⚠️</span>')
    .replace(/✅/g, '<span class="text-emerald-400">✅</span>')
    .replace(/📋/g, '<span class="text-blue-400">📋</span>')
    .replace(/🎯/g, '<span class="text-cyan-400">🎯</span>')
    .replace(/🏷️/g, '<span class="text-purple-400">🏷️</span>');
}

export default function DebuggerPage() {
  const [commitUrl, setCommitUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    blast_radius: string[];
    pr_summary: string;
    diff: string;
  } | null>(null);
  const [error, setError] = useState("");

  const handleDebug = async () => {
    if (!commitUrl.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const resp = await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit_url: commitUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || resp.statusText);
      setResult(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const diffLines = result?.diff?.split("\n") || [];

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <GitBranch size={24} className="text-emerald-400" />
            </div>
            <h1 className="text-3xl font-black text-white">Time-Travel Git Debugger</h1>
          </div>
          <p className="text-slate-400 ml-14">
            Analyze commits for blast radius and auto-generate PR summaries with AI.
          </p>
        </div>

        {/* Input */}
        <div className="glass rounded-2xl border border-slate-800 p-6 mb-6">
          <label className="block text-slate-300 font-semibold mb-3 flex items-center gap-2">
            <GitBranch size={16} className="text-emerald-400" />
            GitHub Commit URL
          </label>
          <div className="flex gap-3">
            <input
              type="url"
              value={commitUrl}
              onChange={(e) => setCommitUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleDebug()}
              placeholder="https://github.com/owner/repo/commit/abc123def456"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition-all"
              disabled={loading}
            />
            <button
              onClick={handleDebug}
              disabled={loading || !commitUrl.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-600 text-white font-semibold hover:from-emerald-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Search size={18} />
              )}
              {loading ? "Analyzing..." : "Analyze Commit"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-slate-500 text-xs py-1">Examples:</span>
            {EXAMPLE_COMMITS.map((url) => (
              <button
                key={url}
                onClick={() => setCommitUrl(url)}
                className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-emerald-400 transition-colors"
              >
                {url.replace("https://github.com/", "")}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-6">
            <XCircle size={20} className="text-red-400 shrink-0" />
            <div className="text-red-300 text-sm">{error}</div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="glass rounded-2xl border border-slate-800 p-12 flex flex-col items-center gap-4">
            <Loader2 size={40} className="animate-spin text-emerald-400" />
            <div className="text-slate-400 text-sm">Fetching commit diff + running RAG blast radius analysis...</div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left: Blast Radius + PR Summary */}
            <div className="flex flex-col gap-6">
              {/* Blast Radius */}
              <div className="glass rounded-2xl border border-yellow-500/20 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle size={18} className="text-yellow-400" />
                  <h3 className="text-white font-bold">Blast Radius Warning</h3>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                    {result.blast_radius.length} files at risk
                  </span>
                </div>

                {result.blast_radius.length === 0 ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle size={16} />
                    No indirect dependencies detected. Low blast radius.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {result.blast_radius.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-xs font-mono"
                      >
                        <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
                        {file}
                      </div>
                    ))}
                    <p className="text-slate-500 text-xs mt-2">
                      These files may be affected by the commit changes based on RAG dependency analysis.
                    </p>
                  </div>
                )}
              </div>

              {/* PR Summary */}
              <div className="glass rounded-2xl border border-indigo-500/20 p-5 flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <FileText size={18} className="text-indigo-400" />
                  <h3 className="text-white font-bold">Auto-Generated PR Summary</h3>
                </div>
                <div
                  className="prose-dark text-sm leading-relaxed overflow-y-auto max-h-80"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(result.pr_summary) }}
                />
              </div>
            </div>

            {/* Right: Git Diff Viewer */}
            <div className="glass rounded-2xl border border-slate-700 overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-slate-800">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-slate-400 text-xs font-mono ml-2">git diff</span>
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <span className="font-bold">+</span>
                    {diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length}
                  </span>
                  <span className="text-red-400 flex items-center gap-1">
                    <span className="font-bold">-</span>
                    {diffLines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-slate-950/90 py-2">
                {diffLines.length > 0 ? (
                  diffLines.map((line, i) => <DiffLine key={i} line={line} />)
                ) : (
                  <div className="p-8 text-center text-slate-600 text-sm">
                    No diff data available.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}