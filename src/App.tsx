import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  ExternalLink,
  Gift,
  LocateFixed,
  MapPin,
  Navigation,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Store as StoreIcon,
  Utensils,
  Wallet,
  X,
  BarChart3,
  LoaderCircle,
} from "lucide-react";
import {
  activeDeals,
  categories,
  cities,
  distance,
  distanceText,
  filterStores,
  matchingDeals,
  validateDeal,
  wgs84ToGcj02,
  type Category,
  type Deal,
  type Filters,
  type Store,
} from "./domain";
import { demoData } from "./data";
import MapView from "./MapView";
import { STATIC_DEMO } from "./config";
const icons = {
  snack: Package,
  discount: ShoppingBag,
  daily: StoreIcon,
  market: Sprout,
  meal: Utensils,
};
const defaults: Filters = {
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
type Config = { jsKey: string; mapReady: boolean; searchReady: boolean };
function readSaved(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("poor-map:saved:v1") || "[]");
    return Array.isArray(value)
      ? value.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
function readDeals(): Deal[] {
  try {
    const value = JSON.parse(localStorage.getItem("poor-map:deals:v1") || "[]");
    return Array.isArray(value)
      ? value.filter((d) => {
          try {
            return (
              d?.source === "local" &&
              typeof d.id === "string" &&
              typeof d.createdAt === "string" &&
              validateDeal(d) === null
            );
          } catch {
            return false;
          }
        })
      : [];
  } catch {
    return [];
  }
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const els = box.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === box.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === box.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={box}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const money = (n: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(n);
export default function App() {
  const [nowTick, setNowTick] = useState(0);
  const [config, setConfig] = useState<Config>({
    jsKey: "",
    mapReady: false,
    searchReady: false,
  });
  const [configError, setConfigError] = useState("");
  const [demo, setDemo] = useState(true),
    [city, setCity] = useState("宁波"),
    [center, setCenter] = useState<[number, number]>(cities[0].center),
    [draftCenter, setDraftCenter] = useState<[number, number] | null>(null);
  const [filters, setFilters] = useState<Filters>(defaults),
    [liveStores, setLiveStores] = useState<Store[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [lastQuery, setLastQuery] = useState("");
  const [saved, setSaved] = useState(readSaved),
    [localDeals, setLocalDeals] = useState(readDeals),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState<
      "city" | "config" | "report" | "insights" | null
    >(null),
    [notice, setNotice] = useState(""),
    [mobileMap, setMobileMap] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [placeQuery, setPlaceQuery] = useState(""),
    [placeBusy, setPlaceBusy] = useState(false),
    [locating, setLocating] = useState(false);
  const sample = useMemo(() => demoData(center), [center]);
  const stores = demo ? sample.stores : liveStores;
  const deals = useMemo(
    () =>
      demo
        ? [
            ...sample.deals,
            ...localDeals.filter((d) => d.storeId.startsWith("demo-")),
          ]
        : localDeals.filter((d) => !d.storeId.startsWith("demo-")),
    [demo, sample.deals, localDeals],
  );
  const visible = useMemo(
    () => filterStores(stores, deals, filters, center, saved),
    [stores, deals, filters, center, saved, nowTick],
  );
  const filteredDeals = useMemo(
    () => matchingDeals(deals, filters),
    [deals, filters, nowTick],
  );
  const current = stores.find((s) => s.id === selected);
  const storeDeals = current
    ? activeDeals(deals).filter((d) => d.storeId === current.id)
    : [];
  const eventIds = useMemo(
    () =>
      new Set(
        activeDeals(deals)
          .filter((d) => d.price === 0 && d.minSpend === 0)
          .map((d) => d.storeId),
      ),
    [deals, nowTick],
  );
  const validCount = activeDeals(deals).filter((d) =>
    stores.some((s) => s.id === d.storeId),
  ).length;
  const change = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(null);
  };
  const toast = (text: string) => setNotice(text);
  useEffect(() => {
    if (STATIC_DEMO) return;
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setConfig)
      .catch((e) => {
        if (e.name !== "AbortError")
          setConfigError("无法连接本地 API，请确认 npm run dev 已启动。");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setWarnings([]);
    setLiveStores([]);
    setSelected(null);
    setLastQuery("");
    fetch(
      `/api/nearby?center=${center.join(",")}&radius=${filters.radius}&category=${filters.category}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "门店查询失败");
        return data;
      })
      .then((data) => {
        setLiveStores(data.stores);
        setWarnings(data.warnings || []);
        setLastQuery(data.queriedAt);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, center, filters.radius, filters.category, refresh]);
  useEffect(() => {
    if (selected && !visible.some((s) => s.id === selected)) setSelected(null);
  }, [visible, selected]);
  useEffect(() => {
    const timer = setInterval(() => setNowTick((n) => n + 1), 30000);
    const sync = (e: StorageEvent) => {
      if (e.key === "poor-map:saved:v1") setSaved(readSaved());
      if (e.key === "poor-map:deals:v1") setLocalDeals(readDeals());
    };
    window.addEventListener("storage", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", sync);
    };
  }, []);
  function toggleSaved(id: string) {
    const next = saved.includes(id)
      ? saved.filter((s) => s !== id)
      : [...saved, id];
    try {
      localStorage.setItem("poor-map:saved:v1", JSON.stringify(next));
      setSaved(next);
    } catch {
      toast("浏览器存储不可用，收藏未保存。");
    }
  }
  function switchMode() {
    if (demo && !config.searchReady) {
      setModal("config");
      return;
    }
    setDemo((v) => !v);
    setSelected(null);
    setError("");
    setDraftCenter(null);
    setFilters(defaults);
  }
  function locate() {
    if (demo) {
      toast(
        "演示模式使用示例位置。配置高德后切换真实数据，即可查询你附近的门店。",
      );
      return;
    }
    if (!navigator.geolocation) {
      toast("当前浏览器不支持定位，请搜索地址。");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter(wgs84ToGcj02([p.coords.longitude, p.coords.latitude]));
        setCity("当前位置");
        setDraftCenter(null);
        setLocating(false);
      },
      (e) => {
        toast(
          e.code === 1
            ? "未获得定位权限，可以用城市或地址搜索。"
            : "定位失败，请用地址搜索定位中心。",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }
  async function searchPlace(e: React.FormEvent) {
    e.preventDefault();
    if (!placeQuery.trim()) return;
    if (!config.searchReady) {
      toast("自定义地点搜索需要配置高德 Web 服务 Key。");
      return;
    }
    setPlaceBusy(true);
    try {
      const r = await fetch(
          `/api/center?query=${encodeURIComponent(placeQuery.trim())}`,
        ),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCenter(data.center);
      setCity(data.label);
      setDraftCenter(null);
      setSelected(null);
      setModal(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPlaceBusy(false);
    }
  }
  const select = (id: string) => {
    setSelected(id);
    if (window.innerWidth < 800) setMobileMap(true);
  };
  function navigate(s: Store) {
    if (s.source === "demo") {
      toast("这是演示门店，地址和坐标为示例，不能用于导航。");
      return;
    }
    window.open(
      `https://uri.amap.com/marker?position=${s.location.join(",")}&name=${encodeURIComponent(s.name)}&coordinate=gaode&callnative=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  const priceOf = (s: Store) => {
    const ds = filteredDeals.filter((d) => d.storeId === s.id);
    return ds.length &&
      (filters.feed === "events" ||
        s.price === undefined ||
        s.price > filters.budget)
      ? Math.min(...ds.map((d) => d.price + d.minSpend))
      : s.price;
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="穷鬼地图首页"
        >
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          <span>
            穷鬼地图<small>LESS MONEY, MORE LIFE</small>
          </span>
        </a>
        <div className="topbar-center">
          <span className="tiny-pill">省一点，开心多一点</span>
        </div>
        <div className="header-actions">
          <button className="header-link" onClick={() => setModal("insights")}>
            <BarChart3 size={18} />
            <span>附近分析</span>
          </button>
          <button
            className="header-link"
            onClick={() => setModal("config")}
            aria-label="数据来源与配置"
          >
            <CircleHelp size={19} />
          </button>
          <button className="contribute" onClick={() => setModal("report")}>
            <Plus size={17} />
            <span>分享省钱线索</span>
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className={`sidebar ${mobileMap ? "mobile-hidden" : ""}`}>
          <div className="sidebar-intro">
            <div className="intro-eyebrow">
              <span className="live-bubble" />
              你的城市，藏着不少好价
            </div>
            <h1>
              花小钱，
              <br />
              发现附近的<span>好生活。</span>
              <Sparkles className="intro-star" size={30} />
            </h1>
            <p>从一袋零食，到今天的免费午餐。</p>
          </div>
          <div className="search-area">
            <button
              className="location-button"
              onClick={() => setModal("city")}
            >
              <MapPin size={16} />
              <span>{city}</span>
              <ChevronDown size={14} />
            </button>
            <label className="search-box">
              <Search size={18} />
              <input
                aria-label="搜索门店或优惠"
                placeholder="搜门店、品牌或优惠关键词"
                value={filters.query}
                onChange={(e) => change({ query: e.target.value })}
              />
              {filters.query && (
                <button
                  aria-label="清空搜索"
                  onClick={() => change({ query: "" })}
                >
                  <X size={15} />
                </button>
              )}
            </label>
          </div>
          <nav className="feed-tabs" aria-label="浏览内容">
            {[
              ["nearby", "附近好价", Compass],
              ["events", "优惠活动", Gift],
              ["saved", "我的收藏", Bookmark],
            ].map(([id, label, Icon]) => (
              <button
                key={id as string}
                aria-pressed={filters.feed === id}
                className={filters.feed === id ? "active" : ""}
                onClick={() => change({ feed: id as string })}
              >
                {typeof Icon !== "string" && <Icon size={16} />}{" "}
                {label as string}
                {id === "events" && <span>{validCount}</span>}
              </button>
            ))}
          </nav>
          <div className="category-grid">
            <button
              className={filters.category === "all" ? "active" : ""}
              onClick={() => change({ category: "all" })}
            >
              <Compass size={18} />
              <span>全部发现</span>
            </button>
            {categories.map((c) => {
              const Icon = icons[c.id];
              return (
                <button
                  key={c.id}
                  className={filters.category === c.id ? "active" : ""}
                  aria-pressed={filters.category === c.id}
                  onClick={() => change({ category: c.id })}
                >
                  <Icon size={18} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
          <div className="filter-row">
            <label>
              <MapPin size={13} />
              <select
                aria-label="搜索半径"
                value={filters.radius}
                onChange={(e) => change({ radius: Number(e.target.value) })}
              >
                <option value={1000}>1 km 内</option>
                <option value={3000}>3 km 内</option>
                <option value={5000}>5 km 内</option>
                <option value={10000}>10 km 内</option>
              </select>
            </label>
            <label>
              <Wallet size={13} />
              <select
                aria-label="价格上限"
                value={String(filters.budget)}
                onChange={(e) => change({ budget: Number(e.target.value) })}
              >
                <option value="Infinity">不限价格</option>
                <option value="0">仅 0 元</option>
                <option value="10">10 元以内</option>
                <option value="20">20 元以内</option>
                <option value="50">50 元以内</option>
              </select>
            </label>
            <button
              className={advanced ? "active" : ""}
              aria-expanded={advanced}
              onClick={() => setAdvanced((v) => !v)}
            >
              <SlidersHorizontal size={14} />
              筛选
              {(filters.noSpend ||
                filters.noLottery ||
                filters.hasSource ||
                filters.dealKind !== "all") && <i />}
            </button>
          </div>
          {(advanced || filters.feed === "events") && (
            <div className="advanced-filters">
              {filters.feed === "events" ? (
                <>
                  <div className="deal-types">
                    {[
                      ["all", "全部活动"],
                      ["free", "霸王餐"],
                      ["checkin", "打卡福利"],
                      ["discount", "限时特价"],
                    ].map(([id, label]) => (
                      <button
                        className={filters.dealKind === id ? "active" : ""}
                        onClick={() => change({ dealKind: id })}
                        key={id}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="check-filters">
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.noSpend}
                        onChange={(e) => change({ noSpend: e.target.checked })}
                      />
                      免额外消费
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.noLottery}
                        onChange={(e) =>
                          change({ noLottery: e.target.checked })
                        }
                      />
                      无需抽签
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.hasSource}
                        onChange={(e) =>
                          change({ hasSource: e.target.checked })
                        }
                      />
                      有原始链接
                    </label>
                  </div>
                </>
              ) : (
                <p>
                  活动条件筛选在「优惠活动」中使用。门店价格仅在有价格线索时参与预算筛选。
                </p>
              )}
            </div>
          )}
          <div className="result-heading">
            <span>
              {loading ? (
                "正在寻找附近门店…"
              ) : (
                <>
                  发现 <strong>{visible.length}</strong> 个
                  {filters.feed === "events" ? "活动地点" : "好价线索"}
                </>
              )}
            </span>
            <label>
              <ArrowDownUp size={13} />
              <select
                aria-label="结果排序"
                value={filters.sort}
                onChange={(e) => change({ sort: e.target.value })}
              >
                <option value="distance">距离最近</option>
                <option value="price">价格优先</option>
              </select>
            </label>
          </div>
          <div className="results" aria-busy={loading}>
            {error && (
              <div className="empty-state">
                <CircleHelp />
                <h3>暂时没能找到门店</h3>
                <p>{error}</p>
                <button
                  className="primary-button"
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  重新查询
                </button>
              </div>
            )}
            {loading &&
              [0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
            {!loading && !error && !visible.length && (
              <div className="empty-state">
                <Search />
                <h3>
                  {filters.feed === "saved"
                    ? "当前范围暂无收藏"
                    : filters.feed === "events"
                      ? "暂无匹配的活动"
                      : "没有匹配的门店"}
                </h3>
                <p>
                  {filters.feed === "events"
                    ? "活动尚未接入平台实时数据。你可以分享带原始链接的本地线索，或放宽筛选条件。"
                    : filters.feed === "saved"
                      ? "收藏按当前城市、范围与分类筛选。点门店卡片上的书签即可收藏，记录保存在当前浏览器。"
                      : "试试扩大范围或取消价格筛选；未知价格的门店不会参与预算筛选。"}
                </p>
                <button
                  onClick={() => setFilters(defaults)}
                  className="secondary-button"
                >
                  重置筛选
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              visible.map((s) => {
                const Icon = icons[s.category],
                  cat = categories.find((c) => c.id === s.category)!;
                const ds = filteredDeals.filter((d) => d.storeId === s.id);
                const price = priceOf(s);
                const offerPrice =
                  ds.length > 0 &&
                  (filters.feed === "events" ||
                    s.price === undefined ||
                    s.price > filters.budget);
                return (
                  <article
                    key={s.id}
                    className={`store-card ${selected === s.id ? "selected" : ""}`}
                  >
                    <div className="store-top">
                      <button
                        className="store-open"
                        onClick={() => select(s.id)}
                      >
                        <span
                          className="store-avatar"
                          style={{
                            background: `${cat.color}20`,
                            color: cat.color,
                          }}
                        >
                          <Icon size={25} />
                        </span>
                        <span className="store-title">
                          <strong>{s.name}</strong>
                          <span>
                            {cat.label} <i />{" "}
                            {distanceText(distance(center, s.location))} · 直线
                          </span>
                        </span>
                      </button>
                      <button
                        className={`save-button ${saved.includes(s.id) ? "saved" : ""}`}
                        aria-label={`${saved.includes(s.id) ? "取消收藏" : "收藏"} ${s.name}`}
                        aria-pressed={saved.includes(s.id)}
                        onClick={() => toggleSaved(s.id)}
                      >
                        <Bookmark
                          size={18}
                          fill={saved.includes(s.id) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <button className="store-body" onClick={() => select(s.id)}>
                      <div className="store-tags">
                        {s.tags.slice(0, 2).map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                        {s.source === "demo" && (
                          <span className="demo-label">演示</span>
                        )}
                      </div>
                      {(filters.feed === "events" || offerPrice) && ds[0] && (
                        <div className="activity-teaser">
                          <Gift size={14} />
                          {ds[0].title}
                          <span>
                            {ds[0].lottery
                              ? "需抽签"
                              : ds[0].minSpend > 0
                                ? "需消费"
                                : "直接参与"}
                          </span>
                        </div>
                      )}
                      <div className="store-bottom">
                        <span className="price">
                          {price === undefined ? (
                            <span className="unknown-price">价格待确认</span>
                          ) : (
                            <>
                              <small>¥</small>
                              {money(price)}
                              <em>{offerPrice ? "活动最低成本" : "起"}</em>
                            </>
                          )}
                        </span>
                        <span className="store-bottom-note">
                          {filters.feed === "events"
                            ? "查看活动条件"
                            : s.source === "demo"
                              ? "单品示例价"
                              : "查看门店"}
                          <ChevronRight size={14} />
                        </span>
                      </div>
                    </button>
                  </article>
                );
              })}
            {!!warnings.length && (
              <details className="query-warnings">
                <summary>查询范围说明（{warnings.length}）</summary>
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            {visible.length > 0 && (
              <p className="list-footnote">
                便宜是线索，适合才是好价。
                <br />
                价格、库存与活动资格请以商家原始页面为准。
              </p>
            )}
          </div>
          <div className="sidebar-footer">
            <span className={`status-dot ${demo ? "" : "live"}`} />
            {demo
              ? "演示数据 · 门店与活动均为示例"
              : lastQuery
                ? `高德门店 · ${new Date(lastQuery).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 查询`
                : "真实查询模式"}
            <button onClick={() => setModal("config")}>
              数据说明
              <ExternalLink size={11} />
            </button>
          </div>
        </aside>
        <section
          className={`map-panel ${mobileMap ? "mobile-visible" : ""}`}
          aria-label="附近线索地图"
        >
          <div className="map-topbar">
            <div>
              <span className="map-eyebrow">THE GOOD DEALS AROUND YOU</span>
              <h2>
                附近值得逛的地方 <span>{visible.length}</span>
              </h2>
            </div>
            <button
              className="map-filter-badge"
              onClick={() => {
                setAdvanced(true);
                setMobileMap(false);
              }}
            >
              <span className="status-dot" />
              {filters.radius / 1000} km 生活圈
            </button>
          </div>
          <MapView
            stores={visible}
            center={center}
            selected={selected}
            onSelect={select}
            demo={demo}
            jsKey={config.jsKey}
            mapReady={config.mapReady}
            onLocate={locate}
            onMove={setDraftCenter}
            eventIds={eventIds}
            canLocate={!STATIC_DEMO}
          />
          <div className="mode-banner">
            <span className="mode-banner-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>
                {demo ? "先逛逛，这是一张演示地图" : "正在寻找真实门店"}
              </strong>
              <span>
                {demo
                  ? "展示筛选与活动玩法，所有地点和价格均为示例。"
                  : "门店来自高德；优惠由本地线索提供，尚未接入平台。"}
              </span>
            </div>
            <button onClick={switchMode}>
              {STATIC_DEMO
                ? "数据接入说明"
                : demo
                  ? "切换真实数据"
                  : "返回演示"}
              <ArrowRight size={14} />
            </button>
          </div>
          {draftCenter && (
            <button
              className="search-here primary-button"
              onClick={() => {
                setCenter(draftCenter);
                setDraftCenter(null);
                setCity("地图选点");
              }}
            >
              搜索这个区域
              <Search size={15} />
            </button>
          )}
          {locating && (
            <div className="search-here">
              <LoaderCircle className="spin" size={16} />
              正在定位…
            </div>
          )}
          {!current && (
            <div className="map-tip">
              <span className="tip-icon">
                <Wallet size={20} />
              </span>
              <div>
                <strong>少花一点，也可以过得很好。</strong>
                <span>点一个地图标记，发现你的下一站。</span>
              </div>
            </div>
          )}
          {current && (
            <div className="detail-card">
              <div className="detail-header">
                <span className="detail-category">
                  {categories.find((c) => c.id === current.category)?.label} ·{" "}
                  {current.source === "demo" ? "演示门店" : "高德 POI"}
                </span>
                <button
                  className="icon-button"
                  aria-label="关闭门店详情"
                  onClick={() => setSelected(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <h3>{current.name}</h3>
              <p className="detail-address">
                <MapPin size={14} />
                {current.address}
              </p>
              <div className="detail-stats">
                <span>
                  {distanceText(distance(center, current.location))}
                  <small>距搜索中心 · 直线距离</small>
                </span>
                <span>
                  {current.price !== undefined
                    ? `¥${money(current.price)} 起`
                    : "价格待确认"}
                  <small>{current.priceNote || "品牌与分类不能证明低价"}</small>
                </span>
              </div>
              <div className="detail-deals">
                <h4>
                  <Gift size={15} />
                  优惠与活动 <span>{storeDeals.length}</span>
                </h4>
                {!storeDeals.length && (
                  <p className="no-deals">
                    暂无优惠线索。发现好价？添加带来源的活动。
                  </p>
                )}
                {storeDeals.map((d) => (
                  <div key={d.id} className="deal-detail">
                    <div>
                      <strong>{d.title}</strong>
                      <span className="deal-status">
                        {d.source === "demo" ? "演示活动" : "本地线索 · 未核验"}
                      </span>
                    </div>
                    <div className="deal-cost">
                      <b>¥{money(d.price + d.minSpend)}</b> 最低参与成本{" "}
                      <span>
                        {d.lottery ? "需抽签，中签不保证" : "无需抽签"}
                      </span>
                    </div>
                    <p>{d.requirements}</p>
                    <small>
                      <Clock3 size={12} />{" "}
                      {new Date(d.expiresAt).toLocaleString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      截止
                      {d.minSpend > 0 && ` · 需额外消费 ¥${money(d.minSpend)}`}
                    </small>
                    {d.sourceUrl && (
                      <a
                        href={d.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看原始活动 <ExternalLink size={12} />
                      </a>
                    )}
                    {d.source === "local" && (
                      <button
                        className="delete-clue"
                        onClick={() => {
                          const next = localDeals.filter(
                            (item) => item.id !== d.id,
                          );
                          try {
                            localStorage.setItem(
                              "poor-map:deals:v1",
                              JSON.stringify(next),
                            );
                            setLocalDeals(next);
                            toast("已删除这条本地线索。");
                          } catch {
                            toast("删除失败，浏览器存储不可用。");
                          }
                        }}
                      >
                        删除本地线索
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="detail-actions">
                <button
                  className="secondary-button"
                  onClick={() => toggleSaved(current.id)}
                >
                  <Bookmark size={16} />
                  {saved.includes(current.id) ? "已收藏" : "收藏"}
                </button>
                <button
                  className="primary-button"
                  onClick={() => navigate(current)}
                >
                  <Navigation size={16} />
                  到这里去
                </button>
                <button
                  className="icon-button"
                  title="为这家店添加优惠"
                  aria-label="为这家店添加优惠"
                  onClick={() => setModal("report")}
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
      <button className="mobile-toggle" onClick={() => setMobileMap((v) => !v)}>
        {mobileMap ? (
          <>
            <StoreIcon size={16} />
            看列表
          </>
        ) : (
          <>
            <MapPin size={16} />
            看地图 · {visible.length}
          </>
        )}
      </button>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "city" && (
        <Modal title="从哪里开始逛？" onClose={() => setModal(null)}>
          <p className="modal-copy">
            {STATIC_DEMO
              ? "选择一个演示城市。当前公开页面使用示例地点，尚未接入真实位置服务。"
              : "选择城市中心，或在真实数据模式下搜索附近的街道。"}
          </p>
          <div className="city-grid">
            {cities.map((c) => (
              <button
                className={city === c.name ? "active" : ""}
                key={c.name}
                onClick={() => {
                  setCity(c.name);
                  setCenter(c.center);
                  setDraftCenter(null);
                  setSelected(null);
                  setModal(null);
                }}
              >
                {c.name}
                {city === c.name && <Check size={14} />}
              </button>
            ))}
          </div>
          {!STATIC_DEMO && (
            <>
              <form onSubmit={searchPlace} className="place-search">
                <label htmlFor="place">自定义城市 / 街道 / 地址</label>
                <div className="input-action">
                  <input
                    id="place"
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    placeholder="例如：宁波市鄞州区天童北路"
                    maxLength={80}
                  />
                  <button className="primary-button" disabled={placeBusy}>
                    {placeBusy ? "搜索中" : "搜索"}
                  </button>
                </div>
              </form>
              <button
                className="locate-modal"
                onClick={() => {
                  setModal(null);
                  locate();
                }}
              >
                <LocateFixed size={17} />
                使用我的当前位置
              </button>
              <p className="form-hint">
                当前位置仅用于本次周边查询，不保存定位记录。
              </p>
            </>
          )}
        </Modal>
      )}
      {modal === "config" && (
        <Modal title="数据从哪里来？" onClose={() => setModal(null)}>
          <div className="config-callout">
            <Settings2 size={22} />
            <div>
              <strong>
                {STATIC_DEMO
                  ? "GitHub Pages · 公开演示版"
                  : config.searchReady
                    ? "高德门店查询已配置"
                    : "当前可体验完整演示"}
              </strong>
              <p>
                {STATIC_DEMO
                  ? "本站为静态演示，未部署地图查询服务。收藏与投稿只保存在你的浏览器中；演示门店、价格和活动不能作为出行依据。"
                  : "真实数据需要本地配置高德密钥。演示地址、单品价与活动均为虚构示例，不能作为出行依据。"}
              </p>
            </div>
          </div>
          {configError && <p className="form-error">{configError}</p>}
          <div className="provider-row">
            <span>高德 JS 地图</span>
            <b className={config.mapReady ? "connected" : ""}>
              {config.mapReady ? "已配置，待实际加载验证" : "未配置"}
            </b>
          </div>
          <div className="provider-row">
            <span>高德周边门店</span>
            <b className={config.searchReady ? "connected" : ""}>
              {config.searchReady ? "已配置，待查询验证" : "未配置"}
            </b>
          </div>
          <div className="provider-row">
            <span>美团 / 大众点评</span>
            <b>未接入 · 需业务授权</b>
          </div>
          <div className="provider-row">
            <span>抖音生活服务</span>
            <b>未接入 · 需平台权限</b>
          </div>
          <div className="config-steps">
            <h3>本地接入方式</h3>
            <ol>
              <li>
                高德开放平台创建「Web 端 JS API」Key 和安全密钥，以及独立的「Web
                服务」Key。
              </li>
              <li>
                复制项目的 <code>.env.example</code> 为 <code>.env</code>
                ，填写三个对应字段。
              </li>
              <li>
                重启 <code>npm run dev</code>，再点击「切换真实数据」。
              </li>
            </ol>
            <p>
              安全密钥与 Web 服务 Key
              留在服务端。地图提供门店线索，价格与活动需单独核验。当前投稿和收藏只保存在这台设备的浏览器中。
            </p>
          </div>
          <div className="source-links">
            <a
              target="_blank"
              rel="noreferrer"
              href="https://developer.amap.com/api/webservice/guide/api/search/"
            >
              高德 POI 文档 <ExternalLink size={12} />
            </a>
            <a
              target="_blank"
              rel="noreferrer"
              href="https://developer.meituan.com/"
            >
              美团合作中心 <ExternalLink size={12} />
            </a>
            <a
              target="_blank"
              rel="noreferrer"
              href="https://partner.open-douyin.com/docs/resource/zh-CN/local-life/develop/capability/basic/goods-introduce"
            >
              抖音生活服务 <ExternalLink size={12} />
            </a>
          </div>
          {config.searchReady && (
            <button
              className="primary-button full-width"
              onClick={() => {
                setDemo(false);
                setFilters(defaults);
                setModal(null);
              }}
            >
              开始查询真实门店 <ArrowRight size={15} />
            </button>
          )}
        </Modal>
      )}
      {modal === "report" && (
        <Modal title="分享一条省钱线索" onClose={() => setModal(null)}>
          <Report
            stores={stores}
            selected={selected}
            onSave={(d) => {
              const next = [d, ...localDeals];
              try {
                localStorage.setItem("poor-map:deals:v1", JSON.stringify(next));
                setLocalDeals(next);
                setModal(null);
                setSelected(d.storeId);
                setFilters({
                  ...defaults,
                  feed: "events",
                  radius: Math.max(filters.radius, 3000),
                });
                toast("已保存到当前浏览器，标记为未核验线索。");
              } catch {
                toast("存储不可用，线索尚未保存。请复制内容后重试。");
              }
            }}
          />
        </Modal>
      )}
      {modal === "insights" && (
        <Modal title="这一带，怎么逛更省？" onClose={() => setModal(null)}>
          <p className="modal-copy">
            基于当前筛选出的 {visible.length} 个地点。
            {demo
              ? "以下是演示分析，不代表真实城市分布。"
              : "首批 POI 查询结果，不代表区域内全部门店。"}
          </p>
          <div className="insight-stats">
            <div>
              <b>{visible.length}</b>
              <span>附近线索</span>
            </div>
            <div>
              <b>{visible.filter((s) => eventIds.has(s.id)).length}</b>
              <span>免消费活动地点</span>
            </div>
            <div>
              <b>
                {visible.length
                  ? distanceText(
                      Math.min(
                        ...visible.map((s) => distance(center, s.location)),
                      ),
                    )
                  : "—"}
              </b>
              <span>最近直线距离</span>
            </div>
          </div>
          <h3 className="section-title">门店分布</h3>
          <div className="chart-bars">
            {categories.map((c) => {
              const count = visible.filter((s) => s.category === c.id).length;
              return (
                <div key={c.id}>
                  <span>{c.label}</span>
                  <i>
                    <b
                      style={{
                        width: `${(count / Math.max(visible.length, 1)) * 100}%`,
                        background: c.color,
                      }}
                    />
                  </i>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
          <div className="saving-note">
            <Sparkles size={19} />
            <div>
              <strong>让“省钱”有个真实的比较基准</strong>
              <p>
                按单价比较同规格商品，临期食品按实际吃完的时间买。活动参与成本包含领取价与最低消费，抽签活动单独标注。
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Report({
  stores,
  selected,
  onSave,
}: {
  stores: Store[];
  selected: string | null;
  onSave: (deal: Deal) => void;
}) {
  const [error, setError] = useState(""),
    [kind, setKind] = useState("discount");
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget),
      rawDate = String(data.get("expires"));
    const candidate = {
      storeId: String(data.get("store")),
      title: String(data.get("title")).trim(),
      kind: kind as Deal["kind"],
      price: Number(data.get("price")),
      minSpend: Number(data.get("spend")),
      lottery: data.get("lottery") === "on",
      requirements: String(data.get("requirements")).trim(),
      expiresAt: rawDate ? new Date(rawDate).toISOString() : "",
      sourceUrl: String(data.get("url")).trim(),
    };
    const issue = validateDeal(candidate);
    if (issue) {
      setError(issue);
      return;
    }
    onSave({
      ...candidate,
      id: crypto.randomUUID(),
      source: "local",
      createdAt: new Date().toISOString(),
    });
  }
  return (
    <form className="report-form" onSubmit={submit}>
      <p className="modal-copy">
        保存为<strong>本地未核验线索</strong>
        ，不会上传，也不会发布到平台。请保留原始活动链接，并写清参与条件。
      </p>
      <label>
        门店
        <select
          name="store"
          required
          defaultValue={selected || stores[0]?.id || ""}
        >
          <option value="" disabled>
            请选择门店
          </option>
          {stores.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
              {s.source === "demo" ? "（演示）" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        活动标题
        <input
          name="title"
          required
          maxLength={80}
          placeholder="例如：到店打卡赠送一杯饮料"
        />
      </label>
      <label>
        活动类型
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="discount">限时特价</option>
          <option value="free">霸王餐</option>
          <option value="checkin">打卡福利</option>
        </select>
      </label>
      <div className="form-columns">
        <label>
          领取价（元）
          <input
            key={kind}
            name="price"
            type="number"
            min="0"
            max="100000"
            step="0.01"
            defaultValue={0}
            readOnly={kind === "free"}
            required
          />
        </label>
        <label>
          另需最低消费（元）
          <input
            name="spend"
            type="number"
            min="0"
            max="100000"
            step="0.01"
            defaultValue={0}
            required
          />
        </label>
      </div>
      <label>
        活动截止时间
        <input name="expires" type="datetime-local" required />
      </label>
      <label className="inline-check">
        <input type="checkbox" name="lottery" />
        需要抽签 / 抢名额，不保证获得
      </label>
      <label>
        参与条件
        <textarea
          name="requirements"
          required
          maxLength={1000}
          rows={3}
          placeholder="新客限制、预约、发帖要求、消费门槛、可用时段……"
        />
      </label>
      <label>
        原始活动链接
        <input
          name="url"
          type="url"
          required
          placeholder="https://…"
          maxLength={2000}
        />
      </label>
      <p className="form-hint">
        有链接不代表已核验。过期活动自动从结果中排除，示例门店上的投稿仅在演示模式中展示。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        disabled={!stores.length}
        className="primary-button full-width"
        type="submit"
      >
        <Plus size={16} />
        保存到本地
      </button>
      {!stores.length && (
        <p className="form-error">请先查询门店，再分享与门店关联的活动。</p>
      )}
    </form>
  );
}
