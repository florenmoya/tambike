import { z } from "zod";

import type {
  CreateGiveawayInput,
  GiveawayComplianceStatus,
  GiveawayState,
  UpdateGiveawayInput,
} from "./types";

const nonEmptyText = z.string().trim().min(1);
const identifier = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();

const ianaTimeZone = nonEmptyText.superRefine((value, context) => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    context.addIssue({
      code: "custom",
      message: "INVALID_IANA_TIME_ZONE",
    });
  }
});

const eligibilityConditionSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("active_rsvp_pass") }).strict(),
  z.object({ source: z.literal("confirmed_check_in") }).strict(),
  z.object({ source: z.literal("staff_confirmed_check_in") }).strict(),
  z
    .object({
      source: z.literal("perk_redemption"),
      perkId: identifier,
    })
    .strict(),
  z.object({ source: z.literal("campaign_code") }).strict(),
  z.object({ source: z.literal("manual") }).strict(),
]);

const eligibilityGroupSchema = z
  .object({
    id: identifier,
    label: nonEmptyText,
    weight: positiveInteger,
    conditions: z.array(eligibilityConditionSchema).min(1),
  })
  .strict();

const finiteInventorySchema = z
  .object({
    kind: z.literal("finite"),
    quantity: positiveInteger,
  })
  .strict();

const unlimitedInventorySchema = z.object({ kind: z.literal("unlimited") }).strict();

const prizePoolSchema = z
  .object({
    id: identifier,
    title: nonEmptyText,
    awardMode: z.enum(["random_draw", "first_come", "guaranteed", "manual_selection"]),
    fulfilmentMode: z.enum(["onsite", "digital_code", "delivery", "manual_contact"]),
    inventory: z.discriminatedUnion("kind", [finiteInventorySchema, unlimitedInventorySchema]),
    items: z
      .array(
        z
          .object({
            id: identifier.optional(),
            title: nonEmptyText,
            description: nonEmptyText.optional(),
          })
          .strict(),
      )
      .min(1),
    eligibilityGroupIds: z.array(identifier).min(1).optional(),
    perRiderLimit: positiveInteger.optional(),
    presenceVerificationRequired: z.boolean().optional(),
  })
  .strict()
  .superRefine((pool, context) => {
    if (pool.awardMode === "guaranteed" && pool.inventory.kind !== "unlimited") {
      context.addIssue({
        code: "custom",
        path: ["inventory"],
        message: "FINITE_GUARANTEED_PRIZE_POOL",
      });
    }

    if (pool.awardMode !== "guaranteed" && pool.inventory.kind !== "finite") {
      context.addIssue({
        code: "custom",
        path: ["inventory"],
        message: "FINITE_INVENTORY_REQUIRED",
      });
    }
  });

const scheduleFields = {
  entryOpensAt: z.string().datetime({ offset: true }).optional(),
  entryClosesAt: z.string().datetime({ offset: true }).optional(),
  drawAt: z.string().datetime({ offset: true }).nullable().optional(),
  claimDeadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
};

const eligibilityBundleFields = ["eligibilityGroups", "prizePools"] as const;
const scheduleBundleFields = [
  "entryOpensAt",
  "entryClosesAt",
  "drawAt",
  "claimDeadlineAt",
] as const;

const giveawayFieldsSchema = z.object({
  title: nonEmptyText,
  kind: z.enum(["raffle", "giveaway"]),
  entryMode: z.enum(["automatic", "opt_in", "claim_code", "manual_only"]),
  eligibilityGroups: z.array(eligibilityGroupSchema).min(1),
  mechanics: nonEmptyText,
  terms: nonEmptyText,
  timeZone: ianaTimeZone,
  winnerLimits: z
    .object({
      perRider: positiveInteger,
      total: positiveInteger,
    })
    .strict(),
  organizerAttestation: z.literal(true),
  prizePools: z.array(prizePoolSchema).min(1),
  ...scheduleFields,
  publicVisibility: z.enum(["event_page", "registered_riders", "eligible_riders", "hidden"]).optional(),
  sponsorDisclosure: nonEmptyText.optional(),
  presenceVerificationRequired: z.boolean().optional(),
});

function addCrossFieldIssues(
  input: {
    eligibilityGroups?: Array<{ id: string }>;
    prizePools?: Array<{ eligibilityGroupIds?: string[] }>;
    entryOpensAt?: string;
    entryClosesAt?: string;
    drawAt?: string | null;
    claimDeadlineAt?: string | null;
  },
  context: z.RefinementCtx,
) {
  const hasPrizePoolGroupReferences = input.prizePools?.some(
    (pool) => (pool.eligibilityGroupIds?.length ?? 0) > 0,
  );
  if (hasPrizePoolGroupReferences && !input.eligibilityGroups) {
    context.addIssue({
      code: "custom",
      path: ["eligibilityGroups"],
      message: "ELIGIBILITY_GROUP_CONFIGURATION_REQUIRED",
    });
  }

  if (input.eligibilityGroups) {
    const groupIds = input.eligibilityGroups.map((group) => group.id);
    if (new Set(groupIds).size !== groupIds.length) {
      context.addIssue({
        code: "custom",
        path: ["eligibilityGroups"],
        message: "DUPLICATE_ELIGIBILITY_GROUP_ID",
      });
    }

    const knownGroupIds = new Set(groupIds);
    for (const [poolIndex, pool] of (input.prizePools ?? []).entries()) {
      for (const [groupIndex, groupId] of (pool.eligibilityGroupIds ?? []).entries()) {
        if (!knownGroupIds.has(groupId)) {
          context.addIssue({
            code: "custom",
            path: ["prizePools", poolIndex, "eligibilityGroupIds", groupIndex],
            message: "UNKNOWN_ELIGIBILITY_GROUP",
          });
        }
      }
    }
  }

  const orderedDates = [
    ["entryOpensAt", input.entryOpensAt],
    ["entryClosesAt", input.entryClosesAt],
    ["drawAt", input.drawAt],
    ["claimDeadlineAt", input.claimDeadlineAt],
  ] as const;
  let previous: Date | undefined;
  let previousField: string | undefined;

  for (const [field, value] of orderedDates) {
    if (value === undefined || value === null) continue;
    const current = new Date(value);
    if (previous && current.getTime() <= previous.getTime()) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `SCHEDULE_ORDER_INVALID:${previousField}:${field}`,
      });
    }
    previous = current;
    previousField = field;
  }
}

