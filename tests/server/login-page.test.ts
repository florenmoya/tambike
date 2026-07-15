import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import LoginPage from "../../src/app/login/page";

const loginScreenSource = readFileSync(
  resolve(process.cwd(), "src/features/tambike-demo/tambike-screen.tsx"),
  "utf8",
);

describe("LoginPage", () => {
  test.each(["/login", "/login/", "/login?next=%2Fprofile", "/login#form"])(
    "does not retain a next destination that points back to login (%s)",
    async (next) => {
    const page = (await LoginPage({
        searchParams: Promise.resolve({ next }),
    })) as { props: { nextHref?: string } };

    expect(page.props.nextHref).toBeUndefined();
    },
  );

  test("keeps a valid in-app next destination", async () => {
    const page = (await LoginPage({
      searchParams: Promise.resolve({ next: "/events/tambike-cafe-classico" }),
    })) as { props: { nextHref?: string } };

    expect(page.props.nextHref).toBe("/events/tambike-cafe-classico");
  });

  test("replaces the login page after successful password authentication", () => {
    expect(loginScreenSource).toContain(
      "window.location.replace(nextHref ?? destinationFor(user.role));",
    );
  });
});
