import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seedWater,
  ningboCenter,
  perLiter,
  perLiterHigh,
  validateWater,
  waterResults,
  simpleWaterInput,
  type WaterFilters,
} from "../src/water-domain.ts";
import worker from "../worker/index.mjs";
import { createWaterDB } from "../server/water-db.mjs";
const defaults: WaterFilters = {
  radius: 3000,
  pack: "all",
  sort: "liter",
  onlyAvailable: false,
  channel: "all",
  query: "",
};
test("simple water submissions allow unknown location and specs without inventing a per-liter price", () => {
  const input = simpleWaterInput("某超市", 1.2, "1.5L 的水，货架看到的", null);
  assert.equal(validateWater(input), null);
  assert.equal(input.location, null);
  assert.equal(input.bottles, null);
  assert.equal(input.volumeMl, null);
  assert.equal(perLiter(input as any), null);
  assert.equal(validateWater(simpleWaterInput("某超市", 0.9, "", null)), null);
});
test("simple edits preserve confirmed specifications but clear stale price ranges and renamed-store locations", () => {
  const original = seedWater[0];
  const edited = simpleWaterInput(
    original.storeName,
    9.9,
    "今日参考价格",
    original,
  );
  assert.equal(edited.volumeMl, 550);
  assert.equal(edited.bottles, 24);
  assert.deepEqual(edited.location, original.location);
  const changed = simpleWaterInput(
    seedWater[1].storeName,
    1.5,
    "新价格",
    seedWater[1],
  );
  assert.equal(changed.priceHigh, null);
  const renamed = simpleWaterInput("另一家超市", 1.2, "", original);
  assert.equal(renamed.location, null);
  assert.equal(renamed.volumeMl, null);
});
test("simple submissions match only one exact known shop name, never a fuzzy brand or ambiguous branch", () => {
  const store: any = {
    id: "B123",
    name: "好特卖（某广场店）",
    address: "公开门店地址",
    location: [121.55, 29.87],
    locationPrecision: "poi",
  };
  const exact = simpleWaterInput(store.name, 1.2, "", null, [store]);
  assert.equal(exact.storeId, store.id);
  assert.deepEqual(exact.location, store.location);
  assert.equal(
    simpleWaterInput("好特卖", 1.2, "", null, [store]).location,
    null,
  );
  assert.equal(
    simpleWaterInput(store.name, 1.2, "", null, [
      store,
      { ...store, id: "B456" },
    ]).location,
    null,
  );
});
test("8.9 for 24x550ml equals 13.2L and about 0.6742 yuan per liter", () =>
  assert.ok(Math.abs(perLiter(seedWater[0])! - 8.9 / 13.2) < 1e-10));
test("unknown bottle size does not become a per-liter bargain", () => {
  assert.equal(perLiter(seedWater[1]), null);
  assert.deepEqual(
    waterResults(seedWater, ningboCenter, defaults).map((o) => o.id),
    ["ningbo-k11-water", "ningbo-donggudao-water"],
  );
});
test("large water means single-bottle capacity, not total case volume", () => {
  assert.equal(
    waterResults(seedWater, ningboCenter, { ...defaults, pack: "large" })
      .length,
    0,
  );
  assert.equal(
    waterResults(seedWater, ningboCenter, { ...defaults, pack: "case" }).length,
    1,
  );
});
test("range comparison conservatively uses the reported upper bound", () => {
  const o = { ...seedWater[1], volumeMl: 1500 };
  assert.equal(perLiter(o), 0.6);
  assert.ok(Math.abs(perLiterHigh(o)! - 0.8) < 1e-10);
});
test("sold-out, ended and expired offers are excluded", () => {
  const rows = [
    { ...seedWater[0], status: "sold-out" as const },
    { ...seedWater[0], validUntil: "2020-01-01" },
    { ...seedWater[0], status: "ended" as const },
  ];
  assert.equal(waterResults(rows, ningboCenter, defaults).length, 0);
});
test("unknown stock is not labelled available and unlocated clues do not qualify as nearby", () => {
  assert.equal(
    waterResults(seedWater, ningboCenter, { ...defaults, onlyAvailable: true })
      .length,
    0,
  );
  assert.equal(
    waterResults([{ ...seedWater[0], location: null }], ningboCenter, defaults)
      .length,
    0,
  );
});
test("water validation rejects bad capacity, price, count, links and coordinates", () => {
  for (const bad of [
    { ...seedWater[0], volumeMl: 0 },
    { ...seedWater[0], priceHigh: 1 },
    { ...seedWater[0], price: NaN },
    { ...seedWater[0], bottles: 0 },
    { ...seedWater[0], sourceUrl: "javascript:alert(1)" },
    { ...seedWater[0], location: [0, 0] },
  ])
    assert.notEqual(validateWater(bad), null);
  assert.equal(validateWater(seedWater[0]), null);
});
async function withDB(
  run: (
    request: (path: string, init?: RequestInit) => Promise<Response>,
  ) => Promise<void>,
) {
  const DB = createWaterDB();
  try {
    await run((path, init) =>
      worker.fetch(
        new Request("https://water.test/api/water" + path, {
          ...init,
          headers: { Origin: "https://gongfpp.github.io", ...init?.headers },
        }),
        { DB, QA_TOKEN: "test-only-token" },
      ),
    );
  } finally {
    DB.close();
  }
}
test("service returns actual user tips and only a public JS key in config", async () =>
  withDB(async (request) => {
    const list = await (await request("")).json();
    assert.equal(list.offers.length, 2);
    assert.ok(list.offers.every((o: any) => o.origin === "user-tip"));
    const config = await (await request("/config")).json();
    assert.equal(config.searchReady, false);
    assert.ok(!JSON.stringify(config).includes("test-only-token"));
  }));
