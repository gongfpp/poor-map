import { test, expect } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
const fixtures = [
  ...seedStores,
  {
    ...seedStores[0],
    id: "test-zhao",
    name: "测试赵一鸣",
    location: [121.552, 29.875],
  },
  {
    ...seedStores[0],
    id: "test-mixue",
    name: "测试蜜雪冰城",
    category: "mixue",
    location: [121.55, 29.875],
  },
];
let comments: any[] = [];
test.beforeEach(async ({ page }) => {
  comments = [];
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
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ json: { stores: fixtures } }),
  );
  await page.route("**/api/analytics/events", (r) =>
    r.fulfill({ json: { accepted: 1 } }),
  );
  await page.route("**/api/community/comments**", async (r) => {
    if (r.request().method() === "POST") {
      const x = r.request().postDataJSON(),
        parent = comments.find((c) => c.id === x.parentId),
        c = {
          ...x,
          id: "c" + comments.length,
          rootId: parent?.rootId || "c" + comments.length,
          parentId: x.parentId || null,
          createdAt: new Date().toISOString(),
        };
      comments.push(c);
      await r.fulfill({ status: 201, json: { comment: c } });
    } else
      await r.fulfill({
        json: {
          comments: comments.filter(
            (c) =>
              c.storeId ===
              new URL(r.request().url()).searchParams.get("store"),
          ),
        },
      });
  });
  await page.goto("/");
  if (
    await page.getByRole("button", { name: "看列表", exact: true }).isVisible()
  )
    await page.getByRole("button", { name: "看列表", exact: true }).click();
});
test("shared stores default to all, only two categories and no product price controls", async ({
  page,
}) => {
  await expect(page.locator(".store-card")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("价格上限")).toHaveCount(0);
  await expect(page.locator(".results")).not.toContainText("演示");
  await expect(page.locator(".results")).not.toContainText("¥");
  await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.getByLabel("搜索门店或优惠").fill("好特卖");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.getByLabel("搜索门店或优惠").fill("");
  await page.getByRole("button", { name: "蜜雪冰城", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
});
test("bookmarks survive reload and coarse location remains labelled", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "收藏 好特卖 · 天一广场东鼓道", exact: true })
    .click();
  await page.reload();
  if (
    await page.getByRole("button", { name: "看列表", exact: true }).isVisible()
  )
    await page.getByRole("button", { name: "看列表", exact: true }).click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.locator(".store-open").click();
  await expect(page.locator(".detail-card")).toContainText("商圈参考位置");
});
test("one sentence sharing and replies persist after reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "分享省钱线索" }).click();
  await page.getByLabel("一句话线索").fill("水价0.9元");
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await expect(page.locator(".community-comment")).toContainText("水价0.9元");
  await page.getByRole("button", { name: "回复 / 纠错" }).click();
  await page.getByLabel("一句话线索").fill("只限小瓶");
  await page.getByRole("button", { name: "发送回复" }).click();
  await expect(page.locator(".community-comment.reply")).toContainText(
    "只限小瓶",
  );
  await page.reload();
  await page.getByRole("button", { name: "分享省钱线索" }).click();
  await expect(page.locator(".community-comment")).toHaveCount(2);
});
test("failed shared request displays retry and never switches to samples", async ({
  page,
}) => {
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ status: 503, json: { error: "共享门店暂不可用" } }),
  );
  await page.reload();
  if (
    await page.getByRole("button", { name: "看列表", exact: true }).isVisible()
  )
    await page.getByRole("button", { name: "看列表", exact: true }).click();
  await expect(page.getByText("共享门店暂不可用")).toBeVisible();
  await expect(page.locator(".store-card")).toHaveCount(0);
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ json: { stores: fixtures } }),
  );
  await page.getByRole("button", { name: "重新查询", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(3);
});
test("analytics excludes search words and stops after opt out", async ({
  page,
}) => {
  const packets: any[] = [];
  await page.route("**/api/analytics/events", (r) => {
    packets.push(r.request().postDataJSON());
    return r.fulfill({ json: { accepted: 1 } });
  });
  await page.getByLabel("搜索门店或优惠").fill("秘密搜索");
  await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect
    .poll(() => packets.length, { timeout: 10000 })
    .toBeGreaterThan(0);
  expect(JSON.stringify(packets)).not.toContain("秘密搜索");
  await page.getByRole("button", { name: "数据来源与配置" }).click();
  await page.getByLabel("允许匿名使用统计").uncheck();
  packets.length = 0;
  await page.reload();
  await page.waitForTimeout(5500);
  expect(packets).toEqual([]);
});
