/**
 * update_and_score.js — 批量更新官网/订阅地址并立即刷新评分
 */

const SUPABASE_URL = 'https://jsdvhryfmuadxaijmsjb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ufJ4lt-JiL9ONh5X9X6ZHw_PE58RM1F';

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

function log(msg) { console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`); }

// 需要更新的官网/推广/订阅地址（按机场名称匹配）
const UPDATES = [
  {
    name: '影子VPN',
    website_url:   'https://www.yingzi01.com/register?code=X7XPN1cS',
    affiliate_url: 'https://www.yingzi01.com/register?code=X7XPN1cS',
  },
  {
    name: '99吧',
    website_url:   'https://99ba.net/',
    affiliate_url: 'https://99ba.net/',
  },
  {
    name: '山水云',
    website_url:   'https://ss2.byvvcsx.com/#/register?code=jkziWeb8',
    affiliate_url: 'https://ss2.byvvcsx.com/#/register?code=jkziWeb8',
  },
  {
    name: '秒秒云',
    website_url:   'https://mdl3.mxjcbg.com/#/register?code=g3bq7bpK',
    affiliate_url: 'https://mdl3.mxjcbg.com/#/register?code=g3bq7bpK',
  },
  {
    name: '锦云',
    website_url:   'https://w2.whengdl.com/#/register?code=BIGc8qrQ',
    affiliate_url: 'https://w2.whengdl.com/#/register?code=BIGc8qrQ',
    sub_url:       'https://w1.wanhdy.com/s/944cd302d464450810c709d98b23d09d',
  },
];

// ── 基于ID的稳定哈希（新机场初始评分锚点）────────────────────
function stableHashFloat(str, min, max) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return min + (h % 10000) / 10000 * (max - min);
}

function parsePricePerMonth(priceStr) {
  if (!priceStr || priceStr === '--') return null;
  const m = priceStr.match(/¥\s*(\d+(?:\.\d+)?)/);  
  return m ? parseFloat(m[1]) : null;
}

function computeSpeedScore(logs, airportId) {
  const validMs = logs.map(r => r.website_ms).filter(ms => ms !== null && ms !== undefined && ms > 0);
  if (validMs.length === 0) return stableHashFloat(airportId + '_speed', 6, 12);
  const avgMs = validMs.reduce((a, b) => a + b, 0) / validMs.length;
  if (avgMs <= 300)  return 15.0;
  if (avgMs <= 600)  return 15.0 - (avgMs - 300) / 300 * 5.0;
  if (avgMs <= 1200) return 10.0 - (avgMs - 600) / 600 * 5.0;
  return Math.max(2.0, 5.0 - (avgMs - 1200) / 1000 * 3.0);
}

function computePriceScore(priceStr, airportId) {
  const price = parsePricePerMonth(priceStr);
  if (price === null) return stableHashFloat(airportId + '_price', 1.5, 3.0);
  if (price <= 8)  return 5.0;
  if (price <= 15) return 5.0 - (price - 8) / 7 * 2.0;
  if (price <= 30) return 3.0 - (price - 15) / 15 * 2.0;
  return 0.5;
}

function computeTagScore(tags) {
  const tagList = Array.isArray(tags) ? tags : [];
  let bonus = 0;
  const premium = ['IEPL', 'CN2'];
  const medium  = ['直连中转', '多线BGP', 'AnyTLS', '无倍率'];
  if (tagList.some(t => premium.some(p => t.includes(p)))) bonus += 1.5;
  else if (tagList.some(t => medium.some(m => t.includes(m)))) bonus += 0.8;
  if (tagList.some(t => t.includes('流媒'))) bonus += 0.5;
  if (tagList.some(t => t.includes('晚高峰') || t.includes('稳定'))) bonus += 0.5;
  return Math.min(3.0, bonus);
}

// ── 评分计算（v2 多维，与 run_score.js 一致）──────────────────
function computeScore(airport, logs) {
  const airportId = airport.id || 'unknown';
  const hasLogs = logs && logs.length >= 3;

  let subAvailRate;
  if (!hasLogs) {
    subAvailRate = stableHashFloat(airportId + '_sub', 0.88, 0.98);
  } else {
    const subLogs = logs.filter(r => r.sub_ok !== null && r.sub_ok !== undefined);
    subAvailRate = subLogs.length >= 2
      ? subLogs.filter(r => r.sub_ok).length / subLogs.length
      : stableHashFloat(airportId + '_sub', 0.88, 0.98);
  }
  const subScore = subAvailRate * 40;

  let webAvailRate;
  if (!hasLogs) {
    webAvailRate = stableHashFloat(airportId + '_web', 0.92, 1.0);
  } else {
    webAvailRate = logs.filter(r => r.website_ok).length / logs.length;
  }
  const webScore = webAvailRate * 25;

  const speedScore = computeSpeedScore(hasLogs ? logs : [], airportId);

  // 运营天数：优先从 created_at 自动计算，fallback 到存储值
  const createdAt  = airport.created_at ? new Date(airport.created_at) : null;
  const daysOnline = createdAt
    ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)))
    : (airport.days_online || 0);
  const daysBonus  = Math.min(4.0, daysOnline / 180.0 * 4.0);
  const hashNoise  = stableHashFloat(airportId + '_rep', 0, 1.2);
  const reputScore = Math.min(12.0, 8.0 + daysBonus + hashNoise);

  const priceScore = computePriceScore(airport.price, airportId);
  const tagScore   = computeTagScore(airport.tags);

  let rawScore = subScore + webScore + speedScore + reputScore + priceScore + tagScore;
  const category = Array.isArray(airport.category) ? airport.category : [];
  if (category.includes('risk')) rawScore = Math.max(0, rawScore - 50);

  const newScore = Math.round((62.0 + rawScore * 0.33) * 100) / 100;
  const oldScore = parseFloat(airport.score) || 75.0;
  const delta    = Math.round((newScore - oldScore) * 100) / 100;
  const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta < 0 ? delta.toFixed(2) : '+0.00';
  return { newScore, deltaStr, webAvailRate, subAvailRate, daysOnline };
}

async function main() {
  // ── STEP 1: 读取所有 active 机场 ─────────────────────────
  log('读取数据库中的机场列表...');
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/airports?select=id,name,website_url,sub_url,days_online,category,score,price,tags,created_at&status=eq.active`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const airports = await resp.json();
  log(`共 ${airports.length} 个激活机场`);

  // ── STEP 2: 更新官网地址 ─────────────────────────────────
  log('');
  log('--- 开始更新官网/订阅地址 ---');
  for (const update of UPDATES) {
    const airport = airports.find(a => a.name && a.name.trim() === update.name.trim());
    if (!airport) {
      log(`  SKIP: 未找到机场 "${update.name}"（数据库名称不匹配？）`);
      continue;
    }

    const patch = {};
    if (update.website_url)   patch.website_url   = update.website_url;
    if (update.affiliate_url) patch.affiliate_url = update.affiliate_url;
    if (update.sub_url)       patch.sub_url       = update.sub_url;
    patch.updated_at = new Date().toISOString();

    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/airports?id=eq.${airport.id}`,
      { method: 'PATCH', headers, body: JSON.stringify(patch) }
    );
    if (!patchResp.ok) {
      const err = await patchResp.text();
      log(`  ERR  ${update.name}: ${err}`);
    } else {
      // 同步更新内存中的数据供后续评分用
      Object.assign(airport, patch);
      const parts = [];
      if (update.website_url) parts.push(`官网 ✓`);
      if (update.sub_url)     parts.push(`订阅 ✓`);
      log(`  OK   ${update.name}: ${parts.join(' ')} → 已更新`);
    }
  }

  // ── STEP 3: 刷新所有机场评分 ────────────────────────────
  log('');
  log('--- 开始刷新评分 ---');
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const airport of airports) {
    // 读取近30天检测记录
    const logsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/speed_logs?select=website_ok,sub_ok,website_ms&airport_id=eq.${airport.id}&checked_at=gte.${cutoff}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const logs = await logsResp.json();

    const { newScore, deltaStr, webAvailRate, subAvailRate, daysOnline } = computeScore(airport, logs);

    await fetch(
      `${SUPABASE_URL}/rest/v1/airports?id=eq.${airport.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ score: newScore, score_delta: deltaStr, days_online: daysOnline, updated_at: new Date().toISOString() })
      }
    );

    const arrow = deltaStr.startsWith('+') && deltaStr !== '+0.00' ? '↑' : deltaStr.startsWith('-') ? '↓' : '→';
    log(
      `  ${arrow} ${(airport.name || airport.id).padEnd(12)} ` +
      `评分: ${newScore.toFixed(2).padStart(5)} (${deltaStr})  ` +
      `天数: ${String(daysOnline).padStart(3)}天  ` +
      `官网: ${(webAvailRate*100).toFixed(0).padStart(3)}%  ` +
      `订阅: ${(subAvailRate*100).toFixed(0).padStart(3)}%  ` +
      `样本: ${Array.isArray(logs) ? logs.length : 0}`
    );
  }

  log('');
  log('全部完成！');
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
