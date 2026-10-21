import catalogData from "@/data/composio/catalog.json";

export interface ConnField {
  name: string;
  label: string;
  required: boolean;
  description?: string;
}

export interface Toolkit {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
  description: string;
  auth: string[];
  managed: string[];
  tools: number;
  triggers: number;
  oauth: {
    mode: string | null;
    scopes: string[];
    redirect: string | null;
    extra_config: { name: string; label: string; required: boolean }[];
    connection_fields: ConnField[];
  } | null;
  dcr: { scopes: string[] } | null;
}

interface Catalog {
  snapshot: { source: string; latest_toolkit_version: string; synced: string; count: number };
  toolkits: Toolkit[];
}

const catalog = catalogData as Catalog;
const bySlug = new Map(catalog.toolkits.map((t) => [t.slug, t]));

/** Composio's current OAuth callback. Some toolkit defaults still use the legacy https://backend.composio.dev/api/v1/auth-apps/add. */
export const COMPOSIO_REDIRECT_URI = "https://backend.composio.dev/api/v3/toolkits/auth/callback";
export const COMPOSIO_LEGACY_REDIRECT_URI = "https://backend.composio.dev/api/v1/auth-apps/add";

export function catalogSnapshot() {
  return catalog.snapshot;
}

/** "20261015_01" → "2026-10-15" */
export function snapshotDate(): string {
  const v = catalog.snapshot.latest_toolkit_version;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : catalog.snapshot.synced;
}

export function getToolkit(slug: string | null | undefined): Toolkit | null {
  if (!slug) return null;
  return bySlug.get(slug) ?? null;
}

export function allToolkits(): Toolkit[] {
  return catalog.toolkits;
}

export function hasOAuth(t: Toolkit): boolean {
  return t.auth.includes("OAUTH2") || t.auth.includes("OAUTH1");
}

export function isManagedOAuth(t: Toolkit): boolean {
  return t.managed.includes("OAUTH2") || t.managed.includes("OAUTH1");
}

export type ToolkitKind = "managed" | "byo" | "dcr" | "no_oauth";

/** What Composio's data alone says about the OAuth app question for this toolkit. */
export function toolkitKind(t: Toolkit): ToolkitKind {
  if (hasOAuth(t)) return isManagedOAuth(t) ? "managed" : "byo";
  if (t.dcr) return "dcr";
  return "no_oauth";
}

export function catalogStats() {
  const ts = catalog.toolkits;
  const oauth2 = ts.filter((t) => t.auth.includes("OAUTH2"));
  const managed = oauth2.filter((t) => t.managed.includes("OAUTH2"));
  const byo = oauth2.filter((t) => !t.managed.includes("OAUTH2"));
  return {
    total: ts.length,
    oauth2: oauth2.length,
    managed: managed.length,
    byo: byo.length,
    byoOAuthOnly: byo.filter((t) => t.auth.length === 1).length,
    byoWithApiKey: byo.filter((t) => t.auth.includes("API_KEY")).length,
    dcr: ts.filter((t) => t.dcr).length,
    apiKeyOnly: ts.filter((t) => !hasOAuth(t) && !t.dcr).length,
  };
}

/** Names people type that map to several toolkits; the user is asked to pick. */
const AMBIGUOUS: Record<string, string[]> = {
  meta: ["facebook", "instagram", "whatsapp", "metaads"],
  facebook: ["facebook", "metaads", "instagram"],
  microsoft: ["outlook", "microsoft_teams", "one_drive", "share_point", "onenote", "microsoft_power_bi", "microsoft_todo"],
  "microsoft 365": ["outlook", "microsoft_teams", "one_drive", "share_point"],
  "office 365": ["outlook", "microsoft_teams", "one_drive", "share_point"],
  office: ["outlook", "microsoft_teams", "one_drive", "share_point"],
  m365: ["outlook", "microsoft_teams", "one_drive", "share_point"],
  google: ["gmail", "googledrive", "googlecalendar", "googlesheets", "googledocs", "googlemeet", "googleads", "google_analytics"],
  "google workspace": ["gmail", "googledrive", "googlecalendar", "googlesheets", "googledocs", "googlemeet"],
  gsuite: ["gmail", "googledrive", "googlecalendar", "googlesheets", "googledocs"],
  atlassian: ["jira", "confluence", "atlassian_mcp"],
  zoho: ["zoho", "zoho_books", "zoho_desk", "zoho_mail", "zoho_invoice", "zoho_inventory", "zoho_bigin"],
  sharepoint: ["share_point", "sharepoint_graph"],
};

