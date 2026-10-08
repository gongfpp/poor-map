import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { gcj02ToWgs84 } from "../src/domain.ts";
const url = process.argv[2] || "http://127.0.0.1:5173/";
// Actual AMap POI B023E05BX1, queried 2026-10-09; a public reference, never the user's GPS.
const reference = [121.554225, 29.869432],
  wgs = gcj02ToWgs84(reference);
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    geolocation: { longitude: wgs[0], latitude: wgs[1] },
    permissions: ["geolocation"],
  });
  await context.addInitScript(() =>
    localStorage.setItem("poor-map:analytics", "off"),
  );
  const page = await context.newPage(),
    errors = [];
  let realResult;
  page.on("pageerror", (e) =>
    errors.push(e.message.replace(/[a-f0-9]{32}/gi, "[redacted]")),
  );
  page.on("response", async (r) => {
    if (
      new URL(r.url()).pathname === "/api/navigation/nearest" &&
      r.status() === 200
    )
      realResult = await r.json();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".discovery-note")).toContainText(/已保存 \d+ 家/, {
    timeout: 20000,
  });
  await page.locator(".navigation-panel > summary").click();
  await expect(
    page.getByRole("button", { name: "找步行最近的折扣店", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "从我的位置出发", exact: true })
    .click();
  await expect(page.locator(".navigation-origin")).toContainText(
    "设备定位出发点",
  );
  await page
    .getByRole("button", { name: "找步行最近的折扣店", exact: true })
    .click();
  await expect(page.locator(".navigation-result")).toContainText("好特卖", {
    timeout: 40000,
  });
  assert.ok(
    realResult && realResult.polyline.length > 2 && realResult.distance > 0,
  );
  await expect(page.locator(".amap-canvas canvas").first()).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".map-source")).toContainText("高德地图");
  const link = await page
    .getByRole("link", { name: "打开高德步行导航" })
    .getAttribute("href");
  const target = new URL(link);
  assert.equal(target.hostname, "uri.amap.com");
  assert.equal(target.pathname, "/navigation");
  assert.equal(target.searchParams.get("mode"), "walk");
  assert.ok(target.searchParams.get("from") && target.searchParams.get("to"));
  assert.equal(target.searchParams.has("key"), false);
  await page.locator(".navigation-result summary").click();
  assert.ok((await page.locator(".navigation-result li").count()) > 0);
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: "/private/tmp/poor-map-navigation-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole("link", { name: "打开高德步行导航" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link", { name: "打开高德步行导航" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/poor-map-navigation-mobile.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        url,
        reference: "宁波天一广场（模拟定位验收，非实地GPS）",
        destination: realResult.destination.name,
        meters: realResult.distance,
        minutes: Math.ceil(realResult.duration / 60),
        compared: realResult.compared,
        points: realResult.polyline.length,
        walkingUri: true,
        desktopAndMobile: true,
        errors: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
}
