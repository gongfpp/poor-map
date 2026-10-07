export type Category =
  "snack" | "discount" | "daily" | "market" | "meal" | "mixue";
export type DealKind = "free" | "checkin" | "discount";
export type Store = {
  id: string;
  name: string;
  category: Category;
  address: string;
  location: [number, number];
  tags: string[];
  locationPrecision?: "poi" | "area";
  price?: number;
  priceNote?: string;
  source: "demo" | "amap" | "community";
};
export type Deal = {
  id: string;
  storeId: string;
  title: string;
  kind: DealKind;
  price: number;
  minSpend: number;
  lottery: boolean;
  requirements: string;
  expiresAt: string;
  sourceUrl: string;
  source: "demo" | "local";
  createdAt: string;
};
export type Filters = {
  category: string;
  query: string;
  radius: number;
  budget: number;
  sort: string;
  feed: string;
  dealKind: string;
  noSpend: boolean;
  noLottery: boolean;
  hasSource: boolean;
};
export const categories: {
  id: Category;
  label: string;
  short: string;
  color: string;
  keywords: string;
}[] = [
  {
    id: "snack",
    label: "零食超市",
    short: "零食",
    color: "#f29655",
    keywords: "赵一鸣零食|零食很忙|零食有鸣|鸣鸣很忙|零食折扣",
  },
  {
    id: "discount",
    label: "硬折扣店",
    short: "折扣",
    color: "#8a68d8",
    keywords: "好特卖|嗨特购|奥特乐|折扣超市",
  },
  {
    id: "daily",
    label: "平价百货",
    short: "百货",
    color: "#6c9b77",
    keywords: "MINISO名创优品|三福|十元店|平价百货",
  },
  {
    id: "market",
    label: "菜场生鲜",
    short: "生鲜",
    color: "#b4a039",
    keywords: "菜市场|农贸市场|生鲜折扣",
  },
  {
    id: "meal",
    label: "平价餐饮",
    short: "吃饭",
    color: "#e47b86",
    keywords: "沙县小吃|兰州拉面|社区食堂|蜜雪冰城",
  },
];
export const activeCategories = [
  {
    id: "discount" as Category,
    label: "硬折扣店",
    short: "折扣",
    color: "#8a68d8",
    keywords: "赵一鸣零食|零食很忙|零食有鸣|好特卖|嗨特购|奥特乐",
  },
  {
    id: "mixue" as Category,
    label: "蜜雪冰城",
    short: "蜜雪",
    color: "#e47b86",
    keywords: "蜜雪冰城",
  },
];
categories.push(activeCategories[1]);
export const cities = [
  { name: "宁波", center: [121.55027, 29.87386] as [number, number] },
  { name: "杭州", center: [120.15507, 30.27408] as [number, number] },
  { name: "上海", center: [121.4737, 31.2304] as [number, number] },
  { name: "北京", center: [116.3974, 39.9092] as [number, number] },
  { name: "广州", center: [113.2644, 23.1291] as [number, number] },
  { name: "深圳", center: [114.0579, 22.5431] as [number, number] },
];
export function distance(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const dlat = (b[1] - a[1]) * rad,
    dlng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export const distanceText = (meters: number) =>
  meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
export function activeDeals(deals: Deal[], now = Date.now()) {
  return deals.filter(
    (d) =>
      Number.isFinite(Date.parse(d.expiresAt)) && Date.parse(d.expiresAt) > now,
  );
}
export function matchingDeals(deals: Deal[], filters: Filters) {
  return activeDeals(deals).filter(
    (d) =>
      (filters.dealKind === "all" || d.kind === filters.dealKind) &&
      (!filters.noSpend || d.minSpend === 0) &&
      (!filters.noLottery || !d.lottery) &&
      (!filters.hasSource || !!d.sourceUrl) &&
      d.price + d.minSpend <= filters.budget,
  );
}
export function filterStores(
  stores: Store[],
  deals: Deal[],
  filters: Filters,
  center: [number, number],
  saved: string[],
) {
  const matches = matchingDeals(deals, filters);
  return stores
    .filter((s) => {
      const ds = matches.filter((d) => d.storeId === s.id);
      return (
        (filters.category === "all" || s.category === filters.category) &&
        (!filters.query ||
          `${s.name} ${s.address} ${s.tags.join(" ")} ${ds.map((d) => d.title).join(" ")}`
            .toLowerCase()
            .includes(filters.query.toLowerCase().trim())) &&
        distance(center, s.location) <= filters.radius &&
        (filters.feed !== "saved" || saved.includes(s.id)) &&
        (filters.feed !== "events" || ds.length > 0) &&
        (filters.feed === "events" ||
          filters.budget === Infinity ||
          (s.price !== undefined && s.price <= filters.budget) ||
          ds.length > 0)
      );
    })
    .sort((a, b) => {
      const price = (s: Store) =>
        filters.feed !== "events" &&
        s.price !== undefined &&
        s.price <= filters.budget
          ? s.price
          : Math.min(
              ...matches
                .filter((d) => d.storeId === s.id)
                .map((d) => d.price + d.minSpend),
            );
      return filters.sort === "price"
        ? price(a) - price(b) ||
            distance(center, a.location) - distance(center, b.location)
        : distance(center, a.location) - distance(center, b.location);
    });
}
export function validateDeal(
  input: Omit<Deal, "id" | "createdAt" | "source">,
): string | null {
  if (!input.storeId || !input.title.trim() || !input.requirements.trim())
    return "请填写门店、标题和参与条件。";
  if (
    ![input.price, input.minSpend].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 100000,
    )
  )
    return "价格与最低消费应为有效的非负金额。";
  if (!["free", "checkin", "discount"].includes(input.kind))
    return "请选择活动类型。";
  if (input.kind === "free" && input.price !== 0)
    return "霸王餐领取价应为 0 元；额外消费请单独填写。";
  if (
    !Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.now()
  )
    return "截止时间必须晚于当前时间。";
  try {
    const url = new URL(input.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      return "请提供 https 原始活动链接。";
  } catch {
    return "请提供可打开的 https 原始活动链接。";
  }
  return null;
}
export function wgs84ToGcj02([lng, lat]: [number, number]): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271)
    return [lng, lat];
  const pi = Math.PI,
    x = lng - 105,
    y = lat - 35;
  let dlat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  dlat +=
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3 +
    ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3 +
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  let dlng =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  dlng +=
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3 +
    ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3 +
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;
  const rlat = (lat / 180) * pi,
    magic = 1 - 0.006693421622965943 * Math.sin(rlat) ** 2,
    sqrt = Math.sqrt(magic);
  return [
    lng + (dlng * 180) / ((6378245 / sqrt) * Math.cos(rlat) * pi),
    lat +
      (dlat * 180) /
        (((6378245 * (1 - 0.006693421622965943)) / (magic * sqrt)) * pi),
  ];
}

// The stored contract remains GCJ-02; inverse conversion is for geographic basemaps only.
export function gcj02ToWgs84(point: [number, number]): [number, number] {
  let estimate: [number, number] = [...point];
  for (let i = 0; i < 6; i++) {
    const projected = wgs84ToGcj02(estimate);
    estimate = [
      estimate[0] + point[0] - projected[0],
      estimate[1] + point[1] - projected[1],
    ];
  }
  return estimate;
}
