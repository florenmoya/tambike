import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

const skipTestReset = process.env.TAMBIKE_SKIP_TEST_RESET === "true";

test.beforeAll(() => {
  if (process.env.TAMBIKE_BACKEND === "memory" || skipTestReset) {
    return;
  }

  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    stdio: "inherit",
  });
});

test.beforeEach(async ({ request }) => {
  if (process.env.TAMBIKE_BACKEND !== "memory" || skipTestReset) {
    return;
  }

  const response = await request.post("/api/test/reset");
  expect(response.ok()).toBeTruthy();
});

const accountCredentials = {
  rider: "mina.rider@example.com",
  organizer: "marco.organizer@example.com",
  venue: "ana.venue@example.com",
  admin: "admin@bayanko.ph",
} as const;

const accountPasswords = {
  rider: "password123",
  organizer: "password123",
  venue: "password123",
  admin: "secret_123",
} as const;

async function logInAs(page: Page, role: keyof typeof accountCredentials) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/Email/i).fill(accountCredentials[role]);
  await page.getByLabel(/Password/i).fill(accountPasswords[role]);
  await page.getByRole("button", { name: /^Log in$/i }).click();
}

test("event discovery highlights the simple tambike sample", async ({ page }) => {
  await page.goto("/events");

  await expect(page.locator(".feature-card.is-featured h2")).toHaveText("Tambike at Cafe Classico");
  await expect(page.locator(".feature-card.is-featured p")).toHaveText("Every Saturday · Davao City");
  await expect(page.locator(".feature-card.is-featured img")).toHaveAttribute(
    "src",
    /poster-tambike-cafe-classico/,
  );
});

test("arai charity event uses the sourced organizer poster", async ({ page }) => {
  await page.goto("/events/arai-hjc-charity-ride");

  await expect(page.getByAltText("ARAI HJC Charity Ride poster").first()).toHaveAttribute(
    "src",
    /poster-arai-hjc-charity-ride\.jpg/,
  );
});

test("featured event carousel tire controls highlight the next small-bike cover", async ({ page }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const featuredTitle = page.locator(".feature-card.is-featured h2");
  const carousel = page.locator(".featured-carousel");
  const nextButton = page.getByRole("button", { name: "Next featured event" });
  await expect(featuredTitle).toHaveText("Tambike at Cafe Classico");
  await expect(carousel).toHaveAttribute("data-ready", "true");

  await nextButton.click();
  await expect(featuredTitle).toHaveText("Boys of Underbone Laguna Tambike");

  await expect(carousel.locator(".wheel-button")).toHaveCount(2);
  await expect(carousel.locator(".slider-button")).toHaveCount(2);
  await expect(carousel.locator(".wheel-direction")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous featured event" })).toBeVisible();
  await expect(nextButton).toBeVisible();
  await expect(carousel.locator(".slider-button svg")).toHaveCount(0);
});

test("featured event carousel tire controls share a temporary clicked direction", async ({ page }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const carousel = page.locator(".featured-carousel");
  const wheels = carousel.locator(".wheel-face");
  await expect(carousel).toHaveAttribute("data-ready", "true");
  await expect(carousel).toHaveAttribute("data-wheel-direction", "next");
  await expect(wheels).toHaveCount(2);
  await expect(wheels.first()).toHaveCSS("animation-name", "wheel-roll-right");
  await expect(wheels.nth(1)).toHaveCSS("animation-name", "wheel-roll-right");

  await page.getByRole("button", { name: "Next featured event" }).click();
  await expect(carousel).toHaveAttribute("data-wheel-direction", "next");
  await expect(carousel).toHaveClass(/is-wheel-bursting/);
  await expect(wheels.first()).toHaveCSS("animation-name", "wheel-roll-right");
  await expect(wheels.nth(1)).toHaveCSS("animation-name", "wheel-roll-right");

  await page.getByRole("button", { name: "Previous featured event" }).click();

  await expect(carousel).toHaveAttribute("data-wheel-direction", "previous");
  await expect(carousel).toHaveClass(/is-wheel-bursting/);
  await expect(wheels.first()).toHaveCSS("animation-name", "wheel-roll-left");
  await expect(wheels.nth(1)).toHaveCSS("animation-name", "wheel-roll-left");

  await expect(carousel).toHaveAttribute("data-wheel-direction", "next", { timeout: 4_000 });
  await expect(carousel).not.toHaveClass(/is-wheel-bursting/);
  await expect(wheels.first()).toHaveCSS("animation-name", "wheel-roll-right");
  await expect(wheels.nth(1)).toHaveCSS("animation-name", "wheel-roll-right");
});

test("featured event carousel drags left to highlight the next small-bike cover", async ({ page, isMobile }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const carousel = page.locator(".featured-carousel");
  const showcase = page.locator(".hero-showcase");
  const featuredTitle = page.locator(".feature-card.is-featured h2");

  await expect(featuredTitle).toHaveText("Tambike at Cafe Classico");
  await expect(carousel).toHaveAttribute("data-ready", "true");

  const showcaseBox = await showcase.boundingBox();
  expect(showcaseBox).not.toBeNull();
  if (!showcaseBox) return;

  const startX = showcaseBox.x + showcaseBox.width / 2;
  const startY = showcaseBox.y + showcaseBox.height / 2;
  if (isMobile) {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY, id: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX - 180, y: startY, id: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 180, startY, { steps: 6 });
    await page.mouse.up();
  }

  await expect(featuredTitle).toHaveText("Boys of Underbone Laguna Tambike", { timeout: 1_500 });
});

