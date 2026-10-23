import { z } from "zod";
import { schema, type Db } from "@paiecam/db";
import { companySchema } from "@/lib/schemas";
import { createTenantAction } from "../authz/action";

export function makeGetCompany(db: Db) {
  return createTenantAction(
    db,
    { permission: "tenant:read", input: z.object({}), audit: "tenant.read", skipAudit: true },
    async ({ tx }) => {
      const [t] = await tx.select().from(schema.tenants);
      if (!t) throw new Error("entreprise introuvable");
      return t;
    },
  );
}

export function makeUpdateCompany(db: Db) {
  return createTenantAction(
    db,
    { permission: "tenant:update", input: companySchema, audit: "tenant.update" },
    async ({ tx, tenantId, audit }, input) => {
      const [before] = await tx.select().from(schema.tenants);
      await tx.update(schema.tenants).set(input);
      audit({ entityType: "tenant", entityId: tenantId, before, after: input });
      return { tenantId };
    },
  );
}
