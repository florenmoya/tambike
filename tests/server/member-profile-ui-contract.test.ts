import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import {
  toSavedProfilePreviewView,
} from "../../src/features/member-profiles/profile-preview-adapter";
import { RiderGarageView } from "../../src/features/member-profiles/rider-garage-view";
import { motorcyclePhotoCapacityLabel } from "../../src/features/member-profiles/motorcycle-photo-workspace";
import type { MemberProfileEditorView, MemberProfileView } from "../../src/features/member-profiles/types";

const requireFromMemberProfileUiTest = createRequire(import.meta.url);
const JSDOM = (
  requireFromMemberProfileUiTest("jsdom") as {
    JSDOM: new (html: string) => {
      window: {
        document: Document;
        FormData: typeof FormData;
        close: () => void;
      };
    };
  }
).JSDOM;

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

type MotorcyclePhotos = NonNullable<MemberProfileEditorView["motorcycle"]>["photos"];

const intendedMotorcyclePhotoOrder: MotorcyclePhotos = [
  { url: "/media/selected", position: 0, width: 1200, height: 800 },
  { url: "/media/cover", position: 1, width: 1200, height: 800 },
  { url: "/media/last", position: 2, width: 1200, height: 800 },
];

const staleMotorcyclePhotoOrder: MotorcyclePhotos = [
  { url: "/media/cover", position: 0, width: 1200, height: 800 },
  { url: "/media/selected", position: 1, width: 1200, height: 800 },
  { url: "/media/last", position: 2, width: 1200, height: 800 },
];

function editorWithMotorcyclePhotos(photos: MotorcyclePhotos): MemberProfileEditorView {
  return {
    ...editor,
    motorcycle: {
      ...editor.motorcycle!,
      photos,
    },
  };
}

async function loadPersistMotorcyclePhotoOrder() {
  const settings = await import("../../src/features/member-profiles/profile-settings");
  return (settings as unknown as {
    persistMotorcyclePhotoOrder?: (
      photos: MotorcyclePhotos,
      dependencies: {
        reorderMotorcyclePhotos: (mediaIds: string[]) => Promise<MemberProfileEditorView>;
        getMemberProfileEditor: () => Promise<MemberProfileEditorView>;
      },
    ) => Promise<MemberProfileEditorView>;
  }).persistMotorcyclePhotoOrder;
}

async function loadProfileViewAction() {
  const settings = await import("../../src/features/member-profiles/profile-settings");
  return (settings as unknown as {
    ProfileViewAction?: (props: {
      viewAction: { label: string; href: string };
      profileDirty: boolean;
      motorcycleDirty: boolean;
    }) => ReactNode;
  }).ProfileViewAction;
}

async function loadProfileSaveFooter() {
  const settings = await import("../../src/features/member-profiles/profile-settings");
  return (settings as unknown as {
    ProfileSaveFooter?: (props: {
      pending: boolean;
      status: string;
    }) => ReactNode;
  }).ProfileSaveFooter;
}

async function loadProfileInputFromSubmitEvent() {
  const settings = await import("../../src/features/member-profiles/profile-settings");
  return (settings as unknown as {
    profileInputFromSubmitEvent?: (event: {
      currentTarget: HTMLFormElement;
      preventDefault: () => void;
    }) => {
      displayName: string;
      area: string;
      bio: string;
      visibility: string;
      defaultRosterIdentity: string;
    };
  }).profileInputFromSubmitEvent;
}

const completeProfileInput: ProfileEditorPresentationInput = {
  isPublished: false,
  slug: "mika-santos",
  visibility: "PUBLIC",
  displayName: "Mika Santos",
  area: "Davao City",
  make: "Honda",
  model: "CB650R",
  photoCount: 1,
};

