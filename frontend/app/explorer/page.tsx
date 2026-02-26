"use client";
import { useState } from "react";

const MOCK_CODE_TEXT = `
def example_function(x):
    # This is a mock function for testing
    return x * x
`;
// You can change MOCK_CODE_TEXT to anything you'd like to test

export default function ExplorerPage() {
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [explanation, setExplanation] = useState("");

  const handleExplain = async () => {
    setLoading(true);
    setPanelOpen(true);
    setExplanation("");

    try {
      const resp = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `Explain the following code and identify any performance issues, architectural concerns, and improvement suggestions:\n\n${MOCK_CODE_TEXT}`,
        }),
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
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-black text-white mb-4">
          RAG Code Explorer
        </h1>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 mb-6">
          <pre className="text-slate-200 text-sm mb-4 bg-slate-800 rounded-lg p-4 whitespace-pre-wrap">{MOCK_CODE_TEXT}</pre>
          <button
            onClick={handleExplain}
            disabled={loading}
            className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-600 text-white font-semibold disabled:opacity-60 transition"
          >
            {loading ? "Explaining..." : "Explain Code"}
          </button>
        </div>
        {panelOpen && (
          <div className="bg-slate-950/90 border border-slate-700 p-6 rounded-xl mt-4 text-slate-300">
            <h2 className="text-lg font-bold mb-2">AI Explanation</h2>
            <div className="whitespace-pre-wrap">
              {explanation || "Waiting for explanation..."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
