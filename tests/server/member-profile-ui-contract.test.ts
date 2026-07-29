import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { BackendError } from "../../src/server/backend";
import { MemberProfileScreen } from "../../src/features/member-profiles/member-profile-screen";
import {
  getProfileEditorPresentation,
  type ProfileEditorPresentationInput,
} from "../../src/features/member-profiles/profile-editor-presentation";
import { RiderGarageView } from "../../src/features/member-profiles/rider-garage-view";
import { toProfilePreviewView } from "../../src/features/member-profiles/profile-preview-adapter";
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

const completeProfileInput: ProfileEditorPresentationInput = {
  isPublished: false,
  slug: "mika-santos",
  displayName: "Mika Santos",
  area: "Davao City",
  make: "Honda",
  model: "CB650R",
  photoCount: 1,
};

describe("member profile App Router and UI contracts", () => {
  test("names the first missing publish requirement and shows only incomplete signals", () => {
    const presentation = getProfileEditorPresentation({
      ...completeProfileInput,
      displayName: "",
      area: "",
      photoCount: 0,
    });

    expect(presentation.state).toBe("incomplete");
    expect(presentation.label).toBe("Complete your profile");
    expect(presentation.description).toBe("Display name is required to publish.");
    expect(presentation.requirements.map(({ label, required, ready }) => ({
      label,
      required,
      ready,
    }))).toEqual([
      { label: "Display name", required: true, ready: false },
      { label: "Area / city", required: true, ready: false },
      { label: "Make", required: true, ready: true },
      { label: "Model", required: true, ready: true },
      { label: "Motorcycle photos", required: true, ready: false },
    ]);
    expect(presentation.signals).toEqual([
      { label: "Identity", ready: false },
      { label: "Motorcycle", ready: true },
      { label: "Photo", ready: false },
    ]);
    expect(presentation.viewAction).toEqual({
      label: "Preview profile",
      href: "/profile/preview",
    });
  });

  test("returns compact ready and live states with one contextual viewing action", () => {
    const ready = getProfileEditorPresentation(completeProfileInput);
    expect(ready).toMatchObject({
      state: "ready",
      label: "Ready to publish",
      signals: [],
      viewAction: { label: "Preview profile", href: "/profile/preview" },
    });

    const live = getProfileEditorPresentation({
      ...completeProfileInput,
      isPublished: true,
    });
    expect(live).toMatchObject({
      state: "live",
      label: "Live",
      signals: [],
      viewAction: {
        label: "View public profile",
        href: "/riders/mika-santos",
      },
    });
  });

  test("awaits the rider slug, queries on the server, and hides lookup failures", () => {
    const route = source("src/app/riders/[slug]/page.tsx");

    expect(route).toMatch(/params:\s*Promise<\{\s*slug:\s*string\s*\}>/);
    expect(route).toMatch(/await\s+params/);
    expect(route).toContain("getMemberProfileAction");
    expect(route).toContain("notFound()");
    expect(route).not.toContain('"use client"');
  });

  test("renders a private-media garage card without account fields", () => {
    const garage = source("src/features/member-profiles/rider-garage-view.tsx");
    const image = source("src/features/member-profiles/member-media-image.tsx");

    expect(image).toContain('from "next/image"');
    expect(image).toMatch(/<Image[\s\S]*?alt=/);
    expect(image).toMatch(/function MemberMediaImage\(\{\s*alt,\s*\.\.\.props\s*\}/);
    expect(garage).toMatch(/width=\{\d+\}/);
    expect(garage).toMatch(/height=\{\d+\}/);
    expect(garage).toContain("sizes=");
    expect(garage).toMatch(/garage-card/);
    expect(garage).toMatch(/Organizer/);
    expect(garage).toMatch(/No motorcycle added yet/);
    expect(garage).not.toMatch(/email|verificationStatus|verification status/i);
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
    expect(source("src/features/member-profiles/member-media-image.tsx"))
      .toMatch(/function MemberMediaImage\(\{\s*alt,\s*\.\.\.props\s*\}/);
  });

  test("derives a public-safe preview from unsaved profile and motorcycle drafts", () => {
    const preview = toProfilePreviewView(
      editor,
      {
        displayName: "Draft Rider",
        area: "Cebu City",
        bio: "Draft garage note.",
        visibility: "MEMBERS_ONLY",
        defaultRosterIdentity: "VISIBLE",
      },
      {
        make: "Yamaha",
        model: "XSR900",
        year: 2025,
        displacementCc: 890,
        nickname: "Midnight",
        description: "Unsaved motorcycle note.",
      },
    );

    expect(preview).toMatchObject({
      slug: "mika-santos",
      displayName: "Draft Rider",
      area: "Cebu City",
      bio: "Draft garage note.",
      visibility: "MEMBERS_ONLY",
      role: "organizer",
      joinedAt: "July 22, 2026",
      profilePhotoUrl: "/media/avatar-1",
      organizer: { hostedEventCount: 3 },
      motorcycle: {
        make: "Yamaha",
        model: "XSR900",
        year: 2025,
        displacementCc: 890,
        nickname: "Midnight",
        description: "Unsaved motorcycle note.",
        photos: editor.motorcycle?.photos,
      },
    });
    expect(preview).not.toHaveProperty("defaultRosterIdentity");
    expect(preview).not.toHaveProperty("isPublished");
  });

  test("uses the public empty-garage state for an incomplete motorcycle draft", () => {
    const preview = toProfilePreviewView(
      editor,
      {
        displayName: editor.displayName,
        area: editor.area,
        bio: editor.bio,
        visibility: editor.visibility,
        defaultRosterIdentity: editor.defaultRosterIdentity,
      },
      { make: "Honda", model: "" },
    );

    expect(preview.motorcycle).toBeUndefined();
    expect(renderToStaticMarkup(createElement(RiderGarageView, { profile: preview })))
      .toContain("No motorcycle added yet");
  });

  test("uses one shared rider garage view for public and editor presentation", () => {
    const screen = source("src/features/member-profiles/member-profile-screen.tsx");
    const garage = source("src/features/member-profiles/rider-garage-view.tsx");

    expect(screen).toContain("<RiderGarageView");
    expect(garage).toContain("garage-identity-plate");
    expect(garage).toContain("garage-motorcycle-hero");
    expect(garage).toContain("garage-contact-strip");
    expect(garage).not.toMatch(/email|verificationStatus|storageKey/i);
  });

  test("eagerly loads the garage cover wherever its source appears", () => {
    const markup = renderToStaticMarkup(createElement(RiderGarageView, {
      profile: publicProfile,
      prioritizeMedia: true,
    }));
    const images = [...markup.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);

    expect(images.map((image) => ({
      src: image.match(/\bsrc="([^"]+)"/)?.[1],
      loading: image.includes('loading="eager"') ? "eager" : "lazy",
    }))).toEqual([
      { src: "/media/avatar-1", loading: "eager" },
      { src: "/media/bike-1", loading: "eager" },
      { src: "/media/bike-1", loading: "eager" },
      { src: "/media/bike-2", loading: "lazy" },
    ]);
    expect(source("src/features/member-profiles/profile-settings.tsx"))
      .toContain("<RiderGarageView profile={previewProfile} prioritizeMedia />");
  });

  test("offers edit and exact public-preview modes without unmounting editor state", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain('"edit" | "preview"');
    expect(settings).toContain("Edit profile");
    expect(settings).toContain("Preview profile");
    expect(settings).toContain("Preview — only you can see this");
    expect(settings).toContain("<RiderGarageView");
    expect(settings).toContain("toProfilePreviewView(");
    expect(settings).toContain('hidden={studioMode !== "edit"}');
    expect(settings).toContain('hidden={studioMode !== "preview"}');
    expect(settings).not.toContain("ProfileStudioPreview");
    expect(settings).not.toContain("studioPreviewColumn");
  });

  test("styles the full visitor garage preview instead of a compact sidebar card", () => {
    const styles = source(
      "src/features/member-profiles/profile-studio.module.css",
    );

    expect(styles).toContain(".studioModeSwitch");
    expect(styles).toContain(".studioPreviewMode");
    expect(styles).toContain(".studioPreviewNotice");
    expect(styles).toMatch(
      /\.studioPreviewMode\s+:global\(\.garage-profile-page\)[\s\S]*?min-height:\s*auto;/,
    );
    expect(styles).not.toContain(".studioPreviewColumn");
    expect(styles).not.toContain(".studioPreviewHero");
  });

  test("keeps both profile workspace mode labels readable", () => {
    const styles = source(
      "src/features/member-profiles/profile-studio.module.css",
    );

    expect(styles).toMatch(
      /\.studioModeSwitch\s+:global\(\[data-slot="button"\]\[aria-pressed="true"\]\)[\s\S]*?background:\s*var\(--studio-amber\);[\s\S]*?color:\s*var\(--studio-asphalt\);/,
    );
    expect(styles).toMatch(
      /\.studioModeSwitch\s+:global\(\[data-slot="button"\]\[data-variant="outline"\]\[aria-pressed="false"\]\)[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--studio-paper\);/,
    );
  });

  test("explains the next rider-facing profile action", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain("Show riders what you ride");
    expect(settings).toContain("Ready for your next meetup");
    expect(settings).toContain("Your rider card is live");
    expect(settings).toContain("Identity");
    expect(settings).toContain("Motorcycle");
    expect(settings).toContain("Photo");
    expect(settings).not.toContain("4 of 4 ready");
    expect(settings).not.toContain("Not published");
    expect(settings).not.toContain("Profile readiness");
  });

  test("composes the profile editor as a professional Garage Studio", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");
    const styles = source(
      "src/features/member-profiles/profile-studio.module.css",
    );
    expect(settings).toContain("Garage Studio");
    expect(settings).toContain("MotorcyclePhotoWorkspace");
    expect(settings).toContain("styles.studioEditor");
    expect(settings).toContain("Rider card status");
    expect(settings).toContain("riderSignals");
    expect(settings).toContain("styles.mediaStatus");
    expect(styles).toContain(".studio");
    expect(styles).toContain(".studioStatus");
    expect(styles).toContain(".studioStatusSignals");
    expect(styles).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.studioStatus\s*\{/);
    expect(styles).not.toContain(".readiness");
    expect(styles).toContain(".motorcyclePhotoCardCover");
    expect(styles).toMatch(
      /:global\(\.ambient-main\):has\(\.studio\)\s*\{[\s\S]*?overflow:\s*visible;/,
    );
    expect(styles).toMatch(
      /:global\(\.buy-view\):has\(\.studio\)\s*\{[\s\S]*?overflow:\s*visible;/,
    );
    expect(styles).toMatch(
      /\.studio\s+\.mediaStatus\s*\{[\s\S]*?color:\s*var\(--studio-paper\);/,
    );
    expect(styles).toMatch(/@media\s*\(max-width:\s*900px\)/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test("allows local photo selection before motorcycle persistence", () => {
    const settings = source(
      "src/features/member-profiles/profile-settings.tsx",
    );
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );

    expect(settings).toContain(
      "uploadEnabled={Boolean(editor.motorcycle)}",
    );
    expect(workspace).toContain("uploadEnabled: boolean");
    expect(workspace).toContain(
      "Photos are ready. Save your motorcycle to start uploading.",
    );
    expect(workspace).toContain("disabled={availableSlots === 0}");
    expect(workspace).toContain("uploadEnabled,");
    expect(workspace).not.toContain("disabled={!editor.motorcycle}");
    expect(workspace).not.toContain("if (disabled || files.length === 0)");
  });

  test("preserves a dirty motorcycle draft across media refresh", async () => {
    const settings = await import(
      "../../src/features/member-profiles/profile-settings"
    );
    const reconcile = (settings as unknown as {
      reconcileMotorcycleDraft?: (
        draft: Record<string, unknown>,
        dirty: boolean,
        refreshed: MemberProfileEditorView,
      ) => Record<string, unknown>;
    }).reconcileMotorcycleDraft;
    expect(reconcile).toBeTypeOf("function");
    expect(reconcile!(
      { make: "Draft Make", model: "Draft Model" },
      true,
      editor,
    )).toMatchObject({ make: "Draft Make", model: "Draft Model" });
    expect(reconcile!(
      { make: "Old", model: "Old" },
      false,
      editor,
    )).toMatchObject({ make: "Honda", model: "CB650R" });
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
    expect(source("src/features/member-profiles/motorcycle-photo-workspace.tsx"))
      .toMatch(/Motorcycle photos/i);
    expect(settings).not.toContain(
      '<MemberMediaUploader purpose="motorcycle-photo"',
    );
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
    const workspace = source("src/features/member-profiles/motorcycle-photo-workspace.tsx");

    expect(workspace).toMatch(/<Button[\s\S]*?Move [^"{]*(?:left|right)/i);
    expect(workspace).toMatch(/<Button[\s\S]*?Delete motorcycle photo/i);
    expect(workspace).not.toMatch(/<div[^>]+onClick=/);
  });

  test("names saved-photo actions by their visible result", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(workspace).toContain("Set as cover");
    expect(workspace).toContain("Move left");
    expect(workspace).toContain("Move right");
    expect(workspace).toContain("Cover photo");
    expect(workspace).toMatch(/Photo\s*\{index \+ 1\}\s*of\s*\{photos.length\}/);
    expect(workspace).toContain("onReorder(index, 0)");
    expect(workspace).toMatch(/Set motorcycle photo \$\{index \+ 1\} as cover/);
    expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} left/);
    expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} right/);
    expect(workspace).toContain('loading={index === 0 ? "eager" : undefined}');
    expect(workspace).not.toContain("Move earlier");
    expect(workspace).not.toContain("Move later");
    expect(settings).toContain('direction < 0 ? "left" : "right"');
    expect(settings).not.toContain('"earlier" : "later"');
  });

  test("keeps the public rider garage below the mobile header", () => {
    const styles = source("src/app/globals.css");

    expect(styles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.garage-profile-page\s*\{[\s\S]*?padding-top:\s*84px;/,
    );
  });

  test("offers a multi-file drag and drop motorcycle workspace", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );
    expect(workspace).toContain("multiple");
    expect(workspace).toContain("onDrop");
    expect(workspace).toContain("Drop motorcycle photos here");
    expect(workspace).toContain("nextReadyMotorcyclePhoto");
    expect(workspace).toContain("performMemberMediaUpload");
    expect(workspace).toContain('aria-live="polite"');
    expect(workspace).toContain("styles.motorcyclePhotoDropzone");
    expect(workspace).toContain("styles.motorcyclePhotoCardCover");
    expect(workspace).toContain("draggable");
    expect(workspace).toContain("onDragStart");
    expect(workspace).toContain("onDrop");
    expect(workspace).toMatch(/Cover/);
    expect(workspace).toMatch(/Retry/);
    expect(workspace).toMatch(/Remove/);
    expect(workspace).toMatch(/Move motorcycle photo .* left/);
    expect(workspace).toMatch(/Move motorcycle photo .* right/);
  });

  test("keeps a finalized refresh error locked to refresh-only recovery", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );

    expect(workspace).toMatch(
      /item\.status === "uploaded" && item\.error[\s\S]*?>Refresh gallery<\/Button>/,
    );
    expect(workspace).toMatch(
      /\{item\.status !== "uploaded" \? \([\s\S]*?disabled=\{item\.status === "uploading"\}[\s\S]*?>Remove<\/Button>[\s\S]*?\) : null\}/,
    );
  });

  test("allows a multiple file picker while preserving the five-photo cap", async () => {
    const uploader = await import(
      "../../src/features/member-profiles/member-media-uploader"
    );
    const DropInput = (uploader as unknown as {
      MemberMediaDropInput?: (props: {
        inputId: string;
        disabled: boolean;
        onFilesSelected: (files: File[]) => void;
      }) => ReactNode;
    }).MemberMediaDropInput;
    expect(DropInput).toBeTypeOf("function");
    const markup = renderToStaticMarkup(DropInput!({
      inputId: "motorcycle-files",
      disabled: false,
      onFilesSelected: () => undefined,
    }));
    expect(markup).toMatch(/<input[^>]*multiple=""/);
    expect(markup).toContain("image/jpeg,image/png,image/webp");
  });

  test("shows and cleans up an avatar preview before upload", () => {
    const uploader = source(
      "src/features/member-profiles/member-media-uploader.tsx",
    );
    expect(uploader).toContain("URL.createObjectURL");
    expect(uploader).toContain("URL.revokeObjectURL");
    expect(uploader).toContain("Selected avatar preview");
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
