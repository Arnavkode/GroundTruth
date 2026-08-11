/**
 * Minimal RFC-4180 CSV reader.
 *
 * Written rather than pulled in so the upload path has no third-party parser
 * in it: fewer moving parts to audit on an endpoint that accepts public input.
 * Handles quoted fields, embedded commas and newlines, and doubled quotes.
 */

export interface CsvTable {
  header: string[];
  rows: string[][];
}

export function parseCsv(text: string): CsvTable {
  // Strip a UTF-8 BOM — Excel exports carry one and it corrupts the first header.
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // Ignore trailing blank lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  pushField();
  pushRow();

  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows };
}

/** Turn a table into objects keyed by header, trimming keys and values. */
export function toObjects(table: CsvTable): Record<string, string>[] {
  return table.rows.map((r) => {
    const o: Record<string, string> = {};
    table.header.forEach((h, idx) => {
      o[h] = (r[idx] ?? "").trim();
    });
    return o;
  });
}
