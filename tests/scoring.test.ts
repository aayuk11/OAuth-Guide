import { describe, expect, it } from "vitest";
import { computeConfidence, computeEffort, computeLevel, computeWait, formatBusinessDays } from "@/lib/guide/scoring";
import { choosePath, parseIntake } from "@/lib/guide/intake";
import { ev, guide, path } from "./fixtures";

const evidence = [ev("e1", "official"), ev("e2", "official"), ev("e3", "reported"), ev("e4", "unverified")];
const map = new Map(evidence.map((e) => [e.id, e]));

describe("level", () => {
  it("is 1 with no gates", () => {
    const p = path("free", []);
    expect(computeLevel(guide([p], evidence), p).value).toBe(1);
  });
  it("is the highest gate level", () => {
    const p = path("hard", [
      { id: "g1", type: "brand_verification", title: "Brand", trigger: "x", avoid: null, wait: null, evidence: ["e1"] },
      { id: "g2", type: "security_assessment", title: "CASA", trigger: "x", avoid: null, wait: null, evidence: ["e1"] },
    ]);
    const l = computeLevel(guide([p], evidence), p);
    expect(l.value).toBe(4);
    expect(l.drivers.map((d) => d.id)).toEqual(["g2"]);
  });
  it("is unconfirmed when a level-deciding question is unknown", () => {
    const p = path("p", []);
    const g = guide([p], evidence, { checks: [{ q: "app_review", answer: "unknown", detail: "", evidence: [] }] });
    expect(computeLevel(g, p).unconfirmed).toBe(true);
  });
});

describe("calendar wait", () => {
  it("takes the longest of parallel gates", () => {
    const p = path("p", [
      { id: "a", type: "brand_verification", title: "A", trigger: "x", avoid: null, wait: { min: 2, max: 3, unit: "business_days" }, evidence: ["e1"] },
      { id: "b", type: "sensitive_scope_review", title: "B", trigger: "x", avoid: null, wait: { min: 3, max: 10, unit: "business_days" }, evidence: ["e2"] },
    ]);
    const w = computeWait(p, map);
    expect([w.min, w.max]).toEqual([3, 10]);
    expect(w.label).toBe("3–10 business days");
  });
  it("adds sequential gates", () => {
    const p = path("p", [
      { id: "a", type: "app_review", title: "A", trigger: "x", avoid: null, wait: { min: 1, max: 2, unit: "weeks" }, evidence: ["e1"] },
      { id: "b", type: "security_assessment", title: "B", trigger: "x", avoid: null, wait: { min: 5, max: 10, unit: "business_days" }, after: "a", evidence: ["e1"] },
    ]);
    const w = computeWait(p, map);
    expect([w.min, w.max]).toEqual([10, 20]);
    expect(w.label).toBe("2–4 weeks");
  });
  it("is open-ended when a gate has no published timeline", () => {
    const p = path("p", [
      { id: "a", type: "app_review", title: "A", trigger: "x", avoid: null, wait: { min: 5, max: 10, unit: "business_days" }, evidence: ["e1"] },
      { id: "b", type: "product_access", title: "B", trigger: "x", avoid: null, wait: null, evidence: ["e1"] },
    ]);
    expect(computeWait(p, map).label).toBe("5–10 business days+");
    const only = path("q", [{ id: "b", type: "product_access", title: "B", trigger: "x", avoid: null, wait: null, evidence: ["e1"] }]);
    expect(computeWait(only, map).label).toBe("No published timeline");
  });
  it("converts calendar days and marks yearly gates", () => {
    const p = path("p", [{ id: "a", type: "annual_reverification", title: "A", trigger: "x", avoid: null, wait: { min: 14, max: 14, unit: "days" }, recurring: "yearly", evidence: ["e1"] }]);
    expect(computeWait(p, map).label).toBe("10 business days, then yearly");
  });
  it("formats", () => {
    expect(formatBusinessDays(0, 1)).toBe("0–1 business day");
    expect(formatBusinessDays(30, 30)).toBe("6 weeks");
  });
});

describe("effort", () => {
  it("sums step-type minutes for the path plus Composio wiring", () => {
    const a = path("a", []);
    const b = path("b", []);
    const g = guide([a, b], evidence);
    expect(computeEffort(g, a).minutes).toBe(15 + 15);
    expect(computeEffort(g, b).minutes).toBe(15 + 90 + 15);
  });
});

describe("confidence", () => {
  const gate = (e: string) => ({ id: "g", type: "app_review" as const, title: "Review", trigger: "x", avoid: null, wait: null, evidence: [e] });
  it("is high when gates are official", () => {
    const p = path("p", [gate("e1")]);
    expect(computeConfidence(guide([p], evidence), p, map).value).toBe("high");
  });
  it("is medium when a gate rests on a community report", () => {
    const p = path("p", [gate("e3")]);
    expect(computeConfidence(guide([p], evidence), p, map).value).toBe("medium");
  });
  it("is low when a gate is unverified", () => {
    const p = path("p", [gate("e4")]);
    expect(computeConfidence(guide([p], evidence), p, map).value).toBe("low");
  });
  it("is medium when official sources conflict", () => {
    const conflicted = [ev("e1", "official", { conflicts_with: ["e2"] }), ev("e2", "official", { conflicts_with: ["e1"] })];
    const m = new Map(conflicted.map((e) => [e.id, e]));
    const p = path("p", [gate("e1")]);
    expect(computeConfidence(guide([p], conflicted), p, m).value).toBe("medium");
  });
});

describe("intake and path choice", () => {
  const own = path("own", [], { applies: { audience: ["own_org"] } });
  const pub = path("pub", [], { applies: { audience: ["external"], access: ["read"] }, recommended: true });
  const full = path("full", [], { applies: { audience: ["external"], access: ["admin"] } });
  const g = guide([own, pub, full], evidence);
  it("parses the URL and falls back to defaults", () => {
    expect(parseIntake({ audience: "own_org", access: "nope", brand: "no" })).toEqual({ audience: "own_org", access: "read", brand: false });
  });
  it("selects the matching path", () => {
    expect(choosePath(g, { audience: "own_org", access: "read", brand: true }).selected.id).toBe("own");
    expect(choosePath(g, { audience: "external", access: "admin", brand: true }).selected.id).toBe("full");
    expect(choosePath(g, { audience: "external", access: "write", brand: true }).fallback).toBe(true);
    expect(choosePath(g, { audience: "own_org", access: "read", brand: true }, "full").selected.id).toBe("full");
  });
});
