import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isProviderId, PROVIDERS, type KeyStatus } from "./catalog";
import { envCredentials } from "./index";
import type { Credentials } from "./types";

/**
 * A user's own API key, pasted in the UI, is kept in an encrypted HttpOnly cookie:
 * - encrypted with AES-256-GCM under a server secret (APP_SECRET), so the stored value is useless on its own;
 * - HttpOnly, so page scripts can never read it; SameSite=Strict, so other sites cannot use it;
 * - never written to the server's storage, never logged, never sent back to the browser.
 */

export const KEY_COOKIE = "or_llm";
const VERSION = "v1";

let cached: Buffer | null = null;

/** APP_SECRET in production. Locally, a random secret is created once in .data/ so keys survive restarts. */
function secret(): Buffer {
  if (cached) return cached;
  const env = process.env.APP_SECRET;
  if (env && env.length >= 16) {
    cached = crypto.createHash("sha256").update(env).digest();
    return cached;
  }
  if (!process.env.VERCEL) {
    try {
      const dir = path.join(process.cwd(), ".data");
      const file = path.join(dir, "app-secret");
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
      cached = crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").trim()).digest();
      return cached;
    } catch {
      /* fall through to a per-process secret */
    }
  }
  cached = crypto.randomBytes(32);
  return cached;
}

export function secretConfigured(): boolean {
  return !!(process.env.APP_SECRET && process.env.APP_SECRET.length >= 16);
}

export function seal(c: Credentials): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ p: c.provider, k: c.apiKey, m: c.model }), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function unseal(token: string | undefined | null): Credentials | null {
  if (!token || !token.startsWith(`${VERSION}.`)) return null;
  try {
    const raw = Buffer.from(token.slice(VERSION.length + 1), "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    if (!isProviderId(json.p) || typeof json.k !== "string" || typeof json.m !== "string") return null;
    return { provider: json.p, apiKey: json.k, model: json.m };
  } catch {
    return null;
  }
}

export function keyHint(key: string): string {
  return `…${key.slice(-4)}`;
}

/** Basic shape checks before contacting the provider. */
export function checkKeyShape(provider: string, key: string, model: string): string | null {
  if (!isProviderId(provider)) return "Choose a provider.";
  if (!key || key.length < 20 || key.length > 300 || /\s/.test(key)) return "That does not look like an API key.";
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) return "Model names can contain letters, numbers, dots, dashes and colons.";
  return null;
}

type CookieReader = { get(name: string): { value: string } | undefined };

export type CredentialSource = "browser" | "server";

/** The user's own key wins; otherwise the deployment's key from environment variables. */
export function resolveCredentials(cookies: CookieReader): { creds: Credentials; source: CredentialSource } | null {
  const fromCookie = unseal(cookies.get(KEY_COOKIE)?.value);
  if (fromCookie) return { creds: fromCookie, source: "browser" };
  const fromEnv = envCredentials();
  if (fromEnv) return { creds: fromEnv, source: "server" };
  return null;
}

export function publicStatus(cookies: CookieReader): KeyStatus {
  const browser = unseal(cookies.get(KEY_COOKIE)?.value);
  const server = envCredentials();
  return {
    active: browser ? "browser" : server ? "server" : null,
    browser: browser ? { provider: browser.provider, vendor: PROVIDERS[browser.provider].vendor, model: browser.model, hint: keyHint(browser.apiKey) } : null,
    server: server ? { provider: server.provider, vendor: PROVIDERS[server.provider].vendor, model: server.model } : null,
  };
}

/** Rejects cross-site requests to endpoints that use or set the key cookie. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers and server-to-server calls
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
