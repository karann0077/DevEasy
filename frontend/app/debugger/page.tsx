"use client";
import { useState } from "react";
import { Loader2, GitCommit } from "lucide-react";

const LEFT_DIFF = [
  { text: "const db = new Postgres(" },
  { text: "  process.env.DATABASE_URL,", removed: true },
  { text: "  { max: 10 }", removed: true },
  { text: ");" },
];

const RIGHT_DIFF = [
  { text: "const db = new Postgres(" },
  { text: "  {", added: true },
  { text: "    host: process.env.DB_HOST,", added: true },
  { text: "    user: process.env.DB_USER,", added: true },
  { text: "    max: 10", added: true },
  { text: "  }", added: true },
  { text: ");" },
];

export default function DebuggerPage() {
  const [commitUrl, setCommitUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!commitUrl.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit_url: commitUrl }),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-5xl mx-auto">
        {/* Timeline / slider bar */}
        <div className="flex items-center gap-4 mb-6">
          <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg shrink-0">
            HEAD~1 (8f4b2a)
          </span>

          <div className="flex-1 relative h-2">
            <div className="absolute inset-0 bg-slate-800 rounded-full" />
            <div className="absolute left-0 right-1/2 top-0 bottom-0 bg-cyan-500/40 rounded-full" />
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-slate-900 shadow-lg" />
          </div>

          <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg shrink-0">
            Current (9c1d5e)
          </span>

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-semibold disabled:opacity-50 transition-all shrink-0"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <GitCommit size={15} />
            )}
            Analyze Regression
          </button>
        </div>

        {/* Commit URL input */}
        <div className="mb-6">
          <input
            type="url"
            value={commitUrl}
            onChange={(e) => setCommitUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleAnalyze()}
            placeholder="https://github.com/owner/repo/commit/abc123"
            className="w-full bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-all text-sm"
            disabled={loading}
          />
        </div>

        {/* AI Root Cause Analysis */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-orange-400 font-mono font-bold text-lg leading-none mt-0.5">&gt;_</div>
            <div>
              <h2 className="text-orange-400 font-bold text-base mb-2">AI Root Cause Analysis</h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                The recent commit altered the database connection string format from a URI to an object
                block. However, the{" "}
                <code className="bg-slate-800 text-cyan-300 px-1.5 py-0.5 rounded text-xs font-mono">
                  env-parser.js
                </code>{" "}
                middleware was not updated to handle object inputs, causing connection timeouts on
                initialization.
              </p>
            </div>
          </div>
        </div>

        {/* File label */}
        <div className="text-slate-500 text-xs font-mono uppercase tracking-widest mb-3">
          File: config/database.js
        </div>

        {/* Split diff viewer */}
        <div className="grid grid-cols-2 gap-4">
          {/* Left: Previous Working State */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
              <span className="text-slate-300 text-xs font-semibold">Previous Working State</span>
            </div>
            <div className="p-3 font-mono text-xs">
              {LEFT_DIFF.map((line, i) => (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded leading-5 ${
                    line.removed
                      ? "diff-remove text-red-300"
                      : "text-slate-400"
                  }`}
                >
                  {line.removed ? "- " : "  "}
                  {line.text}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Current Breaking State */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
              <span className="text-slate-300 text-xs font-semibold">Current Breaking State</span>
            </div>
            <div className="p-3 font-mono text-xs">
              {RIGHT_DIFF.map((line, i) => (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded leading-5 ${
                    line.added
                      ? "diff-add text-emerald-300"
                      : "text-slate-400"
                  }`}
                >
                  {line.added ? "+ " : "  "}
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
