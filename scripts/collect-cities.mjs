import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parse } from "dotenv";
import { collectionCities, cityListSource } from "../src/collection-cities.ts";
import {
  brandQueries,
  collectionQueryTypes,
  matchesBrand,
  brandCategory,
  isStoreName,
} from "../src/store-brands.ts";
const env = { ...parse(readFileSync(".env", "utf8")), ...process.env };
if (env.PLACE_SEARCH_PAUSED === "true")
  throw Error("PLACE_SEARCH_PAUSED: 手动恢复前不查询供应商。");
if (!env.AMAP_WEB_SERVICE_KEY)
  throw Error("Missing private research map credential.");
const selection =
  process.argv.find((x) => x.startsWith("--cities="))?.split("=")[1] ||
  "priority";
const limit = Number(
  process.argv.find((x) => x.startsWith("--budget="))?.split("=")[1] || 3000,
);
const cityLimitArg = process.argv.find((x) =>
  x.startsWith("--per-city-budget="),
);
const cityLimit = cityLimitArg ? Number(cityLimitArg.slice(18)) : limit;
if (!Number.isInteger(cityLimit) || cityLimit < 1 || cityLimit > limit)
  throw Error("INVALID_CITY_REQUEST_BUDGET");
const refresh = process.argv.includes("--refresh");
const fillGaps = process.argv.includes("--fill-gaps");
const selectedKeywords = process.argv
  .find((x) => x.startsWith("--keywords="))
  ?.slice(11)
  .split(",");
if (fillGaps && refresh)
  throw Error("Gap collection cannot refresh existing snapshots.");
if (selectedKeywords?.some((k) => !brandQueries.some(([, name]) => name === k)))
  throw Error("UNKNOWN_COLLECTION_KEYWORD");
if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
  throw Error("INVALID_REQUEST_BUDGET");
const cities =
  selection === "all"
    ? collectionCities
    : selection === "priority"
      ? collectionCities.filter((c) => c.priority)
      : collectionCities.filter((c) => selection.split(",").includes(c.name));
const keywords = selectedKeywords
  ? brandQueries.filter(([, k]) => selectedKeywords.includes(k))
  : brandQueries;
mkdirSync(".data", { recursive: true });
const file = ".data/city-collection.json",
  job = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { source: cityListSource, cities: {}, requests: 0 };
let used = 0,
  cityStart = 0,
  nextAt = 0;