test("editing uses an optimistic version and preserves prior content", async () =>
  withDB(async (request) => {
    await request("");
    const initial = seedWater[0];
    const first = await request("/" + initial.id, {
      method: "PUT",
      body: JSON.stringify({ ...initial, price: 9.9, version: 1 }),
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).offer.version, 2);
    const stale = await request("/" + initial.id, {
      method: "PUT",
      body: JSON.stringify({ ...initial, price: 1, version: 1 }),
    });
    assert.equal(stale.status, 409);
    const history = await (await request("/" + initial.id + "/history")).json();
    assert.equal(history.revisions.length, 1);
    assert.equal(history.revisions[0].before.price, 8.9);
    assert.equal(history.revisions[0].after.price, 9.9);
  }));
test("feedback is shared without changing reported price or certifying an offer", async () =>
  withDB(async (request) => {
    await request("");
    const r = await request("/ningbo-k11-water/feedback", {
      method: "POST",
      body: JSON.stringify({ type: "changed", note: "价格待复核" }),
    });
    assert.equal(r.status, 200);
    const o = (await (await request("")).json()).offers.find(
      (o: any) => o.id === "ningbo-k11-water",
    );
    assert.equal(o.price, 8.9);
    assert.equal(o.status, "unknown");
    assert.equal(o.feedback.changed, 1);
    const history = await (await request("/ningbo-k11-water/history")).json();
    assert.equal(history.feedback[0].note, "价格待复核");
  }));
test("QA submissions are isolated and can be cleared without touching real tips", async () =>
  withDB(async (request) => {
    const r = await request("", {
      method: "POST",
      headers: {
        "X-QA-Token": "test-only-token",
        "X-QA-Scope": "separate-suite",
      },
      body: JSON.stringify(seedWater[0]),
    });
    assert.equal(r.status, 201);
    assert.equal((await (await request("")).json()).offers.length, 2);
    assert.equal(
      (
        await (
          await request("", {
            headers: {
              "X-QA-Token": "test-only-token",
              "X-QA-Scope": "separate-suite",
            },
          })
        ).json()
      ).offers.length,
      1,
    );
    assert.equal((await request("/qa", { method: "DELETE" })).status, 403);
    assert.equal(
      (
        await request("/qa", {
          method: "DELETE",
          headers: {
            "X-QA-Token": "test-only-token",
            "X-QA-Scope": "separate-suite",
          },
        })
      ).status,
      200,
    );
    assert.equal((await (await request("")).json()).offers.length, 2);
    assert.equal(
      (
        await (
          await request("", {
            headers: {
              "X-QA-Token": "test-only-token",
              "X-QA-Scope": "separate-suite",
            },
          })
        ).json()
      ).offers.length,
      0,
    );
  }));
test("malformed JSON and cross-site writes fail explicitly", async () =>
  withDB(async (request) => {
    assert.equal(
      (await request("", { method: "POST", body: "{invalid" })).status,
      400,
    );
    assert.equal(
      (
        await request("", {
          method: "POST",
          headers: { Origin: "https://other.test" },
          body: JSON.stringify(seedWater[0]),
        })
      ).status,
      403,
    );
  }));
