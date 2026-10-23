import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Conditions générales d'utilisation — PaieCam" };

export default function Page() {
  return <LegalPage slug="conditions" />;
}
