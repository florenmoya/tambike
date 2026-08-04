import { describe, expect, test } from "vitest";
import LoginPage from "../../src/app/login/page";

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
});
