import { test, expect } from "@playwright/test";
test("demo shell, categories, search and screenshots", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "穷鬼地图",
  );
  await expect(page.locator(".store-card")).toHaveCount(12);
  await page.screenshot({
    path: `docs/preview-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(3);
  await page.getByLabel("搜索门店或优惠").fill("好特卖");
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.getByLabel("搜索门店或优惠").fill("不存在的门店");
  await expect(
    page.getByRole("heading", { name: "没有匹配的门店" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("activity conditions exclude lottery and minimum consumption correctly", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /优惠活动/ }).click();
  await expect(page.locator(".store-card")).toHaveCount(4);
  await page.getByLabel("免额外消费").check();
  await expect(page.locator(".store-card")).toHaveCount(3);
  await page.getByLabel("无需抽签").check();
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.getByLabel("价格上限").selectOption("0");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".store-title")).toContainText("蜜雪冰城");
  await page.getByLabel("有原始链接").check();
  await expect(page.locator(".store-card")).toHaveCount(0);
});
test("bookmark persists after reload, details cannot navigate fictitious address", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "收藏 赵一鸣零食 · 街角店", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.locator(".store-open").click();
  await expect(page.locator(".detail-card")).toContainText("演示门店");
  await page.getByRole("button", { name: "到这里去" }).click();
  await expect(page.getByRole("status")).toContainText("不能用于导航");
  await page.screenshot({
    path: `docs/detail-${info.project.name}.png`,
    fullPage: true,
  });
});
test("local activity is saved, source-labelled, reloadable and deletable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "分享省钱线索" }).click();
  await page.getByLabel("活动标题").fill("测试活动 0.01 元");
  await page.getByLabel("领取价（元）", { exact: true }).fill("0.01");
  const tomorrow = new Date(Date.now() + 86400000),
    local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  await page.getByLabel("活动截止时间").fill(local);
  await page
    .getByLabel("参与条件")
    .fill("仅新客到店领取，无需额外消费，不要求发帖。");
  await page
    .getByLabel("原始活动链接")
    .fill("https://www.dianping.com/example");
  await page.getByRole("button", { name: "保存到本地" }).click();
  await page.reload();
  await page.getByRole("button", { name: /优惠活动/ }).click();
  await page.getByLabel("搜索门店或优惠").fill("测试活动");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.locator(".store-open").click();
  await expect(page.locator(".deal-detail")).toContainText("本地线索 · 未核验");
  await expect(page.locator(".deal-detail")).toContainText("¥0.01");
  await expect(
    page.getByRole("link", { name: "查看原始活动" }),
  ).toHaveAttribute("href", "https://www.dianping.com/example");
  await page.getByRole("button", { name: "删除本地线索" }).click();
  await expect(page.locator(".store-card")).toHaveCount(0);
});
test("missing keys show actionable configuration and modal restores keyboard focus", async ({
  page,
}, info) => {
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /看地图/ }).click();
  await page.getByRole("button", { name: "切换真实数据" }).click();
  await expect(page.getByRole("dialog")).toContainText("未配置");
  await expect(page.getByRole("dialog")).toContainText(".env.example");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "切换真实数据" }),
  ).toBeFocused();
});
test("city isolation and mobile layout have no horizontal overflow", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "收藏 赵一鸣零食 · 街角店", exact: true })
    .click();
  await page.locator(".location-button").click();
  await page.getByRole("button", { name: "杭州", exact: true }).click();
  await page.getByRole("button", { name: /我的收藏/ }).click();
  await expect(page.locator(".store-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: /看地图/ }).click();
    await expect(page.locator(".map-panel")).toBeVisible();
    await page.getByRole("button", { name: "看列表" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
  }
});
test("real mode adapter handles retry, unknown price and no fabricated activities", async ({
  page,
}, info) => {
  let calls = 0;
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { jsKey: "", mapReady: false, searchReady: true } }),
  );
  await page.route("**/api/nearby?*", (r) => {
    calls++;
    return calls === 1
      ? r.fulfill({ status: 502, json: { error: "高德查询失败（10003）" } })
      : r.fulfill({
          json: {
            stores: [
              {
                id: "real-1",
                name: "真实门店测试返回",
                category: "snack",
                location: [121.551, 29.875],
                address: "测试返回地址",
                tags: ["价格待确认"],
                source: "amap",
              },
            ],
            warnings: [],
            queriedAt: new Date().toISOString(),
          },
        });
  });
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /看地图/ }).click();
  await page.getByRole("button", { name: "切换真实数据" }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "看列表" }).click();
  await expect(page.getByText("高德查询失败（10003）")).toBeVisible();
  await page.getByRole("button", { name: "重新查询" }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".store-card")).toContainText("价格待确认");
  await page.getByLabel("价格上限").selectOption("0");
  await expect(page.locator(".store-card")).toHaveCount(0);
  await page.getByLabel("价格上限").selectOption("Infinity");
  await page.getByRole("button", { name: /优惠活动/ }).click();
  await expect(page.locator(".store-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "暂无匹配的活动" }),
  ).toBeVisible();
});

test("browser location converts coordinates and custom address recenters query", async ({
  page,
  context,
}, info) => {
  let queriedCenter = "";
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 116.3974, latitude: 39.9092 });
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { jsKey: "", mapReady: false, searchReady: true } }),
  );
  await page.route("**/api/nearby?*", (r) => {
    queriedCenter = new URL(r.request().url()).searchParams.get("center") || "";
    return r.fulfill({
      json: { stores: [], warnings: [], queriedAt: new Date().toISOString() },
    });
  });
  await page.route("**/api/center?*", (r) =>
    r.fulfill({ json: { center: [120.15, 30.27], label: "测试街道" } }),
  );
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /看地图/ }).click();
  await page.getByRole("button", { name: "切换真实数据" }).click();
  await page.getByRole("button", { name: "定位到我", exact: true }).click();
  await expect.poll(() => queriedCenter).toMatch(/^116\.40/);
  expect(Number(queriedCenter.split(",")[1])).toBeGreaterThan(39.91);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "看列表" }).click();
  await expect(page.locator(".location-button")).toContainText("当前位置");
  await page.locator(".location-button").click();
  await page.getByLabel("自定义城市 / 街道 / 地址").fill("杭州测试街道");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect.poll(() => queriedCenter).toBe("120.15,30.27");
  await expect(page.locator(".location-button")).toContainText("测试街道");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
