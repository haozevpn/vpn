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
from datetime import datetime, timezone
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

# ── 测试目标列表（与 data.js 保持同步，通过数据库读取）──────
# 脚本启动时从数据库读取 airports 表，无需硬编码
TEST_URL       = "https://www.google.com/generate_204"  # 可用性测试目标（204 = 正常）
TIMEOUT_SEC    = 12
MAX_CONCURRENT = 10  # 最大并发数（避免 IP 被封）

# ── 评分权重 ────────────────────────────────────────────────
SCORE_WEIGHTS = {
    "availability_30d": 0.40,   # 30天可用率
    "speed_score":       0.30,   # 官网响应速度得分
    "latency_score":     0.20,   # 延迟得分
    "consistency":       0.10,   # 连续7天无中断
}


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
        "airport_id":   airport["id"],
        "checked_at":   datetime.now(timezone.utc).isoformat(),
        "website_ok":   False,
        "website_ms":   None,
        "sub_ok":       None,
        "http_status":  None,
        "error":        None,
    }

    website_url = airport.get("website_url", "")
    sub_url     = airport.get("sub_url", "")

    # ── 1. 官网可达性测试 ────────────────────────────────────
    if website_url:
        try:
            t0   = time.monotonic()
            resp = await client.get(website_url, follow_redirects=True)
            ms   = round((time.monotonic() - t0) * 1000, 1)

            result["http_status"] = resp.status_code
            result["website_ms"]  = ms
            result["website_ok"]  = resp.status_code < 400
            log.info(f"  ✅ {airport['name']:12s}  官网 {resp.status_code}  {ms:.0f}ms")
        except httpx.TimeoutException:
            result["error"] = "timeout"
            log.warning(f"  ⏰ {airport['name']:12s}  官网超时")
        except Exception as e:
            result["error"] = str(e)[:120]
            log.warning(f"  ❌ {airport['name']:12s}  官网错误: {e}")

    # ── 2. 订阅链接有效性测试（选配）────────────────────────
    if sub_url:
        try:
            resp = await client.get(sub_url, follow_redirects=True)
            # 订阅链接通常返回 base64 编码内容或 YAML，长度应 > 100 字节
            result["sub_ok"] = resp.status_code == 200 and len(resp.text) > 100
        except Exception:
            result["sub_ok"] = False

    return result


# ════════════════════════════════════════════════════════════
#  评分计算
# ════════════════════════════════════════════════════════════
def compute_score(airport_id: str) -> float:
    """
    从数据库读取近30天的检测记录，计算可靠性评分（0-100）。
    """
    try:
        # 近30天所有记录
        rows = (
            supabase.table("speed_logs")
            .select("website_ok, website_ms")
            .eq("airport_id", airport_id)
            .gte("checked_at", "now() - interval '30 days'")
            .execute()
            .data
        )

        if not rows:
            return 0.0

        total         = len(rows)
        ok_count      = sum(1 for r in rows if r["website_ok"])
        availability  = ok_count / total  # 0~1

        ms_list       = [r["website_ms"] for r in rows if r["website_ms"] is not None]
        avg_ms        = sum(ms_list) / len(ms_list) if ms_list else 9999

        # 速度得分：响应时间越短越好，< 300ms 满分，> 3000ms 得0分
        speed_score   = max(0.0, 1.0 - (avg_ms - 300) / 2700) if avg_ms > 300 else 1.0

        # 延迟得分（同速度得分，略有不同权重）
        latency_score = speed_score

        # 连续7天无中断（检查最近 7 × 48 = 336 条记录有无连续失败）
        recent7 = rows[-min(336, len(rows)):]
        consistency = 1.0 if all(r["website_ok"] for r in recent7) else 0.7

        score = (
            availability  * SCORE_WEIGHTS["availability_30d"] * 100
          + speed_score   * SCORE_WEIGHTS["speed_score"]      * 100
          + latency_score * SCORE_WEIGHTS["latency_score"]    * 100
          + consistency   * SCORE_WEIGHTS["consistency"]      * 100
        )
        return round(score, 2)

    except Exception as e:
        log.error(f"评分计算失败 {airport_id}: {e}")
        return 0.0


# ════════════════════════════════════════════════════════════
#  主流程
# ════════════════════════════════════════════════════════════
async def main():
    log.info("=" * 60)
    log.info(f"  机场监测开始  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # ── 从数据库读取待监测的机场列表 ────────────────────────
    airports = (
        supabase.table("airports")
        .select("id, name, website_url, sub_url, status")
        .eq("status", "active")
        .execute()
        .data
    )
    log.info(f"共监测 {len(airports)} 个机场")

    if not airports:
        log.warning("没有找到启用的机场，退出。")
        return

    # ── 并发检测 ─────────────────────────────────────────────
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    results   = []

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

    # ── 写入速度日志 ──────────────────────────────────────────
    log_rows = []
    for r in results:
        if isinstance(r, Exception):
            log.error(f"检测任务异常: {r}")
            continue
        log_rows.append(r)

    if log_rows:
        supabase.table("speed_logs").insert(log_rows).execute()
        log.info(f"已写入 {len(log_rows)} 条检测记录")

    # ── 重新计算并更新每个机场评分 ───────────────────────────
    for airport in airports:
        new_score = compute_score(airport["id"])
        supabase.table("airports").update({
            "score":      new_score,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", airport["id"]).execute()
        log.info(f"  📊 {airport['name']:12s}  新评分: {new_score}")

    log.info("=" * 60)
    log.info("  监测完成")
    log.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
