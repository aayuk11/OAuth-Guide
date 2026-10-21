/**
 * Build the compact Composio catalogue from Composio's public docs dataset.
 * Source: https://github.com/ComposioHQ/composio/blob/next/docs/public/data/toolkits.json
 *
 * Usage: npm run data:sync                 (download the latest)
 *        npm run data:sync -- ./toolkits.json (use a local copy)
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_URL = "https://raw.githubusercontent.com/ComposioHQ/composio/next/docs/public/data/toolkits.json";

interface Field {
  name: string;
  displayName?: string;
  required?: boolean;
  default?: string | null;
  description?: string;
}
interface AuthDetail {
  mode: string;
  fields?: {
    auth_config_creation?: { required?: Field[]; optional?: Field[] };
    connected_account_initiation?: { required?: Field[]; optional?: Field[] };
  };
}
interface RawToolkit {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
  authSchemes?: string[];
  composioManagedAuthSchemes?: string[];
  toolCount?: number;
  triggerCount?: number;
  version?: string;
  authConfigDetails?: AuthDetail[];
}

const KNOWN_CONFIG = new Set(["client_id", "client_secret", "oauth_redirect_uri", "scopes"]);

function fieldsOf(d: AuthDetail | undefined) {
  if (!d?.fields) return null;
  const cfg = [...(d.fields.auth_config_creation?.required ?? []), ...(d.fields.auth_config_creation?.optional ?? [])];
  const conn = [...(d.fields.connected_account_initiation?.required ?? []), ...(d.fields.connected_account_initiation?.optional ?? [])];
  const scopes = (cfg.find((f) => f.name === "scopes")?.default ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const redirect = cfg.find((f) => f.name === "oauth_redirect_uri")?.default ?? null;
  return {
    scopes,
    redirect,
    extra_config: cfg.filter((f) => !KNOWN_CONFIG.has(f.name)).map((f) => ({ name: f.name, label: f.displayName ?? f.name, required: !!f.required })),
    connection_fields: conn.map((f) => ({ name: f.name, label: f.displayName ?? f.name, required: !!f.required, description: (f.description ?? "").slice(0, 200) })),
  };
}

async function main() {
  const local = process.argv[2];
  let raw: RawToolkit[];
  if (local) {
    raw = JSON.parse(fs.readFileSync(local, "utf8"));
  } else {
    console.log(`Downloading ${SOURCE_URL} ...`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = (await res.json()) as RawToolkit[];
  }

  const versions = raw.map((t) => t.version ?? "").filter(Boolean).sort();
  const latest = versions[versions.length - 1] ?? "";
  const toolkits = raw
    .map((t) => {
      const auth = t.authSchemes ?? [];
      const managed = t.composioManagedAuthSchemes ?? [];
      const oauthMode = auth.includes("OAUTH2") ? "OAUTH2" : auth.includes("OAUTH1") ? "OAUTH1" : null;
      const oauth = oauthMode ? fieldsOf(t.authConfigDetails?.find((d) => d.mode === oauthMode)) : null;
      const dcr = auth.includes("DCR_OAUTH") ? fieldsOf(t.authConfigDetails?.find((d) => d.mode === "DCR_OAUTH")) : null;
      return {
        slug: t.slug,
        name: t.name,
        logo: t.logo ?? null,
        category: t.category ?? null,
        description: (t.description ?? "").replace(/\s+/g, " ").slice(0, 220),
        auth,
        managed,
        tools: t.toolCount ?? 0,
        triggers: t.triggerCount ?? 0,
        oauth: oauth ? { mode: oauthMode, ...oauth } : null,
        dcr: dcr ? { scopes: dcr.scopes } : null,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const out = {
    snapshot: {
      source: "https://github.com/ComposioHQ/composio/blob/next/docs/public/data/toolkits.json",
      latest_toolkit_version: latest,
      synced: new Date().toISOString().slice(0, 10),
      count: toolkits.length,
    },
    toolkits,
  };
  const dir = path.join(process.cwd(), "src", "data", "composio");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "catalog.json"), JSON.stringify(out) + "\n");

  const oauth2 = toolkits.filter((t) => t.auth.includes("OAUTH2"));
  const managed = oauth2.filter((t) => t.managed.includes("OAUTH2"));
  console.log(
    `Wrote ${toolkits.length} toolkits (OAuth2 ${oauth2.length}, managed ${managed.length}, bring-your-own ${oauth2.length - managed.length}, DCR ${
      toolkits.filter((t) => t.dcr).length
    }). Latest toolkit version ${latest}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