test("featured event carousel reveals balanced outer cards on large screens", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const widePeek = page.locator(".feature-card.is-wide-peek");
  await expect(widePeek).toHaveCount(2);

  const boxes = await widePeek.evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      return {
        opacity: getComputedStyle(card).opacity,
        x: box.x,
        right: box.x + box.width,
      };
    }),
  );

  expect(boxes).toHaveLength(2);
  for (const box of boxes) {
    expect(box.opacity).toBe("0.28");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(2048);
  }
});

test("featured event carousel buffers incoming cards on the right side", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const carousel = page.locator(".featured-carousel");
  const nextButton = page.getByRole("button", { name: "Next featured event" });
  await expect(carousel).toHaveAttribute("data-ready", "true");

  const cardState = async (title: string) =>
    carousel.locator(".feature-card").filter({ hasText: title }).evaluate((card) => {
      const box = card.getBoundingClientRect();
      return {
        centerX: box.x + box.width / 2,
        opacity: Number(getComputedStyle(card).opacity),
        viewportCenterX: window.innerWidth / 2,
      };
    });

  const incomingBefore = await cardState("Tambike Night");
  expect(incomingBefore.centerX).toBeGreaterThan(incomingBefore.viewportCenterX);
  expect(incomingBefore.opacity).toBe(0);

  await nextButton.click();
  await expect(page.locator(".feature-card.is-featured h2")).toHaveText(
    "Boys of Underbone Laguna Tambike",
  );

  await expect
    .poll(async () => {
      const incomingAfter = await cardState("Tambike Night");
      return (
        incomingAfter.centerX > incomingAfter.viewportCenterX &&
        incomingAfter.opacity === 0.28
      );
    })
    .toBe(true);
});

test("featured event carousel loops wrapped cards forward from tire control", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const carousel = page.locator(".featured-carousel");
  const featuredTitle = page.locator(".feature-card.is-featured h2");
  const nextButton = page.getByRole("button", { name: "Next featured event" });
  await expect(featuredTitle).toHaveText("Tambike at Cafe Classico");
  await expect(carousel).toHaveAttribute("data-ready", "true");
  await expect(nextButton).toBeVisible();

  for (let step = 0; step < 5; step += 1) {
    await nextButton.click();
  }

  await expect(featuredTitle).toHaveText("FullPrint Manila Tambike");

  const cardCenterX = async (title: string) => {
    const box = await carousel.locator(".feature-card").filter({ hasText: title }).boundingBox();
    return box ? box.x + box.width / 2 : Number.NaN;
  };

  await expect
    .poll(async () => {
      const carouselBox = await carousel.boundingBox();
      const activeCenter = await cardCenterX("FullPrint Manila Tambike");
      const nightCenter = await cardCenterX("Tambike Night");
      const cebuCenter = await cardCenterX("CCPH Cebu Official Tambike");
      const garageCenter = await cardCenterX("Boys of Garage Crossmeet Tambike");
      const swabzCenter = await cardCenterX("Swabz Classic Bike Tambike");
      const ylocoCenter = await cardCenterX("Yloco Bandits Classic Tambike");
      const upperEastCenter = await cardCenterX("CCPH Upper East Tambike");

      return (
        Boolean(carouselBox) &&
        Number.isFinite(activeCenter) &&
        Math.abs(activeCenter - ((carouselBox?.x ?? 0) + (carouselBox?.width ?? 0) / 2)) <= 2 &&
        nightCenter < activeCenter &&
        cebuCenter < nightCenter &&
        upperEastCenter < cebuCenter &&
        garageCenter > activeCenter &&
        swabzCenter > garageCenter &&
        ylocoCenter > swabzCenter
      );
    })
    .toBe(true);
});

test("featured event carousel prioritizes small-bike tambike covers", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const carousel = page.locator(".featured-carousel");
  await expect(carousel).toHaveAttribute("data-ready", "true");

  await expect(carousel.locator(".feature-card h2")).toHaveText([
    "Tambike at Cafe Classico",
    "Boys of Underbone Laguna Tambike",
    "CCPH Upper East Tambike",
    "CCPH Cebu Official Tambike",
    "Tambike Night",
    "FullPrint Manila Tambike",
    "Boys of Garage Crossmeet Tambike",
    "Swabz Classic Bike Tambike",
    "Yloco Bandits Classic Tambike",
    "Kape Mo-To Tagaytay Tambike",
  ]);
  await expect(page.getByAltText("Boys of Underbone Laguna Tambike poster").first()).toHaveAttribute(
    "src",
    /poster-boys-underbone-laguna-tambike\.jpg/,
  );
  await expect(page.getByAltText("CCPH Cebu Official Tambike poster").first()).toHaveAttribute(
    "src",
    /poster-ccph-cebu-official-tambike\.jpg/,
  );
});

