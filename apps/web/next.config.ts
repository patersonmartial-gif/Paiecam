import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Un seul .env, à la racine du monorepo (en CI et en prod, les variables viennent de l'environnement).
try {
  process.loadEnvFile("../../.env");
} catch {
  // pas de fichier .env
}

// En-têtes de base. La CSP stricte avec nonce arrive en phase 6 (via proxy.ts).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2"],
  transpilePackages: ["@paiecam/paie-engine", "@paiecam/db"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);
