import { describe, expect, test } from "vitest";
import {
  enqueueMotorcyclePhotoFiles,
  nextReadyMotorcyclePhoto,
  patchMotorcyclePhotoQueueItem,
  removeMotorcyclePhotoQueueItem,
} from "../../src/features/member-profiles/motorcycle-photo-queue";

function image(name: string, type = "image/webp", size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("motorcycle photo queue", () => {
  test("keeps accepted files in selection order and rejects files beyond five total slots", () => {
    const result = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("a.webp"), image("b.webp"), image("c.webp")],
      persistedCount: 3,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    });

    expect(result.items.map(({ file, status, error }) => ({
      name: file.name,
      status,
      error,
    }))).toEqual([
      { name: "a.webp", status: "ready", error: undefined },
      { name: "b.webp", status: "ready", error: undefined },
      {
        name: "c.webp",
        status: "failed",
        error: "Your garage has room for 2 more photos.",
      },
    ]);
  });

  test("marks invalid files locally without consuming a photo slot", () => {
    const result = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("bad.gif", "image/gif"), image("good.webp")],
      persistedCount: 4,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    });

    expect(result.items[0]).toMatchObject({
      status: "failed",
      retryable: false,
      error: "Choose a JPEG, PNG, or WebP image.",
    });
    expect(result.items[1]).toMatchObject({ status: "ready" });
  });

  test("keeps uploaded queue entries in the cap until persisted media refresh removes them", () => {
    const uploaded = ["a.webp", "b.webp", "c.webp", "d.webp", "e.webp"].map((name) => {
      const file = image(name);
      return {
        id: `queue:${name}`,
        file,
        previewUrl: `blob:${name}`,
        status: "uploaded" as const,
        retryable: false,
      };
    });

    const result = enqueueMotorcyclePhotoFiles({
      current: uploaded,
      files: [image("sixth.webp")],
      persistedCount: 0,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    });

    expect(result.items.at(-1)).toMatchObject({
      status: "failed",
      retryable: false,
      error: "Your garage has room for 0 more photos.",
    });
  });

  test("selects only the first ready item and supports retry and removal transitions", () => {
    const queued = enqueueMotorcyclePhotoFiles({
      current: [],
      files: [image("a.webp"), image("b.webp")],
      persistedCount: 0,
      createObjectUrl: (file) => `blob:${file.name}`,
      createId: (file) => `queue:${file.name}`,
    }).items;
    const uploading = patchMotorcyclePhotoQueueItem(queued, "queue:a.webp", {
      status: "uploading",
    });
    expect(nextReadyMotorcyclePhoto(uploading)?.id).toBe("queue:b.webp");
    expect(removeMotorcyclePhotoQueueItem(uploading, "queue:a.webp").map((item) => item.id))
      .toEqual(["queue:b.webp"]);
  });
});
