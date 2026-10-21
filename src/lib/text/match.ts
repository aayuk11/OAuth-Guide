/**
 * Excerpt matching used by the critic and by source re-verification.
 * An excerpt "matches" a page when, after normalisation, it appears verbatim, or when
 * most of its word 4-grams appear in the page (tolerates markup splits and small edits).
 */

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’‛′`´]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^a-z0-9$%.\-' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return normalize(s)
    .replace(/[.'"-]/g, " ")
    .split(" ")
    .filter(Boolean);
}

function shingles(ws: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

export interface MatchResult {
  match: boolean;
  score: number;
  method: "exact" | "shingles" | "none";
}

export interface PreparedText {
  norm: string;
  grams: Set<string>;
}

export function prepare(text: string): PreparedText {
  const norm = normalize(text).replace(/[.'"-]/g, " ").replace(/\s+/g, " ");
  return { norm, grams: shingles(norm.split(" ").filter(Boolean), 4) };
}

export function matchExcerpt(excerpt: string, page: PreparedText | string, threshold = 0.7): MatchResult {
  const p = typeof page === "string" ? prepare(page) : page;
  const ew = words(excerpt);
  if (ew.length === 0) return { match: false, score: 0, method: "none" };
  const en = ew.join(" ");
  if (p.norm.includes(en)) return { match: true, score: 1, method: "exact" };
  if (ew.length < 6) return { match: false, score: 0, method: "none" };
  const eg = shingles(ew, 4);
  let hit = 0;
  for (const g of eg) if (p.grams.has(g)) hit++;
  const score = eg.size ? hit / eg.size : 0;
  return { match: score >= threshold, score, method: score >= threshold ? "shingles" : "none" };
}
