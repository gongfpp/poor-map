import test from "node:test";
import assert from "node:assert/strict";
import { sharedStoreId, storeLink } from "../src/store-link";
import { storeBrand, matchesStoreBrand } from "../src/store-brands";
import { seedStores } from "../src/store-domain";
import { createWaterDB } from "../server/water-db.mjs";
import worker from "../worker/index.mjs";

test("品牌旧名合并，商场内租户和未知店不误认成宿主品牌", () => {
  for (const name of ["超盒算NB（镇海店）", "盒马 NB（旧名）"]) {
    assert.equal(storeBrand(name), "超盒算");
    assert.ok(matchesStoreBrand(name, "超盒算"));
  }
  assert.equal(storeBrand("ALDI（上海店）"), "奥乐齐");
  assert.equal(storeBrand("蜜雪冰城（沃尔玛店）"), "蜜雪冰城");
  assert.equal(storeBrand("独立小店（沃尔玛旁）"), "unknown");
  assert.ok(matchesStoreBrand("独立小店", "all"));
});

test("分享链接只含公开 ID，保留 Pages 子路径且拒绝非法片段", () => {
  assert.equal(
    storeLink("B0123", "/poor-map/", "https://gongfpp.github.io"),
    "https://gongfpp.github.io/poor-map/#/store/B0123",
  );
  assert.equal(sharedStoreId("#/store/B0123"), "B0123");
  assert.equal(sharedStoreId("#/water"), undefined);
  for (const hash of [
    "#/store",
    "#/store/",
    "#/store/%",
    "#/store/../../admin",
    "#/store/foo?lat=123",
  ])
    assert.equal(sharedStoreId(hash), "");
  assert.throws(() => storeLink("../admin", "/", "https://example.com"));
});

test("直达读取按 ID 和 QA 范围隔离，写入暂停时仍可用且不请求供应商", async () => {
  const db = createWaterDB();
  try {
    const cached = {
      ...seedStores[0],
      id: "BTEST",
      source: "amap",
      name: "好特卖（缓存测试）",
    };
    for (const scope of ["public", "qa:link"]) {
      await db
        .prepare(
          "INSERT INTO cached_pois(scope,provider,id,city,category,lng,lat,record,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          scope,
          "amap",
          cached.id,
          "330200",
          "discount",
          ...cached.location,
          JSON.stringify({ ...cached, name: scope }),
          "2026-10-23T00:00:00Z",
        )
        .run();
    }
    let writes = 0,
      upstream = 0;
    const env = {
      QA_TOKEN: "test",
      WRITE_PAUSED_UNTIL: new Date(Date.now() + 3600000).toISOString(),
      DB: {
        ...db,
        prepare(sql: string) {
          if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
            writes++;
            throw Error("不应写入");
          }
          return db.prepare(sql);
        },
      },
      UPSTREAM_FETCH: async () => {
        upstream++;
        throw Error("不应搜店");
      },
    };
    const read = (id: string, headers = {}) =>
      worker.fetch(
        new Request("https://api.example/api/community/stores/" + id, {
          headers,
        }),
        env,
      );
    assert.equal((await (await read("BTEST")).json()).store.name, "public");
    assert.equal(
      (
        await (
          await read("BTEST", { "x-qa-token": "test", "x-qa-scope": "link" })
        ).json()
      ).store.name,
      "qa:link",
    );
    assert.equal(
      (await read("BTEST", { "x-qa-token": "test", "x-qa-scope": "other" }))
        .status,
      404,
    );
    assert.equal(
      (await (await read(seedStores[0].amapId!)).json()).store.id,
      seedStores[0].id,
    );
    assert.equal((await read("missing")).status, 404);
    assert.equal((await read("%3Cinvalid%3E")).status, 400);
    assert.equal(writes, 0);
    assert.equal(upstream, 0);
  } finally {
    db.close();
  }
});
