"use server";

import { revalidatePath } from "next/cache";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { db } from "../db";
import {
  makeCancelLoan,
  makeCreateLoan,
  makeSetLoanSkip,
  makeUpdateLoanInstallment,
} from "../features/loans";

const create = makeCreateLoan(db);
const cancel = makeCancelLoan(db);
const update = makeUpdateLoanInstallment(db);
const skip = makeSetLoanSkip(db);

export type LoanState = { error?: ActionError; ok?: string } | undefined;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const done = (form: FormData, ok: string): LoanState => {
  revalidatePath(`/salaries/${field(form, "employeeId")}`);
  return { ok };
};

export async function createLoanAction(_p: LoanState, form: FormData): Promise<LoanState> {
  const installment = field(form, "installment");
  const res = await create(await getRequestContext(), {
    employeeId: field(form, "employeeId"),
    kind: field(form, "kind"),
    label: field(form, "label"),
    principal: field(form, "principal").replace(/\s/g, ""),
    installment: installment === "" ? undefined : installment.replace(/\s/g, ""),
    grantedOn: field(form, "grantedOn"),
    start: field(form, "start"),
  });
  return res.ok ? done(form, "created") : { error: res.error };
}

export async function updateLoanInstallmentAction(
  _p: LoanState,
  form: FormData,
): Promise<LoanState> {
  const res = await update(await getRequestContext(), {
    loanId: field(form, "loanId"),
    installment: field(form, "installment").replace(/\s/g, ""),
  });
  return res.ok ? done(form, "updated") : { error: res.error };
}

export async function cancelLoanAction(_p: LoanState, form: FormData): Promise<LoanState> {
  const res = await cancel(await getRequestContext(), { loanId: field(form, "loanId") });
  return res.ok ? done(form, "cancelled") : { error: res.error };
}

export async function setLoanSkipAction(_p: LoanState, form: FormData): Promise<LoanState> {
  const res = await skip(await getRequestContext(), {
    loanId: field(form, "loanId"),
    periodId: field(form, "periodId"),
    skip: field(form, "skip") === "1",
  });
  return res.ok ? done(form, "skip") : { error: res.error };
}
