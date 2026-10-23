"use client";

import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui";
import type { ActionError } from "@/server/authz/action";

/** Message lisible pour une erreur d'action ; `ruleNamespace` traduit les refus métier. */
export function ActionErrorAlert({
  error,
  ruleNamespace,
}: {
  error?: ActionError | undefined;
  ruleNamespace?: string;
}) {
  const t = useTranslations();
  if (!error) return null;
  let key = "common.errors.generic";
  if (error.code === "INVALID_INPUT") key = "common.errors.invalidInput";
  else if (error.code === "FORBIDDEN" || error.code === "TWO_FACTOR_REQUIRED")
    key = "common.errors.forbidden";
  else if (error.code === "CONFLICT")
    key = ruleNamespace ? `${ruleNamespace}.${error.constraint}` : "company.niuTaken";
  else if (error.code === "RULE" && ruleNamespace) key = `${ruleNamespace}.${error.reason}`;
  return <Alert>{t(key)}</Alert>;
}