/** Names that mean exactly one toolkit. */
const ALIASES: Record<string, string> = {
  x: "twitter",
  "x.com": "twitter",
  "twitter/x": "twitter",
  teams: "microsoft_teams",
  "ms teams": "microsoft_teams",
  "microsoft teams": "microsoft_teams",
  outlook: "outlook",
  "outlook.com": "outlook",
  "google mail": "gmail",
  "google drive": "googledrive",
  drive: "googledrive",
  "google calendar": "googlecalendar",
  "google sheets": "googlesheets",
  "google docs": "googledocs",
  onedrive: "one_drive",
  "one drive": "one_drive",
  "power bi": "microsoft_power_bi",
  sfdc: "salesforce",
  hubspot: "hubspot",
  clio: "clio_manage",
};

export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface SearchHit {
  toolkit: Toolkit;
  score: number;
}

/** Fuzzy search over the catalogue. Higher score = better; 100 = exact. */
export function searchCatalog(query: string, limit = 12): SearchHit[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const qc = compact(q.replace(/\.(com|io|ai|co|app|dev|net|org)$/, ""));
  if (!qc) return [];
  const hits: SearchHit[] = [];
  for (const t of catalog.toolkits) {
    const nc = compact(t.name);
    const sc = compact(t.slug);
    let score = 0;
    if (sc === qc || nc === qc) score = 100;
    else if (nc.startsWith(qc) || sc.startsWith(qc)) score = 70 - Math.min(20, nc.length - qc.length);
    else if (qc.length >= 3 && (nc.includes(qc) || sc.includes(qc))) score = 45 - Math.min(20, nc.length - qc.length);
    else if (qc.length >= 4 && qc.includes(nc) && nc.length >= 4) score = 35;
    if (score > 0) {
      // Prefer OAuth toolkits and well-used ones on ties.
      score += hasOAuth(t) ? 3 : 0;
      score += Math.min(5, Math.log10(1 + t.tools));
      hits.push({ toolkit: t, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type Resolution =
  | { kind: "toolkit"; toolkit: Toolkit }
  | { kind: "candidates"; candidates: Toolkit[]; reason: string }
  | { kind: "none" };

/**
 * Resolve free text to one toolkit, several candidates, or nothing.
 * Ambiguous brand names ("Meta", "Google") always ask; otherwise an exact match wins.
 */
export function resolveToolkit(query: string): Resolution {
  const q = normalizeQuery(query);
  if (!q) return { kind: "none" };
  const amb = AMBIGUOUS[q];
  if (amb) {
    const candidates = amb.map((s) => getToolkit(s)).filter((t): t is Toolkit => !!t);
    if (candidates.length) return { kind: "candidates", candidates, reason: `"${query.trim()}" covers several products. Which one?` };
  }
  const alias = ALIASES[q];
  if (alias && getToolkit(alias)) return { kind: "toolkit", toolkit: getToolkit(alias)! };
  // Websites: "getjobber.com" → jobber, "slackhq.com" → slack.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(q)) {
    const label = compact(q.split(".").filter((p) => !["app", "api", "developer", "developers", "docs"].includes(p))[0] ?? "");
    const stem = label.replace(/^(get|try|use|join|go|my)(?=[a-z]{3})/, "").replace(/(hq|app|inc)$/, "");
    for (const cand of [label, stem]) {
      const t = catalog.toolkits.find((x) => compact(x.slug) === cand || compact(x.name) === cand);
      if (t) return { kind: "toolkit", toolkit: t };
    }
  }
  const hits = searchCatalog(q, 8);
  if (hits.length === 0) return { kind: "none" };
  const exact = hits.filter((h) => h.score >= 100);
  if (exact.length >= 1) {
    // e.g. "notion" exactly matches notion; notion_mcp is a sibling worth offering only if asked.
    return { kind: "toolkit", toolkit: exact[0].toolkit };
  }
  return { kind: "none" };
}

/** Sibling toolkits for the same provider (e.g. notion + notion_mcp). */
export function siblings(t: Toolkit): Toolkit[] {
  const base = t.slug.replace(/_mcp$/, "");
  return catalog.toolkits.filter((x) => x.slug !== t.slug && (x.slug === base || x.slug === `${base}_mcp`));
}

/** Slim index for client-side search. */
export function searchIndex() {
  return catalog.toolkits.map((t) => ({
    s: t.slug,
    n: t.name,
    k: toolkitKind(t),
    c: t.category,
    t: t.tools,
  }));
}
