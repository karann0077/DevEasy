"use client";
import { useState, useEffect } from "react";
import { Map, Loader2, Info } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface Node { id: string; label: string; x: number; y: number; color: string; }
interface Edge { from: string; to: string; label: string; }

export default function CanvasPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ nodes: Node[]; edges: Edge[] }>("/api/architecture", { method: "POST", body: JSON.stringify({}) })
      .then((d) => { setNodes(d.nodes); setEdges(d.edges); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const getNodePos = (id: string) => nodes.find((n) => n.id === id);

  const insights: Record<string, string> = {
    client: "**Frontend (Next.js)**\nHandles all user interactions. Communicates with the FastAPI backend via REST calls. Displays real-time ingestion logs, the architecture canvas, code explorer, and git debugger.",
    api: "**Backend (FastAPI)**\nThe core engine. Handles /api/ingest, /api/explain, /api/debug, /api/architecture. Orchestrates calls to Gemini for embeddings and generation, and to Pinecone for vector storage and retrieval.",
    gemini: "**Google Gemini**\ntext-embedding-004 model generates 768-dimension vectors for code chunks. gemini-1.5-flash handles RAG generation — constructing answers from retrieved code context.",
    pinecone: "**Pinecone Vector DB**\nServerless vector database storing all code chunk embeddings. Queried at retrieval time to find the top-5 most semantically similar chunks to any user query.",
    github: "**GitHub**\nSource of truth for all code. Repos downloaded via the Zipball API. Commit data fetched for the git debugger blast radius analysis.",
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Map size={24} className="text-purple-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">Zenith Canvas</h1>
            <p className="text-slate-400 text-sm mt-1">Interactive architecture map — click any node for AI insights</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span>Loading architecture...</span>
          </div>
        )}
        {error && <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded-xl border border-red-500/20">❌ {error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-3 gap-6">
            {/* SVG Canvas */}
            <div className="col-span-2 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 relative overflow-hidden" style={{ height: 420 }}>
              <svg width="100%" height="100%" viewBox="0 0 900 380">
                <defs>
                  <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
                  </marker>
                </defs>
                {/* Edges */}
                {edges.map((edge, i) => {
                  const from = getNodePos(edge.from);
                  const to = getNodePos(edge.to);
                  if (!from || !to) return null;
                  const mx = (from.x + to.x) / 2;
                  const my = (from.y + to.y) / 2;
                  return (
                    <g key={i}>
                      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                        stroke="#334155" strokeWidth="1.5" markerEnd="url(#arrow)" strokeDasharray="4,4" />
                      <text x={mx} y={my - 6} fill="#64748b" fontSize="10" textAnchor="middle">{edge.label}</text>
                    </g>
                  );
                })}
                {/* Nodes */}
                {nodes.map((node) => (
                  <g key={node.id} onClick={() => setSelected(node)} style={{ cursor: "pointer" }}>
                    <rect x={node.x - 70} y={node.y - 28} width={140} height={56} rx={12}
                      fill={selected?.id === node.id ? node.color + "33" : "#0f172a"}
                      stroke={selected?.id === node.id ? node.color : "#334155"}
                      strokeWidth={selected?.id === node.id ? 2 : 1} />
                    <text x={node.x} y={node.y + 5} fill={node.color} fontSize="11"
                      fontWeight="bold" textAnchor="middle" dominantBaseline="middle">
                      {node.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            {/* Info Panel */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-4">
                <Info size={16} className="text-purple-400" />
                <span className="text-slate-300 font-semibold text-sm">
                  {selected ? selected.label : "Component Details"}
                </span>
              </div>
              {!selected && (
                <p className="text-slate-500 text-sm">Click any node on the canvas to see AI-generated architectural insights about that layer.</p>
              )}
              {selected && (
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {insights[selected.id] || `No details available for "${selected.label}".`}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
