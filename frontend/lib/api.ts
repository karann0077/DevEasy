// frontend/lib/api.ts
// Production-ready API client for development and production

/**
 * Get API base URL based on environment
 * - Development: http://localhost:8000 (local backend)
 * - Production: https://your-render-url.onrender.com (Render backend)
 */
function getApiBaseUrl(): string {
  // Check for explicit environment variable first
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.replace(/\/+$/, ""); // Remove trailing slashes
  }

  // Fallback for development
  if (typeof window === "undefined") {
    // Server-side (SSR): use placeholder, should never be called
    return "http://localhost:8000";
  }

  // Client-side development: use localhost
  const isDevelopment =
    process.env.NODE_ENV === "development" ||
    !process.env.NEXT_PUBLIC_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_ENVIRONMENT === "development";

  if (isDevelopment) {
    return "http://localhost:8000";
  }

  // Production fallback (should not reach here if env vars are set)
  return "https://api.innovate-bharat.com";
}

function joinPath(base: string, path: string): string {
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

/**
 * apiFetch - Production-ready wrapper around fetch
 * - Automatically uses correct API base URL
 * - Enforces 120s timeout
 * - Proper error handling with logging
 * - Works in development and production
 */
export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<T> {
  const API_BASE = getApiBaseUrl();
  const url = joinPath(API_BASE, path);

  // Log in development
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
    const text = await res.text().catch(() => "");
    const data = text ? JSON.parse(text).catch(() => null) : null;

    if (!res.ok) {
      const detail = data?.detail ?? data ?? res.statusText;
      const errorMsg = typeof detail === "string" ? detail : JSON.stringify(detail);
      
      // Log errors in development
      if (process.env.NODE_ENV === "development") {
        console.error(`[API] Error ${res.status}:`, errorMsg);
      }

      throw new Error(JSON.stringify({ status: res.status, detail }));
    }

    return data as T;
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      console.error(`[API] Timeout after ${timeoutMs}ms on ${path}`);
      reject(new Error("Request timed out"));
    }, timeoutMs)
  );

  return Promise.race([fetchPromise, timeoutPromise]) as Promise<T>;
}

/**
 * Get the current API base URL (useful for debugging)
 */
export function getApiUrl(): string {
  return getApiBaseUrl();
}
