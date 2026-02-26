const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function joinPath(base: string, path: string) {
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = joinPath(API_BASE, path);
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err?.detail || `API Error ${res.status}`);
  }

  return res.json();
}
