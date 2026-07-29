"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { finalizeMemberMediaAction } from "@/server/actions";
import { validateMemberMediaFile } from "./member-media-file-validation";
import styles from "./profile-studio.module.css";
import type { MotorcycleShowcase } from "./types";

export { validateMemberMediaFile } from "./member-media-file-validation";

type UploadPurpose = "avatar" | "motorcycle-photo";

interface PresignedUpload {
  key: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  url: string;
  fields: Record<string, string>;
}

export class MemberMediaUploadUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberMediaUploadUiError";
  }
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
    ["image/jpeg", "image/png", "image/webp"].includes(upload.mimeType ?? "") &&
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

export function MemberMediaFileChooser({
  inputId,
  purpose,
  photoCount,
  pending,
  inputRef,
  onFileSelected,
}: {
  inputId: string;
  purpose: UploadPurpose;
  photoCount: number;
  pending: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onFileSelected: (file: File | null) => void;
}) {
  return (
    <Input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      disabled={pending || (purpose === "motorcycle-photo" && photoCount >= 5)}
      onChange={(event) => onFileSelected(event.currentTarget.files?.[0] ?? null)}
    />
  );
}

export function MemberMediaDropInput({
  inputId,
  disabled,
  inputRef,
  onFilesSelected,
}: {
  inputId: string;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onFilesSelected: (files: File[]) => void;
}) {
  return (
    <Input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      disabled={disabled}
      onChange={(event) => {
        onFilesSelected(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = "";
      }}
    />
  );
}

export function memberMediaUploadFailure(error: unknown) {
  if (error instanceof MemberMediaUploadUiError) {
    return {
      message: error.message,
      retryable: !(
        error.message.startsWith("Choose a ") ||
        error.message.startsWith("Log in again") ||
        error.message.includes("signed file type or size policy")
      ),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNAUTHENTICATED")) {
    return { message: "Log in again before uploading an image.", retryable: false };
  }
  if (message.includes("INVALID_INPUT")) {
    return { message: "Choose a JPEG, PNG, or WebP image no larger than 8 MB.", retryable: false };
  }
  if (message.includes("INVALID_IMAGE")) {
    return { message: "Choose a JPEG, PNG, or WebP image no larger than 8 MB.", retryable: false };
  }
  if (message.includes("PHOTO_LIMIT")) {
    return { message: "This garage already has five motorcycle photos.", retryable: false };
  }
  return { message: "Upload failed. Check the file and try again.", retryable: true };
}

export function MemberMediaUploader({
  onUploaded,
}: {
  purpose: UploadPurpose;
  photos: MotorcycleShowcase["photos"];
  onUploaded: () => Promise<void> | void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedPreviewUrlRef = useRef<string | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  const clearSelectedPreview = () => {
    if (selectedPreviewUrlRef.current) {
      URL.revokeObjectURL(selectedPreviewUrlRef.current);
      selectedPreviewUrlRef.current = null;
    }
    setSelectedPreviewUrl(null);
  };

  useEffect(() => () => {
    if (selectedPreviewUrlRef.current) URL.revokeObjectURL(selectedPreviewUrlRef.current);
  }, []);

  const uploadSelected = async (selected: File | null) => {
    clearSelectedPreview();
    setStatus("");
    if (!selected) return;

    const previewUrl = URL.createObjectURL(selected);
    selectedPreviewUrlRef.current = previewUrl;
    setSelectedPreviewUrl(previewUrl);

    const validationError = validateMemberMediaFile(selected);
    if (validationError) {
      setStatus(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setPending(true);
    try {
      await performMemberMediaUpload({ file: selected, purpose: "avatar" }, {
        fetchImpl: fetch,
        finalize: finalizeMemberMediaAction,
        onStatus: setStatus,
      });
      await onUploaded();
      clearSelectedPreview();
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Profile photo uploaded.");
    } catch (error) {
      setStatus(memberMediaUploadFailure(error).message);
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="member-media-uploader">
      <Label htmlFor={inputId}>Choose profile photo</Label>
      <p>Optional · Square images work best · JPEG, PNG, or WebP · Up to 8 MB.</p>
      <div className="member-media-uploader__controls">
        <MemberMediaFileChooser
          inputRef={inputRef}
          inputId={inputId}
          purpose="avatar"
          photoCount={0}
          pending={pending}
          onFileSelected={(selected) => {
            void uploadSelected(selected);
          }}
        />
      </div>
      {selectedPreviewUrl ? (
        // Local object URLs are not eligible for the persisted-media Image component.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.avatarSelectionPreview}
          src={selectedPreviewUrl}
          alt="Selected avatar preview"
        />
      ) : null}
      <p className="member-media-uploader__status" aria-live="polite">{status}</p>
    </div>
  );
}
