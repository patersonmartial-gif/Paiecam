"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EmployeeInput } from "@/lib/employee-schema";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { verifyUserPassword } from "../auth/reauth";
import { keyring } from "../crypto";
import { db } from "../db";
import {
  makeArchiveEmployee,
  makeCreateEmployee,
  makeRevealSensitive,
  makeUpdateBankDetails,
  makeUpdateEmployee,
} from "../features/employees";

const create = makeCreateEmployee(db, keyring);
const update = makeUpdateEmployee(db, keyring);
const archive = makeArchiveEmployee(db);
const updateBank = makeUpdateBankDetails(db, {
  keyring,
  verifyPassword: (userId, password) => verifyUserPassword(db, userId, password),
});
const reveal = makeRevealSensitive(db, keyring);

export type EmployeeFormState = { error?: ActionError; ok?: boolean } | undefined;

const fields = (form: FormData) => Object.fromEntries(form) as unknown as EmployeeInput;

export async function createEmployeeAction(
  _p: EmployeeFormState,
  form: FormData,
): Promise<EmployeeFormState> {
  const res = await create(await getRequestContext(), fields(form));
  if (!res.ok) return { error: res.error };
  redirect(`/salaries/${res.data.id}`);
}

export async function updateEmployeeAction(
  _p: EmployeeFormState,
  form: FormData,
): Promise<EmployeeFormState> {
  const id = String(form.get("id"));
  const res = await update(await getRequestContext(), { id, data: fields(form) });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/salaries/${id}`);
  return { ok: true };
}

export async function updateBankAction(
  _p: EmployeeFormState,
  form: FormData,
): Promise<EmployeeFormState> {
  const id = String(form.get("id"));
  const res = await updateBank(await getRequestContext(), {
    id,
    password: String(form.get("password") ?? ""),
    bank: {
      iban: String(form.get("iban") ?? ""),
      mobileOperator: String(form.get("mobileOperator") ?? "") as "orange",
      mobileNumber: String(form.get("mobileNumber") ?? ""),
    },
  });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/salaries/${id}`);
  return { ok: true };
}

export async function archiveEmployeeAction(
  _p: EmployeeFormState,
  form: FormData,
): Promise<EmployeeFormState> {
  const id = String(form.get("id"));
  const res = await archive(await getRequestContext(), {
    id,
    endDate: String(form.get("endDate") ?? ""),
  });
  if (!res.ok) return { error: res.error };
  redirect("/salaries");
}

export type RevealState =
  | {
      error?: ActionError;
      data?: { cnpsNumber: string | null; iban: string | null; mobileNumber: string | null };
    }
  | undefined;

export async function revealSensitiveAction(_p: RevealState, form: FormData): Promise<RevealState> {
  const res = await reveal(await getRequestContext(), { id: String(form.get("id")) });
  return res.ok ? { data: res.data } : { error: res.error };
}
