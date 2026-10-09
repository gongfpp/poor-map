import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { parse } from "dotenv";
import { planNearest } from "../worker/navigation.mjs";

const env = { ...parse(readFileSync(".env")), ...process.env };
if (!env.QA_TOKEN || !env.BAIDU_WEB_SERVICE_KEY || !env.BAIDU_WEB_SERVICE_SK)
  throw Error("Private QA and Baidu server credentials are required.");
const backend = process.argv[2] || "https://poor-map-api.gong7968.workers.dev";
const headers = {
  "Content-Type": "application/json",
  "X-QA-Token": env.QA_TOKEN,
  "X-QA-Scope": "backup-" + randomUUID(),
};
const origin = [121.554225, 29.869432]; // Public Tianyi Square reference, never device GPS.
async function call(path, method = "GET", body) {
  const r = await fetch(backend + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json();
  assert.ok(
    r.ok,
    `Backup verification failed (${r.status}): ${String(data.error || "")
      .replace(/https?:\/\/\S+/g, "[URL]")
      .replace(/[A-Za-z0-9]{32}/g, "[credential]")}`,
  );
  return data;
}
try {
  let data, cloudError;
  try {
    data = await call("/api/water/candidates", "POST", {
      provider: "baidu",
      center: origin,
      radius: 3000,
      mode: "home",
    });
  } catch (e) {
    cloudError = e.message;
  }
  if (data) {
    assert.equal(data.provider, "baidu");
    assert.equal(data.refreshed, true);
    assert.ok(data.stores.length > 0);
  }
  const target = data?.stores.find(
    (s) => s.category === "discount" && /好特卖|hotmaxx/i.test(s.name),
  ) || {
    id: "B0H12LCG0X",
    name: "好特卖HotMaxx(东鼓道店)",
    category: "discount",
    source: "amap",
    location: [121.551391, 29.872218],
    tags: [],
    address: "",
  };
  assert.ok(target, "Actual nearby HotMaxx was not returned.");
  if (data) assert.equal(target.source, "baidu");
  let primaryFailures = 0,
    realBackupCalls = 0;
  const route = await planNearest(
    origin,
    [target],
    {
      ...env,
      TENCENT_WEB_SERVICE_KEY: "",
      TENCENT_MAP_KEY: "",
      AMAP_WEB_SERVICE_KEY: env.AMAP_WEB_SERVICE_KEY || "controlled-primary",
      BAIDU_MD5: (bytes) => createHash("md5").update(bytes).digest(),
    },
    async (url, options) => {
      if (url.hostname === "restapi.amap.com") {
        primaryFailures++;
        return new Response("{}", { status: 503 });
      }
      assert.equal(url.hostname, "api.map.baidu.com");
      realBackupCalls++;
      return fetch(url, options);
    },
  );
  assert.equal(route.provider, "baidu");
  assert.ok(route.distance > 0 && route.polyline.length > 2);
  assert.equal(primaryFailures, 1);
  assert.equal(realBackupCalls, 1);
  assert.ok(route.warnings.some((s) => s.includes("备用")));
  console.log(
    JSON.stringify(
      {
        cloudBaiduDiscovery: data
          ? {
              passed: true,
              stores: data.stores.length,
              warnings: data.warnings,
            }
          : { passed: false, error: cloudError },
        controlledPrimaryFailureWithRealBaiduRoute: {
          meters: route.distance,
          seconds: route.duration,
          points: route.polyline.length,
          primaryFailures,
          realBackupCalls,
        },
      },
      null,
      2,
    ),
  );
  if (cloudError) process.exitCode = 1;
} finally {
  await call("/api/community/qa", "DELETE");
  const after = await call(
    `/api/water/candidates?center=${origin}&radius=3000&mode=home`,
  );
  assert.equal(after.stores.length, 0);
  console.log("Isolated backup verification data cleaned.");
}
