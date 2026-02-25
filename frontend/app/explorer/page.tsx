"use client";
import { useState } from "react";
import { MessageSquare, Loader2, X } from "lucide-react";

const CODE_LINES = [
  { n: 1,  text: "def process_user_data(user_records):",                       color: "text-blue-400" },
  { n: 2,  text: '    # AI Note: Function processes batch analytics',           color: "text-slate-500" },
  { n: 3,  text: "    results = []",                                            color: "text-slate-300" },
  { n: 4,  text: "    for user in user_records:",                               color: "text-slate-300", annotation: true },
  { n: 5,  text: "        for transaction in get_all_transactions():",          color: "text-slate-300", highlight: true },
  { n: 6,  text: "            if transaction.user_id == user.id:",              color: "text-slate-300", highlight: true },
  { n: 7,  text: "                results.append(analyze(transaction))",        color: "text-slate-300", highlight: true },
  { n: 8,  text: "",                                                             color: "text-slate-300", highlight: true },
  { n: 9,  text: "    return results",                                          color: "text-slate-300" },
  { n: 10, text: "",                                                             color: "text-slate-300" },
  { n: 11, text: "def get_all_transactions():",                                 color: "text-blue-400" },
  { n: 12, text: '    """Fetch all transactions from database."""',             color: "text-emerald-400" },
  { n: 13, text: "    return db.query(Transaction).all()",                      color: "text-slate-300" },
  { n: 14, text: "",                                                             color: "text-slate-300" },
  { n: 15, text: "def analyze(transaction):",                                   color: "text-blue-400" },
  { n: 16, text: '    """Run analytics on a single transaction."""',            color: "text-emerald-400" },
  { n: 17, text: "    score = compute_risk_score(transaction.amount)",          color: "text-slate-300" },
  { n: 18, text: "    category = classify_transaction(transaction.type)",       color: "text-slate-300" },
  { n: 19, text: "    return { 'score': score, 'category': category }",         color: "text-slate-300" },
  { n: 20, text: "",                                                             color: "text-slate-300" },
];

const MOCK_CODE_TEXT = CODE_LINES.map((l) => l.text).join("\n");

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-indigo-400 font-bold text-base mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-cyan-400 font-bold text-lg mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-white font-black text-xl mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-cyan-300 px-1.5 py-0.5 rounded text-xs">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-300 mb-1">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-2 text-slate-300 text-sm leading-relaxed">');
}

export default function ExplorerPage() {
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const handleExplain = async () => {
    setLoading(true);
    setPanelOpen(true);
    setExplanation("");

    try {
      const resp = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Explain this code", code: MOCK_CODE_TEXT }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || "API error");
      setExplanation(data.answer);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setExplanation(`**Error:** ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] p-8">
      <div className="max-w-5xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
            <span className="text-cyan-400 font-mono font-bold text-sm">&lt;&gt;</span>
            <span className="text-slate-300 text-sm font-medium">data_processor.py</span>
          </div>
          <button
            onClick={handleExplain}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium transition-all disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <MessageSquare size={15} className="text-slate-400" />
            )}
            Explain Code
          </button>
        </div>

        <div className="flex gap-4">
          {/* Code viewer */}
          <div className="flex-1 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-auto">
              {CODE_LINES.map((line) => (
                <div
                  key={line.n}
                  className={`flex items-start relative ${
                    line.highlight ? "bg-slate-800/30" : ""
                  }`}
                >
                  {/* Line number */}
                  <span className="select-none text-slate-600 font-mono text-xs w-10 shrink-0 text-right pr-4 py-1 leading-6">
                    {line.n}
                  </span>

                  {/* Code content */}
                  <span className={`font-mono text-xs py-1 leading-6 flex-1 pr-4 ${line.color}`}>
                    {line.text || "\u00a0"}
                  </span>

                  {/* Inline annotation badge on line 4 */}
                  {line.annotation && (
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer hover:bg-amber-500/30 transition-colors whitespace-nowrap">
                      ⚡ Complexity: O(N²) — Click to optimize
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI Explanation Panel */}
          {panelOpen && (
            <div className="w-80 shrink-0 backdrop-blur-xl bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                <div className="flex items-center gap-2 text-slate-300 font-semibold text-sm">
                  <MessageSquare size={15} className="text-cyan-400" />
                  AI Explanation
                </div>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-3 text-slate-500">
                    <Loader2 size={24} className="animate-spin text-cyan-400" />
                    <p className="text-sm">Analyzing code...</p>
                  </div>
                ) : (
                  <div
                    className="prose-dark text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
