"use client";
import { useState, useRef, useEffect } from "react";
import {
  Search,
  Play,
  CheckCircle,
  Loader2,
  AlertTriangle,
  FileText,
} from "lucide-react";

export default function IngestPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Helper: ensure we always return an array of strings
  const normalizeToStrings = (candidate: unknown): string[] => {
    try {
      if (candidate === null || candidate === undefined) return [];
     if (Array.isArray(candidate.detail.logs))
  return candidate.detail.logs.map((x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)));
      if (typeof candidate === "string") return [candidate];
      if (typeof candidate === "object") {
        const obj = candidate as Record<string, unknown>;
        // common shape: { detail: { logs: [...] } } or { detail: "message" }
        if (obj.detail) {
          const detail = obj.detail as unknown;
          if (
            typeof detail === "object" &&
            detail !== null &&
            Array.isArray((detail as any).logs)
          ) {
            const arr = (detail as any).logs as unknown[];
            return arr.map((x: unknown): string =>
              typeof x === "string" ? x : JSON.stringify(x)
            );
          }
          if (typeof detail === "string") return [detail];
          return [JSON.stringify(detail)];
        }
        // fallback: stringify the object
        return [JSON.stringify(obj)];
      }
      return [String(candidate)];
    } catch (e) {
      return [`Error normalizing response: ${String(e)}`];
    }
  };

  const handleIngest = async () => {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setLogs([]);
    setStarted(true);

    const simulatedSteps = [
      "🔗 Connecting to GitHub API...",
      "⬇️  Downloading repository zip...",
      "📂 Extracting code files...",
      "✂️  Chunking code with RecursiveCharacterTextSplitter...",
      "🧠 Generating embeddings via Gemini text-embedding-004...",
      "📡 Upserting vectors to Pinecone (768 dimensions, cosine)...",
    ];

    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      if (stepIdx < simulatedSteps.length) {
        setLogs((prev) => [...prev, simulatedSteps[stepIdx]]);
        stepIdx++;
      }
    }, 800);

    try {
      const url = API_BASE ? `${API_BASE}/api/ingest` : "/api/ingest";

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      const contentType = (resp.headers.get("content-type") || "").toLowerCase();

      if (!resp.ok) {
        if (contentType.includes("application/json")) {
          let parsed: unknown;
          try {
            parsed = await resp.json();
          } catch (e) {
            setLogs([`❌ Server returned invalid JSON: ${String(e)}`]);
            return;
          }
          setLogs(normalizeToStrings(parsed));
        } else {
          const txt = await resp.text();
          setLogs([`❌ Server error: ${txt.slice(0, 4000)}`]);
        }
        return;
      }

      // OK path
      if (contentType.includes("application/json")) {
        let data: unknown;
        try {
          data = await resp.json();
        } catch (e) {
          setLogs([`✅ Ingest completed but response JSON parse failed: ${String(e)}`]);
          return;
        }
        const candidate = (data && typeof data === "object" && (data as any).logs) ? (data as any).logs : data;
        setLogs(normalizeToStrings(candidate));
      } else {
        const txt = await resp.text();
        setLogs([`✅ Ingest completed (non-JSON response): ${txt.slice(0, 4000)}`]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLogs((prev) => [...prev, `❌ Network error: ${msg}`]);
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-white mb-2">Repository Ingestion</h1>
          <p className="text-slate-400">
            Connect a codebase to map architecture, generate docs, and analyze complexity.
          </p>
        </div>

        {/* Input Row */}
        <div className="mb-6">
          <label className="block text-slate-300 font-medium mb-2 text-sm">
            Target Repository URL
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleIngest()}
                placeholder="https://github.com/innovatebharat/demo-core-api"
                className="w-full bg-slate-900/50 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-all"
                disabled={loading}
              />
            </div>
            <button
              onClick={handleIngest}
              disabled={loading || !repoUrl.trim()}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {loading ? "Ingesting..." : "Ingest Codebase"}
            </button>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Architecture Health */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={18} className="text-emerald-400" />
              <span className="text-slate-400 text-sm font-medium">Architecture Health</span>
            </div>
            <div className="text-white font-bold text-lg mb-1">Optimal</div>
            <div className="text-slate-500 text-xs">No cyclical dependencies detected</div>
          </div>

          {/* Optimization Hints */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-amber-400" />
              <span className="text-slate-400 text-sm font-medium">Optimization Hints</span>
            </div>
            <div className="text-white font-bold text-lg mb-1">4 Issues</div>
            <div className="text-slate-500 text-xs">Found 2 instances of O(N²) loops</div>
          </div>

          {/* Documentation */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={18} className="text-blue-400" />
              <span className="text-slate-400 text-sm font-medium">Documentation</span>
            </div>
            <div className="text-white font-bold text-lg mb-1">85% Sync</div>
            <div className="text-slate-500 text-xs">3 files need docstring updates</div>
          </div>
        </div>

        {/* Terminal Log Window */}
        {(started || loading) && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-slate-800">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-slate-400 text-xs font-mono">
                innovate-bharat — ingestion pipeline
              </span>
            </div>

            {/* Terminal body */}
            <div className="p-4 font-mono text-sm min-h-[200px] max-h-[400px] overflow-y-auto bg-slate-950/90">
              <div className="text-slate-400 mb-2">
                $ innovate-bharat ingest --repo &quot;{repoUrl}&quot;
              </div>
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`mb-1 leading-relaxed ${
                    log.startsWith("❌") || log.startsWith("ERROR")
                      ? "text-red-400"
                      : log.startsWith("✅") || log.startsWith("SUCCESS")
                      ? "text-emerald-400"
                      : log.startsWith("⚠️") || log.startsWith("WARNING")
                      ? "text-yellow-400"
                      : "text-slate-300"
                  }`}
                >
                  {log}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-cyan-400 mt-1">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Processing...</span>
                  <span className="terminal-cursor">_</span>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

