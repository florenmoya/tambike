import sharp from "sharp";
import { describe, expect, test } from "vitest";

import {
  MAX_MEMBER_UPLOAD_BYTES,
  type MemberImageMimeType,
} from "../../src/server/member-media/types";
import { normalizeMemberImage } from "../../src/server/member-media/image-normalizer";

async function raster(
  format: "jpeg" | "png" | "webp",
  width = 640,
  height = 480,
) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 18, g: 86, b: 120 },
    },
  })
    [format]({ quality: 90 })
    .toBuffer();
}

describe("member image normalization", () => {
  test.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("accepts a decoded %s matching %s", async (format, mimeType) => {
    const result = await normalizeMemberImage({
      body: await raster(format),
      claimedMimeType: mimeType,
      purpose: "motorcycle-photo",
    });

    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 640,
      height: 480,
    });
  });

  test("rejects a claimed MIME that does not match the decoded signature", async () => {
    const png = await raster("png");

    await expect(
      normalizeMemberImage({
        body: png,
        claimedMimeType: "image/jpeg",
        purpose: "avatar",
      }),
    ).rejects.toThrow("INVALID_IMAGE");
  });

  test("rejects malformed bytes and unsupported SVG/GIF signatures", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64",
    );

    for (const body of [Buffer.from("not-an-image"), svg, gif]) {
      await expect(
        normalizeMemberImage({
          body,
          claimedMimeType: "image/jpeg",
          purpose: "avatar",
        }),
      ).rejects.toThrow("INVALID_IMAGE");
    }

    for (const claimedMimeType of ["image/svg+xml", "image/gif"]) {
      await expect(
        normalizeMemberImage({
          body: claimedMimeType === "image/gif" ? gif : svg,
          claimedMimeType,
          purpose: "avatar",
        }),
      ).rejects.toThrow("INVALID_IMAGE");
    }
  });

  test("rejects input over 8 MiB after reading no more than max plus one byte", async () => {
    let chunksRead = 0;
    async function* oversizedBody() {
      chunksRead += 1;
      yield Buffer.alloc(MAX_MEMBER_UPLOAD_BYTES);
      chunksRead += 1;
      yield Buffer.alloc(1);
      chunksRead += 1;
      throw new Error("normalizer consumed beyond its bounded read");
    }

    await expect(
      normalizeMemberImage({
        body: oversizedBody(),
        claimedMimeType: "image/jpeg",
        purpose: "avatar",
      }),
    ).rejects.toThrow("INVALID_IMAGE");
    expect(chunksRead).toBe(2);

    await expect(
      normalizeMemberImage({
        body: Buffer.alloc(MAX_MEMBER_UPLOAD_BYTES + 1),
        claimedMimeType: "image/jpeg",
        purpose: "avatar",
      }),
    ).rejects.toThrow("INVALID_IMAGE");
  });

  test("creates an exact centered 512 by 512 avatar cover", async () => {
    const result = await normalizeMemberImage({
      body: await raster("jpeg", 1_200, 600),
      claimedMimeType: "image/jpeg",
      purpose: "avatar",
    });

    expect({ width: result.width, height: result.height }).toEqual({
      width: 512,
      height: 512,
    });
  });

  test("fits motorcycle photos within 1600 by 1200 without enlargement", async () => {
    const large = await normalizeMemberImage({
      body: await raster("png", 3_000, 2_000),
      claimedMimeType: "image/png",
      purpose: "motorcycle-photo",
    });
    expect({ width: large.width, height: large.height }).toEqual({
      width: 1_600,
      height: 1_067,
    });

    const small = await normalizeMemberImage({
      body: await raster("webp", 320, 200),
      claimedMimeType: "image/webp",
      purpose: "motorcycle-photo",
    });
    expect({ width: small.width, height: small.height }).toEqual({
      width: 320,
      height: 200,
    });
  });

  test("applies EXIF orientation and strips EXIF/GPS from output", async () => {
    const source = await sharp({
      create: {
        width: 10,
        height: 20,
        channels: 3,
        background: "#ffbe45",
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: "Tambike test rider" },
        IFD3: {
          GPSLatitude: "14/1 35/1 0/1",
          GPSLongitude: "121/1 0/1 0/1",
        },
      })
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const result = await normalizeMemberImage({
      body: source,
      claimedMimeType: "image/jpeg",
      purpose: "motorcycle-photo",
    });
    const metadata = await sharp(result.bytes).metadata();

    expect({ width: result.width, height: result.height }).toEqual({
      width: 20,
      height: 10,
    });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
  });

  test("uses deterministic WebP encoding options", async () => {
    const body = await raster("jpeg", 900, 600);
    const input = {
      body,
      claimedMimeType: "image/jpeg" as MemberImageMimeType,
      purpose: "motorcycle-photo" as const,
    };

    const first = await normalizeMemberImage(input);
    const second = await normalizeMemberImage(input);

    expect(first.bytes.equals(second.bytes)).toBe(true);
  });
});
