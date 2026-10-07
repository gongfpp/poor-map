import { test, expect } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR6kAAAAASUVORK5CYII=",
  "base64",
);
test("map tiles gate picking, explicit map click creates a shared store, attribution stays visible", async ({
  page,
}) => {
  let stores: any[] = [...seedStores],
    posted: any;
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: {
        provider: "tianditu",
        jsKey: "test-browser-key",
        mapReady: true,
        searchReady: false,
      },
    }),
  );
  await page.route("https://t*.tianditu.gov.cn/**", (r) =>
    r.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/community/stores", (r) => {
    if (r.request().method() === "POST") {
      posted = r.request().postDataJSON();
      const store = {
        ...posted,
        id: "new-store",
        source: "community",
        tags: [],
        locationPrecision: "poi",
      };
      stores.push(store);
      return r.fulfill({ status: 201, json: { store } });
    }
    return r.fulfill({ json: { stores } });
  });
  await page.route("**/api/community/comments**", (r) =>
    r.fulfill({ json: { comments: [] } }),
  );
  await page.route("**/api/analytics/events", (r) =>
    r.fulfill({ json: { accepted: 1 } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "标记门店" })).toBeEnabled();
  await expect(page.locator(".leaflet-control-attribution")).toContainText(
    "天地图",
  );
  await page.getByRole("button", { name: "标记门店" }).click();
  const box = await page.locator(".td-map").boundingBox();
  await page
    .locator(".td-map")
    .click({ position: { x: box!.width * 0.55, y: box!.height * 0.5 } });
  await expect(page.getByRole("dialog")).toContainText("标记一家门店");
  await page.getByLabel("门店名称").fill("测试蜜雪冰城");
  await page.getByLabel("分类", { exact: true }).selectOption("mixue");
  await page.getByRole("button", { name: "保存门店" }).click();
  await expect(page.locator(".detail-card")).toContainText("测试蜜雪冰城");
  expect(posted.location[0]).toBeGreaterThan(121.54);
  expect(posted.location[0]).toBeLessThan(121.57);
  expect(posted.location[1]).toBeGreaterThan(29.86);
  expect(posted).not.toHaveProperty("price");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("failed basemap cannot be advertised ready or accept a guessed store location", async ({
  page,
}) => {
  await page.route("**/api/water/config*", (r) =>
    r.fulfill({
      json: {
        provider: "tianditu",
        jsKey: "test-browser-key",
        mapReady: true,
        searchReady: false,
      },
    }),
  );
  await page.route("https://t*.tianditu.gov.cn/**", (r) =>
    r.fulfill({ status: 403, body: "Denied" }),
  );
  await page.route("**/api/community/stores", (r) =>
    r.fulfill({ json: { stores: seedStores } }),
  );
  await page.route("**/api/analytics/events", (r) =>
    r.fulfill({ json: { accepted: 1 } }),
  );
  await page.goto("/");
  await expect(page.locator(".map-error")).toContainText("暂时无法加载");
  await expect(page.getByRole("button", { name: "标记门店" })).toBeDisabled();
  await page.route("https://t*.tianditu.gov.cn/**", (r) =>
    r.fulfill({ contentType: "image/png", body: png }),
  );
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("button", { name: "标记门店" })).toBeEnabled();
  await expect(page.locator(".map-error")).toHaveCount(0);
});
