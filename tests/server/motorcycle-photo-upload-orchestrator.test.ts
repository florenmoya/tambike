import { describe, expect, test } from "vitest";

import { memberMediaUploadFailure } from "../../src/features/member-profiles/member-media-uploader";
import {
  createMotorcyclePhotoPreviewRegistry,
  createMotorcyclePhotoQueueDescriptors,
  createMotorcyclePhotoUploadScheduler,
  enqueueMotorcyclePhotoDescriptors,
} from "../../src/features/member-profiles/motorcycle-photo-upload-orchestrator";
import type { MotorcyclePhotoQueueItem } from "../../src/features/member-profiles/motorcycle-photo-queue";

function image(name: string) {
  return new File([new Uint8Array([1])], name, { type: "image/webp" });
}

function item(name: string): MotorcyclePhotoQueueItem {
  return {
    id: `queue:${name}`,
    file: image(name),
    previewUrl: `blob:${name}`,
    status: "ready",
    retryable: true,
  };
}

function schedulerHarness(initial: MotorcyclePhotoQueueItem[]) {
  let queue = initial;
  const events: string[] = [];
  const scheduler = createMotorcyclePhotoUploadScheduler({
    getItems: () => queue,
    setItems: (updater) => {
      queue = updater(queue);
      events.push(`queue:${queue.map((entry) => `${entry.id}:${entry.status}`).join(",")}`);
    },
    releasePreview: (previewUrl) => events.push(`revoke:${previewUrl}`),
  });

  return {
    scheduler,
    events,
    queue: () => queue,
  };
}

