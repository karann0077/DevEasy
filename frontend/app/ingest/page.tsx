"use client";
import { useState, useRef, useEffect } from "react";
import { Terminal, Play, Github, CheckCircle, XCircle, Loader2, Database, Zap } from "lucide-react";
import { apiFetch, getApiBaseUrl } from "@/lib/api";

const EXAMPLE_REPOS = [
  "https://github.com/tiangolo/fastapi",
  "https://github.com/pallets/flask",
  "https://github.com/karann0077/collaboard",
];

export default function IngestPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [chunksIngested, setChunksIngested] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (msg: string) => setLogs((p) => [...p, msg]);

  const handleIngest = async () => {
    if (!repoUrl.trim() || loading) return;
    setLoading(true);
    setLogs([]);
    setStatus("idle");
    setChunksIngested(0);

    const apiBase = getApiBaseUrl();
    addLog(`➡️ Connecting to backend: ${apiBase}`);

    // Simulated progress logs while backend works
    const steps = [
      "🔗 Connecting to GitHub API...",
      "⬇️  Downloading repository zip...",
      "📂 Extracting code files...",
      "✂️  Chunking with RecursiveCharacterTextSplitter...",
      "🧠 Generating 3072-dim embeddings via Gemini...",
      "📡 Upserting vectors to Pinecone...",
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) { addLog(steps[i]); i++; }
    }, 1500);

    try {
      const data = await apiFetch<{ status: string; logs: string[]; chunks_ingested: number }>(
        "/api/ingest",
        { method: "POST", body: JSON.stringify({ repo_url: repoUrl }) },
        180_000 // 3 min timeout for large repos
      );
      clearInterval(interval);
      setLogs(data.logs || ["✅ Done"]);
      setChunksIngested(data.chunks_ingested || 0);
      setStatus("success");
    } catch (e: unknown) {
      clearInterval(interval);
      const msg = e instanceof Error ? e.message : String(e);
      // Try to parse FastAPI error detail
      let displayMsg = msg;
      try {
        const parsed = JSON.parse(msg);
        if (parsed.detail?.logs) {
          setLogs(parsed.detail.logs);
          setStatus("error");
          setLoading(false);
          return;
        }
        displayMsg = parsed.detail || msg;
      } catch { /* msg is plain string */ }
      setLogs((p) => [...p, `❌ ${displayMsg}`]);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Terminal size={24} className="text-cyan-400" />
            </div>
            <h1 className="text-3xl font-black text-white">Zero-Setup Codebase Ingestion</h1>
          </div>
          <p className="text-slate-400 ml-14">
            Transform any public GitHub repository into an AI-searchable memory bank.
          </p>
        </div>

        {/* Input Card */}
        <div className="rounded-2xl p-6 mb-6 border border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <label className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
            <Github size={16} className="text-slate-400" />
            GitHub Repository URL
          </label>
          <div className="flex gap-3 mt-3">
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleIngest()}
              placeholder="https://github.com/owner/repository"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
              disabled={loading}
            />
            <button
              onClick={handleIngest}
              disabled={loading || !repoUrl.trim()}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-semibold hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/20"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
              {loading ? "Ingesting..." : "Start Ingestion"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-slate-500 text-xs py-1">Quick examples:</span>
            {EXAMPLE_REPOS.map((url) => (
              <button key={url} onClick={() => setRepoUrl(url)}
                className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-cyan-400 hover:bg-slate-700 transition-colors">
                {url.replace("https://github.com/", "")}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Chunk Size", value: "1,200 tokens" },
            { label: "Overlap", value: "200 tokens" },
            { label: "Embed Dim", value: "3072-dim" },
            { label: "Batch Size", value: "100 vectors" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-center">
              <div className="text-cyan-400 font-bold text-sm">{value}</div>
              <div className="text-slate-500 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Terminal */}
        {(logs.length > 0 || loading) && (
          <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-900/50 backdrop-blur-sm mb-6">
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-slate-800">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="ml-2 text-slate-400 text-xs font-mono">innovate-bharat — ingestion pipeline</span>
            </div>
            <div className="p-4 font-mono text-sm min-h-[200px] max-h-[400px] overflow-y-auto bg-slate-950/90">
              <div className="text-slate-400 mb-2">$ innovate-bharat ingest --repo &quot;{repoUrl}&quot;</div>
              {logs.map((log, i) => (
                <div key={i} className={`mb-1 leading-relaxed ${
                  log.startsWith("❌") ? "text-red-400"
                  : log.startsWith("✅") || log.startsWith("🎉") ? "text-emerald-400"
                  : log.startsWith("⚠️") ? "text-yellow-400"
                  : "text-slate-300"
                }`}>{log}</div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-cyan-400 mt-1">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Processing...</span>
                  <span className="animate-pulse">_</span>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Banners */}
        {status === "success" && (
          <div className="mb-6 flex items-center gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle size={24} className="text-emerald-400 shrink-0" />
            <div>
              <div className="text-emerald-400 font-bold">Ingestion Complete!</div>
              <div className="text-slate-400 text-sm mt-0.5">
                <span className="text-white font-semibold">{chunksIngested.toLocaleString()}</span> chunks stored in Pinecone. Ready for RAG queries.
              </div>
            </div>
            <Database size={20} className="text-emerald-500 ml-auto" />
          </div>
        )}
        {status === "error" && (
          <div className="mb-6 flex items-center gap-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <XCircle size={24} className="text-red-400 shrink-0" />
            <div>
              <div className="text-red-400 font-bold">Ingestion Failed</div>
              <div className="text-slate-400 text-sm mt-0.5">Check terminal logs above. Ensure GEMINI_API_KEY and Pinecone vars are set on Render.</div>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="rounded-2xl p-6 border border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Zap size={16} className="text-cyan-400" />
            How the Pipeline Works
          </h3>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            {[
              { step: "1", title: "Download & Extract", desc: "Fetches repo via GitHub Zipball API. Filters .py, .js, .ts, .tsx, .md and more." },
              { step: "2", title: "Chunk & Embed", desc: "RecursiveCharacterTextSplitter + gemini-embedding-001 → 3072-dim vectors." },
              { step: "3", title: "Store in Pinecone", desc: "Vectors upserted in batches of 100 to Pinecone Serverless (cosine metric)." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="bg-slate-900/50 rounded-xl p-4 border border-slate-800/50">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm mb-3">{step}</div>
                <div className="text-white font-semibold mb-1">{title}</div>
                <div className="text-slate-400">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
