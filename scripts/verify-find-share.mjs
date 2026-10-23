import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { preview } from "vite";

// 无参数验证本地 Pages 构建，使用线上真实只读接口；传 URL 则验证已发布版本。
const remote = process.argv[2];
const server = remote
  ? null
  : await preview({
      mode: "pages",
      build: { outDir: "pages-dist" },
      preview: { host: "127.0.0.1", port: 0, strictPort: true },
    });
const url =
  remote || `http://127.0.0.1:${server.httpServer.address().port}/poor-map/`;
const backend = "https://poor-map-api.gong7968.workers.dev";
const exec = promisify(execFile);
async function bridge(route) {
  assert.equal(route.request().method(), "GET", "实测不得写公开数据");
  try {
    const { stdout } = await exec(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "25",
        "--write-out",
        "\n%{content_type}\n%{http_code}",
        route.request().url(),
      ],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
    );
    const statusOffset = stdout.lastIndexOf(10);
    const typeOffset = stdout.lastIndexOf(10, statusOffset - 1);
    await route.fulfill({
      status: Number(stdout.subarray(statusOffset + 1).toString()),
      headers: {
        "content-type":
          stdout.subarray(typeOffset + 1, statusOffset).toString() ||
          "application/json",
        "access-control-allow-origin": new URL(url).origin,
      },
      body: stdout.subarray(0, typeOffset),
    });
  } catch {
    console.error(
      `只读联调连接失败: ${new URL(route.request().url()).pathname}`,
    );
    // Preserve a real transport failure in the UI instead of crashing the runner.
    await route.abort("failed");
  }
}
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  for (const [size, viewport] of [
    ["desktop", { width: 1440, height: 960 }],
    ["mobile", { width: 390, height: 844 }],
    ["narrow", { width: 320, height: 568 }],
  ]) {
    if (
      process.env.VERIFY_VIEWPORT &&
      !process.env.VERIFY_VIEWPORT.split(",").includes(size)
    )
      continue;
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() =>
      localStorage.setItem("poor-map:analytics", "off"),
    );
    const page = await context.newPage();
    let recoveredReads = 0;
    const errors = [],
      queries = [],
      writes = [],
      tiles = [];
    if (!remote) await context.route(`${backend}/**`, bridge);
    page.on("pageerror", (e) =>
      errors.push(e.message.replace(/[a-f0-9]{32}/gi, "[REDACTED]")),
    );
    page.on("request", (r) => {
      if (r.url().startsWith(backend) && r.method() !== "GET")
        writes.push(new URL(r.url()).pathname);
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/water/candidates")
        queries.push({ method: r.request().method(), status: r.status() });
      if (
        /amap\.com$/.test(u.hostname) &&
        /\/tile\/|get_tile/.test(u.pathname) &&
        r.status() === 200
      )
        tiles.push(true);
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".location-help")).toContainText("当前查看宁波", {
      timeout: 20000,
    });
    await expect(
      page.getByRole("button", { name: "选择位置", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `/tmp/poor-map-location-${size}.png` });
    await page.getByRole("button", { name: "选择位置", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^宁波/ })
      .click();
    await expect(page.locator(".location-help")).toHaveCount(0);
    await expect(page.locator(".discovery-note")).toContainText(
      /已保存 \d+ 家/,
      { timeout: 60000 },
    );
    await expect
      .poll(() => tiles.length, { timeout: 30000 })
      .toBeGreaterThan(0);
    await expect(page.locator(".map-source")).toContainText("高德地图");
    await page.getByLabel("地图门店类型").selectOption("discount");
    await expect(
      page.getByLabel("地图门店品牌").locator("option[value='好特卖']"),
    ).toBeAttached();
    await page.getByLabel("地图门店品牌").selectOption("好特卖");
    const open = page.getByRole("button", { name: "看列表", exact: true });
    if (await open.isVisible()) await open.click();
    await expect(page.getByLabel("门店品牌", { exact: true })).toHaveValue(
      "好特卖",
    );
    await expect(page.locator(".store-card").first()).toBeVisible();
    const names = await page.locator(".store-title strong").allTextContents();
    assert.ok(
      names.length && names.every((name) => /好特卖|hotmaxx/i.test(name)),
    );
    if (viewport.width < 800)
      await page.locator(".map-list-scroll").evaluate((el) => {
        el.scrollTop = 130;
      });
    // Vector tiles paint after the response and SDK ready callback.
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `/tmp/poor-map-find-${size}.png` });
    await page.locator(".store-open").first().click();
    await expect(
      page.getByRole("button", { name: "复制门店链接" }),
    ).toBeInViewport({ ratio: 1 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(url).origin,
    });
    const name = await page.locator(".detail-card h3").innerText();
    await page.getByRole("button", { name: "复制门店链接" }).click();
    await expect(page.locator(".toast")).toContainText("已复制");
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(shared.startsWith(url.split("#")[0] + "#/store/"));
    assert.equal(new URL(shared).search, "");
    const friendContext = await browser.newContext({ viewport });
    await friendContext.addInitScript(() =>
      localStorage.setItem("poor-map:analytics", "off"),
    );
    if (!remote) await friendContext.route(`${backend}/**`, bridge);
    try {
      const friend = await friendContext.newPage();
      async function readSharedStore() {
        for (let attempt = 0; attempt < 3; attempt++) {
          await expect
            .poll(
              async () =>
                (await friend.locator(".detail-card h3").count()) > 0 ||
                (await friend.locator(".shared-store-message button").count()) >
                  0,
              { timeout: 22000 },
            )
            .toBe(true);
          if (await friend.locator(".detail-card h3").count()) {
            await expect(friend.locator(".detail-card h3")).toHaveText(name);
            return;
          }
          if (attempt === 2)
            throw new Error(`${size}: 分享门店重试后仍无法读取`);
          recoveredReads++;
          await friend
            .locator(".shared-store-message")
            .getByRole("button", { name: "重试", exact: true })
            .click();
        }
      }
      await friend.goto(shared, { waitUntil: "domcontentloaded" });
      await readSharedStore();
      await expect(friend.locator(".community")).toBeVisible();
      await expect(friend.locator(".location-help")).toHaveCount(0);
      await friend.reload({ waitUntil: "domcontentloaded" });
      await readSharedStore();
      await expect(friend.locator(".map-source")).toContainText("高德地图", {
        timeout: 30000,
      });
      await friend.waitForTimeout(4000);
      await friend.screenshot({ path: `/tmp/poor-map-share-${size}.png` });
    } finally {
      await friendContext.close();
    }
    await page.goto(new URL("#/water", url).href, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".location-help")).toBeVisible({
      timeout: 20000,
    });
    await page.getByRole("button", { name: "关闭定位提示" }).click();
    const waterList = page.getByRole("button", { name: "列表", exact: true });
    if (await waterList.isVisible()) await waterList.click();
    await expect(
      page.getByLabel("水价门店品牌").locator("option[value='好特卖']"),
    ).toBeAttached({ timeout: 30000 });
    await page.getByLabel("水价门店品牌").selectOption("好特卖");
    await expect(page.locator(".water-result-meta")).toContainText(
      "1 条范围内水价",
    );
    await expect(page.locator(".map-source")).toContainText("高德地图", {
      timeout: 30000,
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `/tmp/poor-map-water-brand-${size}.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    assert.ok(
      queries.length &&
        queries.every((q) => q.method === "GET" && q.status === 200),
    );
    results.push({
      size,
      passed: true,
      realTiles: tiles.length,
      cacheReads: queries.length,
      sharedStore: name,
      recoveredReads,
    });
    console.log(
      `${size}: 真实底图、品牌筛选、分享直达与水价筛选通过；读取重试 ${recoveredReads} 次`,
    );
    await context.close();
  }
  if (remote) {
    const meta = await (await fetch(new URL("deploy-meta.json", url))).json();
    assert.equal(
      meta.sourceSha,
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
    results.push({ sourceSha: meta.sourceSha });
  }
  console.log(JSON.stringify({ url, results, readOnly: true }, null, 2));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
