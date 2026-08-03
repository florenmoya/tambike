function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const protectedText = /^[\p{White_Space}\p{Cc}]*[=+\-@]/u.test(text)
    ? `'${text}`
    : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function encodeCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
