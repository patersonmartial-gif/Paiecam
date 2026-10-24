import { z } from "zod";
import type { Db } from "@paiecam/db";
import { createTenantAction } from "../authz/action";

/**
 * Installation locale : le propriétaire demande une sauvegarde immédiate (exécutée par le worker).
 * La sauvegarde couvre toute l'installation ; la demande est tracée dans l'entreprise du demandeur.
 */
export function makeRequestBackup(db: Db, deps: { enqueue: () => Promise<void> }) {
  return createTenantAction(
    db,
    { permission: "tenant:update", input: z.object({}), audit: "backups.request" },
    async ({ audit }) => {
      await deps.enqueue();
      audit({ entityType: "installation", entityId: "local" });
      return { requested: true };
    },
  );
}
