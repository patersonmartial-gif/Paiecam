import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepte un chemin interne", () => {
    expect(safeNext("/invitation/abc")).toBe("/invitation/abc");
  });
  it("refuse les redirections externes", () => {
    for (const bad of [
      null,
      "",
      "https://malveillant.example",
      "//malveillant.example",
      "/\\malveillant.example",
      "javascript:alert(1)",
    ]) {
      expect(safeNext(bad)).toBe("/tableau-de-bord");
    }
  });
});
