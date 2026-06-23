-- ============================================================
--  jctuijian.com — Supabase 数据库初始化 SQL
--  在 Supabase Dashboard → SQL Editor 中执行
--  ⚠️ 此文件含私密订阅链接，请勿上传至公开 GitHub 仓库
-- ============================================================

-- ── 1. 机场信息主表 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS airports (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  website_url     TEXT NOT NULL,
  affiliate_url   TEXT NOT NULL,
  sub_url         TEXT,                    -- 🔒 私密订阅链接，仅用于后台监测
  status          TEXT DEFAULT 'active',   -- active / pending / paused / banned

  -- 展示信息
  tags            JSONB DEFAULT '[]',
  tag_colors      JSONB DEFAULT '[]',
  highlight       TEXT,
  conclusion      TEXT,
  price           TEXT,

  -- 评分（由监测脚本自动更新）
  score           NUMERIC(5,2) DEFAULT 0,
  score_delta     TEXT DEFAULT '+0.00',    -- 与昨日评分的差值字符串
  days_online     INTEGER DEFAULT 0,
  category        JSONB DEFAULT '["today"]',

  -- CPC 商家信息
  balance         NUMERIC(10,2) DEFAULT 0,
  bid_price       NUMERIC(5,2) DEFAULT 0.60,
  merchant_email  TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. 监测日志表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS speed_logs (
  id           BIGSERIAL PRIMARY KEY,
  airport_id   TEXT REFERENCES airports(id) ON DELETE CASCADE,
  checked_at   TIMESTAMPTZ DEFAULT NOW(),
  website_ok   BOOLEAN DEFAULT FALSE,
  website_ms   NUMERIC(8,1),
  sub_ok       BOOLEAN,
  http_status  INTEGER,
  error        TEXT
);

-- ── 3. 点击计费日志表 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS click_logs (
  id          BIGSERIAL PRIMARY KEY,
  airport_id  TEXT REFERENCES airports(id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ DEFAULT NOW(),
  ip_hash     TEXT,
  ua_snippet  TEXT,
  from_page   TEXT,
  charged     BOOLEAN DEFAULT TRUE,
  amount      NUMERIC(5,2) DEFAULT 0.60
);

-- ── 4. 入驻申请表 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id             BIGSERIAL PRIMARY KEY,
  airport_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  contact_tg     TEXT,
  website_url    TEXT NOT NULL,
  affiliate_url  TEXT,
  sub_url        TEXT,
  price_info     TEXT,
  tag            TEXT,
  description    TEXT,
  bid_price      NUMERIC(5,2) DEFAULT 0.60,
  status         TEXT DEFAULT 'pending',   -- pending / approved / rejected
  admin_note     TEXT,
  applied_at     TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ
);

-- ── 索引 ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_speed_logs_airport_time
  ON speed_logs (airport_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_click_logs_airport_time
  ON click_logs (airport_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_airports_score
  ON airports (score DESC);

-- ── RLS 安全策略 ──────────────────────────────────────────
ALTER TABLE airports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE speed_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE click_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- 先删除旧策略（避免重复运行报错）
DROP POLICY IF EXISTS "anon read airports"        ON airports;
DROP POLICY IF EXISTS "anon read speed_logs"      ON speed_logs;
DROP POLICY IF EXISTS "anon insert applications"  ON applications;
DROP POLICY IF EXISTS "service all airports"      ON airports;
DROP POLICY IF EXISTS "service all speed_logs"    ON speed_logs;
DROP POLICY IF EXISTS "service all click_logs"    ON click_logs;
DROP POLICY IF EXISTS "service all applications"  ON applications;

-- 匿名用户可读机场基本信息（不含 sub_url / merchant 字段）
CREATE POLICY "anon read airports"
  ON airports FOR SELECT TO anon
  USING (status IN ('active', 'pending'));

CREATE POLICY "anon read speed_logs"
  ON speed_logs FOR SELECT TO anon USING (TRUE);

CREATE POLICY "anon insert applications"
  ON applications FOR INSERT TO anon WITH CHECK (TRUE);

-- service_role 可以做任何操作（监测脚本用）
CREATE POLICY "service all airports"     ON airports     FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service all speed_logs"   ON speed_logs   FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service all click_logs"   ON click_logs   FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service all applications" ON applications FOR ALL TO service_role USING (TRUE);

-- ── 站点统计辅助函数（供前端直接调用）────────────────────
CREATE OR REPLACE FUNCTION get_site_stats()
RETURNS TABLE(total_checks BIGINT, last_check_ago TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    CASE
      WHEN MAX(checked_at) IS NULL THEN '从未检测'
      WHEN NOW() - MAX(checked_at) < INTERVAL '1 hour'
        THEN EXTRACT(MINUTE FROM NOW() - MAX(checked_at))::TEXT || ' 分钟前'
      ELSE EXTRACT(HOUR FROM NOW() - MAX(checked_at))::TEXT || ' 小时前'
    END
  FROM speed_logs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 初始数据（4个已入驻机场）─────────────────────────────
INSERT INTO airports (
  id, name, website_url, affiliate_url, sub_url,
  status, tags, tag_colors, highlight, conclusion, price,
  score, score_delta, days_online, category, bid_price
) VALUES

-- ✅ 极连云
(
  'jilian', '极连云',
  'https://vip.jilianclou.com',
  'https://haozevpn.jlyvipaff.com/#/?code=KUKfOY13',
  'https://sub04.jilian09.cc/api/v1/client/subscribe?token=a790239c914de136f7a64f9c08437410&flag=clash-meta',
  'active',
  '["晚高峰稳定","IEPL专线","解锁流媒体"]',
  '["blue","green","purple"]',
  '稳定不跑路',
  '亮点：海外实体团队专业运维，技术实力强，适合长期订阅。月付低至 ¥8 起。',
  '¥8/月起',
  88.50, '+0.00', 0,
  '["today","stable","value"]',
  0.60
),

-- ✅ 瞬云
(
  'shun', '瞬云',
  'https://ccc.jichang.best/',
  'https://ccc.jichang.best/#/register?code=o4I4kToe',
  'https://noboom.syjccloud.com/api/v1/client/subscribe?token=d0bf43d60274b2f91da8980a6bd64223',
  'active',
  '["直连中转","不掉速","无倍率"]',
  '["blue","green","yellow"]',
  '高速节点',
  '亮点：主流国家 ANYCAST 高速节点，直连中转双线路，月付低至 ¥7 起。',
  '¥7/月起',
  85.20, '+0.00', 0,
  '["today","value"]',
  0.60
),

-- ✅ 边界云
(
  'bianjie', '边界云',
  'https://www.lvpn.cc',
  'https://www.lvpn.cc/r/6UQDZT',
  'https://sub.yvpn.cc/subscribe/d1ff7b43-5ed5-4323-a54e-de86d5ab74c1?format=clash_meta',
  'active',
  '["IEPL优化线路","流媒体支持","支持UDP"]',
  '["green","purple","orange"]',
  '专属线路',
  '亮点：专属 IEPL 优化线路，支持主流流媒体及 UDP，线路质量稳定，¥15/月起。',
  '¥15/月起',
  82.80, '+0.00', 0,
  '["today","stable"]',
  0.60
),

-- ✅ 寰宇云
(
  'huanyu', '寰宇云',
  'https://dashboard.huanyuyunvip.com',
  'https://vip3.huanyuyunbest.com/#/register?code=K6h5VWw2',
  'https://noban.huanyuyunvip.com/api/v1/client/subscribe?token=6c7f0b421ab491688427d15007f51443',
  'active',
  '["晚高峰稳定","AnyTLS","解锁流媒体"]',
  '["blue","dark","purple"]',
  '稳定好用',
  '亮点：稳定可靠的老牌机场，支持 AnyTLS 协议，流媒体解锁全面，¥18/月起。',
  '¥18/月起',
  81.30, '+0.00', 0,
  '["today","stable"]',
  0.60
),

-- 🔜 光年梯（待入驻）
('guangnian','光年梯','#','#', NULL,'pending','["资料审核中"]','["blue"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60),

-- 🔜 影子VPN（待入驻）
('yingzi','影子VPN','#','#', NULL,'pending','["资料审核中"]','["dark"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60),

-- 🔜 山水云（待入驻）
('shanshui','山水云','#','#', NULL,'pending','["资料审核中"]','["blue"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60),

-- 🔜 秒秒云（待入驻）
('miaomiao','秒秒云','#','#', NULL,'pending','["资料审核中"]','["green"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60),

-- 🔜 锦云（待入驻）
('jinyun','锦云','#','#', NULL,'pending','["资料审核中"]','["orange"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60),

-- 🔜 99吧（待入驻）
('jiuba','99吧','#','#', NULL,'pending','["资料审核中"]','["red"]','即将上线','资料审核中，即将完成入驻。','--',0,'+0.00',0,'["new"]',0.60)

ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  website_url   = EXCLUDED.website_url,
  affiliate_url = EXCLUDED.affiliate_url,
  sub_url       = EXCLUDED.sub_url,
  status        = EXCLUDED.status,
  tags          = EXCLUDED.tags,
  tag_colors    = EXCLUDED.tag_colors,
  highlight     = EXCLUDED.highlight,
  conclusion    = EXCLUDED.conclusion,
  price         = EXCLUDED.price,
  category      = EXCLUDED.category,
  updated_at    = NOW();
