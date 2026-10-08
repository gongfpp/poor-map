import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { gcj02ToWgs84 } from "../src/domain.ts";
const url = process.argv[2] || "http://127.0.0.1:5173/";
// Public Chengdu shop neighborhood with 676 collected reference points within 10 km.
const wgs = gcj02ToWgs84([104.048852, 30.636284]);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const c = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    geolocation: { longitude: wgs[0], latitude: wgs[1] },
    permissions: ["geolocation"],
  });
  await c.addInitScript(() =>
    localStorage.setItem("poor-map:analytics", "off"),
  );
  const p = await c.newPage(),
    errors = [];
  let reads = 0,
    searches = 0;
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/water/candidates" && r.method() === "GET") reads++;
    if (/restapi.amap.com.*place\/|api.tianditu.gov.cn.*search/.test(r.url()))
      searches++;
  });
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await expect(p.locator(".discovery-note")).toContainText(/已保存 \d+ 家/, {
    timeout: 20000,
  });
  await p.getByLabel("搜索半径").selectOption("10000");
  await expect(p.locator(".store-card")).toHaveCount(500, { timeout: 25000 });
  await expect(p.locator(".discovery-note")).toContainText("最近500家");
  await expect(p.locator(".map-source")).toContainText("高德地图", {
    timeout: 20000,
  });
  await expect
    .poll(
      () =>
        p
          .locator(".amap-marker .pin")
          .evaluateAll((pins) =>
            pins.reduce(
              (n, pin) => n + Number(pin.getAttribute("data-store-count") || 1),
              0,
            ),
          ),
      { timeout: 20000 },
    )
    .toBe(500);
  const groupedMarkerCount = await p.locator(".amap-marker").count();
  assert.ok(groupedMarkerCount < 500);
  await p.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect(p.locator(".store-card").first()).toBeVisible();
  await expect(
    p.locator(".store-card").filter({ hasText: "蜜雪冰城" }),
  ).toHaveCount(0);
  await p.getByRole("button", { name: "全部", exact: true }).click();
  await expect(p.locator(".store-card")).toHaveCount(500, { timeout: 20000 });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({ path: "/private/tmp/poor-map-stress-500.png" });
  await c.setOffline(true);
  // Reloading with the warm HTTP cache disabled may lose the page/SDK itself, so keep the loaded app and request a different radius.
  await p.getByLabel("搜索半径").selectOption("5000");
  await expect(p.locator(".discovery-note")).toContainText("离线门店副本", {
    timeout: 15000,
  });
  assert.ok((await p.locator(".store-card").count()) > 0);
  await p.getByRole("button", { name: "刷新门店", exact: true }).click();
  await expect(p.locator(".discovery-note")).toContainText("不会被清空", {
    timeout: 15000,
  });
  assert.ok((await p.locator(".store-card").count()) > 0);
  assert.equal(searches, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        url,
        source: "真实已收集成都门店（公开位置模拟定位）",
        maxDisplayed: 500,
        groupedMarkerCount,
        genuineSdkRepresentedStores: 500,
        offlineWarmCopy: true,
        failedRefreshRetainsCopy: true,
        ownCacheReads: reads,
        automaticProviderSearches: searches,
        mobileOverflow: false,
        errors: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
}
