"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { verifyUserPassword } from "../auth/reauth";
import { db } from "../db";
import {
  makeCalculatePeriod,
  makeOpenPeriod,
  makeReopenPeriod,
  makeSaveVariables,
  makeValidatePeriod,
} from "../features/payroll";
import { enqueuePayslipPdfs } from "../jobs/queue";

const openPeriod = makeOpenPeriod(db);
const save = makeSaveVariables(db);
const calculate = makeCalculatePeriod(db, {
  allowDraftRules: env.PAYROLL_ALLOW_DRAFT_RULES === "on",
});
const reopen = makeReopenPeriod(db);
const validate = makeValidatePeriod(db, {
  verifyPassword: (userId, password) => verifyUserPassword(db, userId, password),
});

export type PayrollState = { error?: ActionError; ok?: string } | undefined;

export async function openPeriodAction(_p: PayrollState, form: FormData): Promise<PayrollState> {
  const res = await openPeriod(await getRequestContext(), {
    year: form.get("year"),
    month: form.get("month"),
  });
  if (!res.ok) return { error: res.error };
  redirect(`/paie/${res.data.periodId}`);
}

/** Les champs de la grille sont nommés « v|<salarié>|<clé> » ; un champ vide vaut 0 (supprimé). */
export async function saveVariablesAction(_p: PayrollState, form: FormData): Promise<PayrollState> {
  const periodId = String(form.get("periodId"));
  const entries = [...form.entries()]
    .filter(([name]) => name.startsWith("v|"))
    .map(([name, value]) => {
      const [, employeeId = "", key = ""] = name.split("|");
      const raw = String(value).replace(/\s/g, "").replace(",", ".");
      // Heures saisies en heures décimales (8,5) → centièmes ; montants et jours tels quels.
      const num =
        raw === "" ? 0 : key.startsWith("hs:") ? Math.round(Number(raw) * 100) : Number(raw);
      return { employeeId, key, value: num };
    });
  const res = await save(await getRequestContext(), { periodId, entries });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/paie/${periodId}`);
  return { ok: "saved" };
}

export async function calculatePeriodAction(
  _p: PayrollState,
  form: FormData,
): Promise<PayrollState> {
  const periodId = String(form.get("periodId"));
  const res = await calculate(await getRequestContext(), { periodId });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/paie/${periodId}`);
  return { ok: "calculated" };
}

export async function reopenPeriodAction(_p: PayrollState, form: FormData): Promise<PayrollState> {
  const periodId = String(form.get("periodId"));
  const res = await reopen(await getRequestContext(), { periodId });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/paie/${periodId}`);
  return { ok: "reopened" };
}

export async function validatePeriodAction(
  _p: PayrollState,
  form: FormData,
): Promise<PayrollState> {
  const periodId = String(form.get("periodId"));
  const ctx = await getRequestContext();
  const res = await validate(ctx, { periodId, password: String(form.get("password") ?? "") });
  // Après la validation (transaction terminée) : le worker ne voit jamais un mois encore « calculé ».
  if (res.ok && ctx.tenantId) await enqueuePayslipPdfs(periodId, ctx.tenantId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/paie/${periodId}`);
  return { ok: "validated" };
}