test("featured event title keeps the final place phrase together", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const featuredTitle = page.locator(".feature-card.is-featured h2");
  await expect(featuredTitle).toHaveText("Tambike at Cafe Classico");

  const phraseLineOffset = await featuredTitle.evaluate((heading) => {
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    let textNode: Text | null = null;

    while (currentNode) {
      if (currentNode.textContent?.includes("Cafe") && currentNode.textContent.includes("Classico")) {
        textNode = currentNode as Text;
        break;
      }

      currentNode = walker.nextNode();
    }

    if (!textNode?.textContent) return Number.POSITIVE_INFINITY;

    const text = textNode.textContent;
    const cafeStart = text.indexOf("Cafe");
    const classicoStart = text.indexOf("Classico");
    if (cafeStart === -1 || classicoStart === -1) return Number.POSITIVE_INFINITY;

    const measure = (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0);
      range.detach();
      return rect;
    };

    const cafeRect = measure(cafeStart, cafeStart + "Cafe".length);
    const classicoRect = measure(classicoStart, classicoStart + "Classico".length);
    if (!cafeRect || !classicoRect) return Number.POSITIVE_INFINITY;

    return Math.abs(classicoRect.top - cafeRect.top);
  });

  expect(phraseLineOffset).toBeLessThan(4);
});

test("event categories sit directly after carousel without a driving wheel", async ({ page }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".featured-carousel + .category-strip")).toBeVisible();
  await expect(page.getByRole("group", { name: "Interactive driving wheel" })).toHaveCount(0);
});

test("event controls use raised rider dashboard styling", async ({ page }) => {
  await page.goto("/events");

  const tambikeShortcut = page.locator(".category-strip a[href*='type=tambike']").first();
  const shortcutIcon = tambikeShortcut.locator(".cat-icon");
  await expect(shortcutIcon).toHaveCSS("transform-style", "preserve-3d");
  await expect(shortcutIcon).toHaveCSS("border-top-style", "solid");
  await expect(shortcutIcon).toHaveCSS("border-bottom-style", "solid");

  const activeFilter = page.locator(".category-strip a.is-active");
  await expect(activeFilter).toHaveCSS("transform-style", "preserve-3d");
  await expect(activeFilter).toHaveCSS("border-top-style", "solid");
  await expect(activeFilter).toHaveCSS("border-bottom-style", "solid");
});

test("event categories sit below carousel and filter only listings", async ({ page }) => {
  await page.goto("/events");

  const categories = page.locator(".category-strip");
  await expect(page.locator(".featured-carousel + .category-strip")).toBeVisible();
  await expect(categories).toHaveCSS("background-image", "none");
  await expect(categories).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(categories).toHaveCSS("border-top-style", "none");
  await expect(categories).toHaveCSS("box-shadow", "none");
  await expect(categories.getByRole("link", { name: "All" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Tambike" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Charity" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Track Day" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Endurance" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Race" })).toBeVisible();
  await expect(categories.getByRole("link", { name: "Moto Expo" })).toBeVisible();

  await categories.getByRole("link", { name: "Charity" }).click();
  await expect(page).toHaveURL(/\/events\?type=charity-ride$/);
  await expect(page.locator(".category-strip .is-active")).toHaveText("Charity");
  await expect(page.locator(".feature-card.is-featured h2")).toHaveText("Tambike at Cafe Classico");
  await expect(page.locator(".event-grid .event-card h3")).toHaveCount(0);
});

test("tambike filter uses multiple real sourced meet-up covers", async ({ page }) => {
  await page.goto("/events?type=tambike");

  await expect(page.locator(".feature-card.is-featured h2")).toHaveText("Tambike at Cafe Classico");
  await expect(page.locator(".category-strip .is-active")).toHaveText("Tambike");
  await expect(page.locator(".event-grid .event-card h3")).toHaveText([
    "Tambike at Cafe Classico",
    "Tambike Night",
    "Boys of Underbone Laguna Tambike",
    "Swabz Classic Bike Tambike",
    "Yloco Bandits Classic Tambike",
    "Kape Mo-To Tagaytay Tambike",
    "FullPrint Manila Tambike",
    "Boys of Garage Crossmeet Tambike",
    "CCPH Upper East Tambike",
    "CCPH Cebu Official Tambike",
  ]);
  await expect(page.getByAltText("Tambike Night poster").first()).toHaveAttribute(
    "src",
    /poster-tambike-night-malabon\.jpg/,
  );
  await expect(page.getByAltText("Boys of Underbone Laguna Tambike poster").first()).toHaveAttribute(
    "src",
    /poster-boys-underbone-laguna-tambike\.jpg/,
  );
  await expect(page.getByAltText("FullPrint Manila Tambike poster").first()).toHaveAttribute(
    "src",
    /poster-fullprint-manila-tambike\.jpg/,
  );
});

test("all events secondary grid fills three desktop rows", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1400 });
  await page.goto("/events");

  const secondaryCards = page.locator(".event-grid-secondary .event-card");
  await expect(secondaryCards).toHaveCount(15);
  await expect(secondaryCards.locator("h3")).toContainText([
    "Laguna MotoFest 2026",
    "NGO Street Drag Final",
    "IR Philippine Endurance RD3",
    "Mindanao Wide Motocross 2nd Leg",
    "Boys of Garage Crossmeet Tambike",
    "CCPH Upper East Tambike",
    "CCPH Cebu Official Tambike",
  ]);
  await expect(page.getByAltText("Laguna MotoFest 2026 poster").first()).toHaveAttribute(
    "src",
    /poster-laguna-motofest-2026\.jpg/,
  );
  await expect(page.getByAltText("CALABARZON Endurance Ride poster").first()).toHaveAttribute(
    "src",
    /poster-calabarzon-endurance-ride\.jpg/,
  );
  await expect(page.getByAltText("Mindanao Wide Motocross 2nd Leg poster").first()).toHaveAttribute(
    "src",
    /poster-mindanao-wide-motocross-2026-2nd-leg\.jpg/,
  );

  const titles = await page.locator(".listings .event-card h3").allTextContents();
  expect(new Set(titles).size).toBe(titles.length);
});

