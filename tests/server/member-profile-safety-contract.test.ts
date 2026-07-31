import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("member profile editing safety", () => {
  test("only warns when navigation would leave the current profile document", async () => {
    const { shouldConfirmProfileNavigation } = await import(
      "../../src/features/member-profiles/use-unsaved-profile-guard"
    );
    const current = "http://localhost:3000/profile?tab=details";

    expect(shouldConfirmProfileNavigation(current, current)).toBe(false);
    expect(
      shouldConfirmProfileNavigation(
        "/profile?tab=details#motorcycle-photos",
        current,
      ),
    ).toBe(false);
    expect(shouldConfirmProfileNavigation("/events", current)).toBe(true);
    expect(
      shouldConfirmProfileNavigation("/profile?tab=privacy", current),
    ).toBe(true);
    expect(
      shouldConfirmProfileNavigation("https://tambike.example/riders", current),
    ).toBe(true);
  });

  test("registers unload and link guards only while profile fields are dirty", () => {
    const guard = source(
      "src/features/member-profiles/use-unsaved-profile-guard.ts",
    );
    const settings = source(
      "src/features/member-profiles/profile-settings.tsx",
    );

    expect(guard).toContain('window.addEventListener("beforeunload"');
    expect(guard).toContain(
      'document.addEventListener("click", handleDocumentClick, true)',
    );
    expect(guard).toContain('window.confirm("Discard unsaved profile changes?")');
    expect(settings).toContain(
      "useUnsavedProfileGuard(profileDirty || motorcycleDirty)",
    );
  });

  test("requires an explicit confirmation before deleting saved profile media", async () => {
    const { mediaDeleteConfirmationCopy } = await import(
      "../../src/features/member-profiles/confirm-media-delete"
    );

    expect(mediaDeleteConfirmationCopy("profile photo")).toEqual({
      title: "Delete profile photo?",
      description:
        "This removes the saved photo from your profile. This cannot be undone.",
      confirmLabel: "Delete photo",
    });
  });

  test("uses the shared confirmation for profile and motorcycle photo deletion", () => {
    const settings = source(
      "src/features/member-profiles/profile-settings.tsx",
    );
    const workspace = source(
      "src/features/member-profiles/motorcycle-photo-workspace.tsx",
    );

    expect(settings).toContain("<ConfirmMediaDelete");
    expect(settings).not.toContain(
      'onClick={() => removeMedia(editor.profilePhotoUrl!, "Avatar")}',
    );
    expect(workspace).toContain("<ConfirmMediaDelete");
    expect(workspace).not.toContain(
      "onClick={() => void onDelete(photo.url, `Photo ${index + 1}`)}",
    );
  });
});
