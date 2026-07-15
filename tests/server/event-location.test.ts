import { describe, expect, test } from "vitest";
import {
  EVENT_LOCATION_LIMITS,
  normalizeEventLocation,
  type RawEventLocationInput,
} from "../../src/features/tambike-demo/event-location";

const validLocation: RawEventLocationInput = {
  locationName: "Shell Pugon",
  locationAddress: "Antipolo, Rizal",
  locationMapLink: "https://maps.example.test/place",
  area: "Antipolo",
};

function locationWith(
  overrides: Partial<RawEventLocationInput> = {},
): RawEventLocationInput {
  return { ...validLocation, ...overrides };
}

describe("event location normalization", () => {
  test("trims every location field", () => {
    expect(
      normalizeEventLocation({
        locationName: "  Shell Pugon  ",
        locationAddress: "  Antipolo, Rizal  ",
        locationMapLink: " https://maps.example.test/place ",
        area: " Antipolo ",
      }),
    ).toEqual({
      locationName: "Shell Pugon",
      locationAddress: "Antipolo, Rizal",
      locationMapLink: "https://maps.example.test/place",
      area: "Antipolo",
    });
  });

  test("turns an omitted optional map link into undefined", () => {
    expect(
      normalizeEventLocation({
        locationName: "Shell Pugon",
        locationAddress: "Antipolo, Rizal",
        area: "Antipolo",
      }),
    ).toEqual({
      locationName: "Shell Pugon",
      locationAddress: "Antipolo, Rizal",
      locationMapLink: undefined,
      area: "Antipolo",
    });
  });

  test("turns a blank optional map link into undefined", () => {
    expect(normalizeEventLocation(locationWith({ locationMapLink: "   " }))).toEqual({
      locationName: "Shell Pugon",
      locationAddress: "Antipolo, Rizal",
      locationMapLink: undefined,
      area: "Antipolo",
    });
  });

  test("accepts every field at its exact length limit", () => {
    const locationName = "n".repeat(EVENT_LOCATION_LIMITS.name);
    const locationAddress = "a".repeat(EVENT_LOCATION_LIMITS.address);
    const locationMapLink = "https://maps.example.test/".padEnd(
      EVENT_LOCATION_LIMITS.mapLink,
      "m",
    );
    const area = "r".repeat(EVENT_LOCATION_LIMITS.area);

    expect(
      normalizeEventLocation({
        locationName,
        locationAddress,
        locationMapLink,
        area,
      }),
    ).toEqual({ locationName, locationAddress, locationMapLink, area });
  });

  test.each([
    ["location name", { locationName: "n".repeat(EVENT_LOCATION_LIMITS.name + 1) }],
    [
      "location address",
      { locationAddress: "a".repeat(EVENT_LOCATION_LIMITS.address + 1) },
    ],
    [
      "location map link",
      {
        locationMapLink: "https://maps.example.test/".padEnd(
          EVENT_LOCATION_LIMITS.mapLink + 1,
          "m",
        ),
      },
    ],
    ["area", { area: "r".repeat(EVENT_LOCATION_LIMITS.area + 1) }],
  ])("rejects an over-limit %s", (_label, overrides) => {
    expect(normalizeEventLocation(locationWith(overrides))).toBeNull();
  });

  test.each([
    ["location name", { locationName: "   " }],
    ["location address", { locationAddress: "   " }],
    ["area", { area: "   " }],
  ])("rejects an empty required %s", (_label, overrides) => {
    expect(normalizeEventLocation(locationWith(overrides))).toBeNull();
  });

  test.each(["not a URL", "https://"])(
    "rejects the malformed map link %s",
    (locationMapLink) => {
      expect(normalizeEventLocation(locationWith({ locationMapLink }))).toBeNull();
    },
  );

  test.each(["javascript:alert(1)", "ftp://maps.example.test/place"])(
    "rejects the non-HTTP map link %s",
    (locationMapLink) => {
      expect(normalizeEventLocation(locationWith({ locationMapLink }))).toBeNull();
    },
  );
});
