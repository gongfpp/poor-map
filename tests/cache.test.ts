import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWaterDB } from "../server/water-db.mjs";
import worker from "../worker/index.mjs";
import {
  savePlaces,
  readPlaces,
  validateArea,
} from "../worker/place-cache.mjs";
import { distance, type Store } from "../src/domain";

const center: [number, number] = [121.553, 29.871];
const oldDate = "2020-01-01T00:00:00.000Z";
const place = (id = "BCACHE", offset = 0.001): Store => ({
  id,
  name: "好特卖参考店",
  address: "宁波参考地址",
  category: "discount",
  source: "amap",
  location: [center[0] + offset, center[1]],
  tags: [],
});
const run = {
  key: "city:宁波:amap",
  provider: "amap",
  city: "宁波",
  fetchedAt: oldDate,
  complete: true,
  warnings: [],
};
function request(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request("https://api.example" + path, {
    method,
    headers: {
      origin: "https://gongfpp.github.io",
      "content-type": "application/json",
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
const query = `/api/water/candidates?center=${center.join(",")}&radius=3000&mode=home`;

test("cache survives database close/reopen and old dates without TTL or provider requests", async () => {
  const folder = mkdtempSync(join(tmpdir(), "poor-map-cache-"));
  const filename = join(folder, "cache.sqlite");
  let DB = createWaterDB(filename),
    upstream = 0;
  const originalFetch = globalThis.fetch;
  try {
    await savePlaces(
      { DB },
      "public",
      [{ ...place(), price: 0, tags: ["不应保存"] }],
      run,
    );
    DB.close();
    DB = createWaterDB(filename);
    const failFetch: typeof fetch = async () => {
      upstream++;
      throw Error("GET must not reach upstream");
    };
    globalThis.fetch = failFetch;
    const env = {
      DB,
      AMAP_WEB_SERVICE_KEY: "configured-key",
      UPSTREAM_FETCH: failFetch,
    };
    for (let i = 0; i < 3; i++) {
      const response = await worker.fetch(request(query), env);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.stores.length, 1);
      assert.equal(data.stores[0].cachedAt, oldDate);
      assert.equal(data.fetchedAt, oldDate);
      assert.equal(data.cacheOnly, true);
      assert.equal("price" in data.stores[0], false);
      assert.deepEqual(data.stores[0].tags, []);
    }
    assert.equal(upstream, 0);
  } finally {
    globalThis.fetch = originalFetch;
    DB.close();
    rmSync(folder, { recursive: true });
  }
});

test("5000 saved stores are capped to nearest 500, sorted, and explicitly limited", async () => {
  const DB = createWaterDB();
  try {
    const all = Array.from({ length: 5000 }, (_, i) =>
      place("B" + String(i).padStart(5, "0"), 0.000002 * (i + 1)),
    ).reverse();
    await savePlaces({ DB }, "public", all, run);
    const summary = await DB.prepare(
      "SELECT COUNT(*) AS count FROM cached_pois",
    ).first();
    assert.equal(summary!.count, 5000);
    const data = await readPlaces({ DB }, "public", center, 3000, "home");
    assert.ok("stores" in data && data.stores);
    assert.equal(data.stores.length, 500);
    assert.equal(data.limited, true);
    assert.equal(data.stores[0].id, "B00000");
    assert.equal(data.stores.at(-1)!.id, "B00499");
    const stores = data.stores;
    assert.ok(
      stores.every(
        (s: Store, i: number) =>
          i === 0 ||
          distance(center, stores[i - 1].location) <=
            distance(center, s.location),
      ),
    );
    const still = await DB.prepare(
      "SELECT COUNT(*) AS count FROM cached_pois",
    ).first();
    assert.equal(still!.count, 5000);
  } finally {
    DB.close();
  }
});

test("cache applies exact radius, mode categories and scope isolation before presenting data", async () => {
  const DB = createWaterDB();
  try {
    await savePlaces(
      { DB },
      "public",
      [
        place("near", 0.001),
        place("bbox-only", 0.034),
        { ...place("mixue"), name: "蜜雪冰城", category: "mixue" },
        { ...place("market"), name: "超市", category: "market" },
      ],
      run,
    );
    await savePlaces({ DB }, "qa:isolated", [place("private")], run);
    const home = await readPlaces({ DB }, "public", center, 3000, "home");
    const water = await readPlaces({ DB }, "public", center, 3000, "water");
    const qa = await readPlaces({ DB }, "qa:isolated", center, 3000, "home");
    assert.ok(home.stores && water.stores && qa.stores);
    assert.deepEqual(home.stores.map((s: Store) => s.id).sort(), [
      "mixue",
      "near",
    ]);
    assert.deepEqual(water.stores.map((s: Store) => s.id).sort(), [
      "market",
      "near",
    ]);
    assert.deepEqual(
      qa.stores.map((s: Store) => s.id),
      ["private"],
    );
  } finally {
    DB.close();
  }
});

test("manual refresh failure keeps old records, dates and subsequent GET availability", async () => {
  const DB = createWaterDB();
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "test-key",
    UPSTREAM_FETCH: async () => {
      calls++;
      return Response.json({ status: "0", infocode: "10003" });
    },
  };
  try {
    await savePlaces(env, "public", [place()], run);
    const refreshed = await worker.fetch(
      request("/api/water/candidates", "POST", {
        center,
        radius: 3000,
        mode: "home",
        provider: "amap",
      }),
      env,
    );
    assert.equal(refreshed.status, 503);
    assert.equal(calls, 2);
    const data = await (await worker.fetch(request(query), env)).json();
    assert.equal(data.stores[0].id, "BCACHE");
    assert.equal(data.stores[0].cachedAt, oldDate);
    assert.equal(calls, 2);
    const row = await DB.prepare(
      "SELECT COUNT(*) AS count FROM cache_runs",
    ).first();
    assert.equal(row!.count, 1);
  } finally {
    DB.close();
  }
});

test("invalid cache areas and refresh parameters never request a provider", async () => {
  const DB = createWaterDB();
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "key",
    UPSTREAM_FETCH: async () => {
      calls++;
      throw Error("must not call");
    },
  };
  try {
    for (const [point, radius] of [
      [[121, "29"], 1000],
      [[121, 29, 3], 1000],
      [[0, 29], 1000],
      [center, 99],
      [center, 10001],
      [center, 100.5],
      [null, 1000],
    ] as [unknown, number][]) {
      assert.equal(validateArea(point, radius), false);
      const response = await worker.fetch(
        request("/api/water/candidates", "POST", {
          center: point,
          radius,
          mode: "home",
        }),
        env,
      );
      assert.equal(response.status, 400);
    }
    for (const payload of [
      { center, radius: 3000, mode: "bad" },
      { center, radius: 3000, provider: "not-a-provider" },
    ])
      assert.equal(
        (
          await worker.fetch(
            request("/api/water/candidates", "POST", payload),
            env,
          )
        ).status,
        400,
      );
    assert.equal(
      (await worker.fetch(request(query.replace("3000", "0")), env)).status,
      400,
    );
    assert.equal(calls, 0);
  } finally {
    DB.close();
  }
});

test("bulk import requires admin token, validates batch, and isolates authenticated QA", async () => {
  const DB = createWaterDB();
  const env = { DB, DATA_ADMIN_TOKEN: "admin-private", QA_TOKEN: "qa-private" };
  const batch = { stores: [place()], run };
  try {
    for (const headers of [{}, { authorization: "Bearer wrong" }] as Record<
      string,
      string
    >[])
      assert.equal(
        (
          await worker.fetch(
            request("/api/discovery/import", "POST", batch, headers),
            env,
          )
        ).status,
        403,
      );
    const auth = {
      authorization: "Bearer admin-private",
      "x-qa-token": "qa-private",
      "x-qa-scope": "cache-test",
    };
    assert.equal(
      (
        await worker.fetch(
          request("/api/discovery/import", "POST", batch, auth),
          env,
        )
      ).status,
      200,
    );
    const pub = await (await worker.fetch(request(query), env)).json();
    const qa = await (
      await worker.fetch(request(query, "GET", undefined, auth), env)
    ).json();
    assert.equal(pub.stores.length, 0);
    assert.equal(qa.stores.length, 1);
    for (const data of [
      { stores: "bad", run },
      { stores: Array(501).fill(place()), run },
      { stores: [], run: { key: "bad", provider: "none" } },
    ])
      assert.equal(
        (
          await worker.fetch(
            request("/api/discovery/import", "POST", data, auth),
            env,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await worker.fetch(
          new Request("https://api.example/api/discovery/import", {
            method: "POST",
            headers: auth,
            body: "{",
          }),
          env,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await worker.fetch(
          new Request("https://api.example/api/discovery/import", {
            method: "POST",
            headers: auth,
            body: "x".repeat(350001),
          }),
          env,
        )
      ).status,
      413,
    );
  } finally {
    DB.close();
  }
});

test("cache rejects invalid source rows without polluting stored coordinates or inventing prices", async () => {
  const DB = createWaterDB();
  try {
    await savePlaces(
      { DB },
      "public",
      [
        place(),
        null,
        { ...place("bad1"), source: "evil" },
        { ...place("bad2"), category: "meal" },
        { ...place("bad3"), location: [121, 29, 4] },
        { ...place("bad4"), location: [NaN, 29] },
        { ...place("bad5"), id: "../bad" },
        { ...place("bad6"), name: 5 },
      ] as any[],
      run,
    );
    const data = await readPlaces({ DB }, "public", center, 3000, "home");
    assert.ok("stores" in data && data.stores);
    assert.equal(data.stores.length, 1);
    assert.equal(data.stores[0].id, "BCACHE");
  } finally {
    DB.close();
  }
});

test("null and array import envelopes are input errors and never alter saved data", async () => {
  const DB = createWaterDB();
  const env = { DB, DATA_ADMIN_TOKEN: "admin-private" };
  const headers = { authorization: "Bearer admin-private" };
  try {
    await savePlaces(env, "public", [place()], run);
    for (const data of [null, [], "not-an-object"]) {
      const response = await worker.fetch(
        request("/api/discovery/import", "POST", data, headers),
        env,
      );
      assert.equal(response.status, 400);
    }
    const data = await readPlaces(env, "public", center, 3000, "home");
    assert.ok(data.stores);
    assert.equal(data.stores.length, 1);
  } finally {
    DB.close();
  }
});

test("navigation uses saved stores only and never persists exact origins or routes", async () => {
  const DB = createWaterDB();
  const origin: [number, number] = [121.552893, 29.870958];
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "route-private",
    UPSTREAM_FETCH: async (url: URL) => {
      calls++;
      assert.equal(url.pathname, "/v3/direction/walking");
      assert.equal(url.searchParams.get("origin"), origin.join(","));
      assert.equal(url.searchParams.get("destination_id"), "BCACHE");
      return Response.json({
        status: "1",
        route: {
          paths: [
            {
              distance: "190",
              duration: "150",
              steps: [
                {
                  instruction: "向东步行",
                  polyline: `${origin.join(",")};${place().location.join(",")}`,
                },
              ],
            },
          ],
        },
      });
    },
  };
  try {
    await savePlaces(env, "public", [place()], run);
    const response = await worker.fetch(
      request("/api/navigation/nearest", "POST", { origin, radius: 3000 }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    const route = await response.json();
    assert.equal(route.destination.id, "BCACHE");
    assert.equal(route.compared, 1);
    assert.ok(route.polyline.length > 1);
    const places = await DB.prepare("SELECT record FROM cached_pois").all();
    const runs = await DB.prepare("SELECT record FROM cache_runs").all();
    for (const row of [...places.results, ...runs.results]) {
      assert.equal(String(row.record).includes(origin[0].toString()), false);
      assert.equal(String(row.record).includes("polyline"), false);
      assert.equal(String(row.record).includes("route-private"), false);
    }
    assert.equal(places.results.length, 1);
    assert.equal(runs.results.length, 1);
    for (const bad of [
      { radius: 3000 },
      { origin: [0, 0], radius: 3000 },
      { origin, radius: 0 },
    ])
      assert.equal(
        (
          await worker.fetch(
            request("/api/navigation/nearest", "POST", bad),
            env,
          )
        ).status,
        400,
      );
    assert.equal(calls, 1);
    assert.equal(
      (
        await worker.fetch(
          request(
            "/api/navigation/nearest",
            "POST",
            { origin, radius: 3000 },
            { origin: "https://evil.test" },
          ),
          env,
        )
      ).status,
      403,
    );
  } finally {
    DB.close();
  }
});

test("refresh quota denial leaves saved places readable and makes no extra supplier call", async () => {
  const DB = createWaterDB();
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "test-key",
    UPSTREAM_FETCH: async () => {
      calls++;
      return Response.json({ status: "0", infocode: "10003" });
    },
  };
  try {
    await savePlaces(env, "public", [place()], run);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await worker.fetch(
            request("/api/water/candidates", "POST", {
              center,
              radius: 3000,
              mode: "home",
              provider: "amap",
            }),
            env,
          )
        ).status,
        503,
      );
    assert.equal(calls, 20);
    const limited = await worker.fetch(
      request("/api/water/candidates", "POST", {
        center,
        radius: 3000,
        mode: "home",
        provider: "amap",
      }),
      env,
    );
    assert.equal(limited.status, 429);
    assert.equal(calls, 20);
    assert.equal(
      (await (await worker.fetch(request(query), env)).json()).stores[0].id,
      "BCACHE",
    );
    assert.equal(calls, 20);
  } finally {
    DB.close();
  }
});

test("category and text filters run before nearest-row limits, preserving sparse discounts for navigation", async () => {
  const DB = createWaterDB();
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "route-test-key",
    UPSTREAM_FETCH: async (url: URL) => {
      calls++;
      assert.equal(url.pathname, "/v3/direction/walking");
      assert.equal(url.searchParams.get("destination_id"), "far-discount");
      return Response.json({
        status: "1",
        route: {
          paths: [
            {
              distance: "2200",
              duration: "1600",
              steps: [
                {
                  instruction: "向东步行",
                  polyline: `${center.join(",")};${place("far-discount", 0.02).location.join(",")}`,
                },
              ],
            },
          ],
        },
      });
    },
  };
  try {
    const dense = Array.from({ length: 800 }, (_, i) => ({
      ...place(`dense-mixue-${i}`, 0.000002 * (i + 1)),
      category: "mixue",
      name: "蜜雪冰城近店",
    }));
    await savePlaces(
      env,
      "public",
      [...dense, place("far-discount", 0.02)],
      run,
    );
    const all = await readPlaces(env, "public", center, 3000, "home");
    assert.ok(all.stores);
    assert.equal(all.stores.length, 500);
    assert.ok(all.stores.every((s: Store) => s.category === "mixue"));
    const filtered = await readPlaces(env, "public", center, 3000, "home", {
      category: "discount",
    });
    assert.ok(filtered.stores);
    assert.deepEqual(
      filtered.stores.map((s: Store) => s.id),
      ["far-discount"],
    );
    const searched = await readPlaces(env, "public", center, 3000, "home", {
      category: "all",
      query: "好特卖参考店",
    });
    assert.ok(searched.stores);
    assert.deepEqual(
      searched.stores.map((s: Store) => s.id),
      ["far-discount"],
    );
    const categoryResponse = await worker.fetch(
      request(query + "&category=discount"),
      env,
    );
    assert.equal(categoryResponse.status, 200);
    assert.deepEqual(
      (await categoryResponse.json()).stores.map((s: Store) => s.id),
      ["far-discount"],
    );
    const route = await worker.fetch(
      request("/api/navigation/nearest", "POST", {
        origin: center,
        radius: 3000,
      }),
      env,
    );
    assert.equal(route.status, 200);
    assert.equal((await route.json()).destination.id, "far-discount");
    assert.equal(calls, 1);
  } finally {
    DB.close();
  }
});

