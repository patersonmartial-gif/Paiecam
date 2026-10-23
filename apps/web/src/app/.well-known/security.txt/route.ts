import { env } from "@/env";

export const dynamic = "force-dynamic";

/** RFC 9116. Sans contact configuré (développement), la route n'existe pas. */
export function GET() {
  if (!env.SECURITY_CONTACT) return new Response(null, { status: 404 });
  const expires = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();
  const body = [
    `Contact: ${env.SECURITY_CONTACT}`,
    `Expires: ${expires}`,
    "Preferred-Languages: fr, en",
    `Canonical: ${new URL("/.well-known/security.txt", env.APP_URL).toString()}`,
    `Policy: ${new URL("/mentions-legales", env.APP_URL).toString()}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "max-age=86400" },
  });
}
