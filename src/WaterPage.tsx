import { useWriteResume } from "./useWriteResume";
import { useMapList } from "./useMapList";
import BrandFilter from "./BrandFilter";
import LocationHelp from "./LocationHelp";
import { brandCategory, matchesStoreBrand } from "./store-brands";
import { preferredMap, rememberMap } from "./map-preference";
import { storeSourceName } from "./domain";
import { discoverStores, discoverAmap, cacheDescription } from "./discovery";
import { track } from "./telemetry";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Droplets,
  ExternalLink,
  History,
  LocateFixed,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import { cities, distance, distanceText, type Store } from "./domain";
import {
  ningboCenter,
  liters,
  perLiter,
  perLiterHigh,
  usableOffer,
  waterResults,
  waterStatus,
  validateWater,
  simpleWaterInput,
  type WaterOffer,
  type WaterInput,
  type WaterFilters,
} from "./water-domain";
import { currentLocation } from "./location";
import { seedStores } from "./store-domain";
import { WATER_API } from "./config";
import Modal from "./Modal";
import MapView from "./MapView";
import "./water.css";
const initialFilters: WaterFilters = {
  radius: 3000,
  pack: "all",
  sort: "liter",
  onlyAvailable: false,
  channel: "all",
  query: "",
};
const emptyEvents = new Set<string>();
const fmt = (n: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(n);
const date = (s: string) =>
  s
    ? new Date(s).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      })
    : "未提供";
