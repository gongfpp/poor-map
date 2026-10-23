export default function LocationHelp({
  message,
  busy,
  onChoose,
  onRetry,
  onDismiss,
}: {
  message: string;
  busy: boolean;
  onChoose: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="location-help" role="status">
      <span>{message}</span>
      <div>
        <button onClick={onChoose}>选择位置</button>
        <button onClick={onRetry} disabled={busy}>
          {busy ? "定位中…" : "重试定位"}
        </button>
        <button onClick={onDismiss} aria-label="关闭定位提示">
          知道了
        </button>
      </div>
    </div>
  );
}
