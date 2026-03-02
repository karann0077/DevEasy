// frontend/lib/api.ts

export function getApiBaseUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, "");
  }
  return "http://localhost:8000";
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<T> {
  const base = getApiBaseUrl();
  const url = base + path;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);

    let data: any = null;
    try {
      const text = await res.text();
      if (text.trim()) data = JSON.parse(text);
    } catch { data = null; }

    if (!res.ok) {
      const detail = data?.detail ?? data ?? res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data as T;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw err;
  }
}
