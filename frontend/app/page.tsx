import Link from "next/link";
import {
  Cpu,
  GitBranch,
  Map,
  Terminal,
  Zap,
  Shield,
  Search,
} from "lucide-react";

const features = [
  {
    icon: Terminal,
    title: "Zero-Setup Ingestion",
    description:
      "Ingest any public GitHub repo into a Pinecone vector database with a single click.",
    href: "/ingest",
    color: "cyan",
    accent: "border-cyan-500/30 hover:border-cyan-500/70 hover:shadow-cyan-glow",
    iconColor: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    icon: Map,
    title: "Zenith Canvas",
    description:
      "Interactive architecture maps that visualize your system's components and connections.",
    href: "/canvas",
    color: "indigo",
    accent: "border-indigo-500/30 hover:border-indigo-500/70 hover:shadow-indigo-glow",
    iconColor: "text-indigo-400",
    bg: "bg-indigo-500/10",
  },
  {
    icon: Search,
    title: "RAG Code Explorer",
    description:
      "System-aware code explanations using Retrieval-Augmented Generation over your codebase.",
    href: "/explorer",
    color: "violet",
    accent: "border-violet-500/30 hover:border-violet-500/70",
    iconColor: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    icon: GitBranch,
    title: "Time-Travel Debugger",
    description:
      "Analyze Git commits for blast radius and auto-generate PR summaries with AI.",
    href: "/debugger",
    color: "emerald",
    accent: "border-emerald-500/30 hover:border-emerald-500/70 hover:shadow-green-glow",
    iconColor: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#020617] flex flex-col">
      {/* Hero */}
      <div className="relative flex flex-col items-center justify-center px-8 py-24 text-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/5 rounded-full blur-3xl" />
          <div className="absolute top-1/3 left-1/3 w-[400px] h-[200px] bg-indigo-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm font-medium mb-8">
            <Zap size={14} className="animate-pulse" />
            AI-Powered Architectural Co-Pilot
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6">
            <span className="text-white">Innovate</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500">
              BHARAT
            </span>
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            Understand, map, and debug complex codebases in seconds. Powered by{" "}
            <span className="text-cyan-400 font-semibold">Google Gemini</span> +{" "}
            <span className="text-indigo-400 font-semibold">Pinecone RAG</span>.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/ingest"
              className="px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-semibold hover:from-cyan-400 hover:to-indigo-500 transition-all shadow-cyan-glow hover:shadow-lg"
            >
              Start Ingesting
            </Link>
            <Link
              href="/canvas"
              className="px-8 py-3 rounded-lg border border-slate-700 text-slate-300 font-semibold hover:border-cyan-500/50 hover:text-cyan-400 transition-all"
            >
              View Architecture
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-8 pb-8">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Embedding Model", value: "text-embedding-004", icon: Cpu },
            { label: "Vector Dimensions", value: "768-dim", icon: Zap },
            { label: "Generation Model", value: "Gemini 1.5 Flash", icon: Shield },
            { label: "Vector DB", value: "Pinecone Serverless", icon: GitBranch },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="glass rounded-xl p-4 text-center"
            >
              <Icon size={20} className="text-cyan-400 mx-auto mb-2" />
              <div className="text-white font-bold text-sm">{value}</div>
              <div className="text-slate-500 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature Cards */}
      <div className="px-8 pb-16">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
          {features.map(({ icon: Icon, title, description, href, accent, iconColor, bg }) => (
            <Link
              key={href}
              href={href}
              className={`group glass rounded-2xl p-6 border transition-all duration-300 ${accent}`}
            >
              <div className={`inline-flex p-3 rounded-xl ${bg} mb-4`}>
                <Icon size={24} className={iconColor} />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
              <div className="mt-4 text-xs font-medium text-slate-500 group-hover:text-cyan-400 transition-colors">
                Open Feature →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}