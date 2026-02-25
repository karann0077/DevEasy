"use client";
import { useState } from "react";
import {
  Map,
  X,
  Cpu,
  Globe,
  Database,
  GitBranch,
  Layers,
  Zap,
  ArrowRight,
} from "lucide-react";

interface NodeData {
  id: string;
  label: string;
  description: string;
  x: number;
  y: number;
  color: string;
  icon: React.ElementType;
}

interface EdgeData {
  from: string;
  to: string;
  label: string;
}

const NODES: NodeData[] = [
  {
    id: "client",
    label: "Client (Next.js)",
    description:
      "React-based frontend with App Router, Tailwind CSS, and Lucide icons. Manages real-time state, API communication, and a dark-mode UI with glassmorphism panels. Connects to the FastAPI backend via REST calls proxied through next.config.ts rewrites.",
    x: 80,
    y: 220,
    color: "#06b6d4",
    icon: Globe,
  },
  {
    id: "api",
    label: "FastAPI Backend",
    description:
      "Python FastAPI server running on Uvicorn. Exposes /api/ingest, /api/explain, /api/debug, and /api/architecture. Implements CORS middleware, Pydantic validation, and bypasses system proxies for clean network calls. Acts as the orchestration layer between all AI services.",
    x: 380,
    y: 220,
    color: "#6366f1",
    icon: Cpu,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description:
      "Dual-purpose AI service: text-embedding-004 generates 768-dimensional vector embeddings for code chunks (via direct REST calls, bypassing SDK version conflicts), and gemini-1.5-flash generates markdown-formatted architectural explanations and PR summaries with RAG context.",
    x: 650,
    y: 80,
    color: "#f59e0b",
    icon: Zap,
  },
  {
    id: "pinecone",
    label: "Pinecone Vector DB",
    description:
      "Serverless Pinecone index (AWS us-east-1) storing code chunk embeddings at 768 dimensions with cosine similarity metric. Enables semantic search over ingested codebases. Metadata stores the original code text, file path, and repository name for RAG context reconstruction.",
    x: 650,
    y: 360,
    color: "#10b981",
    icon: Database,
  },
  {
    id: "github",
    label: "GitHub API",
    description:
      "Public GitHub REST API used to download repository zips (zipball endpoint), fetch commit metadata and diffs for the Time-Travel Debugger. No authentication required for public repos, ensuring zero-setup ingestion.",
    x: 380,
    y: 440,
    color: "#8b5cf6",
    icon: GitBranch,
  },
  {
    id: "splitter",
    label: "Text Splitter",
    description:
      "LangChain RecursiveCharacterTextSplitter with chunk_size=1200 and chunk_overlap=200. Intelligently splits code files into semantically meaningful chunks that preserve context across boundaries. Operates before embedding generation in the ingestion pipeline.",
    x: 380,
    y: 20,
    color: "#ec4899",
    icon: Layers,
  },
];

const EDGES: EdgeData[] = [
  { from: "client", to: "api", label: "REST /api/*" },
  { from: "api", to: "gemini", label: "Embed & Generate" },
  { from: "api", to: "pinecone", label: "Upsert / Query" },
  { from: "api", to: "github", label: "Zipball / Commits" },
  { from: "api", to: "splitter", label: "Chunk Code" },
  { from: "splitter", to: "gemini", label: "Text → Vectors" },
];

function getNodeCenter(node: NodeData, w = 140, h = 56) {
  return { cx: node.x + w / 2, cy: node.y + h / 2 };
}

