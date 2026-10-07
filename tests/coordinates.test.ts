import { test } from "node:test";
import assert from "node:assert/strict";
import { gcj02ToWgs84, wgs84ToGcj02, distance } from "../src/domain";
test("geographic basemap conversion round-trips Chinese store locations without changing the stored contract", () => {
  for (const point of [
    [121.55, 29.87],
    [116.3974, 39.9092],
    [120.15, 30.27],
    [113.26, 23.12],
    [114.05, 22.54],
  ] as [number, number][]) {
    const original: [number, number] = [...point],
      stored = wgs84ToGcj02(point);
    assert.ok(distance(point, gcj02ToWgs84(stored)) < 0.05);
    assert.deepEqual(point, original);
  }
  assert.deepEqual(gcj02ToWgs84([0, 0]), [0, 0]);
});
