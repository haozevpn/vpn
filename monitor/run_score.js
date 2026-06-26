/**
 * run_score.js — 本地快速评分刷新脚本（Node.js，无需 Python 环境）
 * 使用方式: node monitor/run_score.js
 *
 * 评分维度（重构版 v2）：
 *   1. 订阅可用率       (40分) — 近30天订阅链接成功率
 *   2. 官网可用率       (25分) — 近30天官网可达成功率
 *   3. 响应速度         (15分) — 平均响应延迟（越快越高分）
 *   4. 运营稳定性       (12分) — 运营天数信誉
 *   5. 价格竞争力       ( 5分) — 月付价格越低略微加分
 *   6. 线路质量标签     ( 3分) — IEPL/CN2 等高质量线路标签加分
 *
 *   附加：新机场缺少日志时使用「初始锚点评分」代替100%满分默认值，
 *         锚点基于机场 ID 哈希生成，使各机场得分有自然区分。
 *
 *   最终分值区间：~65 — ~95（正常情况下 70~92 最常见）
 */

const SUPABASE_URL         = 'https://jsdvhryfmuadxaijmsjb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY    = 'sb_publishable_ufJ4lt-JiL9ONh5X9X6ZHw_PE58RM1F';

const API_KEY = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;

const headers = {
  'apikey':        API_KEY,
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type':  'application/json',
};

// ── 工具函数 ──────────────────────────────────────────────────
function log(msg) { console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`); }

async function supabaseGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GET ${path} 失败: ${resp.status} ${err}`);
  }
  return resp.json();
}

async function supabasePatch(table, id, data) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method:  'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(data),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`PATCH ${table}?id=${id} 失败: ${resp.status} ${err}`);
  }
}

// ── 基于ID的稳定哈希（用于新机场初始评分锚点）────────────────
function stableHashFloat(str, min, max) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;  // FNV-1a 32bit
  }
  // 归一化到 [min, max]
  return min + (h % 10000) / 10000 * (max - min);
}

// ── 从价格字符串解析月付金额 ──────────────────────────────────
function parsePricePerMonth(priceStr) {
  if (!priceStr || priceStr === '--') return null;
  const m = priceStr.match(/¥\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1]);
}

// ── 响应速度得分（满分15，基于平均延迟ms）─────────────────────
// <300ms → 15, 300-600ms → 10-15, 600-1200ms → 5-10, >1200ms → 2-5, 无数据→哈希默认
function computeSpeedScore(logs, airportId) {
  const validMs = logs
    .map(r => r.website_ms)
    .filter(ms => ms !== null && ms !== undefined && ms > 0);

  if (validMs.length === 0) {
    // 没有延迟数据时，用 ID 哈希给一个 6~12 的中间值
    return stableHashFloat(airportId + '_speed', 6, 12);
  }

  const avgMs = validMs.reduce((a, b) => a + b, 0) / validMs.length;

  if (avgMs <= 300)       return 15.0;
  if (avgMs <= 600)       return 15.0 - (avgMs - 300) / 300 * 5.0;   // 15→10
  if (avgMs <= 1200)      return 10.0 - (avgMs - 600) / 600 * 5.0;   // 10→5
  return Math.max(2.0, 5.0 - (avgMs - 1200) / 1000 * 3.0);           // 5→2
}

// ── 价格竞争力得分（满分5）────────────────────────────────────
// ≤8元 → 5分，8-15 → 3-5，15-30 → 1-3，>30 → 0.5，无价格→哈希
function computePriceScore(priceStr, airportId) {
  const price = parsePricePerMonth(priceStr);
  if (price === null) return stableHashFloat(airportId + '_price', 1.5, 3.0);

  if (price <= 8)   return 5.0;
  if (price <= 15)  return 5.0 - (price - 8) / 7 * 2.0;    // 5→3
  if (price <= 30)  return 3.0 - (price - 15) / 15 * 2.0;  // 3→1
  return 0.5;
}

// ── 线路质量标签加分（满分3）─────────────────────────────────
function computeTagScore(tags) {
  const tagList = Array.isArray(tags) ? tags : [];
  let bonus = 0;
  // 高质量线路标签（不重复叠加，取最高）
  const premiumTags   = ['IEPL专线', 'CN2专线', 'IEPL优化线路', 'CN2 GIA'];
  const mediumTags    = ['直连中转', '多线BGP', 'AnyTLS', '无倍率'];
  const streamTags    = ['解锁流媒体', '流媒体支持'];

  if (tagList.some(t => premiumTags.some(p => t.includes(p.replace('专线','').replace('优化线路',''))))) {
    bonus += 1.5;
  } else if (tagList.some(t => mediumTags.some(m => t.includes(m)))) {
    bonus += 0.8;
  }
  if (tagList.some(t => streamTags.some(s => t.includes('流媒')))) {
    bonus += 0.5;
  }
  // 稳定相关
  if (tagList.some(t => t.includes('晚高峰') || t.includes('稳定'))) {
    bonus += 0.5;
  }
  return Math.min(3.0, bonus);
}

