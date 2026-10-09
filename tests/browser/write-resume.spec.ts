import { test, expect } from "@playwright/test";
import { seedStores } from "../../src/store-domain";
import { seedWater } from "../../src/water-domain";
for (const route of ["/", "/#/water"]) {
  test(`quota reset restores writes without automatic store refresh: ${route}`, async ({
    page,
  }) => {
    const resetAt = Date.now() + 3000;
    let configs = 0,
      searches = 0,
      refreshes = 0;
    await page.route("**/api/water/config*", (r) => {
      configs++;
      const restored = Date.now() >= resetAt;
      return r.fulfill({
        json: {
          provider: "amap",
          jsKey: "",
          mapReady: false,
          searchReady: false,
          writeReady: restored,
          writePausedUntil: restored ? null : new Date(resetAt).toISOString(),
          providers: [],
        },
      });
    });
    await page.route("**/api/community/stores", (r) =>
      r.fulfill({ json: { stores: seedStores } }),
    );
    await page.route("**/api/water", (r) =>
      r.fulfill({ json: { offers: seedWater } }),
    );
    await page.route("**/api/water/candidates**", (r) => {
      if (r.request().method() === "POST") refreshes++;
      return r.fulfill({
        json: { configured: true, cacheOnly: true, stores: [], warnings: [] },
      });
    });
    await page.route("**/api/analytics/events", (r) =>
      r.fulfill({ json: { accepted: 0 } }),
    );
    page.on("request", (r) => {
      if (/restapi.amap.com.*place\/|api.tianditu.gov.cn.*search/.test(r.url()))
        searches++;
    });
    await page.goto(route);
    const submit =
      route === "/"
        ? page.getByRole("button", { name: "分享省钱线索", exact: true })
        : page.getByRole("button", { name: "补充水价", exact: true });
    await expect(submit).toBeDisabled();
    await expect(submit).toBeEnabled({ timeout: 10000 });
    expect(configs).toBeGreaterThan(1);
    expect(configs).toBeLessThanOrEqual(3);
    expect(refreshes).toBe(0);
    expect(searches).toBe(0);
  });
}
