import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Politique de confidentialité — PaieCam" };

export default function Page() {
  return <LegalPage slug="confidentialite" />;
}
