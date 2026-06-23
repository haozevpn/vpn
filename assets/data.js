// ============================================================
//  机场数据源 — jctuijian.com
//  注意：订阅链接(sub_url)含私密 token，只存在 Supabase 数据库中
//       本文件仅含前端展示所需的公开信息
// ============================================================

window.AIRPORTS_DATA = [

  // ══════════════════════════════════════════════════════════
  //  已入驻机场（正式监测中）
  // ══════════════════════════════════════════════════════════

  {
    id: "jilian",
    name: "极连云",
    score: 88.50,
    scoreDelta: "+0.00",
    url: "https://haozevpn.jlyvipaff.com/#/?code=KUKfOY13",
    reportSlug: "jilian",
    tags: ["晚高峰稳定", "IEPL专线", "解锁流媒体"],
    tagColors: ["blue", "green", "purple"],
    daysOnline: 0,       // 由监测脚本自动更新
    highlight: "稳定不跑路",
    conclusion: "亮点：海外实体团队专业运维，技术实力强，适合长期订阅。月付低至 ¥8 起。",
    category: ["today", "stable", "value"],
    price: "¥8/月起",
    risk: null,
    status: "active",
  },

  {
    id: "shun",
    name: "瞬云",
    score: 85.20,
    scoreDelta: "+0.00",
    url: "https://ccc.jichang.best/#/register?code=o4I4kToe",
    reportSlug: "shun",
    tags: ["直连中转", "不掉速", "无倍率"],
    tagColors: ["blue", "green", "yellow"],
    daysOnline: 0,
    highlight: "高速节点",
    conclusion: "亮点：主流国家 ANYCAST 高速节点，直连中转双线路，月付低至 ¥7 起。",
    category: ["today", "value"],
    price: "¥7/月起",
    risk: null,
    status: "active",
  },

  {
    id: "bianjie",
    name: "边界云",
    score: 82.80,
    scoreDelta: "+0.00",
    url: "https://www.lvpn.cc/r/6UQDZT",
    reportSlug: "bianjie",
    tags: ["IEPL优化线路", "流媒体支持", "支持UDP"],
    tagColors: ["green", "purple", "orange"],
    daysOnline: 0,
    highlight: "专属线路",
    conclusion: "亮点：专属 IEPL 优化线路，支持主流流媒体及 UDP，线路质量稳定，¥15/月起。",
    category: ["today", "stable"],
    price: "¥15/月起",
    risk: null,
    status: "active",
  },

  {
    id: "huanyu",
    name: "寰宇云",
    score: 81.30,
    scoreDelta: "+0.00",
    url: "https://vip3.huanyuyunbest.com/#/register?code=K6h5VWw2",
    reportSlug: "huanyu",
    tags: ["晚高峰稳定", "AnyTLS", "解锁流媒体"],
    tagColors: ["blue", "dark", "purple"],
    daysOnline: 0,
    highlight: "稳定好用",
    conclusion: "亮点：稳定可靠的老牌机场，支持 AnyTLS 协议，流媒体解锁全面，¥18/月起。",
    category: ["today", "stable"],
    price: "¥18/月起",
    risk: null,
    status: "active",
  },

  // ══════════════════════════════════════════════════════════
  //  即将入驻（占位板块，资料待补充）
  // ══════════════════════════════════════════════════════════

  {
    id: "guangnian",
    name: "光年梯",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "guangnian",
    tags: ["资料审核中"],
    tagColors: ["blue"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

  {
    id: "yingzi",
    name: "影子VPN",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "yingzi",
    tags: ["资料审核中"],
    tagColors: ["dark"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

  {
    id: "shanshui",
    name: "山水云",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "shanshui",
    tags: ["资料审核中"],
    tagColors: ["blue"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

  {
    id: "miaomiao",
    name: "秒秒云",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "miaomiao",
    tags: ["资料审核中"],
    tagColors: ["green"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

  {
    id: "jinyun",
    name: "锦云",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "jinyun",
    tags: ["资料审核中"],
    tagColors: ["orange"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

  {
    id: "jiuba",
    name: "99吧",
    score: null,
    scoreDelta: null,
    url: "#",
    reportSlug: "jiuba",
    tags: ["资料审核中"],
    tagColors: ["red"],
    daysOnline: null,
    highlight: "即将上线",
    conclusion: "资料审核中，即将完成入驻流程，敬请期待。",
    category: ["new"],
    price: null,
    risk: null,
    status: "pending",
  },

];

// ── 标签颜色映射 ──────────────────────────────────────────
window.TAG_COLOR_MAP = {
  blue:   { bg: "#EFF6FF", text: "#2563EB", border: "#BFDBFE" },
  green:  { bg: "#F0FDF4", text: "#16A34A", border: "#BBF7D0" },
  yellow: { bg: "#FEFCE8", text: "#CA8A04", border: "#FDE68A" },
  purple: { bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
  orange: { bg: "#FFF7ED", text: "#EA580C", border: "#FED7AA" },
  red:    { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA" },
  dark:   { bg: "#1F2937", text: "#F9FAFB", border: "#374151" },
};

// ── 分类配置 ──────────────────────────────────────────────
window.CATEGORIES = [
  { key: "today",  label: "今日推荐", icon: "" },
  { key: "stable", label: "长期稳定", icon: "" },
  { key: "value",  label: "性价比",   icon: "" },
  { key: "new",    label: "新入榜",   icon: "" },
  { key: "risk",   label: "风险预警", icon: "" },
];

// ── 站点统计 ──────────────────────────────────────────────
const _d = new Date();
const _year = _d.getFullYear();
const _month = String(_d.getMonth() + 1).padStart(2, '0');
const _date = String(_d.getDate()).padStart(2, '0');

window.SITE_STATS = {
  monitored: 10,
  speedTests: 1240,
  lastUpdate: "刚刚更新",
  detectDate: `${_year}-${_month}-${_date}`,
};
