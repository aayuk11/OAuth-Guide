import { checkRedirectUri, probeDiscovery, probeUrlLive } from "@/lib/agent/probes";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Agent can do" checks. All outbound requests go through the SSRF-safe fetcher
 * (https/http only, public addresses only, timeouts, size caps), and are rate-limited per IP.
 */
export async function POST(req: Request) {
  let body: { kind?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { kind, value }" }, { status: 400 });
  }
  const value = String(body.value ?? "").trim().slice(0, 300);
  if (!value) return Response.json({ error: "Enter a value to check." }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || "local").trim().slice(0, 64);
  const n = await store().incr(`rl:check:${ip}:${new Date().toISOString().slice(0, 13)}`, 3600).catch(() => 0);
  if (n > 60) return Response.json({ error: "Too many checks from this network; try again later." }, { status: 429 });

  switch (body.kind) {
    case "redirect_uri": {
      const p = checkRedirectUri(String(body.value ?? "").slice(0, 300));
      return Response.json({ ok: p.ok, summary: p.summary });
    }
    case "url_live": {
      const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      const p = await probeUrlLive(url);
      return Response.json({ ok: p.ok, summary: p.summary });
    }
    case "oauth_discovery": {
      const found = await probeDiscovery(value);
      if (!found.length) return Response.json({ ok: false, summary: "No OAuth or OpenID discovery document found on this host or its usual auth subdomains." });
      const dcr = found.find((f) => f.registrationEndpoint);
      const lines = found.slice(0, 3).map((f) => `${new URL(f.probe.target).host}: ${f.probe.summary}`);
      return Response.json({ ok: true, summary: `${dcr ? "Self-registration available. " : "Manual registration required. "}${lines.join(" | ")}` });
    }
    default:
      return Response.json({ error: "Unknown check." }, { status: 400 });
  }
}
