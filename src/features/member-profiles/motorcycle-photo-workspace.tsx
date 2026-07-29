"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { finalizeMemberMediaAction } from "@/server/actions";
import {
  memberMediaUploadFailure,
  MemberMediaDropInput,
  performMemberMediaUpload,
} from "./member-media-uploader";
import { MemberMediaImage } from "./member-media-image";
import {
  createMotorcyclePhotoPreviewRegistry,
  createMotorcyclePhotoQueueDescriptors,
  createMotorcyclePhotoUploadScheduler,
  enqueueMotorcyclePhotoDescriptors,
} from "./motorcycle-photo-upload-orchestrator";
import {
  patchMotorcyclePhotoQueueItem,
  type MotorcyclePhotoQueueItem,
} from "./motorcycle-photo-queue";
import styles from "./profile-studio.module.css";
import type { MotorcycleShowcase } from "./types";

// The extracted scheduler selects nextReadyMotorcyclePhoto without coupling that policy to React state updates.

export interface MotorcyclePhotoWorkspaceProps {
  photos: MotorcycleShowcase["photos"];
  uploadEnabled: boolean;
  mediaPending: boolean;
  onUploaded: () => Promise<void>;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  onReorder: (fromIndex: number, toIndex: number) => Promise<void>;
  onDelete: (url: string, label: string) => Promise<void>;
}

function activeQueueCount(queue: MotorcyclePhotoQueueItem[]) {
  return queue.filter((item) =>
    item.status === "ready" ||
    item.status === "uploading" ||
    item.status === "uploaded" ||
    (item.status === "failed" && item.retryable),
  ).length;
}

export function motorcyclePhotoCapacityLabel(photoCount: number) {
  const count = Math.min(5, Math.max(0, photoCount));
  const remaining = 5 - count;

  if (remaining === 0) {
    return "5 of 5 photos · Delete one to add another";
  }
  if (count === 0) {
    return "0 of 5 photos · Add up to 5";
  }
  return `${count} of 5 photos · Add up to ${remaining} more`;
}

function queueStatus(
  queue: MotorcyclePhotoQueueItem[],
  uploadEnabled: boolean,
) {
  const uploading = queue.filter((item) => item.status === "uploading").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const ready = queue.filter((item) => item.status === "ready").length;
  if (!uploadEnabled && ready) {
    return "Photos are ready. Save your motorcycle to start uploading.";
  }
  if (uploading) return `Uploading ${uploading} motorcycle photo${uploading === 1 ? "" : "s"}.`;
  if (ready) return `${ready} motorcycle photo${ready === 1 ? "" : "s"} waiting to upload.`;
  if (failed) return `${failed} motorcycle photo${failed === 1 ? " needs" : "s need"} attention.`;
  return "";
}