test("event filter pills navigate to useful event sets", async ({ page }) => {
  await page.goto("/events");

  await page.locator(".category-strip").getByRole("link", { name: "Race" }).click();

  await expect(page).toHaveURL(/\/events\?type=race$/);
  await expect(page.locator(".category-strip .is-active")).toHaveText("Race");
  await expect(page.locator(".feature-card.is-featured h2")).toHaveText("Tambike at Cafe Classico");
  await expect(page.locator(".event-grid .event-card h3")).toHaveText([
    "MotoIR National Round 5",
    "Motul MotoIR Youth Cup Races 15-16",
    "Petron SGP Round 3",
    "NGO Street Drag Final",
    "Mindanao Wide Motocross 2nd Leg",
    "MotoIR National Round 4",
  ]);
});

test("header uses simplified rider brand without country pill", async ({ page }) => {
  await page.goto("/events");

  await expect(page.getByRole("button", { name: "Philippines" })).toHaveCount(0);
  await expect(page.getByLabel("Tambike home")).toBeVisible();

  const brandMark = page.locator(".brand-mark").first();
  await expect(brandMark).toHaveCSS("transform-style", "preserve-3d");
  await expect(brandMark).toHaveCSS("border-bottom-style", "solid");
});

test("events page includes redesigned Tambike footer shortcuts", async ({ page }) => {
  await page.goto("/events");

  const footer = page.getByRole("contentinfo", { name: "Tambike footer" });
  await expect(footer).toBeVisible();
  await expect(footer.getByText("Ride bulletin")).toBeVisible();
  await expect(footer.getByText("Built for tambike nights, charity rides, track days, and venue-hosted motorcycle ganaps.")).toBeVisible();
  await expect(footer.getByText(/Next checkpoint|Pass flow, event review|Featured ride/i)).toHaveCount(0);
  await expect(footer.getByText(/Mock/i)).toHaveCount(0);
  await expect(footer.getByRole("navigation", { name: "Footer event links" }).getByRole("link", { name: "Explore events" })).toHaveAttribute("href", "/events");
  await expect(footer.getByRole("navigation", { name: "Footer rider links" }).getByRole("link", { name: "My passes" })).toHaveAttribute("href", "/passes");
  await expect(footer.getByRole("navigation", { name: "Footer organizer links" }).getByRole("link", { name: "Create event" })).toHaveAttribute("href", "/organizer/events/create");
  await expect(footer.locator(".footer-gauge")).toHaveCSS("border-bottom-style", "solid");
});

test("guest header nav avoids duplicate auth links and matches dashboard controls", async ({ page }) => {
  await page.goto("/events");

  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
  }

  const guestNav = page.getByRole("navigation", { name: /Guest navigation/i });
  await expect(guestNav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(guestNav.getByRole("link", { name: "Explore" })).toBeVisible();
  await expect(guestNav.getByRole("link", { name: "Log In" })).toHaveCount(0);
  await expect(guestNav.getByRole("link", { name: "Sign Up" })).toHaveCount(0);
  await expect(guestNav).toHaveCSS("transform-style", "preserve-3d");
  await expect(guestNav).toHaveCSS("border-bottom-style", "solid");
});

