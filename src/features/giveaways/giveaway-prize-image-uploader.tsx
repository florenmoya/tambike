"use client";

import Image from "next/image";
import { ImagePlusIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteGiveawayPrizeImageAction,
  finalizeGiveawayPrizeImageAction,
} from "@/server/giveaway-actions";
import type { GiveawayPrizeImageSummary } from "./types";

type PrizeImageActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error?: string };

type PrizeImageFinalize = (input: {
  giveawayId: string;
  prizePoolId: string;
  tempKey: string;
  claimedMimeType: "image/jpeg" | "image/png" | "image/webp";
}) => Promise<PrizeImageActionResult<GiveawayPrizeImageSummary>>;

type PrizeImageRemove = (input: {
  giveawayId: string;
  prizePoolId: string;
  mediaId: string;
}) => Promise<PrizeImageActionResult<void>>;

interface PresignedPrizeImageUpload {
  key: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  url: string;
  fields: Record<string, string>;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class GiveawayPrizeImageUploadUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GiveawayPrizeImageUploadUiError";
  }
}

export function validateGiveawayPrizeImageFile(
  file: Pick<File, "type" | "size">,
) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size < 1) {
    return "Choose a non-empty image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Choose an image no larger than 8 MB.";
  }
  return null;
}

function isPresignedPrizeImageUpload(
  value: unknown,
): value is PresignedPrizeImageUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const upload = value as Partial<PresignedPrizeImageUpload>;
  return (
    typeof upload.key === "string" &&
    ALLOWED_IMAGE_TYPES.has(upload.mimeType ?? "") &&
    typeof upload.url === "string" &&
    Boolean(upload.fields) &&
    typeof upload.fields === "object" &&
    !Array.isArray(upload.fields)
  );
}

export async function performGiveawayPrizeImageUpload(
  input: {
    file: File;
    giveawayId: string;
    prizePoolId: string;
  },
  dependencies: {
    fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    finalize: PrizeImageFinalize;
    onStatus: (status: string) => void;
  },
): Promise<GiveawayPrizeImageSummary> {
  const validation = validateGiveawayPrizeImageFile(input.file);
  if (validation) throw new GiveawayPrizeImageUploadUiError(validation);

  dependencies.onStatus("Preparing secure upload…");
  let presignResponse: Response;
  try {
    presignResponse = await dependencies.fetchImpl(
      "/api/giveaway-prize-media/uploads",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giveawayId: input.giveawayId,
          prizePoolId: input.prizePoolId,
          mimeType: input.file.type,
        }),
      },
    );
  } catch {
    throw new GiveawayPrizeImageUploadUiError(
      "Image uploads are temporarily unavailable. Try again shortly.",
    );
  }
  if (!presignResponse.ok) {
    throw new GiveawayPrizeImageUploadUiError(
      presignResponse.status === 400
        ? "Choose a JPEG, PNG, or WebP image no larger than 8 MB."
        : "Image uploads are temporarily unavailable. Try again shortly.",
    );
  }

  let presign: unknown;
  try {
    presign = await presignResponse.json();
  } catch {
    throw new GiveawayPrizeImageUploadUiError(
      "Image uploads are temporarily unavailable. Try again shortly.",
    );
  }
  if (!isPresignedPrizeImageUpload(presign)) {
    throw new GiveawayPrizeImageUploadUiError(
      "Image uploads are temporarily unavailable. Try again shortly.",
    );
  }

  const uploadData = new FormData();
  for (const [name, value] of Object.entries(presign.fields)) {
    uploadData.append(name, value);
  }
  uploadData.append("file", input.file);

  dependencies.onStatus("Uploading image…");
  let uploadResponse: Response;
  try {
    uploadResponse = await dependencies.fetchImpl(presign.url, {
      method: "POST",
      body: uploadData,
    });
  } catch {
    throw new GiveawayPrizeImageUploadUiError(
      "The image could not be sent to storage. Check your connection and try again.",
    );
  }
  if (!uploadResponse.ok) {
    throw new GiveawayPrizeImageUploadUiError(
      [400, 403, 413].includes(uploadResponse.status)
        ? "Storage rejected this upload because it did not match the signed file type or size policy."
        : "Image storage is temporarily unavailable. Try again shortly.",
    );
  }

  dependencies.onStatus("Finishing image…");
  const finalized = await dependencies.finalize({
    giveawayId: input.giveawayId,
    prizePoolId: input.prizePoolId,
    tempKey: presign.key,
    claimedMimeType: presign.mimeType,
  });
  if (!finalized.ok) {
    throw new GiveawayPrizeImageUploadUiError(
      "The uploaded image could not be finalized. Try again.",
    );
  }
  return finalized.data;
}

export async function performGiveawayPrizeImageRemoval(
  input: {
    giveawayId: string;
    prizePoolId: string;
    mediaId: string;
  },
  remove: PrizeImageRemove,
): Promise<void> {
  const result = await remove(input);
  if (!result.ok) {
    throw new GiveawayPrizeImageUploadUiError(
      "The public image could not be removed. Try again.",
    );
  }
}

export function GiveawayPrizeImageUploader({
  giveawayId,
  prizePoolId,
  image,
  disabled,
  onChanged,
}: {
  giveawayId: string;
  prizePoolId: string;
  image?: GiveawayPrizeImageSummary;
  disabled: boolean;
  onChanged: () => Promise<void> | void;
}): React.JSX.Element {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const fileError = file ? validateGiveawayPrizeImageFile(file) : null;

  const upload = async () => {
    if (!file || fileError || disabled) return;
    setPending(true);
    try {
      await performGiveawayPrizeImageUpload(
        { file, giveawayId, prizePoolId },
        {
          fetchImpl: fetch,
          finalize: finalizeGiveawayPrizeImageAction,
          onStatus: setStatus,
        },
      );
      await onChanged();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Public prize image updated.");
    } catch (error) {
      setStatus(
        error instanceof GiveawayPrizeImageUploadUiError
          ? error.message
          : "The public prize image could not be updated. Try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!image || disabled) return;
    setPending(true);
    try {
      await performGiveawayPrizeImageRemoval(
        {
          giveawayId,
          prizePoolId,
          mediaId: image.mediaId,
        },
        deleteGiveawayPrizeImageAction,
      );
      await onChanged();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Public prize image removed.");
    } catch (error) {
      setStatus(
        error instanceof GiveawayPrizeImageUploadUiError
          ? error.message
          : "The public prize image could not be removed. Try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3">
      {image ? (
        <Image
          src={image.url}
          alt="Current public prize"
          width={image.width}
          height={image.height}
          sizes="(max-width: 768px) 100vw, 32rem"
          className="max-h-56 w-full rounded-md object-cover"
          unoptimized
        />
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>Public image (optional)</Label>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, or WebP · up to 8 MB.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || pending}
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] ?? null;
            setFile(selected);
            setStatus(selected ? validateGiveawayPrizeImageFile(selected) ?? "" : "");
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || pending || !file || Boolean(fileError)}
          onClick={() => void upload()}
        >
          {pending ? (
            <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
          ) : (
            <ImagePlusIcon data-icon="inline-start" />
          )}
          {image ? "Replace image" : "Upload image"}
        </Button>
        {image ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || pending}
            onClick={() => void remove()}
          >
            <Trash2Icon data-icon="inline-start" />
            Remove image
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
