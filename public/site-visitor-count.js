/* 自建累计访客脚注：独立站点身份，不读取游戏存档或发送页面内容。 */
(() => {
  'use strict';
  const lifetime = 90 * 24 * 60 * 60 * 1000;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  async function mount(element, site, isDisabled = () => false) {
    element.textContent = '网站累计访问人数：—';
    const url = 'https://stats.gongfpp.icu/api/journey/v1/site-counts/' + encodeURIComponent(site);
    let identity = null;
    try {
      if (navigator.doNotTrack !== '1' && window.doNotTrack !== '1' && navigator.globalPrivacyControl !== true && !isDisabled()) {
        const key = 'site-visitor-count:v1:' + site;
        const now = Date.now();
        try { identity = JSON.parse(localStorage.getItem(key)); } catch (_) { /* 损坏的记录可以更新；存储禁用时保持只读。 */ }
        if (!identity || !uuid.test(identity.visitorId) || !Number.isSafeInteger(identity.bornAt) || identity.bornAt > now || now - identity.bornAt >= lifetime) {
          identity = { visitorId: crypto.randomUUID(), bornAt: now };
          localStorage.setItem(key, JSON.stringify(identity));
        }
      }
    } catch (_) { identity = null; }
    let controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 8000);
    const options = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal };
    try {
      let response;
      if (identity) {
        try {
          response = await fetch(url, { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, path: location.pathname }) });
        } catch (_) { /* 写入失败后仍可读取真实累计值。 */ }
      }
      if (!response || !response.ok) {
        clearTimeout(timeout);
        controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 8000);
        response = await fetch(url, { ...options, signal: controller.signal });
      }
      if (!response.ok) return;
      const result = await response.json();
      if (result.version === 1 && result.site === site && Number.isSafeInteger(result.total) && result.total >= 0) {
        element.textContent = '网站累计访问人数：' + result.total.toLocaleString('zh-CN');
      }
    } catch (_) { /* 无可靠结果时保留破折号，不伪造零。 */ }
    finally { clearTimeout(timeout); }
  }
  window.SiteVisitorCount = { mount };
  document.querySelectorAll('[data-site-count]').forEach(element => {
    mount(element, element.dataset.siteCount, () => typeof window.siteVisitorCountDisabled === 'function' && window.siteVisitorCountDisabled());
  });
})();
