// frontend/lib/api.ts
// Production-ready API client

function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.replace(/\/+$/, "");
  }
  // In production on Vercel, this MUST be set via NEXT_PUBLIC_API_BASE_URL
  // pointing to your Render backend, e.g. https://deveasy.onrender.com
  return "http://localhost:8000";
}

function joinPath(base: string, path: string): string {
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<T> {
  const API_BASE = getApiBaseUrl();
  const url = joinPath(API_BASE, path);

  if (process.env.NODE_ENV === "development") {
    console.log(`[API] ${options.method || "GET"} ${url}`);
  }

  const fetchPromise = fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (res) => {
    // ✅ FIX: JSON.parse is synchronous - it does NOT return a Promise
    // The old code had `.catch()` on it which threw a TypeError crashing the app
    let data: any = null;
    try {
      const text = await res.text();
      if (text) data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!res.ok) {
      const detail = data?.detail ?? data ?? res.statusText;
      const errorMsg =
        typeof detail === "string" ? detail : JSON.stringify(detail);

      if (process.env.NODE_ENV === "development") {
        console.error(`[API] Error ${res.status}:`, errorMsg);
      }

      throw new Error(JSON.stringify({ status: res.status, detail }));
    }

    return data as T;
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      reject(new Error("Request timed out after " + timeoutMs / 1000 + "s"));
    }, timeoutMs)
  );

  return Promise.race([fetchPromise, timeoutPromise]);
}

export function getApiUrl(): string {
  return getApiBaseUrl();
}
