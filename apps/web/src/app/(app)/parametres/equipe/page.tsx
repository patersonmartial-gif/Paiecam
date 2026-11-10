import { getFormatter, getTranslations } from "next-intl/server";
import { getRequestContext } from "@/server/authz";
import {
  changeRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/server/actions/settings";
import { can } from "@/server/authz/permissions";
import { db } from "@/server/db";
import { makeListMembers } from "@/server/features/members";
import { requireMember } from "@/server/guards";
import { InviteForm } from "./invite-form";

const listMembers = makeListMembers(db);

export default async function TeamPage() {
  const member = await requireMember();
  const t = await getTranslations();
  const format = await getFormatter();
  const res = await listMembers(await getRequestContext(), {});
  if (!res.ok) throw new Error(res.error.code);
  const manage = can(member.role, "members:manage");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">{t("team.title")}</h1>

      <h2 className="mb-2 font-semibold">{t("team.members")}</h2>
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {res.data.members.map((m) => {
          const editable = manage && m.userId !== member.userId && m.role !== "owner";
          return (
            <li key={m.membershipId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.name}{" "}
                  {m.userId === member.userId && (
                    <span className="text-stone-500">({t("team.you")})</span>
                  )}
                </p>
                <p className="truncate text-sm text-stone-600">{m.email}</p>
              </div>
              {editable ? (
                <>
                  <form action={changeRoleAction} className="flex gap-2">
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      aria-label={t("team.changeRole")}
                      className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                    >
                      <option value="accountant">{t("tenants.roles.accountant")}</option>
                      <option value="payroll_manager">{t("tenants.roles.payroll_manager")}</option>
                      <option value="cashier">{t("tenants.roles.cashier")}</option>
                      <option value="stock_manager">{t("tenants.roles.stock_manager")}</option>
                    </select>
                    <button className="text-sm text-brand underline">{t("team.changeRole")}</button>
                  </form>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <button className="text-sm text-red-700 underline">{t("team.remove")}</button>
                  </form>
                </>
              ) : (
                <span className="text-sm text-stone-600">{t(`tenants.roles.${m.role}`)}</span>
              )}
            </li>
          );
        })}
      </ul>

      {manage && (
        <>
          {res.data.pending.length > 0 && (
            <>
              <h2 className="mb-2 mt-8 font-semibold">{t("team.pending")}</h2>
              <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
                {res.data.pending.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="flex-1 truncate">{p.email}</span>
                    <span className="text-stone-600">{t(`tenants.roles.${p.role}`)}</span>
                    <span className="text-stone-500">
                      {t("team.expires", {
                        date: format.dateTime(p.expiresAt, { dateStyle: "medium" }),
                      })}
                    </span>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="invitationId" value={p.id} />
                      <button className="text-red-700 underline">{t("team.revoke")}</button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
          <section className="mt-8 max-w-md rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="font-semibold">{t("team.inviteTitle")}</h2>
            <InviteForm />
          </section>
        </>
      )}
    </main>
  );
}
