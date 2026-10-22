import { test, expect } from "@playwright/test";
import { seedWater } from "../../src/water-domain";
import { seedStores } from "../../src/store-domain";

// No supplier requests or shared writes: these scenarios exercise layout and state only.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/config")
      ? { provider: "amap", mapReady: false, searchReady: false }
      : path.endsWith("/candidates")
        ? { stores: [], configured: true, cacheOnly: true, warnings: [] }
        : path.endsWith("/stores")
          ? { stores: seedStores }
          : path.endsWith("/water")
            ? { offers: seedWater }
            : { comments: [], accepted: 0 };
    return route.fulfill({ json });
  });
});

for (const water of [false, true]) {
  const title = water ? "water" : "stores";
  const panelSelector = water ? ".water-sidebar" : ".sidebar";
  const mapSelector = water ? ".water-map-side" : ".map-panel";
  const closeName = water ? "关闭水价列表" : "关闭门店列表";
  const openName = water ? "列表" : "看列表";
  const queryName = water ? "搜索水价线索" : "搜索门店";

  test(`${title}: close, reopen and retain filters at narrow, embedded and PC widths`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== "desktop",
      "Explicit viewport matrix covers both form factors.",
    );
    test.setTimeout(120000);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (
        /^\/api\/(?:water(?:\/candidates|\/config)?|community\/stores)$/.test(
          new URL(request.url()).pathname,
        )
      )
        requests.push(request.url());
    });
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [736, 826],
      [1024, 600],
      [1440, 960],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("about:blank");
      await page.goto(water ? "/#/water" : "/");
      await page.waitForLoadState("networkidle");
      const panel = page.locator(panelSelector);
      const open = page.getByRole("button", { name: openName, exact: true });
      if (width < 800) await open.click();
      await expect(panel).toBeVisible();
      const input = page.getByLabel(queryName);
      const queryRead = water
        ? null
        : page.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.pathname === "/api/water/candidates" &&
              url.searchParams.get("query") === "好特卖"
            );
          });
      await input.fill(water ? "K11" : "好特卖");
      if (queryRead) await queryRead;
      const map = page.locator(mapSelector);
      await map.evaluate((el) =>
        el.setAttribute("data-mount-check", "retained"),
      );
      await panel
        .locator(".map-list-scroll")
        .evaluate((el) => (el.scrollTop = el.scrollHeight));
      const close = page.getByRole("button", { name: closeName, exact: true });
      await expect(close).toBeInViewport({ ratio: 1 });
      const count = requests.length;
      await close.click();
      await expect(panel).toBeHidden();
      await expect(map).toBeVisible();
      await expect(open).toBeInViewport({ ratio: 1 });
      await expect(open).toBeFocused();
      await expect(open).toHaveAttribute("aria-expanded", "false");
      // Closed fields must leave the keyboard and accessibility tree.
      await expect(
        page.getByRole("complementary", {
          name: water ? "大水地图筛选与结果" : "门店筛选与结果",
        }),
      ).toHaveCount(0);
      await open.click();
      await expect(close).toBeFocused();
      await expect(input).toHaveValue(water ? "K11" : "好特卖");
      await expect(map).toHaveAttribute("data-mount-check", "retained");
      expect(requests.length).toBe(count);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      // The complete list is scrollable even on a short landscape screen.
      const geometry = await panel
        .locator(".map-list-scroll")
        .evaluate((el) => ({
          height: el.clientHeight,
          scroll: el.scrollHeight,
        }));
      expect(geometry.height).toBeGreaterThan(60);
      await expect(panel).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true);
      expect(geometry.scroll).toBeGreaterThanOrEqual(geometry.height);
    }
  });

  test(`${title}: Escape dismisses a dialog before the list and resizing never traps the panel`, async ({
    page,
  }) => {
    await page.goto(water ? "/#/water" : "/");
    const open = page.getByRole("button", { name: openName, exact: true });
    if (await open.isVisible()) await open.click();
    const panel = page.locator(panelSelector);
    await page
      .getByRole("button", {
        name: water ? "补充水价" : "数据来源与配置",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    for (const width of [320, 1024, 390, 1440]) {
      await page.setViewportSize({ width, height: 600 });
      await expect(open).toBeInViewport({ ratio: 1 });
      await open.click();
      await expect(panel).toBeVisible();
      await page.getByRole("button", { name: closeName, exact: true }).click();
      await expect(panel).toBeHidden();
    }
  });
}
