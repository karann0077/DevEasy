"use client";
import { useState } from "react";
import { Loader2, GitCommit } from "lucide-react";

interface DiffLine {
  text: string;
  added?: boolean;
  removed?: boolean;
}

// Fallback static diffs shown before any analysis
const DEFAULT_LEFT_DIFF: DiffLine[] = [
  { text: "const db = new Postgres(" },
  { text: "  process.env.DATABASE_URL,", removed: true },
  { text: "  { max: 10 }", removed: true },
  { text: ");" },
];

const DEFAULT_RIGHT_DIFF: DiffLine[] = [
  { text: "const db = new Postgres(" },
  { text: "  {", added: true },
  { text: "    host: process.env.DB_HOST,", added: true },
  { text: "    user: process.env.DB_USER,", added: true },
  { text: "    max: 10", added: true },
  { text: "  }", added: true },
  { text: ");" },
];

function parseDiffToLines(diff: string): { left: DiffLine[]; right: DiffLine[] } {
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("-")) {
      left.push({ text: line.substring(1), removed: true });
    } else if (line.startsWith("+")) {
      right.push({ text: line.substring(1), added: true });
    } else {
      left.push({ text: line });
      right.push({ text: line });
    }
  }
  return { left, right };
}

export default function DebuggerPage() {
  const [commitUrl, setCommitUrl] = useState("");
  const [loading, setLoading] = useState(false);
  // FIX #7: Add state for API response data
  const [blastRadius, setBlastRadius] = useState<string[]>([]);
  const [prSummary, setPrSummary] = useState("");
  const [diffText, setDiffText] = useState("");
  const [analyzed, setAnalyzed] = useState(false);
  const [error, setError] = useState("");

  const handleAnalyze = async () => {
    if (!commitUrl.trim()) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit_url: commitUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = data?.detail;
        const msg = typeof detail === "string" ? detail : detail?.error || JSON.stringify(detail) || resp.statusText;
        throw new Error(msg);
      }
      // FIX #7: Actually read and store the response
      setBlastRadius(data.blast_radius || []);
      setPrSummary(data.pr_summary || "");
      setDiffText(data.diff || "");
      setAnalyzed(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Use parsed real diff if analyzed, otherwise show defaults
  const { left: leftDiff, right: rightDiff } = analyzed && diffText
    ? parseDiffToLines(diffText)
    : { left: DEFAULT_LEFT_DIFF, right: DEFAULT_RIGHT_DIFF };

  const analysisText = analyzed && prSummary
    ? prSummary
    : "The recent commit altered the database connection string format from a URI to an object block. However, the env-parser.js middleware was not updated to handle object inputs, causing connection timeouts on initialization.";

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-5xl mx-auto">
        {/* Timeline / slider bar */}
        <div className="flex items-center gap-4 mb-6">
          <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg shrink-0">
            HEAD~1
          </span>

          <div className="flex-1 relative h-2">
            <div className="absolute inset-0 bg-slate-800 rounded-full" />
            <div className="absolute left-0 right-1/2 top-0 bottom-0 bg-cyan-500/40 rounded-full" />
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-slate-900 shadow-lg" />
          </div>

          <span className="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg shrink-0">
            Current
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

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-red-400 text-sm"><strong>Error:</strong> {error}</p>
          </div>
        )}

        {/* Blast Radius */}
        {analyzed && blastRadius.length > 0 && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-6">
            <h2 className="text-cyan-400 font-bold text-base mb-2">Blast Radius ({blastRadius.length} files)</h2>
            <div className="flex flex-wrap gap-2">
              {blastRadius.map((file, i) => (
                <span key={i} className="bg-slate-800 text-slate-300 text-xs font-mono px-2 py-1 rounded">
                  {file}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI Root Cause Analysis */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-orange-400 font-mono font-bold text-lg leading-none mt-0.5">&gt;_</div>
            <div>
              <h2 className="text-orange-400 font-bold text-base mb-2">AI Root Cause Analysis</h2>
              <pre className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                {analysisText}
              </pre>
            </div>
          </div>
        </div>

        {/* Split diff viewer */}
        <div className="grid grid-cols-2 gap-4">
          {/* Left: Previous Working State */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/80">
              <span className="text-slate-300 text-xs font-semibold">Previous Working State</span>
            </div>
            <div className="p-3 font-mono text-xs max-h-96 overflow-auto">
              {leftDiff.map((line, i) => (
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
            <div className="p-3 font-mono text-xs max-h-96 overflow-auto">
              {rightDiff.map((line, i) => (
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