function checkpoint() {
  writeFileSync(file, JSON.stringify(job, null, 2) + "\n", { mode: 0o600 });
}
async function api(path, params) {
  if (used >= limit) throw Error("REQUEST_BUDGET_EXHAUSTED");
  if (used - cityStart >= cityLimit)
    throw Error("CITY_REQUEST_BUDGET_EXHAUSTED");
  const wait = Math.max(0, nextAt - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  nextAt = Date.now() + 1200;
  used++;
  job.requests++;
  const u = new URL("https://restapi.amap.com" + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set("key", env.AMAP_WEB_SERVICE_KEY);
  let r, d;
  try {
    r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    d = await r.json();
  } catch {
    throw Error("UPSTREAM_UNAVAILABLE");
  }
  if (!r.ok || d.status !== "1") {
    if (["10003", "10004", "10044", "10045"].includes(d.infocode))
      throw Error("PROVIDER_QUOTA_OR_RATE_LIMIT");
    throw Error("UPSTREAM_" + (d.infocode || r.status));
  }
  return d;
}
function prefix(code) {
  return ["11", "12", "31", "50"].includes(code.slice(0, 2))
    ? code.slice(0, 2)
    : code.slice(0, 4);
}
function normalize(p, category, keyword, root) {
  const loc = String(p.location || "")
      .split(",")
      .map(Number),
    name = String(p.name || "");
  if (
    typeof p.id !== "string" ||
    !/^[\w-]{1,80}$/.test(p.id) ||
    loc.length !== 2 ||
    !loc.every(Number.isFinite) ||
    loc[0] < 72 ||
    loc[0] > 138 ||
    loc[1] < 0.8 ||
    loc[1] > 56 ||
    !(p.adcode
      ? String(p.adcode).startsWith(prefix(root.adcode))
      : String(p.cityname || "").replace(/市$/, "") === root.name) ||
    !isStoreName(name) ||
    brandCategory(name) !== category ||
    !matchesBrand(name, keyword)
  )
    return null;
  return {
    id: p.id,
    name: name.slice(0, 80),
    address: [p.cityname, p.adname, p.address]
      .filter((x) => typeof x === "string")
      .join(" ")
      .slice(0, 200),
    category,
    location: loc,
    locationPrecision: "poi",
    tags: [],
    source: "amap",
  };
}
async function district(code, all = false, levels = 1) {
  const d = await api("/v3/config/district", {
    keywords: code,
    subdistrict: levels,
    extensions: all ? "all" : "base",
  });
  return (
    d.districts?.find((x) => String(x.adcode) === String(code)) ||
    d.districts?.find(
      (x) => x.name === code && ["city", "province"].includes(x.level),
    )
  );
}
async function fetchSegment(
  entry,
  city,
  category,
  keyword,
  area,
  depth = 0,
  bounds = null,
) {
  const types = collectionQueryTypes(category, keyword);
  const key = [
    category,
    keyword,
    area.adcode,
    bounds?.join(",") || "text",
    ...(types ? [types] : []),
  ].join(":");
  const previous = entry.segments[key];
  if (previous?.scanned || previous?.complete) {
    if (!fillGaps || depth !== 0 || previous.complete || previous.gapExpanded)
      return;
    // Explore smaller districts without rereading the incomplete city search.
    entry.gapDistricts ||= {};
    if (!entry.gapDistricts[area.adcode]) {
      const a = await district(area.adcode, false, 2);
      const districts = [];
      function visit(nodes) {
        for (const node of nodes || []) {
          if (node.level === "district" && node.adcode !== area.adcode)
            districts.push({ adcode: node.adcode });
          else visit(node.districts);
        }
      }
      visit(a?.districts);
      entry.gapDistricts[area.adcode] = districts;
      checkpoint();
    }
    for (const child of entry.gapDistricts[area.adcode])
      await fetchSegment(entry, city, category, keyword, child, depth + 1);
    // Original mismatch remains visible; exploring districts is not proof of completeness.
    previous.gapExpanded = true;
    checkpoint();
    return;
  }
  const params = bounds
    ? {
        keywords: keyword,
        polygon: `${bounds[0]},${bounds[3]}|${bounds[2]},${bounds[1]}`,
        offset: 25,
        page: 1,
        extensions: "base",
      }
    : {
        keywords: keyword,
        city: area.adcode,
        citylimit: "true",
        offset: 25,
        page: 1,
        extensions: "base",
      };
  if (types) params.types = types;
  const path = bounds ? "/v3/place/polygon" : "/v3/place/text",
    d = previous?.inProgress
      ? { count: previous.reported, pois: [] }
      : await api(path, params),
    count = Number(d.count) || 0;
  if (count > 200) {
    if (!bounds) {
      let a = await district(area.adcode, false);
      let children = (a?.districts || []).filter((x) =>
        ["city", "district"].includes(x.level),
      );
      if (children.length) {
        for (const child of children)
          await fetchSegment(entry, city, category, keyword, child, depth + 1);
        entry.segments[key] = {
          complete: true,
          split: "district",
          reported: count,
        };
        checkpoint();
        return;
      }
      a = await district(area.adcode, true);
      const points = String(a?.polyline || "")
        .split(/[;|]/)
        .map((s) => s.split(",").map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (points.length) {
        bounds = [
          Math.min(...points.map((p) => p[0])),
          Math.min(...points.map((p) => p[1])),
          Math.max(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])),
        ];
      }
    }
    if (
      bounds &&
      depth < 9 &&
      Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) > 0.004
    ) {
      const [x0, y0, x1, y1] = bounds,
        x = (x0 + x1) / 2,
        y = (y0 + y1) / 2;
      for (const b of [
        [x0, y0, x, y],
        [x, y0, x1, y],
        [x0, y, x, y1],
        [x, y, x1, y1],
      ])
        await fetchSegment(entry, city, category, keyword, area, depth + 1, b);
      entry.segments[key] = { complete: true, split: "grid", reported: count };
      checkpoint();
      return;
    }
    entry.segments[key] = {
      complete: false,
      reported: count,
      reason: "接口200条上限，当前区域仍需进一步处理",
    };
    checkpoint();
    return;
  }
  const state = previous?.inProgress
    ? previous
    : {
        complete: false,
        inProgress: true,
        reported: count,
        received: 0,
        nextPage: 1,
      };
  function savePage(rows) {
    for (const p of rows) {
      const store = normalize(p, category, keyword, city);
      if (store) entry.stores[store.id] = store;
    }
    state.received += rows.length;
    state.nextPage++;
    if (!rows.length) state.emptyPage = true;
    entry.segments[key] = state;
    checkpoint();
  }
  if (state.nextPage === 1) savePage(d.pois || []);
  while (!state.emptyPage && state.nextPage <= Math.ceil(count / 25)) {
    const more = await api(path, { ...params, page: state.nextPage });
    savePage(more.pois || []);
  }
  entry.segments[key] = {
    complete: state.received >= count,
    scanned: true,
    countMatched: state.received >= count,
    reported: count,
    received: state.received,
  };
  checkpoint();
}
const ordered = [...cities].sort(
  (a, b) =>
    Number(b.name === "宁波") - Number(a.name === "宁波") ||
    Number(b.priority) - Number(a.priority),
);
for (const c of ordered) {
  cityStart = used;
  const entry = (job.cities[c.name] ||= {
    ...c,
    stores: {},
    segments: {},
    complete: false,
  });
  if (refresh) {
    entry.segments = {};
    entry.scanned = false;
    entry.complete = false;
    delete entry.lastError;
    checkpoint();
  }
  const currentKeywords = brandQueries.map(([category, keyword]) =>
    [category, keyword, collectionQueryTypes(category, keyword)]
      .filter(Boolean)
      .join(":"),
  );
  const unchanged =
    JSON.stringify(entry.keywordSet || []) === JSON.stringify(currentKeywords);
  if (
    !fillGaps &&
    !selectedKeywords &&
    (entry.scanned || entry.complete) &&
    unchanged
  ) {
    console.log(c.name + " 已有已读取分页快照，跳过重复请求。");
    continue;
  }
  try {
    if (!entry.adcode) {
      const a = await district(c.name + "市");
      if (
        !a ||
        !["city", "province"].includes(a.level) ||
        a.name !== c.name + "市"
      )
        throw Error("CITY_NOT_FOUND");
      entry.adcode = a.adcode;
      entry.center = String(a.center).split(",").map(Number);
      checkpoint();
    }
    for (const [category, keyword] of keywords)
      await fetchSegment(entry, entry, category, keyword, {
        adcode: entry.adcode,
      });
    entry.complete = Object.values(entry.segments).every((s) => s.complete);
    if (!selectedKeywords) entry.keywordSet = currentKeywords;
    entry.scanned = true;
    delete entry.lastError;
    if (used > cityStart) entry.fetchedAt = new Date().toISOString();
    checkpoint();
    console.log(
      JSON.stringify({
        city: c.name,
        stores: Object.keys(entry.stores).length,
        complete: entry.complete,
        requestsThisRun: used,
        requestsThisCity: used - cityStart,
      }),
    );
  } catch (e) {
    entry.lastError = e.message;
    if (used > cityStart) entry.fetchedAt = new Date().toISOString();
    checkpoint();
    console.log(
      JSON.stringify({
        city: c.name,
        status: "未收齐",
        reason: e.message,
        requestsThisRun: used,
        requestsThisCity: used - cityStart,
      }),
    );
    if (
      ["REQUEST_BUDGET_EXHAUSTED", "PROVIDER_QUOTA_OR_RATE_LIMIT"].includes(
        e.message,
      )
    )
      break;
  }
}
console.log(
  JSON.stringify(
    {
      collected: Object.values(job.cities).map((c) => ({
        city: c.name,
        count: Object.keys(c.stores).length,
        complete: c.complete,
      })),
      requestsThisRun: used,
      journal: file,
    },
    null,
    2,
  ),
);
