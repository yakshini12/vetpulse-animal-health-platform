/**
 * Minimal fetch wrapper for the VetPulse API.
 *
 * The session lives in an httpOnly cookie, so every request sends
 * credentials and the browser never sees (or stores) the token. Errors are
 * normalised into ApiError using the documented error envelope:
 *   { error: { code, message, details? } }
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the VetPulse server. Is the API running?');
    this.name = 'NetworkError';
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function parseError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed with status ${res.status}.`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // non-JSON body (e.g. a proxy error page) — keep the defaults
  }
  return new ApiError(res.status, code, message, details);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'include', ...init });
  } catch {
    throw new NetworkError();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) }),
};

/** Uploads a CSV file for import preview (multipart). */
export function uploadCsv<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return request<T>(path, { method: 'POST', body: form });
}

/** Converts query params to a URL-search string, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}
