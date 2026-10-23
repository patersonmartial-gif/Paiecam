import { resetTestDatabase } from "@paiecam/db/testing";
import { clearOutbox } from "./outbox";

export default async function setup() {
  await clearOutbox();
  await resetTestDatabase();
}
