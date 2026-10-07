import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import { seedWater } from "../../src/water-domain.ts";
let token = process.env.QA_TOKEN || "";
try {
  token ||= parse(readFileSync(".env")).QA_TOKEN || "";
} catch {}
test.skip(
  !token,
  "Shared write verification requires the local private QA credential.",
);
let scope = "";
test.beforeEach(async ({ page, request }, info) => {
  scope = `${info.project.name}-${randomUUID().slice(0, 8)}`;
  const headers = { "X-QA-Token": token, "X-QA-Scope": scope };
  for (const offer of seedWater) {
    const r = await request.post("/api/water", { headers, data: offer });
    expect(r.status()).toBe(201);
  }
  await page.route("**/api/water**", (r) =>
    r.continue({
      headers: {
        ...r.request().headers(),
        "X-QA-Token": token,
        "X-QA-Scope": scope,
      },
    }),
  );
});
// General water CRUD scenarios use the real isolated local database, without spending basemap quota.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: {
        provider: "tianditu",
        jsKey: "",
        mapReady: false,
        searchReady: false,
      },
    }),
  );
});
test.afterEach(async ({ request }) => {
  await request.delete("/api/water/qa", {
    headers: { "X-QA-Token": token, "X-QA-Scope": scope },
  });
});
test("water entry, normalization and pack/radius filters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "便宜水", exact: true }).click();
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  await expect(page.locator(".water-offer").first()).toContainText("0.67");
  await expect(page.locator(".water-offer").first()).toContainText(
    "一次购买 13.2L",
  );
  await expect(page.locator(".water-offer").last()).toContainText("容量待补充");
  await page.getByRole("button", { name: "大瓶 1.2–2.5L" }).click();
  await expect(page.locator(".water-offer")).toHaveCount(0);
  await page.getByRole("button", { name: "整箱装", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(1);
  await page.getByRole("button", { name: "全部规格", exact: true }).click();
  await page.getByLabel("便宜水搜索半径").selectOption("1000");
  await expect(page.locator(".water-offer")).toHaveCount(1);
  await expect(page.locator(".water-offer")).toContainText("东鼓道");
});
test("editing unknown volume recalculates and persists across another browser", async ({
  page,
  browser,
}) => {
  await page.goto("/#/water");
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  const card = page.locator(".water-offer").filter({ hasText: "东鼓道" });
  await card.getByRole("button", { name: "编辑 / 补信息" }).click();
  await page.getByLabel("单瓶容量（ml，未知留空）").fill("1500");
  await page
    .getByLabel("购买说明 / 限制")
    .fill("QA 隔离验证：1500ml，价格以货架为准。");
  await page.getByRole("button", { name: "保存共享线索" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(card).toContainText("0.6");
  await expect(card).toContainText("0.8");
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.route("**/api/water**", (r) =>
    r.continue({
      headers: {
        ...r.request().headers(),
        "X-QA-Token": token,
        "X-QA-Scope": scope,
      },
    }),
  );
  await second.goto("/#/water");
  await expect(
    second.locator(".water-offer").filter({ hasText: "东鼓道" }),
  ).toContainText("1.5L × 1瓶");
  await other.close();
  await card.getByRole("button", { name: /查看.*历史/ }).click();
  await expect(page.getByRole("dialog")).toContainText("修改前");
});
test("feedback changes availability filter and appears in public history", async ({
  page,
}) => {
  await page.goto("/#/water");
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  const card = page.locator(".water-offer").filter({ hasText: "K11" });
  await card.getByRole("button", { name: "反馈", exact: true }).click();
  await page.getByLabel("补充说明").fill("QA 隔离验证：看到有货。");
  await page.getByRole("button", { name: "公开保存反馈" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("只看用户反馈有货").check();
  await expect(page.locator(".water-offer")).toHaveCount(1);
  await card.getByRole("button", { name: /查看.*历史/ }).click();
  await expect(page.getByRole("dialog")).toContainText("QA 隔离验证");
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await card.getByRole("button", { name: "反馈", exact: true }).click();
  await page.getByLabel("你看到的情况").selectOption("sold-out");
  await page.getByRole("button", { name: "公开保存反馈" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".water-offer")).toHaveCount(0);
  await page.getByLabel("含卖完 / 过期线索").check();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  await card.getByRole("button", { name: "编辑 / 补信息" }).click();
  await page.getByLabel("当前状态").selectOption("unknown");
  await page.getByRole("button", { name: "保存共享线索" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("含卖完 / 过期线索").uncheck();
  await expect(page.locator(".water-offer")).toHaveCount(2);
});
test("conflicting edit leaves draft and does not overwrite a newer price", async ({
  page,
  request,
}) => {
  await page.goto("/#/water");
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  const headers = { "X-QA-Token": token, "X-QA-Scope": scope };
  const data = await (await request.get("/api/water", { headers })).json();
  const o = data.offers.find((o: any) => o.storeName.includes("K11"));
  await page
    .locator(".water-offer")
    .filter({ hasText: "K11" })
    .getByRole("button", { name: "编辑 / 补信息" })
    .click();
  await page.getByLabel("整份价格（元）").fill("1");
  const r = await request.put(`/api/water/${o.id}`, {
    headers,
    data: { ...o, price: 9.9 },
  });
  expect(r.status()).toBe(200);
  await page.getByRole("button", { name: "保存共享线索" }).click();
  await expect(page.getByRole("alert")).toContainText("已经被别人更新");
  await expect(page.getByLabel("整份价格（元）")).toHaveValue("1");
  const after = await (await request.get("/api/water", { headers })).json();
  expect(after.offers.find((item: any) => item.id === o.id).price).toBe(9.9);
});
test("default geolocation centers on device and manual Ningbo selection stays", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 116.3974, latitude: 39.9092 });
  await page.goto("/#/water");
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(
    page.getByText("当前位置 · 已获得设备定位", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".water-offer")).toHaveCount(0);
  await page.getByRole("button", { name: "看宁波线索", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  await expect(
    page.getByText("宁波 · 手动参考中心", { exact: true }),
  ).toBeVisible();
});
test("mobile map/list controls and modal fit screen without overflow", async ({
  page,
}, info) => {
  await page.goto("/#/water");
  if ((page.viewportSize()?.width || 1000) < 800)
    await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".water-offer")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "地图", exact: true }).click();
    await expect(page.locator(".water-map-side")).toBeVisible();
    await page.getByRole("button", { name: "列表", exact: true }).click();
  }
  await page.getByRole("button", { name: "补充水价", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("门店名称").fill("QA隔离门店");
  await page.getByLabel("门店地址").fill("宁波市示例地址");
  await page.getByLabel("水名称 / 品牌").fill("1.5L 饮用水");
  await page.getByLabel("单瓶容量（ml，未知留空）").fill("1500");
  await page.getByLabel("整份价格（元）").fill("2");
  await page.getByLabel("购买说明 / 限制").fill("QA 隔离验证，位置未确认。");
  await page.getByRole("button", { name: "保存共享线索" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".water-unlocated")).toContainText("QA隔离门店");
  await expect(page.locator(".water-offer")).toHaveCount(2);
});
