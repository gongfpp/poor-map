import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { signBaiduUrl } from "../worker/baidu-sign.mjs";
import { planNearest } from "../worker/navigation.mjs";
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest();
test("Baidu SN matches the official published example", async () => {
  const u = new URL(
    "https://api.map.baidu.com/geocoder/v2/?address=百度大厦&output=json&ak=yourak",
  );
  await signBaiduUrl(u, { BAIDU_WEB_SERVICE_SK: "yoursk", BAIDU_MD5: md5 });
  assert.equal(u.searchParams.get("sn"), "7de5a22212ffaa9e326444c75a58f9a0");
  assert.ok(!u.href.includes("yoursk"));
});
test("Baidu signing preserves special characters and parameter order, replacing old signatures", async () => {
  const u = new URL("https://api.map.baidu.com/place/v2/search");
  u.search = new URLSearchParams({
    query: "好特卖 + &'()!*",
    location: "29.87,121.55",
    ak: "yourak",
    sn: "obsolete",
  }).toString();
  const env = { BAIDU_WEB_SERVICE_SK: "yoursk", BAIDU_MD5: md5 };
  await signBaiduUrl(u, env);
  assert.equal(u.searchParams.get("query"), "好特卖 + &'()!*");
  assert.deepEqual(
    [...u.searchParams.keys()],
    ["query", "location", "ak", "sn"],
  );
  const original = u.searchParams.get("sn");
  await signBaiduUrl(u, env);
  assert.equal(u.searchParams.get("sn"), original);
  u.searchParams.set("location", "29.88,121.55");
  await signBaiduUrl(u, env);
  assert.notEqual(u.searchParams.get("sn"), original);
});
test("signed Baidu walking fallback includes timestamp and never sends SK", async () => {
  const origin = [121.554225, 29.869432];
  const destination = [121.551391, 29.872218];
  const store = {
    id: "B1",
    name: "好特卖",
    category: "discount",
    source: "amap",
    location: destination,
    tags: [],
  };
  const calls: string[] = [];
  const r = await planNearest(
    origin,
    [store],
    {
      AMAP_WEB_SERVICE_KEY: "test-amap",
      BAIDU_WEB_SERVICE_KEY: "yourak",
      BAIDU_WEB_SERVICE_SK: "yoursk",
      BAIDU_MD5: md5,
    },
    async (u) => {
      assert.ok(u instanceof URL);
      calls.push(u.hostname);
      if (u.hostname === "restapi.amap.com")
        return new Response("{}", { status: 503 });
      assert.ok(/^\d{10}$/.test(u.searchParams.get("timestamp") || ""));
      assert.ok(/^[a-f0-9]{32}$/.test(u.searchParams.get("sn") || ""));
      assert.ok(!u.href.includes("yoursk"));
      assert.equal(u.searchParams.get("coord_type"), "gcj02");
      return Response.json({
        status: 0,
        result: {
          routes: [
            {
              distance: 515,
              duration: 468,
              steps: [
                { path: `${origin};${destination}`, instruction: "沿道路步行" },
              ],
            },
          ],
        },
      });
    },
  );
  assert.deepEqual(calls, ["restapi.amap.com", "api.map.baidu.com"]);
  assert.equal(r.provider, "baidu");
  assert.equal(r.distance, 515);
  assert.ok(r.warnings.some((s: string) => s.includes("备用")));
});
