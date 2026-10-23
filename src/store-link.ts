export function sharedStoreId(hash: string): string | undefined {
  if (!hash.startsWith("#/store")) return undefined;
  try {
    const id = decodeURIComponent(hash.slice("#/store/".length));
    return hash.startsWith("#/store/") && /^[\w-]{1,160}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

// 分享链接只包含公开门店 ID，不复制查询参数、用户位置或浏览器状态。
export function storeLink(id: string, base: string, origin: string) {
  if (!/^[\w-]{1,160}$/.test(id)) throw new Error("门店链接无效。");
  const url = new URL(base, origin);
  url.search = "";
  url.hash = `/store/${encodeURIComponent(id)}`;
  return url.href;
}
