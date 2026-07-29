import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, test } from "vitest";

const data = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/data.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const resolver = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/event-poster-assets.ts"),
  "utf8",
);
const screen = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/tambike-screen.tsx"),
  "utf8",
);

function componentSource(componentName: string) {
  const start = screen.indexOf(`function ${componentName}(`);
  const nextComponent = screen.indexOf("\nfunction ", start + 1);

  expect(start).toBeGreaterThanOrEqual(0);

  return screen.slice(start, nextComponent === -1 ? undefined : nextComponent);
}

describe("event poster asset contract", () => {
  test("maps every bundled event poster to a static image asset", () => {
    const posterPaths = [...data.matchAll(/poster:\s*"([^"]+\.jpg)"/g)].map(
      (match) => match[1],
    );

    expect(posterPaths.length).toBeGreaterThan(0);

    for (const posterPath of posterPaths) {
      expect(resolver).toContain(`"${posterPath}":`);
      expect(
        existsSync(join(process.cwd(), "public", posterPath.replace(/^\//, ""))),
      ).toBe(true);
    }

    expect(resolver).toContain(
      "return EVENT_POSTER_ASSETS[posterPath] ?? posterPath",
    );
  });

  test("resolves every discovery and detail poster with component-local blur placeholders", () => {
    const feature = componentSource("FeatureCard");
    const card = componentSource("EventCard");
    const detail = componentSource("EventDetail");

    expect(feature).toContain(
      "const poster = resolveEventPoster(event.poster);",
    );
    expect(card).toContain("const poster = resolveEventPoster(event.poster);");
    expect(detail).toContain(
      "const poster = resolveEventPoster(event.poster);",
    );
    expect(feature).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
    expect(card).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
    expect(detail).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
  });

  test("preloads the detail poster while cards retain selective loading", () => {
    const card = componentSource("EventCard");
    const detail = componentSource("EventDetail");

    expect(detail).toContain("preload");
    expect(card).toContain(
      'loading={priority ? "eager" : "lazy"}',
    );
    expect(card).toContain(
      'fetchPriority={priority ? "high" : "auto"}',
    );
    expect(detail).toContain(
      'sizes="(max-width: 640px) 72px, 220px"',
    );
  });

  test("keeps the Cafe Classico poster lightweight and free of embedded profiles", async () => {
    const posterPath = join(
      process.cwd(),
      "public/demo/poster-tambike-cafe-classico.jpg",
    );
    const metadata = await sharp(posterPath).metadata();

    expect(statSync(posterPath).size).toBeLessThan(200_000);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);
    expect(metadata.hasProfile).toBe(false);
  });

  test("uses one patched Sharp runtime for the app and Next image pipeline", () => {
    expect(packageJson.dependencies?.sharp).toBe("0.35.3");
    expect(
      (packageJson as { overrides?: Record<string, string> }).overrides?.sharp,
    ).toBe("0.35.3");
  });
});
