import "server-only";

type GiveawayCsvRow = Record<string, unknown>;

/**
 * Protect spreadsheet consumers from formula injection. Leading spaces are
 * ignored by spreadsheet formula parsers, while raw tab/CR prefixes can hide
 * a formula from visual inspection, so both forms are guarded.
 */
export function escapeGiveawayCsvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const trimmedLeadingCharacter = text.trimStart().charAt(0);
  const needsFormulaEscape =
    ["=", "+", "-", "@"].includes(trimmedLeadingCharacter) || /^[\t\r]/.test(text);

  return needsFormulaEscape ? `'${text}` : text;
}

function quoteGiveawayCsvCell(value: unknown) {
  const escaped = escapeGiveawayCsvCell(value);
  return /[",\n\r]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

/**
 * Serializes only explicitly requested columns. Callers must build a
 * privacy-scoped projection rather than pass persistence records wholesale.
 */
export function buildGiveawayCsv(columns: readonly string[], rows: readonly GiveawayCsvRow[]) {
  const header = columns.map(quoteGiveawayCsvCell).join(",");
  const body = rows.map((row) => columns.map((column) => quoteGiveawayCsvCell(row[column])).join(","));
  return [header, ...body].join("\n");
}
