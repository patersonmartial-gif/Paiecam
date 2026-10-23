"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Alert, Button } from "@/components/ui";
import { importEmployeesAction, type ImportState } from "@/server/actions/employees-import";

export function ImportForm() {
  const t = useTranslations("import");
  const tf = useTranslations("employees.fields");
  const tc = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ImportState>(undefined);
  const [pending, startTransition] = useTransition();

  // Soumission manuelle : le fichier reste sélectionné entre l'aperçu et la confirmation.
  function submit(commit: boolean) {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set("commit", commit ? "1" : "0");
    startTransition(async () => setState(await importEmployeesAction(state, data)));
  }

  const report = state?.report;
  const allValid = report && report.errors.length === 0;

  return (
    <div>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        onChange={() => setState(undefined)}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium">{t("file")}</span>
          <input
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="block w-full text-sm"
          />
        </label>
        <div className="w-48">
          <Button disabled={pending}>{pending ? tc("loading") : t("check")}</Button>
        </div>
      </form>

      {state?.fileError && (
        <Alert>
          {t(`fileErrors.${state.fileError}`)}
          {state.missing && ` ${state.missing.join(", ")}`}
        </Alert>
      )}
      <ActionErrorAlert error={state?.error} />

      {state?.committed && report && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-green-800">
          {t("done", { count: report.imported })}{" "}
          <a href="/salaries" className="underline">
            {t("seeList")}
          </a>
        </p>
      )}

      {report && !state?.committed && (
        <section>
          <p className="mb-3">
            {t("summary", {
              total: report.total,
              valid: report.valid,
              errors: report.errors.length,
            })}
          </p>
          {report.errors.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-lg border border-red-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-red-50 text-red-900">
                  <tr>
                    <th className="px-3 py-2">{t("line")}</th>
                    <th className="px-3 py-2">{t("problem")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {report.errors.map((e) => (
                    <tr key={e.line}>
                      <td className="px-3 py-2 tabular-nums">{e.line}</td>
                      <td className="px-3 py-2">
                        {e.reason
                          ? t(`reasons.${e.reason}`)
                          : `${t("invalidFields")} ${e.fields.map((f) => tf(f)).join(", ")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {allValid ? (
            <div className="w-64">
              <Button disabled={pending} onClick={() => submit(true)} type="button">
                {t("confirm", { count: report.valid })}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-stone-600">{t("fixAndRetry")}</p>
          )}
        </section>
      )}
    </div>
  );
}
