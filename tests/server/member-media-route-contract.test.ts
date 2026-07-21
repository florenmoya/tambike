import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("member media App Router boundaries", () => {
  test("authenticates upload signing and never declares Edge/static execution", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/member-media/uploads/route.ts"),
      "utf8",
    );
    expect(source).toContain("readSessionToken");
    expect(source).toContain("createMemberMediaUpload");
    expect(source).toContain('error.code === "INVALID_IMAGE"');
    expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
    expect(source).not.toMatch(/force-static|revalidate\s*=/);
  });

  test("awaits media params, streams WebP privately, and collapses failures to 404", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/media/[mediaId]/route.ts"),
      "utf8",
    );
    expect(source).toMatch(/await\s+(?:context\.)?params/);
    expect(source).toContain("readSessionToken");
    expect(source).toContain("private, no-store");
    expect(source).toContain("image/webp");
    expect(source).toMatch(/status:\s*404/);
    expect(source.replaceAll("\n", " ")).not.toMatch(/Response\.json\([^)]*(?:storageKey|media\/users\/)/);
    expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
    expect(source).not.toMatch(/force-static|revalidate\s*=/);
  });
});
