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

  test("resolves card and detail posters with component-local blur placeholders", () => {
    const card = componentSource("EventCard");
    const detail = componentSource("EventDetail");

    expect(card).toContain("const poster = resolveEventPoster(event.poster);");
    expect(detail).toContain(
      "const poster = resolveEventPoster(event.poster);",
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
  });
});
