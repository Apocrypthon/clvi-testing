/**
 * Deciding *why* a base URL did not answer.
 *
 * This exists because of a real trap. Netlify resolves DNS for every
 * `<anything>--<site>.netlify.app` name whether or not the site exists, and the
 * sandboxes these tests run in sit behind an egress proxy that answers a denied
 * host with `403` — so "DNS resolved, got a 403" is equally consistent with
 * "the deploy is not live" and "this machine is not allowed to talk to it".
 *
 * Reporting the second as the first would make docs/STATE.md claim a sibling is
 * down when nobody has actually checked. The whole point of this repo is not
 * doing that, so the classification is a tested function, not a hunch at the
 * call site.
 */

export type Reachability = "live" | "unhealthy" | "route-missing" | "blocked" | "unreachable";

export interface PreflightInput {
  url: string;
  status?: number;
  contentType?: string;
  body?: string;
  /** Set when the request could not be completed at all. */
  error?: unknown;
}

export interface PreflightVerdict {
  kind: Reachability;
  live: boolean;
  /** One line, printed in the run header and used as the skip reason. */
  reason: string;
  /** True when we cannot tell whether the deploy exists — do not record a verdict. */
  inconclusive: boolean;
}

const PROXY_HINTS = /proxy|tunnel|CONNECT|egress|forbidden by policy|blocked/i;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

export function classifyPreflight(input: PreflightInput): PreflightVerdict {
  const { url } = input;

  if (input.error !== undefined) {
    const detail = describeError(input.error);
    if (PROXY_HINTS.test(detail)) {
      return {
        kind: "blocked",
        live: false,
        inconclusive: true,
        reason: `${url} could not be reached from this machine (${detail}) — an egress proxy refused the connection, so this says nothing about the deploy`,
      };
    }
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
      return {
        kind: "unreachable",
        live: false,
        inconclusive: false,
        reason: `${url} does not resolve (${detail}) — not deployed`,
      };
    }
    return {
      kind: "unreachable",
      live: false,
      inconclusive: true,
      reason: `${url} could not be reached (${detail})`,
    };
  }

  const status = input.status ?? 0;
  const contentType = input.contentType ?? "";
  const isJson = /\bjson\b/i.test(contentType);

  if (status === 200) {
    return { kind: "live", live: true, inconclusive: false, reason: `${url} answered 200` };
  }

  // 403 and 407 from something that is not the application itself is the
  // signature of an egress proxy. A ledger that wanted to refuse us would say so
  // in its own structured JSON envelope.
  if ((status === 403 || status === 407) && !isJson) {
    return {
      kind: "blocked",
      live: false,
      inconclusive: true,
      reason: `${url} returned ${status} with a non-JSON body — this is an egress proxy denying the host, not the deploy answering; run the suite from a machine that can reach it before recording a verdict`,
    };
  }

  if (status === 404) {
    return {
      kind: "route-missing",
      live: false,
      inconclusive: false,
      reason: `${url} returned 404 — the site answers but the ledger is not deployed at this path`,
    };
  }

  if (status >= 500) {
    return {
      kind: "unhealthy",
      live: false,
      inconclusive: false,
      reason: `${url} returned ${status} — the deploy is up but unhealthy`,
    };
  }

  return {
    kind: "unhealthy",
    live: false,
    inconclusive: false,
    reason: `${url} returned ${status}${input.body ? ` (${input.body.slice(0, 120)})` : ""}`,
  };
}

/** The short label the run header prints next to each target. */
export function reachabilityLabel(kind: Reachability): string {
  switch (kind) {
    case "live":
      return "LIVE";
    case "blocked":
      return "BLOCKED";
    case "route-missing":
      return "NO ROUTE";
    case "unhealthy":
      return "UNHEALTHY";
    case "unreachable":
      return "UNREACHABLE";
  }
}