test("secondary pages use the same guest site navigation as event discovery", async ({
  page,
}) => {
  const routes = ["/login", "/events/tambike-cafe-classico"] as const;

  for (const route of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });

    const header = page.locator(".site-header");
    await expect(header).toHaveAttribute("data-role", "guest");
    await expect(page.getByLabel("Tambike home")).toBeVisible();
    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    if (await openNavigation.isVisible()) {
      await openNavigation.click();
    }

    await expect(
      page.getByRole("navigation", { name: /Guest navigation/i }).getByRole("link", {
        name: "Home",
      }),
    ).toHaveAttribute("href", "/home");
    await expect(
      page.getByRole("navigation", { name: /Guest navigation/i }).getByRole("link", {
        name: "Explore",
      }),
    ).toHaveAttribute("href", "/events");
    await expect(page.getByRole("link", { name: "Host an Event" })).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) > 640) {
      await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
    }
    await expect(page.locator(".buy-topbar")).toHaveCount(0);
    await expect(page.locator(".event-detail-topbar")).toHaveCount(0);
  }
});

test("mobile app pages keep navigation compact without internal overflow", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "mobile responsiveness regression");

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const loginHeaderBox = await page.locator(".site-header").boundingBox();
  expect(loginHeaderBox).not.toBeNull();
  expect(loginHeaderBox?.height).toBeLessThanOrEqual(76);
  await expect(page.locator(".buy-topbar")).toHaveCount(0);

  await page.goto("/events/tambike-cafe-classico", { waitUntil: "domcontentloaded" });
  const detailHeaderBox = await page.locator(".site-header").boundingBox();
  expect(detailHeaderBox).not.toBeNull();
  expect(detailHeaderBox?.height).toBeLessThanOrEqual(76);
  await expect(page.locator(".event-detail-topbar")).toHaveCount(0);

  const overflowingDetailSelectors = await page.evaluate(() =>
    [".event-detail-shell", ".event-detail-stage", ".event-detail-poster-stack"].filter(
      (selector) => {
        const element = document.querySelector(selector);
        return element ? element.scrollWidth > element.clientWidth + 1 : false;
      },
    ),
  );
  expect(overflowingDetailSelectors).toEqual([]);
});

test("mobile discovery controls stay compact and clear the featured poster", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "mobile responsiveness regression");

  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const searchInputBox = await page.locator(".event-search input").boundingBox();
  const searchButtonBox = await page.locator(".event-search button").boundingBox();
  expect(searchInputBox).not.toBeNull();
  expect(searchButtonBox).not.toBeNull();
  expect(searchButtonBox?.width).toBeLessThanOrEqual(120);
  const searchInputCenterY = (searchInputBox?.y ?? 0) + (searchInputBox?.height ?? 0) / 2;
  const searchButtonCenterY = (searchButtonBox?.y ?? 0) + (searchButtonBox?.height ?? 0) / 2;
  expect(Math.abs(searchButtonCenterY - searchInputCenterY)).toBeLessThanOrEqual(3);

  const featuredCoverBox = await page
    .locator(".feature-card.is-featured .feature-cover")
    .boundingBox();
  const previousButtonBox = await page.locator(".slider-prev").boundingBox();
  const nextButtonBox = await page.locator(".slider-next").boundingBox();
  expect(featuredCoverBox).not.toBeNull();
  expect(previousButtonBox).not.toBeNull();
  expect(nextButtonBox).not.toBeNull();

  if (!featuredCoverBox || !previousButtonBox || !nextButtonBox) return;

  expect(previousButtonBox.x + previousButtonBox.width).toBeLessThanOrEqual(
    featuredCoverBox.x - 4,
  );
  expect(nextButtonBox.x).toBeGreaterThanOrEqual(
    featuredCoverBox.x + featuredCoverBox.width + 4,
  );
});

test("mobile event listings continue across primary and secondary grids", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "mobile listing regression");

  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const listingRows = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".listings .event-card"));
    return cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        title: card.querySelector("h3")?.textContent?.trim(),
        y: Math.round(rect.y),
      };
    });
  });

  const calabarzonCard = listingRows.find((card) =>
    card.title?.includes("CALABARZON Endurance Ride"),
  );
  const lagunaCard = listingRows.find((card) =>
    card.title?.includes("Laguna MotoFest 2026"),
  );
  const titles = listingRows.flatMap((card) => (card.title ? [card.title] : []));

  expect(calabarzonCard).toBeTruthy();
  expect(lagunaCard).toBeTruthy();
  expect(new Set(titles).size).toBe(titles.length);
  expect(Math.abs((calabarzonCard?.y ?? 0) - (lagunaCard?.y ?? 0))).toBeLessThanOrEqual(2);
});

test("tablet app pages keep the utility navigation on one row", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const headerBox = await page.locator(".site-header").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(headerBox?.height).toBeLessThanOrEqual(84);
  await expect(page.locator(".buy-topbar")).toHaveCount(0);
});

