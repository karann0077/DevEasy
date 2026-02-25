"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Terminal,
  Map,
  Search,
  GitBranch,
  Cpu,
  ExternalLink,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/ingest", label: "Ingest", icon: Terminal },
  { href: "/canvas", label: "Canvas", icon: Map },
  { href: "/explorer", label: "Explorer", icon: Search },
  { href: "/debugger", label: "Debugger", icon: GitBranch },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-16 bg-slate-950 border-r border-slate-800/70 flex flex-col items-center py-4 gap-1 shrink-0">
      {/* Logo */}
      <div className="mb-4 p-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
          <Cpu size={16} className="text-white" />
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`relative group w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
                isActive
                  ? "bg-cyan-500/20 text-cyan-400 shadow-cyan-glow"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              <Icon size={19} />
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan-400 rounded-r-full" />
              )}
              {/* Tooltip */}
              <span className="absolute left-full ml-3 px-2 py-1 bg-slate-800 text-slate-200 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto">
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
          className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-all"
        >
          <ExternalLink size={16} />
        </a>
      </div>
    </aside>
  );
}