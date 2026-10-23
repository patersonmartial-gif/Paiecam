import { z } from "zod";

/**
 * Fiche entreprise. Les formats NIU et CNPS sont volontairement souples en attendant
 * la validation de l'expert-comptable ; les taux AT/MP autorisés viennent de pay_rules en phase 3.
 */
export const companySchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  niu: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{10,20}$/),
  cnpsEmployerNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Z\- ]{5,30}$/i),
  regime: z.enum(["general", "agricole", "enseignement_prive"]),
  workAccidentRate: z.coerce
    .number()
    .pipe(z.union([z.literal(175), z.literal(250), z.literal(500)])),
  commune: z.string().trim().min(2).max(100),
});

export type CompanyInput = z.input<typeof companySchema>;
