import { readFileSync } from "node:fs";
import { parse } from "dotenv";
const env = { ...parse(readFileSync(".env", "utf8")), ...process.env },
  job = JSON.parse(readFileSync(".data/city-collection.json", "utf8")),
  base = process.argv[2] || "https://poor-map-api.gong7968.workers.dev";
if (!env.DATA_ADMIN_TOKEN) throw Error("Private import credential required.");
const remote = await (
  await fetch(base + "/api/discovery/summary", {
    signal: AbortSignal.timeout(25000),
  })
).json();
for (const city of Object.values(job.cities)) {
  if (!Object.keys(city.stores).length && !city.scanned) continue;
  const stores = Object.values(city.stores),
    run = {
      key: "city:amap:" + city.adcode,
      provider: "amap",
      city: city.adcode,
      cityName: city.name,
      center: city.center,
      tier: city.tier,
      complete: city.complete,
      fetchedAt: city.fetchedAt || new Date().toISOString(),
      cityListSource: job.source,
      scope: "已启用的硬折扣品牌与蜜雪冰城",
      warnings: city.complete
        ? []
        : [city.name + "为已读取的接口结果，可能不完整。"],
    };
  const prior = remote.cities?.find(
    (c) => c.city === city.adcode && c.provider === "amap",
  );
  const count = (remote.groups || [])
    .filter((g) => g.city === city.adcode && g.provider === "amap")
    .reduce((n, g) => n + g.count, 0);
  if (prior?.fetchedAt === city.fetchedAt && count === stores.length) {
    console.log(JSON.stringify({ city: city.name, count, skipped: true }));
    continue;
  }
  let rowsWritten = 0;
  for (let i = 0; i < Math.max(1, stores.length); i += 300) {
    const r = await fetch(base + "/api/discovery/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.DATA_ADMIN_TOKEN,
      },
      body: JSON.stringify({ stores: stores.slice(i, i + 300), run }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok)
      throw Error(
        "Import failed (" + r.status + "), saved local journal retained.",
      );
    const result = await r.json();
    rowsWritten += result.storage?.rowsWritten || 0;
  }
  console.log(
    JSON.stringify({
      city: city.name,
      count: stores.length,
      complete: city.complete,
      rowsWritten,
    }),
  );
}
