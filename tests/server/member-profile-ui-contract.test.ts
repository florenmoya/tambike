import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("member profile App Router and UI contracts", () => {
  test("awaits the rider slug, queries on the server, and hides lookup failures", () => {
    const route = source("src/app/riders/[slug]/page.tsx");

    expect(route).toMatch(/params:\s*Promise<\{\s*slug:\s*string\s*\}>/);
    expect(route).toMatch(/await\s+params/);
    expect(route).toContain("getMemberProfileAction");
    expect(route).toContain("notFound()");
    expect(route).not.toContain('"use client"');
  });

  test("renders a private-media garage card without account fields", () => {
    const profile = source("src/features/member-profiles/member-profile-screen.tsx");

    expect(profile).toContain('from "next/image"');
    expect(profile).toMatch(/<Image[\s\S]*?alt=/);
    expect(profile).toMatch(/width=\{\d+\}/);
    expect(profile).toMatch(/height=\{\d+\}/);
    expect(profile).toContain("sizes=");
    expect(profile).toMatch(/garage-card/);
    expect(profile).toMatch(/Organizer/);
    expect(profile).toMatch(/No motorcycle added yet/);
    expect(profile).not.toMatch(/email|verificationStatus|verification status/i);
  });

  test("labels profile visibility, attendance privacy, and explicit save or publish actions", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain('htmlFor="profile-visibility"');
    expect(settings).toContain('id="profile-visibility"');
    expect(settings).toContain('htmlFor="default-roster-identity"');
    expect(settings).toContain('id="default-roster-identity"');
    expect(settings).toMatch(/Publish profile|Save profile changes/);
    expect(settings).toMatch(/Identity/);
    expect(settings).toMatch(/Attendance privacy/);
    expect(settings).toMatch(/Motorcycle photos/);
  });

  test("uploads directly with browser FormData and reports progress accessibly", () => {
    const uploader = source("src/features/member-profiles/member-media-uploader.tsx");

    expect(uploader).toContain("/api/member-media/uploads");
    expect(uploader).toContain("new FormData()");
    expect(uploader).toMatch(/fetch\(presign\.url/);
    expect(uploader).toContain("finalizeMemberMediaAction");
    expect(uploader).toContain('aria-live="polite"');
    expect(uploader).toMatch(/Avatar photo/);
    expect(uploader).toMatch(/Motorcycle photo/);
    expect(uploader).toMatch(/Maximum 5 motorcycle photos/);
    expect(uploader).toMatch(/disabled=\{[^}]*photos\.length\s*>=\s*5/);
  });

  test("keeps motorcycle photo controls keyboard-operable and explicitly labeled", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toMatch(/<button[\s\S]*?Move [^"{]*(?:left|right|earlier|later)/i);
    expect(settings).toMatch(/<button[\s\S]*?Delete motorcycle photo/i);
    expect(settings).not.toMatch(/<div[^>]+onClick=/);
  });
});
