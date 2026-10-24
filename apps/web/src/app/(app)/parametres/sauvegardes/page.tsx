import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { listBackups } from "@paiecam/local/backup";
import { env } from "@/env";
import { can } from "@/server/authz/permissions";
import { requireMember } from "@/server/guards";
import { localBackupConfigured } from "@/server/jobs/local-backup";
import { BackupNow } from "./backup-now";

export default async function BackupsPage() {
  const member = await requireMember();
  // Page de l'installation locale, réservée au propriétaire.
  if (
    env.DEPLOYMENT !== "local" ||
    !localBackupConfigured(env) ||
    !can(member.role, "tenant:update")
  )
    notFound();
  const t = await getTranslations("backups");
  const format = await getFormatter();
  const backups = await listBackups(env.BACKUP_DIR ?? "");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-stone-600">{t("help")}</p>
      <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {t("copyAdvice", { dir: env.BACKUP_DIR ?? "" })}
      </p>
      <BackupNow />
      {backups.length === 0 ? (
        <p className="text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm">
          {backups.map((b) => (
            <li key={b.name} className="flex justify-between px-4 py-2">
              <span>{format.dateTime(b.createdAt, { dateStyle: "long", timeStyle: "short" })}</span>
              <span className="font-mono text-stone-600">
                {b.name} · {format.number(Math.ceil(b.sizeBytes / 1024))} Ko
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
