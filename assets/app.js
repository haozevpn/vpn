/* ============================================================
   jctuijian.com — 交互逻辑
   包含：Tab切换、卡片渲染（支持 pending 占位）、CPC点击追踪、防刷保护
   可选：从 Supabase 实时拉取评分（配置后自动切换）
   ============================================================ */

(function () {
  'use strict';

  /* ── 配置 ─────────────────────────────────────────────── */
  const CLICK_COOLDOWN_MS  = 5 * 60 * 1000; // 5分钟防刷冷却
  const REDIRECT_PAGE      = 'redirect.html';

  // Supabase 实时数据
  const SUPABASE_URL      = 'https://jsdvhryfmuadxaijmsjb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_ufJ4lt-JiLS0Nh5X9X6ZHw_PE58RM1F';

  /* ── DOM 就绪 ─────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    updateStats();
    initTabs();

    // 如果配置了 Supabase，从数据库拉取最新评分并合并到本地数据
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      await syncFromSupabase();
    }

    renderSection('today');
  });

  /* ── 从 Supabase 同步最新评分数据 ────────────────────── */
  async function syncFromSupabase() {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/airports?select=id,score,score_delta,days_online,status&status=eq.active`,
        {
          headers: {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (!resp.ok) return;
      const rows = await resp.json();

      // 用数据库中的最新评分覆盖本地静态数据
      rows.forEach(row => {
        const local = (window.AIRPORTS_DATA || []).find(a => a.id === row.id);
        if (local) {
          local.score      = row.score;
          local.scoreDelta = row.score_delta || '+0.00';
          local.daysOnline = row.days_online || local.daysOnline;
          local.status     = row.status;
        }
      });

      // 更新统计数字
      const stats = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_site_stats`,
        { headers: { 'apikey': SUPABASE_ANON_KEY } }
      ).then(r => r.json()).catch(() => null);

      if (stats) {
        if (window.SITE_STATS) {
          window.SITE_STATS.speedTests = stats.total_checks || window.SITE_STATS.speedTests;
          window.SITE_STATS.lastUpdate = stats.last_check_ago || window.SITE_STATS.lastUpdate;
        }
        updateStats(); // 重新渲染数字
      }

      console.info('[JCT] 已从 Supabase 同步最新评分数据');
    } catch (e) {
      console.warn('[JCT] Supabase 同步失败，使用静态数据', e);
    }
  }

  /* ── 统计数字动画 ─────────────────────────────────────── */
  function updateStats() {
    const stats = window.SITE_STATS || {};
    animateNumber('stat-monitored', stats.monitored || 0);
    animateNumber('stat-speedtests', stats.speedTests || 0);
    const el = document.getElementById('stat-update');
    if (el) el.textContent = stats.lastUpdate || '--';
    const el2 = document.getElementById('stat-update-2');
    if (el2) el2.textContent = stats.lastUpdate || '--';
  }

  function animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 1200;
    const start    = performance.now();
    function step(now) {
      const p = Math.min((now - start) / duration, 1);
      const v = Math.floor((1 - Math.pow(1 - p, 3)) * target);
      el.textContent = v.toLocaleString('zh-CN');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── Tab 切换 ─────────────────────────────────────────── */
  function initTabs() {
    const btns = document.querySelectorAll('.tab-btn[data-cat]');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        renderSection(btn.dataset.cat);
        const target = document.getElementById('ranking-section');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── 渲染机场卡片 ─────────────────────────────────────── */
  function renderSection(category) {
    const grid = document.getElementById('cards-grid');
    if (!grid) return;

    const all      = window.AIRPORTS_DATA || [];
    const airports = all.filter(a => a.category && a.category.includes(category));

    grid.innerHTML = '';

    if (!airports.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <span class="icon">📭</span>
        <p>该分类暂无数据，敬请期待。</p>
      </div>`;
      return;
    }

    // 更新 section 标题
    const cat = (window.CATEGORIES || []).find(c => c.key === category);
    if (cat) {
      const t = document.getElementById('section-title-text');
      const i = document.getElementById('section-icon-text');
      if (t) t.textContent = cat.label + '机场';
      if (i) i.textContent  = cat.icon;
    }

    // 按评分排序：有评分的排前面，pending 排后面
    airports.sort((a, b) => {
      if (a.score === null && b.score !== null) return 1;
      if (a.score !== null && b.score === null) return -1;
      return (b.score || 0) - (a.score || 0);
    });

    airports.forEach((airport, idx) => {
      const card = airport.status === 'pending'
        ? buildPendingCard(airport, idx)
        : buildCard(airport, idx);
      grid.appendChild(card);
    });
  }

  /* ── 构建正式排名卡片 ─────────────────────────────────── */
  function buildCard(airport, idx) {
    const isRisk     = airport.risk === 'high';
    const scoreNum   = parseFloat(airport.score || 0);
    const scoreClass = scoreNum >= 80 ? 'high' : scoreNum >= 60 ? 'mid' : 'low';
    const deltaDown  = String(airport.scoreDelta || '').startsWith('-');
    const colorMap   = window.TAG_COLOR_MAP || {};

    const tagsHtml = (airport.tags || []).map((tag, i) => {
      const key = (airport.tagColors || [])[i] || 'blue';
      const c   = colorMap[key] || colorMap['blue'];
      return `<span class="card-tag" style="background:${c.bg};color:${c.text};border-color:${c.border};">${escHtml(tag)}</span>`;
    }).join('');

    const conclusion = (airport.conclusion || '')
      .replace(/亮点：/g, '<strong>亮点：</strong>')
      .replace(/警告：/g, '<strong style="color:#EF4444">警告：</strong>');

    const article = document.createElement('article');
    article.className = `airport-card${isRisk ? ' risk-card' : ''}`;
    article.setAttribute('data-id', airport.id);

    const daysText   = airport.daysOnline > 0 ? `${airport.daysOnline} 天` : '监测中';
    const priceText  = airport.price || '--';

    article.innerHTML = `
      <div style="position:absolute;top:14px;left:18px;font-size:.68rem;font-weight:700;
           color:var(--color-text-muted);letter-spacing:.04em;">No.${idx + 1}</div>

      <div class="card-header" style="padding-top:14px;">
        <div>
          <div class="card-name">${escHtml(airport.name)}</div>
          <div style="font-size:.72rem;color:var(--color-text-muted);margin-top:2px;">月付 ${priceText}</div>
        </div>
        <div class="card-score-wrap">
          <span class="card-score-label">可靠性评分</span>
          <span class="card-score ${scoreClass}" id="score-${airport.id}">${airport.score}</span>
          <span class="card-delta ${deltaDown ? 'down' : ''}">对比昨天 ${escHtml(airport.scoreDelta || '--')}</span>
        </div>
      </div>

      <div class="card-tags">${tagsHtml}</div>

      <div class="card-meta">
        <div class="meta-item">
          <div class="meta-label">运行天数</div>
          <div class="meta-value">${daysText}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">核心亮点</div>
          <div class="meta-value">${escHtml(airport.highlight || '--')}</div>
        </div>
      </div>

      <div class="card-conclusion">监测结论：${conclusion}</div>

      <div class="card-actions">
        <button class="btn-report"
          onclick="window.JCT.goReport('${airport.id}')">
          查看报告 →
        </button>
        <button class="btn-official" id="btn-official-${airport.id}"
          onclick="window.JCT.goOfficial(event,'${airport.id}','${encodeURIComponent(airport.url)}')">
          官网 <span class="btn-official-icon">↗</span>
        </button>
      </div>
    `;
    return article;
  }

  /* ── 构建 pending 占位卡片 ────────────────────────────── */
  function buildPendingCard(airport) {
    const colorMap = window.TAG_COLOR_MAP || {};
    const key = (airport.tagColors || ['blue'])[0];
    const c   = colorMap[key] || colorMap['blue'];

    const article = document.createElement('article');
    article.className = 'airport-card';
    article.style.cssText = 'opacity:.65;border-style:dashed;';
    article.setAttribute('data-id', airport.id);
    article.innerHTML = `
      <div style="text-align:center;padding:28px 16px;">
        <div style="font-size:1.8rem;margin-bottom:10px;">🔜</div>
        <div style="font-family:var(--font-display);font-size:1rem;font-weight:700;
                    color:var(--color-text-primary);margin-bottom:6px;">
          ${escHtml(airport.name)}
        </div>
        <span class="card-tag" style="background:${c.bg};color:${c.text};border-color:${c.border};">
          资料审核中
        </span>
        <p style="font-size:.78rem;color:var(--color-text-muted);margin-top:12px;line-height:1.5;">
          即将完成入驻，<br/>监测数据即将上线
        </p>
      </div>
    `;
    return article;
  }

  /* ── CPC 点击追踪（核心逻辑）─────────────────────────── */
  window.JCT = {
    goOfficial(event, airportId, encodedUrl) {
      event.preventDefault();

      const now    = Date.now();
      const key    = `jct_click_${airportId}`;
      const last   = parseInt(localStorage.getItem(key) || '0', 10);
      const isCold = (now - last) > CLICK_COOLDOWN_MS;

      if (isCold) {
        JCT._reportClick(airportId, 'official_btn');
        localStorage.setItem(key, now);
      }

      const redirectUrl = `${REDIRECT_PAGE}?id=${airportId}&url=${encodedUrl}&from=home_card&charged=${isCold ? 1 : 0}`;
      window.open(redirectUrl, '_blank', 'noopener,noreferrer');
    },

    goReport(airportId) {
      // 跳转内部详情页（后续开发）
      alert(`【${airportId}】详细测评报告页面正在开发中，即将上线！`);
      // window.location.href = `/airports/${airportId}/`;
    },

    _reportClick(airportId, from) {
      const payload = {
        airport_id: airportId,
        from,
        ts:       Date.now(),
        ua:       navigator.userAgent.substring(0, 120),
        referrer: document.referrer || 'direct',
      };
      console.info('[JCT Click]', payload);

      // 上报点击到 Supabase（已启用）
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/click_logs`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':         SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify({
            airport_id: airportId,
            from_page:  from,
            charged:    true,
            amount:     0.60,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    },
  };

  /* ── 工具函数 ─────────────────────────────────────────── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
