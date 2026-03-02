"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, BookOpen, Bug, Code2, Cpu, RefreshCw, CheckCircle, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

const NAV = [
  { href: "/explorer", label: "Overview & Q&A", icon: Search },
  { href: "/docs", label: "Docs Engine", icon: BookOpen },
  { href: "/debugger", label: "Debugging Hub", icon: Bug },
  { href: "/live", label: "Live Code AI", icon: Code2 },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [repoUrl, setRepoUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("synced_repo_url");
    if (stored) setRepoUrl(stored);
  }, []);

  const handleSync = async () => {
    if (!repoUrl.trim() || syncing) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      await apiFetch("/api/ingest", { method: "POST", body: JSON.stringify({ repo_url: repoUrl }) }, 120000);
      localStorage.setItem("synced_repo_url", repoUrl);
      setSyncMsg("Synced!");
      setTimeout(() => setSyncMsg(""), 3000);
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
      setTimeout(() => setSyncMsg(""), 5000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full">
      {/* Top header bar */}
      <header className="flex items-center gap-4 px-4 py-3 bg-slate-950 border-b border-slate-800 shrink-0 z-10">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
            <Cpu size={14} className="text-white" />
          </div>
          <span className="text-white font-black text-sm">InnovateBHARAT</span>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSync()}
            placeholder="https://github.com/owner/repo"
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 text-xs"
          />
          <button
            onClick={handleSync}
            disabled={syncing || !repoUrl.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-xs font-semibold hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 shrink-0 transition-all"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sync Repo
          </button>
          {syncMsg && (
            <span className={`text-xs shrink-0 ${syncMsg === "Synced!" ? "text-emerald-400" : "text-red-400"}`}>
              {syncMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
          <CheckCircle size={11} className="text-emerald-400" />
          <span className="text-emerald-400 text-xs font-semibold">CI: Passing</span>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 bg-slate-950 border-r border-slate-800/70 flex flex-col py-4 shrink-0">
          <nav className="flex flex-col gap-0.5 px-2">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm font-medium ${
                    active
                      ? "bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-400"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-l-2 border-transparent"
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
