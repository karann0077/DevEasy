"use client";
import { useState } from "react";
import { GitBranch, AlertTriangle, FileText, Loader2, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function DebuggerPage() {
  const [commitUrl, setCommitUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blast_radius: string[]; pr_summary: string; diff: string } | null>(null);
  const [error, setError] = useState("");

  const handleDebug = async () => {
    if (!commitUrl.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await apiFetch<{ blast_radius: string[]; pr_summary: string; diff: string }>(
        "/api/debug",
        { method: "POST", body: JSON.stringify({ commit_url: commitUrl }) }
      );
      setResult(data);
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
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <GitBranch size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">Time-Travel Git Debugger</h1>
            <p className="text-slate-400 text-sm mt-1">Analyze commits for blast radius and auto-generate PR summaries</p>
          </div>
        </div>

        {/* Input */}
        <div className="rounded-2xl p-6 mb-6 border border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <label className="text-slate-300 font-semibold text-sm mb-3 flex items-center gap-2">
            <GitBranch size={14} className="text-emerald-400" />
            GitHub Commit URL
          </label>
          <div className="flex gap-3 mt-3">
            <input
              value={commitUrl}
              onChange={(e) => setCommitUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDebug()}
              placeholder="https://github.com/owner/repo/commit/abc123def"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm"
              disabled={loading}
            />
            <button onClick={handleDebug} disabled={loading || !commitUrl.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-600 text-white font-semibold text-sm hover:from-emerald-400 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {loading ? "Analyzing..." : "Analyze Commit"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {error}</div>
        )}

        {loading && (
          <div className="flex items-center gap-3 text-slate-400 p-4">
            <Loader2 size={18} className="animate-spin text-emerald-400" />
            <span>Fetching commit data and running blast radius analysis...</span>
          </div>
        )}

        {result && (
          <div className="grid grid-cols-2 gap-6">
            {/* Left: Blast Radius + PR Summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle size={18} className="text-orange-400" />
                  <span className="text-orange-400 font-bold">Blast Radius Warning</span>
                </div>
                <div className="space-y-2">
                  {result.blast_radius.length === 0 && (
                    <p className="text-slate-500 text-sm">No files changed detected.</p>
                  )}
                  {result.blast_radius.map((file) => (
                    <div key={file} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-2">
                      <FileText size={12} className="text-orange-400 shrink-0" />
                      <code className="font-mono text-xs">{file}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <FileText size={16} className="text-cyan-400" />
                  <span className="text-slate-300 font-bold text-sm">Auto-Generated PR Summary</span>
                </div>
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-slate-950/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                  {result.pr_summary}
                </div>
              </div>
            </div>

            {/* Right: Diff Viewer */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <GitBranch size={16} className="text-emerald-400" />
                <span className="text-slate-300 font-bold text-sm">Git Diff Viewer</span>
              </div>
              <div className="font-mono text-xs bg-slate-950/80 rounded-lg p-4 max-h-96 overflow-y-auto">
                {result.diff ? result.diff.split("\n").map((line, i) => (
                  <div key={i} className={`leading-relaxed ${
                    line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-400 bg-emerald-500/5"
                    : line.startsWith("-") && !line.startsWith("---") ? "text-red-400 bg-red-500/5"
                    : line.startsWith("@@") ? "text-cyan-400"
                    : line.startsWith("===") ? "text-slate-400 font-bold mt-2"
                    : "text-slate-400"
                  }`}>{line || " "}</div>
                )) : <span className="text-slate-500">No diff data available.</span>}
              </div>
            </div>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center">
            <GitBranch size={40} className="text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">Enter a GitHub commit URL above to analyze its blast radius</p>
            <p className="text-slate-600 text-xs mt-2">Example: https://github.com/vercel/next.js/commit/abc123</p>
          </div>
        )}
      </div>
    </div>
  );
}
