import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("traductions", () => {
  it("FR et EN ont exactement les mêmes clés", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });
});
