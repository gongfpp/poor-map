import test from "node:test";
import assert from "node:assert/strict";
import { backupDiscovery, providerConfigured } from "../worker/providers.mjs";
test("non-JSON backup responses fail explicitly without leaking upstream page content", async () => {
  await assert.rejects(
    backupDiscovery(
      "baidu",
      [121.55, 29.87],
      3000,
      "home",
      { BAIDU_WEB_SERVICE_KEY: "private-ak" },
      async () =>
        new Response("<html>验证码 private-ak</html>", {
          headers: { "content-type": "text/html" },
        }),
    ),
    (e: Error) =>
      e.message.includes("安全验证") &&
      !e.message.includes("private-ak") &&
      !e.message.includes("<html>"),
  );
});
import { gcj02ToWgs84, distance } from "../src/domain";

const center: [number, number] = [121.553, 29.871];
const env = {
  TENCENT_WEB_SERVICE_KEY: "qq-test",
  BAIDU_WEB_SERVICE_KEY: "bd-test",
  TIANDITU_SERVICE_KEY: "td-test",
};
test("Tencent backup uses official host and GCJ-02 lat,lng inputs, with category and distance filtering", async () => {
  let calls = 0;
  const data = await backupDiscovery(
    "tencent",
    center,
    3000,
    "home",
    env,
    async (input, options) => {
      calls++;
      assert.ok(input instanceof URL);
      assert.ok(options?.signal);
      assert.equal(input.hostname, "apis.map.qq.com");
      assert.equal(
        input.searchParams.get("boundary"),
        "nearby(29.871,121.553,3000,0)",
      );
      const keyword = input.searchParams.get("keyword");
      return Response.json({
        status: 0,
        count: keyword === "蜜雪冰城" ? 30 : 0,
        data:
          keyword === "蜜雪冰城"
            ? [
                {
                  id: "valid",
                  title: "蜜雪冰城",
                  address: "测试店址",
                  location: { lng: center[0], lat: center[1] },
                  price: 0,
                  phone: "not retained",
                },
                {
                  id: "wrong-name",
                  title: "普通便利店",
                  location: { lng: center[0], lat: center[1] },
                },
                {
                  id: "headquarters",
                  title: "蜜雪冰城总部",
                  location: { lng: center[0], lat: center[1] },
                },
                {
                  id: "far",
                  title: "蜜雪冰城",
                  location: { lng: 116.4, lat: 39.9 },
                },
              ]
            : [],
      });
    },
  );
  assert.equal(calls, 7);
  assert.equal(data.stores.length, 1);
  assert.equal(data.stores[0].id, "qq-valid");
  assert.equal(data.stores[0].source, "tencent");
  assert.equal(data.stores[0].category, "mixue");
  assert.deepEqual(data.stores[0].location, center);
  assert.equal("price" in data.stores[0], false);
  assert.equal("phone" in data.stores[0], false);
  assert.ok(data.warnings.some((s: string) => s.includes("20家")));
});

test("Baidu backup explicitly uses GCJ-02 input and output without second offset", async () => {
  const data = await backupDiscovery(
    "baidu",
    center,
    3000,
    "water",
    env,
    async (input) => {
      assert.ok(input instanceof URL);
      assert.equal(input.hostname, "api.map.baidu.com");
      assert.equal(input.searchParams.get("location"), "29.871,121.553");
      assert.equal(input.searchParams.get("coord_type"), "2");
      assert.equal(input.searchParams.get("ret_coordtype"), "gcj02ll");
      return Response.json({
        status: 0,
        total: 1,
        results: [
          {
            uid:
              "id-" +
              [
                "赵一鸣",
                "零食很忙",
                "零食有鸣",
                "好特卖",
                "嗨特购",
                "奥特乐",
                "超市",
              ].indexOf(input.searchParams.get("query")!),
            name: input.searchParams.get("query"),
            location: { lng: center[0], lat: center[1] },
          },
        ],
      });
    },
  );
  assert.equal(data.stores.length, 7);
  assert.ok(
    data.stores.every(
      (s: any) => s.source === "baidu" && distance(s.location, center) < 0.001,
    ),
  );
  assert.equal(data.stores.at(-1)!.category, "market");
});

test("Tianditu backup converts query to geographic coordinates and results back exactly once", async () => {
  const geographic = gcj02ToWgs84(center);
  const data = await backupDiscovery(
    "tianditu",
    center,
    3000,
    "home",
    env,
    async (input) => {
      assert.ok(input instanceof URL);
      assert.equal(input.hostname, "api.tianditu.gov.cn");
      const query = JSON.parse(input.searchParams.get("postStr")!);
      assert.equal(query.pointLonlat, geographic.join(","));
      assert.equal(query.queryType, 3);
      assert.equal(query.count, 20);
      return Response.json({
        status: { infocode: 1000 },
        count: 1,
        pois: [
          {
            hotPointID:
              "id-" +
              [
                "赵一鸣",
                "零食很忙",
                "零食有鸣",
                "好特卖",
                "嗨特购",
                "奥特乐",
                "蜜雪冰城",
              ].indexOf(query.keyWord),
            name: query.keyWord,
            lonlat: geographic.join(","),
          },
        ],
      });
    },
  );
  assert.equal(data.stores.length, 7);
  assert.ok(data.stores.every((s: any) => distance(s.location, center) < 0.05));
});

