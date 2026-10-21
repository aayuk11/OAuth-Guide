import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";

/**
 * Fetch for URLs that come from users or from an LLM. Guards against SSRF:
 * - http(s) only, standard ports only
 * - every resolved address must be public (checked at connect time, so DNS rebinding
 *   between check and connect is not possible)
 * - redirects re-checked hop by hop, max 4
 * - timeout and response size cap
 */

export class SafeFetchError extends Error {
  constructor(
    message: string,
    public code: "blocked" | "timeout" | "too_large" | "bad_url" | "network" | "too_many_redirects",
  ) {
    super(message);
  }
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  ms: number;
}

export interface SafeFetchOptions {
  /** Idle timeout per request. The whole fetch, redirects included, is also capped at twice this. */
  timeoutMs?: number;
  maxBytes?: number;
  method?: "GET" | "HEAD";
  accept?: string;
  maxRedirects?: number;
}

const UA = "Mozilla/5.0 (compatible; OAuthReadinessBot/1.0; developer-guide research)";

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    const c = Number(ip.split(".")[2]);
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF assignments, TEST-NET-1
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return true; // TEST-NET-2/3
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // link local
    if (v.startsWith("ff")) return true; // multicast
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError(`Not a valid URL: ${raw.slice(0, 120)}`, "bad_url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SafeFetchError("Only http(s) URLs are allowed", "bad_url");
  if (u.username || u.password) throw new SafeFetchError("URLs with credentials are not allowed", "bad_url");
  if (u.port && u.port !== "443" && u.port !== "80") throw new SafeFetchError("Only standard ports are allowed", "blocked");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) throw new SafeFetchError("Private addresses are not allowed", "blocked");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host) || !host.includes("."))
    throw new SafeFetchError("Internal hostnames are not allowed", "blocked");
  return u;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new SafeFetchError(`Blocked: ${hostname} resolves to a private address`, "blocked"), "", 0);
    }
    if (options && (options as dns.LookupAllOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function requestOnce(u: URL, opts: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes" | "method" | "accept">>, deadline: number) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolveRaw, rejectRaw) => {
    // The socket timeout resets on every byte, so a server that trickles data could hold the
    // request open indefinitely. The deadline caps the whole request.
    const deadlineTimer: { id?: ReturnType<typeof setTimeout> } = {};
    const resolve = (v: { status: number; headers: http.IncomingHttpHeaders; body: string }) => {
      clearTimeout(deadlineTimer.id);
      resolveRaw(v);
    };
    const reject = (e: unknown) => {
      clearTimeout(deadlineTimer.id);
      rejectRaw(e);
    };
    const left = deadline - Date.now();
    if (left <= 0) return reject(new SafeFetchError("Timed out", "timeout"));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: opts.method,
        lookup: guardedLookup,
        headers: {
          "user-agent": UA,
          accept: opts.accept,
          "accept-language": "en-US,en;q=0.8",
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            req.destroy(new SafeFetchError("Response too large", "too_large"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    deadlineTimer.id = setTimeout(() => req.destroy(new SafeFetchError("Timed out", "timeout")), left);
    req.on("timeout", () => req.destroy(new SafeFetchError("Timed out", "timeout")));
    req.on("error", (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError(e.message, "network")));
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 6000,
    maxBytes: options.maxBytes ?? 2_000_000,
    method: options.method ?? "GET",
    accept: options.accept ?? "text/html,application/json;q=0.9,*/*;q=0.5",
  };
  const maxRedirects = options.maxRedirects ?? 4;
  const started = Date.now();
  const deadline = started + opts.timeoutMs * 2;
  let u = checkUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(u, opts, deadline);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      u = checkUrl(new URL(res.headers.location, u).toString());
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers[k] = v;
    return { url: u.toString(), status: res.status, headers, body: res.body, ms: Date.now() - started };
  }
  throw new SafeFetchError("Too many redirects", "too_many_redirects");
}

export async function safeFetchJson(rawUrl: string, options: SafeFetchOptions = {}): Promise<{ status: number; json: unknown; url: string }> {
  const res = await safeFetch(rawUrl, { ...options, accept: "application/json" });
  let json: unknown = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  return { status: res.status, json, url: res.url };
}
