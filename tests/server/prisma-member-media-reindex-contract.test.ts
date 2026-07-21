import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const prismaBackend = readFileSync(
  resolve(process.cwd(), "src/server/prisma-backend.ts"),
  "utf8",
);

describe("Prisma motorcycle photo reindex contract", () => {
  test("never stages positions outside the database's zero-through-four constraint", () => {
    const mediaPersistence = prismaBackend.slice(
      prismaBackend.indexOf("private removeMemberMediaRecord"),
      prismaBackend.indexOf("private async resolveMemberMediaDescriptor"),
    );

    expect(mediaPersistence).not.toContain("position: { increment: 10 }");
    expect(mediaPersistence).toContain("private async replaceMotorcyclePhotoOrder");
    expect(mediaPersistence).toContain("motorcyclePhoto.deleteMany");
    expect(mediaPersistence).toContain("motorcyclePhoto.createMany");
  });
});
