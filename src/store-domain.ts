import type { Store } from "./domain";
export type SharedStore = Store & {
  locationPrecision: "poi" | "area";
  createdAt: string;
};
export type StoreInput = {
  name: string;
  category: "discount" | "mixue";
  address: string;
  location: [number, number];
};
export const seedStores: SharedStore[] = [
  {
    id: "ningbo-donggudao-hotmaxx",
    name: "好特卖 · 天一广场东鼓道",
    category: "discount",
    address: "中山东路东鼓道地铁商业街B1-25（高德POI参考位置）",
    location: [121.551391, 29.872218],
    locationPrecision: "poi",
    amapId: "B0H12LCG0X",
    tags: [],
    source: "community",
    createdAt: "2026-10-07T08:00:00.000Z",
  },
];
export function validateStore(input: StoreInput) {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 80
  )
    return "请填写门店名称（2—80字）。";
  if (!["discount", "mixue"].includes(input.category))
    return "请选择硬折扣店或蜜雪冰城。";
  if (typeof input.address !== "string" || input.address.length > 200)
    return "地址最多200字。";
  if (
    !Array.isArray(input.location) ||
    input.location.length !== 2 ||
    !input.location.every(Number.isFinite) ||
    input.location[0] < 72 ||
    input.location[0] > 138 ||
    input.location[1] < 0 ||
    input.location[1] > 56
  )
    return "请在地图上选择门店位置。";
  return null;
}
