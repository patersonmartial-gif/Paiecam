import { describe, expect, it } from "vitest";
import { checkRuleSet, resolveRule, RULE_CODES } from "../src";
import { loadRuleFile } from "../rules/load";

const rules = loadRuleFile(new URL("../rules/cm-2026.draft.json", import.meta.url).pathname);

describe("référentiel 2026 (brouillon)", () => {
  it("est cohérent : codes connus, valeurs conformes, pas de chevauchement", () => {
    expect(checkRuleSet(rules)).toEqual([]);
  });

  it("couvre toutes les règles dont le moteur a besoin", () => {
    for (const code of Object.values(RULE_CODES)) {
      expect(() => resolveRule(rules, code, "2026-06-30"), code).not.toThrow();
    }
  });

  it("chaque règle cite sa source et reste en brouillon", () => {
    for (const r of rules) {
      expect(r.legalSource.length, r.code).toBeGreaterThan(10);
      expect(r.status).toBe("draft");
    }
  });
});
