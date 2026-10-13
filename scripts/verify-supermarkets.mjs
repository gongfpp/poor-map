import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { matchesBrand } from "../src/store-brands.ts";

const url = process.argv[2] || "https://gongfpp.github.io/poor-map/";
const backend = "https://poor-map-api.gong7968.workers.dev";
const job = JSON.parse(readFileSync(".data/city-collection.json", "utf8"));
const verified = [];
for (const keyword of [
  "超盒算",
  "奥乐齐",
  "永辉超市",
  "沃尔玛",
  "大润发",
  "三江购物",
]) {
  const all = Object.values(job.cities).flatMap((c) => Object.values(c.stores));
  const store = all.find((s) => matchesBrand(s.name, keyword));
  assert.ok(store, keyword + "未收集到参考门店");
  for (const mode of ["home", "water"]) {
    const params = new URLSearchParams({
      center: store.location.join(","),
      radius: "1000",
      mode,
      category: store.category,
    });
    const response = await fetch(backend + "/api/water/candidates?" + params, {
      signal: AbortSignal.timeout(25000),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.cacheOnly, true);
    assert.ok(
      data.stores.some((s) => s.id === store.id),
      keyword + "缓存未返回",
    );
    assert.ok(
      data.stores.every(
        (s) => s.category === store.category && !("price" in s),
      ),
    );
  }
  verified.push({
    brand: keyword,
    reference: store.name,
    category: store.category,
  });
}
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  for (const [size, viewport] of [
    ["desktop", { width: 1440, height: 960 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() =>
      localStorage.setItem("poor-map:analytics", "off"),
    );
    const page = await context.newPage(),
      errors = [],
      queries = [],
      tiles = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/water/candidates")
        queries.push({ method: r.request().method(), status: r.status() });
      if (/amap\.com$/.test(u.hostname) && /\/tile\/|get_tile/.test(u.pathname))
        tiles.push(r.status());
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".discovery-note")).toContainText(
      /已保存 \d+ 家/,
      { timeout: 60000 },
    );
    await page.getByLabel("地图门店类型").selectOption("supermarket");
    if (size === "mobile")
      await page.getByRole("button", { name: "看列表", exact: true }).click();
    await expect(page.locator(".store-card").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".results")).toContainText("大型商超");
    await expect(page.locator(".results")).not.toContainText("¥");
    await expect(
      page.getByRole("button", { name: "大型商超", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    if (size === "mobile")
      await page.getByRole("button", { name: /^看地图/ }).click();
    await expect.poll(() => tiles.includes(200), { timeout: 30000 }).toBe(true);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: `/tmp/poor-map-supermarkets-${size}.png` });
    assert.deepEqual(errors, []);
    assert.ok(
      queries.length &&
        queries.every((q) => q.method === "GET" && q.status === 200),
    );
    await context.close();
  }
  console.log(
    JSON.stringify(
      {
        url,
        brands: verified,
        desktopAndMobile: true,
        realTiles: true,
        cacheOnly: true,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
}
