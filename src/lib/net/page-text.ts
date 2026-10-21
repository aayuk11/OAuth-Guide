import { safeFetch } from "./safe-fetch";
import { htmlToText, extractTitle } from "../text/html";

export interface PageText {
  url: string;
  status: number;
  title: string | null;
  text: string;
  via: "html" | "json" | "text" | "gatsby-page-data";
}

/** Collect human-readable strings from a JSON document (used for Gatsby page-data). */
function jsonStrings(v: unknown, out: string[]) {
  if (typeof v === "string") {
    if (v.length > 2 && /\s/.test(v)) out.push(v.includes("<") ? htmlToText(v) : v);
  } else if (Array.isArray(v)) {
    for (const x of v) jsonStrings(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) jsonStrings(x, out);
  }
}

/**
 * Fetch a public page and return its text. Falls back to Gatsby's page-data JSON for sites
 * that render client-side (e.g. developer.xero.com), since plain HTML has no content there.
 */
export async function fetchPageText(url: string, timeoutMs = 20000): Promise<PageText> {
  const clean = url.split("#")[0];
  const res = await safeFetch(clean, { timeoutMs, maxBytes: 8_000_000 });
  const ct = res.headers["content-type"] ?? "";
  if (ct.includes("json")) return { url: res.url, status: res.status, title: null, text: res.body, via: "json" };
  if (!ct.includes("html")) return { url: res.url, status: res.status, title: null, text: res.body, via: "text" };
  const title = extractTitle(res.body);
  const text = htmlToText(res.body);
  if (text.length < 200 && res.body.includes("___gatsby")) {
    const u = new URL(res.url);
    const p = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    // Gatsby sites may use a path prefix (developer.xero.com uses /documentation).
    const [first, ...rest] = p.split("/").filter(Boolean);
    const candidates = [`${u.origin}/page-data${p}page-data.json`];
    if (first) candidates.push(`${u.origin}/${first}/page-data/${rest.length ? `${rest.join("/")}/` : "index/"}page-data.json`, `${u.origin}/${first}/page-data${p}page-data.json`);
    for (const c of candidates) {
      try {
        const pd = await safeFetch(c, { timeoutMs, maxBytes: 8_000_000, accept: "application/json" });
        if (pd.status >= 400) continue;
        const parts: string[] = [];
        jsonStrings(JSON.parse(pd.body), parts);
        const t = parts.join("\n");
        if (t.length > 200) return { url: res.url, status: res.status, title, text: t, via: "gatsby-page-data" };
      } catch {
        /* try the next pattern */
      }
    }
  }
  return { url: res.url, status: res.status, title, text, via: "html" };
}
