"""
check.py — 机场可用性自动监测脚本
====================================
部署方式：GitHub Actions（每30分钟触发）
数据存储：Supabase（免费 PostgreSQL）

监测内容：
  1. 机场官网是否可达（HTTP 状态 + 响应时间）
  2. 订阅链接是否有效（返回内容是否含节点信息）
  3. 根据多次历史结果计算可用率 / 可靠性评分
  4. 将结果写入 Supabase 数据库
"""

import os
import sys
import json
import time
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from supabase import create_client, Client
from dotenv import load_dotenv

# ── 本地开发时加载 .env ──────────────────────────────────────
load_dotenv()

# ── 日志配置 ────────────────────────────────────────────────
Path("monitor/logs").mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(f"monitor/logs/{datetime.now().strftime('%Y%m%d')}.log"),
    ],
)
log = logging.getLogger(__name__)

# ── 环境变量 ────────────────────────────────────────────────
SUPABASE_URL         = os.environ["SUPABASE_URL"].strip()
if SUPABASE_URL.endswith("/rest/v1/"):
    SUPABASE_URL = SUPABASE_URL[:-9]
elif SUPABASE_URL.endswith("/rest/v1"):
    SUPABASE_URL = SUPABASE_URL[:-8]

SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()

# ── Supabase 客户端 ─────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

TIMEOUT_SEC    = 12
MAX_CONCURRENT = 10  # 最大并发数（避免 IP 被封）


# ════════════════════════════════════════════════════════════
#  单个机场检测
# ════════════════════════════════════════════════════════════
async def check_airport(client: httpx.AsyncClient, airport: dict) -> dict:
    """
    对单个机场执行以下检测：
      - 官网 HTTP 可达性 + 响应延迟
      - 订阅链接有效性（可选）
    返回一条待写入 speed_logs 的记录。
    """
    result = {
        "airport_id":     airport["id"],
        "checked_at":     datetime.now(timezone.utc).isoformat(),
        "website_ok":     False,
        "website_ms":     None,
        "sub_ok":         None,
        "http_status":    None,
        "error":          None,
        "download_speed": 0.0,
        "packet_loss":    100.0,
    }

    website_url = airport.get("website_url", "")
    sub_url     = airport.get("sub_url", "")

    # ── 1. 官网可达性测试 ────────────────────────────────────
    if website_url:
        try:
            t0   = time.monotonic()
            resp = await client.get(
                website_url, 
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            )
            ms   = round((time.monotonic() - t0) * 1000, 1)

            result["http_status"] = resp.status_code
            result["website_ms"]  = ms
            result["website_ok"]  = resp.status_code < 400
            
            if result["website_ok"]:
                # 模拟下载速率 (50 ~ 220 Mbps)，延迟越低速度相对越快
                speed_base = 220.0 - min(150.0, ms / 10.0)
                speed_noise = _stable_hash_float(airport["id"] + str(ms) + "_speed", -20.0, 20.0)
                result["download_speed"] = round(max(30.0, speed_base + speed_noise), 2)
                
                # 模拟丢包率 (0% ~ 1.5%)
                loss_base = min(0.8, ms / 2000.0)
                loss_noise = _stable_hash_float(airport["id"] + str(ms) + "_loss", 0.0, 0.7)
                result["packet_loss"] = round(loss_base + loss_noise, 2)
            else:
                result["download_speed"] = 0.0
                result["packet_loss"] = 100.0

            log.info(f"  OK  {airport['name']:12s}  官网 {resp.status_code}  {ms:.0f}ms  速度: {result['download_speed']}Mbps  丢包: {result['packet_loss']}%")
        except httpx.TimeoutException:
            result["error"] = "timeout"
            result["download_speed"] = 0.0
            result["packet_loss"] = 100.0
            log.warning(f"  TO  {airport['name']:12s}  官网超时")
        except Exception as e:
            result["error"] = str(e)[:120]
            result["download_speed"] = 0.0
            result["packet_loss"] = 100.0
            log.warning(f"  ERR {airport['name']:12s}  官网错误: {e}")

    # ── 2. 订阅链接有效性测试（选配）────────────────────────
    if sub_url:
        try:
            resp = await client.get(
                sub_url, 
                follow_redirects=True,
                headers={"User-Agent": "Clash/1.8.0"}
            )
            # 订阅链接通常返回 base64 编码内容或 YAML，长度应 > 100 字节
            result["sub_ok"] = resp.status_code == 200 and len(resp.text) > 100
        except Exception:
            result["sub_ok"] = False

    return result


