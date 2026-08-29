export type ParseCsvTextResult =
  | { ok: true; records: string[][] }
  | { ok: false; kind: "unclosed_quote"; rowNumber: number };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * RFC 4180-style CSV split. Quoted fields may contain commas, quotes (`""`), and newlines.
 * `rowNumber` is 1-based record index (header = 1).
 */
export function parseCsvText(text: string): ParseCsvTextResult {
  const input = stripBom(text);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowNumber = 1;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRecord = () => {
    pushField();
    records.push(row);
    row = [];
    rowNumber += 1;
  };

  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      if (field.length === 0) {
        inQuotes = true;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (c === "\r" || c === "\n") {
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      pushRecord();
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  if (inQuotes) {
    return { ok: false, kind: "unclosed_quote", rowNumber };
  }

  if (field.length > 0 || row.length > 0) {
    pushRecord();
  }

  return { ok: true, records };
}

export function isCsvRecordBlank(record: readonly string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}
