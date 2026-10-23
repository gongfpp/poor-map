import { test, expect, type Page } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
import { seedWater } from "../../src/water-domain";
const stores = [
  seedStores[0],
  {
    ...seedStores[0],
    id: "nb-old",
    name: "盒马 NB（测试老店）",
    location: [121.544, 29.878],
  },
  {
    ...seedStores[0],
    id: "nb-new",
    name: "超盒算NB（测试新店）",
    location: [121.56, 29.878],
  },
  {
    ...seedStores[0],
    id: "other",
    name: "独立小店（好特卖旁）",
    location: [121.54, 29.87],
  },
  {
    ...seedStores[0],
    id: "walmart",
    name: "沃尔玛（测试店）",
    category: "supermarket",
    location: [121.562, 29.87],
  },
];
const distant = {
  ...seedStores[0],
  id: "remote-store",
  name: "好特卖（上海分享店）",
  location: [121.4737, 31.2304],
  address: "公开测试地址",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=",
  "base64",
);
async function list(page: Page, water = false) {
  const open = page.getByRole("button", {
    name: water ? "列表" : "看列表",
    exact: true,
  });
  if (await open.isVisible()) await open.click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: any, fail: any) =>
          queueMicrotask(() => fail({ code: 1 })),
      },
      configurable: true,
    });
  });
  await page.route("https://t*.tianditu.gov.cn/**", (r) =>
    r.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/remote-store"))
      return r.fulfill({ json: { store: distant } });
    const json = path.endsWith("/config")
      ? {
          provider: "tianditu",
          jsKey: "test",
          mapReady: true,
          searchReady: false,
        }
      : path.endsWith("/candidates")
        ? { stores: [], configured: true, warnings: [], cacheOnly: true }
        : path.endsWith("/stores")
          ? { stores }
          : path.endsWith("/water")
            ? { offers: seedWater }
            : path.endsWith("/summary")
              ? { cities: [], groups: [] }
              : { comments: [], accepted: 0 };
    return r.fulfill({ json });
  });
});

test("品牌筛选统一列表和地图，旧名合并，切换类型重置品牌，空结果可恢复", async ({
  page,
}) => {
  let refreshes = 0;
  page.on("request", (r) => {
    if (r.url().includes("/candidates") && r.method() === "POST") refreshes++;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "关闭定位提示" }).click();
  await list(page);
  await expect(page.locator(".store-card")).toHaveCount(5);
  await page.getByLabel("门店品牌", { exact: true }).selectOption("超盒算");
  await expect(page.getByLabel("地图门店品牌")).toHaveValue("超盒算");
  await expect(page.locator(".store-card")).toHaveCount(2);
  await expect
    .poll(async () =>
      page
        .locator(".pin")
        .evaluateAll((els) =>
          els.reduce(
            (n, el) => n + Number((el as HTMLElement).dataset.storeCount),
            0,
          ),
        ),
    )
    .toBe(2);
  await page.getByLabel("地图门店类型").selectOption("supermarket");
  await expect(page.getByLabel("门店品牌", { exact: true })).toHaveValue("all");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await page.getByLabel("地图门店类型").selectOption("all");
  await page.getByLabel("地图门店品牌").selectOption("unknown");
  await expect(page.locator(".store-card")).toHaveCount(1);
  await expect(page.locator(".results")).toContainText("独立小店");
  await page.getByLabel("搜索门店", { exact: true }).fill("不存在");
  await expect(page.locator(".results")).toContainText("不代表这里没有门店");
  await page.getByRole("button", { name: "重置筛选" }).click();
  await expect(page.locator(".store-card")).toHaveCount(5);
  expect(refreshes).toBe(0);
});

test("复制门店链接有手动回退，直达跨城门店不请求 GPS，刷新与同页换链接保持正确门店", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw Error("denied");
        },
      },
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "关闭定位提示" }).click();
  await list(page);
  await page.locator(".store-open").first().click();
  await page.getByRole("button", { name: "复制门店链接" }).click();
  await expect(page.getByLabel("门店分享链接")).toHaveValue(
    /\/#\/store\/ningbo-donggudao-hotmaxx$/,
  );
  await page.keyboard.press("Escape");
  await page.goto("/#/store/remote-store");
  await expect(page.locator(".detail-card")).toContainText(distant.name);
  await expect(page.locator(".location-help")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看 " + distant.name, exact: true }),
  ).toBeAttached();
  await page.reload();
  await expect(page.locator(".detail-card")).toContainText(distant.name);
  await page.evaluate(() => {
    location.hash = "/store/missing";
  });
  await expect(page.locator(".shared-store-message")).toContainText(
    "门店数据无效",
  );
  await expect(page.locator(".detail-card")).toHaveCount(0);
});

