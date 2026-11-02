// The map on the people screen: the row opens a sheet, the sheet draws a dot
// per thing from the plot the browser computed, a chip recolors the dots
// without moving them, the rank's two buttons compute the list again, and a
// tap on a dot names the thing.
//
// What the dots mean is the crate's (`cargo test`) and where they sit is
// `tests/taste-map.test.ts`'s. This checks that the screen draws them.
//
// Deliberately not in CI: it wants a browser and a stack.

import { expect, seedWorld, stackTest as test } from "./harness.ts";
import { go, signInAs, uuidOf } from "./local-session.ts";

const VIEWER = "u0";

test.use({ viewport: { width: 420, height: 900 } });

test("the map draws the computed plot and recolors it by chip", async ({
  page,
  origin,
}) => {
  await test.step("seed the running stack", () => seedWorld());
  await signInAs(page, origin, uuidOf(VIEWER), `${VIEWER}@example.com`);
  await go(page, `${origin}/#/people`, 4000);

  await page.locator('[data-row="taste-map"]').click();
  const map = page.locator("[data-taste-map]");
  await expect(map).toBeVisible();
  const dots = map.locator("circle");
  // At rank three the places come back from the worker a moment after the sheet.
  await expect
    .poll(() => dots.count(), { timeout: 20_000 })
    .toBeGreaterThan(10);

  const places = (): Promise<string[]> =>
    dots.evaluateAll((all) =>
      all.map((dot) => `${dot.getAttribute("cx")},${dot.getAttribute("cy")}`),
    );
  const colors = (): Promise<string[]> =>
    dots.evaluateAll((all) => all.map((dot) => getComputedStyle(dot).fill));
  const [before, tinted] = [await places(), await colors()];
  expect(new Set(tinted).size).toBeGreaterThan(2);
  const shot = process.env.GRAPEVINE_SHOTS;
  if (shot) await page.screenshot({ path: `${shot}/taste-map-liked.png` });

  // Any chip after the thumbs-up is an attribute of the viewer's, and the
  // seeded viewer has some.
  const chips = page.locator('[role="dialog"] button:has-text("")').filter({
    hasNot: page.locator("svg"),
    hasNotText: "open",
  });
  expect(await chips.count()).toBeGreaterThan(0);
  await chips.first().click();
  expect(await places()).toEqual(before);
  expect(await colors()).not.toEqual(tinted);
  if (shot) await page.screenshot({ path: `${shot}/taste-map-attribute.png` });

  // One more number a thing: the list is computed again and the dots are laid
  // out again, somewhere else. Back again, they are back where they were: the
  // same list gives the same picture.
  const rank = page.locator("[data-taste-rank]");
  const started = Number(await rank.getAttribute("data-taste-rank"));
  await page.getByRole("button", { name: "more detail" }).click();
  await expect(rank).toHaveAttribute("data-taste-rank", String(started + 1));
  await expect.poll(places, { timeout: 30_000 }).not.toEqual(before);
  await page.getByRole("button", { name: "less detail" }).click();
  await expect(rank).toHaveAttribute("data-taste-rank", String(started));
  await expect.poll(places, { timeout: 30_000 }).toEqual(before);

  // The list has been computed again and the map is at rest.
  await expect(map.locator(".animate-spin")).toHaveCount(0, {
    timeout: 20_000,
  });

  // A tap on a dot names the thing and offers to open it.
  const box = await dots.first().boundingBox();
  if (!box) throw new Error("the first dot has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.locator('[role="dialog"] button', { hasText: "open" }),
  ).toBeVisible();
  if (shot) await page.screenshot({ path: `${shot}/taste-map-picked.png` });
});
