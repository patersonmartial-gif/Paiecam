import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db as app } from "./db";

// Le référentiel s'administre avec le rôle propriétaire ; l'application ne fait que le lire.
const ownerClient = postgres(process.env.TEST_MIGRATION_DATABASE_URL ?? "", {
  max: 1,
  onnotice: () => {},
});
const owner = drizzle(ownerClient);

afterAll(async () => {
  await ownerClient.end();
  await app.$client.end();
});

const insert = (status: "draft" | "validated", validFrom: string) =>
  owner.execute(sql`
    insert into pay_rules (id, code, valid_from, value, legal_source, status, validated_by, validated_at)
    values (gen_random_uuid(), 'cac', ${validFrom}, '{"rateOfIrpp":1000,"rounding":"down"}', 'test',
            ${status}, ${status === "validated" ? "Expert fictif" : null}, ${status === "validated" ? new Date().toISOString() : null})`);

async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  return "aucune erreur";
}

describe("pay_rules", () => {
  it("une règle validée exige un validateur et une date", async () => {
    expect(
      await pgError(
        owner.execute(sql`insert into pay_rules (id, code, valid_from, value, legal_source, status)
          values (gen_random_uuid(), 'cac', '2030-01-01', '{}', 'x', 'validated')`),
      ),
    ).toMatch(/pay_rules_validation_chk/);
  });

  it("une règle validée est figée : ni modification ni suppression", async () => {
    await insert("validated", "2031-01-01");
    expect(
      await pgError(
        owner.execute(
          sql`update pay_rules set value = '{"rateOfIrpp":2000}' where valid_from = '2031-01-01'`,
        ),
      ),
    ).toMatch(/seule la date de fin/);
    expect(
      await pgError(owner.execute(sql`delete from pay_rules where valid_from = '2031-01-01'`)),
    ).toMatch(/suppression interdite/);
  });

  it("on peut seulement lui poser une date de fin, une seule fois", async () => {
    expect(
      await pgError(
        owner.execute(
          sql`update pay_rules set valid_to = '2031-12-31' where valid_from = '2031-01-01'`,
        ),
      ),
    ).toBe("aucune erreur");
    expect(
      await pgError(
        owner.execute(
          sql`update pay_rules set valid_to = '2032-06-30' where valid_from = '2031-01-01'`,
        ),
      ),
    ).toMatch(/seule la date de fin/);
  });

  it("un brouillon reste modifiable, et une version par code et date d'effet", async () => {
    await insert("draft", "2032-01-01");
    expect(
      await pgError(
        owner.execute(
          sql`update pay_rules set value = '{"rateOfIrpp":1100,"rounding":"down"}' where valid_from = '2032-01-01'`,
        ),
      ),
    ).toBe("aucune erreur");
    expect(await pgError(insert("draft", "2032-01-01"))).toMatch(/pay_rules_code_valid_from_key/);
  });

  it("le rôle applicatif lit le référentiel sans pouvoir l'écrire", async () => {
    expect((await app.execute(sql`select 1 from pay_rules`)).length).toBeGreaterThan(0);
    expect(await pgError(app.execute(sql`update pay_rules set legal_source = 'x'`))).toMatch(
      /permission denied/,
    );
    expect(
      await pgError(
        app.execute(sql`insert into pay_rules (id, code, valid_from, value, legal_source)
      values (gen_random_uuid(), 'cac', '2040-01-01', '{}', 'x')`),
      ),
    ).toMatch(/permission denied/);
  });
});
