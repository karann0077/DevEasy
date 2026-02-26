"use client";
import { useState, useRef, useEffect } from "react";
import {
  Terminal,
  Play,
  Github,
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Zap,
} from "lucide-react";

const EXAMPLE_REPOS = [
  "https://github.com/tiangolo/fastapi",
  "https://github.com/pallets/flask",
  "https://github.com/vercel/next.js",
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

  // --- Helper to parse logs from error response safely ---
  function extractLogs(candidate: any): string[] {
    // common shape: { detail: { logs: [...] } } or { detail: "message" }
    if (candidate.detail) {
      if (Array.isArray(candidate.detail.logs)) {
        return candidate.detail.logs.map((x: unknown) =>
          typeof x === "string" ? x : JSON.stringify(x)
        );
      }
      if (typeof candidate.detail === "string") return [candidate.detail];
      return [JSON.stringify(candidate.detail)];
    }
    if (typeof candidate === "string") return [candidate];
    return [JSON.stringify(candidate)];
  }

  const handleIngest = async () => {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setLogs([]);
    setStatus("idle");
    setChunksIngested(0);

    // Simulated step messages (optional: remove if not desired)
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
      const resp = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl }),
      });

      clearInterval(stepInterval);

      if (!resp.ok) {
        let err = await resp.json().catch(() => null);
        let errLogs: string[] = err
          ? extractLogs(err)
          : [`❌ Error: ${resp.statusText}`];
        setLogs(errLogs);
        setStatus("error");
        return;
      }

      const data = await resp.json();
      setLogs(data.logs || ["✅ Ingestion completed."]);
      setChunksIngested(data.chunks_ingested || 0);
      setStatus("success");
    } catch (e: unknown) {
      clearInterval(stepInterval);
      const msg = e instanceof Error ? e.message : String(e);
      setLogs((prev) => [...prev, `❌ Network error: ${msg}`]);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-4xl mx-auto">
        {/* ... (Omitted the UI code for brevity, assume your Hero, Input, Cards, and Terminal UI here!) ... */}
        {/* Use the rest of your layout as before, no type errors thanks to the helper above! */}
      </div>
    </div>
  );
}
