import test from "node:test";
import assert from "node:assert/strict";
import { clusterStores } from "../src/map-clusters";
import { seedStores } from "../src/store-domain";
test("dense marker groups preserve every source shop without inventing an identity", () => {
  const stores = Array.from({ length: 500 }, (_, i) => ({
    ...seedStores[0],
    id: "BCLUSTER" + i,
    location: [121.55 + i * 0.0000001, 29.87] as [number, number],
  }));
  const grouped = clusterStores(stores, 13);
  assert.ok(grouped.length < 10);
  assert.equal(
    grouped.reduce((n, g) => n + g.stores.length, 0),
    500,
  );
  assert.deepEqual(
    new Set(grouped.flatMap((g) => g.stores.map((s) => s.id))),
    new Set(stores.map((s) => s.id)),
  );
  assert.ok(
    grouped.every(
      (g) =>
        g.location[0] >= stores[0].location[0] &&
        g.location[0] <= stores.at(-1)!.location[0],
    ),
  );
  const selected = clusterStores(stores, 13, stores[100].id);
  assert.equal(
    selected.find((g) => g.stores.some((s) => s.id === stores[100].id))!.stores
      .length,
    1,
  );
  assert.equal(clusterStores(stores, 19).length, 500);
  assert.equal(stores[0].id, "BCLUSTER0");
});
test("distant shops stay separate and groups remain near the input locations", () => {
  const stores = [
    { ...seedStores[0], id: "BA", location: [121.5, 29.8] as [number, number] },
    { ...seedStores[0], id: "BB", location: [121.6, 29.9] as [number, number] },
  ];
  assert.equal(clusterStores(stores, 15).length, 2);
  assert.deepEqual(
    clusterStores(stores, 15).map((g) => g.location),
    stores.map((s) => s.location),
  );
});
