/**
 * Where the relay's deploys live.
 *
 * Netlify names a branch deploy `https://<branch>--<site>.netlify.app`, so the
 * `loop` branch of site `clvi-gameclient` is `https://loop--clvi-gameclient.netlify.app`.
 *
 * IMPORTANT — these defaults are a *convention*, not an observation. As of the
 * bootstrap session no sibling had a Netlify site (clvi-backend's own STATE.md:
 * "Netlify site: not yet created"), so every URL below is a prediction of where
 * the deploy will appear if the site is named after the repo. Both consumers
 * override them without a code change:
 *
 *   - the acceptance page, from its Targets panel (persisted per phone)
 *   - the smoke suite, from env vars (STRATA_BACKEND_BASE, ...)
 *
 * When a real URL is known, fix the default here and record it in docs/STATE.md.
 */

export type TargetId = "backend" | "gameclient" | "frontend" | "architecture" | "infrastructure";

export interface Target {
  id: TargetId;
  /** GitHub repo under github.com/Apocrypthon. */
  repo: string;
  /** Assumed Netlify site name. */
  site: string;
  label: string;
  /** What an acceptance run uses it for. */
  role: string;
  /** Env var that overrides the base URL for the smoke suite. */
  envVar: string;
  /** Where a checklist item that names this target should deep-link to. */
  path: string;
}

export const LOOP_BRANCH = "loop";

export function loopUrl(site: string, branch: string = LOOP_BRANCH): string {
  return `https://${branch}--${site}.netlify.app`;
}

export const TARGETS: readonly Target[] = [
  {
    id: "gameclient",
    repo: "clvi-gameclient",
    site: "clvi-gameclient",
    label: "Game client",
    role: "The shell itself: title pan, Paradise map, dig, settings, save-init.",
    envVar: "STRATA_GAMECLIENT_BASE",
    path: "/",
  },
  {
    id: "backend",
    repo: "clvi-backend",
    site: "clvi-backend",
    label: "Ledger backend",
    role: "/health, /challenge, /submit, /audit/latest, /verify.",
    envVar: "STRATA_BACKEND_BASE",
    path: "/health",
  },
  {
    id: "frontend",
    repo: "clvi-frontend",
    site: "clvi-frontend",
    label: "Frontend",
    role: "Accounts and the public shell around the game.",
    envVar: "STRATA_FRONTEND_BASE",
    path: "/",
  },
  {
    id: "architecture",
    repo: "clvi-architecture",
    site: "clvi-architecture",
    label: "Architecture",
    role: "Where Contracts v1 is frozen. Docs, not a deploy under test.",
    envVar: "STRATA_ARCHITECTURE_BASE",
    path: "/",
  },
  {
    id: "infrastructure",
    repo: "clvi-infrastructure",
    site: "clvi-infrastructure",
    label: "Infrastructure",
    role: "Deploy plumbing. Docs, not a deploy under test.",
    envVar: "STRATA_INFRASTRUCTURE_BASE",
    path: "/",
  },
] as const;

export function targetById(id: TargetId): Target {
  const found = TARGETS.find((t) => t.id === id);
  if (!found) throw new Error(`targetById: unknown target ${id}`);
  return found;
}

export function repoUrl(target: Target): string {
  return `https://github.com/Apocrypthon/${target.repo}`;
}

export function defaultBase(target: Target): string {
  return loopUrl(target.site);
}

/** Overrides keyed by target id, as the acceptance page and the tests store them. */
export type BaseOverrides = Partial<Record<TargetId, string>>;

/**
 * Trims a human-typed base URL into something safe to concatenate a path onto.
 * Returns null when the input cannot be a base URL — the caller shows the field
 * as invalid rather than silently falling back, because a silently wrong base is
 * how you spend an hour testing a deploy that isn't the one you meant.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // A bare host gets https:// prepended, but an explicit non-http scheme is
  // rejected rather than prefixed: prefixing turns "ftp://x.test" into
  // "https://ftp//x.test", which parses, points nowhere, and would send an
  // acceptance run at a host that does not exist. The `//` in the pattern is
  // what keeps a bare "localhost:8888" a host-and-port rather than a scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (scheme !== null && !/^https?$/i.test(scheme[1] ?? "")) return null;
  const withScheme = scheme === null ? `https://${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname === "") return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function resolveBase(target: Target, overrides: BaseOverrides = {}): string {
  const override = overrides[target.id];
  if (override !== undefined) {
    const normalized = normalizeBaseUrl(override);
    if (normalized !== null) return normalized;
  }
  return defaultBase(target);
}

/** The deep link an acceptance checklist item opens on the phone. */
export function deepLink(target: Target, overrides: BaseOverrides = {}): string {
  return `${resolveBase(target, overrides)}${target.path}`;
}

/** True when the base is still the unverified convention rather than a known URL. */
export function isAssumedBase(target: Target, overrides: BaseOverrides = {}): boolean {
  return resolveBase(target, overrides) === defaultBase(target);
}
