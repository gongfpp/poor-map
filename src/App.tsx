import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Plus,
  Search,
  ShoppingBag,
  Store as StoreIcon,
  Wallet,
  X,
  MessageCircle,
  IceCreamBowl,
} from "lucide-react";
import {
  activeCategories,
  cities,
  distance,
  distanceText,
  type Store,
} from "./domain";
import MapView from "./MapView";
import { STATIC_DEMO, WATER_API } from "./config";
import Modal from "./Modal";
import { currentLocation } from "./location";
import Comments from "./Comments";
import { analyticsEnabled, setAnalyticsEnabled, track } from "./telemetry";
import "./community.css";
function readSaved(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("poor-map:saved:v1") || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export default function App() {
  const [config, setConfig] = useState({
      provider: "amap" as "amap" | "tianditu",
      jsKey: "",
      mapReady: false,
      searchReady: false,
    }),
    [tileReady, setTileReady] = useState(false),
    [demo] = useState(false),
    [city, setCity] = useState("宁波"),
    [center, setCenter] = useState<[number, number]>(cities[0].center),
    [draftCenter, setDraftCenter] = useState<[number, number] | null>(null),
    [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [radius, setRadius] = useState(3000),
    [feed, setFeed] = useState("nearby"),
    [saved, setSaved] = useState(readSaved),
    [live, setLive] = useState<Store[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState<"city" | "config" | "report" | "store" | null>(
      null,
    ),
    [mobileMap, setMobileMap] = useState(() => innerWidth < 800),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [locating, setLocating] = useState(false),
    [picking, setPicking] = useState(false),
    [storePoint, setStorePoint] = useState<[number, number] | null>(null),
    [place, setPlace] = useState(""),
    [placeBusy, setPlaceBusy] = useState(false),
    [sharingStore, setSharingStore] = useState(""),
    [analytics, setAnalytics] = useState(analyticsEnabled);
  const chosen = useRef(false);
  useEffect(() => {
    let active = true;
    track("location_request");
    currentLocation()
      .then((p) => {
        track("location_success");
        if (active && !chosen.current) {
          setCenter(p);
          setCity("当前位置");
        }
      })
      .catch(() => track("location_failure"));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    fetch(`${WATER_API}/api/water/config?map=tianditu`, { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setConfig)
      .catch((e) => {
        if (e.name !== "AbortError")
          setNotice("底图配置暂时无法连接，稍后刷新重试。");
      });
    return () => c.abort();
  }, [refresh]);
  const stores = live;
  const visible = useMemo(
    () =>
      stores
        .filter(
          (s) =>
            (category === "all" || s.category === category) &&
            (!query ||
              `${s.name} ${s.address}`
                .toLowerCase()
                .includes(query.trim().toLowerCase())) &&
            distance(center, s.location) <= radius &&
            (feed !== "saved" || saved.includes(s.id)),
        )
        .sort(
          (a, b) => distance(center, a.location) - distance(center, b.location),
        ),
    [stores, category, query, radius, center, feed, saved],
  );
  const current = stores.find((s) => s.id === selected);
  useEffect(() => {
    if (modal === "report" && !sharingStore && stores.length)
      setSharingStore(selected || visible[0]?.id || stores[0].id);
  }, [modal, sharingStore, stores, selected, visible]);
  useEffect(() => {
    if (demo) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    setLive([]);
    track("query_start", { category, radius });
    fetch(`${WATER_API}/api/community/stores`, { signal: c.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setLive(d.stores);
        track("query_success", { count: d.stores.length });
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          track("query_error");
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [demo, refresh]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        track("search", {
          length: query.trim().length,
          empty: !visible.length,
        }),
      700,
    );
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    track("results_view", {
      count: visible.length,
      category,
      feed,
      empty: !visible.length,
    });
  }, [visible.length, category, feed]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === "poor-map:saved:v1") setSaved(readSaved());
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (selected && !visible.some((s) => s.id === selected)) setSelected(null);
  }, [visible, selected]);
  const open = (m: typeof modal) => {
    setModal(m);
    track(m ? "modal_open" : "modal_close", {
      action: m === "report" ? "share" : m === "config" ? "help" : "city",
    });
  };
  function pick(p: [number, number], label: string) {
    chosen.current = true;
    setCenter(p);
    setCity(label);
    setSelected(null);
    setDraftCenter(null);
    track("city_change");
  }
  async function locate() {
    setLocating(true);
    track("location_request");
    try {
      pick(await currentLocation(true), "当前位置");
      track("location_success");
    } catch (e) {
      setNotice((e as Error).message);
      track("location_failure");
    } finally {
      setLocating(false);
    }
  }
  function select(id: string) {
    setSelected(id);
    track("store_open", {
      source: stores.find((s) => s.id === id)?.source || "demo",
    });
    if (innerWidth < 800) setMobileMap(true);
  }
  function save(id: string) {
    const enabled = !saved.includes(id),
      next = enabled ? [...saved, id] : saved.filter((s) => s !== id);
    try {
      localStorage.setItem("poor-map:saved:v1", JSON.stringify(next));
      setSaved(next);
      track("favorite_change", { enabled });
    } catch {
      setNotice("收藏未保存，浏览器存储不可用。");
    }
  }
  function navigate(s: Store) {
    if (s.source === "demo") {
      setNotice("这是演示门店，地址和坐标为示例，不能用于导航。");
      track("navigation_blocked");
      return;
    }
    track("navigation_open");
    window.open(
      `https://uri.amap.com/marker?position=${s.location.join(",")}&name=${encodeURIComponent(s.name + (s.locationPrecision === "area" ? "（商圈参考位置）" : ""))}&coordinate=gaode&callnative=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  function share() {
    setSharingStore(selected || visible[0]?.id || stores[0]?.id || "");
    open("report");
  }
  async function searchPlace(e: React.FormEvent) {
    e.preventDefault();
    if (!place.trim()) return;
    setPlaceBusy(true);
    try {
      const r = await fetch(
          `/api/center?query=${encodeURIComponent(place.trim())}`,
        ),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      pick(d.center, d.label);
      open(null);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setPlaceBusy(false);
    }
  }
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
          <span>穷鬼地图</span>
        </a>
        <div className="header-actions">
          <button
            className="header-link"
            aria-label="标记门店"
            disabled={!tileReady}
            onClick={() => {
              track("store_create_start");
              setPicking(true);
              setMobileMap(true);
              setSelected(null);
              setNotice("请点击地图上的门店位置。");
            }}
          >
            <MapPin size={18} />
            <span>标记门店</span>
          </button>
          <a className="water-nav" href="#/water" data-track="water">
            便宜水
          </a>
          <button
            className="header-link"
            onClick={() => open("config")}
            aria-label="数据来源与配置"
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="contribute"
            aria-label="分享省钱线索"
            disabled={loading || !stores.length}
            onClick={share}
          >
            <Plus size={17} />
            <span>分享线索</span>
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className={`sidebar ${mobileMap ? "mobile-hidden" : ""}`}>
          <h1 className="sr-only">穷鬼地图</h1>
          <div className="search-area">
            <button className="location-button" onClick={() => open("city")}>
              <MapPin size={16} />
              <span>{city}</span>
              <ChevronDown size={14} />
            </button>
            <label className="search-box">
              <Search size={18} />
              <input
                aria-label="搜索门店"
                placeholder="搜门店或品牌"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="清空搜索" onClick={() => setQuery("")}>
                  <X size={15} />
                </button>
              )}
            </label>
          </div>
          <nav className="feed-tabs" aria-label="浏览内容">
            {[
              ["nearby", "附近门店", Compass],
              ["saved", "我的收藏", Bookmark],
            ].map(([id, label, Icon]) => (
              <button
                key={id as string}
                aria-pressed={feed === id}
                className={feed === id ? "active" : ""}
                onClick={() => {
                  setFeed(id as string);
                  setSelected(null);
                  track("filter_change", { field: "feed", feed: id });
                }}
              >
                {typeof Icon !== "string" && <Icon size={16} />}
                {label as string}
              </button>
            ))}
          </nav>
          <div className="category-grid">
            <button
              className={category === "all" ? "active" : ""}
              aria-pressed={category === "all"}
              onClick={() => {
                setCategory("all");
                track("filter_change", { field: "category", category: "all" });
              }}
            >
              <Compass size={18} />
              <span>全部</span>
            </button>
            {activeCategories.map((c) => (
              <button
                key={c.id}
                className={category === c.id ? "active" : ""}
                aria-pressed={category === c.id}
                onClick={() => {
                  setCategory(c.id);
                  setSelected(null);
                  track("filter_change", { field: "category", category: c.id });
                }}
              >
                {c.id === "mixue" ? (
                  <IceCreamBowl size={18} />
                ) : (
                  <ShoppingBag size={18} />
                )}
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <div className="filter-row">
            <label>
              <MapPin size={13} />
              <select
                aria-label="搜索半径"
                value={radius}
                onChange={(e) => {
                  setRadius(Number(e.target.value));
                  track("filter_change", {
                    field: "radius",
                    radius: Number(e.target.value),
                  });
                }}
              >
                {[1000, 3000, 5000, 10000].map((n) => (
                  <option key={n} value={n}>
                    {n / 1000} km 内
                  </option>
                ))}
              </select>
            </label>
            <span className="distance-note">按直线距离排序</span>
          </div>
          <div className="result-heading">
            <span>
              {loading ? (
                "正在寻找附近门店…"
              ) : (
                <>
                  附近 <strong>{visible.length}</strong> 家门店
                </>
              )}
            </span>
          </div>
          <div className="results" aria-busy={loading}>
            {error && (
              <div className="empty-state">
                <CircleHelp />
                <h3>暂时没能找到门店</h3>
                <p>{error}</p>
                <button
                  className="primary-button"
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  重新查询
                </button>
              </div>
            )}
            {loading &&
              [0, 1, 2].map((i) => <div className="skeleton" key={i} />)}
            {!loading && !error && !visible.length && (
              <div className="empty-state">
                <Search />
                <h3>
                  {feed === "saved" ? "当前范围暂无收藏" : "没有匹配的门店"}
                </h3>
                <p>
                  这一带还没有匹配的门店标记。可以扩大范围、先看宁波，或标记你知道的店。
                </p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setRadius(3000);
                    setFeed("nearby");
                  }}
                >
                  重置筛选
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    pick(cities[0].center, "宁波");
                    setCategory("all");
                    setQuery("");
                    setRadius(3000);
                    setFeed("nearby");
                  }}
                >
                  看宁波已有门店
                </button>
              </div>
            )}
            {!loading &&
              !error &&
              visible.map((s) => {
                const cat =
                  activeCategories.find((c) => c.id === s.category) ||
                  activeCategories[0];
                return (
                  <article
                    className={`store-card ${selected === s.id ? "selected" : ""}`}
                    key={s.id}
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
                          {s.category === "mixue" ? (
                            <IceCreamBowl size={25} />
                          ) : (
                            <ShoppingBag size={25} />
                          )}
                        </span>
                        <span className="store-title">
                          <strong>{s.name}</strong>
                          <span>
                            {cat.label} ·{" "}
                            {s.locationPrecision === "area" ? "约 " : ""}
                            {distanceText(distance(center, s.location))} · 直线
                            {s.source === "demo" ? " · 演示" : ""}
                          </span>
                        </span>
                      </button>
                      <button
                        className={`save-button ${saved.includes(s.id) ? "saved" : ""}`}
                        aria-label={`${saved.includes(s.id) ? "取消收藏" : "收藏"} ${s.name}`}
                        aria-pressed={saved.includes(s.id)}
                        onClick={() => save(s.id)}
                      >
                        <Bookmark
                          size={18}
                          fill={saved.includes(s.id) ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
          <div className="sidebar-footer">
            <span className={`status-dot ${demo ? "" : "live"}`} />
            {demo ? "演示门店 · 不能用于出行" : "共享门店 · 用户标记"}
            <button onClick={() => open("config")}>
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
              <h2>
                附近门店 <span>{visible.length}</span>
              </h2>
            </div>
            <span className="map-filter-badge">{radius / 1000} km 内</span>
          </div>
          <MapView
            stores={visible}
            center={center}
            selected={selected}
            onSelect={select}
            demo={demo}
            provider={config.provider}
            jsKey={config.jsKey}
            mapReady={config.mapReady}
            onReadyChange={setTileReady}
            onPickLocation={
              picking
                ? (point) => {
                    track("map_pick");
                    setStorePoint(point);
                    setPicking(false);
                    open("store");
                  }
                : undefined
            }
            onLocate={locate}
            onMove={(p) => {
              setDraftCenter(p);
              track("map_drag");
            }}
            eventIds={new Set()}
            radiusMeters={radius}
            canLocate={true}
          />
          <div className="compact-map-status">
            <span>{picking ? "点地图标记门店" : "共享门店"}</span>
            <button
              onClick={() => (picking ? setPicking(false) : open("config"))}
            >
              {picking ? "取消" : "数据说明"}
            </button>
          </div>
          {draftCenter && (
            <button
              className="search-here primary-button"
              onClick={() => pick(draftCenter, "地图选点")}
            >
              搜索这个区域
              <Search size={15} />
            </button>
          )}
          {locating && <div className="search-here">正在定位…</div>}
          {current && (
            <div className="detail-card">
              <div className="detail-header">
                <span className="detail-category">
                  {
                    activeCategories.find((c) => c.id === current.category)
                      ?.label
                  }{" "}
                  ·{" "}
                  {current.source === "demo" ? "演示门店" : "用户标记 · 未核验"}
                </span>
                <button
                  className="icon-button"
                  aria-label="关闭门店详情"
                  onClick={() => {
                    setSelected(null);
                    track("store_close");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <h3>{current.name}</h3>
              <p className="detail-address">
                <MapPin size={14} />
                {current.address || "地址待补充"}
                {current.locationPrecision === "area" && " · 商圈参考位置"}
              </p>
              <div className="detail-actions">
                <button
                  className="secondary-button"
                  onClick={() => save(current.id)}
                >
                  <Bookmark size={16} />
                  {saved.includes(current.id) ? "已收藏" : "收藏"}
                </button>
                <button
                  className="primary-button"
                  onClick={() => navigate(current)}
                >
                  <Navigation size={16} />
                  {current.locationPrecision === "area"
                    ? "查看参考位置"
                    : "到这里去"}
                </button>
                <button
                  className="icon-button"
                  title="分享线索"
                  aria-label="为这家店分享线索"
                  onClick={share}
                >
                  <MessageCircle size={20} />
                </button>
              </div>
              <Comments
                key={current.id}
                storeId={current.id}
                storeName={current.name}
              />
            </div>
          )}
        </section>
      </main>
      <button
        className="mobile-toggle"
        onClick={() => {
          setMobileMap((v) => !v);
          track("list_toggle", { action: mobileMap ? "list" : "map" });
        }}
      >
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
        <Modal title="从哪里开始逛？" onClose={() => open(null)}>
          <p className="modal-copy">
            当前位置仅用于本次筛选；示例门店不能作为出行依据。
          </p>
          <div className="city-grid">
            {cities.map((c) => (
              <button
                className={city === c.name ? "active" : ""}
                key={c.name}
                onClick={() => {
                  pick(c.center, c.name);
                  open(null);
                }}
              >
                {c.name}
                {city === c.name && <Check size={14} />}
              </button>
            ))}
          </div>
          {!STATIC_DEMO && config.searchReady && (
            <form onSubmit={searchPlace} className="place-search">
              <label htmlFor="place">自定义城市 / 街道 / 地址</label>
              <div className="input-action">
                <input
                  id="place"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  maxLength={80}
                />
                <button className="primary-button" disabled={placeBusy}>
                  {placeBusy ? "搜索中" : "搜索"}
                </button>
              </div>
            </form>
          )}
          <button
            className="locate-modal"
            onClick={() => {
              open(null);
              void locate();
            }}
          >
            <LocateFixed size={17} />
            使用我的当前位置
          </button>
        </Modal>
      )}
      {modal === "report" && (
        <Modal title="分享一条省钱线索" onClose={() => open(null)}>
          <label className="sharing-store">
            门店
            <select
              aria-label="门店"
              value={sharingStore}
              onChange={(e) => setSharingStore(e.target.value)}
            >
              {!stores.length && <option value="">暂无门店</option>}
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.source === "demo" ? "（演示）" : ""}
                </option>
              ))}
            </select>
          </label>
          {sharingStore && (
            <Comments
              key={sharingStore}
              storeId={sharingStore}
              storeName={
                stores.find((s) => s.id === sharingStore)?.name || "门店"
              }
              onDone={() => setNotice("已公开分享，其他人可回复纠错。")}
            />
          )}
        </Modal>
      )}
      {modal === "store" && storePoint && (
        <Modal title="标记一家门店" onClose={() => open(null)}>
          <StoreForm
            point={storePoint}
            onRepick={() => {
              open(null);
              setPicking(true);
              setMobileMap(true);
            }}
            onSave={(store) => {
              setLive((v) => [store, ...v]);
              pick(store.location, "新门店附近");
              setSelected(store.id);
              setFeed("nearby");
              setCategory("all");
              setQuery("");
              open(null);
              setMobileMap(true);
              setNotice("已保存共享门店，点击详情可分享一句话线索。");
            }}
          />
        </Modal>
      )}
      {modal === "config" && (
        <Modal title="数据从哪里来？" onClose={() => open(null)}>
          <p className="modal-copy">
            底图来自天地图；门店、评论和水价来自共享线索库。当前收录仍少，分类不能证明当前商品价格或库存。
            收藏保存在当前浏览器；评论公开保存并允许回复纠错，均为未核验线索。
          </p>
          <div className="provider-row">
            <span>天地图道路底图</span>
            <b>{config.mapReady ? "已配置" : "暂不可用"}</b>
          </div>
          {!config.mapReady && (
            <button
              className="secondary-button"
              onClick={() => setRefresh((n) => n + 1)}
            >
              重新加载底图配置
            </button>
          )}
          <div className="provider-row">
            <span>自动门店检索</span>
            <b>{config.searchReady ? "已配置 · 本地测试" : "未接入"}</b>
          </div>
          <div className="provider-row">
            <span>美团 / 大众点评 / 抖音</span>
            <b>未接入</b>
          </div>
          <p className="form-hint">
            门店位置与线索由用户提供，欢迎回复补充和纠错。商圈参考位置不能等同于准确铺位。
          </p>
          <div className="privacy-control">
            <h3>使用统计</h3>
            <p>
              统计访问、筛选、地图操作、收藏、分享、回复和加载表现；不保存精确位置、搜索词、评论正文、完整网址或设备指纹。会话标识仅用于本次会话，统计事件保留30天。浏览器的“请勿跟踪”设置同样生效。
            </p>
            <label>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => {
                  setAnalytics(e.target.checked);
                  setAnalyticsEnabled(e.target.checked);
                  track("privacy_change", { enabled: e.target.checked });
                }}
              />
              允许匿名使用统计
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StoreForm({
  point,
  onRepick,
  onSave,
}: {
  point: [number, number];
  onRepick: () => void;
  onSave: (s: Store) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${WATER_API}/api/community/stores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            name: form.get("name"),
            category: form.get("category"),
            address: form.get("address"),
            location: point,
          }),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存失败，请重试。");
      onSave(d.store);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="store-form" onSubmit={submit}>
      <label>
        门店名称
        <input
          name="name"
          required
          minLength={2}
          maxLength={80}
          placeholder="例如：赵一鸣零食·鼓楼店"
        />
      </label>
      <label>
        分类
        <select name="category" aria-label="分类">
          <option value="discount">硬折扣店（含量贩零食）</option>
          <option value="mixue">蜜雪冰城</option>
        </select>
      </label>
      <label>
        地址补充（可选）
        <input
          name="address"
          maxLength={200}
          placeholder="楼层、入口或附近标志物"
        />
      </label>
      <p className="form-hint">位置已在地图上选择，提交后公开显示。</p>
      <button type="button" className="secondary-button" onClick={onRepick}>
        重新选点
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "保存中…" : "保存门店"}
      </button>
    </form>
  );
}
