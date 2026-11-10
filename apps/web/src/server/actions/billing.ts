"use server";

import { redirect } from "next/navigation";
import { env } from "@/env";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { verifyUserPassword } from "../auth/reauth";
import { keyring } from "../crypto";
import { db } from "../db";
import { makeCancelInvoice, makeIssueInvoice } from "../features/billing";

const issue = makeIssueInvoice(db, {
  keyring,
  allowDraftRules: env.PAYROLL_ALLOW_DRAFT_RULES === "on",
});
const cancel = makeCancelInvoice(db, {
  keyring,
  verifyPassword: (userId, password) => verifyUserPassword(db, userId, password),
});

export type BillingState = { error?: ActionError } | undefined;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function issueInvoiceAction(_p: BillingState, form: FormData): Promise<BillingState> {
  const itemIds = form.getAll("itemId").map(String);
  const quantities = form.getAll("quantity").map((q) => String(q).trim());
  const lines = itemIds
    .map((itemId, i) => ({ itemId, quantity: quantities[i] ?? "" }))
    .filter((l) => l.itemId !== "");
  const res = await issue(await getRequestContext(), {
    lines,
    paymentMean: field(form, "paymentMean"),
    paymentReference: field(form, "paymentReference") || undefined,
    patientName: field(form, "patientName") || undefined,
  });
  if (!res.ok) return { error: res.error };
  redirect(`/factures/${res.data.id}?emise=1`);
}

export async function cancelInvoiceAction(_p: BillingState, form: FormData): Promise<BillingState> {
  const res = await cancel(await getRequestContext(), {
    invoiceId: field(form, "invoiceId"),
    password: String(form.get("password") ?? ""),
    reason: field(form, "reason"),
  });
  if (!res.ok) return { error: res.error };
  redirect(`/factures/${res.data.creditNoteId}`);
}
