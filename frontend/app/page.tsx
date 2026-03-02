"use client";
import Link from "next/link";
import { Cpu, Map, GitBranch, Search, ArrowRight, Database, Brain } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#020617] p-8 flex flex-col items-center justify-center">
      <div className="max-w-3xl w-full text-center">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
            <Cpu size={28} className="text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-4xl font-black text-white">InnovateBHARAT</h1>
            <p className="text-cyan-400 text-sm font-semibold tracking-widest uppercase">AI Engine</p>
          </div>
        </div>
        <p className="text-slate-400 text-lg mb-12 max-w-xl mx-auto">
          AI-Powered Architectural Co-Pilot. Understand, map, and debug any GitHub repo in seconds.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-10">
          {[
            { href: "/ingest", icon: Database, label: "Codebase Ingestion", desc: "Turn any GitHub repo into a searchable AI memory bank" },
            { href: "/canvas", icon: Map, label: "Architecture Canvas", desc: "Visual interactive node-based architecture maps" },
            { href: "/explorer", icon: Search, label: "Code Explorer", desc: "RAG-powered context-aware code explanations" },
            { href: "/debugger", icon: GitBranch, label: "Git Debugger", desc: "Analyze commits, catch bugs before they merge" },
          ].map(({ href, icon: Icon, label, desc }) => (
            <Link key={href} href={href}
              className="group p-5 rounded-2xl border border-slate-800 bg-slate-900/50 hover:border-cyan-500/40 hover:bg-slate-800/60 transition-all text-left">
              <div className="flex items-center gap-3 mb-2">
                <Icon size={18} className="text-cyan-400" />
                <span className="text-white font-bold text-sm">{label}</span>
                <ArrowRight size={14} className="text-slate-600 group-hover:text-cyan-400 ml-auto transition-colors" />
              </div>
              <p className="text-slate-500 text-xs">{desc}</p>
            </Link>
          ))}
        </div>
        <Link href="/ingest"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold hover:from-cyan-400 hover:to-indigo-500 transition-all shadow-lg shadow-cyan-500/20">
          <Brain size={18} />
          Start Ingesting a Repo
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
