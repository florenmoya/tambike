"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { finalizeMemberMediaAction } from "@/server/actions";
import type { MotorcycleShowcase } from "./types";

type UploadPurpose = "avatar" | "motorcycle-photo";

interface PresignedUpload {
  key: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  url: string;
  fields: Record<string, string>;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class MemberMediaUploadUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberMediaUploadUiError";
  }
}

export function validateMemberMediaFile(file: Pick<File, "type" | "size">) {
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

interface PerformMemberMediaUploadInput {
  file: File;
  purpose: UploadPurpose;
  motorcyclePhotoPosition?: number;
}

interface PerformMemberMediaUploadDependencies {
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  finalize: typeof finalizeMemberMediaAction;
  onStatus: (status: string) => void;
}

async function responseErrorCode(response: Response) {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}

function presignFailureMessage(status: number, code: string) {
  if (status === 401 || code === "UNAUTHENTICATED") {
    return "Log in again before uploading an image.";
  }
  if (status === 400 || code === "INVALID_INPUT" || code === "INVALID_IMAGE") {
    return "Choose a JPEG, PNG, or WebP image no larger than 8 MB.";
  }
  return "Image uploads are temporarily unavailable. Try again shortly.";
}

function isPresignedUpload(value: unknown): value is PresignedUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const upload = value as Partial<PresignedUpload>;
  return (
    typeof upload.key === "string" &&
    ALLOWED_IMAGE_TYPES.has(upload.mimeType ?? "") &&
    typeof upload.url === "string" &&
    Boolean(upload.fields) &&
    typeof upload.fields === "object" &&
    !Array.isArray(upload.fields)
  );
}

export async function performMemberMediaUpload(
  input: PerformMemberMediaUploadInput,
  dependencies: PerformMemberMediaUploadDependencies,
) {
  const validation = validateMemberMediaFile(input.file);
  if (validation) throw new MemberMediaUploadUiError(validation);
  const { fetchImpl: fetch, onStatus } = dependencies;

  onStatus("Preparing secure upload…");
  let presignResponse: Response;
  try {
    presignResponse = await fetch("/api/member-media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: input.purpose, mimeType: input.file.type }),
    });
  } catch {
    throw new MemberMediaUploadUiError("Image uploads are temporarily unavailable. Try again shortly.");
  }
  if (!presignResponse.ok) {
    const code = await responseErrorCode(presignResponse);
    throw new MemberMediaUploadUiError(presignFailureMessage(presignResponse.status, code));
  }

  let presign: unknown;
  try {
    presign = await presignResponse.json();
  } catch {
    throw new MemberMediaUploadUiError("Image uploads are temporarily unavailable. Try again shortly.");
  }
  if (!isPresignedUpload(presign)) {
    throw new MemberMediaUploadUiError("Image uploads are temporarily unavailable. Try again shortly.");
  }

  const uploadData = new FormData();
  for (const [name, value] of Object.entries(presign.fields)) {
    uploadData.append(name, value);
  }
  uploadData.append("file", input.file);

  onStatus("Uploading image…");
  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(presign.url, {
      method: "POST",
      body: uploadData,
    });
  } catch {
    throw new MemberMediaUploadUiError("The image could not be sent to storage. Check your connection and try again.");
  }
  if (!uploadResponse.ok) {
    if ([400, 403, 413].includes(uploadResponse.status)) {
      throw new MemberMediaUploadUiError(
        "Storage rejected this upload because it did not match the signed file type or size policy. Choose the file again.",
      );
    }
    throw new MemberMediaUploadUiError("Image storage is temporarily unavailable. Try again shortly.");
  }

  onStatus("Finishing image…");
  await dependencies.finalize({
    purpose: input.purpose,
    tempKey: presign.key,
    claimedMimeType: presign.mimeType,
    motorcyclePhotoPosition: input.motorcyclePhotoPosition,
  });
}

function uploadMessage(error: unknown) {
  if (error instanceof MemberMediaUploadUiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("INVALID_IMAGE")) {
    return "Choose a JPEG, PNG, or WebP image no larger than 8 MB.";
  }
  if (message.includes("PHOTO_LIMIT")) {
    return "This garage already has five motorcycle photos.";
  }
  return "Upload failed. Check the file and try again.";
}

export function MemberMediaUploader({
  purpose,
  photos,
  onUploaded,
}: {
  purpose: UploadPurpose;
  photos: MotorcycleShowcase["photos"];
  onUploaded: () => Promise<void> | void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const isMotorcyclePhoto = purpose === "motorcycle-photo";
  const photoLimitReached = isMotorcyclePhoto && photos.length >= 5;
  const fileError = file ? validateMemberMediaFile(file) : null;
  const label = isMotorcyclePhoto ? "Motorcycle photo" : "Avatar photo";

  const upload = async () => {
    if (!file || photoLimitReached) return;
    setPending(true);

    try {
      await performMemberMediaUpload({
        file,
        purpose,
        motorcyclePhotoPosition: isMotorcyclePhoto ? photos.length : undefined,
      }, {
        fetchImpl: fetch,
        finalize: finalizeMemberMediaAction,
        onStatus: setStatus,
      });
      await onUploaded();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setStatus(`${label} uploaded.`);
    } catch (error) {
      setStatus(uploadMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="member-media-uploader">
      <Label htmlFor={inputId}>{label}</Label>
      <p>
        {isMotorcyclePhoto
          ? "JPEG, PNG, or WebP · up to 8 MB · Maximum 5 motorcycle photos."
          : "Square images work best. JPEG, PNG, or WebP · up to 8 MB."}
      </p>
      <div className="member-media-uploader__controls">
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={purpose === "motorcycle-photo" && photos.length >= 5}
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] ?? null;
            setFile(selected);
            setStatus(selected ? validateMemberMediaFile(selected) ?? "" : "");
          }}
        />
        <Button type="button" onClick={upload} disabled={!file || Boolean(fileError) || pending || photoLimitReached}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ImagePlus aria-hidden="true" />}
          {pending ? "Uploading…" : `Upload ${label.toLowerCase()}`}
        </Button>
      </div>
      {photoLimitReached ? (
        <p className="member-media-uploader__limit">Five photos added. Delete one before choosing another.</p>
      ) : null}
      <p className="member-media-uploader__status" aria-live="polite">{status}</p>
    </div>
  );
}
