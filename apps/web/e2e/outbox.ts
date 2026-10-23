import { readdir, readFile, rm } from "node:fs/promises";

/** Boîte d'envoi locale du serveur de test (voir MAIL_OUTBOX_DIR). */
export const OUTBOX = new URL("../.e2e-outbox", import.meta.url).pathname;

export async function clearOutbox(): Promise<void> {
  await rm(OUTBOX, { recursive: true, force: true });
}

export async function lastMailTo(
  to: string,
): Promise<{ to: string; subject: string; text: string }> {
  const files = (await readdir(OUTBOX).catch(() => [])).sort().reverse();
  for (const f of files) {
    const mail = JSON.parse(await readFile(`${OUTBOX}/${f}`, "utf8"));
    if (mail.to === to) return mail;
  }
  throw new Error(`aucun e-mail pour ${to}`);
}
