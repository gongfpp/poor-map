import { test, expect as baseExpect } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
import { seedWater } from "../../src/water-domain";
const expect = baseExpect.configure({ timeout: 15000 });
test.setTimeout(45000);
const fixture = {
  id: "td-fixture-mixue",
  name: "蜜雪冰城（公园路店）",
  address: "公园路73号",
  category: "mixue",
  location: [121.548, 29.874],
  source: "tianditu",
  tags: [],
  locationPrecision: "poi",
  cachedAt: "2000-01-01T00:00:00Z",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=",
  "base64",
);
test.beforeEach(async ({ page }) => {
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: {
        provider: "tianditu",
        jsKey: "test-discovery-key",
        mapReady: true,
        searchReady: false,
        cacheReady: true,
      },
    }),
  );
  await page.route("https://t*.tianditu.gov.cn/**", (r) =>
    r.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ json: { stores: seedStores } }),
  );
  await page.route("**/api/community/comments**", (r) =>
    r.fulfill({ json: { comments: [] } }),
  );
  await page.route("**/api/analytics/events", (r) =>
    r.fulfill({ json: { accepted: 1 } }),
  );
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        stores: [fixture],
        configured: true,
        cacheOnly: true,
        fetchedAt: fixture.cachedAt,
        warnings: [],
      },
    }),
  );
});
async function list(page: any) {
  const button = page.getByRole("button", { name: "看列表", exact: true });
  if (await button.isVisible()) await button.click();
}
test("cached shops load without provider search; only explicit refresh posts", async ({
  page,
}) => {
  let writes = 0,
    vendorSearch = 0,
    refreshes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/community/stores") && r.method() === "POST")
      writes++;
    if (/api.tianditu.*v2\/search|restapi.amap.*place/.test(r.url()))
      vendorSearch++;
    if (r.url().includes("/api/water/candidates") && r.method() === "POST")
      refreshes++;
  });
  await page.goto("/");
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(2);
  await expect(page.locator(".discovery-note")).toContainText("已保存 1 家");
  await expect(page.locator(".discovery-note")).toContainText("2000");
  await page.getByRole("button", { name: "蜜雪冰城", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".store-card")).not.toContainText("¥");
  await page
    .getByRole("button", { name: "收藏 蜜雪冰城（公园路店）", exact: true })
    .click();
  await page.reload();
  await list(page);
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.locator(".store-open").click();
  await expect(page.locator(".detail-card")).toContainText(
    "天地图候选 · 营业状态待确认",
  );
  await expect(
    page.locator(".detail-card").getByLabel("一句话线索"),
  ).toBeVisible();
  expect(refreshes).toBe(0);
  expect(writes).toBe(0);
  expect(vendorSearch).toBe(0);
  await page.getByRole("button", { name: "关闭门店详情" }).click();
  await list(page);
  await page.getByRole("button", { name: "刷新门店", exact: true }).click();
  await expect.poll(() => refreshes).toBe(1);
});
test("failed refresh retains saved shops; failed cache read uses validated browser copy", async ({
  page,
}) => {
  await page.goto("/");
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({ status: 503, json: { error: "门店来源暂不可用" } }),
  );
  await page.getByRole("button", { name: "刷新门店", exact: true }).click();
  await expect(page.locator(".discovery-note")).toContainText("不会被清空");
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.reload();
  await list(page);
  await expect(page.locator(".discovery-note")).toContainText("离线门店副本");
  await expect(page.locator(".store-card")).toHaveCount(2);
});
test("partial cached POIs remain usable while community service fails", async ({
  page,
}) => {
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ status: 503, json: { error: "共享门店暂不可用" } }),
  );
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        stores: [fixture],
        configured: true,
        cacheOnly: true,
        warnings: ["宁波为已读取的接口结果，可能不完整。"],
      },
    }),
  );
  await page.goto("/");
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".discovery-note")).toContainText("可能不完整");
  await expect(page.locator(".empty-state")).toContainText("共享门店暂不可用");
});
test("water candidates never gain a price or enter the liter ranking", async ({
  page,
}) => {
  await page.route("**/api/water", (r) =>
    r.fulfill({ json: { offers: seedWater } }),
  );
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        stores: [
          {
            ...fixture,
            id: "td-fixture-market",
            name: "测试超市",
            category: "market",
          },
        ],
        configured: true,
        cacheOnly: true,
        warnings: [],
      },
    }),
  );
  await page.goto("/#/water");
  const button = page.getByRole("button", { name: "列表", exact: true });
  if (await button.isVisible()) await button.click();
  await page.locator(".water-candidates summary").click();
  await expect(page.locator(".water-candidates")).toContainText("测试超市");
  await expect(page.locator(".water-candidates")).toContainText("价格尚未收录");
  await expect(page.locator(".water-results .water-offer")).toHaveCount(2);
  await expect(page.locator(".water-results")).not.toContainText("测试超市");
});
test("navigation requires explicit origin, draws valid route and exposes actual walking URI", async ({
  page,
}) => {
  let plans = 0;
  await page.route("**/api/navigation/nearest", (r) => {
    plans++;
    return r.fulfill({
      json: {
        destination: { ...seedStores[0] },
        distance: 650,
        duration: 520,
        polyline: [[121.55027, 29.87386], seedStores[0].location],
        steps: ["沿街道步行"],
        provider: "amap",
        compared: 1,
        comparisonLimited: false,
        warnings: ["仅比较已缓存的门店。"],
      },
    });
  });
  await page.goto("/");
  await list(page);
  await page.locator(".navigation-panel > summary").click();
  await expect(
    page.getByRole("button", { name: "找步行最近的折扣店", exact: true }),
  ).toBeDisabled();
  expect(plans).toBe(0);
  await page
    .getByRole("button", { name: "从地图中心出发（参考）", exact: true })
    .click();
  await page
    .getByRole("button", { name: "找步行最近的折扣店", exact: true })
    .click();
  await expect(page.locator(".navigation-result")).toContainText("步行 650 m");
  const href = await page
    .getByRole("link", { name: "打开高德步行导航" })
    .getAttribute("href");
  expect(href).toContain("/navigation?");
  expect(href).toContain("mode=walk");
  expect(href).not.toContain("key=");
  await expect(page.locator(".navigation-result")).toContainText("参考出发点");
  expect(plans).toBe(1);
  await page
    .getByRole("button", { name: "从地图中心出发（参考）", exact: true })
    .click();
  await expect(page.locator(".navigation-result")).toHaveCount(0);
  await page.route("**/api/navigation/nearest", (r) =>
    r.fulfill({ status: 502, json: { error: "步行路线服务暂不可用" } }),
  );
  await page
    .getByRole("button", { name: "找步行最近的折扣店", exact: true })
    .click();
  await expect(page.locator(".navigation-error")).toContainText("暂不可用");
  await expect(page.locator(".navigation-result")).toHaveCount(0);
});
