import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { describe, expect, test } from "vitest";

import { decodeQrImageData } from "../../src/features/check-in/qr-image-decoder";

function makeQrImageData(value: string) {
  const svg = renderToStaticMarkup(
    React.createElement(QRCodeSVG, {
      value,
      level: "L",
      marginSize: 4,
      size: 264,
    }),
  );
  const viewBox = svg.match(/viewBox="0 0 (\d+) \d+"/);
  const darkPath = svg.match(/fill="#000000" d="([^"]+)"/);

  if (!viewBox || !darkPath) {
    throw new Error("Could not render the QR fixture.");
  }

  const modules = Number(viewBox[1]);
  const pixelsPerModule = 8;
  const width = modules * pixelsPerModule;
  const data = new Uint8ClampedArray(width * width * 4);

  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([255, 255, 255, 255], offset);
  }

  const darkRuns = /M(\d+)\s*,?\s*(\d+)\s*h(\d+)v1H\d+z/g;
  for (const match of darkPath[1].matchAll(darkRuns)) {
    const startX = Number(match[1]);
    const y = Number(match[2]);
    const run = Number(match[3]);

    for (let x = startX; x < startX + run; x += 1) {
      for (let pixelX = 0; pixelX < pixelsPerModule; pixelX += 1) {
        for (let pixelY = 0; pixelY < pixelsPerModule; pixelY += 1) {
          const offset = ((y * pixelsPerModule + pixelY) * width + x * pixelsPerModule + pixelX) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }
  }

  return { data, width, height: width };
}

describe("QR image upload decoding", () => {
  test("reads a valid uploaded Tambike pass QR image", () => {
    const token = "tbk_uploaded_pass_fixture";
    const image = makeQrImageData(token);

    expect(decodeQrImageData(image.data, image.width, image.height)).toBe(token);
  });

  test("rejects an uploaded image that does not contain a QR code", () => {
    const width = 128;
    const blankImage = new Uint8ClampedArray(width * width * 4);
    for (let offset = 0; offset < blankImage.length; offset += 4) {
      blankImage.set([255, 255, 255, 255], offset);
    }

    expect(decodeQrImageData(blankImage, width, width)).toBeNull();
  });
});
