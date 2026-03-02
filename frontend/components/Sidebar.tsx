"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, BookOpen, Search, Map, GitBranch, Cpu, Sparkles } from "lucide-react";

const NAV = [
  { href: "/ingest", label: "Project Hub", icon: Inbox },
  { href: "/docs", label: "Living Docs", icon: BookOpen },
  { href: "/explorer", label: "Code Explorer", icon: Search },
  { href: "/canvas", label: "Zenith Canvas", icon: Map },
  { href: "/debugger", label: "Time-Travel Git", icon: GitBranch },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800/70 flex flex-col py-4 shrink-0">
      <div className="px-4 mb-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shrink-0">
            <Cpu size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-black text-sm leading-none">InnovateBHARAT</div>
            <div className="text-slate-500 text-[10px] font-medium tracking-wider uppercase mt-0.5">Architectural Co-Pilot</div>
          </div>
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 flex-1 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (pathname === "/" && href === "/ingest");
          return (
            <Link key={href} href={href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm font-medium ${
                active
                  ? "bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-l-2 border-transparent"
              }`}>
              <Icon size={17} className="shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-3 mt-4">
        <Link href="/explorer"
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold hover:from-indigo-500 hover:to-purple-500 transition-all">
          <Sparkles size={15} />
          Ask AI Tutor
        </Link>
      </div>
    </aside>
  );
}
```

---

## Now: Exact Steps to Fix in 10 Minutes

**1. Replace these files in your GitHub repo:**

| File to replace | With |
|---|---|
| `frontend/lib/api.ts` | code above |
| `frontend/app/page.tsx` | code above |
| `frontend/app/ingest/page.tsx` | code above |
| `frontend/app/explorer/page.tsx` | code above |
| `frontend/app/canvas/page.tsx` | code above |
| `frontend/app/debugger/page.tsx` | code above |
| `frontend/app/docs/page.tsx` | code above |
| `frontend/components/Sidebar.tsx` | code above |
| `backend/main.py` | from previous message |
| `backend/requirements.txt` | from previous message |

**2. In Vercel → Settings → Environment Variables, add:**
```
NEXT_PUBLIC_API_BASE_URL = https://YOUR-RENDER-APP.onrender.com
```

**3. In Render → Environment, add:**
```
GEMINI_API_KEY     = AIza...
PINECONE_API_KEY   = ...
PINECONE_INDEX     = your-index-name
PINECONE_HOST      = https://xxx.svc.pinecone.io
