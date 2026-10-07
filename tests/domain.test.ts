import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeDeals,
  filterStores,
  matchingDeals,
  validateDeal,
  wgs84ToGcj02,
  distance,
  type Filters,
  type Store,
  type Deal,
} from "../src/domain.ts";
const center: [number, number] = [121.55, 29.87];
const filters: Filters = {
  category: "all",
  query: "",
  radius: 3000,
  budget: Infinity,
  sort: "distance",
  feed: "nearby",
  dealKind: "all",
  noSpend: false,
  noLottery: false,
  hasSource: false,
};
const store: Store = {
  id: "a",
  name: "门店",
  category: "meal",
  location: center,
  address: "街道",
  tags: [],
  source: "amap",
};
const deal: Deal = {
  id: "d",
  storeId: "a",
  title: "福利",
  kind: "checkin",
  price: 0,
  minSpend: 0,
  lottery: false,
  requirements: "到店",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  sourceUrl: "https://www.dianping.com/example",
  source: "local",
  createdAt: new Date().toISOString(),
};
test("unknown POI price is not treated as free", () =>
  assert.equal(
    filterStores([store], [], { ...filters, budget: 0 }, center, []).length,
    0,
  ));
test("minimum spend counts towards budget", () => {
  assert.equal(
    matchingDeals([{ ...deal, minSpend: 20 }], { ...filters, budget: 10 })
      .length,
    0,
  );
  assert.equal(
    matchingDeals([{ ...deal, minSpend: 20 }], { ...filters, noSpend: true })
      .length,
    0,
  );
});
test("lotteries and unsupported source links are excluded by explicit filters", () => {
  assert.equal(
    matchingDeals([{ ...deal, lottery: true }], { ...filters, noLottery: true })
      .length,
    0,
  );
  assert.equal(
    matchingDeals([{ ...deal, sourceUrl: "" }], { ...filters, hasSource: true })
      .length,
    0,
  );
});
test("expired or invalid activities disappear", () =>
  assert.equal(
    activeDeals([
      { ...deal, expiresAt: "2020-01-01" },
      { ...deal, expiresAt: "invalid" },
    ]).length,
    0,
  ));
test("real POI can match zero budget only with an actual zero-cost clue", () =>
  assert.equal(
    filterStores(
      [store],
      [deal],
      { ...filters, feed: "events", budget: 0, noSpend: true, noLottery: true },
      center,
      [],
    ).length,
    1,
  ));
test("category, distance and bookmarks are conjunctive", () => {
  assert.equal(
    filterStores([store], [], { ...filters, category: "snack" }, center, [])
      .length,
    0,
  );
  assert.equal(
    filterStores([store], [], { ...filters, feed: "saved" }, center, ["a"])
      .length,
    1,
  );
  assert.equal(
    filterStores([{ ...store, location: [120, 30] }], [], filters, center, [])
      .length,
    0,
  );
});
test("lowest offer sorts before a known retail price", () =>
  assert.deepEqual(
    filterStores(
      [store, { ...store, id: "b", price: 4 }],
      [deal],
      { ...filters, sort: "price" },
      center,
      [],
    ).map((s) => s.id),
    ["a", "b"],
  ));
test("submission rejects executable URLs, past dates, negative and invalid prices", () => {
  assert.match(
    validateDeal({ ...deal, sourceUrl: "javascript:alert(1)" })!,
    /https/,
  );
});
test("submission validation enforces free label and realistic numeric input", () => {
  for (const bad of [
    { ...deal, price: -1 },
    { ...deal, price: NaN },
    { ...deal, kind: "free" as const, price: 3 },
    { ...deal, expiresAt: "2020-01-01" },
  ])
    assert.notEqual(validateDeal(bad), null);
  assert.equal(validateDeal(deal), null);
});
test("WGS84 coordinates are converted for domestic AMap queries", () => {
  const point = wgs84ToGcj02([116.3974, 39.9092]);
  assert.ok(point[0] > 116.4 && point[0] < 116.41);
  assert.ok(point[1] > 39.91 && point[1] < 39.92);
  assert.deepEqual(wgs84ToGcj02([-74, 40]), [-74, 40]);
  assert.ok(distance(center, [121.551, 29.87]) > 90);
});
