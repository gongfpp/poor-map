// Baidu's legacy SN protocol uses MD5, not for password storage or encryption.
// Workers supports MD5 in WebCrypto; the local server supplies Node's digest.
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export async function signBaiduUrl(url, env) {
  const sk = env.BAIDU_WEB_SERVICE_SK;
  if (!sk) return url; // Existing IP-allowlisted credentials need no SN.
  url.searchParams.delete("sn");
  const query = [...url.searchParams]
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join("&");
  const raw = encode(url.pathname + "?" + query + sk);
  const bytes = new TextEncoder().encode(raw);
  const digest = env.BAIDU_MD5
    ? await env.BAIDU_MD5(bytes)
    : await crypto.subtle.digest("MD5", bytes);
  const sn = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  url.search = query + "&sn=" + sn;
  return url;
}
