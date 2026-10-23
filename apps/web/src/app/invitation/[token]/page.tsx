import { getTranslations } from "next-intl/server";
import { findInvitationByToken, withUser } from "@paiecam/db";
import { Alert, Card } from "@/components/ui";
import { getRequestContext } from "@/server/authz";
import { db } from "@/server/db";
import { AcceptForm } from "./accept-form";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations();
  const ctx = await getRequestContext();
  const next = encodeURIComponent(`/invitation/${token}`);

  if (!ctx.user) {
    return (
      <Card title={t("invitation.title")}>
        <p className="mb-4 text-sm text-stone-600">{t("invitation.signInFirst")}</p>
        <div className="flex gap-3">
          <a
            href={`/connexion?next=${next}`}
            className="flex-1 rounded-md bg-brand px-4 py-2 text-center font-medium text-white"
          >
            {t("auth.signIn")}
          </a>
          <a
            href={`/inscription?next=${next}`}
            className="flex-1 rounded-md border border-stone-300 px-4 py-2 text-center font-medium"
          >
            {t("home.signUp")}
          </a>
        </div>
      </Card>
    );
  }

  const userId = ctx.user.id;
  const invitation =
    token.length <= 100
      ? await withUser(db, userId, (tx) => findInvitationByToken(tx, token))
      : null;
  return (
    <Card title={t("invitation.title")}>
      {!invitation ? (
        <Alert>{t("invitation.errors.not_found")}</Alert>
      ) : invitation.status !== "pending" ? (
        <Alert>{t(`invitation.errors.${invitation.status}`)}</Alert>
      ) : (
        <>
          <p className="mb-4">
            {t("invitation.join", {
              company: invitation.tenantName,
              role: t(`tenants.roles.${invitation.role}`),
            })}
          </p>
          <AcceptForm token={token} />
        </>
      )}
    </Card>
  );
}
