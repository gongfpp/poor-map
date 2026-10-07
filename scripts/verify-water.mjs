import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { seedWater } from "../src/water-domain.ts";
const url = process.argv[2] || "http://127.0.0.1:5173/#/water";
const backend =
  new URL(url).hostname === "127.0.0.1"
    ? "http://127.0.0.1:8787"
    : "https://poor-map-api.gong7968.workers.dev";
const token = process.env.QA_TOKEN || parse(readFileSync(".env")).QA_TOKEN;
if (!token)
  throw new Error(
    "Private QA credential required; do not test writes in the public dataset.",
  );
const scope = "verify-" + randomUUID(),
  headers = {
    "Content-Type": "application/json",
    "X-QA-Token": token,
    "X-QA-Scope": scope,
  };
async function call(path = "", method = "GET", data) {
  const r = await fetch(backend + "/api/water" + path, {
    method,
    headers,
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw new Error(`Water verification request failed (${r.status}).`);
  return r.json();
}
let browser;
try {
  const publicBefore = await (await fetch(backend + "/api/water")).json();
  assert.ok(publicBefore.offers.some((o) => o.id === "ningbo-k11-water"));
  for (const offer of seedWater) await call("", "POST", offer);
  browser = await chromium.launch({ channel: "chrome" });
  const errors = [];
  const publicPage = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  publicPage.on("pageerror", (e) => errors.push(e.message));
  publicPage.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await publicPage.goto(url);
  await publicPage.locator(".water-offer").first().waitFor();
  assert.ok(
    (await publicPage.locator(".water-offer").allTextContents()).some((t) =>
      t.includes("用户提供"),
    ),
  );
  await publicPage.screenshot({
    path: "/tmp/poor-map-water-live-desktop.png",
    fullPage: true,
  });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await publicPage.screenshot({
    path: "/tmp/poor-map-water-live-mobile.png",
    fullPage: true,
  });
  await publicPage.getByRole("button", { name: "地图", exact: true }).click();
  assert.ok(await publicPage.locator(".water-map-side").isVisible());
  await publicPage.getByRole("button", { name: "列表", exact: true }).click();
  const first = await browser.newContext(),
    second = await browser.newContext();
  for (const context of [first, second])
    await context.route("**/api/water**", (r) =>
      r.continue({
        headers: {
          ...r.request().headers(),
          "X-QA-Token": token,
          "X-QA-Scope": scope,
        },
      }),
    );
  const writer = await first.newPage();
  await writer.goto(url);
  await writer.locator(".water-offer").first().waitFor();
  await writer
    .locator(".water-offer")
    .filter({ hasText: "K11" })
    .getByRole("button", { name: "编辑 / 补信息" })
    .click();
  await writer.getByLabel("整份价格（元）").fill("9.9");
  await writer.getByRole("button", { name: "保存共享线索" }).click();
  await writer.getByRole("dialog").waitFor({ state: "hidden" });
  const reader = await second.newPage();
  await reader.goto(url);
  if ((reader.viewportSize()?.width || 1000) < 800)
    await reader.getByRole("button", { name: "列表", exact: true }).click();
  await reader.locator(".water-offer").first().waitFor();
  assert.ok(
    (
      await reader
        .locator(".water-offer")
        .filter({ hasText: "K11" })
        .innerText()
    ).includes("¥9.9"),
  );
  await reader
    .locator(".water-offer")
    .filter({ hasText: "K11" })
    .getByRole("button", { name: "反馈", exact: true })
    .click();
  await reader.getByLabel("补充说明").fill("隔离 QA 验证，不写入公开线索。");
  await reader.getByRole("button", { name: "公开保存反馈" }).click();
  await reader.getByRole("dialog").waitFor({ state: "hidden" });
  await reader.getByLabel("只看用户反馈有货").check();
  await reader.locator(".water-offer").nth(1).waitFor({ state: "hidden" });
  assert.equal(await reader.locator(".water-offer").count(), 1);
  const qa = await call();
  assert.equal(
    qa.offers.find((o) => o.storeName.includes("K11")).feedback.available,
    1,
  );
  assert.equal(
    (
      await call(
        "/" +
          qa.offers.find((o) => o.storeName.includes("K11")).id +
          "/history",
      )
    ).revisions.length,
    2,
  );
  const publicAfter = await (await fetch(backend + "/api/water")).json();
  assert.equal(
    publicAfter.offers.find((o) => o.id === "ningbo-k11-water").price,
    publicBefore.offers.find((o) => o.id === "ningbo-k11-water").price,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        url,
        backend,
        publicRead: true,
        desktop: true,
        mobile: true,
        sharedEditAcrossBrowsers: true,
        sharedFeedback: true,
        publicDatasetUnchanged: true,
        errors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await call("/qa", "DELETE");
}