export function MotorcyclePhotoWorkspace({
  photos,
  uploadEnabled,
  mediaPending,
  onUploaded,
  onMove,
  onReorder,
  onDelete,
}: MotorcyclePhotoWorkspaceProps) {
  const inputId = useId();
  const [queue, setQueue] = useState<MotorcyclePhotoQueueItem[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const queueRef = useRef(queue);
  const schedulerRef = useRef<ReturnType<typeof createMotorcyclePhotoUploadScheduler> | null>(null);
  const [previewRegistry] = useState(() => createMotorcyclePhotoPreviewRegistry(URL.revokeObjectURL));

  const availableSlots = Math.max(0, 5 - photos.length - activeQueueCount(queue));
  const queueSummary = queueStatus(queue, uploadEnabled);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const descriptors = createMotorcyclePhotoQueueDescriptors({
      files,
      createObjectUrl: (file) => URL.createObjectURL(file),
      createId: (file) => `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    });
    previewRegistry.register(descriptors);
    setQueue((current) => enqueueMotorcyclePhotoDescriptors({
      current,
      descriptors,
      persistedCount: photos.length,
    }).items);
  };

  const removeItem = (id: string) => {
    const item = queue.find((candidate) => candidate.id === id);
    if (item) previewRegistry.release(item.previewUrl);
    setQueue((current) => current.filter((candidate) => candidate.id !== id));
  };

  const retryItem = (id: string) => {
    setQueue((current) => patchMotorcyclePhotoQueueItem(current, id, {
      status: "ready",
      error: undefined,
      retryable: true,
    }));
  };

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    schedulerRef.current = createMotorcyclePhotoUploadScheduler({
      getItems: () => queueRef.current,
      setItems: setQueue,
      releasePreview: (previewUrl) => previewRegistry.release(previewUrl),
    });
  }, [previewRegistry]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    void scheduler.processNext({
      uploadEnabled,
      motorcyclePhotoPosition: photos.length,
      upload: (item, motorcyclePhotoPosition) => performMemberMediaUpload({
        file: item.file,
        purpose: "motorcycle-photo",
        motorcyclePhotoPosition,
      }, {
        fetchImpl: fetch,
        finalize: finalizeMemberMediaAction,
        onStatus: () => undefined,
      }),
      refresh: onUploaded,
      describeFailure: memberMediaUploadFailure,
    });
  }, [onUploaded, photos.length, queue, uploadEnabled]);

  useEffect(() => () => {
    previewRegistry.releaseAll();
  }, [previewRegistry]);

  const refreshUploadedItem = (id: string) => {
    void schedulerRef.current?.refreshUploaded(id, onUploaded);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <section className={styles.motorcyclePhotoWorkspace} aria-labelledby="motorcycle-photo-title">
      <div className={styles.motorcyclePhotoHeading}>
        <div>
          <strong id="motorcycle-photo-title">Motorcycle photos *</strong>
          <span>
            The first photo is your cover. JPEG, PNG, or WebP · Up to 8 MB each.
          </span>
        </div>
        <span className={styles.motorcyclePhotoCapacity} aria-live="polite">
          {motorcyclePhotoCapacityLabel(photos.length)}
        </span>
      </div>
      {photos.length >= 5 ? (
        <div className={styles.motorcyclePhotoFull}>
          <ImagePlus aria-hidden="true" />
          <strong>Gallery full</strong>
          <span>5 of 5 photos · Delete one to add another</span>
        </div>
      ) : (
        <div
          className={styles.motorcyclePhotoDropzone}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <ImagePlus aria-hidden="true" />
          <strong>Drop motorcycle photos here</strong>
          <span>JPEG, PNG, or WebP · 8 MB each · up to 5 photos</span>
          <Label htmlFor={inputId}>Choose photos</Label>
          {/* MemberMediaDropInput keeps the multiple file selection behavior shared with this workspace. */}
          <MemberMediaDropInput
            inputId={inputId}
            disabled={availableSlots === 0}
            onFilesSelected={addFiles}
          />
        </div>
      )}
      <div className={styles.motorcyclePhotoProgress} aria-live="polite">{queueSummary}</div>
      <ul className={styles.motorcyclePhotoQueue} aria-label="Photos waiting to upload">
        {queue.map((item) => (
          <li key={item.id} className={styles.motorcyclePhotoQueueItem} data-status={item.status}>
            {/* Local object URLs are not eligible for the persisted-media Image component. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt="" />
            <div>
              <strong>{item.file.name}</strong>
              <span>{item.error ?? item.status}</span>
            </div>
            {item.status === "uploading" ? <LoaderCircle className="animate-spin" aria-label="Uploading" /> : null}
            {item.status === "failed" && item.retryable ? (
              <Button type="button" variant="outline" onClick={() => retryItem(item.id)}>Retry</Button>
            ) : null}
            {item.status === "uploaded" && item.error ? (
              <Button type="button" variant="outline" onClick={() => refreshUploadedItem(item.id)}>Refresh gallery</Button>
            ) : null}
            {item.status !== "uploaded" ? (
              <Button type="button" variant="outline" disabled={item.status === "uploading"} onClick={() => removeItem(item.id)}>Remove</Button>
            ) : null}
          </li>
        ))}
      </ul>
      <ol className={styles.motorcyclePhotoGrid} aria-label="Saved motorcycle photos">
        {photos.map((photo, index) => (
          <li
            key={photo.url}
            className={`${styles.motorcyclePhotoCard} ${index === 0 ? styles.motorcyclePhotoCardCover : ""}`}
            draggable={!mediaPending}
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedIndex !== null && draggedIndex !== index) {
                void onReorder(draggedIndex, index);
              }
              setDraggedIndex(null);
            }}
          >
            <MemberMediaImage
              src={photo.url}
              alt={`Motorcycle photo ${index + 1}`}
              width={photo.width || 800}
              height={photo.height || 600}
              sizes="(max-width: 640px) 45vw, 280px"
              loading={index === 0 ? "eager" : undefined}
            />
            <div className={styles.motorcyclePhotoCardMeta}>
              <span>Photo {index + 1} of {photos.length}</span>
              {index === 0 ? <strong>Cover photo</strong> : null}
            </div>
            <div className={styles.motorcyclePhotoActions}>
              {index > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Set motorcycle photo ${index + 1} as cover`}
                  disabled={mediaPending}
                  onClick={() => void onReorder(index, 0)}
                >
                  Set as cover
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                aria-label={`Move motorcycle photo ${index + 1} left`}
                disabled={mediaPending || index === 0}
                onClick={() => void onMove(index, -1)}
              >
                Move left
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={`Move motorcycle photo ${index + 1} right`}
                disabled={mediaPending || index === photos.length - 1}
                onClick={() => void onMove(index, 1)}
              >
                Move right
              </Button>
              <Button
                type="button"
                variant="destructive"
                aria-label={`Delete motorcycle photo ${index + 1}`}
                disabled={mediaPending}
                onClick={() => void onDelete(photo.url, `Photo ${index + 1}`)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
