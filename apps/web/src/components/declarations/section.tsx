import { getTranslations } from "next-intl/server";
import { DeclarationForm, SmallField } from "@/components/declarations/forms";
import {
  generateDeclarationsAction,
  lockPeriodAction,
  markFiledAction,
  markPaidAction,
} from "@/server/actions/declarations";

export interface DeclarationRow {
  id: string;
  kind: "cnps" | "dgi" | "dipe";
  amountDue: number;
  dueDate: string;
  status: "generated" | "filed" | "paid";
  documentId: string;
  filedAt: string | null;
  filingReference: string | null;
  paidAt: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const fcfa = (n: number) => n.toLocaleString("fr-FR");
const fr = (iso: string) => iso.split("-").reverse().join("/");

/** Section « Déclarations » d'un mois validé ou verrouillé. */
export async function DeclarationsSection({
  periodId,
  periodStatus,
  rows,
  canDeclare,
  canLock,
}: {
  periodId: string;
  periodStatus: string;
  rows: DeclarationRow[];
  canDeclare: boolean;
  canLock: boolean;
}) {
  const t = await getTranslations("declarations");
  const allFiled = rows.length === 3 && rows.every((r) => r.status !== "generated");
  const anyFiled = rows.some((r) => r.status !== "generated");
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-semibold">{t("title")}</h2>
        <a
          href={`/paie/${periodId}/journal`}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium"
        >
          {t("journal")}
        </a>
        {canDeclare && periodStatus === "validated" && !anyFiled && (
          <DeclarationForm
            action={generateDeclarationsAction}
            periodId={periodId}
            submit={rows.length ? t("regenerate") : t("generate")}
          />
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-600">{t("none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">{t("kind")}</th>
                <th className="px-3 py-2 text-right">{t("amount")}</th>
                <th className="px-3 py-2">{t("due")}</th>
                <th className="px-3 py-2">{t("statusLabel")}</th>
                <th className="px-3 py-2">{t("file")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const late = r.status === "generated" && r.dueDate < today();
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 font-medium">{t(`kinds.${r.kind}`)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.kind === "dipe" ? "—" : fcfa(r.amountDue)}
                    </td>
                    <td className="px-3 py-2">
                      {fr(r.dueDate)}
                      {late && (
                        <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-800">
                          {t("late")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {t(`status.${r.status}`)}
                      {r.filedAt && (
                        <span className="block text-xs text-stone-500">
                          {t("filedOn", { date: fr(r.filedAt), ref: r.filingReference ?? "" })}
                        </span>
                      )}
                      {r.paidAt && (
                        <span className="block text-xs text-stone-500">
                          {t("paidOn", { date: fr(r.paidAt) })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/documents/${r.documentId}/telecharger`}
                        className="text-brand underline"
                      >
                        {t("download")}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      {canDeclare && r.status === "generated" && (
                        <DeclarationForm
                          action={markFiledAction}
                          periodId={periodId}
                          declarationId={r.id}
                          submit={t("markFiled")}
                        >
                          <SmallField
                            label={t("filedAt")}
                            name="filedAt"
                            type="date"
                            max={today()}
                            required
                            aria-label={`${t(`kinds.${r.kind}`)} — ${t("filedAt")}`}
                          />
                          <SmallField
                            label={t("reference")}
                            name="reference"
                            required
                            minLength={2}
                            aria-label={`${t(`kinds.${r.kind}`)} — ${t("reference")}`}
                          />
                        </DeclarationForm>
                      )}
                      {canDeclare && r.status === "filed" && r.kind !== "dipe" && (
                        <DeclarationForm
                          action={markPaidAction}
                          periodId={periodId}
                          declarationId={r.id}
                          submit={t("markPaid")}
                        >
                          <SmallField
                            label={t("paidAt")}
                            name="paidAt"
                            type="date"
                            max={today()}
                            required
                            aria-label={`${t(`kinds.${r.kind}`)} — ${t("paidAt")}`}
                          />
                          <SmallField
                            label={t("paymentReference")}
                            name="reference"
                            aria-label={`${t(`kinds.${r.kind}`)} — ${t("paymentReference")}`}
                          />
                        </DeclarationForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.some((r) => r.kind === "dipe") && (
        <p className="text-xs text-amber-800">{t("dipeWarning")}</p>
      )}
      {canLock && periodStatus === "validated" && allFiled && (
        <div className="max-w-md rounded-lg border border-stone-200 bg-white p-4">
          <p className="mb-2 text-sm text-stone-600">{t("lockHelp")}</p>
          <DeclarationForm action={lockPeriodAction} periodId={periodId} submit={t("lock")} />
        </div>
      )}
    </section>
  );
}
