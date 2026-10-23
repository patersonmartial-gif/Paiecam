"use server";

import { revalidatePath } from "next/cache";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { keyring } from "../crypto";
import { db } from "../db";
import {
  makeGenerateDeclarations,
  makeLockPeriod,
  makeMarkFiled,
  makeMarkPaid,
} from "../features/declarations";
import { storage } from "../storage";

const generate = makeGenerateDeclarations(db, { keyring, storage });
const filed = makeMarkFiled(db);
const paid = makeMarkPaid(db);
const lock = makeLockPeriod(db);

export type DeclarationState = { error?: ActionError; ok?: string } | undefined;

async function done(
  periodId: string,
  res: { ok: boolean; error?: ActionError },
  ok: string,
): Promise<DeclarationState> {
  if (!res.ok) return { error: res.error as ActionError };
  revalidatePath(`/paie/${periodId}`);
  revalidatePath("/declarations");
  return { ok };
}

export async function generateDeclarationsAction(
  _p: DeclarationState,
  form: FormData,
): Promise<DeclarationState> {
  const periodId = String(form.get("periodId"));
  return done(periodId, await generate(await getRequestContext(), { periodId }), "generated");
}

export async function markFiledAction(
  _p: DeclarationState,
  form: FormData,
): Promise<DeclarationState> {
  const periodId = String(form.get("periodId"));
  return done(
    periodId,
    await filed(await getRequestContext(), {
      declarationId: String(form.get("declarationId")),
      filedAt: String(form.get("filedAt")),
      reference: String(form.get("reference")),
    }),
    "filed",
  );
}

export async function markPaidAction(
  _p: DeclarationState,
  form: FormData,
): Promise<DeclarationState> {
  const periodId = String(form.get("periodId"));
  const reference = String(form.get("reference") ?? "").trim();
  return done(
    periodId,
    await paid(await getRequestContext(), {
      declarationId: String(form.get("declarationId")),
      paidAt: String(form.get("paidAt")),
      ...(reference ? { reference } : {}),
    }),
    "paid",
  );
}

export async function lockPeriodAction(
  _p: DeclarationState,
  form: FormData,
): Promise<DeclarationState> {
  const periodId = String(form.get("periodId"));
  return done(periodId, await lock(await getRequestContext(), { periodId }), "locked");
}
