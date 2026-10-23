"use server";

import { readSheet } from "read-excel-file/node";
import { getRequestContext } from "../authz";
import type { ActionError } from "../authz/action";
import { keyring } from "../crypto";
import { db } from "../db";
import { makeImportEmployees, type ImportReport } from "../features/employees-import";
import { parseEmployeeSheet } from "../import/employees-sheet";
import { inspectXlsx, XLSX_LIMITS, XlsxRejected } from "../import/xlsx-guard";
import { log } from "../log";

const importEmployees = makeImportEmployees(db, keyring);

export type ImportState =
  | {
      fileError?: string;
      missing?: string[];
      error?: ActionError;
      report?: ImportReport;
      committed?: boolean;
    }
  | undefined;

export async function importEmployeesAction(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  const ctx = await getRequestContext();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { fileError: "empty" };
  if (file.size > XLSX_LIMITS.maxBytes) return { fileError: "too_large" };

  const buf = Buffer.from(await file.arrayBuffer());
  let sheet: unknown[][];
  try {
    inspectXlsx(buf);
    sheet = await readSheet(buf);
  } catch (e) {
    if (!(e instanceof XlsxRejected)) log("warn", "classeur illisible", { error: e });
    return { fileError: e instanceof XlsxRejected ? e.reason : "not_xlsx" };
  }

  const parsed = parseEmployeeSheet(sheet);
  if (!parsed.ok)
    return {
      fileError: parsed.reason,
      ...("missing" in parsed ? { missing: parsed.missing } : {}),
    };

  const commit = form.get("commit") === "1";
  const res = await importEmployees(ctx, { rows: parsed.rows, commit });
  if (!res.ok) return { error: res.error };
  return { report: res.data, committed: commit && res.data.imported > 0 };
}
