import type { Evidence, Guide, GuidePath } from "@/lib/guide/schema";

export function ev(id: string, label: Evidence["label"], extra: Partial<Evidence> = {}): Evidence {
  return {
    id,
    label,
    url: label === "unverified" ? null : `https://example.com/${id}`,
    title: id,
    retrieved: "2026-10-20",
    excerpt: label === "official" ? "Some official text." : undefined,
    ...extra,
  };
}

export function path(id: string, gates: GuidePath["gates"], extra: Partial<GuidePath> = {}): GuidePath {
  return { id, label: id, summary: id, applies: {}, scopes: [], gates, badges: [], start_here: [{ when: "Day 1", action: "Start", owner: "you" }], ...extra };
}

export function guide(paths: GuidePath[], evidence: Evidence[], extra: Partial<Guide> = {}): Guide {
  return {
    schema_version: 1,
    slug: "test",
    kind: "curated",
    composio_slug: null,
    app: { name: "Test", provider: "Test", website: null, developer_portal: null, docs_url: null },
    headline: "Test guide",
    oauth: { supported: "yes", registration: "manual", notes: [], evidence: [evidence[0].id] },
    paths,
    scopes: [],
    prerequisites: [],
    steps: [
      { id: "s1", title: "Create app", detail: "x", owner: "you", type: "create_app", paths: ["*"], evidence: [] },
      { id: "s2", title: "Record video", detail: "x", owner: "you", type: "record_video", paths: [paths[paths.length - 1].id], evidence: [] },
    ],
    while_you_wait: [],
    blockers: [],
    checks: [],
    unknowns: [],
    composio_notes: [],
    evidence,
    last_verified: "2026-10-20",
    ...extra,
  };
}
