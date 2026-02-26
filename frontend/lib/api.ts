// frontend/lib/api.ts
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

function joinPath(base: string, path: string) {
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

/**
 * apiFetch - wrapper around fetch that:
 * - builds absolute URL from NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_API_URL
 * - enforces a timeout (120s)
 * - returns parsed JSON or throws an Error (with backend detail preserved)
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<T> {
  const url = joinPath(API_BASE, path);

  const fetchPromise = fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  }).then(async (res) => {
    // try parse JSON; if body empty, data will be null
    const text = await res.text().catch(() => "");
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      // stringify the backend detail so callers can extract logs
      const detail = data?.detail ?? data ?? res.statusText;
      throw new Error(JSON.stringify({ status: res.status, detail }));
    }

    return data as T;
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), timeoutMs)
  );

  return Promise.race([fetchPromise, timeoutPromise]) as Promise<T>;
}
