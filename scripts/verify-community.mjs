import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const url = process.argv[2] || "http://127.0.0.1:5173/",
  backend =
    new URL(url).hostname === "127.0.0.1"
      ? "http://127.0.0.1:8787"
      : "https://poor-map-api.gong7968.workers.dev";
const vars = { ...parse(readFileSync(".env", "utf8")), ...process.env };
if (!vars.QA_TOKEN || !vars.ANALYTICS_TOKEN)
  throw new Error("Private QA and analytics credentials required.");
const headers = {
    "Content-Type": "application/json",
    "X-QA-Token": vars.QA_TOKEN,
    "X-QA-Scope": "community-" + randomUUID(),
  },
  call = async (path, method = "GET", data) => {
    const r = await fetch(backend + path, {
      method,
      headers: { ...headers, Authorization: `Bearer ${vars.ANALYTICS_TOKEN}` },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Verification failed (${r.status}).`);
    return r.json();
  };
let browser;
try {
  browser = await chromium.launch({ channel: "chrome" });
  const first = await browser.newContext(),
    second = await browser.newContext(),
    errors = [];
  for (const c of [first, second])
    await c.route(/\/api\/(community|analytics)\//, (r) =>
      r.continue({ headers: { ...r.request().headers(), ...headers } }),
    );
  const a = await first.newPage(),
    b = await second.newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  await a.goto(url);
  await a.locator(".store-card").first().waitFor();
  await a.getByRole("button", { name: "分享省钱线索" }).click();
  await a.getByLabel("一句话线索").fill("隔离验收：今天水价0.9元");
  await expect(
    a.getByRole("button", { name: "分享", exact: true }),
  ).toBeEnabled();
  await a.getByRole("button", { name: "分享", exact: true }).click();
  await expect(a.locator(".community-comment")).toHaveCount(1);
  await b.goto(url);
  await b.getByRole("button", { name: "分享省钱线索" }).click();
  await expect(b.locator(".community-comment")).toContainText("隔离验收");
  await b.getByRole("button", { name: "回复 / 纠错" }).click();
  await b.getByLabel("一句话线索").fill("隔离纠错：容量需补充");
  await b.getByRole("button", { name: "发送回复" }).click();
  await expect(b.locator(".community-comment.reply")).toContainText(
    "容量需补充",
  );
  await a.reload();
  await a.getByRole("button", { name: "分享省钱线索" }).click();
  await expect(a.locator(".community-comment")).toHaveCount(2);
  await a.screenshot({
    path: "/tmp/poor-map-community-live.png",
    fullPage: true,
  });
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await a.getByLabel("搜索门店或优惠").fill("此搜索不应被采集");
  await expect
    .poll(
      async () =>
        (await call("/api/analytics/stats")).events
          .filter((e) => e.name === "comment_success")
          .reduce((n, e) => n + e.count, 0),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  const stats = await call("/api/analytics/stats");
  assert.ok(stats.events.some((e) => e.name === "comment_success"));
  assert.ok(!JSON.stringify(stats).includes("此搜索不应被采集"));
  assert.ok(!JSON.stringify(stats).includes("今天水价"));
  assert.deepEqual(errors, []);
  await b.setViewportSize({ width: 390, height: 844 });
  await b.keyboard.press("Escape");
  assert.ok(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await b.screenshot({
    path: "/tmp/poor-map-community-mobile.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      sharedComments: true,
      sharedReplies: true,
      analyticsStored: true,
      qaEvents: stats.summary.events,
      errors: errors.length,
    }),
  );
} finally {
  await browser?.close();
  await call("/api/community/qa", "DELETE");
}
