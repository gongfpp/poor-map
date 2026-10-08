import { distance } from "./domain.ts";
export type WaterOffer = {
  id: string;
  storeId: string;
  storeName: string;
  address: string;
  location: [number, number] | null;
  locationPrecision: "poi" | "area" | "unknown";
  product: string;
  waterType: "mineral" | "purified" | "unknown";
  volumeMl: number | null;
  bottles: number;
  price: number;
  priceHigh: number | null;
  channel: "offline" | "meituan" | "douyin" | "other";
  sourceUrl: string;
  requirements: string;
  observedOn: string;
  validUntil: string;
  status: "unknown" | "available" | "sold-out" | "ended";
  origin: "user-tip" | "community";
  version: number;
  createdAt: string;
  updatedAt: string;
  feedback?: {
    available: number;
    changed: number;
    soldOut: number;
    lastAt: string;
    lastType?: string;
  };
};
export type WaterInput = Omit<
  WaterOffer,
  "id" | "origin" | "version" | "createdAt" | "updatedAt" | "feedback"
>;
export const ningboCenter: [number, number] = [121.55027, 29.87386];
export const seedWater: WaterOffer[] = [
  {
    id: "ningbo-k11-water",
    storeId: "ningbo-k11-b1",
    storeName: "宁波 K11 · 负一层超市",
    address: "宁波市鄞州区杨柳街150号 / 中山东路360号 K11 B1（商场范围）",
    location: [121.563732, 29.868714],
    locationPrecision: "area",
    product: "550ml 饮用水 · 24瓶整箱",
    waterType: "unknown",
    volumeMl: 550,
    bottles: 24,
    price: 8.9,
    priceHigh: null,
    channel: "other",
    sourceUrl: "",
    requirements:
      "用户提供：团购 8.9 元 24 瓶 550ml。品牌、购买平台原始链接、资格、库存与有效期未提供；按整箱购买，请先向商家核实。",
    observedOn: "",
    validUntil: "",
    status: "unknown",
    origin: "user-tip",
    version: 1,
    createdAt: "2026-10-07T08:00:00.000Z",
    updatedAt: "2026-10-07T08:00:00.000Z",
  },
  {
    id: "ningbo-donggudao-water",
    storeId: "ningbo-donggudao-hotmaxx",
    storeName: "好特卖 · 天一广场东鼓道",
    address: "中山东路东鼓道地铁商业街B1-25（高德POI参考位置）",
    location: [121.551391, 29.872218],
    locationPrecision: "poi",
    product: "饮用水 · 品牌和容量待补充",
    waterType: "unknown",
    volumeMl: null,
    bottles: 1,
    price: 0.9,
    priceHigh: 1.2,
    channel: "offline",
    sourceUrl: "",
    requirements:
      "用户提供：有时 0.9 元，有时 1.2 元。品牌、容量、见价日期与具体铺位未提供；价格可能变化，不参与每升单价排名。",
    observedOn: "",
    validUntil: "",
    status: "unknown",
    origin: "user-tip",
    version: 1,
    createdAt: "2026-10-07T08:00:00.000Z",
    updatedAt: "2026-10-07T08:00:00.000Z",
  },
];
export function liters(o: WaterOffer) {
  return o.volumeMl ? (o.volumeMl * o.bottles) / 1000 : null;
}
export function perLiter(o: WaterOffer) {
  const volume = liters(o);
  return volume ? o.price / volume : null;
}
export function perLiterHigh(o: WaterOffer) {
  const volume = liters(o);
  return volume ? (o.priceHigh ?? o.price) / volume : null;
}
export function waterStatus(o: WaterOffer): string {
  return o.feedback?.lastType && o.feedback.lastAt > o.updatedAt
    ? o.feedback.lastType
    : o.status;
}
export function usableOffer(o: WaterOffer, now = Date.now()) {
  return (
    o.status !== "ended" &&
    o.status !== "sold-out" &&
    waterStatus(o) !== "sold-out" &&
    (!o.validUntil || Date.parse(o.validUntil) > now)
  );
}
export type WaterFilters = {
  radius: number;
  pack: "all" | "large" | "small" | "case";
  sort: "liter" | "distance" | "spend";
  onlyAvailable: boolean;
  channel: string;
  query: string;
  includeInactive?: boolean;
};
export function waterResults(
  offers: WaterOffer[],
  center: [number, number],
  filters: WaterFilters,
) {
  return offers
    .filter(
      (o) =>
        (filters.includeInactive || usableOffer(o)) &&
        o.location &&
        distance(center, o.location) <= filters.radius &&
        (!filters.onlyAvailable ||
          (usableOffer(o) && waterStatus(o) === "available")) &&
        (filters.channel === "all" || o.channel === filters.channel) &&
        (!filters.query ||
          `${o.storeName} ${o.product} ${o.address}`
            .toLowerCase()
            .includes(filters.query.toLowerCase().trim())) &&
        (filters.pack === "all" ||
          (filters.pack === "large" &&
            o.volumeMl !== null &&
            o.volumeMl >= 1200 &&
            o.volumeMl <= 2500) ||
          (filters.pack === "small" &&
            o.volumeMl !== null &&
            o.volumeMl < 1200) ||
          (filters.pack === "case" && o.bottles > 1)),
    )
    .sort((a, b) =>
      filters.sort === "distance"
        ? distance(center, a.location!) - distance(center, b.location!)
        : filters.sort === "spend"
          ? (a.priceHigh ?? a.price) - (b.priceHigh ?? b.price)
          : (perLiterHigh(a) ?? Infinity) - (perLiterHigh(b) ?? Infinity) ||
            distance(center, a.location!) - distance(center, b.location!),
    );
}
export function validateWater(value: unknown): string | null {
  if (!value || typeof value !== "object") return "请提供完整的水价线索。";
  const o = value as WaterInput;
  for (const [key, max] of [
    ["storeId", 100],
    ["storeName", 100],
    ["address", 250],
    ["product", 100],
    ["requirements", 1500],
    ["sourceUrl", 2000],
    ["observedOn", 10],
    ["validUntil", 30],
  ] as const)
    if (typeof o[key] !== "string" || o[key].length > max)
      return "文本格式或长度不正确。";
  if (
    !o.storeId.trim() ||
    !o.storeName.trim() ||
    !o.address.trim() ||
    !o.product.trim() ||
    !o.requirements.trim()
  )
    return "请填写门店、地址、水名称和购买说明。";
  if (
    !Number.isFinite(o.price) ||
    o.price < 0 ||
    o.price > 10000 ||
    !Number.isInteger(o.bottles) ||
    o.bottles < 1 ||
    o.bottles > 200
  )
    return "价格与瓶数不正确。";
  if (
    o.priceHigh !== null &&
    (!Number.isFinite(o.priceHigh) ||
      o.priceHigh < o.price ||
      o.priceHigh > 10000)
  )
    return "波动价格上限不能低于最低价。";
  if (
    o.volumeMl !== null &&
    (!Number.isInteger(o.volumeMl) || o.volumeMl < 100 || o.volumeMl > 20000)
  )
    return "单瓶容量应为 100–20000ml，未知时留空。";
  if (
    o.location !== null &&
    (!Array.isArray(o.location) ||
      o.location.length !== 2 ||
      !o.location.every(Number.isFinite) ||
      o.location[0] < 72 ||
      o.location[0] > 138 ||
      o.location[1] < 0.8 ||
      o.location[1] > 56)
  )
    return "门店坐标无效。";
  if (
    !["poi", "area", "unknown"].includes(o.locationPrecision) ||
    !["mineral", "purified", "unknown"].includes(o.waterType) ||
    !["offline", "meituan", "douyin", "other"].includes(o.channel) ||
    !["unknown", "available", "sold-out", "ended"].includes(o.status)
  )
    return "请选择有效的来源、门店位置与销售状态。";
  if (o.sourceUrl) {
    try {
      const u = new URL(o.sourceUrl);
      if (u.protocol !== "https:" || u.username || u.password)
        return "原始链接应为 HTTPS 地址。";
    } catch {
      return "原始链接无效。";
    }
  }
  if (
    o.observedOn &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(o.observedOn) ||
      !Number.isFinite(Date.parse(o.observedOn)) ||
      o.observedOn > new Date().toISOString().slice(0, 10))
  )
    return "见价日期不能晚于今天。";
  if (
    o.validUntil &&
    (!Number.isFinite(Date.parse(o.validUntil)) ||
      Date.parse(o.validUntil) <= Date.now())
  )
    return "优惠截止时间应晚于现在，未知时留空。";
  return null;
}
