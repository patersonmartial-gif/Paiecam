import { z } from "zod";

/** Vérifie la clé de contrôle d'un IBAN (ISO 13616, modulo 97). */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** Numéro mobile camerounais normalisé en +2376XXXXXXXX ; null s'il est invalide. */
export function normalizeCameroonMobile(raw: string): string | null {
  const digits = raw.replace(/[\s.()-]/g, "").replace(/^(\+|00)237/, "");
  return /^6\d{8}$/.test(digits) ? `+237${digits}` : null;
}

const isoDate = z.iso.date();
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const employeeSchema = z
  .object({
    matricule: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,20}$/),
    lastName: z.string().trim().min(1).max(100),
    firstNames: z.string().trim().min(1).max(150),
    birthDate: isoDate,
    cnpsNumber: optionalText.pipe(
      z
        .string()
        .transform((v) => v.replace(/[\s.-]/g, "").toUpperCase())
        .pipe(z.string().regex(/^[0-9A-Z]{6,20}$/))
        .optional(),
    ),
    hireDate: isoDate,
    contractType: z.enum(["cdi", "cdd"]),
    endDate: optionalText.pipe(isoDate.optional()),
    jobTitle: z.string().trim().min(1).max(100),
    category: z.string().trim().min(1).max(20),
    echelon: z.string().trim().min(1).max(20),
    baseSalary: z.coerce.number().int().min(0).max(100_000_000),
    maritalStatus: z.enum(["single", "married", "divorced", "widowed"]),
    childrenCount: z.coerce.number().int().min(0).max(30),
    paymentMethod: z.enum(["bank_transfer", "mobile_money", "cash"]),
  })
  .refine((e) => e.hireDate > e.birthDate, { path: ["hireDate"], message: "après la naissance" })
  .refine((e) => !e.endDate || e.endDate >= e.hireDate, {
    path: ["endDate"],
    message: "après l'embauche",
  })
  .refine((e) => e.contractType !== "cdd" || !!e.endDate, {
    path: ["endDate"],
    message: "requise pour un CDD",
  });

export type EmployeeInput = z.input<typeof employeeSchema>;
export type Employee = z.output<typeof employeeSchema>;

export const bankDetailsSchema = z
  .object({
    iban: optionalText.pipe(
      z
        .string()
        .transform((v) => v.replace(/\s/g, "").toUpperCase())
        .refine(isValidIban, "IBAN invalide")
        .optional(),
    ),
    mobileOperator: optionalText.pipe(z.enum(["orange", "mtn"]).optional()),
    mobileNumber: optionalText.pipe(
      z
        .string()
        .transform((v, ctx) => {
          const n = normalizeCameroonMobile(v);
          if (!n) ctx.addIssue({ code: "custom", message: "numéro invalide" });
          return n ?? v;
        })
        .optional(),
    ),
  })
  .refine((b) => !!b.mobileNumber === !!b.mobileOperator, {
    path: ["mobileOperator"],
    message: "opérateur et numéro vont ensemble",
  });

export type BankDetailsInput = z.input<typeof bankDetailsSchema>;
