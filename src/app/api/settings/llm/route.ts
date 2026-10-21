import { cookies } from "next/headers";
import { isProviderId, PROVIDERS, validateKey } from "@/lib/llm";
import { checkKeyShape, KEY_COOKIE, keyHint, publicStatus, sameOrigin, seal, secretConfigured } from "@/lib/llm/credentials";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Only API routes read the key, so the cookie is never sent with page requests. */
const COOKIE_PATH = "/api";
const NO_STORE = { "Cache-Control": "no-store" };

function isHttps(req: Request) {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim().slice(0, 64);
}

/** Which key is active. Never returns the key: only the provider, model and last four characters. */
export async function GET() {
  return Response.json(publicStatus(await cookies()), { headers: NO_STORE });
}

/** Test a key with a read-only call to the provider, then keep it encrypted in an HttpOnly cookie. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  let body: { provider?: unknown; apiKey?: unknown; model?: unknown; remember?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { provider, apiKey, model }" }, { status: 400 });
  }
  const provider = String(body.provider ?? "");
  const apiKey = String(body.apiKey ?? "").trim();
  const model = String(body.model ?? "").trim() || (isProviderId(provider) ? PROVIDERS[provider].defaultModel : "");
  // On serverless hosts each instance would otherwise invent its own secret, so a saved key would
  // work on one request and silently vanish on the next.
  if (process.env.VERCEL && !secretConfigured())
    return Response.json({ error: "This site cannot store keys yet: its owner must set APP_SECRET (32+ random characters) in the hosting settings and redeploy." }, { status: 503 });
  const shape = checkKeyShape(provider, apiKey, model);
  if (shape) return Response.json({ error: shape }, { status: 400 });

  // Stops this endpoint being used to test lists of keys.
  const tries = await store().incr(`rl:keycheck:${clientIp(req)}:${new Date().toISOString().slice(0, 13)}`, 3600);
  if (tries > 20) return Response.json({ error: "Too many key checks from this network. Try again in an hour." }, { status: 429 });

  const p = provider as keyof typeof PROVIDERS;
  const check = await validateKey(p, apiKey);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const jar = await cookies();
  jar.set(KEY_COOKIE, seal({ provider: p, apiKey, model }), {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttps(req),
    path: COOKIE_PATH,
    ...(body.remember === true ? { maxAge: 30 * 86400 } : {}),
  });
  return Response.json(
    {
      active: "browser",
      browser: { provider: p, vendor: PROVIDERS[p].vendor, model, hint: keyHint(apiKey) },
      server: publicStatus(jar).server,
    },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  const jar = await cookies();
  jar.set(KEY_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: isHttps(req), path: COOKIE_PATH, maxAge: 0 });
  const server = publicStatus({ get: () => undefined }).server;
  return Response.json({ active: server ? "server" : null, browser: null, server }, { headers: NO_STORE });
}
