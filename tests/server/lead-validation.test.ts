import { describe, expect, test } from "vitest";

import {
  leadListQuerySchema,
  maskPhone,
  normalizePhilippinePhone,
  submitLeadSchema,
  TEST_RIDE_CONSENT_VERSION,
  updateLeadStatusSchema,
} from "../../src/features/leads/validation";
import { encodeCsv } from "../../src/server/csv";
import { deriveLeadRateLimitKey } from "../../src/server/leads/rate-limit-key";

const validSubmission = {
  name: "Ana Rider",
  phone: "09171234567",
  currentMotorcycle: "Honda Click 160",
  interestedModel: "Ducati Scrambler",
  preferredTime: "Saturday morning",
  consent: true as const,
  consentVersion: TEST_RIDE_CONSENT_VERSION,
  idempotencyKey: "018f47f0-c2b5-7b70-9f87-8f83df31f33e",
  website: "",
};

describe("test-ride lead validation", () => {
  test.each([
    ["09171234567", "+639171234567"],
    ["+63 917 123 4567", "+639171234567"],
    ["639171234567", "+639171234567"],
    ["0917-123-4567", "+639171234567"],
  ])("normalizes supported Philippine mobile number %s", (input, expected) => {
    expect(normalizePhilippinePhone(input)).toBe(expected);
  });

  test.each([
    "",
    "12345",
    "+63917123",
    "+12025550123",
    "+63 0917 123 4567",
    "00639171234567",
    "phone: 09171234567",
    "0917.123.4567",
  ])("rejects unsupported or ambiguous phone input %s", (input) => {
    expect(() => normalizePhilippinePhone(input)).toThrow("INVALID_PHONE");
  });

  test("parses current consent and normalizes the submitted phone", () => {
    const result = submitLeadSchema.safeParse(validSubmission);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+639171234567");
  });

  test.each([
    ["missing consent", { consent: undefined }],
    ["declined consent", { consent: false }],
    ["stale consent version", { consentVersion: "test-ride-contact-v0" }],
    ["non-UUID idempotency key", { idempotencyKey: "request-1" }],
    ["short name", { name: "A" }],
    ["oversized honeypot", { website: "x".repeat(201) }],
  ])("rejects %s", (_label, replacement) => {
    expect(
      submitLeadSchema.safeParse({ ...validSubmission, ...replacement }).success,
    ).toBe(false);
  });

  test("rejects arbitrary submission fields", () => {
    expect(
      submitLeadSchema.safeParse({ ...validSubmission, internalNote: "accept" })
        .success,
    ).toBe(false);
  });

  test("reports an invalid submitted phone as validation failure", () => {
    expect(
      submitLeadSchema.safeParse({
        ...validSubmission,
        phone: "+12025550123",
      }).success,
    ).toBe(false);
  });

  test("masks only the final four digits of a normalized contact number", () => {
    expect(maskPhone("+639171234567")).toBe("+63 ••• ••• 4567");
  });

  test("validates strict lead list filters and bounds page size", () => {
    expect(
      leadListQuerySchema.parse({
        eventId: "event-1",
        status: "CONTACTED",
        cursor: "cm4-lead_01",
        limit: "100",
      }),
    ).toEqual({
      eventId: "event-1",
      status: "CONTACTED",
      cursor: "cm4-lead_01",
      limit: 100,
    });

    expect(leadListQuerySchema.parse({ limit: 0 }).limit).toBe(1);
    expect(leadListQuerySchema.parse({ limit: "101" }).limit).toBe(100);

    for (const query of [
      { status: "contacted" },
      { cursor: "not a cursor" },
      { cursor: "lead.1" },
      { limit: 1.5 },
      { limit: "1.5" },
      { limit: "20px" },
      { limit: 20, arbitrary: true },
    ]) {
      expect(leadListQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  test("accepts only canonical ISO timestamps for status comparisons", () => {
    expect(
      updateLeadStatusSchema.parse({
        status: "COMPLETED",
        expectedUpdatedAt: "2026-08-04T01:02:03.000Z",
      }),
    ).toEqual({
      status: "COMPLETED",
      expectedUpdatedAt: "2026-08-04T01:02:03.000Z",
    });

    for (const input of [
      { status: "DONE", expectedUpdatedAt: "2026-08-04T01:02:03.000Z" },
      { status: "NEW", expectedUpdatedAt: "2026-08-04T09:02:03+08:00" },
      { status: "NEW", expectedUpdatedAt: "tomorrow" },
      {
        status: "NEW",
        expectedUpdatedAt: "2026-08-04T01:02:03.000Z",
        force: true,
      },
    ]) {
      expect(updateLeadStatusSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("lead CSV encoding", () => {
  test.each([
    ["=cmd|' /C calc'!A0", "\"'=cmd|' /C calc'!A0\""],
    [" +SUM(A1:A2)", "\"' +SUM(A1:A2)\""],
    ["\t@IMPORTDATA(\"https://example.invalid\")", "\"'\t@IMPORTDATA(\"\"https://example.invalid\"\")\""],
    ["\u0001-2+3", "\"'\u0001-2+3\""],
  ])("protects a formula-prefixed cell %#", (input, expected) => {
    expect(encodeCsv([[input]])).toBe(expected);
  });

  test("quotes nullish values, delimiters, quotes, and line breaks with CRLF rows", () => {
    expect(
      encodeCsv([
        ["name", "note", null, undefined],
        ["Ana, Rider", 'Said "yes"', "line 1\r\nline 2", ""],
      ]),
    ).toBe(
      '"name","note","",""\r\n"Ana, Rider","Said ""yes""","line 1\r\nline 2",""',
    );
  });
});

describe("lead rate-limit fingerprinting", () => {
  const input = {
    secret: "test-secret-that-is-long-enough",
    eventId: "event-1",
    clientAddress: "203.0.113.8",
  };

  test("derives a stable HMAC key without returning raw request data", () => {
    const first = deriveLeadRateLimitKey(input);
    const second = deriveLeadRateLimitKey(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(input.clientAddress);
    expect(first).not.toContain(input.eventId);
  });

  test("rejects a short HMAC secret", () => {
    expect(() =>
      deriveLeadRateLimitKey({ ...input, secret: "too-short" }),
    ).toThrow("LEAD_RATE_LIMIT_SECRET_INVALID");
  });

  test("separates event and address fields without concatenation collisions", () => {
    const first = deriveLeadRateLimitKey({
      ...input,
      eventId: "event:a",
      clientAddress: "b",
    });
    const second = deriveLeadRateLimitKey({
      ...input,
      eventId: "event",
      clientAddress: "a:b",
    });
    const swapped = deriveLeadRateLimitKey({
      ...input,
      eventId: input.clientAddress,
      clientAddress: input.eventId,
    });

    expect(first).not.toBe(second);
    expect(swapped).not.toBe(deriveLeadRateLimitKey(input));
  });
});
