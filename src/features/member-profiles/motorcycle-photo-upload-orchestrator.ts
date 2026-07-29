import { validateMemberMediaFile } from "./member-media-file-validation";
import {
  nextReadyMotorcyclePhoto,
  patchMotorcyclePhotoQueueItem,
  removeMotorcyclePhotoQueueItem,
  type MotorcyclePhotoQueueItem,
} from "./motorcycle-photo-queue";

export interface MotorcyclePhotoQueueDescriptor {
  id: string;
  file: File;
  previewUrl: string;
}

export interface MemberMediaUploadFailure {
  message: string;
  retryable: boolean;
}

type QueueUpdater = (items: MotorcyclePhotoQueueItem[]) => MotorcyclePhotoQueueItem[];

export function createMotorcyclePhotoQueueDescriptors({
  files,
  createObjectUrl,
  createId,
}: {
  files: File[];
  createObjectUrl: (file: File) => string;
  createId: (file: File) => string;
}): MotorcyclePhotoQueueDescriptor[] {
  return files.map((file) => ({
    id: createId(file),
    file,
    previewUrl: createObjectUrl(file),
  }));
}

export function enqueueMotorcyclePhotoDescriptors({
  current,
  descriptors,
  persistedCount,
}: {
  current: MotorcyclePhotoQueueItem[];
  descriptors: MotorcyclePhotoQueueDescriptor[];
  persistedCount: number;
}) {
  const activeCount = current.filter((item) =>
    item.status === "ready" ||
    item.status === "uploading" ||
    item.status === "uploaded" ||
    (item.status === "failed" && item.retryable),
  ).length;
  let remainingSlots = Math.max(0, 5 - persistedCount - activeCount);
  const availableAtSelection = remainingSlots;
  const additions = descriptors.map((descriptor) => {
    const error = validateMemberMediaFile(descriptor.file);
    if (error) return { ...descriptor, status: "failed" as const, error, retryable: false };
    if (remainingSlots === 0) {
      return {
        ...descriptor,
        status: "failed" as const,
        error: `Your garage has room for ${availableAtSelection} more photos.`,
        retryable: false,
      };
    }
    remainingSlots -= 1;
    return { ...descriptor, status: "ready" as const, retryable: true };
  });
  return { items: [...current, ...additions] };
}

export function createMotorcyclePhotoPreviewRegistry(revokeObjectUrl: (previewUrl: string) => void) {
  const previewUrls = new Set<string>();

  return {
    register(descriptors: MotorcyclePhotoQueueDescriptor[]) {
      descriptors.forEach((descriptor) => previewUrls.add(descriptor.previewUrl));
    },
    release(previewUrl: string) {
      if (!previewUrls.delete(previewUrl)) return;
      revokeObjectUrl(previewUrl);
    },
    releaseAll() {
      [...previewUrls].forEach((previewUrl) => {
        previewUrls.delete(previewUrl);
        revokeObjectUrl(previewUrl);
      });
    },
  };
}

export function createMotorcyclePhotoUploadScheduler({
  getItems,
  setItems,
  releasePreview,
}: {
  getItems: () => MotorcyclePhotoQueueItem[];
  setItems: (updater: QueueUpdater) => void;
  releasePreview: (previewUrl: string) => void;
}) {
  let uploadInFlight = false;

  return {
    async processNext({
      motorcyclePhotoPosition,
      upload,
      refresh,
      describeFailure,
    }: {
      motorcyclePhotoPosition: number;
      upload: (item: MotorcyclePhotoQueueItem, motorcyclePhotoPosition: number) => Promise<void>;
      refresh: () => Promise<void>;
      describeFailure: (error: unknown) => MemberMediaUploadFailure;
    }) {
      if (uploadInFlight) return false;
      const next = nextReadyMotorcyclePhoto(getItems());
      if (!next) return false;

      uploadInFlight = true;
      setItems((items) => patchMotorcyclePhotoQueueItem(items, next.id, {
        status: "uploading",
        error: undefined,
        retryable: true,
      }));

      try {
        try {
          await upload(next, motorcyclePhotoPosition);
        } catch (error) {
          const failure = describeFailure(error);
          setItems((items) => patchMotorcyclePhotoQueueItem(items, next.id, {
            status: "failed",
            error: failure.message,
            retryable: failure.retryable,
          }));
          return true;
        }

        setItems((items) => patchMotorcyclePhotoQueueItem(items, next.id, {
          status: "uploaded",
          error: undefined,
          retryable: false,
        }));

        try {
          await refresh();
        } catch {
          setItems((items) => patchMotorcyclePhotoQueueItem(items, next.id, {
            status: "uploaded",
            error: "Photo uploaded. Refresh the gallery to see it.",
            retryable: false,
          }));
          return true;
        }

        releasePreview(next.previewUrl);
        setItems((items) => removeMotorcyclePhotoQueueItem(items, next.id));
        return true;
      } finally {
        uploadInFlight = false;
      }
    },

    async refreshUploaded(id: string, refresh: () => Promise<void>) {
      const uploaded = getItems().find((item) => item.id === id && item.status === "uploaded");
      if (!uploaded) return false;

      try {
        await refresh();
      } catch {
        setItems((items) => patchMotorcyclePhotoQueueItem(items, id, {
          status: "uploaded",
          error: "Photo uploaded. Refresh the gallery to see it.",
          retryable: false,
        }));
        return false;
      }

      releasePreview(uploaded.previewUrl);
      setItems((items) => removeMotorcyclePhotoQueueItem(items, id));
      return true;
    },
  };
}
