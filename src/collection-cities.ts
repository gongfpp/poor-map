// Latest published tier list: Yicai 2025. The 2026 report no longer publishes tiers.
export const cityListSource = "https://www.yicai.com/news/102638963.html";
const first = "北京 上海 广州 深圳".split(" ");
const newFirst =
  "成都 杭州 重庆 武汉 苏州 西安 南京 长沙 郑州 天津 合肥 青岛 东莞 宁波 佛山".split(
    " ",
  );
const second =
  "济南 无锡 沈阳 昆明 福州 厦门 温州 石家庄 大连 哈尔滨 金华 泉州 南宁 长春 常州 南昌 南通 贵阳 嘉兴 徐州 惠州 太原 烟台 临沂 保定 台州 绍兴 珠海 洛阳 潍坊".split(
    " ",
  );
const capitals =
  "北京 天津 上海 重庆 石家庄 太原 呼和浩特 沈阳 长春 哈尔滨 南京 杭州 合肥 福州 南昌 济南 郑州 武汉 长沙 广州 南宁 海口 成都 贵阳 昆明 拉萨 西安 兰州 西宁 银川 乌鲁木齐".split(
    " ",
  );
export const collectionCities = [
  ...new Set([...first, ...newFirst, ...second, ...capitals]),
].map((name) => ({
  name,
  tier: first.includes(name)
    ? "一线"
    : newFirst.includes(name)
      ? "新一线"
      : second.includes(name)
        ? "二线"
        : "省会／首府",
  capital: capitals.includes(name),
  priority: ["宁波", ...first].includes(name),
}));
