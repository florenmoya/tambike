import { validateMemberMediaFile } from "./member-media-file-validation";

export type MotorcyclePhotoQueueStatus =
  | "ready"
  | "uploading"
  | "uploaded"
  | "failed";

export interface MotorcyclePhotoQueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: MotorcyclePhotoQueueStatus;
  error?: string;
  retryable: boolean;
}

export interface EnqueueMotorcyclePhotoFilesInput {
  current: MotorcyclePhotoQueueItem[];
  files: File[];
  persistedCount: number;
  createObjectUrl: (file: File) => string;
  createId: (file: File) => string;
}

export function enqueueMotorcyclePhotoFiles(input: EnqueueMotorcyclePhotoFilesInput): {
  items: MotorcyclePhotoQueueItem[];
} {
  const activeCount = input.current.filter((item) =>
    item.status === "ready" ||
    item.status === "uploading" ||
    item.status === "uploaded" ||
    (item.status === "failed" && item.retryable),
  ).length;
  let remainingSlots = Math.max(0, 5 - input.persistedCount - activeCount);
  const availableAtSelection = remainingSlots;
  const additions = input.files.map((file) => {
    const error = validateMemberMediaFile(file);
    const base = {
      id: input.createId(file),
      file,
      previewUrl: input.createObjectUrl(file),
    };
    if (error) {
      return { ...base, status: "failed" as const, error, retryable: false };
    }
    if (remainingSlots === 0) {
      return {
        ...base,
        status: "failed" as const,
        error: `Your garage has room for ${availableAtSelection} more photos.`,
        retryable: false,
      };
    }
    remainingSlots -= 1;
    return { ...base, status: "ready" as const, retryable: true };
  });
  return { items: [...input.current, ...additions] };
}

export function nextReadyMotorcyclePhoto(items: MotorcyclePhotoQueueItem[]) {
  return items.find((item) => item.status === "ready");
}

export function patchMotorcyclePhotoQueueItem(
  items: MotorcyclePhotoQueueItem[],
  id: string,
  patch: Partial<Pick<MotorcyclePhotoQueueItem, "status" | "error" | "retryable">>,
) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function removeMotorcyclePhotoQueueItem(
  items: MotorcyclePhotoQueueItem[],
  id: string,
) {
  return items.filter((item) => item.id !== id);
}