test("cache search treats percent, underscore, backslash and SQL syntax as literal name/address text", async () => {
  const DB = createWaterDB();
  try {
    await savePlaces(
      { DB },
      "public",
      [
        { ...place("percent"), name: "好特卖 50% 店" },
        { ...place("underscore"), name: "好特卖 A_B 店" },
        { ...place("backslash"), name: "好特卖 A\\B 店" },
        { ...place("address"), name: "普通好特卖", address: "特价 7%_ 单元" },
        { ...place("sql-literal"), name: "好特卖 %' OR 1=1 -- 测试店" },
        {
          ...place("literal-id-only"),
          name: "其他好特卖",
          address: "正常地址",
        },
      ],
      run,
    );
    for (const [term, ids] of [
      ["%", ["address", "percent", "sql-literal"]],
      ["_", ["address", "underscore"]],
      ["A\\B", ["backslash"]],
      ["7%_", ["address"]],
      ["%' OR 1=1 --", ["sql-literal"]],
      ["literal-id-only", []],
      ["amap", []],
    ] as [string, string[]][]) {
      const data = await readPlaces({ DB }, "public", center, 3000, "home", {
        category: "all",
        query: term,
      });
      assert.ok(data.stores);
      assert.deepEqual(
        data.stores.map((s: Store) => s.id).sort(),
        ids.sort(),
        `literal query ${term}`,
      );
      const response = await worker.fetch(
        request(query + "&query=" + encodeURIComponent(term)),
        { DB },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json()).stores.map((s: Store) => s.id).sort(),
        ids.sort(),
      );
    }
  } finally {
    DB.close();
  }
});

