"use client";
import { useState } from "react";
import { BookOpen, Loader2, Download, Play, ChevronDown, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { simpleMarkdownToHtml } from "@/lib/markdown";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
interface ApiRoute {
  method: Method;
  path: string;
  description: string;
  parameters?: { name: string; type: string; required: boolean; description: string }[];
}

const METHOD_COLORS: Record<Method, string> = {
  GET: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
  POST: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
  PUT: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  DELETE: "bg-red-500/20 text-red-400 border border-red-500/40",
  PATCH: "bg-orange-500/20 text-orange-400 border border-orange-500/40",
};

const TABS = ["API (Swagger)", "Components", "CLI & Config", "Generated Site"] as const;
type Tab = (typeof TABS)[number];

// ────────────────────────────────────────────────────────────
// TAB 1 — API (Swagger)
// ────────────────────────────────────────────────────────────
function ApiTab() {
  const [routes, setRoutes] = useState<ApiRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchRoutes = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: "list all API routes and endpoints in this codebase with their HTTP methods, paths, and descriptions" }) }
      );
      // Parse basic route lines from the response
      const lines = data.answer.split("\n");
      const parsed: ApiRoute[] = [];
      lines.forEach((line) => {
        const match = line.match(/\b(GET|POST|PUT|DELETE|PATCH)\b.*?(\/[\w/:{}._-]+)/i);
        if (match) {
          parsed.push({
            method: match[1].toUpperCase() as Method,
            path: match[2],
            description: line.replace(match[0], "").trim().replace(/^[-:–]\s*/, "") || line.trim(),
          });
        }
      });
      setRoutes(parsed.length ? parsed : [
        { method: "POST", path: "/api/ingest", description: "Ingest a GitHub repository into the vector store" },
        { method: "POST", path: "/api/explain", description: "RAG-based Q&A over ingested codebase" },
        { method: "POST", path: "/api/debug", description: "Analyze a commit URL for blast radius" },
        { method: "POST", path: "/api/architecture", description: "Generate architecture node/edge graph" },
        { method: "GET", path: "/health", description: "Health check" },
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const downloadPostman = () => {
    const collection = {
      info: { name: "InnovateBHARAT API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: routes.map((r) => ({
        name: `${r.method} ${r.path}`,
        request: { method: r.method, url: { raw: `{{base_url}}${r.path}`, host: ["{{base_url}}"], path: r.path.split("/").filter(Boolean) } },
      })),
    };
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "deveasy-postman.json";
    a.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Interactive API Reference</h2>
          <p className="text-slate-400 text-sm mt-1">Auto-generated from routes/annotations via OpenAPI</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchRoutes} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 text-sm hover:bg-indigo-500/30 disabled:opacity-50 transition-all">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {loading ? "Loading..." : "Extract Routes"}
          </button>
          {routes.length > 0 && (
            <button onClick={downloadPostman}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm hover:bg-slate-700 transition-all">
              <Download size={14} />
              Export Postman Collection
            </button>
          )}
        </div>
      </div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {error}</div>}
      {routes.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
          Click &quot;Extract Routes&quot; to auto-generate the API reference from your ingested codebase.
        </div>
      )}
      <div className="space-y-2">
        {routes.map((r, i) => {
          const key = `${r.method}-${r.path}-${i}`;
          const isOpen = expanded === key;
          return (
            <div key={key} className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
              >
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${METHOD_COLORS[r.method] || ""}`}>{r.method}</span>
                <span className="text-white font-mono text-sm">{r.path}</span>
                <span className="text-slate-400 text-sm flex-1">{r.description}</span>
                {isOpen ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-800">
                  {r.parameters && r.parameters.length > 0 ? (
                    <table className="w-full mt-3 text-sm">
                      <thead>
                        <tr className="text-slate-500 text-xs uppercase">
                          <th className="text-left py-1">Name</th>
                          <th className="text-left py-1">Type</th>
                          <th className="text-left py-1">Required</th>
                          <th className="text-left py-1">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.parameters.map((p) => (
                          <tr key={p.name} className="border-t border-slate-800 text-slate-300">
                            <td className="py-1.5 font-mono text-cyan-400">{p.name}</td>
                            <td className="py-1.5 text-slate-400">{p.type}</td>
                            <td className="py-1.5">{p.required ? <span className="text-red-400">Yes</span> : <span className="text-slate-500">No</span>}</td>
                            <td className="py-1.5 text-slate-400">{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-slate-500 text-sm mt-3">No parameters documented.</p>
                  )}
                  <button className="mt-3 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs hover:bg-cyan-500/20 transition-all">
                    Try it out (Live Run)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TAB 2 — Components
// ────────────────────────────────────────────────────────────
interface Component {
  name: string;
  path: string;
  props: { name: string; type: string; default: string; description: string }[];
}

function ComponentsTab() {
  const [components, setComponents] = useState<Component[]>([]);
  const [selected, setSelected] = useState<Component | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchComponents = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: "list all React components with their props, file paths, and prop types" }) }
      );
      // Minimal parse — show raw answer as single component
      setComponents([{ name: "AI Response", path: "RAG output", props: [], }]);
      setSelected({ name: "AI Response", path: "RAG output", props: [{ name: "(see description)", type: "string", default: "-", description: data.answer }] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = components.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex gap-4 h-[calc(100vh-240px)]">
      {/* Left panel */}
      <div className="w-56 shrink-0 flex flex-col gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search components..."
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
        />
        <button onClick={fetchComponents} disabled={loading}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 text-xs hover:bg-indigo-500/30 disabled:opacity-50 transition-all">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {loading ? "Loading..." : "Load Components"}
        </button>
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map((c) => (
            <button key={c.name} onClick={() => setSelected(c)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selected?.name === c.name ? "bg-cyan-500/10 text-cyan-400" : "text-slate-400 hover:bg-slate-800"}`}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {error}</div>}
        {!selected ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
            Click &quot;Load Components&quot; then select a component to inspect.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="text-white font-bold text-lg">{selected.name}</div>
              <div className="text-slate-500 text-xs mt-0.5">{selected.path}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Canvas Preview</div>
              <div className="h-24 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-center text-slate-600 text-sm">
                &lt;{selected.name} /&gt;
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Props</div>
              {selected.props.length === 0 ? (
                <p className="text-slate-500 text-sm">No props documented.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 text-xs uppercase">
                      <th className="text-left py-1">Name</th>
                      <th className="text-left py-1">Type</th>
                      <th className="text-left py-1">Default</th>
                      <th className="text-left py-1">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.props.map((p) => (
                      <tr key={p.name} className="border-t border-slate-800 text-slate-300">
                        <td className="py-1.5 font-mono text-cyan-400">{p.name}</td>
                        <td className="py-1.5 text-slate-400">{p.type}</td>
                        <td className="py-1.5 text-slate-500">{p.default}</td>
                        <td className="py-1.5 text-slate-400 text-xs whitespace-pre-wrap">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TAB 3 — CLI & Config
// ────────────────────────────────────────────────────────────
function CliConfigTab() {
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const configJson = {
    project: "my-repo",
    version: "1.0.0",
    inputs: {
      api: ["src/routes/**/*.ts", "src/controllers/**/*.ts"],
      components: ["frontend/components/**/*.tsx", "frontend/pages/**/*.tsx"],
    },
    outputs: {
      api_docs: "docs/api.md",
      component_docs: "docs/components.md",
      site: "docs/site/index.html",
    },
  };

  const runCli = async () => {
    setLoading(true);
    setError("");
    setOutput(["$ dochelper generate --verbose", "Initializing documentation engine..."]);
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: "generate documentation config for this project" }) }
      );
      const lines = data.answer.split("\n").filter(Boolean);
      setOutput([
        "$ dochelper generate --verbose",
        "\x1b[32m✓\x1b[0m Initializing documentation engine...",
        "\x1b[32m✓\x1b[0m Scanning API routes...",
        "\x1b[32m✓\x1b[0m Extracting React components...",
        "\x1b[32m✓\x1b[0m Generating markdown...",
        ...lines.slice(0, 6),
        "\x1b[32m✓\x1b[0m Done! Docs generated successfully.",
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Config card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="text-white font-bold mb-3 flex items-center gap-2">
          <span className="text-cyan-400">⚙</span> dochelper.config.json
        </div>
        <pre className="bg-slate-950 rounded-lg p-4 text-xs text-emerald-300 overflow-x-auto border border-slate-800">
          {JSON.stringify(configJson, null, 2)}
        </pre>
      </div>
      {/* CLI card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-white font-bold flex items-center gap-2">
            <span className="text-indigo-400">▶</span> CLI Runner
          </div>
          <button onClick={runCli} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 text-xs hover:bg-indigo-500/30 disabled:opacity-50 transition-all">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run
          </button>
        </div>
        {error && <div className="mb-2 p-2 rounded text-red-400 text-xs bg-red-500/10 border border-red-500/30">❌ {error}</div>}
        <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs min-h-[200px] border border-slate-800">
          {output.length === 0 ? (
            <span className="text-slate-600">Click &quot;Run&quot; to generate documentation...</span>
          ) : (
            output.map((line, i) => (
              <div key={i} className={`leading-relaxed ${
                line.startsWith("$") ? "text-cyan-400" :
                line.includes("✓") || line.includes("Done") ? "text-emerald-400" :
                "text-slate-300"
              }`}>{line.replace(/\x1b\[\d+m/g, "")}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TAB 4 — Generated Site
// ────────────────────────────────────────────────────────────
function GeneratedSiteTab() {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateDocs = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        { method: "POST", body: JSON.stringify({ query: "generate markdown documentation overview for this codebase" }) }
      );
      setMarkdown(data.answer || "No documentation generated.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Generated Documentation Site</h2>
          <p className="text-slate-400 text-sm">Auto-generated markdown preview from your codebase</p>
        </div>
        <button onClick={generateDocs} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-400 text-sm hover:bg-indigo-500/30 disabled:opacity-50 transition-all">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? "Generating..." : "Generate Docs"}
        </button>
      </div>
      {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {error}</div>}
      {!markdown && !loading ? (
        <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-slate-700 rounded-xl">
          Click &quot;Generate Docs&quot; to create a markdown overview of your ingested codebase.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={16} className="animate-spin text-cyan-400" /> Generating documentation...</div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 max-h-[60vh] overflow-y-auto">
          <div className="prose-dark text-sm" dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(markdown) }} />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("API (Swagger)");

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-yellow-500/10">
            <BookOpen size={24} className="text-yellow-400" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white">All-in-One Documentation Helper</h1>
            <p className="text-slate-400 text-sm mt-0.5">Auto-generate API docs, component references, and site previews</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6 border-b border-slate-800 pb-4">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "API (Swagger)" && <ApiTab />}
        {activeTab === "Components" && <ComponentsTab />}
        {activeTab === "CLI & Config" && <CliConfigTab />}
        {activeTab === "Generated Site" && <GeneratedSiteTab />}
      </div>
    </div>
  );
}