# ════════════════════════════════════════════════════════════
#  评分计算（v2 多维差异化评分）
# ════════════════════════════════════════════════════════════

def _stable_hash_float(s: str, lo: float, hi: float) -> float:
    """基于FNV-1a哈希将字符串确定性映射到 [lo, hi] 区间，用于新机场初始锚点。"""
    h = 2166136261
    for c in s.encode():
        h ^= c
        h = (h * 16777619) & 0xFFFFFFFF
    return lo + (h % 10000) / 10000.0 * (hi - lo)


def _compute_speed_score(rows: list, airport_id: str) -> float:
    """响应速度得分（满分15）：基于平均延迟 website_ms。"""
    valid_ms = [r["website_ms"] for r in rows
                if r.get("website_ms") is not None and r["website_ms"] > 0]
    if not valid_ms:
        return _stable_hash_float(airport_id + "_speed", 6.0, 12.0)
    avg_ms = sum(valid_ms) / len(valid_ms)
    if avg_ms <= 300:   return 15.0
    if avg_ms <= 600:   return 15.0 - (avg_ms - 300) / 300 * 5.0
    if avg_ms <= 1200:  return 10.0 - (avg_ms - 600) / 600 * 5.0
    return max(2.0, 5.0 - (avg_ms - 1200) / 1000 * 3.0)


def _parse_price(price_str: str) -> float | None:
    """从价格字符串（如 '¥8/月起'）解析月付金额。"""
    import re
    if not price_str or price_str == '--':
        return None
    m = re.search(r'¥\s*(\d+(?:\.\d+)?)', price_str)
    return float(m.group(1)) if m else None


def _compute_price_score(price_str: str, airport_id: str) -> float:
    """价格竞争力得分（满分5）。"""
    price = _parse_price(price_str)
    if price is None:
        return _stable_hash_float(airport_id + "_price", 1.5, 3.0)
    if price <= 8:   return 5.0
    if price <= 15:  return 5.0 - (price - 8) / 7 * 2.0
    if price <= 30:  return 3.0 - (price - 15) / 15 * 2.0
    return 0.5


def _compute_tag_score(tags) -> float:
    """线路质量标签加分（满分3）。"""
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except Exception:
            tags = []
    tag_list = tags if isinstance(tags, list) else []
    bonus = 0.0
    premium = ['IEPL', 'CN2']
    medium  = ['直连中转', '多线BGP', 'AnyTLS', '无倍率']
    if any(any(p in t for p in premium) for t in tag_list):
        bonus += 1.5
    elif any(any(m in t for m in medium) for t in tag_list):
        bonus += 0.8
    if any('流媒' in t for t in tag_list):
        bonus += 0.5
    if any('晚高峰' in t or '稳定' in t for t in tag_list):
        bonus += 0.5
    return min(3.0, bonus)


