"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ActionErrorAlert } from "@/components/action-error";
import { Button, Field, Select } from "@/components/ui";
import type { EmployeeFormState } from "@/server/actions/employees";
import type { EmployeeView } from "@/server/features/employees";

type Action = (state: EmployeeFormState, form: FormData) => Promise<EmployeeFormState>;

export function EmployeeForm({
  action,
  employee,
  disabled = false,
}: {
  action: Action;
  employee?: EmployeeView;
  disabled?: boolean;
}) {
  const t = useTranslations("employees");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState<EmployeeFormState, FormData>(
    action,
    undefined,
  );
  const err = state?.error;
  const f = err?.code === "INVALID_INPUT" ? err.fields : {};
  const e = employee;

  return (
    <form action={formAction}>
      <ActionErrorAlert error={err} ruleNamespace="employees.errors" />
      {state?.ok && (
        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{t("saved")}</p>
      )}
      {e && <input type="hidden" name="id" value={e.id} />}
      <fieldset disabled={disabled} className="grid gap-x-4 sm:grid-cols-2">
        <h2 className="col-span-full mb-2 font-semibold">{t("sections.identity")}</h2>
        <Field
          label={t("fields.matricule")}
          name="matricule"
          defaultValue={e?.matricule}
          required
          error={f.matricule}
        />
        <Field
          label={t("fields.lastName")}
          name="lastName"
          defaultValue={e?.lastName}
          required
          error={f.lastName}
        />
        <Field
          label={t("fields.firstNames")}
          name="firstNames"
          defaultValue={e?.firstNames}
          required
          error={f.firstNames}
        />
        <Field
          label={t("fields.birthDate")}
          name="birthDate"
          type="date"
          defaultValue={e?.birthDate}
          required
          error={f.birthDate}
        />
        <Field
          label={t("fields.cnpsNumber")}
          name="cnpsNumber"
          placeholder={e?.cnpsNumberMasked ?? ""}
          hint={e?.cnpsNumberMasked ? t("fields.cnpsKeep") : undefined}
          error={f.cnpsNumber}
          autoComplete="off"
        />

        <h2 className="col-span-full mb-2 mt-4 font-semibold">{t("sections.contract")}</h2>
        <Field
          label={t("fields.hireDate")}
          name="hireDate"
          type="date"
          defaultValue={e?.hireDate}
          required
          error={f.hireDate}
        />
        <Select
          label={t("fields.contractType")}
          name="contractType"
          defaultValue={e?.contractType ?? "cdi"}
        >
          <option value="cdi">{t("contractTypes.cdi")}</option>
          <option value="cdd">{t("contractTypes.cdd")}</option>
        </Select>
        <Field
          label={t("fields.endDate")}
          name="endDate"
          type="date"
          defaultValue={e?.endDate ?? ""}
          error={f.endDate}
        />
        <Field
          label={t("fields.jobTitle")}
          name="jobTitle"
          defaultValue={e?.jobTitle}
          required
          error={f.jobTitle}
        />
        <Field
          label={t("fields.category")}
          name="category"
          defaultValue={e?.category}
          required
          error={f.category}
        />
        <Field
          label={t("fields.echelon")}
          name="echelon"
          defaultValue={e?.echelon}
          required
          error={f.echelon}
        />

        <h2 className="col-span-full mb-2 mt-4 font-semibold">{t("sections.pay")}</h2>
        <Field
          label={t("fields.baseSalary")}
          name="baseSalary"
          type="number"
          min={0}
          step={1}
          defaultValue={e?.baseSalary}
          required
          error={f.baseSalary}
        />
        <Select
          label={t("fields.maritalStatus")}
          name="maritalStatus"
          defaultValue={e?.maritalStatus ?? "single"}
        >
          {(["single", "married", "divorced", "widowed"] as const).map((v) => (
            <option key={v} value={v}>
              {t(`maritalStatuses.${v}`)}
            </option>
          ))}
        </Select>
        <Field
          label={t("fields.childrenCount")}
          name="childrenCount"
          type="number"
          min={0}
          max={30}
          defaultValue={e?.childrenCount ?? 0}
          error={f.childrenCount}
        />
        <Select
          label={t("fields.paymentMethod")}
          name="paymentMethod"
          defaultValue={e?.paymentMethod ?? "bank_transfer"}
        >
          {(["bank_transfer", "mobile_money", "cash"] as const).map((v) => (
            <option key={v} value={v}>
              {t(`paymentMethods.${v}`)}
            </option>
          ))}
        </Select>
      </fieldset>
      {!disabled && (
        <div className="mt-2 max-w-xs">
          <Button disabled={pending}>
            {pending ? tc("loading") : e ? t("save") : t("create")}
          </Button>
        </div>
      )}
    </form>
  );
}
