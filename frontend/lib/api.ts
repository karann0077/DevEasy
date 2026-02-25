const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface IngestRequest {
  repo_url: string;
}

export interface IngestResponse {
  status: string;
  logs: string[];
  chunks_ingested: number;
}

export interface ExplainRequest {
  query: string;
  repo_name?: string;
}

export interface ExplainResponse {
  answer: string;
  sources: string[];
}

export interface DebugRequest {
  commit_url: string;
}

export interface DebugResponse {
  blast_radius: string[];
  pr_summary: string;
  diff: string;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err?.detail || `API Error ${res.status}`);
  }

  return res.json();
}

export const api = {
  ingest: (body: IngestRequest) =>
    apiFetch<IngestResponse>("/api/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  explain: (body: ExplainRequest) =>
    apiFetch<ExplainResponse>("/api/explain", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  debug: (body: DebugRequest) =>
    apiFetch<DebugResponse>("/api/debug", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  architecture: () =>
    apiFetch("/api/architecture", { method: "POST", body: JSON.stringify({}) }),

  health: () => apiFetch("/health"),
};