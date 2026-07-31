import { describe, expect, test, vi } from "vitest";

import { demoEvents } from "@/features/tambike-demo/data";
import {
  LEGACY_EVENT_BRIEF_COPY_BY_ID,
  applyEventBriefCopyCleanupPlan,
  buildEventBriefCopyCleanupPlan,
} from "@/server/maintenance/event-brief-copy-cleanup";

const cafeClassicoId = "tambike-cafe-classico";

describe("event brief copy cleanup plan", () => {
  test("plans only exact known legacy descriptions", () => {
    const legacyDescription =
      LEGACY_EVENT_BRIEF_COPY_BY_ID[cafeClassicoId];
    const newDescription = demoEvents.find(
      (event) => event.id === cafeClassicoId,
    )?.whatHappens;

    expect(
      buildEventBriefCopyCleanupPlan({
        events: [
          {
            id: cafeClassicoId,
            whatHappens: legacyDescription,
          },
          {
            id: "organizer-edited",
            whatHappens: "The organizer wrote this.",
          },
        ],
      }),
    ).toEqual({
      eventUpdates: [
        {
          id: cafeClassicoId,
          from: legacyDescription,
          to: newDescription,
        },
      ],
    });
  });

  test("leaves already-clean and organizer-edited descriptions untouched", () => {
    const newDescription = demoEvents.find(
      (event) => event.id === cafeClassicoId,
    )?.whatHappens;

    expect(
      buildEventBriefCopyCleanupPlan({
        events: [
          { id: cafeClassicoId, whatHappens: newDescription ?? "" },
          {
            id: "motoir-national-round-5",
            whatHappens: "Organizer-specific race information.",
          },
        ],
      }),
    ).toEqual({ eventUpdates: [] });
  });

  test("guards every seeded event with one exact legacy description", () => {
    expect(Object.keys(LEGACY_EVENT_BRIEF_COPY_BY_ID)).toHaveLength(24);
    expect(Object.keys(LEGACY_EVENT_BRIEF_COPY_BY_ID).sort()).toEqual(
      demoEvents.map((event) => event.id).sort(),
    );
  });

  test("aborts if a previewed description changes before apply", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));

    await expect(
      applyEventBriefCopyCleanupPlan(
        { event: { updateMany } },
        {
          eventUpdates: [
            {
              id: cafeClassicoId,
              from: LEGACY_EVENT_BRIEF_COPY_BY_ID[cafeClassicoId],
              to:
                demoEvents.find((event) => event.id === cafeClassicoId)
                  ?.whatHappens ?? "",
            },
          ],
        },
      ),
    ).rejects.toThrow(`EVENT_BRIEF_COPY_CHANGED:${cafeClassicoId}`);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: cafeClassicoId,
        whatHappens: LEGACY_EVENT_BRIEF_COPY_BY_ID[cafeClassicoId],
      },
      data: {
        whatHappens:
          demoEvents.find((event) => event.id === cafeClassicoId)
            ?.whatHappens ?? "",
      },
    });
  });
});
