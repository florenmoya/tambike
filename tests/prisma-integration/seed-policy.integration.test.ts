import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const seedSource = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");

describe("Prisma seed policy", () => {
  test("is structured for an explicit disposable-client seed policy", () => {
    expect(seedSource).toContain("export async function seedPrisma");
    expect(seedSource).toContain("assertDisposableSeedClient");
    expect(seedSource).not.toContain("randomUUID");
    expect(seedSource).not.toContain("mockUsers");
    expect(seedSource).not.toContain("venues");
    expect(seedSource).not.toContain("@seed.tambike.local");
    expect(seedSource).not.toContain("mina.rider@example.com");
    expect(seedSource).not.toContain("scan-rider@seed.tambike.local");
    expect(seedSource).not.toContain("ana.venue@example.com");
    expect(seedSource).not.toContain("approvalType");
  });
});