test("rider navigation separates discovery, passes, profile, and hosting", async ({ page }) => {
  await logInAs(page, "rider");
  await expect(page).toHaveURL(/\/profile/);

  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Tambike events" })).toBeVisible();
  await expect(page.locator(".site-header")).toHaveAttribute("data-role", "rider");

  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
  }

  const riderNav = page.getByRole("navigation", { name: /Rider navigation/i });
  await expect(riderNav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(riderNav.getByRole("link", { name: "Explore" })).toBeVisible();
  await expect(riderNav.getByRole("link", { name: "Passes" })).toBeVisible();
  await expect(riderNav.getByRole("link", { name: "Profile" })).toBeVisible();
  await expect(riderNav.getByRole("link", { name: "My Passes" })).toHaveCount(0);
  await expect(riderNav.getByRole("link", { name: "Create" })).toHaveCount(0);
  await expect(riderNav.getByRole("link", { name: "Host an Event" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Host an Event" })).toBeVisible();

  const exploreShortcuts = page.locator(".category-strip");
  await expect(exploreShortcuts.getByRole("link", { name: "All" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Tambike" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Charity" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Track Day" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Endurance" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Race" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Moto Expo" })).toBeVisible();
  await expect(exploreShortcuts.getByRole("link", { name: "Coffee Ride" })).toHaveCount(0);
  await expect(exploreShortcuts.getByRole("link", { name: "Bike Night" })).toHaveCount(0);
  await expect(exploreShortcuts.getByRole("link", { name: "Safety Review" })).toHaveCount(0);

  await riderNav.getByRole("link", { name: "Home" }).click();
  const homeShortcuts = page.locator(".category-strip");
  await expect(homeShortcuts.getByRole("link", { name: "All" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Tambike" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Charity" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Track Day" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Endurance" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Race" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Moto Expo" })).toBeVisible();
  await expect(homeShortcuts.getByRole("link", { name: "Tonight" })).toHaveCount(0);
  await expect(homeShortcuts.getByRole("link", { name: "Near Me" })).toHaveCount(0);
});

test("guest can log in with seeded account data, view profile, and register for an event", async ({
  page,
}) => {
  await page.goto("/events/tambike-cafe-classico");

  await expect(page.getByRole("heading", { name: /Tambike at Cafe Classico/i })).toBeVisible();
  await page.getByRole("button", { name: /^Going$/i }).click();
  await expect(page.getByRole("heading", { name: /Log in to get your Tambike Pass/i })).toBeVisible();

  await logInAs(page, "rider");

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Mina Rider/i })).toBeVisible();
  await expect(page.getByText(/mina.rider@example.com/i)).toBeVisible();
  await expect(page.getByText(/Motorcycle: Yamaha Mio Gear/i)).toBeVisible();

  await page.goto("/events/tambike-cafe-classico");
  await page.getByRole("button", { name: /^Going$/i }).click();
  await page.getByLabel(/Go direct to venue/i).check();
  await page.getByRole("button", { name: /Get Tambike Pass/i }).click();

  await expect(page).toHaveURL(/\/passes\/pass-tambike-cafe-classico/);
  await expect(page.getByRole("heading", { name: /Tambike Pass/i })).toBeVisible();
  await expect(page.getByLabel(/QR code for Tambike Pass/i)).toBeVisible();
  await expect(page.locator(".qr-token")).toHaveCount(0);
});

test("email and password login signs in with seeded accounts", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/Email/i).fill("mina.rider@example.com");
  await page.getByLabel(/Password/i).fill("password123");
  await page.getByRole("button", { name: /^Log in$/i }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Mina Rider/i })).toBeVisible();
});

test("login and footer use production account copy", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByText(/Demo accounts|Walkthrough accounts|sample accounts/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Login as/i })).toHaveCount(0);
  await expect(page.locator("[aria-label='Demo account guide']")).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByText(/Demo login|Tambike UI Demo|ready for walkthrough/i)).toHaveCount(0);
});

test("signup requires password and matching confirmation", async ({ page }, testInfo) => {
  const email = `secure.rider.${testInfo.project.name}.${Date.now()}@example.com`;

  await page.goto("/signup");

  await page.getByLabel(/Display name/i).fill("Secure Rider");
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/^Password$/i).fill("passw0rd!");
  await page.getByLabel(/Confirm password/i).fill("different-pass");
  await page.getByLabel(/Area \/ city/i).fill("Quezon City");
  await expect(page.getByRole("heading", { name: /Create rider account/i })).toBeVisible();
  await expect(page.locator("[aria-label='Account type']").getByText(/Rider/i)).toBeVisible();
  await expect(page.getByLabel(/Bike model|Club name/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Create rider account/i }).click();

  await expect(page.getByText(/Passwords must match/i)).toBeVisible();
  await expect(page).toHaveURL(/\/signup/);

  await page.getByLabel(/Confirm password/i).fill("passw0rd!");
  await page.getByRole("button", { name: /Create rider account/i }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Secure Rider/i })).toBeVisible();
});

test("guest and wrong-role users see protected route guards instead of operator controls", async ({
  page,
}) => {
  const protectedRoutes = [
    ["/admin", /Log in to continue/i],
    ["/admin/moderation", /Log in to continue/i],
    ["/organizer/events", /Log in to continue/i],
    ["/organizer/events/arai-hjc-charity-ride/scanner", /Log in to scan passes/i],
    ["/organizer/events/arai-hjc-charity-ride/report", /Log in to view reports/i],
    ["/venue/requests", /Log in to continue/i],
    ["/venue/events", /Log in to continue/i],
  ] as const;

  for (const [route, heading] of protectedRoutes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve|Valid pass|Export|Suspend/i })).toHaveCount(0);
  }

  await logInAs(page, "rider");
  await expect(page).toHaveURL(/\/profile/);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /Ops access needed/i })).toBeVisible();
});