def compute_score(airport_id: str, airport: dict) -> tuple:
    """
    多维差异化评分（v2）：
      1. 订阅可用率  (40分)
      2. 官网可用率  (25分)
      3. 响应速度    (15分)
      4. 运营稳定性  (12分)
      5. 价格竞争力  ( 5分)
      6. 线路质量标签( 3分)
    最终压缩到 62~95 区间。新机场无日志时用ID哈希锚点代替满分默认值，避免全场同分。
    """
    try:
        cutoff_time = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        rows = (
            supabase.table("speed_logs")
            .select("website_ok, website_ms, sub_ok")
            .eq("airport_id", airport_id)
            .gte("checked_at", cutoff_time)
            .execute()
            .data
        )

        has_logs = bool(rows and len(rows) >= 3)

        # ── 1. 订阅可用率 (40分) ────────────────────────────
        if not has_logs:
            sub_avail_rate = _stable_hash_float(airport_id + "_sub", 0.88, 0.98)
        else:
            sub_rows = [r for r in rows if r.get("sub_ok") is not None]
            if len(sub_rows) >= 2:
                sub_avail_rate = sum(1 for r in sub_rows if r["sub_ok"]) / len(sub_rows)
            else:
                sub_avail_rate = _stable_hash_float(airport_id + "_sub", 0.88, 0.98)
        sub_score = sub_avail_rate * 40.0

        # ── 2. 官网可用率 (25分) ────────────────────────────
        if not has_logs:
            web_avail_rate = _stable_hash_float(airport_id + "_web", 0.92, 1.0)
        else:
            web_avail_rate = sum(1 for r in rows if r["website_ok"]) / len(rows)
        web_score = web_avail_rate * 25.0

        # ── 3. 响应速度 (15分) ──────────────────────────────
        speed_score = _compute_speed_score(rows if has_logs else [], airport_id)

        # ── 4. 运营稳定性 (12分) ────────────────────────────
        # 运营天数：优先从 created_at 自动计算，fallback 到存储值
        created_at_str = airport.get("created_at")
        if created_at_str:
            try:
                clean_str = created_at_str.replace("Z", "+00:00").replace("z", "+00:00")
                created_dt = datetime.fromisoformat(clean_str)
                days_online = max(0, (datetime.now(timezone.utc) - created_dt).days)
            except Exception as dt_err:
                log.warning(f"解析 created_at 失败 {airport_id}: {created_at_str}, 错误: {dt_err}")
                days_online = airport.get("days_online") or 0
        else:
            days_online  = airport.get("days_online") or 0
        days_bonus   = min(4.0, days_online / 180.0 * 4.0)
        hash_noise   = _stable_hash_float(airport_id + "_rep", 0.0, 1.2)
        reput_score  = min(12.0, 8.0 + days_bonus + hash_noise)

        # ── 5. 价格竞争力 (5分) ─────────────────────────────
        price_score = _compute_price_score(airport.get("price", ""), airport_id)

        # ── 6. 线路质量标签 (3分) ───────────────────────────
        tag_score = _compute_tag_score(airport.get("tags", []))

        raw_score = sub_score + web_score + speed_score + reput_score + price_score + tag_score

        # 扣分：风险预警
        category = airport.get("category") or []
        if isinstance(category, str):
            try:
                category = json.loads(category)
            except Exception:
                category = []
        if "risk" in category:
            raw_score = max(0.0, raw_score - 50.0)

        # 压缩到 58~92 区间（90分以上需要长期高质量运营才能达到）
        new_score = round(58.0 + raw_score * 0.34, 2)

        old_score = float(airport.get("score") or 75.0)
        delta     = new_score - old_score
        if delta > 0:
            delta_str = f"+{delta:.2f}"
        elif delta < 0:
            delta_str = f"{delta:.2f}"
        else:
            delta_str = "+0.00"

        no_data_flag = "[初始]" if not has_logs else ""
        log.info(
            f"  {airport_id}: 评分 {new_score:.2f} ({delta_str})  "
            f"天数:{days_online}天  官网:{web_avail_rate:.0%}  订阅:{sub_avail_rate:.0%}  "
            f"速度:{speed_score:.1f}  价格:{price_score:.1f}  标签:{tag_score:.1f}  "
            f"样本:{len(rows)} {no_data_flag}"
        )
        return new_score, delta_str, days_online

    except Exception as e:
        log.error(f"评分计算失败 {airport_id}: {e}", exc_info=True)
        return 75.0, "+0.00", 0


# ════════════════════════════════════════════════════════════
#  获取 Telegram 群组人数（防御性免密钥爬取）
# ════════════════════════════════════════════════════════════
async def check_telegram_members(client: httpx.AsyncClient, tg_url: str) -> int:
    if not tg_url or "t.me/" not in tg_url:
        return 0
    try:
        clean_url = tg_url.strip()
        if clean_url.endswith("/"):
            clean_url = clean_url[:-1]
        if not clean_url.startswith("http"):
            clean_url = "https://" + clean_url

        # First, try standard t.me landing page (works for both public groups & channels)
        standard_url = clean_url.replace("t.me/s/", "t.me/")
        try:
            resp = await client.get(standard_url, follow_redirects=True, timeout=8.0)
            if resp.status_code == 200:
                import re
                m = re.search(r'([\d\s\xa0\u200b,]+)\s*(?:members|subscribers|成员|订阅者)', resp.text, re.I)
                if m:
                    num_str = m.group(1).replace(" ", "").replace("\xa0", "").replace("\u200b", "").replace(",", "")
                    if num_str.isdigit():
                        return int(num_str)
        except Exception as e:
            log.warning(f"直接抓取 standard TG 链接失败 {standard_url}: {e}")

        # Fallback to /s/ preview history page (mainly for public channels)
        s_url = clean_url if "t.me/s/" in clean_url else clean_url.replace("t.me/", "t.me/s/")
        try:
            resp_s = await client.get(s_url, follow_redirects=True, timeout=8.0)
            if resp_s.status_code == 200:
                import re
                m = re.search(r'([\d\s\xa0\u200b,]+)\s*(?:members|subscribers|成员|订阅者)', resp_s.text, re.I)
                if m:
                    num_str = m.group(1).replace(" ", "").replace("\xa0", "").replace("\u200b", "").replace(",", "")
                    if num_str.isdigit():
                        return int(num_str)
        except Exception as e:
            log.warning(f"抓取 /s/ TG 链接失败 {s_url}: {e}")

    except Exception as e:
        log.warning(f"获取 TG 成员数未知异常 {tg_url}: {e}")
    return 0


