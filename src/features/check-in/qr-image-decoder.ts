import jsQR from "jsqr";

/**
 * Decodes the pixels read from an uploaded QR image (or a camera frame).
 * Keeping this separate from the canvas/File APIs makes the real decoder
 * regression-testable with both QR and non-QR image data.
 */
export function decodeQrImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) {
    return null;
  }

  return (
    jsQR(data, width, height, {
      inversionAttempts: "attemptBoth",
    })?.data.trim() ?? null
  );
}
