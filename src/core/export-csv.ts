import { parseOtpAuthUri, type SeedParams } from "#/core/otpauth";

/**
 * A single OTP-bearing row of a Passwords.app export.
 *
 * `params` carries the secret, so this type must never be returned from a tool —
 * an export file holds every credential the user has, and the only fields safe to
 * surface are the ones in `PreviewEntry` below.
 */
export type ExportEntry = {
  index: number;
  title: string;
  params: SeedParams;
};

export type PreviewEntry = {
  index: number;
  title: string;
  issuer: string | undefined;
  account: string;
  suggested_label: string;
};

/** RFC 4180, including quoted fields that contain commas, quotes or newlines. */
const parseRows = (text: string): string[][] => {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
};

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z0-9]/.test(slug) ? slug : "";
};

/**
 * Pull the OTP-bearing entries out of a Passwords.app CSV export.
 *
 * Apple's export writes `Title,URL,Username,Password,Notes,OTPAuth`, but the
 * columns are matched by header name rather than position: a positional read
 * would silently pick up the Password column if Apple ever reorders them, which
 * is the worst possible failure for this particular file.
 */
export const parseExportCsv = (text: string): ExportEntry[] => {
  const rows = parseRows(text);
  const header = rows[0];
  if (!header) return [];

  const columns = header.map((h) => h.trim().toLowerCase());
  const otpCol = columns.findIndex((h) => h.includes("otp"));
  if (otpCol === -1) return [];
  const titleCol = columns.findIndex((h) => h === "title" || h === "name");
  const urlCol = columns.findIndex((h) => h === "url" || h === "website");

  const out: ExportEntry[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]!;
    const uri = row[otpCol]?.trim();
    if (!uri || !/^otpauth:/i.test(uri)) continue;
    let params: SeedParams;
    try {
      params = parseOtpAuthUri(uri);
    } catch {
      // A row this server cannot understand is skipped rather than fatal: one bad
      // entry must not hide every good one in a file the user cannot easily edit.
      continue;
    }
    const title = (row[titleCol] || row[urlCol] || params.issuer || params.account || "").trim();
    out.push({ index: out.length, title, params });
  }
  return out;
};

export const previewOf = (entry: ExportEntry): PreviewEntry => ({
  index: entry.index,
  title: entry.title,
  issuer: entry.params.issuer,
  account: entry.params.account,
  suggested_label: slugify(entry.params.issuer ?? entry.title) || `entry_${entry.index}`,
});