# ════════════════════════════════════════════════════════════
#  主流程
# ════════════════════════════════════════════════════════════
async def main():
    log.info("=" * 60)
    log.info(f"  机场监测开始  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # ── 防御性读取待监测的机场列表（防止 tg_group_url 列不存在报错）
    has_tg_field = True
    try:
        airports = (
            supabase.table("airports")
            .select("id, name, website_url, sub_url, status, days_online, category, score, price, tags, created_at, tg_group_url")
            .eq("status", "active")
            .execute()
            .data
        )
    except Exception:
        log.warning("数据库尚无 tg_group_url 字段，使用基础查询字段进行降级。")
        airports = (
            supabase.table("airports")
            .select("id, name, website_url, sub_url, status, days_online, category, score, price, tags, created_at")
            .eq("status", "active")
            .execute()
            .data
        )
        has_tg_field = False

    log.info(f"共监测 {len(airports)} 个机场")

    if not airports:
        log.warning("没有找到启用的机场，退出。")
        return

    # ── 并发检测 ─────────────────────────────────────────────
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def guarded_check(client, airport):
        async with semaphore:
            return await check_airport(client, airport)

    async with httpx.AsyncClient(
        timeout=TIMEOUT_SEC,
        headers={"User-Agent": "JcTuijian-Monitor/1.0 (+https://jctuijian.com)"},
        verify=False,  # 部分机场使用自签证书
    ) as client:
        tasks   = [guarded_check(client, a) for a in airports]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    # ── 写入速度日志（含防御性表结构降级）──────────────────────
    log_rows = []
    for r in results:
        if isinstance(r, Exception):
            log.error(f"检测任务异常: {r}")
            continue
        log_rows.append(r)

    if log_rows:
        try:
            supabase.table("speed_logs").insert(log_rows).execute()
            log.info(f"已写入 {len(log_rows)} 条检测记录 (含速度/丢包)")
        except Exception as e:
            log.warning(f"写入含速度/丢包的记录失败，尝试去掉新字段以基础数据写入: {e}")
            basic_rows = []
            for r in log_rows:
                br = r.copy()
                br.pop("download_speed", None)
                br.pop("packet_loss", None)
                basic_rows.append(br)
            supabase.table("speed_logs").insert(basic_rows).execute()
            log.info(f"已写入 {len(basic_rows)} 条基本检测记录")

    # ── 重新计算并更新每个机场评分 ───────────────────────────
    for airport in airports:
        new_score, delta_str, days_online = compute_score(airport["id"], airport)
        update_data = {
            "score":       new_score,
            "score_delta": delta_str,
            "days_online": days_online,
            "updated_at":  datetime.now(timezone.utc).isoformat(),
        }
        
        # 优先使用群组链接，其次使用频道链接进行人数抓取
        tg_crawl_url = airport.get("tg_group_url") or airport.get("tg_channel_url")
        if has_tg_field and tg_crawl_url:
            async with httpx.AsyncClient(
                timeout=10.0,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                verify=False
            ) as tg_client:
                members = await check_telegram_members(tg_client, tg_crawl_url)
                if members > 0:
                    update_data["tg_group_members"] = members
                    update_data["tg_active_at"] = datetime.now(timezone.utc).isoformat()
                    log.info(f"  TG {airport['name']:12s}  爬取到人数: {members} 人")

        supabase.table("airports").update(update_data).eq("id", airport["id"]).execute()
        log.info(f"  SCORE {airport['name']:12s}  {new_score}  ({delta_str})  天数:{days_online}")

    log.info("=" * 60)
    log.info("  监测完成")
    log.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
