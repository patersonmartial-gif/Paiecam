import { afterAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@paiecam/db";
import { testDatabaseUrl } from "@paiecam/db/testing";
import { RuleError } from "@/server/authz/action";
import { hashPassword } from "@/server/auth/password";
import { verifyUserPassword } from "@/server/auth/reauth";

const db = createDb(testDatabaseUrl());

afterAll(async () => {
  await db.$client.end();
});

describe("ressaisie du mot de passe", () => {
  it("accepte le bon mot de passe ; se verrouille après 5 échecs, même avec le bon ensuite", async () => {
    await db.insert(schema.users).values({ id: "ra-user", name: "r", email: "ra@exemple.test" });
    await db.insert(schema.accounts).values({
      id: "ra-acc",
      accountId: "ra-user",
      providerId: "credential",
      userId: "ra-user",
      password: await hashPassword("le-bon-mot-de-passe"),
      updatedAt: new Date(),
    });
    expect(await verifyUserPassword(db, "ra-user", "le-bon-mot-de-passe")).toBe(true);
    for (let i = 0; i < 5; i++) expect(await verifyUserPassword(db, "ra-user", "faux")).toBe(false);
    await expect(verifyUserPassword(db, "ra-user", "le-bon-mot-de-passe")).rejects.toThrow(
      RuleError,
    );
  });

  it("refuse un mot de passe vide ou un compte sans mot de passe", async () => {
    expect(await verifyUserPassword(db, "inconnu", "x")).toBe(false);
    expect(await verifyUserPassword(db, "inconnu-2", "")).toBe(false);
  });
});
