import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
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
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("response", (r) => {
      if (r.status() >= 400)
        badResponses.push({ url: r.url(), status: r.status() });
    });
    page.on("request", (r) => {
      if (/\/api\/|\/_AMapService\//.test(r.url())) apiRequests.push(r.url());
    });
    await page.goto(url);
    await page.locator(".store-card").first().waitFor();
    assert.equal(await page.locator(".store-card").count(), 12);
    await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
    assert.equal(await page.locator(".store-card").count(), 3);
    await page.getByRole("button", { name: "全部发现", exact: true }).click();
    await page
      .getByRole("button", { name: "收藏 赵一鸣零食 · 街角店", exact: true })
      .click();
    await page.reload();
    await page.getByRole("button", { name: /我的收藏/ }).click();
    assert.equal(await page.locator(".store-card").count(), 1);
    await page.getByRole("button", { name: /优惠活动/ }).click();
    await page.getByLabel("免额外消费").check();
    await page.getByLabel("无需抽签").check();
    await page.getByLabel("价格上限").selectOption("0");
    assert.equal(await page.locator(".store-card").count(), 1);
    assert.ok(
      (await page.locator(".store-title").innerText()).includes("蜜雪冰城"),
    );
    if (name === "mobile")
      await page.getByRole("button", { name: /看地图/ }).click();
    await page
      .getByRole("button", { name: "数据接入说明", exact: true })
      .click();
    assert.ok(
      (await page.getByRole("dialog").innerText()).includes(
        "GitHub Pages · 公开演示版",
      ),
    );
    assert.ok(
      !(await page.getByRole("dialog").innerText()).includes(
        "无法连接本地 API",
      ),
    );
    await page.keyboard.press("Escape");
    await page.locator(".brand").click();
    await page.locator(".store-card").first().waitFor();
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
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(errors, []);
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
