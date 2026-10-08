import { test } from "node:test";
import assert from "node:assert/strict";
import { amapDiscovery } from "../worker/discovery.mjs";
import {
  correctWaterPoint,
  correctStorePoint,
} from "../worker/reference-migration.mjs";
import { createWaterDB } from "../server/water-db.mjs";
import { seedWater } from "../src/water-domain";
import { seedStores } from "../src/store-domain";
import { mergeStores } from "../src/discovery";
test("AMap home discovery enables only the two categories, filters headquarters/remote points and never invents prices", async () => {
  let calls = 0;
  const data = await amapDiscovery(
    new URL(
      "https://test/api/water/candidates?mode=home&center=121.55,29.873&radius=3000",
    ),
    { AMAP_WEB_SERVICE_KEY: "test-" + crypto.randomUUID() },
    async (_env: any, _path: any, p: any) => {
      calls++;
      assert.equal(p.offset, 25);
      assert.equal(p.location, "121.55,29.873");
      const mixue = p.keywords === "蜜雪冰城";
      return {
        count: "30",
        pois: [
          {
            id: mixue ? "mixue" : "discount",
            name: mixue ? "蜜雪冰城" : "赵一鸣零食",
            location: "121.551,29.873",
            price: 0,
          },
          {
            id: "headquarters",
            name: "蜜雪冰城总部",
            location: "121.551,29.873",
          },
          { id: "far", name: "蜜雪冰城", location: "116.39,39.91" },
        ],
      };
    },
  );
  assert.equal(calls, 2);
  assert.equal(data.stores.length, 2);
  assert.deepEqual(
    data.stores.map((s: any) => s.category),
    ["discount", "mixue"],
  );
  assert.ok(
    data.stores.every((s: any) => s.source === "amap" && !("price" in s)),
  );
  assert.ok(data.warnings.some((x: string) => x.includes("25家")));
});
test("failed AMap brands remain partial; invalid inputs never call the provider", async () => {
  const fn = async (_e: any, _p: any, q: any) => {
    if (q.keywords === "蜜雪冰城") throw Error();
    return { count: 0, pois: [] };
  };
  const d = await amapDiscovery(
    new URL("https://test/?mode=home&center=121.55,29.873&radius=3000"),
    { AMAP_WEB_SERVICE_KEY: crypto.randomUUID() },
    fn,
  );
  assert.equal(d.warnings.length, 1);
  assert.ok(d.configured);
  const bad = await amapDiscovery(
    new URL("https://test/?mode=unknown&center=121.55,29.873&radius=3000"),
    {},
    () => {
      throw Error("must not call");
    },
  );
  assert.equal(bad.status, 400);
});
test("initial HotMaxx correction is idempotent, keeps comments identity and records a price-preserving revision", async () => {
  const DB = createWaterDB();
  try {
    const oldStore = {
      ...seedStores[0],
      location: [121.5549, 29.8731],
      locationPrecision: "area",
      amapId: undefined,
    };
    const oldWater = {
      ...seedWater[1],
      location: [121.5549, 29.8731],
      locationPrecision: "area",
      price: 1.1,
      version: 3,
    };
    await DB.prepare("INSERT INTO stores VALUES(?,?,?,?)")
      .bind("public", oldStore.id, JSON.stringify(oldStore), oldStore.createdAt)
      .run();
    await DB.prepare("INSERT INTO offers VALUES(?,?,?,?,?)")
      .bind(
        "public",
        oldWater.id,
        JSON.stringify(oldWater),
        3,
        oldWater.updatedAt,
      )
      .run();
    await Promise.all([correctWaterPoint({ DB }), correctWaterPoint({ DB })]);
    await correctWaterPoint({ DB });
    await correctStorePoint({ DB });
    const offerRow = await DB.prepare(
      "SELECT record FROM offers WHERE scope='public'",
    ).first();
    assert.ok(offerRow);
    const o = JSON.parse(String(offerRow.record));
    assert.equal(o.price, 1.1);
    assert.equal(o.volumeMl, null);
    assert.equal(o.version, 4);
    assert.equal(o.storeId, oldWater.storeId);
    assert.deepEqual(o.location, seedStores[0].location);
    const history = await DB.prepare(
      "SELECT before_record FROM revisions",
    ).all();
    assert.equal(history.results.length, 1);
    assert.equal(
      JSON.parse(String(history.results[0].before_record)).price,
      1.1,
    );
    const storeRow = await DB.prepare(
      "SELECT record FROM stores WHERE scope='public'",
    ).first();
    assert.ok(storeRow);
    const store = JSON.parse(String(storeRow.record));
    assert.equal(store.id, oldStore.id);
    assert.equal(store.amapId, "B0H12LCG0X");
    assert.equal(
      mergeStores([store], [{ ...store, id: store.amapId, source: "amap" }])
        .length,
      1,
    );
  } finally {
    DB.close();
  }
});
