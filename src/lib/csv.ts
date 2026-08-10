/**
 * A small RFC 4180 CSV reader for bulk uploads.
 *
 * Written by hand rather than pulled from npm because the requirements are
 * narrow and well defined: quoted fields, escaped quotes (`""`), embedded
 * newlines, and both CRLF and LF line endings. Splitting on commas would
 * corrupt any post text containing a comma — which is most of them.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip rows that are entirely empty (trailing newline at end of file).
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      // Consume CRLF as a single terminator.
      if (text[index + 1] === '\n') index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parse a CSV with a header row into objects keyed by normalised column name
 * ("Scheduled At" and "scheduled_at" both become `scheduled_at`).
 */
export function parseCsvWithHeader(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  const header = rows.shift();
  if (!header) return [];

  const keys = header.map((name) => name.trim().toLowerCase().replace(/[\s-]+/g, '_'));

  return rows.map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, columnIndex) => {
      record[key] = (row[columnIndex] ?? '').trim();
    });
    return record;
  });
}

export const BULK_CSV_TEMPLATE = [
  'message,link,scheduled_at,media_url',
  '"Spring sale starts today — 20% off everything.",https://example.com/sale,2026-09-01 09:00,',
  '"New blog post: how we cut build times in half.",https://example.com/blog/builds,2026-09-02 14:30,',
  '"Behind the scenes at the workshop.",,2026-09-03 11:00,https://example.com/photo.jpg',
  '',
].join('\n');
