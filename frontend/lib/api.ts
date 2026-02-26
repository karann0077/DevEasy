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
    // FIX #8: Handle object detail (e.g. { error: "...", trace: "..." })
    // instead of passing it directly to Error which produces [object Object]
    const detail = err?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : detail?.error || JSON.stringify(detail) || `API Error ${res.status}`;
    throw new Error(message);
  }

  return res.json();
}
