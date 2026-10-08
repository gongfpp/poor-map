import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { WATER_API } from "./config";
import { track } from "./telemetry";
export type Comment = {
  id: string;
  storeId: string;
  parentId: string | null;
  rootId: string;
  content: string;
  createdAt: string;
};
export default function Comments({
  storeId,
  storeName,
  onDone,
  writable = true,
}: {
  storeId: string;
  storeName: string;
  onDone?: () => void;
  writable?: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]),
    [text, setText] = useState(""),
    [reply, setReply] = useState<Comment | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      `${WATER_API}/api/community/comments?store=${encodeURIComponent(storeId)}`,
      { signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)]) },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setComments(d.comments);
        track("comment_view", { count: d.comments.length });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("评论暂时无法连接，请重试。");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [storeId, refresh]);
  useEffect(() => {
    setText("");
    setReply(null);
    setComments([]);
  }, [storeId]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    track("comment_submit", { length: text.trim().length, hasReply: !!reply });
    try {
      const r = await fetch(`${WATER_API}/api/community/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          storeId,
          content: text.trim(),
          parentId: reply?.id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "分享失败，请重试。");
      setComments((v) => [d.comment, ...v]);
      setText("");
      setReply(null);
      track("comment_success", { hasReply: !!reply });
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
      track("comment_error");
    } finally {
      setBusy(false);
    }
  }
  function item(c: Comment, isReply = false) {
    return (
      <article
        className={`community-comment ${isReply ? "reply" : ""}`}
        key={c.id}
      >
        <p>{c.content}</p>
        <div>
          <small>
            {new Date(c.createdAt).toLocaleString("zh-CN", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · 未核验{isReply ? " · 回复" : ""}
          </small>
          <button
            onClick={() => {
              setReply(c);
              track("reply_start");
            }}
          >
            回复 / 纠错
          </button>
        </div>
      </article>
    );
  }
  const roots = comments.filter(
    (c) => !c.parentId || !comments.some((x) => x.id === c.rootId),
  );
  return (
    <section className="community">
      <h4>
        <MessageCircle size={16} /> {storeName}的线索{" "}
        <span>{comments.length}</span>
      </h4>
      <form onSubmit={submit}>
        {reply && (
          <div className="reply-target">
            回复：{reply.content.slice(0, 45)}
            <button type="button" onClick={() => setReply(null)}>
              取消
            </button>
          </div>
        )}
        <label className="sr-only" htmlFor={`comment-${storeId}`}>
          一句话线索
        </label>
        <textarea
          id={`comment-${storeId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={
            reply ? "补充或纠正这条线索…" : "一句话分享价格、活动或到店体验…"
          }
          required
          rows={2}
        />
        <div className="comment-submit">
          <small>公开分享 · 未核验 · 请勿填写个人信息</small>
          <button
            className="primary-button"
            disabled={!writable || busy || loading || !text.trim()}
          >
            {busy ? "发送中…" : reply ? "发送回复" : "分享"}
          </button>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button onClick={() => setRefresh((n) => n + 1)}>重试</button>
        </p>
      )}
      {loading && <p>正在加载评论…</p>}
      {!loading && !error && !comments.length && (
        <p className="no-deals">还没有线索，来分享第一条。</p>
      )}
      <div className="comment-list">
        {roots.map((c) => (
          <div key={c.id}>
            {item(c)}
            {comments
              .filter((r) => r.parentId && r.rootId === c.id)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((r) => item(r, true))}
          </div>
        ))}
      </div>
    </section>
  );
}
