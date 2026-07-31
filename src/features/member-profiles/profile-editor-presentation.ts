export interface ProfileEditorPresentationInput {
  isPublished: boolean;
  slug: string | null;
  visibility: "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";
  displayName: string;
  area: string;
  make: string;
  model: string;
  photoCount: number;
}

export interface ProfileRequirement {
  key: "displayName" | "area" | "make" | "model" | "photos";
  label: string;
  required: true;
  ready: boolean;
  href: "#profile-identity" | "#profile-motorcycle" | "#motorcycle-photos";
}

export function getProfileEditorPresentation(
  input: ProfileEditorPresentationInput,
) {
  const requirements: ProfileRequirement[] = [
    {
      key: "displayName",
      label: "Display name",
      required: true,
      ready: Boolean(input.displayName.trim()),
      href: "#profile-identity",
    },
    {
      key: "area",
      label: "Area / city",
      required: true,
      ready: Boolean(input.area.trim()),
      href: "#profile-identity",
    },
    {
      key: "make",
      label: "Make",
      required: true,
      ready: Boolean(input.make.trim()),
      href: "#profile-motorcycle",
    },
    {
      key: "model",
      label: "Model",
      required: true,
      ready: Boolean(input.model.trim()),
      href: "#profile-motorcycle",
    },
    {
      key: "photos",
      label: "Motorcycle photo",
      required: true,
      ready: input.photoCount > 0,
      href: "#motorcycle-photos",
    },
  ];
  const complete = requirements.every((requirement) => requirement.ready);
  const firstMissing = requirements.find((requirement) => !requirement.ready);
  const state =
    input.isPublished && input.visibility === "PRIVATE"
      ? "private"
      : input.isPublished
        ? "live"
        : complete
          ? "ready"
          : "incomplete";
  const signals: Array<{ label: string; ready: boolean }> = [];

  return {
    state,
    label:
      state === "live"
        ? "Live"
        : state === "private"
          ? "Private"
        : state === "ready"
          ? "Ready to save"
          : "Complete your profile",
    description:
      state === "live"
        ? firstMissing
          ? `Others can view your profile. ${firstMissing.label} is still needed.`
          : "Others can view your profile."
        : state === "private"
          ? firstMissing
            ? `Only you can see this profile. ${firstMissing.label} is still needed.`
            : "Only you can see this profile."
        : state === "ready"
          ? "Save your profile details to finish setup."
          : `${firstMissing!.label} is still needed.`,
    requirements,
    signals,
    firstMissing,
    viewAction:
      state === "live" && input.slug
        ? {
            label: "View public profile",
            href: `/riders/${input.slug}`,
          }
        : { label: "Preview profile", href: "/profile/preview" },
  };
}
