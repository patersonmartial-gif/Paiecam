"use server";

import { revalidatePath } from "next/cache";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { db } from "../db";
import { makeRequestBackup } from "../features/backups";
import { enqueueBackup } from "../jobs/queue";

const request = makeRequestBackup(db, { enqueue: enqueueBackup });

export type BackupState = { error?: ActionError; ok?: boolean } | undefined;

export async function requestBackupAction(_p: BackupState, _form: FormData): Promise<BackupState> {
  const res = await request(await getRequestContext(), {});
  if (!res.ok) return { error: res.error };
  revalidatePath("/parametres/sauvegardes");
  return { ok: true };
}
