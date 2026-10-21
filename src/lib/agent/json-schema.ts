import { z } from "zod";

/**
 * Convert a zod schema to the JSON Schema subset structured output accepts, keeping `enum`.
 * (The SDK's helper, as of @anthropic-ai/sdk 0.135, moves `enum` into the description, which
 * leaves the model unconstrained. The API itself supports enums.)
 * Every object gets additionalProperties: false and all properties required; unsupported
 * keywords are dropped. The response is validated with the same zod schema afterwards.
 */
const KEEP = new Set(["type", "properties", "items", "enum", "const", "description", "required", "additionalProperties", "anyOf", "$defs", "$ref"]);

type Json = Record<string, unknown>;

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties" || k === "$defs") out[k] = Object.fromEntries(Object.entries(v as Json).map(([pk, pv]) => [pk, strict(pv)]));
    else if (k === "items" || k === "anyOf") out[k] = strict(v);
    else out[k] = v;
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    out.required = Object.keys((out.properties as Json) ?? {});
  }
  return out;
}

export function toStructuredOutputSchema(schema: z.ZodType): Json {
  return strict(z.toJSONSchema(schema, { reused: "inline", unrepresentable: "any" })) as Json;
}

/** Counts that must stay within structured-output limits (24 optional, 16 union-typed properties). */
export function schemaStats(schema: Json) {
  let objects = 0;
  let optional = 0;
  let unions = 0;
  let enums = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as Json;
    if (o.type === "object") {
      objects++;
      const props = Object.keys((o.properties as Json) ?? {});
      const req = new Set((o.required as string[]) ?? []);
      optional += props.filter((p) => !req.has(p)).length;
    }
    if (o.anyOf || Array.isArray(o.type)) unions++;
    if (Array.isArray(o.enum)) enums++;
    Object.values(o).forEach(walk);
  };
  walk(schema);
  return { objects, optional, unions, enums, bytes: JSON.stringify(schema).length };
}
