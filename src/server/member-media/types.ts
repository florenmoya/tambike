export const ALLOWED_MEMBER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type MemberImageMimeType = (typeof ALLOWED_MEMBER_IMAGE_MIME_TYPES)[number];
export type MemberImagePurpose = "avatar" | "motorcycle-photo";

export const MAX_MEMBER_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MEMBER_UPLOAD_EXPIRES_SECONDS = 5 * 60;

export class MemberMediaError extends Error {
  readonly code = "INVALID_IMAGE" as const;

  constructor(message: string) {
    super(`INVALID_IMAGE: ${message}`);
    this.name = "MemberMediaError";
  }
}

export interface NormalizedMemberImage {
  bytes: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
}
