import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const read = (file: string) =>
  fs.readFileSync(path.join(root, file), "utf8");

describe("public attendee preview source contract", () => {
  test("keeps public preview separate from the protected roster", () => {
    const actions = read("src/server/actions.ts");
    const memory = read("src/server/backend.ts");
    const prisma = read("src/server/prisma-backend.ts");

    expect(actions).toContain("getPublicEventAttendeePreviewAction");
    expect(actions).toContain("backend.getPublicEventAttendeePreview(eventId)");
    expect(memory).toContain("getPublicEventAttendeePreview(");
    expect(prisma).toContain("getPublicEventAttendeePreview(");
    expect(prisma).toContain('profileVisibility: "PUBLIC"');
    expect(prisma).toContain('defaultRosterIdentity: "VISIBLE"');
    expect(prisma).toContain('status: "going"');
    expect(actions).not.toMatch(
      /getPublicEventAttendeePreviewAction[\s\S]{0,300}readRequiredSessionToken/,
    );
  });
});
