import { Unzip, UnzipInflate } from "fflate";

export const XLSX_LIMITS = {
  /** Taille du fichier envoyé. */
  maxBytes: 2 * 1024 * 1024,
  /** Taille réelle une fois décompressé (protection contre les « bombes zip »). */
  maxUncompressedBytes: 20 * 1024 * 1024,
  maxEntries: 200,
} as const;

export type XlsxRejection =
  "empty" | "too_large" | "not_xlsx" | "too_many_entries" | "uncompressed_too_large";

export class XlsxRejected extends Error {
  constructor(readonly reason: XlsxRejection) {
    super(reason);
  }
}

/**
 * Vérifie qu'un fichier est un vrai classeur .xlsx raisonnable AVANT de le confier à l'analyseur :
 * signature zip (pas l'extension ni le type MIME déclarés par le navigateur), présence de
 * xl/workbook.xml, nombre d'entrées, et taille décompressée mesurée réellement, flux par flux
 * (les tailles annoncées dans l'en-tête zip peuvent mentir).
 */
export function inspectXlsx(buf: Uint8Array, limits = XLSX_LIMITS): void {
  if (buf.length === 0) throw new XlsxRejected("empty");
  if (buf.length > limits.maxBytes) throw new XlsxRejected("too_large");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new XlsxRejected("not_xlsx");
  }
  let entries = 0;
  let total = 0;
  let hasWorkbook = false;
  // Le motif est mémorisé puis la décompression interrompue : lever une erreur depuis les
  // rappels de fflate ne remonte pas de façon fiable.
  let rejected: XlsxRejection | null = null;
  const unzip = new Unzip((file) => {
    if (rejected) return;
    if (++entries > limits.maxEntries) {
      rejected = "too_many_entries";
      return;
    }
    if (file.name === "xl/workbook.xml") hasWorkbook = true;
    file.ondata = (err, chunk) => {
      if (rejected) return;
      if (err) {
        rejected = "not_xlsx";
        return;
      }
      total += chunk.length;
      if (total > limits.maxUncompressedBytes) {
        rejected = "uncompressed_too_large";
        file.terminate();
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(buf, true);
  } catch {
    rejected ??= "not_xlsx";
  }
  if (rejected) throw new XlsxRejected(rejected);
  if (!hasWorkbook) throw new XlsxRejected("not_xlsx");
}
