import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Mentions légales — PaieCam" };

export default function Page() {
  return <LegalPage slug="mentions-legales" />;
}
