import { loadTestRules, resetTestDatabase } from "@paiecam/db/testing";
import { loadRuleFile } from "@paiecam/paie-engine/rules";
import { clearOutbox } from "./outbox";

export default async function setup() {
  await clearOutbox();
  await resetTestDatabase();
  // Référentiel 2026 en brouillon : les bulletins des parcours sont « provisoires ».
  await loadTestRules(
    loadRuleFile(
      new URL("../../../packages/paie-engine/rules/cm-2026.draft.json", import.meta.url).pathname,
    ),
  );
}
