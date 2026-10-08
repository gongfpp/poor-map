import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { preview } from "vite";
const remoteUrl = process.argv[2];
const server = remoteUrl
  ? null
  : await preview({
      mode: "pages",
      build: { outDir: "pages-dist" },
      preview: { host: "127.0.0.1", port: 0, strictPort: true },
    });
const url =
  remoteUrl || `http://127.0.0.1:${server.httpServer.address().port}/poor-map/`;
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (attempt === 49) throw new Error("Pages URL did not become available.");
    await delay(200);
  }
  browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 960 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [],
      badResponses = [],
      apiRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error")
        errors.push(m.text().replace(/[a-f0-9]{32}/gi, "[REDACTED]"));
    });
    page.on("response", (r) => {
      if (r.status() >= 400)
        badResponses.push({
          url: r.url().replace(/[a-f0-9]{32}/gi, "[REDACTED]"),
          status: r.status(),
        });
    });
    page.on("request", (r) => {
      if (/\/api\/|\/_AMapService\//.test(r.url())) apiRequests.push(r.url());
    });
    if (!remoteUrl) {
      // Read-only bridge for a random-port local static preview; production CORS stays narrow.
      await page.route(
        /^https:\/\/poor-map-api\.gong7968\.workers\.dev\/(?:api\/(?:water\/(?:config|candidates)|community\/stores)|_AMapService\/)/,
        async (r) => {
          const upstream = await fetch(r.request().url());
          await r.fulfill({
            status: upstream.status,
            headers: {
              "Content-Type":
                upstream.headers.get("content-type") || "application/json",
              "Access-Control-Allow-Origin": new URL(url).origin,
            },
            body: await upstream.text(),
          });
        },
      );
    }
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".store-card").first().waitFor({ state: "attached" });
    const count = await page.locator(".store-card").count();
    assert.ok(count >= 1);
    if (name === "mobile")
      await page.getByRole("button", { name: "看列表", exact: true }).click();
    assert.ok(!(await page.locator(".results").innerText()).includes("演示"));
    await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
    assert.ok((await page.locator(".store-card").count()) >= 1);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page
      .getByRole("button", {
        name: "收藏 好特卖 · 天一广场东鼓道",
        exact: true,
      })
      .click();
    await page.reload({ waitUntil: "domcontentloaded" });
    if (name === "mobile")
      await page.getByRole("button", { name: "看列表", exact: true }).click();
    await page.getByRole("button", { name: "我的收藏", exact: true }).click();
    await expect(page.locator(".store-card")).toHaveCount(1);
    assert.equal(await page.getByLabel("价格上限").count(), 0);
    await page.getByRole("button", { name: "数据来源与配置" }).click();
    assert.ok(
      (await page.getByRole("dialog").innerText()).match(/高德|天地图/),
    );
    await page.keyboard.press("Escape");
    await page.locator(".brand").click();
    if (name === "mobile")
      await page.getByRole("button", { name: "看列表", exact: true }).click();
    await page.locator(".store-card").first().waitFor({ state: "attached" });
    assert.equal(new URL(page.url()).pathname, "/poor-map/");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: `/tmp/poor-map-pages-${name}.png`,
      fullPage: true,
    });
    assert.ok(
      apiRequests.every(
        (u) =>
          u.startsWith("https://poor-map-api.gong7968.workers.dev/") &&
          (/\/api\/(analytics|community|water)\//.test(u) ||
            u.includes("/_AMapService/")),
      ),
    );
    assert.deepEqual(
      errors,
      [],
      JSON.stringify(
        badResponses.map((r) => ({
          path: new URL(r.url).pathname,
          status: r.status,
        })),
      ),
    );
    assert.deepEqual(badResponses, []);
    results.push({
      viewport: name,
      passed: true,
      apiRequests: apiRequests.length,
      errors: errors.length,
    });
    await context.close();
  }
  if (remoteUrl) {
    const meta = await (await fetch(new URL("deploy-meta.json", url))).json();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    assert.equal(meta.sourceSha, head);
    results.push({ sourceSha: head, mode: meta.mode });
  }
  console.log(JSON.stringify({ url, results }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
