import { describe, expect, it } from "vitest";
import { lockKey, lockSeconds } from "./lockout";

describe("lockSeconds", () => {
  it("progressif : rien avant 5 échecs, puis 1, 5 et 15 minutes", () => {
    expect([0, 4, 5, 9, 10, 14, 15, 100].map(lockSeconds)).toEqual([
      0, 0, 60, 60, 300, 300, 900, 900,
    ]);
  });
  it("clé = empreinte insensible à la casse et aux espaces, distincte selon l'usage", () => {
    expect(lockKey("signin", " A@B.cm ")).toBe(lockKey("signin", "a@b.cm"));
    expect(lockKey("signin", "a@b.cm")).not.toBe(lockKey("reauth", "a@b.cm"));
    expect(lockKey("signin", "a@b.cm")).toMatch(/^[0-9a-f]{64}$/);
  });
});
