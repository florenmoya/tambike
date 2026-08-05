import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  ProfileLoadingFeedback,
  TambikeLoadingWheel,
} from "../../src/components/tambike-loading-feedback";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Tambike loading feedback", () => {
  test("renders the branded wheel as decorative artwork", () => {
    const markup = renderToStaticMarkup(<TambikeLoadingWheel />);

    expect(markup).toContain('data-tambike-loading-wheel="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/data-wheel-spoke=/g)).toHaveLength(4);
    expect(markup).toContain('data-wheel-hub="true"');
  });

  test("renders an accessible compact profile loading status", () => {
    const markup = renderToStaticMarkup(<ProfileLoadingFeedback />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Getting your garage ready…");
    expect(markup).toContain("Loading your profile and motorcycle details.");
  });

  test("uses the branded profile status without changing the error alert", () => {
    const profileSource = source("src/features/member-profiles/profile-settings.tsx");

    expect(profileSource).toContain("<ProfileLoadingFeedback />");
    expect(profileSource).not.toContain("Loading garage settings…");
    expect(profileSource).toContain(
      '<p className="profile-settings-load" role="alert">{loadError}</p>',
    );
  });
});
