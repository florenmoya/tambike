import "server-only";

import { createHash } from "node:crypto";

/** Serializes JSON-compatible values with lexicographically sorted object keys. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("INVALID_AUDIT_PAYLOAD");
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error("INVALID_AUDIT_PAYLOAD");
      items.push(canonicalizeJson(value[index]));
    }
    return `[${items.join(",")}]`;
  }

  if (!value || typeof value !== "object") throw new Error("INVALID_AUDIT_PAYLOAD");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("INVALID_AUDIT_PAYLOAD");
  }

  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
  return `{${fields.join(",")}}`;
}

/** Hashes the previous chain value and canonical payload without exposing or mutating either. */
export function calculateGiveawayAuditHash(
  previousHash: string | null | undefined,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(canonicalizeJson({ previousHash: previousHash ?? null, payload }))
    .digest("hex");
}
