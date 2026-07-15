import type { EventLocationInput } from "./types";

export const EVENT_LOCATION_LIMITS = {
  name: 120,
  address: 240,
  mapLink: 500,
  area: 120,
} as const;

export type RawEventLocationInput = {
  locationName?: unknown;
  locationAddress?: unknown;
  locationMapLink?: unknown;
  area?: unknown;
};

function trimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function normalizeEventLocation(
  input: RawEventLocationInput,
): EventLocationInput | null {
  const locationName = trimmedString(input.locationName);
  const locationAddress = trimmedString(input.locationAddress);
  const area = trimmedString(input.area);

  if (
    !locationName ||
    locationName.length > EVENT_LOCATION_LIMITS.name ||
    !locationAddress ||
    locationAddress.length > EVENT_LOCATION_LIMITS.address ||
    !area ||
    area.length > EVENT_LOCATION_LIMITS.area
  ) {
    return null;
  }

  let locationMapLink: string | undefined;
  if (input.locationMapLink !== undefined) {
    const trimmedMapLink = trimmedString(input.locationMapLink);
    if (trimmedMapLink === null) {
      return null;
    }

    if (trimmedMapLink) {
      if (trimmedMapLink.length > EVENT_LOCATION_LIMITS.mapLink) {
        return null;
      }

      try {
        const parsedMapLink = new URL(trimmedMapLink);
        if (
          !parsedMapLink.hostname ||
          (parsedMapLink.protocol !== "http:" && parsedMapLink.protocol !== "https:")
        ) {
          return null;
        }
      } catch {
        return null;
      }

      locationMapLink = trimmedMapLink;
    }
  }

  return {
    locationName,
    locationAddress,
    locationMapLink,
    area,
  };
}
