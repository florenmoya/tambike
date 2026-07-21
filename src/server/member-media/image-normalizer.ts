import sharp from "sharp";

import type { MemberMediaBody } from "./store";
import {
  ALLOWED_MEMBER_IMAGE_MIME_TYPES,
  MAX_MEMBER_UPLOAD_BYTES,
  MemberMediaError,
  type MemberImageMimeType,
  type MemberImagePurpose,
  type NormalizedMemberImage,
} from "./types";

const decodedFormatMime = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
const allowedMimeTypes = new Set<string>(ALLOWED_MEMBER_IMAGE_MIME_TYPES);
const MAX_INPUT_PIXELS = 64_000_000;

export interface NormalizeMemberImageInput {
  body: MemberMediaBody;
  claimedMimeType: string;
  purpose: MemberImagePurpose;
}

async function readBoundedBody(body: MemberMediaBody) {
  if (body instanceof Uint8Array) {
    if (body.byteLength > MAX_MEMBER_UPLOAD_BYTES) {
      throw new MemberMediaError("image exceeds the 8 MiB upload limit");
    }
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const bytesToRead = Math.min(
      bytes.byteLength,
      MAX_MEMBER_UPLOAD_BYTES + 1 - totalBytes,
    );
    if (bytesToRead > 0) {
      chunks.push(bytes.subarray(0, bytesToRead));
      totalBytes += bytesToRead;
    }
    if (totalBytes > MAX_MEMBER_UPLOAD_BYTES) {
      throw new MemberMediaError("image exceeds the 8 MiB upload limit");
    }
  }

  return Buffer.concat(chunks, totalBytes);
}

function invalidImage(message: string, cause?: unknown): never {
  const error = new MemberMediaError(message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  throw error;
}

export async function normalizeMemberImage(
  input: NormalizeMemberImageInput,
): Promise<NormalizedMemberImage> {
  if (!allowedMimeTypes.has(input.claimedMimeType)) {
    invalidImage("only JPEG, PNG, and WebP images are allowed");
  }
  if (input.purpose !== "avatar" && input.purpose !== "motorcycle-photo") {
    invalidImage("image purpose is invalid");
  }

  const bytes = await readBoundedBody(input.body);
  let decodedFormat: keyof typeof decodedFormatMime;
  try {
    const metadata = await sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    if (!(metadata.format in decodedFormatMime)) {
      invalidImage("decoded image format is not supported");
    }
    decodedFormat = metadata.format as keyof typeof decodedFormatMime;
  } catch (error) {
    if (error instanceof MemberMediaError) throw error;
    invalidImage("image bytes could not be decoded", error);
  }

  const claimedMimeType = input.claimedMimeType as MemberImageMimeType;
  if (decodedFormatMime[decodedFormat] !== claimedMimeType) {
    invalidImage("claimed MIME type does not match the image signature");
  }

  try {
    const pipeline = sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate();

    if (input.purpose === "avatar") {
      pipeline.resize({
        width: 512,
        height: 512,
        fit: "cover",
        position: "centre",
      });
    } else {
      pipeline.resize({
        width: 1_600,
        height: 1_200,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const { data, info } = await pipeline
      .webp({
        quality: 82,
        alphaQuality: 100,
        lossless: false,
        nearLossless: false,
        smartSubsample: true,
        effort: 6,
        preset: "photo",
      })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      mimeType: "image/webp",
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof MemberMediaError) throw error;
    invalidImage("image normalization failed", error);
  }
}
