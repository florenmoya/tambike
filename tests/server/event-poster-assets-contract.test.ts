import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const data = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/data.ts"),
  "utf8",
);
const resolver = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/event-poster-assets.ts"),
  "utf8",
);
const screen = readFileSync(
  join(process.cwd(), "src/features/tambike-demo/tambike-screen.tsx"),
  "utf8",
);

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

  test("resolves posters for cards and details with static-image blur placeholders", () => {
    expect(screen.match(/const poster = resolveEventPoster\(event\.poster\);/g)).toHaveLength(
      2,
    );
    expect(screen).toContain(
      'placeholder={typeof poster === "string" ? "empty" : "blur"}',
    );
  });

  test("preloads the detail poster while cards retain selective loading", () => {
    expect(screen).toMatch(/function EventDetail[\s\S]*?preload/);
    expect(screen).toMatch(
      /function EventCard[\s\S]*?loading=\{priority \? "eager" : "lazy"\}/,
    );
    expect(screen).toMatch(
      /function EventCard[\s\S]*?fetchPriority=\{priority \? "high" : "auto"\}/,
    );
  });
});
