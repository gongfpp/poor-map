import { seedStores } from "../src/store-domain.ts";
const oldPoint = (o) =>
  o?.location?.[0] === 121.5549 && o?.location?.[1] === 29.8731;
export async function correctStorePoint(env) {
  const seed = seedStores[0];
  const row = await env.DB.prepare(
    "SELECT record FROM stores WHERE scope='public' AND id=?",
  )
    .bind(seed.id)
    .first();
  if (!row) return;
  const o = JSON.parse(row.record);
  if (!oldPoint(o) || o.name !== seed.name || o.source !== "community") return;
  const next = {
    ...o,
    location: seed.location,
    locationPrecision: seed.locationPrecision,
    address: seed.address,
    amapId: seed.amapId,
  };
  await env.DB.prepare(
    "UPDATE stores SET record=? WHERE scope='public' AND id=? AND record=?",
  )
    .bind(JSON.stringify(next), seed.id, row.record)
    .run();
}
export async function correctWaterPoint(env) {
  const id = "ningbo-donggudao-water",
    seed = seedStores[0];
  const row = await env.DB.prepare(
    "SELECT record FROM offers WHERE scope='public' AND id=?",
  )
    .bind(id)
    .first();
  if (!row) return;
  const o = JSON.parse(row.record);
  if (!oldPoint(o) || o.storeId !== seed.id || o.origin !== "user-tip") return;
  const next = {
    ...o,
    location: seed.location,
    locationPrecision: seed.locationPrecision,
    address: seed.address,
    version: o.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const record = JSON.stringify(next);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO revisions(scope,offer_id,before_record,after_record,created_at) SELECT scope,id,record,?,? FROM offers WHERE scope='public' AND id=? AND record=?",
    ).bind(record, next.updatedAt, id, row.record),
    env.DB.prepare(
      "UPDATE offers SET record=?,version=?,updated_at=? WHERE scope='public' AND id=? AND record=?",
    ).bind(record, next.version, next.updatedAt, id, row.record),
  ]);
}
