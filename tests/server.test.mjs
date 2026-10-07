import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.mjs";
const env = {
  AMAP_JS_KEY: "public-js-key",
  AMAP_JS_SECURITY_CODE: "private-security",
  AMAP_WEB_SERVICE_KEY: "private-web-key",
};
async function serve(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
test("configuration never returns server-only credentials", async () =>
  serve({ env }, async (base) => {
    const r = await fetch(base + "/api/config");
    const text = await r.text();
    assert.ok(text.includes("public-js-key"));
    assert.ok(!text.includes("private-security"));
    assert.ok(!text.includes("private-web-key"));
  }));
test("missing credential fails explicitly instead of inventing POIs", async () =>
  serve({ env: {} }, async (base) => {
    const r = await fetch(base + "/api/nearby?center=121.55,29.87");
    assert.equal(r.status, 503);
    assert.ok(!(await r.json()).stores);
  }));
test("malformed coordinates and excess radii are rejected before upstream", async () =>
  serve(
    {
      env,
      upstream: () => {
        throw Error("must not call");
      },
    },
    async (base) => {
      for (const q of [
        "center=NaN,29.8",
        "center=0,0",
        "center=121,29&radius=90000",
        "center=121,29&category=invalid",
      ])
        assert.equal((await fetch(`${base}/api/nearby?${q}`)).status, 400);
    },
  ));
test("POIs are deduplicated and cached without invented prices", async () => {
  let calls = 0;
  await serve(
    {
      env,
      upstream: async (url) => {
        calls++;
        assert.equal(url.searchParams.get("key"), "private-web-key");
        return json({
          status: "1",
          count: "1",
          pois: [
            {
              id: "p",
              name: "赵一鸣",
              location: "121.551,29.871",
              address: "真实返回地址",
            },
          ],
        });
      },
    },
    async (base) => {
      const r = await fetch(`${base}/api/nearby?center=121.55,29.87`);
      const data = await r.json();
      assert.equal(data.stores.length, 1);
      assert.equal(data.stores[0].source, "amap");
      assert.equal(data.stores[0].price, undefined);
      await fetch(`${base}/api/nearby?center=121.55,29.87`);
      assert.equal(calls, 5);
    },
  );
});
test("upstream permission error is visible and never replaced by samples", async () =>
  serve(
    { env, upstream: async () => json({ status: "0", infocode: "10001" }) },
    async (base) => {
      const r = await fetch(`${base}/api/nearby?center=121.55,29.87`);
      assert.equal(r.status, 502);
      const data = await r.json();
      assert.ok(data.error.includes("10001"));
      assert.equal(data.stores, undefined);
    },
  ));
test("partial failure and truncated result sets are surfaced", async () =>
  serve(
    {
      env,
      upstream: async (url) =>
        url.searchParams.get("keywords").includes("好特卖")
          ? json({ status: "0", infocode: "10003" })
          : json({
              status: "1",
              count: "90",
              pois: [
                {
                  id: url.searchParams.get("keywords"),
                  name: "门店",
                  location: "121.551,29.871",
                },
              ],
            }),
    },
    async (base) => {
      const r = await fetch(`${base}/api/nearby?center=121.55,29.87`);
      const data = await r.json();
      assert.equal(r.status, 200);
      assert.equal(data.partial, true);
      assert.equal(data.stores.length, 4);
      assert.equal(data.warnings.length, 5);
    },
  ));
test("SDK proxy is allowlisted and injects server credentials only upstream", async () =>
  serve(
    {
      env,
      upstream: async (url) => {
        assert.equal(url.hostname, "restapi.amap.com");
        assert.equal(url.searchParams.get("jscode"), "private-security");
        assert.equal(url.searchParams.get("key"), "public-js-key");
        return json({ status: "1" });
      },
    },
    async (base) => {
      assert.equal((await fetch(base + "/_AMapService/evil")).status, 403);
      assert.equal(
        (await fetch(base + "/_AMapService/v3/place/around?key=attacker"))
          .status,
        200,
      );
    },
  ));
test("address geocoding uses official returned coordinates", async () =>
  serve(
    {
      env,
      upstream: async () =>
        json({
          status: "1",
          geocodes: [
            { location: "121.55,29.87", formatted_address: "宁波市街道" },
          ],
        }),
    },
    async (base) => {
      const data = await (
        await fetch(
          base + "/api/center?query=" + encodeURIComponent("宁波街道"),
        )
      ).json();
      assert.deepEqual(data.center, [121.55, 29.87]);
    },
  ));
