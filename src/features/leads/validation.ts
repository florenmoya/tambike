import { z } from "zod";

export const TEST_RIDE_CONSENT_VERSION = "test-ride-contact-v1" as const;

export const leadStatusSchema = z.enum([
  "NEW",
  "CONTACTED",
  "COMPLETED",
  "CLOSED",
]);

function normalizedPhilippinePhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || !/^[+0-9() -]+$/.test(trimmed)) {
    return undefined;
  }

  const compact = trimmed.replace(/[ ()-]/g, "");
  return /^09\d{9}$/.test(compact)
    ? `+63${compact.slice(1)}`
    : /^639\d{9}$/.test(compact)
      ? `+${compact}`
      : /^\+639\d{9}$/.test(compact)
        ? compact
        : undefined;
}

export function normalizePhilippinePhone(value: string): string {
  const normalized = normalizedPhilippinePhone(value);
  if (!normalized) throw new Error("INVALID_PHONE");
  return normalized;
}

export function maskPhone(value: string): string {
  const normalized = normalizePhilippinePhone(value);
  return `+63 ••• ••• ${normalized.slice(-4)}`;
}

const philippinePhoneSchema = z.string().trim().transform((value, context) => {
  const normalized = normalizedPhilippinePhone(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "INVALID_PHONE" });
    return z.NEVER;
  }
  return normalized;
});

export const submitLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: philippinePhoneSchema,
    currentMotorcycle: z.string().trim().min(2).max(120),
    interestedModel: z.string().trim().min(2).max(120),
    preferredTime: z.string().trim().min(2).max(120),
    consent: z.literal(true),
    consentVersion: z.literal(TEST_RIDE_CONSENT_VERSION),
    idempotencyKey: z.string().uuid(),
    website: z.string().max(200),
  })
  .strict();

const identifierSchema = z.string().trim().min(1).max(200);
const cursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/);
const listLimitSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^-?\d+$/)
      .transform(Number),
  ])
  .pipe(z.number().int())
  .transform((value) => Math.min(100, Math.max(1, value)));

export const leadListQuerySchema = z
  .object({
    eventId: identifierSchema.optional(),
    status: leadStatusSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: listLimitSchema.optional(),
  })
  .strict();

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

const canonicalIsoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isCanonicalIsoTimestamp);

export const updateLeadStatusSchema = z
  .object({
    status: leadStatusSchema,
    expectedUpdatedAt: canonicalIsoTimestampSchema,
  })
  .strict();
