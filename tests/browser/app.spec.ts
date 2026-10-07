import { test, expect } from "@playwright/test";
let comments: any[] = [];
test.beforeEach(async ({ page }) => {
  comments = [];
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { jsKey: "", mapReady: false, searchReady: false } }),
  );
  await page.route("**/api/analytics/events", (r) =>
    r.fulfill({ json: { accepted: 1 } }),
  );
  await page.route("**/api/community/comments**", async (r) => {
    if (r.request().method() === "POST") {
      const x = r.request().postDataJSON();
      const parent = comments.find((c) => c.id === x.parentId),
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
});
test("only discount and Mixue categories, no single-item prices or price filters", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".store-card")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "全部", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "零食超市", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("价格上限")).toHaveCount(0);
  await expect(page.locator(".results")).not.toContainText("¥");
  await expect(page.locator(".results")).not.toContainText("按需买");
  await page.screenshot({
    path: `docs/preview-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(5);
  await page.getByLabel("搜索门店或优惠").fill("好特卖");
  await expect(page.locator(".store-card")).toHaveCount(2);
  await page.getByLabel("搜索门店或优惠").fill("");
  await page.getByRole("button", { name: "蜜雪冰城", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("bookmarks persist and demo navigation is blocked", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "收藏 赵一鸣零食 · 街角店", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
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
test("one sentence sharing supports corrections and replies after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "分享省钱线索" }).click();
  await expect(page.getByLabel("活动标题")).toHaveCount(0);
  await page.getByLabel("一句话线索").fill("今天水价0.9元");
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await expect(page.locator(".community-comment")).toContainText(
    "今天水价0.9元",
  );
  await page.getByRole("button", { name: "回复 / 纠错" }).click();
  await page.getByLabel("一句话线索").fill("补充：只有小瓶");
  await page.getByRole("button", { name: "发送回复" }).click();
  await expect(page.locator(".community-comment.reply")).toContainText(
    "补充：只有小瓶",
  );
  await page.reload();
  await page.getByRole("button", { name: "分享省钱线索" }).click();
  await expect(page.locator(".community-comment")).toHaveCount(2);
});
test("location selection isolates bookmarks, modal focus and mobile layout", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "收藏 赵一鸣零食 · 街角店", exact: true })
    .click();
  await page.locator(".location-button").click();
  await page.getByRole("button", { name: "杭州", exact: true }).click();
  await page.getByRole("button", { name: "我的收藏", exact: true }).click();
  await expect(page.locator(".store-card")).toHaveCount(0);
  await page.getByRole("button", { name: "数据来源与配置" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "数据来源与配置" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: /看地图/ }).click();
    await expect(page.locator(".map-panel")).toBeVisible();
    await page.getByRole("button", { name: "看列表" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
  }
});
test("anonymous events omit input content and respect opt out", async ({
  page,
}) => {
  const packets: any[] = [];
  await page.route("**/api/analytics/events", (r) => {
    packets.push(r.request().postDataJSON());
    return r.fulfill({ json: { accepted: 1 } });
  });
  await page.goto("/");
  await page.getByLabel("搜索门店或优惠").fill("秘密搜索内容");
  await page.getByRole("button", { name: "硬折扣店", exact: true }).click();
  await expect
    .poll(() => packets.flatMap((p) => p.events).length, { timeout: 10000 })
    .toBeGreaterThan(0);
  expect(JSON.stringify(packets)).not.toContain("秘密搜索内容");
  expect(
    packets.flatMap((p) => p.events).some((e) => e.name === "page_view"),
  ).toBe(true);
  await page.getByRole("button", { name: "数据来源与配置" }).click();
  await page.getByLabel("允许匿名使用统计").uncheck();
  packets.length = 0;
  await page.reload();
  await page.waitForTimeout(5500);
  expect(packets).toEqual([]);
});
