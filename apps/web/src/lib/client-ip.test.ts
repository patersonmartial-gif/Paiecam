import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const h = (v: Record<string, string>) => new Headers(v);

describe("clientIp", () => {
  it("x-forwarded-for : prend l'entrée du dernier proxy de confiance, pas celle du client", () => {
    // Le client envoie « 1.2.3.4 » ; le proxy de l'hébergeur ajoute l'IP réelle 198.51.100.7.
    const headers = h({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });
    expect(clientIp(headers, { header: "x-forwarded-for", hops: 1 })).toBe("198.51.100.7");
    expect(
      clientIp(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.0.0.2" }), {
        header: "x-forwarded-for",
        hops: 2,
      }),
    ).toBe("198.51.100.7");
  });
  it("autre en-tête (ex. x-real-ip) : valeur unique", () => {
    expect(clientIp(h({ "x-real-ip": "2001:db8::1" }), { header: "x-real-ip", hops: 1 })).toBe(
      "2001:db8::1",
    );
  });
  it("sans proxy configuré, en-tête absent ou valeur invalide : null", () => {
    expect(
      clientIp(h({ "x-forwarded-for": "198.51.100.7" }), { header: null, hops: 1 }),
    ).toBeNull();
    expect(clientIp(h({}), { header: "x-forwarded-for", hops: 1 })).toBeNull();
    expect(
      clientIp(h({ "x-forwarded-for": "pas-une-ip" }), { header: "x-forwarded-for", hops: 1 }),
    ).toBeNull();
    expect(
      clientIp(h({ "x-forwarded-for": "198.51.100.7" }), { header: "x-forwarded-for", hops: 3 }),
    ).toBeNull();
  });
});
