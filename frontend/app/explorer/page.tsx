"use client";
import { useState } from "react";
import {
  Search,
  FileCode,
  ChevronRight,
  Loader2,
  Sparkles,
  X,
  FolderOpen,
} from "lucide-react";

const FILE_TREE = [
  { path: "backend/main.py", type: "py" },
  { path: "backend/requirements.txt", type: "txt" },
  { path: "frontend/app/layout.tsx", type: "tsx" },
  { path: "frontend/app/page.tsx", type: "tsx" },
  { path: "frontend/app/ingest/page.tsx", type: "tsx" },
  { path: "frontend/app/canvas/page.tsx", type: "tsx" },
  { path: "frontend/app/explorer/page.tsx", type: "tsx" },
  { path: "frontend/app/debugger/page.tsx", type: "tsx" },
  { path: "frontend/components/Sidebar.tsx", type: "tsx" },
  { path: "frontend/lib/api.ts", type: "ts" },
];

const MOCK_CODE: Record<string, string> = {
  "backend/main.py": `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pinecone import Pinecone, ServerlessSpec
import requests

app = FastAPI(title="InnovateBHARAT AI Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/ingest")
async def ingest_repo(req: IngestRequest):
    """Ingest a GitHub repo into Pinecone."""
    owner, repo = parse_github_url(req.repo_url)
    zip_bytes = download_repo_zip(owner, repo)
    files = extract_code_files(zip_bytes, f"{owner}/{repo}")
    # ... chunk, embed, upsert
    return {"status": "success", "chunks": len(files)}`,
  "frontend/components/Sidebar.tsx": `"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Terminal, Map, Search, GitBranch, Home } from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/ingest", label: "Ingest", icon: Terminal },
  { href: "/canvas", label: "Canvas", icon: Map },
  { href: "/explorer", label: "Explorer", icon: Search },
  { href: "/debugger", label: "Debugger", icon: GitBranch },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-16 bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 gap-2">
      {navItems.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} title={label}
          className={\`p-3 rounded-xl transition-all \${
            path === href ? "bg-cyan-500/20 text-cyan-400" : "text-slate-500 hover:text-slate-300"
          }\`}>
          <Icon size={20} />
        </Link>
      ))}
    </aside>
  );
}`,
};

const DEFAULT_CODE = `// Select a file from the tree to view its content.
// Use "Explain with RAG" to get AI-powered architectural insights.`;

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-indigo-400 font-bold text-base mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-cyan-400 font-bold text-lg mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-white font-black text-xl mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-cyan-300 px-1.5 py-0.5 rounded text-xs">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-300 mb-1">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-2 text-slate-300 text-sm leading-relaxed">')
    .replace(/⚠️/g, '<span class="text-yellow-400">⚠️</span>')
    .replace(/✅/g, '<span class="text-emerald-400">✅</span>')
    .replace(/💡/g, '<span class="text-cyan-400">💡</span>')
    .replace(/🔗/g, '<span class="text-indigo-400">🔗</span>');
}

export default function ExplorerPage() {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [explanation, setExplanation] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const code = selectedFile
    ? MOCK_CODE[selectedFile] || `// Content for ${selectedFile}\n// (Not mocked in demo)`
    : DEFAULT_CODE;

  const handleExplain = async () => {
    const q = query.trim() || (selectedFile ? `Explain the file ${selectedFile}` : "Explain the codebase architecture");
    setLoading(true);
    setPanelOpen(true);
    setExplanation("");

    try {
      const resp = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "API error");
      setExplanation(data.answer);
      setSources(data.sources || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setExplanation(`**Error:** ${msg}\n\nMake sure you've ingested a repository first and the backend is running.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Search size={24} className="text-violet-400" />
            </div>
            <h1 className="text-3xl font-black text-white">RAG Code Explorer</h1>
          </div>
          <p className="text-slate-400 ml-14">
            System-aware code explanations powered by Gemini + Pinecone RAG.
          </p>
        </div>

        {/* Query Bar */}
        <div className="glass rounded-xl border border-slate-800 p-4 mb-6 flex gap-3 items-center">
          <Search size={18} className="text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleExplain()}
            placeholder='Ask anything... e.g. "Explain the ingestion pipeline" or "What does the API router do?"'
            className="flex-1 bg-transparent text-slate-200 placeholder-slate-500 focus:outline-none text-sm"
          />
          <button
            onClick={handleExplain}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-600 text-white text-sm font-semibold hover:from-violet-400 hover:to-indigo-500 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            Explain with RAG
          </button>
        </div>

        <div className="flex gap-4 h-[calc(100vh-320px)] min-h-[400px]">
          {/* File Tree */}
          <div className="w-52 glass rounded-xl border border-slate-800 p-3 overflow-y-auto shrink-0">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3 px-2">
              <FolderOpen size={13} />
              Files
            </div>
            {FILE_TREE.map(({ path, type }) => (
              <button
                key={path}
                onClick={() => setSelectedFile(path)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs mb-0.5 transition-all ${
                  selectedFile === path
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                <FileCode size={12} className="shrink-0" />
                <span className="truncate">{path.split("/").pop()}</span>
                <span className="ml-auto text-slate-600 text-[10px]">.{type}</span>
              </button>
            ))}
          </div>

          {/* Code Viewer */}
          <div className="flex-1 glass rounded-xl border border-slate-800 overflow-hidden flex flex-col">
            {/* Tabs */}
            <div className="flex items-center gap-0 bg-slate-900/80 border-b border-slate-800 px-3 pt-2">
              {selectedFile && (
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded-t-lg text-sm text-cyan-400 border-t border-l border-r border-slate-700">
                  <FileCode size={13} />
                  {selectedFile.split("/").pop()}
                  <ChevronRight size={12} className="text-slate-500" />
                </div>
              )}
            </div>

            {/* Code */}
            <div className="flex-1 overflow-auto p-4 font-mono text-sm bg-slate-950/70">
              <pre className="text-slate-300 leading-relaxed whitespace-pre-wrap">{code}</pre>
            </div>
          </div>

          {/* AI Explanation Panel */}
          {panelOpen && (
            <div className="w-96 glass rounded-xl border border-violet-500/30 overflow-hidden flex flex-col shrink-0">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-800">
                <div className="flex items-center gap-2 text-violet-400 font-semibold text-sm">
                  <Sparkles size={15} />
                  AI Explanation
                </div>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                    <Loader2 size={28} className="animate-spin text-violet-400" />
                    <p className="text-sm">Querying Pinecone + Gemini...</p>
                  </div>
                ) : (
                  <div className="prose-dark text-sm">
                    <div
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }}
                    />
                    {sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-800">
                        <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
                          RAG Sources
                        </div>
                        {sources.slice(0, 5).map((s, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-slate-400 mb-1"
                          >
                            <FileCode size={11} className="text-violet-400 shrink-0" />
                            <span className="truncate">{s}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}