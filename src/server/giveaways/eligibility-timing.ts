export type GiveawayEligibilityGroupTiming = Readonly<{
  groupId: string;
  eligibleAt: string;
}>;

export type QualifiedGiveawayGroupTimingInput = Readonly<{
  groupId: string;
  position: number;
  derivedEligibleAt: string;
}>;

type TimedGiveawayEntry = Readonly<{
  id: string;
  eligibilityCycleAt: string | null;
  qualifiedEligibilityGroupTimings: readonly GiveawayEligibilityGroupTiming[];
}>;

function normalizeInstant(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_GIVEAWAY_ELIGIBILITY_TIMESTAMP");
  }
  return date.toISOString();
}

function laterInstant(left: string, right: string) {
  return normalizeInstant(left) >= normalizeInstant(right) ? normalizeInstant(left) : normalizeInstant(right);
}

function earlierInstant(left: string, right: string) {
  return normalizeInstant(left) <= normalizeInstant(right) ? normalizeInstant(left) : normalizeInstant(right);
}

export function latestGiveawayEligibilityTimestamp(values: readonly (string | null | undefined)[]) {
  const timestamps = values.filter((value): value is string => typeof value === "string");
  if (timestamps.length === 0) return null;
  return timestamps.map(normalizeInstant).reduce(laterInstant);
}

export function earliestGiveawayEligibilityTimestamp(values: readonly (string | null | undefined)[]) {
  const timestamps = values.filter((value): value is string => typeof value === "string");
  if (timestamps.length === 0) return null;
  return timestamps.map(normalizeInstant).reduce(earlierInstant);
}

/**
 * Entry-ledger deltas describe the change from the currently active weight,
 * not merely the previous database value. A withdrawn entry has no active
 * weight, so requalification must restore its full qualified weight.
 */
export function calculateGiveawayEntryWeightDelta(
  previous: { status: string; currentWeight: number } | null | undefined,
  nextWeight: number,
) {
  return nextWeight - (previous?.status === "eligible" ? previous.currentWeight : 0);
}

export function assertGiveawayEligibilityTimingIntegrity(
  qualifiedGroupIds: readonly string[],
  timings: readonly GiveawayEligibilityGroupTiming[],
) {
  const expectedIds = [...qualifiedGroupIds];
  const timingIds = timings.map((timing) => timing.groupId);
  if (
    expectedIds.length !== new Set(expectedIds).size ||
    timingIds.length !== new Set(timingIds).size ||
    expectedIds.length !== timingIds.length ||
    expectedIds.some((id) => !timingIds.includes(id))
  ) {
    throw new Error("INVALID_GIVEAWAY_ELIGIBILITY_TIMING_GROUPS");
  }
  for (const timing of timings) {
    if (!timing.groupId.trim()) throw new Error("INVALID_GIVEAWAY_ELIGIBILITY_TIMING_GROUPS");
    normalizeInstant(timing.eligibleAt);
  }
}

export function reconcileGiveawayEligibilityTimings(input: {
  previousTimings: readonly GiveawayEligibilityGroupTiming[];
  qualifiedGroups: readonly QualifiedGiveawayGroupTimingInput[];
  actionAt?: string;
}) {
  const previousByGroupId = new Map<string, string>();
  for (const timing of input.previousTimings) {
    if (!timing.groupId.trim() || previousByGroupId.has(timing.groupId)) {
      throw new Error("INVALID_GIVEAWAY_ELIGIBILITY_TIMING_GROUPS");
    }
    previousByGroupId.set(timing.groupId, normalizeInstant(timing.eligibleAt));
  }
  const seenGroups = new Set<string>();
  const actionAt = input.actionAt ? normalizeInstant(input.actionAt) : undefined;
  const qualifiedEligibilityGroupTimings = [...input.qualifiedGroups]
    .sort((left, right) => left.position - right.position || left.groupId.localeCompare(right.groupId))
    .map((group) => {
      if (!group.groupId.trim() || seenGroups.has(group.groupId)) {
        throw new Error("INVALID_GIVEAWAY_ELIGIBILITY_TIMING_GROUPS");
      }
      seenGroups.add(group.groupId);
      const previous = previousByGroupId.get(group.groupId);
      const derived = normalizeInstant(group.derivedEligibleAt);
      return {
        groupId: group.groupId,
        eligibleAt: previous ?? (actionAt ? laterInstant(derived, actionAt) : derived),
      } satisfies GiveawayEligibilityGroupTiming;
    });
  const eligibilityCycleAt = earliestGiveawayEligibilityTimestamp(
    qualifiedEligibilityGroupTimings.map((timing) => timing.eligibleAt),
  );
  return { qualifiedEligibilityGroupTimings, eligibilityCycleAt };
}

export function resolveGiveawayPoolEligibilityPriority(input: {
  eligibilityCycleAt: string | null;
  qualifiedEligibilityGroupTimings: readonly GiveawayEligibilityGroupTiming[];
  permittedGroupIds: readonly string[];
}) {
  if (input.permittedGroupIds.length === 0) {
    return input.eligibilityCycleAt ? normalizeInstant(input.eligibilityCycleAt) : null;
  }
  const allowed = new Set(input.permittedGroupIds);
  return earliestGiveawayEligibilityTimestamp(
    input.qualifiedEligibilityGroupTimings
      .filter((timing) => allowed.has(timing.groupId))
      .map((timing) => timing.eligibleAt),
  );
}

export function compareGiveawayEntriesByPoolPriority(
  left: TimedGiveawayEntry,
  right: TimedGiveawayEntry,
  permittedGroupIds: readonly string[],
) {
  const leftPriority = resolveGiveawayPoolEligibilityPriority({
    eligibilityCycleAt: left.eligibilityCycleAt,
    qualifiedEligibilityGroupTimings: left.qualifiedEligibilityGroupTimings,
    permittedGroupIds,
  });
  const rightPriority = resolveGiveawayPoolEligibilityPriority({
    eligibilityCycleAt: right.eligibilityCycleAt,
    qualifiedEligibilityGroupTimings: right.qualifiedEligibilityGroupTimings,
    permittedGroupIds,
  });
  if (leftPriority === null && rightPriority !== null) return 1;
  if (leftPriority !== null && rightPriority === null) return -1;
  if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority) {
    return leftPriority.localeCompare(rightPriority);
  }
  return left.id.localeCompare(right.id);
}
