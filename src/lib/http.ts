/**
 * The one HTTP helper the smoke suite uses.
 *
 * It never throws on a non-2xx: a structured 4xx is a *result* here, and half
 * the T2 cases assert on one. It only rejects when the request could not be made
 * at all, which is what "this sibling is not live yet" looks like.
 */

export interface ApiResponse {
  url: string;
  status: number;
  ok: boolean;
  /** Parsed body when the response was JSON; undefined otherwise. */
  json: unknown;
  text: string;
  contentType: string;
  ms: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export async function request(url: string, options: RequestOptions = {}): Promise<ApiResponse> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }

  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);
  const contentType = response.headers.get("content-type") ?? "";

  let json: unknown;
  if (text !== "" && /\bjson\b/i.test(contentType)) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { url, status: response.status, ok: response.ok, json, text, contentType, ms };
}

/** A short, greppable one-liner for an assertion message. */
export function describeResponse(response: ApiResponse): string {
  const body = response.text.length > 400 ? `${response.text.slice(0, 400)}…` : response.text;
  return `${response.status} ${response.url} (${response.ms} ms, ${response.contentType || "no content-type"})\n${body}`;
}

export function isClientError(response: ApiResponse): boolean {
  return response.status >= 400 && response.status <= 499;
}
