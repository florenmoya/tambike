"use client";

import { useId, useState } from "react";
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

function uploadMessage(error: unknown) {
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
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const isMotorcyclePhoto = purpose === "motorcycle-photo";
  const photoLimitReached = isMotorcyclePhoto && photos.length >= 5;
  const label = isMotorcyclePhoto ? "Motorcycle photo" : "Avatar photo";

  const upload = async () => {
    if (!file || photoLimitReached) return;
    setPending(true);
    setStatus("Preparing secure upload…");

    try {
      const presignResponse = await fetch("/api/member-media/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, mimeType: file.type }),
      });
      if (!presignResponse.ok) throw new Error("INVALID_IMAGE");
      const presign = (await presignResponse.json()) as PresignedUpload;

      const uploadData = new FormData();
      for (const [name, value] of Object.entries(presign.fields)) {
        uploadData.append(name, value);
      }
      uploadData.append("file", file);

      setStatus("Uploading image…");
      const uploadResponse = await fetch(presign.url, {
        method: "POST",
        body: uploadData,
      });
      if (!uploadResponse.ok) throw new Error("UPLOAD_UNAVAILABLE");

      setStatus("Finishing image…");
      await finalizeMemberMediaAction({
        purpose,
        tempKey: presign.key,
        claimedMimeType: presign.mimeType,
        motorcyclePhotoPosition: isMotorcyclePhoto ? photos.length : undefined,
      });
      await onUploaded();
      setFile(null);
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
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={purpose === "motorcycle-photo" && photos.length >= 5}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setStatus("");
          }}
        />
        <Button type="button" onClick={upload} disabled={!file || pending || photoLimitReached}>
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
