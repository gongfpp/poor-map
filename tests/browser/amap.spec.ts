import { test, expect } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
import { seedWater } from "../../src/water-domain";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: {
        provider: "amap",
        jsKey: "test-public-js",
        mapReady: true,
        searchReady: true,
      },
    }),
  );
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        configured: true,
        stores: [
          {
            id: "B0TEST",
            name: "蜜雪冰城（测试店）",
            category: "mixue",
            location: [121.552, 29.873],
            address: "测试地址",
            source: "amap",
            tags: [],
          },
        ],
        warnings: [],
      },
    }),
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
});
test("AMap picking uses the SDK GCJ point directly and keeps discovered shops free of product prices", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MapFixture {
      host: HTMLElement;
      handlers: Record<string, Function[]> = {};
      zoom = 15;
      constructor(host: HTMLElement) {
        this.host = host;
        setTimeout(() => this.handlers.complete?.forEach((f) => f()), 0);
        host.addEventListener("click", () =>
          this.handlers.click?.forEach((f) =>
            f({
              lnglat: { getLng: () => 121.551391, getLat: () => 29.872218 },
            }),
          ),
        );
      }
      on(name: string, f: Function) {
        (this.handlers[name] ||= []).push(f);
      }
      add(items: any) {
        for (const i of Array.isArray(items) ? items : [items])
          if (i.content) this.host.append(i.content);
      }
      remove(items: any) {
        for (const i of Array.isArray(items) ? items : [items])
          i.content?.remove();
      }
      getZoom() {
        return this.zoom;
      }
      setZoom(n: number) {
        this.zoom = n;
      }
      setCenter() {}
      getCenter() {
        return { lng: 121.55, lat: 29.873 };
      }
      destroy() {
        this.host.replaceChildren();
      }
    }
    (window as any).AMap = {
      Map: MapFixture,
      Marker: class {
        content: any;
        constructor(p: any) {
          this.content = p.content;
        }
      },
      Pixel: class {},
      Circle: class {},
    };
  });
  let posted: any;
  await page.route("**/api/community/stores", (r) => {
    if (r.request().method() === "POST") {
      posted = r.request().postDataJSON();
      return r.fulfill({
        status: 201,
        json: {
          store: {
            ...posted,
            id: "new-amap-store",
            source: "community",
            tags: [],
            locationPrecision: "poi",
          },
        },
      });
    }
    return r.fulfill({ json: { stores: seedStores } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "标记门店" })).toBeEnabled();
  await page.getByRole("button", { name: "标记门店" }).click();
  await page
    .locator(".amap-container")
    .click({ position: { x: page.viewportSize()!.width * 0.65, y: 100 } });
  await page.getByLabel("门店名称").fill("测试高德点选店");
  await page.getByRole("button", { name: "保存门店" }).click();
  expect(posted.location).toEqual([121.551391, 29.872218]);
  await expect(page.locator(".detail-card")).toContainText("测试高德点选店");
  await page.getByRole("button", { name: "关闭门店详情" }).click();
  if (
    await page.getByRole("button", { name: "看列表", exact: true }).isVisible()
  )
    await page.getByRole("button", { name: "看列表", exact: true }).click();
  await expect(page.locator(".results")).toContainText("高德");
  await expect(page.locator(".results")).not.toContainText("¥");
});
test("failed AMap SDK never enables coordinate picking or pretends roads are ready", async ({
  page,
}) => {
  await page.route("https://webapi.amap.com/maps**", (r) =>
    r.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator(".map-error")).toContainText("高德底图加载失败");
  await expect(page.getByRole("button", { name: "标记门店" })).toBeDisabled();
  await expect(page.locator(".map-source")).toContainText("底图尚未就绪");
});

test("known vendor identity opens the existing water clue without calling it unpriced", async ({
  page,
}) => {
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: { provider: "amap", jsKey: "", mapReady: false, searchReady: true },
    }),
  );
  await page.route("**/api/water", (r) =>
    r.fulfill({ json: { offers: seedWater } }),
  );
  await page.route("**/api/water/candidates**", (r) =>
    r.fulfill({
      json: {
        configured: true,
        stores: [
          {
            ...seedStores[0],
            id: seedStores[0].amapId,
            source: "amap",
            name: "好特卖HotMaxx(东鼓道宁波店)",
          },
        ],
        warnings: [],
      },
    }),
  );
  await page.goto("/#/water");
  const toggle = page.getByRole("button", { name: "列表", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(".water-candidates summary").click();
  await expect(page.locator(".water-candidates")).toContainText("已有社区水价");
  await expect(page.locator(".water-candidates")).not.toContainText(
    "价格尚未收录",
  );
  await page
    .locator(".water-candidates")
    .getByRole("button", { name: "查看水价" })
    .click();
  await expect(page.locator(".water-map-selected")).toBeVisible();
  await expect(page.locator(".water-map-selected")).toContainText("0.9");
});