describe("member profile App Router and UI contracts", () => {
  test("prevents the browser form reset before reading controlled profile privacy fields", async () => {
    const profileInputFromSubmitEvent = await loadProfileInputFromSubmitEvent();
    expect(profileInputFromSubmitEvent).toBeTypeOf("function");

    const dom = new JSDOM(`
      <form>
        <input name="displayName" value="Browser QA Rider" />
        <input name="area" value="Quezon City" />
        <textarea name="bio">Weekend rider.</textarea>
        <input type="hidden" name="visibility" value="PUBLIC" />
        <input type="hidden" name="defaultRosterIdentity" value="VISIBLE" />
      </form>
    `);
    const form = dom.window.document.querySelector("form")!;
    let prevented = false;
    const originalFormData = globalThis.FormData;
    globalThis.FormData = dom.window.FormData as typeof FormData;

    try {
      expect(profileInputFromSubmitEvent!({
        currentTarget: form,
        preventDefault: () => {
          prevented = true;
        },
      })).toEqual({
        displayName: "Browser QA Rider",
        area: "Quezon City",
        bio: "Weekend rider.",
        visibility: "PUBLIC",
        defaultRosterIdentity: "VISIBLE",
      });
    } finally {
      globalThis.FormData = originalFormData;
      dom.window.close();
    }

    expect(prevented).toBe(true);
  });

  test("explains empty, partial, and full motorcycle gallery capacity", () => {
    expect(motorcyclePhotoCapacityLabel(0))
      .toBe("0 of 5 photos · Add up to 5");
    expect(motorcyclePhotoCapacityLabel(2))
      .toBe("2 of 5 photos · Add up to 3 more");
    expect(motorcyclePhotoCapacityLabel(5))
      .toBe("5 of 5 photos · Delete one to add another");
  });

  test("replaces the chooser when the saved motorcycle gallery is full", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );

    expect(workspace).toContain("Motorcycle photos *");
    expect(workspace).toContain(
      "First photo becomes the cover. Choose up to 5 JPEG, PNG, or WebP images · 8 MB maximum each · Upload starts after selection.",
    );
    expect(workspace).toContain("motorcyclePhotoCapacityLabel(photos.length)");
    expect(workspace).toMatch(
      /photos\.length >= 5[\s\S]*?motorcyclePhotoFull[\s\S]*?:[\s\S]*?motorcyclePhotoDropzone/,
    );
  });

  test("names the first missing profile detail without claiming it blocks publication", () => {
    const presentation = getProfileEditorPresentation({
      ...completeProfileInput,
      displayName: "",
      area: "",
      photoCount: 0,
    });

    expect(presentation.state).toBe("incomplete");
    expect(presentation.label).toBe("Complete your profile");
    expect(presentation.description).toBe("Display name is still needed.");
    expect(presentation.requirements.map(({ label, required, ready }) => ({
      label,
      required,
      ready,
    }))).toEqual([
      { label: "Display name", required: true, ready: false },
      { label: "Area / city", required: true, ready: false },
      { label: "Make", required: true, ready: true },
      { label: "Model", required: true, ready: true },
      { label: "Motorcycle photo", required: true, ready: false },
    ]);
    expect(presentation.signals).toEqual([]);
    expect(presentation.viewAction).toEqual({
      label: "Preview profile",
      href: "/profile/preview",
    });
  });

  test("returns compact ready-to-save and live states with one contextual viewing action", () => {
    const ready = getProfileEditorPresentation(completeProfileInput);
    expect(ready).toMatchObject({
      state: "ready",
      label: "Ready to save",
      description: "Save your profile details to finish setup.",
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
      description: "Others can view your profile.",
      signals: [],
      viewAction: {
        label: "View public profile",
        href: "/riders/mika-santos",
      },
    });
  });

  test("uses singular, actionable copy when only a motorcycle photo is missing", () => {
    const presentation = getProfileEditorPresentation({
      ...completeProfileInput,
      photoCount: 0,
    });

    expect(presentation.description).toBe(
      "Motorcycle photo is still needed.",
    );
    expect(presentation.firstMissing).toMatchObject({
      label: "Motorcycle photo",
      href: "#motorcycle-photos",
    });
  });

  test("keeps a published private profile private and preview-only", () => {
    const privateProfile = getProfileEditorPresentation({
      ...completeProfileInput,
      isPublished: true,
      visibility: "PRIVATE",
    });

    expect(privateProfile).toMatchObject({
      state: "private",
      label: "Private",
      description: "Only you can see this profile.",
      signals: [],
      viewAction: {
        label: "Preview profile",
        href: "/profile/preview",
      },
    });
    expect(privateProfile.viewAction.href).not.toContain("/riders/");
  });

  test("awaits the rider slug, queries on the server, and hides lookup failures", () => {
    const route = source("src/app/riders/[slug]/page.tsx");

    expect(route).toMatch(/params:\s*Promise<\{\s*slug:\s*string\s*\}>/);
    expect(route).toMatch(/await\s+params/);
    expect(route).toContain("getMemberProfileAction");
    expect(route).toContain("notFound()");
    expect(route).not.toContain('"use client"');
    expect(route).not.toContain("ProfilePreview");
    expect(route).not.toContain("Back to edit");
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

  test("keeps the public rider garage separate from account fields", () => {
    const screen = source("src/features/member-profiles/member-profile-screen.tsx");
    const garage = source("src/features/member-profiles/rider-garage-view.tsx");

    expect(screen).toContain("<RiderGarageView");
    expect(garage).toContain("garage-identity-plate");
    expect(garage).toContain("garage-motorcycle-hero");
    expect(garage).toContain("garage-contact-strip");
    expect(garage).not.toMatch(/email|verificationStatus|storageKey/i);
  });

  test("maps saved editor data into the public-safe owner preview", () => {
    const preview = toSavedProfilePreviewView(editor);

    expect(preview).toMatchObject(publicProfile);
    expect(preview).not.toHaveProperty("defaultRosterIdentity");
    expect(preview).not.toHaveProperty("isPublished");
  });

  test("routes owner preview through the shared public garage renderer", () => {
    const route = source("src/app/profile/preview/page.tsx");
    const preview = source("src/features/member-profiles/profile-preview.tsx");
    const screen = source("src/features/tambike-demo/tambike-screen.tsx");
    const garageMarkup = renderToStaticMarkup(createElement(RiderGarageView, {
      profile: toSavedProfilePreviewView(editor),
    }));

    expect(route).toContain('<TambikeScreen view="profile-preview"');
    expect(screen).toContain('| "profile-preview"');
    expect(screen).toContain('view === "profile-preview"');
    expect(preview).toContain("Preview — only you can see this");
    expect(preview).toContain('href="/profile"');
    expect(preview).toContain("Back to edit");
    expect(preview).toContain("<RiderGarageView");
    expect(preview).toContain("toSavedProfilePreviewView");
    expect(preview).toContain('aria-label="Your profile preview"');
    expect(preview).not.toMatch(/<h1\b/);
    expect(garageMarkup.match(/<h1\b/g)).toHaveLength(1);
    expect(preview).not.toContain("Complete your profile");
  });

  test("keeps signed-out preview guidance and the narrow preview layout explicit", () => {
    const screen = source("src/features/tambike-demo/tambike-screen.tsx");
    const styles = source("src/features/member-profiles/profile-studio.module.css");
    const narrowStart = styles.indexOf("@media (max-width: 390px)");
    const narrowEnd = styles.indexOf("@media (prefers-reduced-motion", narrowStart);
    const narrowStyles = styles.slice(narrowStart, narrowEnd);

    expect(screen).toContain('title="Log in to preview profile"');
    expect(screen).toContain(
      'body="Your preview is only available from your account."',
    );
    expect(narrowStart).toBeGreaterThanOrEqual(0);
    expect(narrowStyles).toMatch(
      /\.previewNotice\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
    );
    expect(narrowStyles).toMatch(
      /\.previewNotice\s*>\s*:global\(\[data-slot="button"\]\)\s*\{[\s\S]*?width:\s*100%;/,
    );
    expect(narrowStyles).toMatch(
      /\.motorcyclePhotoGrid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
  });

  test("eagerly loads the public garage cover when requested", () => {
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
  });

  test("keeps profile editing and profile viewing as separate routes", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain("Your profile");
    expect(settings).toContain(
      "Add the details people see when they open your profile.",
    );
    expect(settings).toContain("Profile details");
    expect(settings).not.toContain(
      "This is the name, area, and note shown on your profile.",
    );
    expect(settings).toContain("About you (optional)");
    expect(settings).toContain(
      "Avoid phone numbers, email addresses, and exact locations. 500 characters maximum.",
    );
    expect(settings).toContain("Members only — signed-in members");
    expect(settings).toContain("Visible — show my profile");
    expect(settings).not.toMatch(/rider profile|garage card|garage note/i);
    expect(settings).toContain("getProfileEditorPresentation");
    expect(settings).toContain("<ProfileViewAction");
    expect(settings).toContain("viewAction={presentation.viewAction}");
    expect(settings).not.toContain("StudioMode");
    expect(settings).not.toContain("studioMode");
    expect(settings).not.toContain("<RiderGarageView");
    expect(settings).not.toContain("toProfilePreviewView");
    expect(settings).not.toContain("Edit profile");
    expect(settings).not.toContain("View your rider page");
    expect(settings).not.toContain('aria-label="Profile requirements"');
  });

  test("uses neutral profile and account copy across public member surfaces", () => {
    const screen = source("src/features/tambike-demo/tambike-screen.tsx");
    const profileScreen = source(
      "src/features/member-profiles/member-profile-screen.tsx",
    );
    const profilePreview = source(
      "src/features/member-profiles/profile-preview.tsx",
    );
    const profileAdapter = source(
      "src/features/member-profiles/profile-preview-adapter.ts",
    );
    const profileView = source(
      "src/features/member-profiles/rider-garage-view.tsx",
    );
    const checkIn = source(
      "src/features/check-in/rider-self-check-in-screen.tsx",
    );
    const giveawayStatus = source(
      "src/features/giveaways/rider-giveaway-status-panel.tsx",
    );
    const giveawayClaim = source(
      "src/features/giveaways/giveaway-claim-screen.tsx",
    );
    const serverActions = source("src/server/actions.ts");

    expect(screen).toContain('title: "Account"');
    expect(screen).toContain('ariaLabel: "Footer account links"');
    expect(screen).toContain("Create account");
    expect(screen).toContain("Join Tambike");
    expect(screen).not.toMatch(
      /Create rider account|Rider signup|New rider\?|rider profile|rider account/,
    );
    expect(profileScreen).toContain(
      'aria-label={`${profile.displayName} profile`}',
    );
    expect(profileScreen).toContain("Tambike / Profiles");
    expect(profilePreview).toContain('aria-label="Your profile preview"');
    expect(profileAdapter).toContain('"Your name"');
    expect(profileView).toContain("<span>Profile</span>");
    expect(profileView).toContain("<span>Motorcycle</span>");
    expect(profileView).toContain("<span>No motorcycle photo yet.</span>");
    expect(profileView).not.toMatch(/Rider garage|Organizer garage|garage card/i);
    expect(profileView).not.toMatch(
      /One bike, kept close|Showcase awaiting its first photograph|This profile is published/i,
    );
    for (const memberFacingSource of [
      checkIn,
      giveawayStatus,
      giveawayClaim,
      serverActions,
    ]) {
      expect(memberFacingSource).not.toMatch(/rider account/i);
    }
  });

  test.each([
    { profileDirty: true, motorcycleDirty: false },
    { profileDirty: false, motorcycleDirty: true },
  ])(
    "keeps the saved profile action available when a draft is dirty: $profileDirty/$motorcycleDirty",
    async ({ profileDirty, motorcycleDirty }) => {
      const ProfileViewAction = await loadProfileViewAction();
      expect(ProfileViewAction).toBeTypeOf("function");

      const markup = renderToStaticMarkup(ProfileViewAction!({
        viewAction: { label: "Preview profile", href: "/profile/preview" },
        profileDirty,
        motorcycleDirty,
      }));

      expect(markup).toContain('href="/profile/preview"');
      expect(markup).toContain('data-variant="outline"');
      expect(markup).toContain("Preview saved profile");
      expect(markup).toContain("Unsaved changes are not included.");
      expect(markup).not.toContain("<button");
    },
  );

  test.each([
    { label: "Preview profile", href: "/profile/preview" },
    { label: "View public profile", href: "/riders/mika-santos" },
  ])("keeps the clean $label action navigable", async (viewAction) => {
    const ProfileViewAction = await loadProfileViewAction();
    expect(ProfileViewAction).toBeTypeOf("function");

    const markup = renderToStaticMarkup(ProfileViewAction!({
      viewAction,
      profileDirty: false,
      motorcycleDirty: false,
    }));

    expect(markup).toMatch(
      new RegExp(`<a\\b[^>]*href="${viewAction.href.replaceAll("/", "\\/")}"`),
    );
    expect(markup).toContain('data-variant="outline"');
    expect(markup).toContain(viewAction.label);
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Save changes before viewing your profile.");
  });

  test("visibly marks every publish requirement and optional profile field", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    for (const label of [
      "Display name *",
      "Area / city *",
      "Make *",
      "Model *",
    ]) {
      expect(settings).toContain(label);
    }
    for (const label of [
      "About you (optional)",
      "Profile photo (optional)",
      "Year (optional)",
      "Displacement (cc) (optional)",
      "Nickname (optional)",
      "Motorcycle note (optional)",
    ]) {
      expect(settings).toContain(label);
    }
    expect(settings).toContain("* Needed for a complete profile");
    expect(settings).toContain("<MotorcyclePhotoWorkspace");
    expect(settings).toContain('required value={profileDraft.displayName}');
    expect(settings).toContain('required value={profileDraft.area}');
    expect(settings).toContain('name="make" required');
    expect(settings).toContain('name="model" required');
  });

  test("uses a compact, responsive profile editor header", () => {
    const styles = source(
      "src/features/member-profiles/profile-studio.module.css",
    );

    expect(styles).toContain(".studio");
    expect(styles).toContain(".studioHeaderActions");
    expect(styles).toContain(".studioState");
    expect(styles).toContain(".studioStatus");
    expect(styles).toContain(".requiredLegend");
    expect(styles).not.toContain(".studioModeSwitch");
    expect(styles).not.toContain(".studioPreviewMode");
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
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.studioHeaderActions\s*\{[\s\S]*?justify-content:\s*flex-start;/,
    );
    expect(styles).toMatch(
      /\.studioHeaderActions\s+:global\(\[data-slot="button"\]\[data-variant="outline"\]\)\s*\{[\s\S]*?background:\s*var\(--studio-paper\);[\s\S]*?border-color:\s*var\(--studio-paper\);[\s\S]*?color:\s*var\(--studio-asphalt\);/,
    );
    expect(styles).toMatch(
      /\.studioHeaderActions\s+:global\(\[data-slot="button"\]\[data-variant="outline"\]:hover\)\s*\{[\s\S]*?background:/,
    );
    expect(styles).toMatch(
      /\.studioHeaderActions\s+:global\(\[data-slot="button"\]\[data-variant="outline"\]:focus-visible\)\s*\{[\s\S]*?outline:/,
    );
    expect(styles).toMatch(
      /\.profileDetailsSaveFooter\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;[\s\S]*?background:\s*var\(--studio-paper\);/,
    );
    expect(styles).toMatch(
      /\.profileDetailsSaveButton[\s\S]*?background:\s*var\(--studio-amber\);[\s\S]*?color:\s*var\(--studio-asphalt\);/,
    );
    expect(styles).toMatch(
      /\.studio\s+\.profileDetailsSaveButton:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--studio-asphalt\);/,
    );
    const genericButtonFocusRule = styles.indexOf(
      '.studio :global([data-slot="button"]):focus-visible',
    );
    const footerButtonFocusRule = styles.indexOf(
      ".studio .profileDetailsSaveButton:focus-visible",
    );
    expect(genericButtonFocusRule).toBeGreaterThanOrEqual(0);
    expect(footerButtonFocusRule).toBeGreaterThan(genericButtonFocusRule);
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.profileDetailsSaveFooter\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?\.profileDetailsSaveButton\s*\{[\s\S]*?width:\s*100%;/,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.motorcyclePhotoGrid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(styles).toMatch(
      /\.studioStatus\s*>\s*:global\(\[data-slot="button"\]\[data-variant="outline"\]\)\s*\{[\s\S]*?background:\s*var\(--studio-paper\);[\s\S]*?color:\s*var\(--studio-asphalt\);/,
    );
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  test("offers one save action for profile and motorcycle details", async () => {
    const ProfileSaveFooter = await loadProfileSaveFooter();
    expect(ProfileSaveFooter).toBeTypeOf("function");

    const markup = renderToStaticMarkup(ProfileSaveFooter!({
      pending: false,
      status: "Profile saved.",
    }));

    expect(markup).toContain('aria-label="Save profile"');
    expect(markup).toContain(
      "Saves your profile and motorcycle details. Photos upload automatically when selected.",
    );
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toContain("Save profile");
    expect(markup).not.toContain("Save profile details");
    expect(markup).not.toContain("Save motorcycle details");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Profile saved.");
  });

  test("shows one disabled saving state for the combined save", async () => {
    const ProfileSaveFooter = await loadProfileSaveFooter();
    expect(ProfileSaveFooter).toBeTypeOf("function");

    const markup = renderToStaticMarkup(ProfileSaveFooter!({
      pending: true,
      status: "",
    }));

    expect(markup).toMatch(/<button\b[^>]*disabled=""/);
    expect(markup).toContain("Saving…");
    expect(markup).not.toContain(">Save profile</button>");
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

  test("labels profile visibility and attendance privacy with one combined save action", () => {
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(settings).toContain('htmlFor="profile-visibility"');
    expect(settings).toContain('id="profile-visibility"');
    expect(settings).toContain('htmlFor="default-roster-identity"');
    expect(settings).toContain('id="default-roster-identity"');
    expect(settings).toMatch(/<Card id="attendance-privacy"[\s\S]*?<CardTitle>Attendance privacy<\/CardTitle>/);
    expect(settings).not.toContain("Publish profile");
    expect(settings).not.toContain("submitProfileForm");
    expect(settings).toContain("Save profile");
    expect(settings).not.toContain("Save profile details");
    expect(settings).not.toContain("Save motorcycle details");
    expect(settings).toMatch(
      /<form[\s\S]*?onSubmit=\{\(event\) => \{[\s\S]*?profileInputFromSubmitEvent\(event\)[\s\S]*?<\/form>/,
    );
    expect(settings.match(/type="submit"/g)).toHaveLength(1);
    expect(settings).toMatch(/Profile details/);
    expect(settings).toMatch(/Attendance privacy/);
    expect(source("src/features/member-profiles/motorcycle-photo-workspace.tsx"))
      .toMatch(/Motorcycle photos/i);
    expect(settings).not.toContain(
      '<MemberMediaUploader purpose="motorcycle-photo"',
    );
    expect(settings).toContain(
      "Used by default for every event roster.",
    );
    expect(settings).toContain(
      "Private or unpublished profiles always appear anonymously.",
    );
    expect(settings).toContain("Anonymous — count me without my card");
    expect(settings).toContain("Visible — show my profile");
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
    expect(profileSettingsSource).toMatch(
      /handleSaveProfile = async \(input: UpdateMemberProfileInput\)/,
    );
  });

  test("starts profile photo upload from file selection without a second button", () => {
    const uploader = source("src/features/member-profiles/member-media-uploader.tsx");

    expect(uploader).toContain("Choose and upload profile photo");
    expect(uploader).toContain(
      "JPEG, PNG, or WebP · Up to 8 MB · Cropped to a square · Upload starts after selection.",
    );
    expect(uploader).toContain("void uploadSelected(selected)");
    expect(uploader).toContain('aria-live="polite"');
    expect(uploader).toContain("selectedPreviewUrl");
    expect(uploader).not.toContain("Upload avatar photo");
  });

  test("keeps motorcycle photo controls keyboard-operable and explicitly labeled", () => {
    const workspace = source("src/features/member-profiles/motorcycle-photo-workspace.tsx");

    expect(workspace).toMatch(/<Button[\s\S]*?(?:Previous|Next) position/i);
    expect(workspace).toMatch(/<Button[\s\S]*?Delete motorcycle photo/i);
    expect(workspace).not.toMatch(/<div[^>]+onClick=/);
  });

  test("names saved-photo actions by their visible result", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );
    const settings = source("src/features/member-profiles/profile-settings.tsx");

    expect(workspace).toContain("Set as cover");
    expect(workspace).toContain("Previous position");
    expect(workspace).toContain("Next position");
    expect(workspace).toContain("Cover photo");
    expect(workspace).toMatch(/Photo\s*\{index \+ 1\}\s*of\s*\{photos.length\}/);
    expect(workspace).toContain("onReorder(index, 0)");
    expect(workspace).toMatch(/Set motorcycle photo \$\{index \+ 1\} as cover/);
    expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} to the previous position/);
    expect(workspace).toMatch(/Move motorcycle photo \$\{index \+ 1\} to the next position/);
    expect(workspace).toContain('loading={index === 0 ? "eager" : undefined}');
    expect(workspace).not.toContain("Move earlier");
    expect(workspace).not.toContain("Move later");
    expect(settings).toContain('direction < 0 ? "previous" : "next"');
    expect(settings).not.toContain('"earlier" : "later"');
  });

  test("moves the selected saved motorcycle photo to the requested position", async () => {
    const settings = await import("../../src/features/member-profiles/profile-settings");
    const reorder = (settings as unknown as {
      reorderedMotorcyclePhotos?: (
        photos: NonNullable<MemberProfileEditorView["motorcycle"]>["photos"],
        fromIndex: number,
        toIndex: number,
      ) => NonNullable<MemberProfileEditorView["motorcycle"]>["photos"];
    }).reorderedMotorcyclePhotos;
    expect(reorder).toBeTypeOf("function");

    const photos = [
      { url: "/media/cover", position: 0, width: 1200, height: 800 },
      { url: "/media/selected", position: 1, width: 1200, height: 800 },
      { url: "/media/last", position: 2, width: 1200, height: 800 },
    ];
    expect(reorder!(photos, 1, 0)).toEqual([
      { url: "/media/selected", position: 0, width: 1200, height: 800 },
      { url: "/media/cover", position: 1, width: 1200, height: 800 },
      { url: "/media/last", position: 2, width: 1200, height: 800 },
    ]);
  });

  test("sends the intended saved motorcycle media ID order", async () => {
    const persist = await loadPersistMotorcyclePhotoOrder();
    expect(persist).toBeTypeOf("function");
    let requestedMediaIds: string[] = [];
    const matching = editorWithMotorcyclePhotos(intendedMotorcyclePhotoOrder);

    await persist!(intendedMotorcyclePhotoOrder, {
      reorderMotorcyclePhotos: async (mediaIds) => {
        requestedMediaIds = mediaIds;
        return matching;
      },
      getMemberProfileEditor: async () => {
        throw new Error("refresh must not run");
      },
    });

    expect(requestedMediaIds).toEqual(["selected", "cover", "last"]);
  });

  test("accepts a matching motorcycle order action response without refreshing", async () => {
    const persist = await loadPersistMotorcyclePhotoOrder();
    expect(persist).toBeTypeOf("function");
    const matching = editorWithMotorcyclePhotos(intendedMotorcyclePhotoOrder);
    let refreshCount = 0;

    const saved = await persist!(intendedMotorcyclePhotoOrder, {
      reorderMotorcyclePhotos: async () => matching,
      getMemberProfileEditor: async () => {
        refreshCount += 1;
        return matching;
      },
    });

    expect(saved).toBe(matching);
    expect(refreshCount).toBe(0);
  });

  test("recovers a stale motorcycle order action response with one matching refresh", async () => {
    const persist = await loadPersistMotorcyclePhotoOrder();
    expect(persist).toBeTypeOf("function");
    const stale = editorWithMotorcyclePhotos(staleMotorcyclePhotoOrder);
    const matching = editorWithMotorcyclePhotos(intendedMotorcyclePhotoOrder);
    let refreshCount = 0;

    const saved = await persist!(intendedMotorcyclePhotoOrder, {
      reorderMotorcyclePhotos: async () => stale,
      getMemberProfileEditor: async () => {
        refreshCount += 1;
        return matching;
      },
    });

    expect(saved).toBe(matching);
    expect(refreshCount).toBe(1);
  });

  test("rejects a motorcycle order that still mismatches after one refresh", async () => {
    const persist = await loadPersistMotorcyclePhotoOrder();
    expect(persist).toBeTypeOf("function");
    const stale = editorWithMotorcyclePhotos(staleMotorcyclePhotoOrder);
    let refreshCount = 0;

    await expect(persist!(intendedMotorcyclePhotoOrder, {
      reorderMotorcyclePhotos: async () => stale,
      getMemberProfileEditor: async () => {
        refreshCount += 1;
        return stale;
      },
    })).rejects.toThrow("MOTORCYCLE_PHOTO_ORDER_NOT_SAVED");
    expect(refreshCount).toBe(1);
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
    expect(workspace).toMatch(/Move motorcycle photo .* to the previous position/);
    expect(workspace).toMatch(/Move motorcycle photo .* to the next position/);
  });

  test("keeps a finalized refresh error locked to refresh-only recovery", () => {
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );

    expect(workspace).toMatch(
      /item\.status === "uploaded" && item\.error[\s\S]*?>Show uploaded photo<\/Button>/,
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

    const reloadedBackendNotFound = Object.assign(new Error("NOT_FOUND"), {
      code: "NOT_FOUND",
    });
    await expect(load!(
      "hidden-after-reload",
      async () => { throw reloadedBackendNotFound; },
      () => { throw notFoundMarker; },
    )).rejects.toBe(notFoundMarker);

    const outage = new Error("database unavailable");
    await expect(load!("mika", async () => { throw outage; }, () => { throw notFoundMarker; }))
      .rejects.toBe(outage);

    for (const code of ["INVALID_INPUT", "UNAUTHENTICATED"] as const) {
      const serialized = { code };
      await expect(load!(
        `serialized-${code.toLowerCase()}`,
        async () => { throw serialized; },
        () => { throw notFoundMarker; },
      )).rejects.toBe(serialized);
    }
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
