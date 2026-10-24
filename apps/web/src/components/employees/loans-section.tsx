"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Field, Select } from "@/components/ui";
import {
  cancelLoanAction,
  createLoanAction,
  setLoanSkipAction,
  updateLoanInstallmentAction,
  type LoanState,
} from "@/server/actions/loans";

export interface LoanView {
  id: string;
  kind: "loan" | "advance";
  label: string;
  principal: number;
  installment: number;
  grantedOn: string;
  start: { year: number; month: number };
  status: "active" | "settled" | "cancelled";
  repaid: number;
  remaining: number;
  repayments: { year: number; month: number; amount: number }[];
  skipped: boolean;
}

const monthLabel = (m: { year: number; month: number }) =>
  `${String(m.month).padStart(2, "0")}/${m.year}`;

function useMoney() {
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale === "en" ? "en-US" : "fr-FR");
  return (n: number) => `${nf.format(n)} FCFA`;
}

function NewLoanForm({ employeeId }: { employeeId: string }) {
  const t = useTranslations("loans");
  const [state, action, pending] = useActionState<LoanState, FormData>(createLoanAction, undefined);
  return (
    <form action={action} className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="mb-3 font-medium">{t("new")}</h3>
      <ActionErrorAlert error={state?.error} ruleNamespace="loans.errors" />
      {state?.ok && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("created")}
        </p>
      )}
      <input type="hidden" name="employeeId" value={employeeId} />
      <Select label={t("kind")} name="kind" defaultValue="loan">
        <option value="loan">{t("kinds.loan")}</option>
        <option value="advance">{t("kinds.advance")}</option>
      </Select>
      <Field label={t("label")} name="label" required maxLength={80} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("principal")} name="principal" inputMode="numeric" required />
        <Field
          label={t("installment")}
          name="installment"
          inputMode="numeric"
          hint={t("installmentHelp")}
        />
        <Field label={t("grantedOn")} name="grantedOn" type="date" required />
        <Field label={t("start")} name="start" type="month" required />
      </div>
      <button
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {t("create")}
      </button>
    </form>
  );
}

function LoanCard({
  employeeId,
  loan,
  openPeriod,
  canWrite,
}: {
  employeeId: string;
  loan: LoanView;
  openPeriod: { id: string; year: number; month: number } | null;
  canWrite: boolean;
}) {
  const t = useTranslations("loans");
  const money = useMoney();
  const [updated, update, updating] = useActionState<LoanState, FormData>(
    updateLoanInstallmentAction,
    undefined,
  );
  const [cancelled, cancel, cancelling] = useActionState<LoanState, FormData>(
    cancelLoanAction,
    undefined,
  );
  const [skipped, skip, skipping] = useActionState<LoanState, FormData>(
    setLoanSkipAction,
    undefined,
  );
  const error = updated?.error ?? cancelled?.error ?? skipped?.error;
  const active = loan.status === "active" && canWrite;
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4" aria-label={loan.label}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {loan.label}{" "}
          <span className="text-sm font-normal text-stone-500">({t(`kinds.${loan.kind}`)})</span>
        </p>
        <span className="rounded bg-stone-100 px-2 text-sm">{t(`status.${loan.status}`)}</span>
      </div>
      <p className="mt-1 text-sm">
        {t("summary", {
          repaid: money(loan.repaid),
          principal: money(loan.principal),
          remaining: money(loan.remaining),
        })}
      </p>
      <p className="text-sm text-stone-600">
        {t("perMonth", { installment: money(loan.installment), start: monthLabel(loan.start) })}
      </p>
      {loan.repayments.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-stone-600">{t("history")}</summary>
          <ul className="mt-1 space-y-0.5">
            {loan.repayments.map((r) => (
              <li key={`${r.year}-${r.month}`}>
                {monthLabel(r)} : {money(r.amount)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ActionErrorAlert error={error} ruleNamespace="loans.errors" />
      {loan.skipped && openPeriod && (
        <p role="status" className="mt-2 text-sm text-amber-800">
          {t("skipped", { period: monthLabel(openPeriod) })}
        </p>
      )}
      {active && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <form action={update} className="flex items-end gap-2">
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="loanId" value={loan.id} />
            <label className="text-sm">
              <span className="mb-1 block">{t("changeInstallment")}</span>
              <input
                name="installment"
                inputMode="numeric"
                defaultValue={loan.installment}
                className="w-32 rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <button
              disabled={updating}
              className="rounded-md border border-stone-300 px-3 py-1 text-sm"
            >
              {t("saveInstallment")}
            </button>
          </form>
          {openPeriod && (
            <form action={skip}>
              <input type="hidden" name="employeeId" value={employeeId} />
              <input type="hidden" name="loanId" value={loan.id} />
              <input type="hidden" name="periodId" value={openPeriod.id} />
              <input type="hidden" name="skip" value={loan.skipped ? "0" : "1"} />
              <button
                disabled={skipping}
                className="rounded-md border border-stone-300 px-3 py-1 text-sm"
              >
                {t(loan.skipped ? "unskip" : "skip", { period: monthLabel(openPeriod) })}
              </button>
            </form>
          )}
          <form
            action={cancel}
            onSubmit={(e) => {
              if (!window.confirm(t("cancelConfirm"))) e.preventDefault();
            }}
          >
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="loanId" value={loan.id} />
            <button
              disabled={cancelling}
              className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700"
            >
              {t("cancel")}
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

export function LoansSection({
  employeeId,
  loans,
  openPeriod,
  canWrite,
}: {
  employeeId: string;
  loans: LoanView[];
  openPeriod: { id: string; year: number; month: number } | null;
  canWrite: boolean;
}) {
  const t = useTranslations("loans");
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="text-sm text-stone-600">{t("help")}</p>
      </div>
      {loans.length === 0 ? (
        <p className="text-sm text-stone-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {loans.map((l) => (
            <LoanCard
              key={l.id}
              employeeId={employeeId}
              loan={l}
              openPeriod={openPeriod}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}
      {canWrite && <NewLoanForm employeeId={employeeId} />}
    </section>
  );
}
