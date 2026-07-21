import type { MemberMediaStore } from "./store";
import {
  ALLOWED_MEMBER_IMAGE_MIME_TYPES,
  MAX_MEMBER_UPLOAD_BYTES,
  MEMBER_UPLOAD_EXPIRES_SECONDS,
  MemberMediaError,
  type MemberImageMimeType,
} from "./types";

const safeKeyComponent = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const allowedMimeTypes = new Set<string>(ALLOWED_MEMBER_IMAGE_MIME_TYPES);

export interface CreateMemberUploadPolicyInput {
  userId: string;
  nonce: string;
  mimeType: string;
}

function requireSafeKeyComponent(value: string, label: string) {
  if (!safeKeyComponent.test(value)) {
    throw new MemberMediaError(`${label} is not a safe upload key component`);
  }
}

export async function createMemberUploadPolicy(
  store: MemberMediaStore,
  input: CreateMemberUploadPolicyInput,
) {
  requireSafeKeyComponent(input.userId, "user ID");
  requireSafeKeyComponent(input.nonce, "nonce");
  if (!allowedMimeTypes.has(input.mimeType)) {
    throw new MemberMediaError("only JPEG, PNG, and WebP uploads are allowed");
  }

  const mimeType = input.mimeType as MemberImageMimeType;
  const key = `tmp/users/${input.userId}/${input.nonce}`;
  const signed = await store.createPresignedPost({
    key,
    mimeType,
    expiresInSeconds: MEMBER_UPLOAD_EXPIRES_SECONDS,
    minimumBytes: 1,
    maximumBytes: MAX_MEMBER_UPLOAD_BYTES,
  });

  return {
    key,
    mimeType,
    expiresInSeconds: MEMBER_UPLOAD_EXPIRES_SECONDS,
    ...signed,
  };
}