// ── 主评分函数（重构版 v2）───────────────────────────────────
function computeScore(airport, logs) {
  const airportId = airport.id || 'unknown';
  const hasLogs   = logs && logs.length >= 3;  // 少于3条样本视为无效

  // ── 1. 订阅可用率 (40分) ────────────────────────────────
  let subAvailRate;
  if (!hasLogs) {
    // 新机场：基于ID哈希给 0.88~0.98 的初始值（而非固定1.0）
    subAvailRate = stableHashFloat(airportId + '_sub', 0.88, 0.98);
  } else {
    const subLogs = logs.filter(r => r.sub_ok !== null && r.sub_ok !== undefined);
    if (subLogs.length >= 2) {
      subAvailRate = subLogs.filter(r => r.sub_ok).length / subLogs.length;
    } else {
      subAvailRate = stableHashFloat(airportId + '_sub', 0.88, 0.98);
    }
  }
  const subScore = subAvailRate * 40;

  // ── 2. 官网可用率 (25分) ────────────────────────────────
  let webAvailRate;
  if (!hasLogs) {
    webAvailRate = stableHashFloat(airportId + '_web', 0.92, 1.0);
  } else {
    const total  = logs.length;
    const webOk  = logs.filter(r => r.website_ok).length;
    webAvailRate = webOk / total;
  }
  const webScore = webAvailRate * 25;

  // ── 3. 响应速度 (15分) ──────────────────────────────────
  const speedScore = computeSpeedScore(hasLogs ? logs : [], airportId);

  // ── 4. 运营稳定性 (12分) ────────────────────────────────
  const daysOnline = airport.days_online || 0;
  //   基础 8分 + 运营天数加成（最高4分，180天满），+ 哈希小扰动（±0~1分）
  const daysBonus     = Math.min(4.0, daysOnline / 180.0 * 4.0);
  const hashNoise     = stableHashFloat(airportId + '_rep', 0, 1.2);
  const reputScore    = Math.min(12.0, 8.0 + daysBonus + hashNoise);

  // ── 5. 价格竞争力 (5分) ─────────────────────────────────
  const priceScore = computePriceScore(airport.price, airportId);

  // ── 6. 线路质量标签 (3分) ───────────────────────────────
  const tagScore = computeTagScore(airport.tags);

  // ── 汇总原始分（满分 100）───────────────────────────────
  let rawScore = subScore + webScore + speedScore + reputScore + priceScore + tagScore;

  // ── 风险预警扣分 ─────────────────────────────────────────
  const category = Array.isArray(airport.category) ? airport.category : [];
  if (category.includes('risk')) rawScore = Math.max(0, rawScore - 50);

  // ── 最终分值压缩到 62~95 区间 ────────────────────────────
  // 公式：62 + raw * 0.33（raw≈100时→95，raw≈0时→62）
  const newScore = Math.round((62.0 + rawScore * 0.33) * 100) / 100;

  // ── 计算变化量 ───────────────────────────────────────────
  const oldScore = parseFloat(airport.score) || 75.0;
  const delta    = Math.round((newScore - oldScore) * 100) / 100;
  const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta < 0 ? delta.toFixed(2) : '+0.00';

  return {
    newScore,
    deltaStr,
    webAvailRate,
    subAvailRate,
    speedScore,
    priceScore,
    tagScore,
    reputScore,
    logCount: logs ? logs.length : 0,
  };
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  log('='.repeat(65));
  log('  机场评分实时刷新开始（v2 多维评分）');
  log('='.repeat(65));

  // 1. 读取所有 active 机场（含 score / price / tags 字段）
  const airports = await supabaseGet(
    'airports?select=id,name,days_online,category,score,price,tags&status=eq.active'
  );
  log(`共发现 ${airports.length} 个已激活机场`);

  if (airports.length === 0) {
    log('无可用机场，退出。');
    return;
  }

  // 2. 计算30天前时间戳
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let successCount = 0;
  let errorCount   = 0;

  log('');
  log('  机场名称         评分      变化    官网可用  订阅可用  速度分  价格分  样本数');
  log('  ' + '-'.repeat(80));

  for (const airport of airports) {
    try {
      // 3. 读取该机场近30天检测记录（含 website_ms）
      const logs = await supabaseGet(
        `speed_logs?select=website_ok,sub_ok,website_ms&airport_id=eq.${airport.id}&checked_at=gte.${cutoff}`
      );

      // 4. 计算评分
      const { newScore, deltaStr, webAvailRate, subAvailRate, speedScore, priceScore, logCount } =
        computeScore(airport, logs);

      // 5. 写回数据库
      await supabasePatch('airports', airport.id, {
        score:       newScore,
        score_delta: deltaStr,
        updated_at:  new Date().toISOString(),
      });

      const arrow = deltaStr.startsWith('+') && deltaStr !== '+0.00' ? '↑'
                  : deltaStr.startsWith('-') ? '↓' : '→';
      const noDataFlag = logCount < 3 ? ' [初始]' : '';

      log(
        `  ${arrow} ${(airport.name || airport.id).padEnd(12)}` +
        `  ${newScore.toFixed(2).padStart(5)}  (${deltaStr.padStart(7)})` +
        `  官网:${(webAvailRate * 100).toFixed(0).padStart(3)}%` +
        `  订阅:${(subAvailRate * 100).toFixed(0).padStart(3)}%` +
        `  速度:${speedScore.toFixed(1).padStart(4)}` +
        `  价格:${priceScore.toFixed(1).padStart(4)}` +
        `  样本:${logCount}${noDataFlag}`
      );
      successCount++;

    } catch (err) {
      log(`  ERR ${airport.id}: ${err.message}`);
      errorCount++;
    }
  }

  log('  ' + '-'.repeat(80));
  log('');
  log('='.repeat(65));
  log(`  完成：${successCount} 成功，${errorCount} 失败`);
  log('='.repeat(65));
}

main().catch(e => {
  console.error('脚本异常退出:', e);
  process.exit(1);
});
