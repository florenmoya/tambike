import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { BackendError } from "../../src/server/backend";
import { MemberProfileScreen } from "../../src/features/member-profiles/member-profile-screen";
import type { MemberProfileEditorView, MemberProfileView } from "../../src/features/member-profiles/types";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const publicProfile: MemberProfileView = {
  slug: "mika-santos",
  displayName: "Mika Santos",
  area: "Davao City",
  role: "organizer",
  bio: "Weekend rider.",
  visibility: "PUBLIC",
  joinedAt: "July 22, 2026",
  profilePhotoUrl: "/media/avatar-1",
  organizer: { hostedEventCount: 3 },
  motorcycle: {
    make: "Honda",
    model: "CB650R",
    nickname: "Ember",
    photos: [
      { url: "/media/bike-1", position: 0, width: 1600, height: 1200 },
      { url: "/media/bike-2", position: 1, width: 1600, height: 1200 },
    ],
  },
};

const editor: MemberProfileEditorView = {
  ...publicProfile,
  slug: "mika-santos",
  isPublished: true,
  defaultRosterIdentity: "ANONYMOUS",
};

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

  test("renders every authorized media image directly and does not nest a main landmark", () => {
    const markup = renderToStaticMarkup(MemberProfileScreen({ profile: publicProfile }));
    const images = [...markup.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];

    expect(images).toHaveLength(4);
    expect(images.map((match) => match[1])).toEqual([
      "/media/avatar-1",
      "/media/bike-1",
      "/media/bike-1",
      "/media/bike-2",
    ]);
    expect(markup).not.toContain("/_next/image");
    expect(markup).not.toContain("<main");
    expect(markup).toContain("<section");
    expect(source("src/features/member-profiles/member-profile-screen.tsx"))
      .toMatch(/function MemberMediaImage\(\{\s*alt,\s*\.\.\.props\s*\}/);
  });

  test("labels profile visibility, attendance privacy, and explicit save or publish actions", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain('htmlFor="profile-visibility"');
    expect(settings).toContain('id="profile-visibility"');
    expect(settings).toContain('htmlFor="default-roster-identity"');
    expect(settings).toContain('id="default-roster-identity"');
    expect(settings).toMatch(/<Card id="attendance-privacy"[\s\S]*?<CardTitle>Attendance privacy<\/CardTitle>/);
    expect(settings).toMatch(/Publish profile|Save profile changes/);
    expect(settings).toMatch(/Identity/);
    expect(settings).toMatch(/Attendance privacy/);
    expect(settings).toMatch(/Motorcycle photos/);
    expect(settings).toContain(
      "This setting applies to all current and future event rosters.",
    );
    expect(settings).toContain(
      "Private or unpublished profiles always appear anonymously.",
    );
    expect(settings).toContain("Anonymous — count me without my card");
    expect(settings).toContain("Visible — show my eligible rider card");
    expect(settings).not.toContain("future event registrations only");
    expect(settings).not.toContain(
      ["Existing RSVPs keep ", "their own choice"].join(""),
    );
  });

  test("submits the current profile privacy values from the form", async () => {
    const settings = await import("../../src/features/member-profiles/profile-settings");
    const profileInputFromFormData = (settings as unknown as {
      profileInputFromFormData?: (formData: FormData) => Record<string, unknown>;
    }).profileInputFromFormData;
    expect(profileInputFromFormData).toBeTypeOf("function");

    const formData = new FormData();
    formData.set("displayName", "Paolo Reyes");
    formData.set("area", "Quezon City");
    formData.set("bio", "Weekend rider.");
    formData.set("visibility", "PUBLIC");
    formData.set("defaultRosterIdentity", "VISIBLE");

    expect(profileInputFromFormData!(formData)).toEqual({
      displayName: "Paolo Reyes",
      area: "Quezon City",
      bio: "Weekend rider.",
      visibility: "PUBLIC",
      defaultRosterIdentity: "VISIBLE",
    });

    const profileSettingsSource = source("src/features/member-profiles/profile-settings.tsx");
    expect(profileSettingsSource).toContain('name="visibility"');
    expect(profileSettingsSource).toContain('name="defaultRosterIdentity"');
    expect(profileSettingsSource).toMatch(/handleProfileSave = async \(formData: FormData\)/);
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
    expect(uploader).toContain('disabled={pending || (purpose === "motorcycle-photo" && photoCount >= 5)}');
  });

  test("keeps motorcycle photo controls keyboard-operable and explicitly labeled", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toMatch(/<button[\s\S]*?Move [^"{]*(?:left|right|earlier|later)/i);
    expect(settings).toMatch(/<button[\s\S]*?Delete motorcycle photo/i);
    expect(settings).not.toMatch(/<div[^>]+onClick=/);
  });

  test("merges saved public profile identity into the signed-in account immediately", async () => {
    const provider = await import("../../src/features/tambike-demo/demo-provider");
    const synchronize = (provider as unknown as {
      synchronizeAccountFromEditor?: (account: Record<string, unknown>, editor: MemberProfileEditorView) => Record<string, unknown>;
    }).synchronizeAccountFromEditor;
    expect(synchronize).toBeTypeOf("function");

    expect(synchronize!({
      id: "user-1",
      displayName: "Old name",
      area: "Manila",
      email: "owner@example.test",
      verificationStatus: "APPROVED",
    }, { ...editor, displayName: "Mika Updated", area: "Cebu City" })).toMatchObject({
      displayName: "Mika Updated",
      area: "Cebu City",
      email: "owner@example.test",
      verificationStatus: "APPROVED",
    });
  });

  test("synchronizes clean privacy controls after upload while preserving an unsaved draft", async () => {
    const settings = await import("../../src/features/member-profiles/profile-settings");
    const reconcile = (settings as unknown as {
      reconcileEditorRefresh?: (state: Record<string, unknown>, refreshed: MemberProfileEditorView) => Record<string, unknown>;
    }).reconcileEditorRefresh;
    expect(reconcile).toBeTypeOf("function");

    const refreshed = { ...editor, visibility: "PUBLIC" as const, defaultRosterIdentity: "VISIBLE" as const };
    const clean = reconcile!({
      editor,
      draft: { visibility: "PRIVATE", defaultRosterIdentity: "ANONYMOUS" },
      profileDirty: false,
    }, refreshed);
    expect(clean).toMatchObject({
      editor: refreshed,
      draft: { visibility: "PUBLIC", defaultRosterIdentity: "VISIBLE" },
      profileDirty: false,
    });

    const dirty = reconcile!({
      editor,
      draft: { visibility: "MEMBERS_ONLY", defaultRosterIdentity: "VISIBLE" },
      profileDirty: true,
    }, refreshed);
    expect(dirty).toMatchObject({
      editor: refreshed,
      draft: { visibility: "MEMBERS_ONLY", defaultRosterIdentity: "VISIBLE" },
      profileDirty: true,
    });
  });

  test("disables the complete profile field group while a save is pending", async () => {
    const settings = await import("../../src/features/member-profiles/profile-settings");
    const PendingFieldset = (settings as unknown as {
      ProfileSaveFieldset?: (props: { pending: boolean; children: ReactNode }) => ReactNode;
    }).ProfileSaveFieldset;
    expect(PendingFieldset).toBeTypeOf("function");

    const markup = renderToStaticMarkup(PendingFieldset!({
      pending: true,
      children: createElement("input", { name: "displayName", defaultValue: "Mika" }),
    }));
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<fieldset[^>]*aria-busy="true"/);
    expect(markup).toContain('<input name="displayName" value="Mika"/>');

    const styles = source("src/app/globals.css");
    expect(styles).toMatch(/\.profile-save-fieldset\s*\{[\s\S]*?border:\s*0;/);
  });

  test("maps only backend not-found profile lookups to the route not-found boundary", async () => {
    const route = await import("../../src/app/riders/[slug]/page");
    const load = (route as unknown as {
      loadRiderProfile?: (
        slug: string,
        getProfile: (slug: string) => Promise<MemberProfileView>,
        showNotFound: () => never,
      ) => Promise<MemberProfileView>;
    }).loadRiderProfile;
    expect(load).toBeTypeOf("function");

    const hidden = new BackendError("NOT_FOUND", "NOT_FOUND");
    const notFoundMarker = new Error("route-not-found");
    await expect(load!("hidden", async () => { throw hidden; }, () => { throw notFoundMarker; }))
      .rejects.toBe(notFoundMarker);

    const outage = new Error("database unavailable");
    await expect(load!("mika", async () => { throw outage; }, () => { throw notFoundMarker; }))
      .rejects.toBe(outage);
  });

  test("rejects invalid files locally and gives stable presign and storage guidance", async () => {
    const uploader = await import("../../src/features/member-profiles/member-media-uploader");
    const validate = (uploader as unknown as {
      validateMemberMediaFile?: (file: { type: string; size: number }) => string | null;
    }).validateMemberMediaFile;
    const perform = (uploader as unknown as {
      performMemberMediaUpload?: (input: Record<string, unknown>, dependencies: Record<string, unknown>) => Promise<void>;
    }).performMemberMediaUpload;
    expect(validate).toBeTypeOf("function");
    expect(perform).toBeTypeOf("function");

    expect(validate!({ type: "image/gif", size: 10 })).toMatch(/JPEG, PNG, or WebP/);
    expect(validate!({ type: "image/jpeg", size: 8 * 1024 * 1024 + 1 })).toMatch(/8 MB/);
    expect(validate!({ type: "image/webp", size: 8 * 1024 * 1024 })).toBeNull();

    const file = new File([new Uint8Array([1])], "rider.webp", { type: "image/webp" });
    let invalidFetchCalled = false;
    await expect(perform!({
      file: new File([new Uint8Array([1])], "animated.gif", { type: "image/gif" }),
      purpose: "avatar",
    }, {
      fetchImpl: async () => {
        invalidFetchCalled = true;
        throw new Error("must not be called");
      },
      finalize: async () => undefined,
      onStatus: () => undefined,
    })).rejects.toThrow(/JPEG, PNG, or WebP/);
    expect(invalidFetchCalled).toBe(false);

    const cases = [
      [401, "UNAUTHENTICATED", /Log in again/],
      [400, "INVALID_INPUT", /JPEG, PNG, or WebP/],
      [503, "UPLOAD_UNAVAILABLE", /temporarily unavailable/],
    ] as const;
    for (const [status, code, message] of cases) {
      await expect(perform!({ file, purpose: "avatar" }, {
        fetchImpl: async () => Response.json({ error: code }, { status }),
        finalize: async () => undefined,
        onStatus: () => undefined,
      })).rejects.toThrow(message);
    }

    let fetchCount = 0;
    await expect(perform!({ file, purpose: "avatar" }, {
      fetchImpl: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return Response.json({
            key: "tmp/users/user-1/nonce",
            mimeType: "image/webp",
            url: "https://uploads.example.test",
            fields: { key: "tmp/users/user-1/nonce" },
          });
        }
        return new Response("policy rejected", { status: 403 });
      },
      finalize: async () => undefined,
      onStatus: () => undefined,
    })).rejects.toThrow(/signed file type or size policy/);

    const statuses: string[] = [];
    let finalizeInput: unknown;
    let requestIndex = 0;
    await perform!({ file, purpose: "motorcycle-photo", motorcyclePhotoPosition: 2 }, {
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        requestIndex += 1;
        if (requestIndex === 1) {
          expect(String(input)).toBe("/api/member-media/uploads");
          return Response.json({
            key: "tmp/users/user-1/nonce",
            mimeType: "image/webp",
            url: "https://uploads.example.test",
            fields: { key: "tmp/users/user-1/nonce", "Content-Type": "image/webp" },
          });
        }
        expect(String(input)).toBe("https://uploads.example.test");
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init?.body as FormData).get("key")).toBe("tmp/users/user-1/nonce");
        expect((init?.body as FormData).get("file")).toBe(file);
        return new Response(null, { status: 204 });
      },
      finalize: async (input: unknown) => {
        finalizeInput = input;
      },
      onStatus: (status: unknown) => statuses.push(String(status)),
    });
    expect(finalizeInput).toEqual({
      purpose: "motorcycle-photo",
      tempKey: "tmp/users/user-1/nonce",
      claimedMimeType: "image/webp",
      motorcyclePhotoPosition: 2,
    });
    expect(statuses).toEqual([
      "Preparing secure upload…",
      "Uploading image…",
      "Finishing image…",
    ]);
  });

  test("disables the file chooser during upload and at the motorcycle photo cap", async () => {
    const uploader = await import("../../src/features/member-profiles/member-media-uploader");
    const FileChooser = (uploader as unknown as {
      MemberMediaFileChooser?: (props: {
        inputId: string;
        purpose: "avatar" | "motorcycle-photo";
        photoCount: number;
        pending: boolean;
        onFileSelected: (file: File | null) => void;
      }) => ReactNode;
    }).MemberMediaFileChooser;
    expect(FileChooser).toBeTypeOf("function");

    const pendingMarkup = renderToStaticMarkup(FileChooser!({
      inputId: "pending-avatar",
      purpose: "avatar",
      photoCount: 0,
      pending: true,
      onFileSelected: () => undefined,
    }));
    expect(pendingMarkup).toMatch(/<input[^>]*disabled=""/);

    const cappedMarkup = renderToStaticMarkup(FileChooser!({
      inputId: "capped-bike",
      purpose: "motorcycle-photo",
      photoCount: 5,
      pending: false,
      onFileSelected: () => undefined,
    }));
    expect(cappedMarkup).toMatch(/<input[^>]*disabled=""/);

    const readyMarkup = renderToStaticMarkup(FileChooser!({
      inputId: "ready-avatar",
      purpose: "avatar",
      photoCount: 0,
      pending: false,
      onFileSelected: () => undefined,
    }));
    expect(readyMarkup).not.toContain('disabled=""');
  });
});