test("operator index routes render distinct MVP screens", async ({ page }) => {
  await logInAs(page, "admin");
  await expect(page).toHaveURL(/\/admin/);

  await page.goto("/admin/leads");
  await expect(page.getByRole("heading", { name: /Test-ride leads/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Export leads CSV/i })).toHaveAttribute(
    "href",
    "/api/admin/exports/leads",
  );

  await page.goto("/admin/moderation");
  await expect(page.getByRole("heading", { name: /Moderation reports/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open rider safety reports/i })).toBeVisible();

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: /User management/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Suspend user/i }).first()).toBeVisible();

  await logInAs(page, "organizer");
  await expect(page).toHaveURL(/\/organizer\/dashboard/);
  await page.goto("/organizer/events");
  await expect(page.getByRole("heading", { name: /Organizer-owned events/i })).toBeVisible();

  await logInAs(page, "venue");
  await expect(page).toHaveURL(/\/venue\/dashboard/);
  await page.goto("/venue/requests");
  await expect(page.getByRole("heading", { name: /Venue approval requests/i })).toBeVisible();
  await page.goto("/venue/events");
  await expect(page.getByRole("heading", { name: "Venue-linked events", exact: true })).toBeVisible();
});

test("operator Reports nav opens reports indexes instead of one event report", async ({ page }) => {
  await logInAs(page, "organizer");
  await expect(page).toHaveURL(/\/organizer\/dashboard/);
  await page.getByRole("navigation", { name: /Organizer navigation/i }).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/organizer\/reports$/);
  await expect(page.getByRole("heading", { name: "Organizer reports", exact: true })).toBeVisible();
  await expect(page.getByText("ARAI HJC Charity Ride")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No reports yet", exact: true })).toBeVisible();

  await logInAs(page, "venue");
  await expect(page).toHaveURL(/\/venue\/dashboard/);
  await page.getByRole("navigation", { name: /Venue navigation/i }).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/venue\/reports$/);
  await expect(page.getByRole("heading", { name: "Venue reports", exact: true })).toBeVisible();
  await expect(page.getByText("ARAI HJC Charity Ride")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No reports yet", exact: true })).toBeVisible();

  await logInAs(page, "admin");
  await expect(page).toHaveURL(/\/admin/);
  await page.getByRole("navigation", { name: /Admin navigation/i }).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByRole("heading", { name: "Admin reports", exact: true })).toBeVisible();
  await expect(page.getByText("ARAI HJC Charity Ride")).toHaveCount(0);
  const adminReportLink = page.locator(".queue-list a").filter({ hasText: "Tambike at Cafe Classico" });
  await expect(adminReportLink).toHaveAttribute("href", "/admin/reports/tambike-cafe-classico");
  await adminReportLink.click();
  await expect(page).toHaveURL(/\/admin\/reports\/tambike-cafe-classico$/);
  await expect(page.getByText("Admin report")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event Report", exact: true })).toBeVisible();
});

test("event search filters listings through the q query parameter", async ({ page }) => {
  await page.goto("/events?q=makina");

  await expect(page).toHaveURL(/\/events\?q=makina$/);
  await expect(page.getByRole("searchbox", { name: /Search events/i })).toHaveValue("makina");
  await expect(page.locator(".event-grid .event-card h3")).toHaveText(["Makina Moto Expo Cebu"]);
});

test("share controls show copied or shared feedback", async ({ page }) => {
  await page.goto("/events/tambike-cafe-classico");

  await page.getByRole("button", { name: /^Share$/i }).click();
  await expect(page.getByText(/Link copied|Shared/i)).toBeVisible();

  await logInAs(page, "rider");
  await expect(page).toHaveURL(/\/profile/);
  await page.goto("/events/tambike-cafe-classico");
  await page.getByRole("button", { name: /^Going$/i }).click();
  await page.getByRole("button", { name: /Get Tambike Pass/i }).click();
  await expect(page).toHaveURL(/\/passes\/pass-tambike-cafe-classico/);

  await page.getByRole("button", { name: /Share Pass/i }).click();
  await expect(page.getByText(/Pass link copied|Pass shared/i)).toBeVisible();
});

test("past events show closed registration state", async ({ page }) => {
  await page.goto("/events/fullprint-manila-tambike");

  await expect(page.getByText(/Past event/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Going$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Interested/i })).toHaveCount(0);
});