test("missing provider key and unsupported inputs cannot trigger upstream requests", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ status: 0, data: [] });
  };
  assert.equal(providerConfigured({}, "tencent"), false);
  await assert.rejects(
    backupDiscovery("tencent", center, 3000, "home", {}, fetcher),
    /未配置/,
  );
  for (const args of [
    [null, 1000, "home"],
    [[0, 29], 1000, "home"],
    [center, 10001, "home"],
    [center, 1000, "unknown"],
  ] as any[])
    await assert.rejects(
      backupDiscovery("tencent", args[0], args[1], args[2], env, fetcher),
    );
  assert.equal(calls, 0);
});

test("backup errors stay partial, sanitized, and never expose key-bearing exception URLs", async () => {
  const data = await backupDiscovery(
    "tencent",
    center,
    3000,
    "home",
    env,
    async (input) => {
      assert.ok(input instanceof URL);
      if (input.searchParams.get("keyword") === "赵一鸣")
        return Response.json({
          status: 0,
          count: 1,
          data: [
            {
              id: "one",
              title: "赵一鸣",
              location: { lng: center[0], lat: center[1] },
            },
          ],
        });
      throw new Error(
        `fetch failed https://apis.map.qq.com?key=${env.TENCENT_WEB_SERVICE_KEY}`,
      );
    },
  );
  assert.equal(data.stores.length, 1);
  assert.ok(data.warnings.length > 0);
  assert.ok(
    data.warnings.every(
      (s: string) => !s.includes("qq-test") && !s.includes("https://"),
    ),
  );
  await assert.rejects(
    backupDiscovery("tencent", center, 3000, "home", env, async () =>
      Response.json({ status: 120, message: "provider secret" }),
    ),
    (e: Error) => !e.message.includes("provider secret"),
  );
});

test("polluted Tencent rows do not fabricate undefined IDs or discard valid neighboring rows", async () => {
  const data = await backupDiscovery(
    "tencent",
    center,
    3000,
    "home",
    env,
    async (input) => {
      assert.ok(input instanceof URL);
      const keyword = input.searchParams.get("keyword");
      return Response.json({
        status: 0,
        count: 4,
        data:
          keyword === "蜜雪冰城"
            ? [
                null,
                {
                  title: "蜜雪冰城",
                  location: { lng: center[0], lat: center[1] },
                },
                {
                  id: "bad-coordinate",
                  title: "蜜雪冰城",
                  location: { lng: "121.553", lat: center[1] },
                },
                {
                  id: "good",
                  title: "蜜雪冰城",
                  location: { lng: center[0], lat: center[1] },
                },
              ]
            : [],
      });
    },
  );
  assert.deepEqual(
    data.stores.map((s: any) => s.id),
    ["qq-good"],
  );
});

test("polluted Baidu and Tianditu rows require IDs and exactly two valid coordinates", async () => {
  for (const provider of ["baidu", "tianditu"]) {
    const geographic = gcj02ToWgs84(center);
    const data = await backupDiscovery(
      provider,
      center,
      3000,
      "home",
      env,
      async (input) => {
        assert.ok(input instanceof URL);
        const keyword =
          provider === "baidu"
            ? input.searchParams.get("query")
            : JSON.parse(input.searchParams.get("postStr")!).keyWord;
        if (provider === "baidu")
          return Response.json({
            status: 0,
            total: 3,
            results:
              keyword === "蜜雪冰城"
                ? [
                    {
                      name: "蜜雪冰城",
                      location: { lng: center[0], lat: center[1] },
                    },
                    {
                      uid: "bad-name",
                      name: 42,
                      location: { lng: center[0], lat: center[1] },
                    },
                    {
                      uid: "good",
                      name: "蜜雪冰城",
                      location: { lng: center[0], lat: center[1] },
                    },
                  ]
                : [],
          });
        return Response.json({
          status: { infocode: 1000 },
          count: 3,
          pois:
            keyword === "蜜雪冰城"
              ? [
                  { name: "蜜雪冰城", lonlat: geographic.join(",") },
                  {
                    hotPointID: "extra",
                    name: "蜜雪冰城",
                    lonlat: geographic.join(",") + ",123",
                  },
                  {
                    hotPointID: "good",
                    name: "蜜雪冰城",
                    lonlat: geographic.join(","),
                  },
                ]
              : [],
        });
      },
    );
    assert.deepEqual(
      data.stores.map((s: any) => s.id),
      [provider === "baidu" ? "bd-good" : "td-good"],
    );
  }
});
