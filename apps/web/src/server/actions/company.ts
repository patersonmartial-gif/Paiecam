"use server";

import { redirect } from "next/navigation";
import { createTenantWithOwner, eq, schema, withUser } from "@paiecam/db";
import { companySchema, type CompanyInput } from "@/lib/schemas";
import { defineUserAction, getRequestContext, setActiveTenant } from "../authz";
import type { ActionError } from "../authz/action";
import { db } from "../db";

const createCompany = defineUserAction(
  { input: companySchema, audit: "tenant.create" },
  async ({ tx, userId }, input) => {
    const tenantId = await createTenantWithOwner(tx, userId, input);
    return { data: tenantId, tenantId };
  },
);

export type FormState = { error?: ActionError } | undefined;

export async function createCompanyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const result = await createCompany(Object.fromEntries(form) as CompanyInput);
  if (!result.ok) return { error: result.error };
  await setActiveTenant(result.data);
  redirect("/securite/2fa");
}

export async function selectTenantAction(form: FormData): Promise<void> {
  const ctx = await getRequestContext();
  if (!ctx.user) redirect("/connexion");
  const tenantId = String(form.get("tenantId") ?? "");
  const userId = ctx.user.id;
  // L'appartenance est revérifiée sous RLS : un identifiant forgé ne donne accès à rien.
  const memberships = await withUser(db, userId, (tx) =>
    tx.select().from(schema.memberships).where(eq(schema.memberships.userId, userId)),
  );
  if (!memberships.some((m) => m.tenantId === tenantId)) redirect("/choisir-entreprise");
  await setActiveTenant(tenantId);
  redirect("/tableau-de-bord");
}
