import { describe, expect, it, vi } from "vitest";
import { log, MASK, maskPII } from "./log";

describe("maskPII", () => {
  it("masque les champs sensibles par leur nom", () => {
    expect(
      maskPII({
        cnpsNumber: "123456789",
        iban: "CM2110001000010123456789012",
        mobileMoney: "+237690000000",
        baseSalary: 350_000,
        password: "x",
        name: "Entreprise fictive",
      }),
    ).toEqual({
      cnpsNumber: MASK,
      iban: MASK,
      mobileMoney: MASK,
      baseSalary: MASK,
      password: MASK,
      name: "Entreprise fictive",
    });
  });

  it("masque les e-mails, IBAN et longs numéros dans le texte libre", () => {
    expect(maskPII("contact jean.fictif@exemple.test tel 690 00 00 00")).toBe(
      `contact ${MASK} tel ${MASK}`,
    );
    expect(maskPII("virement CM21 1000 1000 0101 2345 6789 012")).toBe(`virement ${MASK}`);
  });

  it("laisse les UUID lisibles", () => {
    const id = "01a1688e-2acd-7f3b-9d1d-1a9be2a892b4";
    expect(maskPII(`tenant ${id} tel 690000000`)).toBe(`tenant ${id} tel ${MASK}`);
  });

  it("parcourt les objets imbriqués, tableaux et erreurs", () => {
    expect(maskPII({ a: [{ email: "x@y.zz" }], e: new Error("échec pour x@y.zz") })).toEqual({
      a: [{ email: MASK }],
      e: { name: "Error", message: `échec pour ${MASK}` },
    });
    expect(maskPII({ email: null, n: 3, ok: true })).toEqual({ email: null, n: 3, ok: true });
  });

  it("coupe les structures trop profondes", () => {
    let deep: Record<string, unknown> = { v: "fin" };
    for (let i = 0; i < 12; i++) deep = { d: deep };
    expect(JSON.stringify(maskPII(deep))).toContain(MASK);
  });
});

describe("log", () => {
  it("écrit une ligne JSON masquée", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    log("error", "échec pour a@b.cm", { iban: "CM21…", tenantId: "t1" });
    log("info", "ok");
    const line = JSON.parse(String(err.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      level: "error",
      message: `échec pour ${MASK}`,
      iban: MASK,
      tenantId: "t1",
    });
    expect(String(out.mock.calls[0]?.[0])).toContain('"level":"info"');
    err.mockRestore();
    out.mockRestore();
  });
});
