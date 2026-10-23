/**
 * Règles d'architecture et de sécurité vérifiées sur le code source (équivalent local des règles
 * Semgrep de la CI, voir .semgrep.yml). Chaque échec liste les fichiers en cause.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url).pathname;
const IGNORED = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "coverage",
  "test-results",
  ".git",
  ".data",
  ".e2e-outbox",
  ".e2e-documents",
  "drizzle",
]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (IGNORED.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}
const all = files(join(ROOT, "apps")).concat(files(join(ROOT, "packages")));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const isTest = (f: string) =>
  /(\.test\.tsx?|\/test\/|\/e2e\/|playwright\.config\.ts|vitest\.config\.ts)/.test(f);
const offenders = (pred: (f: string, src: string) => boolean, list = all) =>
  list.filter((f) => pred(f, read(f)));

describe("accès aux données", () => {
  it("drizzle-orm n'est importé que dans packages/db (une seule instance, opérateurs réexportés)", () => {
    expect(
      offenders((f, s) => !f.startsWith("packages/db/") && /from "drizzle-orm/.test(s)),
    ).toEqual([]);
  });

  it("aucun SQL brut construit par concaténation (sql.raw, unsafe) hors des outils de test de la base", () => {
    expect(
      offenders((f, s) => /sql\.raw\(|\.unsafe\(/.test(s) && f !== "packages/db/src/testing.ts"),
    ).toEqual([]);
  });

  it("le moteur de paie reste pur : aucun accès base, réseau ni fichier dans packages/paie-engine/src", () => {
    const engine = all.filter((f) => f.startsWith("packages/paie-engine/src/"));
    expect(
      offenders(
        (_f, s) => /from "(node:fs|node:net|node:http|@paiecam\/db|postgres)"|fetch\(/.test(s),
        engine,
      ),
    ).toEqual([]);
  });
});

describe("autorisation", () => {
  const actionFiles = all.filter((f) => f.startsWith("apps/web/src/server/actions/"));

  it("chaque Server Action exportée construit son contexte (session, entreprise) via getRequestContext", () => {
    const bad: string[] = [];
    for (const f of actionFiles) {
      const src = read(f);
      expect(src.startsWith('"use server";'), f).toBe(true);
      // Fonctions créées par defineAction / defineUserAction : elles appellent getRequestContext elles-mêmes.
      const wrapped = [...src.matchAll(/const (\w+) = define(?:User)?Action\(/g)].map((m) => m[1]);
      for (const [, name, body] of src.matchAll(
        /export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g,
      )) {
        // Exception : le changement de langue ne touche aucune donnée (simple cookie).
        if (name === "setLocaleAction") continue;
        const usesContext =
          /getRequestContext\(\)/.test(body ?? "") ||
          wrapped.some((w) => new RegExp(`\\b${w}\\(`).test(body ?? ""));
        if (!usesContext) bad.push(`${f} : ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("chaque route API vérifie la session, sauf les routes publiques justifiées", () => {
    const PUBLIC: Record<string, string> = {
      "apps/web/src/app/api/auth/[...all]/route.ts":
        "Better Auth (contrôle d'origine et limites intégrés)",
      "apps/web/src/app/documents/fichier/route.ts":
        "lien signé de 5 minutes, délivré après contrôle des droits",
      "apps/web/src/app/api/health/route.ts": "point de santé sans donnée",
    };
    const routes = all.filter((f) => f.endsWith("/route.ts") && f.startsWith("apps/web/src/app/"));
    expect(routes.length).toBeGreaterThan(3);
    expect(offenders((f, s) => !PUBLIC[f] && !/getRequestContext\(\)/.test(s), routes)).toEqual([]);
  });

  it("chaque action métier déclare une permission ou est une action utilisateur hors entreprise", () => {
    const features = all.filter((f) => f.startsWith("apps/web/src/server/features/") && !isTest(f));
    const bad = offenders((_f, s) => {
      const tenant = [...s.matchAll(/createTenantAction\(\s*db,\s*\{([^}]*)\}/g)];
      return tenant.some(([, opts]) => !/permission:\s*"[a-z:]+"/.test(opts ?? ""));
    }, features);
    expect(bad).toEqual([]);
  });
});

describe("hygiène", () => {
  const app = all.filter((f) => !isTest(f));

  it("aucun dangerouslySetInnerHTML", () => {
    expect(offenders((_f, s) => s.includes("dangerouslySetInnerHTML"), app)).toEqual([]);
  });

  it("les variables d'environnement ne sont lues qu'aux points d'entrée prévus", () => {
    const ALLOWED = [
      "apps/web/src/env.ts",
      "apps/web/src/env-schema.ts",
      "apps/web/src/proxy.ts",
      "apps/web/next.config.ts",
      "apps/web/src/worker.ts",
      "apps/web/src/server/authz/index.ts",
      "packages/db/drizzle.config.ts",
      "packages/db/src/testing.ts",
      "packages/db/scripts/load-rules.ts",
    ];
    // authz/index.ts : NODE_ENV pour l'attribut Secure du cookie d'entreprise.
    expect(offenders((f, s) => /process\.env\b/.test(s) && !ALLOWED.includes(f), app)).toEqual([]);
  });

  it("aucun secret ou clé en dur (motifs courants)", () => {
    const secret =
      /(BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{20,}|xox[bap]-[0-9A-Za-z-]{10,})/;
    expect(offenders((_f, s) => secret.test(s))).toEqual([]);
  });

  it("aucune donnée de test réelle : les e-mails de test sont sur exemple.test", () => {
    const tests = all.filter(isTest);
    const real = /@(gmail|yahoo|hotmail|outlook|orange|mtn)\.(com|cm|fr)/i;
    expect(offenders((_f, s) => real.test(s), tests)).toEqual([]);
  });
});
