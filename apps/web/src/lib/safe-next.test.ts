import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("accepte un chemin interne", () => {
    expect(safeNext("/invitation/abc")).toBe("/invitation/abc");
    expect(safeNext("/paie/12?onglet=bulletins#haut")).toBe("/paie/12?onglet=bulletins#haut");
  });
  it("refuse les redirections externes", () => {
    for (const bad of [
      null,
      "",
      "https://malveillant.example",
      "//malveillant.example",
      "/\\malveillant.example",
      "javascript:alert(1)",
      // Les navigateurs suppriment tabulations et retours à la ligne : « /\t/x » devient « //x ».
      "/\t/malveillant.example",
      "/\n/malveillant.example",
      "/\r\n/malveillant.example",
      "\t//malveillant.example",
    ]) {
      expect(safeNext(bad)).toBe("/tableau-de-bord");
    }
  });
});
