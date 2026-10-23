"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/env";
import type { CompanyInput } from "@/lib/schemas";
import { getRequestContext, setActiveTenant } from "../authz";
import type { ActionError } from "../authz/action";
import { auth } from "../auth";
import { db } from "../db";
import { makeUpdateCompany } from "../features/company";
import {
  makeAcceptInvitation,
  makeChangeRole,
  makeInvite,
  makeRemoveMember,
  makeRevokeInvitation,
} from "../features/members";
import { mailer } from "../mailer";
import { headers } from "next/headers";

const updateCompany = makeUpdateCompany(db);
const invite = makeInvite(db, { mailer, baseURL: env.APP_URL });
const revoke = makeRevokeInvitation(db);
const changeRole = makeChangeRole(db);
const remove = makeRemoveMember(db);
const accept = makeAcceptInvitation(db);

export type SettingsState = { error?: ActionError; ok?: boolean } | undefined;

export async function updateCompanyAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const res = await updateCompany(
    await getRequestContext(),
    Object.fromEntries(form) as CompanyInput,
  );
  if (!res.ok) return { error: res.error };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function inviteAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const res = await invite(await getRequestContext(), {
    email: String(form.get("email") ?? ""),
    role: String(form.get("role") ?? "") as "accountant",
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/parametres/equipe");
  return { ok: true };
}

export async function revokeInvitationAction(form: FormData): Promise<void> {
  await revoke(await getRequestContext(), { invitationId: String(form.get("invitationId")) });
  revalidatePath("/parametres/equipe");
}

export async function changeRoleAction(form: FormData): Promise<void> {
  await changeRole(await getRequestContext(), {
    membershipId: String(form.get("membershipId")),
    role: String(form.get("role")) as "accountant",
  });
  revalidatePath("/parametres/equipe");
}

export async function removeMemberAction(form: FormData): Promise<void> {
  await remove(await getRequestContext(), { membershipId: String(form.get("membershipId")) });
  revalidatePath("/parametres/equipe");
}

export async function acceptInvitationAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const session = await auth.api.getSession({ headers: await headers() });
  const res = await accept(await getRequestContext(), {
    token: String(form.get("token") ?? ""),
    email: session?.user.email ?? "",
  });
  if (!res.ok) return { error: res.error };
  await setActiveTenant(res.data.tenantId);
  redirect("/tableau-de-bord");
}
