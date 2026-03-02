"use client";
import { BookOpen, Zap, Terminal, Map, Search, GitBranch, Key } from "lucide-react";

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-lg bg-yellow-500/10">
            <BookOpen size={24} className="text-yellow-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">Living Documentation</h1>
            <p className="text-slate-400 text-sm mt-1">How to use InnovateBHARAT AI Engine</p>
          </div>
        </div>

        <div className="space-y-6">
          {[
            {
              icon: Key, color: "red", title: "Setup (Required)",
              content: `Configure these environment variables:\n\nVercel (Frontend):\n• NEXT_PUBLIC_API_BASE_URL = https://your-app.onrender.com\n\nRender (Backend):\n• GEMINI_API_KEY = AIza...\n• PINECONE_API_KEY = your-key\n• PINECONE_INDEX = your-index-name\n• PINECONE_HOST = https://your-index.svc.pinecone.io`
            },
            {
              icon: Terminal, color: "cyan", title: "1. Ingest a Repository",
              content: "Go to Project Hub → paste any public GitHub URL → click Start Ingestion.\n\nThe pipeline downloads the repo, chunks all code files, generates 3072-dim embeddings via the gemini-embedding-001 model, and stores them in Pinecone.\n\nThis enables RAG queries across your entire codebase."
            },
            {
              icon: Map, color: "purple", title: "2. Zenith Canvas",
              content: "Go to Zenith Canvas to see the interactive architecture diagram.\n\nClick any node (Frontend, Backend, Gemini, Pinecone, GitHub) to see detailed AI-generated insights about that architectural layer and how it connects to others."
            },
            {
              icon: Search, color: "indigo", title: "3. Code Explorer",
              content: "Go to Code Explorer → type any question about your ingested codebase.\n\nExamples:\n• 'Explain the authentication flow'\n• 'How does the payment controller work?'\n• 'What does the user model contain?'\n\nThe RAG pipeline finds relevant code chunks and generates a context-aware explanation."
            },
            {
              icon: GitBranch, color: "emerald", title: "4. Git Debugger",
              content: "Go to Time-Travel Git → paste a GitHub commit URL.\n\nThe system fetches the commit diff, identifies changed files (blast radius), and generates an AI-powered PR summary explaining what changed and what might break."
            },
          ].map(({ icon: Icon, color, title, content }) => (
            <div key={title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg bg-${color}-500/10`}>
                  <Icon size={18} className={`text-${color}-400`} />
                </div>
                <h2 className="text-white font-bold">{title}</h2>
              </div>
              <pre className="text-slate-400 text-sm whitespace-pre-wrap leading-relaxed font-sans">{content}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
