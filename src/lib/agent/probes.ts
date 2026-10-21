import { safeFetch, safeFetchJson, SafeFetchError } from "@/lib/net/safe-fetch";
import type { Evidence, Probe } from "@/lib/guide/schema";

/**
 * Probes are the agent's hands-on attempts: they hit real endpoints and record what came back.
 * Everything they produce is labelled Tested with today's date.
 */

const today = () => new Date().toISOString().slice(0, 10);

export interface DiscoveryResult {
  probe: Probe;
  registrationEndpoint: string | null;
  cimd: boolean;
}

function hostOf(u: string): string | null {
  try {
    return new URL(u.includes("://") ? u : `https://${u}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** "app.example.co.uk" → "example.co.uk" (good enough for probing mcp./auth. hosts). */
export function apexOf(host: string): string {
  const parts = host.split(".");
  const twoLevel = /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
  return parts.slice(twoLevel ? -3 : -2).join(".");
}

async function discovery(url: string, kind: Probe["kind"]): Promise<DiscoveryResult | null> {
  try {
    const { status, json } = await safeFetchJson(url, { timeoutMs: 4500, maxBytes: 300_000 });
    if (status >= 400 || !json || typeof json !== "object") return null;
    const doc = json as Record<string, unknown>;
    if (typeof doc.authorization_endpoint !== "string" && typeof doc.issuer !== "string") return null;
    const reg = typeof doc.registration_endpoint === "string" ? doc.registration_endpoint : null;
    const pkce = Array.isArray(doc.code_challenge_methods_supported) ? (doc.code_challenge_methods_supported as string[]) : [];
    const cimd = doc.client_id_metadata_document_supported === true;
    const parts = [
      reg ? `registration_endpoint: ${reg}` : "no registration_endpoint (apps must be registered manually)",
      pkce.length ? `PKCE: ${pkce.join(", ")}` : "PKCE methods not advertised",
    ];
    if (cimd) parts.push("Client ID Metadata Documents supported");
    return {
      probe: {
        kind,
        target: url,
        ok: true,
        summary: parts.join("; "),
        data: {
          issuer: doc.issuer ?? null,
          authorization_endpoint: doc.authorization_endpoint ?? null,
          token_endpoint: doc.token_endpoint ?? null,
          registration_endpoint: reg,
          code_challenge_methods_supported: pkce,
          grant_types_supported: Array.isArray(doc.grant_types_supported) ? doc.grant_types_supported : null,
          scopes_supported_count: Array.isArray(doc.scopes_supported) ? doc.scopes_supported.length : null,
        },
      },
      registrationEndpoint: reg,
      cimd,
    };
  } catch {
    return null;
  }
}

/** Probe OAuth/OIDC/MCP discovery documents for a provider host. Returns every document found. */
export async function probeDiscovery(input: string): Promise<DiscoveryResult[]> {
  const host = hostOf(input);
  if (!host || !host.includes(".")) return [];
  const apex = apexOf(host);
  const hosts = [...new Set([host, apex, `mcp.${apex}`, `auth.${apex}`, `login.${apex}`, `accounts.${apex}`, `api.${apex}`])];
  const tasks: Promise<DiscoveryResult | null>[] = [];
  for (const h of hosts) {
    tasks.push(discovery(`https://${h}/.well-known/oauth-authorization-server`, h.startsWith("mcp.") ? "mcp_discovery" : "oauth_discovery"));
    tasks.push(discovery(`https://${h}/.well-known/openid-configuration`, "oidc_discovery"));
  }
  const found = (await Promise.all(tasks)).filter((x): x is DiscoveryResult => !!x);
  // One result per issuer/target host keeps the evidence list short.
  const seen = new Set<string>();
  return found.filter((f) => {
    const key = `${f.probe.kind}:${String(f.probe.data?.issuer ?? f.probe.target)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function probeUrlLive(url: string): Promise<Probe> {
  try {
    const res = await safeFetch(url, { timeoutMs: 6000, maxBytes: 1_500_000 });
    const ok = res.status < 400;
    return {
      kind: "url_live",
      target: url,
      ok,
      summary: ok ? `responds with HTTP ${res.status}${res.url !== url ? ` (redirects to ${res.url})` : ""}` : `returns HTTP ${res.status}`,
      data: { status: res.status, final_url: res.url, ms: res.ms },
    };
  } catch (e) {
    const msg = e instanceof SafeFetchError ? e.message : "could not be reached";
    return { kind: "url_live", target: url, ok: false, summary: `could not be reached (${msg})`, data: {} };
  }
}

/** Checks a redirect URI the way providers do: absolute, https, no fragment, no wildcards. */
export function checkRedirectUri(uri: string): Probe {
  const problems: string[] = [];
  let u: URL | null = null;
  try {
    u = new URL(uri);
  } catch {
    problems.push("not an absolute URL");
  }
  if (u) {
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) problems.push("must use https (http only for localhost)");
    if (u.hash) problems.push("must not contain a #fragment");
    if (uri.includes("*")) problems.push("wildcards are rejected by most providers");
    if (u.username || u.password) problems.push("must not contain credentials");
  }
  if (uri !== uri.trim()) problems.push("has leading or trailing spaces (exact match will fail)");
  return {
    kind: "redirect_uri",
    target: uri,
    ok: problems.length === 0,
    summary: problems.length ? `Problems: ${problems.join("; ")}` : "Format is valid. It must also match the registered value exactly, including trailing slashes.",
  };
}

export function probeEvidence(id: string, probe: Probe, title: string): Evidence {
  return {
    id,
    label: "tested",
    url: /^https?:\/\//.test(probe.target) ? probe.target : null,
    title,
    publisher: "This tool (automated probe)",
    retrieved: today(),
    excerpt: probe.summary,
    probe,
  };
}
