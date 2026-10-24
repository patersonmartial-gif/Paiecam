import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Un seul .env, à la racine du monorepo (en CI et en prod, les variables viennent de l'environnement).
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de fichier .env
}

// En-têtes fixes. La CSP, qui porte un nonce par requête, est posée par src/proxy.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Image Docker minimale : serveur autonome avec les seules dépendances tracées du monorepo.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // Import Excel : fichier de 2 Mo maximum (contrôlé aussi côté serveur), plus l'enveloppe multipart.
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb",
      // Derrière un proxy, l'origine publique doit être déclarée pour le contrôle CSRF de Next.js.
      allowedOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : [],
    },
  },
  serverExternalPackages: ["@node-rs/argon2"],
  transpilePackages: ["@paiecam/paie-engine", "@paiecam/db", "@paiecam/security", "@paiecam/local"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);