test("invalid categories and oversized search terms return 400 without requesting providers", async () => {
  const DB = createWaterDB();
  let calls = 0;
  const env = {
    DB,
    AMAP_WEB_SERVICE_KEY: "configured",
    UPSTREAM_FETCH: async () => {
      calls++;
      throw Error("must not call");
    },
  };
  try {
    for (const filters of [
      { category: "meal" },
      { category: "discount'); DROP TABLE cached_pois; --" },
      { category: "all", query: "x".repeat(101) },
    ]) {
      const data = await readPlaces(
        env,
        "public",
        center,
        3000,
        "home",
        filters,
      );
      assert.equal(data.status, 400);
      const params = new URLSearchParams(
        Object.entries(filters).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const response = await worker.fetch(
        request(query + "&" + params.toString()),
        env,
      );
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  } finally {
    DB.close();
  }
});
test("manual refresh metadata stores public shop identities, never a user's search center", async () => {
  const DB = createWaterDB();
  try {
    const env = {
      DB,
      QA_TOKEN: "qa-test",
      AMAP_WEB_SERVICE_KEY: "private",
      UPSTREAM_FETCH: async () =>
        Response.json({
          status: "1",
          count: "1",
          pois: [
            {
              id: "BMETA",
              name: "赵一鸣零食参考店",
              location: "121.554,29.871",
              cityname: "宁波市",
              address: "参考店址",
            },
          ],
        }),
    };
    const r = await worker.fetch(
      request(
        "/api/water/candidates",
        "POST",
        { center, radius: 3000, mode: "home" },
        { "X-QA-Token": "qa-test", "X-QA-Scope": "no-center" },
      ),
      env,
    );
    assert.equal(r.status, 200);
    const rows = await DB.prepare(
      "SELECT run_key,record FROM cache_runs WHERE scope=?",
    )
      .bind("qa:no-center")
      .all();
    assert.equal(rows.results.length, 1);
    const meta = JSON.parse(String(rows.results[0].record));
    assert.equal(meta.center, undefined);
    assert.equal(meta.radius, undefined);
    assert.deepEqual(meta.storeIds, ["BMETA"]);
    assert.ok(!String(rows.results[0].run_key).includes(center.join(",")));
  } finally {
    DB.close();
  }
});
