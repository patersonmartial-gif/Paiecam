import "server-only";
import { createFsStorage } from "@paiecam/documents";
import { env } from "@/env";
import { keyring } from "./crypto";

export const storage = createFsStorage(env.DOCUMENTS_DIR, keyring);
