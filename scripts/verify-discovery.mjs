import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const url = process.argv[2] || "http://127.0.0.1:5173/";
const backend =
  new URL(url).hostname === "127.0.0.1"
    ? "http://127.0.0.1:8787"
    : "https://poor-map-api.gong7968.workers.dev";
const config = await (await fetch(backend + "/api/water/config")).json();
const label = config.provider === "amap" ? "高德" : "天地图";
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await context.addInitScript(() =>
    localStorage.setItem("poor-map:analytics", "off"),
  );
  const page = await context.newPage(),
    queries = [],
    errors = [],
    tiles = [];
  page.on("pageerror", (e) =>
    errors.push(e.message.replace(/[a-f0-9]{32}/gi, "[REDACTED]")),
  );
  page.on("response", async (r) => {
    const u = new URL(r.url());
    if (
      /^t[0-7]\.tianditu\.gov\.cn$/.test(u.host) ||
      (/amap\.com$/.test(u.host) &&
        (u.pathname.includes("/tile/") || u.pathname.includes("get_tile")))
    )
      tiles.push({ status: r.status(), type: r.headers()["content-type"] });
    if (u.pathname === "/api/water/candidates") {
      try {
        const d = await r.json();
        queries.push({
          source: "cache",
          cached: d.cacheOnly,
          method: r.request().method(),
          mode: u.searchParams.get("mode"),
          status: r.status(),
          reportedCount: d.stores?.length || 0,
        });
      } catch {}
      return;
    }
    if (u.host !== "api.tianditu.gov.cn" || u.pathname !== "/v2/search") return;
    try {
      const params = JSON.parse(u.searchParams.get("postStr")),
        d = await r.json();
      queries.push({
        keyword: params.keyWord,
        status: r.status(),
        code: Number(d.status?.infocode),
        reportedCount: Number(d.count) || 0,
      });
    } catch {
      queries.push({ status: r.status(), code: 0 });
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".discovery-note")).toContainText("已保存", {
    timeout: 60000,
  });
  const sourceCards = page.locator(".store-card").filter({ hasText: label });
  await expect
    .poll(() => sourceCards.count(), { timeout: 15000 })
    .toBeGreaterThan(0);
  const homeCount = await sourceCards.count();
  assert.ok(homeCount > 0, "Real Ningbo provider results were not displayed.");
  assert.ok(
    queries.some((q) =>
      config.provider === "amap"
        ? q.source === "cache" &&
          q.cached &&
          q.method === "GET" &&
          q.status === 200 &&
          q.reportedCount > 0
        : q.keyword === "蜜雪冰城" && q.status === 200 && q.code === 1000,
    ),
  );
  if (config.writeReady === false)
    await expect(page.getByRole("button", { name: "标记门店" })).toBeDisabled();
  else
    await expect(page.getByRole("button", { name: "标记门店" })).toBeEnabled({
      timeout: 30000,
    });
  await expect
    .poll(() => tiles.some((t) => t.status === 200), { timeout: 15000 })
    .toBe(true);
  await expect(page.locator(".results")).not.toContainText("¥");
  await page.getByRole("button", { name: "蜜雪冰城", exact: true }).click();
  await sourceCards.first().locator(".store-open").click();
  await expect(page.locator(".detail-card")).toContainText(label + "候选");
  await expect(
    page.locator(".detail-card").getByLabel("一句话线索"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭门店详情" }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.screenshot({ path: "/tmp/poor-map-discovery-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".discovery-note")).toContainText("已保存", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "看列表", exact: true }).click();
  assert.ok((await sourceCards.count()) > 0);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/poor-map-discovery-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(new URL("#/water", url).href, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".water-candidates summary b")).not.toHaveText(
    "0",
    { timeout: 60000 },
  );
  await page.locator(".water-candidates summary").click();
  await expect(page.locator(".water-candidates")).toContainText(label);
  await expect(page.locator(".water-candidates")).toContainText("价格尚未收录");
  await expect(page.locator(".water-candidates > p")).not.toContainText(
    "正在",
    { timeout: 60000 },
  );
  await expect(page.locator(".water-offer")).toHaveCount(2);
  await expect(page.locator(".water-offer").first()).toContainText("0.67");
  const candidateCount = Number(
    await page.locator(".water-candidates summary b").textContent(),
  );
  await page.screenshot({ path: "/tmp/poor-map-discovery-water.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        url,
        homeCandidates: homeCount,
        waterCandidates: candidateCount,
        genuineTiles: true,
        desktopAndMobile: true,
        queries,
        errors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
}
