import { expect, test } from "@playwright/test";

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

test("featured event carousel reveals the outer card on large screens", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/events", { waitUntil: "domcontentloaded" });

  const widePeek = page.locator(".feature-card.is-wide-peek");
  await expect(widePeek).toHaveCount(1);
  await expect(widePeek).toHaveCSS("opacity", "0.28");

  const box = await widePeek.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(2048);
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
      const activeCenter = await cardCenterX("FullPrint Manila Tambike");
      const tambikeCenter = await cardCenterX("Tambike at Cafe Classico");
      const underboneCenter = await cardCenterX("Boys of Underbone Laguna Tambike");
      const upperEastCenter = await cardCenterX("CCPH Upper East Tambike");

      return (
        Number.isFinite(activeCenter) &&
        tambikeCenter > activeCenter &&
        underboneCenter > tambikeCenter &&
        upperEastCenter > underboneCenter
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
  await expect(page.locator(".event-grid .event-card h3")).toHaveText([
    "ARAI HJC Charity Ride",
    "Long Ride x Charity",
  ]);
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
    "Boys of Garage Crossmeet Tambike",
    "CCPH Upper East Tambike",
    "CCPH Cebu Official Tambike",
  ]);
});

test("event filter pills navigate to useful event sets", async ({ page }) => {
  await page.goto("/events");

  await page.locator(".category-strip").getByRole("link", { name: "Race" }).click();

  await expect(page).toHaveURL(/\/events\?type=race$/);
  await expect(page.locator(".category-strip .is-active")).toHaveText("Race");
  await expect(page.locator(".feature-card.is-featured h2")).toHaveText("Tambike at Cafe Classico");
  await expect(page.locator(".event-grid .event-card h3")).toHaveText([
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
  await expect(footer.getByText("Pass flow, event review, scanner, and reports are ready for walkthrough.")).toBeVisible();
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

test("rider navigation separates discovery, passes, profile, and hosting", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tambike-demo-current-user", "user-mina-rider");
  });
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

test("guest can log in with sample data, view profile, and register for an event", async ({
  page,
}) => {
  await page.goto("/events/arai-hjc-charity-ride");

  await expect(page.getByRole("heading", { name: /ARAI HJC Charity Ride/i })).toBeVisible();
  await page.getByRole("button", { name: /^Going$/i }).click();
  await expect(page.getByRole("heading", { name: /Log in to get your Tambike Pass/i })).toBeVisible();

  await page.getByRole("link", { name: /Log in/i }).click();
  await page.getByRole("button", { name: /Login as Mina Rider/i }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Mina Rider/i })).toBeVisible();
  await expect(page.getByText(/mina.rider@example.com/i)).toBeVisible();
  await expect(page.getByText(/Bike: Yamaha Mio Gear/i)).toBeVisible();

  await page.goto("/events/arai-hjc-charity-ride");
  await page.getByRole("button", { name: /^Going$/i }).click();
  await page.getByLabel(/Go direct to venue/i).check();
  await page.getByRole("button", { name: /Get Tambike Pass/i }).click();

  await expect(page).toHaveURL(/\/passes\/pass-arai-hjc-charity-ride/);
  await expect(page.getByRole("heading", { name: /Tambike Pass/i })).toBeVisible();
  await expect(page.getByText(/QR token: TBK-ARAI-HJC-CHARITY-RIDE/i)).toBeVisible();
});

test("new sample signup creates a rider profile", async ({ page }) => {
  await page.goto("/signup");

  await page.getByLabel(/Display name/i).fill("Jay New Rider");
  await page.getByLabel(/Email/i).fill("jay.new@example.com");
  await page.getByLabel(/Area \/ city/i).fill("Quezon City");
  await page.getByLabel(/Bike model/i).fill("Honda Click 160");
  await page.getByLabel(/Club name/i).fill("QC Night Riders");
  await page.getByRole("button", { name: /Create rider account/i }).click();

  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("heading", { name: /Jay New Rider/i })).toBeVisible();
  await expect(page.getByText(/jay.new@example.com/i)).toBeVisible();
  await expect(page.getByText(/Bike: Honda Click 160/i)).toBeVisible();
  await expect(page.getByText(/Club: QC Night Riders/i)).toBeVisible();
});

test("approved sample organizer can create an event draft", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Account access")).toBeVisible();
  await expect(page.getByText(/Mock login/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Login as Marco Organizer/i }).click();

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
  await expect(page.getByAltText("Tambike Night at Katipunan poster").first()).toHaveAttribute(
    "src",
    /poster-tambike-cafe-classico\.jpg/,
  );
});

test("organizer scanner shows event-day validation states and report metrics", async ({
  page,
}) => {
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
  await expect(page.getByText(/Audit log: Admin approved publish/i)).toBeVisible();
});
