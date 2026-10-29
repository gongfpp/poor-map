import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const vars = parse(readFileSync(".env", "utf8"));
assert.ok(
  vars.QA_TOKEN && vars.ANALYTICS_TOKEN,
  "Private QA credentials required",
);
const backend =
  process.env.ANALYTICS_TEST_API || "https://poor-map-api.gong7968.workers.dev";
const website = process.argv[2] || "https://gongfpp.github.io/poor-map/";
const scope = "analytics-" + randomUUID();
const qa = { "x-qa-token": vars.QA_TOKEN, "x-qa-scope": scope };
async function call(path, method = "GET", data) {
  const r = await fetch(backend + path, {
    method,
    headers: {
      ...qa,
      authorization: "Bearer " + vars.ANALYTICS_TOKEN,
      "content-type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.ok, true, `HTTP ${r.status} ${path}`);
  return r.json();
}
let browser;
try {
  console.log("Checking public authorization");
  assert.equal(
    (
      await fetch(backend + "/api/analytics/stats", {
        signal: AbortSignal.timeout(20000),
      })
    ).status,
    403,
  );
  console.log("Checking browser events");
  browser = await chromium.launch({ channel: "chrome" });
  const receipts = [];
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    await context.route("**/api/analytics/events", (route) =>
      route.continue({ headers: { ...route.request().headers(), ...qa } }),
    );
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.url().endsWith("/api/analytics/events")) receipts.push(r.status());
    });
    console.log(`Checking viewport ${viewport.width}`);
    await page.goto(website, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("地图门店类型")).toBeVisible({
      timeout: 30000,
    });
    await page.getByLabel("地图门店类型").selectOption("discount");
    await expect
      .poll(
        async () => {
          const d = await call("/api/analytics/stats");
          return d.dimensions.some(
            (x) =>
              x.name === "page_view" &&
              x.properties.size ===
                (viewport.width < 800 ? "mobile" : "desktop"),
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const previousWaterViews =
      (await call("/api/analytics/stats")).events.find(
        (x) => x.page === "water" && x.name === "page_view",
      )?.count || 0;
    await page.goto(website + "#/water", { waitUntil: "domcontentloaded" });
    await expect
      .poll(
        async () => {
          const d = await call("/api/analytics/stats");
          return d.events.some(
            (x) =>
              x.page === "water" &&
              x.name === "page_view" &&
              x.count > previousWaterViews,
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `/tmp/poor-map-analytics-${viewport.width}.png`,
      fullPage: true,
    });
    await context.close();
  }
  console.log("Checking deduplication and private fields");
  const sample = {
    session: randomUUID(),
    events: [
      {
        id: randomUUID(),
        page: "home",
        name: "search",
        properties: {
          length: 8,
          query: "PRIVATE_SEARCH",
          location: [121.5, 29.8],
          content: "PRIVATE_COMMENT",
        },
      },
    ],
  };
  const before = await call("/api/analytics/stats");
  await call("/api/analytics/events", "POST", sample);
  await call("/api/analytics/events", "POST", sample);
  const after = await call("/api/analytics/stats");
  assert.equal(after.summary.events, before.summary.events + 1);
  assert.ok(!JSON.stringify(after).includes("PRIVATE_"));
  const stored = Number(
    execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "ubuntu@212.64.11.71",
        `sudo -u poor-map-analytics python3 -c 'import sqlite3,json,sys; db=sqlite3.connect("file:/var/lib/poor-map-analytics/events.sqlite?mode=ro",uri=True); print(db.execute("SELECT COUNT(*) FROM analytics_events WHERE scope=?",(json.load(sys.stdin),)).fetchone()[0])'`,
      ],
      { input: JSON.stringify("qa:" + scope), encoding: "utf8" },
    ),
  );
  assert.equal(stored, after.summary.events);
  console.log("Checking opt-out and Do Not Track");
  for (const mode of ["opt-out", "dnt"]) {
    const context = await browser.newContext();
    let posts = 0;
    await context.addInitScript((mode) => {
      if (mode === "opt-out") localStorage.setItem("poor-map:analytics", "off");
      else Object.defineProperty(navigator, "doNotTrack", { get: () => "1" });
    }, mode);
    await context.route("**/api/analytics/events", async (route) => {
      posts++;
      await route.abort();
    });
    const page = await context.newPage();
    await page.goto(website, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await context.close();
    assert.equal(posts, 0);
  }
  assert.ok(receipts.length >= 2 && receipts.every((x) => x === 200));
  execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "ubuntu@212.64.11.71",
      "sudo systemctl restart poor-map-analytics",
    ],
    { stdio: "pipe" },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await call("/api/analytics/stats")).summary.events;
        } catch {
          return -1;
        }
      },
      { timeout: 20000 },
    )
    .toBe(after.summary.events);
  console.log(
    JSON.stringify({
      backend: "tencent-via-worker",
      scope,
      desktopAndMobile: true,
      homeAndWater: true,
      events: after.summary.events,
      idempotent: true,
      privateFieldsDropped: true,
      optOutAndDnt: true,
      persistedAfterRestart: true,
      verifiedOnTencentDisk: true,
      receipts,
    }),
  );
} finally {
  await browser?.close();
  await call("/api/analytics/qa", "DELETE");
  assert.equal((await call("/api/analytics/stats")).summary.events, 0);
  console.log("Isolated QA events cleaned.");
}
