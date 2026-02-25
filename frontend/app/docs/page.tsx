"use client";
import { useState } from "react";
import {
  BookOpen,
  FileCode,
  Database,
  FileText,
  Sparkles,
  ChevronRight,
  Loader2,
  FolderOpen,
} from "lucide-react";

const FILE_TREE = [
  { path: "src/auth_service.ts", type: "ts" },
  { path: "src/db_schema.sql", type: "sql" },
  { path: "src/README.md", type: "md" },
];

const MOCK_DOCS: Record<
  string,
  { title: string; path: string; overview: string; dataFlow: string[] }
> = {
  "src/auth_service.ts": {
    title: "Authentication Service",
    path: "/src/auth_service.ts",
    overview:
      "Handles all authentication logic for the application. Implements JWT-based stateless authentication with bcrypt password hashing. Integrates with the users table in PostgreSQL for credential validation.",
    dataFlow: [
      "1. Receives POST /login",
      "2. Hashes password using bcrypt",
      "3. Validates against users table",
      "4. Issues signed JWT",
    ],
  },
  "src/db_schema.sql": {
    title: "Database Schema",
    path: "/src/db_schema.sql",
    overview:
      "Defines the PostgreSQL schema for the application. Includes tables for users, sessions, and audit logs with proper constraints and indexes for performance.",
    dataFlow: [
      "1. Creates users table",
      "2. Adds sessions table",
      "3. Creates audit_log table",
      "4. Applies foreign key constraints",
    ],
  },
  "src/README.md": {
    title: "Project README",
    path: "/src/README.md",
    overview:
      "Main documentation file for the project. Describes the architecture, setup instructions, environment variables, and contribution guidelines.",
    dataFlow: [
      "1. Project overview",
      "2. Installation steps",
      "3. Environment configuration",
      "4. API reference",
    ],
  },
};

export default function DocsPage() {
  const [selectedFile, setSelectedFile] = useState<string>("src/auth_service.ts");
  const [loading, setLoading] = useState(false);
  const [aiDoc, setAiDoc] = useState<string>("");
  const [showAiDoc, setShowAiDoc] = useState(false);

  const doc = MOCK_DOCS[selectedFile];

  const handleGenerateDoc = async () => {
    setLoading(true);
    setShowAiDoc(true);
    setAiDoc("");
    try {
      const resp = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: selectedFile }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "API error");
      setAiDoc(data.documentation);
    } catch {
      setAiDoc(
        "AI documentation unavailable. Make sure you've ingested a repository and the backend is running."
      );
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
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <BookOpen size={24} className="text-cyan-400" />
            </div>
            <h1 className="text-3xl font-black text-white">Living Docs</h1>
          </div>
          <p className="text-slate-400 ml-14">
            AI-generated documentation that stays in sync with your codebase.
          </p>
        </div>

        <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">
          {/* File Explorer */}
          <div className="w-56 glass rounded-xl border border-slate-800 p-3 overflow-y-auto shrink-0">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3 px-2">
              <FolderOpen size={13} />
              File Explorer
            </div>

            {/* src/ folder */}
            <div className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-500 font-semibold">
                <ChevronRight size={12} />
                src/
              </div>
              {FILE_TREE.map(({ path, type }) => (
                <button
                  key={path}
                  onClick={() => {
                    setSelectedFile(path);
                    setShowAiDoc(false);
                    setAiDoc("");
                  }}
                  className={`w-full text-left flex items-center gap-2 pl-6 pr-2 py-1.5 rounded-lg text-xs mb-0.5 transition-all ${
                    selectedFile === path
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <FileCode size={12} className="shrink-0" />
                  <span className="truncate">{path.split("/").pop()}</span>
                  <span className="ml-auto text-slate-600 text-[10px]">.{type}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Doc Viewer */}
          <div className="flex-1 glass rounded-xl border border-slate-800 overflow-hidden flex flex-col">
            {/* Doc Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-slate-900/80 border-b border-slate-800">
              <div>
                <h2 className="text-white font-bold text-lg">{doc?.title}</h2>
                <div className="flex items-center gap-1.5 text-slate-500 text-xs mt-0.5">
                  <FileText size={11} />
                  Path: {doc?.path}
                </div>
              </div>
              <button
                onClick={handleGenerateDoc}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-semibold hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 transition-all"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                AI Generated
              </button>
            </div>

            {/* Doc Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {showAiDoc ? (
                <div>
                  <div className="flex items-center gap-2 mb-4 text-cyan-400 text-sm font-semibold">
                    <Sparkles size={14} />
                    AI-Generated Documentation
                  </div>
                  {loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
                      <Loader2 size={28} className="animate-spin text-cyan-400" />
                      <p className="text-sm">Generating documentation with Gemini...</p>
                    </div>
                  ) : (
                    <pre className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-sans">
                      {aiDoc}
                    </pre>
                  )}
                </div>
              ) : (
                <>
                  {/* Architectural Overview */}
                  <div className="mb-6">
                    <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                      Architectural Overview
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      {doc?.overview}
                    </p>
                  </div>

                  {/* Data Flow */}
                  <div>
                    <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
                      <Database size={13} />
                      Data Flow
                    </div>
                    <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-4 font-mono text-sm">
                      {doc?.dataFlow.map((step, i) => (
                        <div key={i} className="text-slate-300 py-1">
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
