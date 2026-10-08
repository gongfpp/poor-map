import test from "node:test";
import assert from "node:assert/strict";
import { planNearest } from "../worker/navigation.mjs";
import {
  walkingNavigationUrl,
  validNavigationResult,
} from "../src/navigation-domain";
import type { Store } from "../src/domain";

const origin: [number, number] = [121.553, 29.871];
function shop(id: string, lng: number, name = "好特卖"): Store {
  return {
    id,
    name,
    category: "discount",
    source: "amap",
    location: [lng, origin[1]],
    address: "",
    tags: [],
  };
}
function amapResponse(
  destination: [number, number],
  meters = 500,
  seconds = 350,
) {
  return new Response(
    JSON.stringify({
      status: "1",
      route: {
        paths: [
          {
            distance: String(meters),
            duration: String(seconds),
            steps: [
              {
                instruction: "沿中山路向东步行",
                polyline: `${origin.join(",")};${destination.join(",")}`,
              },
            ],
          },
        ],
      },
    }),
  );
}
test("compares actual routes rather than choosing the straight-line nearest store", async () => {
  const stores = [shop("BNEAR", 121.554), shop("BSHORT", 121.556)];
  const ids: string[] = [];
  const r = await planNearest(
    origin,
    stores,
    { AMAP_WEB_SERVICE_KEY: "test-private" },
    async (input, options) => {
      assert.ok(input instanceof URL);
      assert.ok(options);
      assert.equal(input.hostname, "restapi.amap.com");
      assert.equal(input.pathname, "/v3/direction/walking");
      assert.equal(options.redirect, "manual");
      assert.ok(options.signal);
      const id = input.searchParams.get("destination_id")!;
      ids.push(id);
      return amapResponse(
        stores.find((s) => s.id === id)!.location,
        id === "BNEAR" ? 1500 : 450,
      );
    },
  );
  assert.equal(r.destination.id, "BSHORT");
  assert.equal(r.distance, 450);
  assert.equal(r.compared, 2);
  assert.equal(r.comparisonLimited, false);
  assert.equal(r.provider, "amap");
  assert.deepEqual(ids.sort(), ["BNEAR", "BSHORT"]);
  assert.ok(validNavigationResult(r));
  assert.equal("origin" in r, false);
});
test("rejects absent and illegal origins before making requests", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return amapResponse(origin);
  };
  for (const point of [
    null,
    [],
    [NaN, 30],
    [121, Infinity],
    [181, 30],
    [121, "30"],
  ])
    await assert.rejects(
      planNearest(
        point,
        [shop("B1", 121.554)],
        { AMAP_WEB_SERVICE_KEY: "key" },
        fetcher,
      ),
      /出发点/,
    );
  assert.equal(calls, 0);
});
test("filters closed shops, wrong categories and invalid locations", async () => {
  const closed = shop("Bclosed", 121.553, "好特卖（装修停业）");
  const mixue = { ...shop("Bmixue", 121.554, "蜜雪冰城"), category: "mixue" };
  const invalid = { ...shop("Bad", 0), location: [0, 30] };
  await assert.rejects(
    planNearest(
      origin,
      [closed, mixue, invalid],
      { AMAP_WEB_SERVICE_KEY: "key" },
      async () => {
        throw Error("should never call");
      },
    ),
    /没有可导航/,
  );
});
test("caps comparison at eight shops and labels remaining coverage", async () => {
  let calls = 0;
  const stores = Array.from({ length: 20 }, (_, i) =>
    shop(`B${i}`, 121.554 + i * 0.001),
  );
  const r = await planNearest(
    origin,
    stores,
    { AMAP_WEB_SERVICE_KEY: "key" },
    async (url) => {
      assert.ok(url instanceof URL);
      calls++;
      return amapResponse(
        url.searchParams.get("destination")!.split(",").map(Number) as [
          number,
          number,
        ],
        1000,
      );
    },
  );
  assert.equal(calls, 8);
  assert.equal(r.compared, 8);
  assert.equal(r.comparisonLimited, true);
  assert.ok(r.warnings.some((s: string) => s.includes("8 家")));
});
test("provider timeout and credential errors yield explicit failure with no straight-line substitute", async () => {
  await assert.rejects(
    planNearest(
      origin,
      [shop("B1", 121.554)],
      { AMAP_WEB_SERVICE_KEY: "private-key" },
      async () => {
        throw new DOMException("https://host?key=private-key", "TimeoutError");
      },
    ),
    (e: any) =>
      e.status === 502 &&
      !e.message.includes("private-key") &&
      !e.message.includes("https"),
  );
  await assert.rejects(
    planNearest(origin, [shop("B1", 121.554)], {}),
    /尚未配置/,
  );
});
test("partial failures return usable route with limited comparison warning", async () => {
  const stores = [shop("Bfail", 121.554), shop("Bok", 121.555)];
  const r = await planNearest(
    origin,
    stores,
    { AMAP_WEB_SERVICE_KEY: "key" },
    async (url) => {
      assert.ok(url instanceof URL);
      if (url.searchParams.get("destination_id") === "Bfail")
        return new Response("{}", { status: 503 });
      return amapResponse(stores[1].location);
    },
  );
  assert.equal(r.destination.id, "Bok");
  assert.equal(r.compared, 1);
  assert.equal(r.comparisonLimited, true);
  assert.ok(r.warnings.some((s: string) => s.includes("未完成")));
});
test("Tencent backup decompresses lat/lng delta polyline and converts minutes to seconds", async () => {
  const dest = shop("B1", 121.554);
  const r = await planNearest(
    origin,
    [dest],
    { AMAP_WEB_SERVICE_KEY: "amap", TENCENT_WEB_SERVICE_KEY: "qq" },
    async (url) => {
      assert.ok(url instanceof URL);
      if (url.hostname === "restapi.amap.com")
        return new Response("{}", { status: 429 });
      assert.equal(url.hostname, "apis.map.qq.com");
      assert.equal(url.searchParams.get("from"), "29.871,121.553");
      return new Response(
        JSON.stringify({
          status: 0,
          result: {
            routes: [
              {
                distance: 180,
                duration: 3,
                polyline: [29.871, 121.553, 0, 1000],
                steps: [{ instruction: "向东" }],
              },
            ],
          },
        }),
      );
    },
  );
  assert.equal(r.provider, "tencent");
  assert.equal(r.duration, 180);
  assert.ok(Math.abs(r.polyline[1][0] - 121.554) < 1e-9);
  assert.ok(r.warnings.some((s: string) => s.includes("备用")));
});
test("Baidu backup explicitly requests GCJ-02 both ways and strips instruction markup", async () => {
  const dest = shop("B1", 121.554);
  const r = await planNearest(
    origin,
    [dest],
    { BAIDU_WEB_SERVICE_KEY: "bd" },
    async (url) => {
      assert.ok(url instanceof URL);
      assert.equal(url.hostname, "api.map.baidu.com");
      assert.equal(url.searchParams.get("coord_type"), "gcj02");
      assert.equal(url.searchParams.get("ret_coordtype"), "gcj02");
      return new Response(
        JSON.stringify({
          status: 0,
          result: {
            routes: [
              {
                distance: 200,
                duration: 170,
                steps: [
                  {
                    instruction: "沿<b>中山路</b>向东",
                    path: `${origin.join(",")};${dest.location.join(",")}`,
                  },
                ],
              },
            ],
          },
        }),
      );
    },
  );
  assert.equal(r.provider, "baidu");
  assert.equal(r.duration, 170);
  assert.deepEqual(r.steps, ["沿中山路向东"]);
});
test("malformed or mismatched provider polyline cannot be displayed as a route", async () => {
  await assert.rejects(
    planNearest(
      origin,
      [shop("B1", 121.554)],
      { AMAP_WEB_SERVICE_KEY: "key" },
      async () =>
        new Response(
          JSON.stringify({
            status: "1",
            route: {
              paths: [
                {
                  distance: "0",
                  duration: "0",
                  steps: [{ instruction: "x", polyline: "116,39;116.1,39" }],
                },
              ],
            },
          }),
        ),
    ),
    /暂不可用/,
  );
});
test("navigation URI includes walking mode, explicit origin and destination with encoded names", () => {
  const url = new URL(
    walkingNavigationUrl(origin, shop("B1", 121.554, "好特卖 & 入口")),
  );
  assert.equal(url.hostname, "uri.amap.com");
  assert.equal(url.pathname, "/navigation");
  assert.equal(url.searchParams.get("mode"), "walk");
  assert.equal(url.searchParams.get("coordinate"), null);
  assert.equal(url.searchParams.get("callnative"), "1");
  assert.ok(url.searchParams.get("from")!.startsWith("121.553,29.871"));
  assert.equal(url.searchParams.get("to"), "121.554,29.871,好特卖 & 入口");
  assert.equal(url.searchParams.has("key"), false);
});
