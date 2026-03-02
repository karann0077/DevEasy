"use client";
import { useState } from "react";
import { Bug, GitBranch, AlertTriangle, FileText, Loader2, Zap, Scissors } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { simpleMarkdownToHtml } from "@/lib/markdown";

export default function DebuggerPage() {
  // Log analysis
  const [logText, setLogText] = useState("");
  const [logResult, setLogResult] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState("");

  // Commit analysis
  const [commitUrl, setCommitUrl] = useState("");
  const [commitResult, setCommitResult] = useState<{ blast_radius: string[]; pr_summary: string; diff: string } | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState("");

  // Delta minimizer
  const [deltaTrace, setDeltaTrace] = useState("");
  const [deltaResult, setDeltaResult] = useState("");
  const [deltaLoading, setDeltaLoading] = useState(false);
  const [deltaError, setDeltaError] = useState("");

  const analyzeLog = async () => {
    if (!logText.trim() || logLoading) return;
    setLogLoading(true);
    setLogError("");
    setLogResult("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: `Analyze this runtime log/error trace and explain the root cause and how to fix it:\n\n${logText}` }) }
      );
      setLogResult(data.answer || "No analysis returned.");
    } catch (e: unknown) {
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogLoading(false);
    }
  };

  const analyzeCommit = async () => {
    if (!commitUrl.trim() || commitLoading) return;
    setCommitLoading(true);
    setCommitError("");
    setCommitResult(null);
    try {
      const data = await apiFetch<{ blast_radius: string[]; pr_summary: string; diff: string }>(
        "/api/debug",
        { method: "POST", body: JSON.stringify({ commit_url: commitUrl }) }
      );
      setCommitResult(data);
    } catch (e: unknown) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitLoading(false);
    }
  };

  const minimizeDelta = async () => {
    if (!deltaTrace.trim() || deltaLoading) return;
    setDeltaLoading(true);
    setDeltaError("");
    setDeltaResult("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: `Delta-minimize this error trace. Find the minimal reproduction case, identify the exact failing line, and suggest a fix:\n\n${deltaTrace}` }) }
      );
      setDeltaResult(data.answer || "No result returned.");
    } catch (e: unknown) {
      setDeltaError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeltaLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-xl bg-red-500/10">
            <Bug size={24} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">Debugging Hub</h1>
            <p className="text-slate-400 text-sm mt-1">Multimodal debug tool: log analysis, commit inspection, delta minimization</p>
          </div>
        </div>

        {/* Top row: Log analysis + Commit analysis */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Runtime Logs */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-white font-bold mb-3 flex items-center gap-2">
              <FileText size={16} className="text-orange-400" /> Runtime Logs
            </h2>
            <textarea
              value={logText}
              onChange={(e) => setLogText(e.target.value)}
              placeholder="Paste your runtime logs or error traces here..."
              rows={7}
              className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-orange-500 resize-none"
            />
            <button
              onClick={analyzeLog}
              disabled={logLoading || !logText.trim()}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-red-600 text-white text-sm font-semibold hover:from-orange-400 hover:to-red-500 disabled:opacity-50 transition-all"
            >
              {logLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {logLoading ? "Analyzing..." : "Analyze with AI"}
            </button>
            {logError && <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {logError}</div>}
            {logResult && (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4 max-h-48 overflow-y-auto">
                <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(logResult) }} />
              </div>
            )}
          </div>

          {/* Commit Analysis */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="text-white font-bold mb-3 flex items-center gap-2">
              <GitBranch size={16} className="text-emerald-400" /> Commit Analysis
            </h2>
            <input
              value={commitUrl}
              onChange={(e) => setCommitUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeCommit()}
              placeholder="https://github.com/owner/repo/commit/abc123"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition-all"
            />
            <button
              onClick={analyzeCommit}
              disabled={commitLoading || !commitUrl.trim()}
              className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-600 text-white text-sm font-semibold hover:from-emerald-400 hover:to-cyan-500 disabled:opacity-50 transition-all"
            >
              {commitLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {commitLoading ? "Analyzing..." : "Analyze Commit"}
            </button>
            {commitError && <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {commitError}</div>}
            {commitLoading && (
              <div className="mt-3 flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={14} className="animate-spin text-emerald-400" /> Fetching commit data...
              </div>
            )}
          </div>
        </div>

        {/* Commit result */}
        {commitResult && (
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={16} className="text-orange-400" />
                  <span className="text-orange-400 font-bold text-sm">Blast Radius</span>
                </div>
                {commitResult.blast_radius.length === 0 ? (
                  <p className="text-slate-500 text-sm">No files changed detected.</p>
                ) : (
                  <div className="space-y-1.5">
                    {commitResult.blast_radius.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 rounded-lg px-3 py-1.5">
                        <FileText size={12} className="text-orange-400 shrink-0" />
                        <code className="font-mono text-xs">{f}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={14} className="text-cyan-400" />
                  <span className="text-slate-300 font-bold text-sm">PR Summary</span>
                </div>
                <div className="prose-dark text-sm max-h-48 overflow-y-auto" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(commitResult.pr_summary) }} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={14} className="text-emerald-400" />
                <span className="text-slate-300 font-bold text-sm">Git Diff Viewer</span>
              </div>
              <div className="font-mono text-xs bg-slate-950/80 rounded-lg p-4 max-h-80 overflow-y-auto">
                {commitResult.diff ? commitResult.diff.split("\n").map((line, i) => (
                  <div key={i} className={`leading-relaxed ${
                    line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-400 bg-emerald-500/5"
                    : line.startsWith("-") && !line.startsWith("---") ? "text-red-400 bg-red-500/5"
                    : line.startsWith("@@") ? "text-cyan-400"
                    : "text-slate-400"
                  }`}>{line || " "}</div>
                )) : <span className="text-slate-500">No diff data available.</span>}
              </div>
            </div>
          </div>
        )}

        {/* Delta Minimizer */}
        <div className="rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5">
          <h2 className="text-white font-bold mb-3 flex items-center gap-2">
            <Scissors size={16} className="text-purple-400" /> Delta-Minimizer
            <span className="text-slate-500 font-normal text-sm">— paste a large error trace to find the minimal reproduction case</span>
          </h2>
          <textarea
            value={deltaTrace}
            onChange={(e) => setDeltaTrace(e.target.value)}
            placeholder="Paste a large error trace or stack dump here..."
            rows={5}
            className="w-full bg-slate-950/60 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-300 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-purple-500 resize-none"
          />
          <button
            onClick={minimizeDelta}
            disabled={deltaLoading || !deltaTrace.trim()}
            className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-sm font-semibold hover:from-purple-400 hover:to-indigo-500 disabled:opacity-50 transition-all"
          >
            {deltaLoading ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            {deltaLoading ? "Minimizing..." : "Minimize"}
          </button>
          {deltaError && <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {deltaError}</div>}
          {deltaResult && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4 max-h-48 overflow-y-auto">
              <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(deltaResult) }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
