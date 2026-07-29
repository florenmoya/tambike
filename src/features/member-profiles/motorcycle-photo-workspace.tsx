"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { finalizeMemberMediaAction } from "@/server/actions";
import { MemberMediaDropInput, performMemberMediaUpload } from "./member-media-uploader";
import { MemberMediaImage } from "./member-profile-screen";
import {
  enqueueMotorcyclePhotoFiles,
  nextReadyMotorcyclePhoto,
  patchMotorcyclePhotoQueueItem,
  removeMotorcyclePhotoQueueItem,
  type MotorcyclePhotoQueueItem,
} from "./motorcycle-photo-queue";
import styles from "./profile-studio.module.css";
import type { MotorcycleShowcase } from "./types";

export interface MotorcyclePhotoWorkspaceProps {
  photos: MotorcycleShowcase["photos"];
  disabled: boolean;
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

function queueStatus(queue: MotorcyclePhotoQueueItem[]) {
  const uploading = queue.filter((item) => item.status === "uploading").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const ready = queue.filter((item) => item.status === "ready").length;
  if (uploading) return `Uploading ${uploading} motorcycle photo${uploading === 1 ? "" : "s"}.`;
  if (ready) return `${ready} motorcycle photo${ready === 1 ? "" : "s"} waiting to upload.`;
  if (failed) return `${failed} motorcycle photo${failed === 1 ? " needs" : "s need"} attention.`;
  return "";
}

export function MotorcyclePhotoWorkspace({
  photos,
  disabled,
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
  const uploadInFlight = useRef(false);

  const availableSlots = Math.max(0, 5 - photos.length - activeQueueCount(queue));
  const queueSummary = queueStatus(queue);

  const addFiles = (files: File[]) => {
    if (disabled || files.length === 0) return;
    setQueue((current) => enqueueMotorcyclePhotoFiles({
      current,
      files,
      persistedCount: photos.length,
      createObjectUrl: (file) => URL.createObjectURL(file),
      createId: (file) => `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    }).items);
  };

  const removeItem = (id: string) => {
    setQueue((current) => {
      const item = current.find((candidate) => candidate.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return removeMotorcyclePhotoQueueItem(current, id);
    });
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
    if (disabled || uploadInFlight.current) return;
    const next = nextReadyMotorcyclePhoto(queue);
    if (!next) return;

    uploadInFlight.current = true;
    queueMicrotask(() => {
      setQueue((current) => patchMotorcyclePhotoQueueItem(current, next.id, {
        status: "uploading",
        error: undefined,
        retryable: true,
      }));

      void (async () => {
        try {
          await performMemberMediaUpload({
            file: next.file,
            purpose: "motorcycle-photo",
            motorcyclePhotoPosition: photos.length,
          }, {
            fetchImpl: fetch,
            finalize: finalizeMemberMediaAction,
            onStatus: () => undefined,
          });
          await onUploaded();
          setQueue((current) => patchMotorcyclePhotoQueueItem(current, next.id, {
            status: "uploaded",
            retryable: false,
          }));
          URL.revokeObjectURL(next.previewUrl);
          setQueue((current) => removeMotorcyclePhotoQueueItem(current, next.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed. Check the file and try again.";
          setQueue((current) => patchMotorcyclePhotoQueueItem(current, next.id, {
            status: "failed",
            error: message,
            retryable: true,
          }));
        } finally {
          uploadInFlight.current = false;
          setQueue((current) => [...current]);
        }
      })();
    });
  }, [disabled, onUploaded, photos.length, queue]);

  useEffect(() => () => {
    queueRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <section className={styles.motorcyclePhotoWorkspace} aria-labelledby="motorcycle-photo-title">
      <div
        className={styles.motorcyclePhotoDropzone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <ImagePlus aria-hidden="true" />
        <strong id="motorcycle-photo-title">Drop motorcycle photos here</strong>
        <span>JPEG, PNG, or WebP · 8 MB each · up to 5 photos</span>
        <Label htmlFor={inputId}>Choose photos</Label>
        {/* MemberMediaDropInput keeps the multiple file selection behavior shared with this workspace. */}
        <MemberMediaDropInput
          inputId={inputId}
          disabled={disabled || availableSlots === 0}
          onFilesSelected={addFiles}
        />
      </div>
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
            <Button type="button" variant="outline" disabled={item.status === "uploading"} onClick={() => removeItem(item.id)}>Remove</Button>
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
            />
            <span className={styles.motorcyclePhotoCardLabel}>{index === 0 ? "Cover" : `Photo ${index + 1}`}</span>
            <div className={styles.motorcyclePhotoActions}>
              <Button
                type="button"
                variant="outline"
                aria-label={`Move motorcycle photo ${index + 1} earlier`}
                disabled={mediaPending || index === 0}
                onClick={() => void onMove(index, -1)}
              >
                Move earlier
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={`Move motorcycle photo ${index + 1} later`}
                disabled={mediaPending || index === photos.length - 1}
                onClick={() => void onMove(index, 1)}
              >
                Move later
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