export default function CanvasPage() {
  const [selected, setSelected] = useState<NodeData | null>(null);

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-indigo-500/10">
              <Map size={24} className="text-indigo-400" />
            </div>
            <h1 className="text-3xl font-black text-white">Zenith Canvas</h1>
          </div>
          <p className="text-slate-400 ml-14">
            Interactive architecture map. Click any node to explore AI-generated insights.
          </p>
        </div>

        <div className="flex gap-6">
          {/* SVG Canvas */}
          <div className="flex-1 glass rounded-2xl border border-slate-800 overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/3 to-cyan-500/3 pointer-events-none" />
            <svg
              viewBox="0 0 850 540"
              className="w-full h-auto"
              style={{ minHeight: "420px" }}
            >
              {/* Grid pattern */}
              <defs>
                <pattern
                  id="grid"
                  width="30"
                  height="30"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 30 0 L 0 0 0 30"
                    fill="none"
                    stroke="rgba(51,65,85,0.4)"
                    strokeWidth="0.5"
                  />
                </pattern>
                {NODES.map((n) => (
                  <filter key={`glow-${n.id}`} id={`glow-${n.id}`}>
                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                ))}
              </defs>
              <rect width="850" height="540" fill="url(#grid)" />

              {/* Edges */}
              {EDGES.map((edge) => {
                const fromNode = NODES.find((n) => n.id === edge.from)!;
                const toNode = NODES.find((n) => n.id === edge.to)!;
                const { cx: x1, cy: y1 } = getNodeCenter(fromNode);
                const { cx: x2, cy: y2 } = getNodeCenter(toNode);
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="rgba(99,102,241,0.4)"
                      strokeWidth="1.5"
                      strokeDasharray="6 3"
                    />
                    <rect
                      x={mx - 38}
                      y={my - 10}
                      width="76"
                      height="20"
                      rx="4"
                      fill="rgba(2,6,23,0.85)"
                      stroke="rgba(99,102,241,0.3)"
                      strokeWidth="1"
                    />
                    <text
                      x={mx}
                      y={my + 4}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {NODES.map((node) => {
                const isSelected = selected?.id === node.id;
                const Icon = node.icon;
                return (
                  <g
                    key={node.id}
                    onClick={() => setSelected(isSelected ? null : node)}
                    style={{ cursor: "pointer" }}
                    filter={isSelected ? `url(#glow-${node.id})` : undefined}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={140}
                      height={56}
                      rx={10}
                      fill={isSelected ? node.color + "25" : "rgba(15,23,42,0.9)"}
                      stroke={isSelected ? node.color : node.color + "60"}
                      strokeWidth={isSelected ? 2 : 1.5}
                    />
                    <text
                      x={node.x + 70}
                      y={node.y + 24}
                      textAnchor="middle"
                      fill={node.color}
                      fontSize="11"
                      fontWeight="700"
                      fontFamily="system-ui, sans-serif"
                    >
                      {node.label.split(" ")[0]}
                    </text>
                    <text
                      x={node.x + 70}
                      y={node.y + 40}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {node.label.split(" ").slice(1).join(" ") || node.id}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-3">
              {NODES.map((n) => (
                <div key={n.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: n.color }}
                  />
                  {n.label.split(" ")[0]}
                </div>
              ))}
            </div>
          </div>

          {/* Info Panel */}
          {selected ? (
            <div className="w-80 glass rounded-2xl border border-slate-700 p-5 relative animate-in slide-in-from-right duration-200">
              <button
                onClick={() => setSelected(null)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>

              <div
                className="inline-flex p-2.5 rounded-xl mb-4"
                style={{ background: selected.color + "20" }}
              >
                <selected.icon size={22} style={{ color: selected.color }} />
              </div>

              <h2 className="text-white font-black text-lg mb-1">{selected.label}</h2>
              <div
                className="text-xs font-mono px-2 py-0.5 rounded inline-block mb-4"
                style={{
                  color: selected.color,
                  background: selected.color + "15",
                  border: `1px solid ${selected.color}40`,
                }}
              >
                {selected.id}
              </div>

              <p className="text-slate-300 text-sm leading-relaxed mb-5">
                {selected.description}
              </p>

              {/* Connected nodes */}
              <div>
                <div className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">
                  Connections
                </div>
                {EDGES.filter(
                  (e) => e.from === selected.id || e.to === selected.id
                ).map((e) => {
                  const otherId = e.from === selected.id ? e.to : e.from;
                  const other = NODES.find((n) => n.id === otherId)!;
                  return (
                    <button
                      key={otherId}
                      onClick={() => setSelected(other)}
                      className="flex items-center gap-2 w-full text-left text-sm py-2 px-3 rounded-lg bg-slate-900/50 hover:bg-slate-800/50 mb-1.5 transition-colors group"
                    >
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: other.color }}
                      />
                      <span className="text-slate-300 group-hover:text-white transition-colors flex-1">
                        {other.label}
                      </span>
                      <span className="text-slate-500 text-xs">{e.label}</span>
                      <ArrowRight
                        size={12}
                        className="text-slate-600 group-hover:text-cyan-400 transition-colors"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="w-80 glass rounded-2xl border border-slate-800 p-5 flex flex-col items-center justify-center text-center">
              <Map size={32} className="text-slate-600 mb-3" />
              <p className="text-slate-500 text-sm">
                Click on any node in the canvas to explore AI-generated architectural insights.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}