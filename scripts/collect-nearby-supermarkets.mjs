// Explicit admin collection of public POIs around Ningbo Tianyi Square, never device GPS.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parse } from "dotenv";
import { brandCategory, isStoreName } from "../src/store-brands.ts";
import { distance } from "../src/domain.ts";

const env = { ...parse(readFileSync(".env", "utf8")), ...process.env };
if (env.PLACE_SEARCH_PAUSED === "true")
  throw Error("PLACE_SEARCH_PAUSED: 手动恢复前不查询供应商。");
if (!env.AMAP_WEB_SERVICE_KEY) throw Error("Map credential missing.");
const center = [121.55027, 29.87386],
  radius = 3000;
const file = ".data/nearby-supermarkets-ningbo.json";
mkdirSync(".data", { recursive: true });
const before = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { stores: {} };
const saved = new Map(Object.entries(before.stores));
let reported = 0,
  received = 0,
  requests = 0;
for (let page = 1; page <= 8; page++) {
  if (page > 1) await new Promise((r) => setTimeout(r, 1250));
  const url = new URL("https://restapi.amap.com/v3/place/around");
  for (const [k, v] of Object.entries({
    key: env.AMAP_WEB_SERVICE_KEY,
    location: center.join(","),
    radius,
    keywords: "超市",
    types: "060400",
    offset: 25,
    page,
    sortrule: "distance",
    extensions: "base",
  }))
    url.searchParams.set(k, String(v));
  let response, data;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    data = await response.json();
  } catch {
    throw Error("Map service unavailable; previous saved data retained.");
  }
  requests++;
  if (!response.ok || data.status !== "1")
    throw Error(
      "Map service rejected collection (" +
        (data.infocode || response.status) +
        "); previous data retained.",
    );
  reported = Math.max(reported, Number(data.count) || 0);
  const rows = Array.isArray(data.pois) ? data.pois : [];
  received += rows.length;
  for (const p of rows) {
    const location = String(p.location || "")
        .split(",")
        .map(Number),
      name = String(p.name || "");
    if (
      !/^[\w-]{1,80}$/.test(p.id || "") ||
      !isStoreName(name) ||
      location.length !== 2 ||
      !location.every(Number.isFinite) ||
      distance(center, location) > radius ||
      !/超级市场|超市/.test(String(p.type || ""))
    )
      continue;
    saved.set(p.id, {
      id: p.id,
      name: name.slice(0, 80),
      category: brandCategory(name) || "market",
      address: [p.cityname, p.adname, p.address]
        .filter((x) => typeof x === "string")
        .join(" ")
        .slice(0, 200),
      location,
      locationPrecision: "poi",
      tags: [],
      source: "amap",
    });
  }
  if (!rows.length || page * 25 >= reported) break;
}
const stores = Object.fromEntries(saved),
  changed = [...saved.values()].filter(
    (s) => JSON.stringify(s) !== JSON.stringify(before.importedStores?.[s.id]),
  );
const run = {
  key: "area:amap:ningbo-tianyi-supermarkets",
  provider: "amap",
  city: "",
  storeIds: [...saved.keys()].sort(),
  fetchedAt: new Date().toISOString(),
  complete: received >= reported,
  warnings:
    received >= reported
      ? []
      : ["宁波天一广场附近超市仅取接口可返回的前200条，可能不完整。"],
};
const snapshot = {
  stores,
  importedStores: before.importedStores || {},
  run,
  reported,
  received,
  requests,
};
const checkpoint = () =>
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", {
    mode: 0o600,
  });
checkpoint();
let rowsWritten = 0;
if (process.argv.includes("--import")) {
  if (!env.DATA_ADMIN_TOKEN)
    throw Error("Import credential missing; collected file retained.");
  for (let i = 0; i < Math.max(1, changed.length); i += 300) {
    const batch = changed.slice(i, i + 300);
    const r = await fetch(
      "https://poor-map-api.gong7968.workers.dev/api/discovery/import",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.DATA_ADMIN_TOKEN,
        },
        body: JSON.stringify({ stores: batch, run }),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok)
      throw Error(
        "Import failed (" + r.status + "); collected file retained for retry.",
      );
    rowsWritten += (await r.json()).storage?.rowsWritten || 0;
    for (const record of batch) snapshot.importedStores[record.id] = record;
    checkpoint();
  }
}
console.log(
  JSON.stringify({
    reference: "宁波天一广场",
    radius,
    saved: saved.size,
    changed: changed.length,
    reported,
    received,
    requests,
    imported: process.argv.includes("--import"),
    rowsWritten,
  }),
);
