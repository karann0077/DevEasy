// frontend/lib/api.ts

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";

function joinPath(base: string, path: string) {
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = joinPath(API_BASE, path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min (Render cold start safe)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Preserve backend logs + error
      throw {
        status: res.status,
        detail: data?.detail ?? data ?? res.statusText,
      };
    }

    return data as T;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Backend may be waking up (Render cold start).");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
