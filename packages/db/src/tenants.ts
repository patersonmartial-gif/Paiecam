import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Tx } from "./tenant";

export interface NewTenant {
  legalName: string;
  niu: string;
  cnpsEmployerNumber: string;
  regime: "general" | "agricole" | "enseignement_prive";
  workAccidentRate: number;
  commune: string;
}

/**
 * Crée l'entreprise et le Propriétaire. À appeler dans withUser() ; à la sortie, la transaction
 * est placée dans le contexte du nouveau tenant.
 */
export async function createTenantWithOwner(
  tx: Tx,
  userId: string,
  tenant: NewTenant,
): Promise<string> {
  const tenantId = uuidv7();
  await tx.execute(sql`select create_tenant_with_owner(
    ${tenantId}::uuid, ${uuidv7()}::uuid, ${userId},
    ${tenant.legalName}, ${tenant.niu}, ${tenant.cnpsEmployerNumber},
    ${tenant.regime}::regime, ${tenant.workAccidentRate}, ${tenant.commune}
  )`);
  return tenantId;
}