function addAtomicUpdateBundleIssues(input: object, context: z.RefinementCtx) {
  const record = input as Record<string, unknown>;
  const bundleFields = [...eligibilityBundleFields, ...scheduleBundleFields];
  if (bundleFields.some((field) => Object.hasOwn(record, field) && record[field] === undefined)) {
    context.addIssue({
      code: "custom",
      message: "ATOMIC_UPDATE_BUNDLE_MEMBER_UNDEFINED",
    });
  }

  const hasEligibilityGroups = Object.hasOwn(input, "eligibilityGroups");
  const hasPrizePools = Object.hasOwn(input, "prizePools");
  if (hasEligibilityGroups !== hasPrizePools) {
    context.addIssue({
      code: "custom",
      path: hasEligibilityGroups ? ["prizePools"] : ["eligibilityGroups"],
      message: "ELIGIBILITY_PRIZE_POOL_BUNDLE_REQUIRED",
    });
  }

  const suppliedScheduleFields = scheduleBundleFields.filter((field) => Object.hasOwn(input, field));
  if (suppliedScheduleFields.length > 0 && suppliedScheduleFields.length !== scheduleBundleFields.length) {
    context.addIssue({
      code: "custom",
      path: ["entryOpensAt"],
      message: "SCHEDULE_BUNDLE_REQUIRED",
    });
  }
}

function assertAtomicUpdateBundleOwnership(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;

  const record = input as Record<string, unknown>;
  const bundleFields = [...eligibilityBundleFields, ...scheduleBundleFields];
  if (bundleFields.some((field) => field in record && !Object.hasOwn(record, field))) {
    throw new Error("UPDATE_BUNDLE_FIELDS_MUST_BE_OWN_PROPERTIES");
  }
  if (bundleFields.some((field) => Object.hasOwn(record, field) && record[field] === undefined)) {
    throw new Error("ATOMIC_UPDATE_BUNDLE_MEMBER_UNDEFINED");
  }

  const hasEligibilityGroups = Object.hasOwn(record, "eligibilityGroups");
  const hasPrizePools = Object.hasOwn(record, "prizePools");
  if (hasEligibilityGroups !== hasPrizePools) {
    throw new Error("ELIGIBILITY_PRIZE_POOL_BUNDLE_REQUIRED");
  }

  const suppliedScheduleFields = scheduleBundleFields.filter((field) => Object.hasOwn(record, field));
  if (suppliedScheduleFields.length > 0 && suppliedScheduleFields.length !== scheduleBundleFields.length) {
    throw new Error("SCHEDULE_BUNDLE_REQUIRED");
  }
}

export const createGiveawaySchema = z
  .object({
    eventId: identifier,
    ...giveawayFieldsSchema.shape,
  })
  .strict()
  .superRefine(addCrossFieldIssues);

export const updateGiveawaySchema = z
  .object({
    id: identifier,
    ...giveawayFieldsSchema.partial().shape,
  })
  .strict()
  .superRefine((input, context) => {
    addAtomicUpdateBundleIssues(input, context);
    addCrossFieldIssues(input, context);
  });

export function parseCreateGiveawayInput(input: unknown): CreateGiveawayInput {
  return createGiveawaySchema.parse(input) as CreateGiveawayInput;
}

export function validateGiveawayUpdateInput(input: unknown): UpdateGiveawayInput {
  assertAtomicUpdateBundleOwnership(input);
  return updateGiveawaySchema.parse(input) as UpdateGiveawayInput;
}

export function parseUpdateGiveawayInput(input: unknown): UpdateGiveawayInput {
  return validateGiveawayUpdateInput(input);
}

const allowedTransitions: Record<GiveawayState, readonly GiveawayState[]> = {
  draft: ["scheduled", "open", "cancelled", "suspended"],
  scheduled: ["open", "paused", "cancelled", "suspended"],
  open: ["paused", "locked", "cancelled", "suspended"],
  paused: ["open", "locked", "cancelled", "suspended"],
  locked: ["drawing", "suspended"],
  drawing: ["claims_open", "suspended"],
  claims_open: ["completed", "suspended"],
  completed: ["suspended"],
  cancelled: [],
  suspended: [],
};

const awardPhaseStates = new Set<GiveawayState>([
  "locked",
  "drawing",
  "claims_open",
  "completed",
]);

export function canTransitionGiveawayState(
  from: GiveawayState,
  to: GiveawayState,
  complianceStatus: GiveawayComplianceStatus,
): boolean {
  if (from === to) return false;
  if (to === "open" && complianceStatus !== "approved") return false;
  if (to === "cancelled" && awardPhaseStates.has(from)) return false;
  return allowedTransitions[from].includes(to);
}

export function assertGiveawayLifecycleTransition(
  from: GiveawayState,
  to: GiveawayState,
  complianceStatus: GiveawayComplianceStatus,
): void {
  if (!canTransitionGiveawayState(from, to, complianceStatus)) {
    throw new Error("INVALID_GIVEAWAY_STATE_TRANSITION");
  }
}
