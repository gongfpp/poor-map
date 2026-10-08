import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.mjs";
import { createWaterDB } from "../server/water-db.mjs";
import { seedWater } from "../src/water-domain";
import { seedStores } from "../src/store-domain";
const origin = "https://gongfpp.github.io";
test("known free write quota cannot break existing price/store reads or SDK/navigation throttling", async () => {
  const db = createWaterDB();
  let writes = 0,
    upstream = 0;
  try {
    for (const o of seedWater)
      await db
        .prepare(
          "INSERT INTO offers(scope,id,record,version,updated_at) VALUES(?,?,?,?,?)",
        )
        .bind("public", o.id, JSON.stringify(o), 1, o.updatedAt)
        .run();
    for (const s of seedStores)
      await db
        .prepare(
          "INSERT INTO stores(scope,id,record,created_at) VALUES(?,?,?,?)",
        )
        .bind("public", s.id, JSON.stringify(s), s.createdAt)
        .run();
    const DB = {
      ...db,
      prepare(sql: string) {
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
          writes++;
          throw Error("D1_ERROR: account exceeded daily row write limit");
        }
        return db.prepare(sql);
      },
      async batch() {
        writes++;
        throw Error("daily write limit");
      },
    };
    const env = {
      DB,
      WRITE_PAUSED_UNTIL: new Date(Date.now() + 3600000).toISOString(),
      QA_TOKEN: "test",
      AMAP_WEB_SERVICE_KEY: "test",
      AMAP_JS_KEY: "test-browser",
      AMAP_JS_SECURITY_CODE: "test-security",
      UPSTREAM_FETCH: async () => {
        upstream++;
        return Response.json({
          status: "1",
          route: {
            paths: [
              {
                distance: "600",
                duration: "500",
                steps: [
                  {
                    instruction: "步行",
                    polyline: "121.55,29.87;121.551391,29.872218",
                  },
                ],
              },
            ],
          },
        });
      },
    };
    for (const path of [
      "/api/water",
      "/api/community/stores",
      "/api/water/config",
    ]) {
      const r = await worker.fetch(
        new Request("https://api.example" + path),
        env,
      );
      assert.equal(r.status, 200);
      const data = await r.json();
      if (path.endsWith("config")) assert.equal(data.writeReady, false);
    }
    const post = (path: string, body: unknown) =>
      worker.fetch(
        new Request("https://api.example" + path, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    assert.equal((await post("/api/water", {})).status, 503);
    assert.equal((await post("/api/community/comments", {})).status, 503);
    assert.equal(
      (
        await post("/api/water/candidates", {
          center: [121.55, 29.87],
          radius: 3000,
          mode: "home",
        })
      ).status,
      503,
    );
    assert.equal((await post("/api/analytics/events", {})).status, 202);
    assert.equal(upstream, 0);
    const route = await post("/api/navigation/nearest", {
      origin: [121.55, 29.87],
      radius: 3000,
    });
    assert.equal(route.status, 200);
    assert.equal(upstream, 1);
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ ok: true });
      const sdk = await worker.fetch(
        new Request("https://api.example/_AMapService/v3/log/init", {
          headers: { origin },
        }),
        env,
      );
      assert.equal(sdk.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(writes, 0);
  } finally {
    db.close();
  }
});
