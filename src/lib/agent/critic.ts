import type { Evidence, Guide } from "@/lib/guide/schema";
import { matchExcerpt, prepare, type PreparedText } from "@/lib/text/match";
import type { Source } from "@/lib/llm/types";

/**
 * The critic is code, not a model. It checks every quoted excerpt against the text the agent
 * actually read, downgrades what it cannot find, relabels community sources, and removes
 * timelines that rest only on unverified evidence. Deterministic and explainable in one sentence.
 */

const COMMUNITY =
  /(^|\.)(reddit\.com|stackoverflow\.com|stackexchange\.com|medium\.com|dev\.to|quora\.com|hashnode\.(dev|com)|substack\.com|youtube\.com|news\.ycombinator\.com|linkedin\.com\/pulse|nango\.dev|merge\.dev|useparagon\.com|pipedream\.com|unified\.to|scalekit\.com|arcade\.dev|composio\.dev\/blog)|(^|\.)(community|forum|forums|discuss|devforum|answers|support-community)\./i;

export function isCommunityUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return COMMUNITY.test(u.hostname) || COMMUNITY.test(`${u.hostname}${u.pathname}`) || /\/(community|forum|forums|discussions?|t)\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Same form the assembler gives evidence URLs (new URL().toString()), so lookups match: "https://x.com" and "https://x.com/" are one page. */
function pageKey(u: string): string {
  const bare = u.split("#")[0];
  try {
    return new URL(bare).toString();
  } catch {
    return bare;
  }
}

export interface CriticStats {
  checked: number;
  downgraded: number;
  numbers_removed: number;
  notes: string[];
}

export function runCritic(guide: Guide, sources: Source[]): { guide: Guide; stats: CriticStats } {
  const texts = new Map<string, PreparedText>();
  const raw = new Map<string, Source>();
  for (const s of sources) {
    const body = [s.text, ...s.cited].filter(Boolean).join("\n");
    raw.set(pageKey(s.url), s);
    if (body) texts.set(pageKey(s.url), prepare(body));
  }
  const stats: CriticStats = { checked: 0, downgraded: 0, numbers_removed: 0, notes: [] };

  const evidence: Evidence[] = guide.evidence.map((e) => {
    if (e.label === "tested") return e;
    if (!e.url) {
      return e.label === "unverified" ? e : { ...e, label: "unverified", corrected: { from: e.label, reason: "no source given" } };
    }
    stats.checked++;
    const key = pageKey(e.url);
    const page = texts.get(key);
    const src = raw.get(key);
    if (!page || !e.excerpt) {
      if (e.label === "unverified") return e;
      stats.downgraded++;
      return {
        ...e,
        label: "unverified",
        corrected: { from: e.label, reason: src ? "the agent saw this page only as a search result, so the quote could not be checked" : "the agent never opened this page" },
      };
    }
    const m = matchExcerpt(e.excerpt, page);
    if (!m.match) {
      if (e.label === "unverified") return e;
      stats.downgraded++;
      return { ...e, label: "unverified", corrected: { from: e.label, reason: `quote not found on the page the agent read (match ${Math.round(m.score * 100)}%)` } };
    }
    if (e.label === "official" && isCommunityUrl(e.url)) {
      stats.downgraded++;
      return { ...e, label: "reported", corrected: { from: "official", reason: "community or third-party site" } };
    }
    return e;
  });

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const onlyUnverified = (ids: string[]) => ids.length === 0 || ids.every((id) => (byId.get(id)?.label ?? "unverified") === "unverified");

  const paths = guide.paths.map((p) => ({
    ...p,
    gates: p.gates.map((g) => {
      if (g.wait && (g.wait.min != null || g.wait.max != null) && onlyUnverified(g.evidence)) {
        stats.numbers_removed++;
        stats.notes.push(`Removed the timeline for "${g.title}": no verified source states it.`);
        return { ...g, wait: null };
      }
      return g;
    }),
  }));

  if (stats.downgraded) stats.notes.unshift(`${stats.downgraded} of ${stats.checked} quoted sources could not be confirmed and were downgraded.`);
  return { guide: { ...guide, evidence, paths }, stats };
}