test("定位失败提示可选择城市、消失且不被迟到的首次定位覆盖；重试可恢复", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".location-help")).toContainText("当前查看宁波");
  await page.getByRole("button", { name: "选择位置", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^上海/ }).click();
  await expect(page.locator(".location-help")).toHaveCount(0);
  await list(page);
  await expect(page.locator(".location-button")).toContainText("上海");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: any) =>
          ok({ coords: { longitude: 121.55, latitude: 29.87 } }),
      },
    });
  });
  await page.locator(".location-button").click();
  await page
    .getByRole("button", { name: "使用我的当前位置", exact: true })
    .click();
  await expect(page.locator(".location-button")).toContainText("当前位置");
  await expect(page.locator(".location-help")).toHaveCount(0);
});

test("大水地图品牌同时筛选水价与候选，未知门店保留，定位失败可选城市", async ({
  page,
}) => {
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        stores: [{ ...stores[4], source: "amap" }],
        configured: true,
        warnings: [],
        cacheOnly: true,
      },
    }),
  );
  await page.goto("/#/water");
  await expect(page.locator(".location-help")).toContainText("当前查看宁波");
  await page.getByRole("button", { name: "关闭定位提示" }).click();
  await list(page, true);
  await page.getByLabel("水价门店品牌").selectOption("好特卖");
  await expect(page.locator(".water-result-meta")).toContainText(
    "1 条范围内水价",
  );
  await expect(page.locator(".water-candidates summary")).toContainText("0");
  await page.getByLabel("水价门店品牌").selectOption("unknown");
  await expect(page.locator(".water-result-meta")).toContainText(
    "1 条范围内水价",
  );
  await page.getByLabel("水价门店类型").selectOption("supermarket");
  await expect(page.getByLabel("水价门店品牌")).toHaveValue("all");
  await expect(page.locator(".water-result-meta")).toContainText(
    "0 条范围内水价",
  );
  await expect(page.locator(".water-candidates summary")).toContainText("1");
  await page.getByRole("button", { name: "重新定位", exact: true }).click();
  await page.getByRole("button", { name: "选择位置", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "上海", exact: true })
    .click();
  await expect(page.locator(".water-location")).toContainText(
    "上海 · 手动参考中心",
  );
  await expect(page.locator(".location-help")).toHaveCount(0);
});

for (const water of [false, true]) {
  test(`${water ? "水价" : "首页"}手动选择后，迟到的设备定位不会覆盖地图`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: (ok: any) => {
            (window as any).finishLocation = () =>
              ok({ coords: { longitude: 116.3974, latitude: 39.9092 } });
          },
        },
        configurable: true,
      });
    });
    await page.goto(water ? "/#/water" : "/");
    await list(page, water);
    if (water)
      await page
        .getByRole("button", { name: "看宁波线索", exact: true })
        .click();
    else {
      await page.locator(".location-button").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^上海/ })
        .click();
    }
    await page.evaluate(() => (window as any).finishLocation());
    await expect(
      page.locator(water ? ".water-location" : ".location-button"),
    ).toContainText(water ? "宁波 · 手动参考中心" : "上海");
    await expect(page.locator(".location-help")).toHaveCount(0);
  });
}

test("复制成功的链接在新浏览器会话中打开同一家店，缺失门店可重试恢复", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as any).copiedLink = text;
        },
      },
    });
  });
  await page.goto("/#/store/remote-store");
  await page.getByRole("button", { name: "复制门店链接" }).click();
  await expect(page.locator(".toast")).toContainText("已复制");
  const link = await page.evaluate(() => (window as any).copiedLink);
  expect(link).toMatch(/\/#\/store\/remote-store$/);
  expect(link).not.toMatch(/lng|lat|center/);
  const context = await browser.newContext();
  try {
    const friend = await context.newPage();
    let unavailable = true;
    await friend.route("**/api/**", (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.endsWith("/remote-store"))
        return r.fulfill(
          unavailable
            ? { status: 404, json: { error: "这家门店尚未收录" } }
            : { json: { store: distant } },
        );
      return r.fulfill({
        json: path.endsWith("/config")
          ? { mapReady: false }
          : path.endsWith("/candidates")
            ? { stores: [], configured: true }
            : { stores: [], comments: [] },
      });
    });
    await friend.goto(link);
    await expect(friend.locator(".shared-store-message")).toContainText(
      "尚未收录",
    );
    await expect(friend.locator(".detail-card")).toHaveCount(0);
    unavailable = false;
    await friend.getByRole("button", { name: "重试", exact: true }).click();
    await expect(friend.locator(".detail-card")).toContainText(distant.name);
  } finally {
    await context.close();
  }
});
