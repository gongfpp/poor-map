import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const url = process.argv[2] || "http://127.0.0.1:5173/",
  backend =
    new URL(url).hostname === "127.0.0.1"
      ? "http://127.0.0.1:8787"
      : "https://poor-map-api.gong7968.workers.dev",
  vars = { ...parse(readFileSync(".env", "utf8")), ...process.env },
  headers = {
    "Content-Type": "application/json",
    "X-QA-Token": vars.QA_TOKEN,
    "X-QA-Scope": "map-" + randomUUID(),
  };
if (!vars.QA_TOKEN) throw new Error("Private QA credential required.");
async function call(path, method = "GET", data) {
  const r = await fetch(backend + path, {
    method,
    headers,
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Map verification API failed (" + r.status + ").");
  return r.json();
}
let b;
try {
  await call("/api/community/stores", "POST", {
    name: "隔离地图验收",
    category: "discount",
    address: "隔离数据",
    location: [121.5549, 29.8731],
  });
  b = await chromium.launch({ channel: "chrome" });
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.route(/\/api\/(community|analytics)\//, (r) =>
    r.continue({ headers: { ...r.request().headers(), ...headers } }),
  );
  const p = await c.newPage(),
    tileResponses = [],
    errors = [];
  p.on("pageerror", (e) =>
    errors.push(e.message.replace(/[a-f0-9]{32}/gi, "[REDACTED]")),
  );
  p.on("response", (r) => {
    const u = new URL(r.url());
    if (
      /^t[0-7]\.tianditu\.gov\.cn$/.test(u.host) ||
      (/amap\.com$/.test(u.host) &&
        (u.pathname.includes("/tile/") || u.pathname.includes("get_tile")))
    )
      tileResponses.push({
        status: r.status(),
        type: r.headers()["content-type"],
      });
  });
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await expect(p.getByRole("button", { name: "标记门店" })).toBeEnabled({
    timeout: 30000,
  });
  await expect
    .poll(() => tileResponses.some((r) => r.status === 200), { timeout: 15000 })
    .toBe(true);
  await expect(p.locator(".map-source")).toContainText(/高德地图|天地图/);
  await expect(
    p.locator(".amap-logo, .leaflet-control-attribution").first(),
  ).toBeVisible();
  await p.getByRole("button", { name: "标记门店" }).click();
  const box = await p.locator(".amap-container:visible, .td-map").boundingBox();
  await p
    .locator(".amap-container:visible, .td-map")
    .click({ position: { x: box.width * 0.55, y: box.height * 0.5 } });
  await p.getByLabel("门店名称").fill("隔离真实底图选点");
  await p.getByRole("button", { name: "保存门店" }).click();
  await expect(p.locator(".detail-card")).toContainText("隔离真实底图选点");
  const d = await call("/api/community/stores");
  assert.equal(d.stores.length, 2);
  assert.ok(
    d.stores
      .find((s) => s.name === "隔离真实底图选点")
      .location.every(Number.isFinite),
  );
  await p.getByRole("button", { name: "关闭门店详情" }).click();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload({ waitUntil: "domcontentloaded" });
  await expect(p.getByRole("button", { name: "标记门店" })).toBeEnabled({
    timeout: 30000,
  });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.getByRole("button", { name: "看列表", exact: true }).click();
  await p
    .locator(".store-card")
    .filter({ hasText: "隔离真实底图选点" })
    .locator(".store-open")
    .click();
  await expect(p.locator(".detail-card")).toContainText("用户标记");
  await expect(p.getByRole("button", { name: "关闭门店详情" })).toBeVisible();
  await p.getByRole("button", { name: "关闭门店详情" }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      genuineTiles: true,
      explicitLocationShared: true,
      mobileDetails: true,
      attribution: true,
      tileRequests: tileResponses.length,
      errors: errors.length,
    }),
  );
} finally {
  await b?.close();
  await call("/api/community/qa", "DELETE");
}
