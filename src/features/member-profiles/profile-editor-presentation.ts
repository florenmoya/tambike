export interface ProfileEditorPresentationInput {
  isPublished: boolean;
  slug: string | null;
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
      label: "Motorcycle photos",
      required: true,
      ready: input.photoCount > 0,
      href: "#motorcycle-photos",
    },
  ];
  const complete = requirements.every((requirement) => requirement.ready);
  const firstMissing = requirements.find((requirement) => !requirement.ready);
  const state = input.isPublished ? "live" : complete ? "ready" : "incomplete";
  const signals = complete || input.isPublished
    ? []
    : [
        {
          label: "Identity",
          ready: requirements[0].ready && requirements[1].ready,
        },
        {
          label: "Motorcycle",
          ready: requirements[2].ready && requirements[3].ready,
        },
        { label: "Photo", ready: requirements[4].ready },
      ];

  return {
    state,
    label:
      state === "live"
        ? "Live"
        : state === "ready"
          ? "Ready to publish"
          : "Complete your profile",
    description:
      state === "live"
        ? "Other riders can view your rider profile."
        : state === "ready"
          ? "Your required details are complete."
          : `${firstMissing!.label} is required to publish.`,
    requirements,
    signals,
    firstMissing,
    viewAction:
      input.isPublished && input.slug
        ? {
            label: "View public profile",
            href: `/riders/${input.slug}`,
          }
        : { label: "Preview profile", href: "/profile/preview" },
  };
}
