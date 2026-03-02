"use client";
import { useState, useRef, useEffect } from "react";
import { Code2, Send, Loader2, Wand2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

function simpleMarkdownToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```[\s\S]*?```/g, (m) => {
      const code = m.slice(3, -3).replace(/^[^\n]*\n/, "");
      return `<pre><code>${code}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>");
}

function extractCodeBlock(text: string): string | null {
  const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

interface Message {
  role: "user" | "ai";
  content: string;
}

const DEFAULT_CODE = `// Paste or type your code here
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`;

export default function LivePage() {
  const [editorCode, setEditorCode] = useState(DEFAULT_CODE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastAiCode, setLastAiCode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setError("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    setLastAiCode(null);
    try {
      const data = await apiFetch<{ answer: string }>(
        "/api/explain",
        {
          method: "POST",
          body: JSON.stringify({
            query: `Given this code:\n\n${editorCode}\n\nQuestion: ${userMsg}`,
          }),
        }
      );
      const answer = data.answer || "No response.";
      setMessages((prev) => [...prev, { role: "ai", content: answer }]);
      const codeBlock = extractCodeBlock(answer);
      if (codeBlock) setLastAiCode(codeBlock);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyFix = () => {
    if (lastAiCode) {
      setEditorCode(lastAiCode);
      setLastAiCode(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#020617]">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 shrink-0 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10">
            <Code2 size={22} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Live Code AI</h1>
            <p className="text-slate-400 text-sm">Pair Programmer — edit code on the left, chat with AI on the right</p>
          </div>
        </div>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Code editor */}
        <div className="flex-1 flex flex-col border-r border-slate-800">
          <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800 text-slate-400 text-xs font-mono flex items-center gap-2">
            <Code2 size={12} /> editor.ts
          </div>
          <textarea
            value={editorCode}
            onChange={(e) => setEditorCode(e.target.value)}
            spellCheck={false}
            className="flex-1 bg-slate-950 text-slate-100 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
            style={{ tabSize: 2 }}
          />
          {lastAiCode && (
            <div className="px-4 py-3 bg-emerald-500/10 border-t border-emerald-500/30 flex items-center gap-3">
              <span className="text-emerald-400 text-sm flex-1">AI suggested a code fix.</span>
              <button
                onClick={applyFix}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-all"
              >
                <Wand2 size={12} /> Apply Fix
              </button>
            </div>
          )}
        </div>

        {/* Right: Chat */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800 text-slate-400 text-xs font-semibold flex items-center gap-2">
            AI Chat
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="flex items-center justify-center h-full text-slate-600 text-sm text-center px-4">
                Ask the AI about your code — e.g. &quot;Add error handling&quot;, &quot;Convert to async/await&quot;, &quot;Explain this function&quot;
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "user" ? (
                  <div className="max-w-[80%] px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-indigo-600/20 border border-cyan-500/30 text-slate-100 text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[90%] px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800">
                    <div
                      className="prose-dark text-sm text-slate-300 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(msg.content) }}
                    />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 size={13} className="animate-spin text-cyan-400" /> Thinking...
                </div>
              </div>
            )}
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">❌ {error}</div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Chat input */}
          <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/50">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Ask about the code..."
                disabled={loading}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition-all"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:from-indigo-400 hover:to-purple-500 disabled:opacity-50 transition-all"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
