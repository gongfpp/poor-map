import { test, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15000 });
test.setTimeout(45000);
import { seedStores } from "../../src/store-domain";
import { seedWater } from "../../src/water-domain";
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
  await page.route("https://api.tianditu.gov.cn/v2/search**", (r) => {
    const p = JSON.parse(
      new URL(r.request().url()).searchParams.get("postStr")!,
    );
    const pois =
      p.keyWord === "蜜雪冰城"
        ? [
            {
              name: "蜜雪冰城（公园路店）",
              address: "公园路73号",
              hotPointID: "fixture-mixue",
              lonlat: "121.54278,29.87823",
            },
          ]
        : p.keyWord === "超市"
          ? [
              {
                name: "测试超市",
                address: "公园路",
                hotPointID: "fixture-market",
                lonlat: "121.54278,29.87823",
              },
            ]
          : [];
    return r.fulfill({
      json: { status: { infocode: 1000 }, count: pois.length, pois },
    });
  });
});
async function list(page: any) {
  const button = page.getByRole("button", { name: "看列表", exact: true });
  if (await button.isVisible()) await button.click();
}
test("opening the map automatically discovers a reference shop without a manual store write", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/community/stores") && r.method() === "POST")
      writes++;
  });
  await page.goto("/");
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(2);
  await expect(page.locator(".discovery-note")).toContainText(
    "自动检索到 1 家",
  );
  await page.getByRole("button", { name: "蜜雪冰城", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".store-card")).toContainText("天地图");
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
  expect(writes).toBe(0);
});
test("provider failure is explicit and a retry really repeats the query", async ({
  page,
}) => {
  await page.route("https://api.tianditu.gov.cn/v2/search**", (r) =>
    r.fulfill({ json: { status: { infocode: 3000 } } }),
  );
  await page.goto("/");
  await list(page);
  await expect(page.locator(".discovery-note")).toContainText("暂不可用");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.unroute("https://api.tianditu.gov.cn/v2/search**");
  await page.route("https://api.tianditu.gov.cn/v2/search**", (r) =>
    r.fulfill({ json: { status: { infocode: 3001 }, count: 0 } }),
  );
  await page.getByRole("button", { name: "重查", exact: true }).click();
  await expect(page.locator(".discovery-note")).toContainText(
    "自动检索到 0 家",
  );
});
test("partial POI results stay usable when the separate community service fails", async ({
  page,
}) => {
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ status: 503, json: { error: "共享门店暂不可用" } }),
  );
  await page.route("https://api.tianditu.gov.cn/v2/search**", (r) => {
    const p = JSON.parse(
      new URL(r.request().url()).searchParams.get("postStr")!,
    );
    return r.fulfill({
      json:
        p.keyWord === "蜜雪冰城"
          ? {
              status: { infocode: 1000 },
              count: 30,
              pois: [
                {
                  name: "蜜雪冰城（公园路店）",
                  hotPointID: "fixture-mixue",
                  lonlat: "121.54278,29.87823",
                },
              ],
            }
          : { status: { infocode: 3000 } },
    });
  });
  await page.goto("/");
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".discovery-note")).toContainText("首批20家");
  await expect(page.locator(".discovery-note")).toContainText("查询暂不可用");
  await expect(page.locator(".empty-state")).toContainText("共享门店暂不可用");
  await expect(
    page.getByRole("button", { name: "分享省钱线索" }),
  ).toBeEnabled();
});
test("water candidates appear with no price and do not enter the liter ranking", async ({
  page,
}) => {
  await page.route("**/api/water", (r) =>
    r.fulfill({ json: { offers: seedWater } }),
  );
  await page.goto("/#/water");
  const toggle = page.getByRole("button", { name: "列表", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(".water-candidates summary").click();
  await expect(page.locator(".water-candidates")).toContainText("测试超市");
  await expect(page.locator(".water-candidates")).toContainText("天地图");
  await expect(page.locator(".water-candidates")).toContainText("价格尚未收录");
  await expect(page.locator(".water-offer")).toHaveCount(2);
  await expect(page.locator(".water-results")).not.toContainText("测试超市");
});
