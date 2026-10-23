import { describe, expect, it } from "vitest";
import { spreadsheetSafe } from "../src";

describe("spreadsheetSafe", () => {
  it("neutralise les débuts de formule", () => {
    for (const v of [
      "=1+1",
      "+237690000000",
      "-2",
      "@SUM(A1)",
      "\t=cmd",
      "\r=cmd",
      '=HYPERLINK("http://x")',
    ]) {
      expect(spreadsheetSafe(v)).toBe(`'${v}`);
    }
  });
  it("laisse le texte ordinaire intact", () => {
    for (const v of ["Fictif", "E-001", "185000", "", "a=b"]) expect(spreadsheetSafe(v)).toBe(v);
  });
});
