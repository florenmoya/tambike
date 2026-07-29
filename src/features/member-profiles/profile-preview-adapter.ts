import type {
  MemberProfileEditorView,
  MemberProfileView,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "./types";

export function toProfilePreviewView(
  editor: MemberProfileEditorView,
  profileDraft: UpdateMemberProfileInput,
  motorcycleDraft: UpsertMotorcycleInput,
): MemberProfileView {
  const make = motorcycleDraft.make.trim();
  const model = motorcycleDraft.model.trim();
  const hasCompleteMotorcycle = Boolean(make && model);

  return {
    slug: editor.slug ?? "profile-preview",
    displayName: profileDraft.displayName.trim() || "Your rider name",
    area: profileDraft.area.trim() || "Your area",
    role: editor.role,
    bio: profileDraft.bio?.trim() || undefined,
    visibility: profileDraft.visibility,
    joinedAt: editor.joinedAt,
    profilePhotoUrl: editor.profilePhotoUrl,
    organizer: editor.organizer,
    motorcycle: hasCompleteMotorcycle
      ? {
          make,
          model,
          year: motorcycleDraft.year,
          displacementCc: motorcycleDraft.displacementCc,
          nickname: motorcycleDraft.nickname?.trim() || undefined,
          description: motorcycleDraft.description?.trim() || undefined,
          photos: editor.motorcycle?.photos.toSorted(
            (left, right) => left.position - right.position,
          ) ?? [],
        }
      : undefined,
  };
}