test("new rider signup creates a rider profile", async ({ page }, testInfo) => {
  const email = `jay.new.${testInfo.project.name}.${Date.now()}@example.com`;

  await page.goto("/signup");

  await page.getByLabel(/Display name/i).fill("Jay New Rider");
  await page.getByLabel(/Email/i).fill(email);
  await page.getByLabel(/^Password$/i).fill("passw0rd!");
  await page.getByLabel(/Confirm password/i).fill("passw0rd!");
  await page.getByLabel(/Area \/ city/i).fill("Quezon City");
  await expect(page.getByLabel(/Bike model|Club name/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Create rider account/i }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Jay New Rider/i })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/Account: Rider|Role: Rider/i)).toBeVisible();
  await expect(page.getByText(/Motorcycle: Honda Click 160|Riding group: QC Night Riders/i)).toHaveCount(0);
});

test("approved organizer can create an event draft", async ({ page }) => {
  await logInAs(page, "organizer");

  await expect(page.getByRole("heading", { name: /Organizer Dashboard/i })).toBeVisible();
  await page.getByRole("link", { name: /Create Event/i }).click();

  await page.getByLabel(/Event title/i).fill("Tambike Night at Katipunan");
  await page.getByLabel(/Event type/i).selectOption("Bike Night");
  await page.getByLabel(/Venue/i).selectOption("shell-pugon");
  await page.getByLabel(/Date label/i).fill("Sat · July 18");
  await page.getByLabel(/Time label/i).fill("7:00 PM - 10:00 PM");
  await page.getByLabel(/Area/i).fill("Katipunan, Quezon City");
  await page.getByLabel(/Expected riders/i).fill("45");
  await page.getByLabel(/Perk preview/i).fill("Free sticker for checked-in riders");
  await page.getByRole("button", { name: /Create draft/i }).click();

  await expect(page.getByRole("heading", { name: /Draft created/i })).toBeVisible();
  await expect(page.getByText("Event draft")).toBeVisible();
  await expect(page.getByText(/Mock event/i)).toHaveCount(0);
  await expect(page.getByText(/Tambike Night at Katipunan/i)).toBeVisible();
  await expect(page.getByText("Needs venue approval", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /View draft event/i }).click();
  await expect(page.getByRole("heading", { name: /Tambike Night at Katipunan/i })).toBeVisible();
  await page.getByRole("link", { name: "Events" }).click();
  await expect(page.getByRole("heading", { name: /Tambike Night at Katipunan/i })).toHaveCount(0);
});

test("organizer scanner shows event-day validation states and report metrics", async ({
  page,
}) => {
  await logInAs(page, "organizer");
  await expect(page).toHaveURL(/\/organizer\/dashboard/);

  await page.goto("/organizer/events/arai-hjc-charity-ride/scanner");

  await expect(page.getByRole("heading", { name: /QR Scanner/i })).toBeVisible();
  await page.getByRole("button", { name: /Valid pass/i }).click();
  await expect(page.getByText(/Checked in successfully/i)).toBeVisible();

  await page.getByRole("button", { name: /Already checked in/i }).click();
  await expect(page.getByText(/Already checked in at 7:18 PM/i)).toBeVisible();

  await page.getByRole("button", { name: /Wrong event/i }).click();
  await expect(page.getByText(/Pass belongs to a different event/i)).toBeVisible();

  await page.getByRole("button", { name: /Cancelled pass/i }).click();
  await expect(page.getByText(/This pass was cancelled/i)).toBeVisible();

  await page.getByRole("button", { name: /Inactive window/i }).click();
  await expect(page.getByText(/Check-in window is not active/i)).toBeVisible();

  await page.getByRole("link", { name: /View report/i }).click();
  await expect(page.getByRole("heading", { name: /Event Report/i })).toBeVisible();
  await expect(page.getByText(/No-show rate/i)).toBeVisible();
  await expect(page.getByText(/Perk redemptions/i)).toBeVisible();
});

test("venue can approve an event request with conditions", async ({ page }) => {
  await logInAs(page, "venue");
  await expect(page).toHaveURL(/\/venue\/dashboard/);

  await page.goto("/venue/requests/req-shell-pugon");

  await expect(page.getByRole("heading", { name: /Venue request/i })).toBeVisible();
  await expect(page.getByText(/Expected riders: 90/i)).toBeVisible();
  await page
    .getByLabel(/Venue conditions/i)
    .fill("Parking marshals required. Quiet exit after 10 PM.");
  await page.getByRole("button", { name: /Approve with conditions/i }).click();

  await expect(page.getByText(/Approved with conditions/i)).toBeVisible();
  await expect(page.getByText(/Parking marshals required/i)).toBeVisible();
});

test("admin can review and publish the risky event", async ({ page }) => {
  await logInAs(page, "admin");
  await expect(page).toHaveURL(/\/admin/);

  await page.goto("/admin/events/review/rev-arai-hjc-charity-ride", {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByRole("heading", { name: /Event review/i })).toBeVisible();
  await expect(page.getByText(/Risk flags/i)).toBeVisible();
  await expect(page.getByText("Charity ride", { exact: true })).toBeVisible();
  const approvePublish = page.getByRole("button", { name: /Approve publish/i });
  await expect(approvePublish).toHaveAttribute("data-ready", "true");
  await approvePublish.click();

  await expect(page.getByText(/Published/i)).toBeVisible();
  await expect(page.getByText(/Event is live for riders/i)).toBeVisible();
});