describe("motorcycle photo upload orchestration", () => {
  test("uploads one queued file at a time and refreshes after finalization before releasing its preview", async () => {
    const harness = schedulerHarness([item("a.webp"), item("b.webp")]);
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const upload = async (next: MotorcyclePhotoQueueItem) => {
      harness.events.push(`upload:${next.id}`);
      await uploadGate;
    };
    const refresh = async () => {
      harness.events.push("refresh");
    };

    const first = harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload,
      refresh,
      describeFailure: memberMediaUploadFailure,
    });
    await Promise.resolve();

    expect(harness.events).toEqual([
      "queue:queue:a.webp:uploading,queue:b.webp:ready",
      "upload:queue:a.webp",
    ]);
    await expect(harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload,
      refresh,
      describeFailure: memberMediaUploadFailure,
    })).resolves.toBe(false);

    releaseUpload();
    await first;

    expect(harness.events).toEqual([
      "queue:queue:a.webp:uploading,queue:b.webp:ready",
      "upload:queue:a.webp",
      "queue:queue:a.webp:uploaded,queue:b.webp:ready",
      "refresh",
      "revoke:blob:a.webp",
      "queue:queue:b.webp:ready",
    ]);

    await harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 1,
      upload: async (next) => {
        harness.events.push(`upload:${next.id}`);
      },
      refresh,
      describeFailure: memberMediaUploadFailure,
    });
    expect(harness.events.filter((event) => event.startsWith("upload:"))).toEqual([
      "upload:queue:a.webp",
      "upload:queue:b.webp",
    ]);
  });

  test("keeps a finalized photo uploaded when refresh fails and refreshes it without a second upload", async () => {
    const harness = schedulerHarness([item("a.webp")]);
    let uploads = 0;
    const refresh = async () => {
      throw new Error("refresh unavailable");
    };

    await harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload: async () => {
        uploads += 1;
      },
      refresh,
      describeFailure: memberMediaUploadFailure,
    });

    expect(harness.queue()).toMatchObject([{
      status: "uploaded",
      retryable: false,
      error: "Photo uploaded. Refresh the gallery to see it.",
    }]);
    expect(uploads).toBe(1);

    await harness.scheduler.refreshUploaded("queue:a.webp", async () => undefined);

    expect(uploads).toBe(1);
    expect(harness.queue()).toEqual([]);
    expect(harness.events).toContain("revoke:blob:a.webp");
  });

  test("pauses later uploads until a finalized photo's refresh-only recovery updates its position", async () => {
    const harness = schedulerHarness([item("a.webp"), item("b.webp")]);
    const uploads: string[] = [];

    await harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload: async (next, position) => {
        uploads.push(`${next.id}:${position}`);
      },
      refresh: async () => {
        throw new Error("refresh unavailable");
      },
      describeFailure: memberMediaUploadFailure,
    });

    expect(harness.queue()).toMatchObject([
      { id: "queue:a.webp", status: "uploaded", retryable: false },
      { id: "queue:b.webp", status: "ready" },
    ]);

    await expect(harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload: async (next, position) => {
        uploads.push(`${next.id}:${position}`);
      },
      refresh: async () => undefined,
      describeFailure: memberMediaUploadFailure,
    })).resolves.toBe(false);
    expect(uploads).toEqual(["queue:a.webp:0"]);

    let refreshedPosition = 0;
    await harness.scheduler.refreshUploaded("queue:a.webp", async () => {
      refreshedPosition = 1;
    });

    await harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: refreshedPosition,
      upload: async (next, position) => {
        uploads.push(`${next.id}:${position}`);
      },
      refresh: async () => undefined,
      describeFailure: memberMediaUploadFailure,
    });

    expect(uploads).toEqual(["queue:a.webp:0", "queue:b.webp:1"]);
  });

  test("uses a stable non-retryable message for permanent upload failures", async () => {
    const harness = schedulerHarness([item("a.webp")]);

    await harness.scheduler.processNext({
      uploadEnabled: true,
      motorcyclePhotoPosition: 0,
      upload: async () => {
        throw new Error("PHOTO_LIMIT");
      },
      refresh: async () => undefined,
      describeFailure: memberMediaUploadFailure,
    });

    expect(harness.queue()).toMatchObject([{
      status: "failed",
      error: "This garage already has five motorcycle photos.",
      retryable: false,
    }]);

    expect(memberMediaUploadFailure(new Error("UNAUTHENTICATED"))).toEqual({
      message: "Log in again before uploading an image.",
      retryable: false,
    });
  });

  test("keeps selected photos queued until a persisted motorcycle enables upload", async () => {
    const harness = schedulerHarness([item("a.webp"), item("b.webp")]);
    const uploads: string[] = [];

    const process = (uploadEnabled: boolean) => harness.scheduler.processNext({
      uploadEnabled,
      motorcyclePhotoPosition: 0,
      upload: async (next) => {
        uploads.push(next.id);
      },
      refresh: async () => undefined,
      describeFailure: memberMediaUploadFailure,
    });

    await expect(process(false)).resolves.toBe(false);
    expect(uploads).toEqual([]);
    expect(harness.queue()).toMatchObject([
      { id: "queue:a.webp", status: "ready" },
      { id: "queue:b.webp", status: "ready" },
    ]);

    await expect(process(true)).resolves.toBe(true);
    expect(uploads).toEqual(["queue:a.webp"]);
    expect(harness.queue()).toMatchObject([
      { id: "queue:b.webp", status: "ready" },
    ]);
  });

  test("creates and registers preview descriptors before replayable queue updates", () => {
    const revoked: string[] = [];
    const registry = createMotorcyclePhotoPreviewRegistry((previewUrl) => revoked.push(previewUrl));
    let objectUrlCalls = 0;
    const descriptors = createMotorcyclePhotoQueueDescriptors({
      files: [image("a.webp"), image("b.webp")],
      createObjectUrl: (file) => {
        objectUrlCalls += 1;
        return `blob:${file.name}`;
      },
      createId: (file) => `queue:${file.name}`,
    });
    registry.register(descriptors);

    const enqueue = (current: MotorcyclePhotoQueueItem[]) => enqueueMotorcyclePhotoDescriptors({
      current,
      descriptors,
      persistedCount: 0,
    }).items;
    enqueue([]);
    const accepted = enqueue([]);

    expect(objectUrlCalls).toBe(2);
    expect(accepted.map((entry) => entry.previewUrl)).toEqual(["blob:a.webp", "blob:b.webp"]);

    registry.release("blob:a.webp");
    registry.releaseAll();
    expect(revoked).toEqual(["blob:a.webp", "blob:b.webp"]);
  });
});
