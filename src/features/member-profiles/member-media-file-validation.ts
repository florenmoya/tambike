const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