const channelText = {
  offline: "线下货架",
  meituan: "美团团购",
  douyin: "抖音团购",
  other: "其他 / 待确认",
};
const statusText = {
  unknown: "当前价格与库存待确认",
  available: "用户反馈有货 · 未核验",
  "sold-out": "用户反馈已卖完",
  ended: "优惠已结束",
};
const statusLabels: Record<string, string> = {
  ...statusText,
  changed: "最近用户反馈价格变化 · 请复核",
};
async function api(path = "", init?: RequestInit) {
  const response = await fetch(`${WATER_API}/api/water${path}`, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    track("api_error", { statusCode: response.status });
    throw new Error(data.error || "共享水价服务暂时不可用。");
  }
  return data;
}
export default function WaterPage() {
  const [center, setCenter] = useState<[number, number]>(ningboCenter),
    [position, setPosition] = useState("正在获取位置 · 暂以宁波为中心"),
    [filters, setFilters] = useState(initialFilters);
  const [offers, setOffers] = useState<WaterOffer[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [ready, setReady] = useState(false),
    [refresh, setRefresh] = useState(0),
    [tick, setTick] = useState(0);
  const [mapChoice, setMapChoice] = useState(preferredMap);
  const [config, setConfig] = useState({
      provider: "amap" as "amap" | "tianditu",
      jsKey: "",
      mapReady: false,
      searchReady: false,
      placeSearchPaused: false,
      writeReady: true,
      writePausedUntil: null as string | null,
    }),
    [candidates, setCandidates] = useState<Store[]>([]),
    [candidateNote, setCandidateNote] = useState("正在检查周边门店服务…");
  const [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState<
      "edit" | "feedback" | "history" | "city" | null
    >(null),
    [editing, setEditing] = useState<WaterOffer | WaterInput | null>(null),
    [feedbackOffer, setFeedbackOffer] = useState<WaterOffer | null>(null),
    [notice, setNotice] = useState(""),
    [draftCenter, setDraftCenter] = useState<[number, number] | null>(null),
    [locating, setLocating] = useState(false);
  const [storeType, setStoreType] = useState("all"),
    [brand, setBrand] = useState("all"),
    [locationHelp, setLocationHelp] = useState("");
  useWriteResume(config.writePausedUntil, mapChoice, setConfig);
  const { mapOnly, setMapOnly, closeList, toggleList, toggleRef, closeRef } =
    useMapList();
  const chosen = useRef(false);
  const centerRevision = useRef(0);
  function offerCategory(o: WaterOffer) {
    return (
      candidates.find((s) => s.id === o.storeId)?.category ||
      seedStores.find((s) => s.id === o.storeId)?.category ||
      brandCategory(o.storeName) ||
      "market"
    );
  }
  const brandNames = [
    ...candidates
      .filter(
        (s) =>
          (storeType === "all" || s.category === storeType) &&
          distance(center, s.location) <= filters.radius,
      )
      .map((s) => s.name),
    ...offers
      .filter(
        (o) =>
          o.location &&
          distance(center, o.location) <= filters.radius &&
          (storeType === "all" || offerCategory(o) === storeType),
      )
      .map((o) => o.storeName),
  ];
  const visibleCandidates = candidates.filter(
    (s) =>
      (storeType === "all" || s.category === storeType) &&
      distance(center, s.location) <= filters.radius &&
      matchesStoreBrand(s.name, brand),
  );
  const visible = useMemo(
    () =>
      waterResults(offers, center, filters).filter(
        (o) =>
          (storeType === "all" || offerCategory(o) === storeType) &&
          matchesStoreBrand(o.storeName, brand),
      ),
    [offers, center, filters, tick, storeType, brand, candidates],
  );
  const known = visible.filter((o) => usableOffer(o) && perLiter(o) !== null);
  const lowest = known.length ? perLiterHigh(known[0]) : null;
  const selectedOffer = offers.find((o) => o.id === selected);
  const mapStores = useMemo(() => {
    const entries = new Map<string, Store>();
    for (const o of visible)
      if (o.location && !entries.has(o.storeId))
        entries.set(o.storeId, {
          id: o.storeId,
          name: o.storeName,
          address: o.address,
          location: o.location,
          category: offerCategory(o),
          tags: ["社区水价"],
          source: "community",
          amapId: seedStores.find((s) => s.id === o.storeId)?.amapId,
        });
    for (const s of visibleCandidates)
      if (
        distance(center, s.location) <= filters.radius &&
        !entries.has(s.id) &&
        ![...entries.values()].some((x) => x.amapId === s.id)
      )
        entries.set(s.id, s);
    return [...entries.values()];
  }, [visible, candidates, center, filters.radius, storeType, brand]);
  const markerLabels = useMemo(
    () => Object.fromEntries(mapStores.map((s) => [s.id, s.name])),
    [mapStores],
  );
  useEffect(() => {
    document.title = "大水地图 · 穷鬼地图";
    return () => {
      document.title = "穷鬼地图 · 把钱花在刀刃上";
    };
  }, []);
  useEffect(() => {
    let active = true;
    currentLocation()
      .then((point) => {
        if (active && !chosen.current) {
          setCenter(point);
          setPosition("当前位置 · 已获得设备定位");
        }
      })
      .catch((e) => {
        if (active && !chosen.current) {
          setPosition(`${e.message} · 以宁波为中心`);
          setLocationHelp("定位未成功，当前查看宁波。");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api("", { signal: controller.signal })
      .then((data) => {
        setOffers(data.offers);
        setReady(true);
        setLoadError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setLoadError(e.message);
          setReady(false);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    api(`/config?map=${mapChoice}`, { signal: controller.signal })
      .then((data) => {
        setConfig(data);
      })
      .catch(() =>
        setCandidateNote("门店检索暂时无法连接，已收录水价仍可查看。"),
      );
    return () => controller.abort();
  }, [refresh, mapChoice]);
  const candidateRequest = useRef<AbortController | null>(null);
  async function loadSavedCandidates(manual = false) {
    candidateRequest.current?.abort();
    const c = new AbortController();
    candidateRequest.current = c;
    setCandidateNote(
      manual ? "正在手动刷新附近门店…" : "正在读取保存的候选店…",
    );
    try {
      const data = await discoverAmap(
        center,
        filters.radius,
        true,
        c.signal,
        manual,
      );
      if (c.signal.aborted) return;
      setCandidates(data.stores);
      setCandidateNote(cacheDescription(data));
    } catch (e) {
      if (!c.signal.aborted)
        setCandidateNote((e as Error).message + " 仍保留已读候选。");
    }
  }
  useEffect(() => {
    void loadSavedCandidates();
    return () => candidateRequest.current?.abort();
  }, [center, filters.radius, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  function pickCenter(point: [number, number], label: string) {
    chosen.current = true;
    centerRevision.current++;
    setLocating(false);
    setCenter(point);
    setPosition(label);
    setSelected(null);
    setDraftCenter(null);
    setLocationHelp("");
  }
  async function locate() {
    track("location_request");
    chosen.current = true;
    const revision = ++centerRevision.current;
    setLocating(true);
    try {
      const point = await currentLocation(true);
      if (revision !== centerRevision.current) return;
      pickCenter(point, "当前位置 · 已获得设备定位");
      track("location_success");
    } catch (e) {
      if (revision !== centerRevision.current) return;
      track("location_failure");
      setPosition(`${(e as Error).message} · 保留当前中心`);
      setLocationHelp("定位未成功，保留当前地图位置。");
      if (window.innerWidth < 800) setMapOnly(true);
    } finally {
      if (revision === centerRevision.current) setLocating(false);
    }
  }
  function edit(offer?: WaterOffer | WaterInput) {
    track("water_submit", { action: "open" });
    setEditing(offer || null);
    setModal("edit");
  }
  function chooseStore(id: string) {
    setLocationHelp("");
    const offer = linkedOffer(id);
    if (offer) {
      if (visible.some((o) => o.id === offer.id)) {
        setSelected(offer.id);
        setMapOnly(true);
      } else edit(offer);
    } else {
      const s = candidates.find((s) => s.id === id);
      if (s)
        edit({
          storeId: s.id,
          storeName: s.name,
          address: s.address,
          location: s.location,
          locationPrecision: "poi",
          product: "饮用水",
          waterType: "unknown",
          volumeMl: null,
          bottles: null,
          price: 0,
          priceHigh: null,
          channel: "offline",
          sourceUrl: "",
          requirements: "",
          observedOn: "",
          validUntil: "",
          status: "unknown",
        });
    }
  }
  function linkedOffer(id: string) {
    return offers.find(
      (o) =>
        o.storeId === id ||
        seedStores.find((s) => s.id === o.storeId)?.amapId === id,
    );
  }
  const update = (patch: Partial<WaterFilters>) => {
    track("water_filter", {
      field: Object.keys(patch)[0],
      radius: patch.radius,
      sort: patch.sort,
      spec: patch.pack,
      includeInactive: patch.includeInactive,
    });
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(null);
  };
  return (
    <div className="water-app">
      <header className="water-header">
        <h1 className="sr-only">大水地图</h1>
        <a className="water-brand" href={import.meta.env.BASE_URL}>
          <span className="brand-icon">
            <Wallet size={21} />
          </span>
          穷鬼地图
        </a>
        <nav>
          <a href="#/" className="water-back">
            <ArrowLeft size={15} />
            附近地图
          </a>
          <span className="water-nav active">
            <Droplets size={16} />
            大水地图
          </span>
        </nav>
        <button
          className="water-primary"
          disabled={!ready || config.writeReady === false}
          onClick={() => edit()}
        >
          <Plus size={16} />
          补充水价
        </button>
      </header>
      <main className="water-main" data-list-open={!mapOnly}>
        {!!locationHelp && (
          <LocationHelp
            message={locationHelp}
            busy={locating}
            onChoose={() => setModal("city")}
            onRetry={() => void locate()}
            onDismiss={() => setLocationHelp("")}
          />
        )}
        <aside
          id="water-list"
          className={`water-sidebar ${mapOnly ? "water-sidebar-closed" : ""}`}
          aria-label="大水地图筛选与结果"
        >
          <div className="map-list-heading">
            <span>水价与附近超市</span>
            <button
              className="map-list-close"
              ref={closeRef}
              aria-label="关闭水价列表"
              title="收起列表，查看地图"
              onClick={closeList}
            >
              <X size={20} />
            </button>
          </div>
          <div className="map-list-scroll">
            <div className="water-location">
              <MapPin size={17} />
              <div>
                <strong>{position}</strong>
              </div>
              <select
                aria-label="底图来源"
                value={mapChoice}
                onChange={(e) => {
                  setMapChoice(e.target.value as "amap" | "tianditu");
                  rememberMap(e.target.value);
                  track("map_provider_change", { source: e.target.value });
                }}
              >
                <option value="amap">高德</option>
                <option value="tianditu">天地图</option>
              </select>
              <button onClick={locate} disabled={locating}>
                <LocateFixed size={15} />
                {locating ? "定位中…" : "重新定位"}
              </button>
              <button
                onClick={() => pickCenter(ningboCenter, "宁波 · 手动参考中心")}
              >
                看宁波线索
              </button>
            </div>
            {config.writeReady === false && (
              <p className="discovery-note" role="status">
                共享提交暂限额 · 北京时间08:00恢复
              </p>
            )}
            <section className="water-toolbox">
              <div className="water-store-filters">
                <label className="brand-filter">
                  <span>类型</span>
                  <select
                    aria-label="水价门店类型"
                    value={storeType}
                    onChange={(e) => {
                      setStoreType(e.target.value);
                      setBrand("all");
                      setSelected(null);
                    }}
                  >
                    <option value="all">全部门店</option>
                    <option value="discount">硬折扣店</option>
                    <option value="supermarket">大型商超</option>
                    <option value="market">其他门店</option>
                  </select>
                </label>
                <BrandFilter
                  names={brandNames}
                  value={brand}
                  label="水价门店品牌"
                  onChange={(value) => {
                    setBrand(value);
                    setSelected(null);
                  }}
                />
              </div>
              <label className="water-search">
                <Search size={17} />
                <input
                  aria-label="搜索水价线索"
                  value={filters.query}
                  onChange={(e) => update({ query: e.target.value })}
                  placeholder="搜门店、水品牌、地址"
                />
              </label>
              <div className="water-pack-tabs" aria-label="水规格">
                {[
                  ["all", "全部规格"],
                  ["large", "大瓶 1.2–2.5L"],
                  ["small", "小瓶水"],
                  ["case", "整箱装"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={filters.pack === id}
                    className={filters.pack === id ? "active" : ""}
                    onClick={() => update({ pack: id as WaterFilters["pack"] })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="water-select">
                范围
                <select
                  aria-label="大水地图搜索半径"
                  value={filters.radius}
                  onChange={(e) => update({ radius: Number(e.target.value) })}
                >
                  <option value={1000}>1 km</option>
                  <option value={3000}>3 km</option>
                  <option value={5000}>5 km</option>
                  <option value={10000}>10 km</option>
                </select>
              </label>
              <label className="water-select">
                排序
                <select
                  aria-label="水价排序"
                  value={filters.sort}
                  onChange={(e) =>
                    update({ sort: e.target.value as WaterFilters["sort"] })
                  }
                >
                  <option value="liter">每升价格</option>
                  <option value="spend">整份标价</option>
                  <option value="distance">距离最近</option>
                </select>
              </label>
            </section>
            <div className="water-result-meta">
              <div>
                <strong>{visible.length}</strong> 条范围内水价
                {lowest !== null && (
                  <span>
                    已收录最低参考{" "}
                    <b>
                      ¥{fmt(Math.min(...known.map((o) => perLiterHigh(o)!)))}/升
                    </b>
                  </span>
                )}
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={!!filters.includeInactive}
                  onChange={(e) =>
                    update({
                      includeInactive: e.target.checked,
                      onlyAvailable: false,
                    })
                  }
                />
                含卖完 / 过期线索
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.onlyAvailable}
                  onChange={(e) => update({ onlyAvailable: e.target.checked })}
                />
                只看用户反馈有货
              </label>
              <button
                title="刷新共享水价"
                aria-label="刷新共享水价"
                onClick={() => {
                  track("water_refresh");
                  setRefresh((r) => r + 1);
                }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {!!loadError && (
              <div className="water-error" role="alert">
                {loadError}{" "}
                {offers.length > 0
                  ? "当前显示上次读取的线索，暂不能提交。"
                  : ""}
                <button
                  onClick={() => {
                    track("water_refresh");
                    setRefresh((r) => r + 1);
                  }}
                >
                  重试
                </button>
              </div>
            )}
            <div className="water-content">
              <section
                className={`water-results ${mapOnly ? "water-mobile-hide" : ""}`}
                aria-label="水价结果"
              >
                {loading && !offers.length && (
                  <div className="water-empty">正在读取共享水价…</div>
                )}
                {!loading && !visible.length && (
                  <div className="water-empty">
                    <Droplets size={32} />
                    <h2>这个范围还没有匹配的水价</h2>
                    <p>
                      只展示真实收录的线索，不把附近超市当作已知低价。可以扩大范围、查看宁波基准线索，或补充你看到的价格。
                    </p>
                    <button
                      className="water-primary"
                      onClick={() => {
                        pickCenter(ningboCenter, "宁波 · 手动参考中心");
                        setFilters(initialFilters);
                      }}
                    >
                      查看宁波已有线索
                    </button>
                  </div>
                )}
                {visible.map((o) => {
                  const unit = perLiter(o),
                    upper = perLiterHigh(o),
                    metric = unit !== null;
                  return (
                    <article
                      className={`water-offer ${selected === o.id ? "selected" : ""}`}
                      key={o.id}
                    >
                      <div className="water-offer-top">
                        <span className="water-product-icon">
                          <Droplets size={24} />
                        </span>
                        <div>
                          <button
                            className="water-store-name"
                            onClick={() => {
                              setSelected(o.id);
                              setMapOnly(true);
                            }}
                          >
                            {o.storeName}
                          </button>
                          <span>
                            {o.location &&
                              `约 ${distanceText(distance(center, o.location))} · 直线`}{" "}
                            {o.locationPrecision === "area" && "· 商圈位置"}
                          </span>
                        </div>
                        <span className="water-origin">
                          {o.origin === "user-tip" ? "用户提供" : "社区补充"}
                        </span>
                      </div>
                      <h3>{o.product}</h3>
                      <div className="water-price-row">
                        <div className="water-unit-price">
                          {metric ? (
                            <>
                              <small>¥</small>
                              {fmt(unit!)}
                              {upper !== unit && <em>–{fmt(upper!)}</em>}
                              <span>/ 升</span>
                            </>
                          ) : (
                            <strong>容量待补充</strong>
                          )}
                          <small>
                            {metric
                              ? "按水价折算，未含交通或额外门槛"
                              : "无法计算每升单价，暂不参与单价排名"}
                          </small>
                        </div>
                        <div className="water-purchase">
                          <b>
                            ¥{fmt(o.price)}
                            {o.priceHigh !== null && `–${fmt(o.priceHigh)}`}
                          </b>
                          <span>
                            {(o.bottles ?? 0) > 1
                              ? `整箱 ${o.bottles} 瓶`
                              : "单份参考价"}
                          </span>
                        </div>
                      </div>
                      <div className="water-tags">
                        <span>
                          {o.volumeMl && o.bottles
                            ? `${fmt(o.volumeMl / 1000)}L × ${o.bottles}瓶`
                            : "规格未知"}
                        </span>
                        <span>{channelText[o.channel]}</span>
                        {liters(o) && (o.bottles ?? 0) > 1 && (
                          <span>一次购买 {fmt(liters(o)!)}L</span>
                        )}
                        <span className="water-status">
                          {o.validUntil &&
                          Date.parse(o.validUntil) <= Date.now()
                            ? "优惠已过期 · 可编辑更新"
                            : statusLabels[waterStatus(o)]}
                        </span>
                      </div>
                      <p className="water-conditions">{o.requirements}</p>
                      <div className="water-evidence">
                        <Clock3 size={12} />
                        见价日期：{o.observedOn || "未提供"}
                        <span>· 更新 {date(o.updatedAt)}</span>
                        {o.validUntil && (
                          <span>· 截止 {date(o.validUntil)}</span>
                        )}
                      </div>
                      {o.feedback && (
                        <div className="water-feedback-counts">
                          有货 {o.feedback.available} · 变价{" "}
                          {o.feedback.changed} · 卖完 {o.feedback.soldOut}
                        </div>
                      )}
                      <div className="water-offer-actions">
                        <button
                          onClick={() => edit(o)}
                          disabled={!ready || config.writeReady === false}
                        >
                          <Pencil size={14} />
                          编辑 / 补信息
                        </button>
                        <button
                          onClick={() => {
                            setFeedbackOffer(o);
                            setModal("feedback");
                            track("water_feedback", { action: "open" });
                          }}
                          disabled={!ready || config.writeReady === false}
                        >
                          <MessageSquare size={14} />
                          反馈
                        </button>
                        <button
                          aria-label={`查看 ${o.storeName} 的历史`}
                          title="修改与反馈记录"
                          onClick={() => {
                            setFeedbackOffer(o);
                            setModal("history");
                            track("water_history");
                          }}
                        >
                          <History size={14} />
                        </button>
                        {o.sourceUrl ? (
                          <a
                            href={o.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            原始链接
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="water-no-link">原始链接待补充</span>
                        )}
                      </div>
                    </article>
                  );
                })}
                {offers.some(
                  (o) =>
                    !o.location &&
                    (storeType === "all" || offerCategory(o) === storeType) &&
                    matchesStoreBrand(o.storeName, brand) &&
                    (filters.includeInactive || usableOffer(o)),
                ) && (
                  <div className="water-unlocated">
                    <h3>尚未定位的社区线索</h3>
                    <p>这些门店尚未确认位置，不计入附近和距离排名。</p>
                    {offers
                      .filter(
                        (o) =>
                          !o.location &&
                          (storeType === "all" ||
                            offerCategory(o) === storeType) &&
                          matchesStoreBrand(o.storeName, brand) &&
                          (filters.includeInactive || usableOffer(o)),
                      )
                      .map((o) => (
                        <button key={o.id} onClick={() => edit(o)}>
                          {o.storeName} · ¥{fmt(o.price)}
                          <Pencil size={13} />
                        </button>
                      ))}
                  </div>
                )}
              </section>
              <details className="water-candidates">
                <summary>
                  <ShoppingBag size={16} />
                  附近超市 <b>{visibleCandidates.length}</b>
                </summary>
                <p>
                  {candidateNote}{" "}
                  <button
                    disabled={
                      config.writeReady === false || config.placeSearchPaused
                    }
                    onClick={() => void loadSavedCandidates(true)}
                  >
                    {config.placeSearchPaused ? "搜店已暂停" : "刷新门店"}
                  </button>
                </p>
                {!visibleCandidates.length && (
                  <p>当前筛选下没有已载门店，可选择全部品牌或扩大范围。</p>
                )}
                {visibleCandidates.map((s) => (
                  <div key={s.id}>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {distanceText(distance(center, s.location))} ·
                        {storeSourceName(s.source)
                          ? " " + storeSourceName(s.source) + " ·"
                          : ""}{" "}
                        {linkedOffer(s.id) ? "已有社区水价" : "价格尚未收录"}
                      </small>
                    </span>
                    <button
                      disabled={!ready || config.writeReady === false}
                      onClick={() => chooseStore(s.id)}
                    >
                      {linkedOffer(s.id) ? "查看水价" : "补水价"}{" "}
                      <Plus size={12} />
                    </button>
                  </div>
                ))}
              </details>
            </div>
          </div>
          <footer className="water-footer">
            <span className={`status-dot ${ready ? "live" : ""}`} />
            {ready ? "共享线索 · 未核验" : "连接中"}
            <a
              href="https://github.com/gongfpp/poor-map"
              target="_blank"
              rel="noreferrer"
            >
              数据说明 <ExternalLink size={11} />
            </a>
          </footer>
        </aside>
        <aside
          className={`water-map-side ${mapOnly ? "water-mobile-show" : ""}`}
        >
          <div className="water-map-heading">
            <div>
              <MapPin size={17} />
              <strong>附近买水地图</strong>
            </div>
            <span>{mapStores.length} 个地点</span>
          </div>
          <div className="water-map-wrap">
            <MapView
              stores={mapStores}
              center={center}
              selected={selectedOffer?.storeId || null}
              onSelect={chooseStore}
              demo={false}
              provider={config.provider}
              jsKey={config.jsKey}
              mapReady={config.mapReady}
              onLocate={locate}
              onMove={setDraftCenter}
              eventIds={emptyEvents}
              radiusMeters={filters.radius}
              waterMode
              markerLabels={markerLabels}
              serviceHost={`${WATER_API || location.origin}/_AMapService`}
            />
            {draftCenter && (
              <button
                className="water-search-area water-primary"
                onClick={() => pickCenter(draftCenter, "地图选点 · 搜索中心")}
              >
                搜索这里的水价
              </button>
            )}
          </div>
          <div className="water-map-caption">
            {config.mapReady
              ? "社区线索 · 未核验"
              : "底图暂不可用 · 保留价格线索"}
          </div>
          {selectedOffer && (
            <div className="water-map-selected">
              <button
                className="water-pin-close icon-button"
                aria-label="关闭水价详情"
                onClick={() => setSelected(null)}
              >
                <X size={17} />
              </button>
              <strong>{selectedOffer.storeName}</strong>
              <p>{selectedOffer.product}</p>
              <div className="water-pin-price">
                {perLiter(selectedOffer) !== null
                  ? `¥${fmt(perLiterHigh(selectedOffer)!)}/升`
                  : "容量待补充"}
                <span>
                  整份 ¥{fmt(selectedOffer.price)}
                  {selectedOffer.priceHigh !== null &&
                    `–${fmt(selectedOffer.priceHigh)}`}
                </span>
              </div>
              <p>{selectedOffer.requirements}</p>
              <div className="water-pin-actions">
                <button onClick={() => edit(selectedOffer)}>
                  <Pencil size={13} />
                  编辑
                </button>
                <button
                  onClick={() => {
                    setFeedbackOffer(selectedOffer);
                    setModal("feedback");
                    track("water_feedback", { action: "open" });
                  }}
                >
                  <MessageSquare size={13} />
                  反馈
                </button>
              </div>
              <p>{selectedOffer.address}</p>
              <a
                href={`https://uri.amap.com/marker?position=${selectedOffer.location?.join(",")}&name=${encodeURIComponent(selectedOffer.storeName + (selectedOffer.locationPrecision === "area" ? "（商圈参考位置）" : ""))}&coordinate=gaode&callnative=1`}
                target="_blank"
                rel="noreferrer"
              >
                打开高德位置{" "}
                {selectedOffer.locationPrecision === "area" ? "（商圈）" : ""}
                <ArrowRight size={14} />
              </a>
            </div>
          )}
        </aside>

        <div className={`water-mobile-toggle ${mapOnly ? "is-map-only" : ""}`}>
          <button
            ref={toggleRef}
            aria-controls="water-list"
            aria-expanded={!mapOnly}
            aria-label={mapOnly ? "列表" : "地图"}
            onClick={toggleList}
          >
            {mapOnly ? "列表" : "地图"} · {visible.length}
          </button>
        </div>
      </main>
      {modal === "city" && (
        <Modal title="选择参考城市" onClose={() => setModal(null)}>
          <p className="modal-copy">
            选择城市中心后，可拖动地图并点击“搜索这里的水价”。
          </p>
          <div className="city-grid">
            {cities.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  pickCenter(c.center, `${c.name} · 手动参考中心`);
                  setModal(null);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "edit" && (
        <Modal
          title={editing && "id" in editing ? "编辑水价线索" : "补充一条水价"}
          onClose={() => setModal(null)}
        >
          <WaterEditor
            initial={editing}
            stores={mapStores}
            onSave={async (input) => {
              track("water_submit", { action: "submit" });
              const existing = editing && "id" in editing ? editing : null;
              await api(existing ? `/${existing.id}` : "", {
                method: existing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...input,
                  ...(existing ? { version: existing.version } : {}),
                }),
              });
              setModal(null);
              setRefresh((r) => r + 1);
              track("water_save", { status: "success" });
              setNotice(
                "已保存到共享线索库，其他浏览器可以看到。内容仍是用户提供、未核验的线索。",
              );
            }}
          />
        </Modal>
      )}
      {modal === "feedback" && feedbackOffer && (
        <Modal
          title={`反馈 · ${feedbackOffer.storeName}`}
          onClose={() => setModal(null)}
        >
          <Feedback
            onSave={async (type, note) => {
              track("water_feedback", { action: "submit", status: type });
              await api(`/${feedbackOffer.id}/feedback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type, note }),
              });
              setModal(null);
              setRefresh((r) => r + 1);
              setNotice(
                "反馈已公开保存。价格变动请用“编辑 / 补信息”更新实际水价。",
              );
            }}
          />
        </Modal>
      )}
      {modal === "history" && feedbackOffer && (
        <Modal title="修改与反馈记录" onClose={() => setModal(null)}>
          <WaterHistory id={feedbackOffer.id} />
        </Modal>
      )}
    </div>
  );
}
function WaterEditor({
  initial,
  stores,
  onSave,
}: {
  initial: WaterOffer | WaterInput | null;
  stores: Store[];
  onSave: (input: WaterInput) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input = simpleWaterInput(
      String(f.get("storeName") || ""),
      Number(f.get("price")),
      String(f.get("notes") || ""),
      initial,
      stores,
    );
    const issue = validateWater(input);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(input);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="report-form water-editor" onSubmit={submit}>
      <p className="modal-copy">
        写下门店和看到的价格即可。容量、瓶数、购买条件都可以写在备注里，线索会公开分享。
      </p>
      <label>
        门店名称
        <input
          name="storeName"
          required
          maxLength={100}
          defaultValue={initial?.storeName || ""}
          list="water-store-names"
          placeholder="例如：好特卖东鼓道店"
        />
      </label>
      <datalist id="water-store-names">
        {[...new Set(stores.map((s) => s.name))].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <label>
        价格（元）
        <input
          name="price"
          type="number"
          required
          min="0"
          max="10000"
          step="0.01"
          defaultValue={initial && "id" in initial ? initial.price : ""}
          placeholder="你看到的单瓶或整份标价"
        />
      </label>
      <label>
        备注
        <textarea
          name="notes"
          maxLength={1500}
          rows={3}
          defaultValue={initial?.requirements || ""}
          placeholder="例如：1.5L 单瓶 1.2 元；美团 8.9 元 24 瓶，需自提"
        />
      </label>
      <p className="water-form-position">
        选择已收录的门店名称可关联地图位置；未匹配的门店先保存为待定位线索。规格未知的价格不参与每升排名。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="water-primary full-width" disabled={busy}>
        {busy ? (
          "保存中…"
        ) : (
          <>
            <Check size={16} />
            保存共享线索
          </>
        )}
      </button>
    </form>
  );
}
function Feedback({
  onSave,
}: {
  onSave: (type: string, note: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [type, setType] = useState("available");
  return (
    <form
      className="report-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await onSave(type, String(f.get("note") || ""));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="modal-copy">
        反馈会公开展示，供其他人判断是否值得去。发现新价格或容量，可直接编辑线索；反馈不会自动把水价变成已核验。
      </p>
      <div className="water-pack-tabs" role="group" aria-label="反馈情况">
        {[
          ["available", "看到有货"],
          ["changed", "价格 / 条件变了"],
          ["sold-out", "已卖完 / 找不到"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={type === id ? "active" : ""}
            aria-pressed={type === id}
            onClick={() => setType(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        备注
        <textarea
          name="note"
          maxLength={500}
          rows={3}
          placeholder="看到的日期、货架位置、团购限制等"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="water-primary full-width" disabled={busy}>
        {busy ? "发送中…" : "公开保存反馈"}
      </button>
    </form>
  );
}
function WaterHistory({ id }: { id: string }) {
  const [data, setData] = useState<{
      revisions: any[];
      feedback: any[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api(`/${id}/history`, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  return (
    <div className="water-history">
      {error && <p className="form-error">{error}</p>}
      {!data && !error && <p>正在读取共享记录…</p>}
      {data && (
        <>
          <h3>最近反馈</h3>
          {!data.feedback.length && <p>暂无反馈。</p>}
          {data.feedback.map((f, i) => (
            <article key={i}>
              <strong>
                {
                  {
                    available: "看到有货",
                    changed: "价格 / 条件变化",
                    "sold-out": "已卖完 / 找不到",
                  }[f.type as string]
                }
              </strong>
              <span>{date(f.created_at)}</span>
              <p>{f.note || "没有补充说明"}</p>
            </article>
          ))}
          <h3>修改记录</h3>
          {!data.revisions.length && (
            <p>尚无修改。原始价格由发起者提供，当前状态未核验。</p>
          )}
          {data.revisions.map((r, i) => (
            <article key={i}>
              <strong>
                版本 {r.after.version} · {r.before ? "社区编辑" : "新增线索"}
              </strong>
              <span>{date(r.at)}</span>
              <p>
                ¥{fmt(r.after.price)} / {r.after.bottles ?? "瓶数待确认"}
                {r.after.bottles ? "瓶" : ""} ·{" "}
                {r.after.volumeMl ? `${r.after.volumeMl}ml` : "容量未知"}
              </p>
              {r.before && (
                <small>
                  修改前：¥{fmt(r.before.price)} /{" "}
                  {r.before.bottles ?? "瓶数待确认"}
                  {r.before.bottles ? "瓶" : ""} ·{" "}
                  {r.before.volumeMl ? `${r.before.volumeMl}ml` : "容量未知"}
                </small>
              )}
            </article>
          ))}
        </>
      )}
    </div>
  );
}
