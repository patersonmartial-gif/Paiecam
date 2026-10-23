import { describe, expect, it } from "vitest";
import {
  bankDetailsSchema,
  employeeSchema,
  isValidIban,
  normalizeCameroonMobile,
} from "./employee-schema";

// IBAN de test valide (clé calculée), sans lien avec un compte réel.
const IBAN = "CM2110002000300277976315008";

describe("isValidIban", () => {
  it("accepte un IBAN à la clé correcte, avec ou sans espaces", () => {
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban("cm21 1000 2000 3002 7797 6315 008")).toBe(true);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
  });
  it("refuse une clé fausse ou un format invalide", () => {
    expect(isValidIban("CM2210002000300277976315008")).toBe(false);
    expect(isValidIban("CM21")).toBe(false);
    expect(isValidIban("1234567890123456")).toBe(false);
  });
});

describe("normalizeCameroonMobile", () => {
  it("normalise les formats courants", () => {
    for (const v of [
      "690123456",
      "6 90 12 34 56",
      "+237 690 12 34 56",
      "00237690123456",
      "690-12-34-56",
    ]) {
      expect(normalizeCameroonMobile(v)).toBe("+237690123456");
    }
  });
  it("refuse un fixe ou une longueur fausse", () => {
    expect(normalizeCameroonMobile("222123456")).toBeNull();
    expect(normalizeCameroonMobile("69012345")).toBeNull();
  });
});

const valid = {
  matricule: "E-001",
  lastName: "Fictif",
  firstNames: "Jean",
  birthDate: "1990-05-01",
  cnpsNumber: "123 456 789",
  hireDate: "2024-01-15",
  contractType: "cdi",
  endDate: "",
  jobTitle: "Vendeur",
  category: "4",
  echelon: "B",
  baseSalary: "185000",
  maritalStatus: "married",
  childrenCount: "2",
  paymentMethod: "mobile_money",
};

describe("employeeSchema", () => {
  it("normalise une fiche valide", () => {
    const e = employeeSchema.parse(valid);
    expect(e).toMatchObject({ cnpsNumber: "123456789", baseSalary: 185_000, childrenCount: 2 });
    expect(e.endDate).toBeUndefined();
  });
  it("accepte une fiche sans n° CNPS (salarié en cours d'immatriculation)", () => {
    expect(employeeSchema.parse({ ...valid, cnpsNumber: "" }).cnpsNumber).toBeUndefined();
  });
  it("refuse un salaire non entier ou négatif", () => {
    expect(employeeSchema.safeParse({ ...valid, baseSalary: "185000.5" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, baseSalary: "-1" }).success).toBe(false);
  });
  it("vérifie la cohérence des dates et du contrat", () => {
    expect(employeeSchema.safeParse({ ...valid, hireDate: "1980-01-01" }).success).toBe(false);
    expect(employeeSchema.safeParse({ ...valid, contractType: "cdd" }).success).toBe(false);
    expect(
      employeeSchema.safeParse({ ...valid, contractType: "cdd", endDate: "2024-01-01" }).success,
    ).toBe(false);
    expect(
      employeeSchema.safeParse({ ...valid, contractType: "cdd", endDate: "2025-01-14" }).success,
    ).toBe(true);
  });
  it("refuse un matricule avec des caractères spéciaux", () => {
    expect(employeeSchema.safeParse({ ...valid, matricule: "=CMD()" }).success).toBe(false);
  });
});

describe("bankDetailsSchema", () => {
  it("normalise IBAN et mobile", () => {
    expect(
      bankDetailsSchema.parse({
        iban: "cm21 1000 2000 3002 7797 6315 008",
        mobileOperator: "mtn",
        mobileNumber: "6 70 00 00 01",
      }),
    ).toEqual({ iban: IBAN, mobileOperator: "mtn", mobileNumber: "+237670000001" });
  });
  it("refuse un IBAN invalide, un numéro sans opérateur ou un numéro invalide", () => {
    expect(bankDetailsSchema.safeParse({ iban: "CM2210002000300277976315008" }).success).toBe(
      false,
    );
    expect(bankDetailsSchema.safeParse({ mobileNumber: "670000001" }).success).toBe(false);
    expect(
      bankDetailsSchema.safeParse({ mobileOperator: "orange", mobileNumber: "22200000" }).success,
    ).toBe(false);
  });
  it("accepte des coordonnées vides (paiement en espèces)", () => {
    expect(bankDetailsSchema.parse({ iban: "", mobileOperator: "", mobileNumber: "" })).toEqual({});
  });
});
