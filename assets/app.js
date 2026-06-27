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
  const SUPABASE_ANON_KEY = 'sb_publishable_ufJ4lt-JiL9ONh5X9X6ZHw_PE58RM1F';

  /* ── DOM 就绪 ─────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    updateStats();
    initTabs();
    initNavbarLinks();

    // 绑定登录按钮跳转到商户控制台
    const loginBtn = document.getElementById('btn-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        window.location.href = 'portal.html';
      });
    }

    // 如果配置了 Supabase，从数据库拉取最新评分并合并到本地数据
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      await syncFromSupabase();
    }

    // 根据当前网页文件名进行路由渲染
    const path = window.location.pathname;
    if (path.includes('all.html') || path.endsWith('/all')) {
      setActiveNavbar('all');
      renderFullList();
    } else if (path.includes('promo.html') || path.endsWith('/promo')) {
      setActiveNavbar('promo');
      renderPromos();
    } else if (path.includes('risk.html') || path.endsWith('/risk')) {
      setActiveNavbar('risk');
      renderRisks();
    } else if (path.includes('method.html') || path.endsWith('/method')) {
      setActiveNavbar('method');
      renderMethods();
    } else {
      setActiveNavbar('today');
      renderSection('today');
    }
  });

  function setActiveNavbar(navId) {
    const navLinks = document.querySelectorAll('.navbar-nav a');
    navLinks.forEach(link => {
      if (link.id === `nav-${navId}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  /* ── 导航栏联动 ─────────────────────────────────────────── */
  function initNavbarLinks() {
    // 允许浏览器正常导航，无需拦截
  }

  function switchTab(catId) {
    const btns = document.querySelectorAll('.tab-btn[data-cat]');
    btns.forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
      if (b.dataset.cat === catId) {
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
      }
    });
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'block';
    renderSection(catId);
  }

  /* ── 从 Supabase 同步最新评分数据 ────────────────────── */
  async function syncFromSupabase() {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/airports?select=id,name,website_url,affiliate_url,tags,tag_colors,highlight,conclusion,price,category,score,score_delta,days_online,status&status=eq.active`,
        {
          headers: {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (!resp.ok) return;
      const rows = await resp.json();

      rows.forEach(row => {
        let local = (window.AIRPORTS_DATA || []).find(a => a.id === row.id);
        if (!local) {
          local = {
            id: row.id,
            name: row.name,
            url: row.affiliate_url || row.website_url,
            tags: row.tags || [],
            tagColors: row.tag_colors || [],
            highlight: row.highlight,
            conclusion: row.conclusion,
            price: row.price,
            category: row.category || ["today"],
            status: row.status,
          };
          window.AIRPORTS_DATA.push(local);
        }
        local.name       = row.name || local.name;
        local.url        = row.affiliate_url || row.website_url || local.url;
        local.tags       = row.tags || local.tags;
        local.tagColors  = row.tag_colors || local.tagColors;
        local.highlight  = row.highlight || local.highlight;
        local.conclusion = row.conclusion || local.conclusion;
        local.price      = row.price || local.price;
        local.category   = row.category || local.category;
        local.score      = (row.score !== null && row.score !== undefined && Number(row.score) !== 0) ? Number(row.score) : (local.score || 75.0);
        local.scoreDelta = row.score_delta || '+0.00';
        local.daysOnline = row.days_online || 0;
        local.status     = row.status;
        local.risk       = row.status === 'risk' || (row.category && row.category.includes('risk')) ? 'high' : null;
      });

      if (window.SITE_STATS) {
        window.SITE_STATS.monitored = rows.length;
      }

      // 更新统计数字
      const stats = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_site_stats`,
        { headers: { 'apikey': SUPABASE_ANON_KEY } }
      ).then(r => r.json()).catch(() => null);

      // 获取最新探测日期
      const latestLog = await fetch(
        `${SUPABASE_URL}/rest/v1/speed_logs?select=checked_at&order=checked_at.desc&limit=1`,
        {
          headers: {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      ).then(r => r.json()).catch(() => null);

      if (latestLog && latestLog.length > 0 && latestLog[0].checked_at) {
        const d = new Date(latestLog[0].checked_at);
        const dUtc = d.getTime() + d.getTimezoneOffset() * 60000;
        const dBeijing = new Date(dUtc + (3600000 * 8));
        const year = dBeijing.getFullYear();
        const month = String(dBeijing.getMonth() + 1).padStart(2, '0');
        const date = String(dBeijing.getDate()).padStart(2, '0');
        if (window.SITE_STATS) {
          window.SITE_STATS.detectDate = `${year}-${month}-${date}`;
        }
      }

      if (stats) {
        if (window.SITE_STATS) {
          window.SITE_STATS.speedTests = stats.total_checks || window.SITE_STATS.speedTests;
          window.SITE_STATS.lastUpdate = stats.last_check_ago || window.SITE_STATS.lastUpdate;
        }
      }
      updateStats(); // 重新渲染数字

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
    const dateEl = document.getElementById('stat-detect-date');
    if (dateEl) dateEl.textContent = stats.detectDate || '--';

    // 动态提示条逻辑
    const noticeContainer = document.getElementById('detect-notice-container');
    const noticeBar = document.getElementById('detect-notice-bar');
    const noticeText = document.getElementById('detect-notice-text');
    if (noticeContainer && noticeText && stats.detectDate) {
      const now = new Date();
      const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
      const beijingTime = new Date(utcTime + (3600000 * 8));
      const todayStr = `${beijingTime.getFullYear()}-${String(beijingTime.getMonth() + 1).padStart(2, '0')}-${String(beijingTime.getDate()).padStart(2, '0')}`;

      if (stats.detectDate !== todayStr) {
        noticeText.textContent = `${todayStr} 的公开分数尚未生成，当前展示 ${stats.detectDate} 的最新已生成快照，非实时探测结果。`;
        if (noticeBar) {
          noticeBar.style.borderColor = '#fcd34d';
          noticeBar.style.backgroundColor = '#fffbeb';
          noticeBar.style.color = '#b45309';
          const svg = noticeBar.querySelector('svg');
          if (svg) {
            svg.style.color = '#d97706';
            svg.innerHTML = '<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />';
          }
        }
      } else {
        noticeText.textContent = `实时监测成功：当前已生成并展示 ${todayStr} 实时测速与可靠性评分，数据每 30 分钟自动更新。`;
        if (noticeBar) {
          noticeBar.style.borderColor = '#bbf7d0';
          noticeBar.style.backgroundColor = '#f0fdf4';
          noticeBar.style.color = '#16a34a';
          const svg = noticeBar.querySelector('svg');
          if (svg) {
            svg.style.color = '#16a34a';
            svg.innerHTML = '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />';
          }
        }
      }
      noticeContainer.style.display = 'block';
    }
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

        // 同步主导航的激活状态
        const navLinks = document.querySelectorAll('.navbar-nav a[data-nav]');
        navLinks.forEach(l => {
          if (l.dataset.nav === 'today') l.classList.add('active');
          else l.classList.remove('active');
        });

        renderSection(btn.dataset.cat);
        const target = document.getElementById('ranking-section');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── 渲染分类机场卡片 ─────────────────────────────────── */
  function renderSection(category) {
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'block';

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

    const cat = (window.CATEGORIES || []).find(c => c.key === category);
    if (cat) {
      const t = document.getElementById('section-title-text');
      const i = document.getElementById('section-icon-text');
      if (t) t.textContent = cat.label + '机场';
      if (i) i.textContent  = cat.icon;
    }

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

  /* ── 渲染：全量榜单 ─────────────────────────────────────── */
  function renderFullList() {
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'none';

    const grid = document.getElementById('cards-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const t = document.getElementById('section-title-text');
    const i = document.getElementById('section-icon-text');
    if (t) t.textContent = '全量机场测评榜单';
    if (i) i.textContent  = '';

    const airports = [...(window.AIRPORTS_DATA || [])];
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

  /* ── 渲染：活动优惠 ─────────────────────────────────────── */
  /* ── 渲染：活动优惠 ─────────────────────────────────────── */
  async function renderPromos() {
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'none';

    const grid = document.getElementById('cards-grid');
    if (!grid) return;

    const t = document.getElementById('section-title-text');
    const i = document.getElementById('section-icon-text');
    if (t) t.textContent = '限时折扣与机场优惠券';
    if (i) i.textContent  = '';

    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:40px;">正在获取最新特惠活动...</div>';

    // 辅助防 XSS 函数
    function escHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    let dbPromos = [];
    try {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/promotions?select=*,airports(name)&status=eq.active&order=created_at.desc`,
          {
            headers: {
              'apikey':        SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            }
          }
        );
        if (resp.ok) {
          const rawData = await resp.json();
          if (Array.isArray(rawData)) {
            dbPromos = rawData.filter(item => {
              if (!item || !item.expires_at) return false;
              try {
                const exp = new Date(item.expires_at);
                return !isNaN(exp.getTime()) && exp >= new Date();
              } catch (e) {
                return false;
              }
            });
          }
        }
      }
    } catch (e) {
      console.warn('[JCT] 拉取动态优惠失败，将降级使用本地预设优惠', e);
    }

    // Always render exactly 6 slots in the deals grid.
    let html = '<div class="promo-list" style="grid-column: 1 / -1;">';
    for (let index = 0; index < 6; index++) {
      if (index < dbPromos.length) {
        const item = dbPromos[index];
        // 容错机制：尝试从 airports 字段中取 name；如果为空，则使用本地 window.AIRPORTS_DATA 对齐或机场 id
        let airportName = '';
        if (item.airports && item.airports.name) {
          airportName = item.airports.name;
        }
        if (!airportName) {
          const local = (window.AIRPORTS_DATA || []).find(a => a.id === item.airport_id);
          if (local && local.name) {
            airportName = local.name;
          }
        }
        if (!airportName) {
          airportName = item.airport_id || '合作商户';
        }

        const pctBadge = item.discount_pct > 0 ? `${(10 - (item.discount_pct / 10)).toFixed(1)}折特惠` : '优惠活动';
        const codeEsc = escHtml(item.promo_code);
        html += `
          <div class="promo-card">
            <span class="promo-badge">${escHtml(pctBadge)}</span>
            <div class="promo-airport-name">${escHtml(airportName)}</div>
            <div class="promo-title">${escHtml(item.title)}</div>
            <div class="promo-code-wrap">
              <span class="promo-code">${codeEsc}</span>
              <button class="promo-copy-btn" onclick="navigator.clipboard.writeText('${codeEsc}').then(() => alert('折扣码已复制！'))">复制</button>
            </div>
            <p class="promo-desc">${escHtml(item.description)}</p>
            <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:12px; display:flex; justify-content:space-between; border-top: 1px dashed var(--color-border); padding-top:10px;">
              <span>适用套餐: ${escHtml(item.packages || '全部套餐')}</span>
              <span>有效期至: ${new Date(item.expires_at).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="promo-card empty-promo-card">
            <div class="empty-promo-title" style="margin-top: 8px;">虚位以待</div>
            <p style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 8px; line-height: 1.5;">
              该广告位空闲中<br/>商户可在控制台自助投放广告上架
            </p>
          </div>
        `;
      }
    }
    html += '</div>';
    grid.innerHTML = html;
  }

  /* ── 渲染：跑路预警 ─────────────────────────────────────── */
  function renderRisks() {
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'none';

    const grid = document.getElementById('cards-grid');
    if (!grid) return;

    const t = document.getElementById('section-title-text');
    const i = document.getElementById('section-icon-text');
    if (t) t.textContent = '异常与跑路预警通报';
    if (i) i.textContent  = '';

    grid.innerHTML = `
      <div class="warning-log-list" style="grid-column: 1 / -1; width: 100%;">
        <div class="warning-log-card">
          <div class="warning-log-left">
            <span class="warning-status-badge">失联确认</span>
            <div class="warning-airport-info">
              <h4>闪电机场 (Shandian VPN)</h4>
              <p>官方网站失联超过 72 小时，订阅节点全部超时，疑似跑路，请勿继续充值订阅！</p>
            </div>
          </div>
          <div class="warning-log-right">
            <div class="warning-time">发布时间: 2026/06/15</div>
            <a href="#" class="warning-detail-btn" onclick="alert('该机场域名已被停止解析，TG官方群已解散。确认跑路。')">查看失联报告</a>
          </div>
        </div>

        <div class="warning-log-card" style="background:#FFFBEB; border-color:#FDE68A;">
          <div class="warning-log-left">
            <span class="warning-status-badge" style="background:#D97706;">节点故障</span>
            <div class="warning-airport-info" style="color:#92400E;">
              <h4>极客网络 (Geek Net)</h4>
              <p>大范围中转节点发生故障，延迟陡增，商家声称正在抢修，建议密切关注稳定性变化。</p>
            </div>
          </div>
          <div class="warning-log-right" style="color:#92400E;">
            <div class="warning-time">发布时间: 2026/06/22</div>
            <a href="#" class="warning-detail-btn" style="color:#78350F;" onclick="alert('监测到其广州、上海入口发生阻断，当前依靠直连备用节点，速度大幅下降。')">查看故障详情</a>
          </div>
        </div>

        <div class="warning-log-card">
          <div class="warning-log-left">
            <span class="warning-status-badge">停止运营</span>
            <div class="warning-airport-info">
              <h4>飞天梯 (Feitian)</h4>
              <p>商家发布官方公告，由于不可抗力即日起停止运营，承诺将在 7 个工作日内清算退款。</p>
            </div>
          </div>
          <div class="warning-log-right">
            <div class="warning-time">发布时间: 2026/05/28</div>
            <a href="#" class="warning-detail-btn" onclick="alert('官方退款通道已开启，请符合条件的商家及时申请退款。')">查看清算公告</a>
          </div>
        </div>
      </div>
    `;
  }

  /* ── 渲染：测评方法 ─────────────────────────────────────── */
  function renderMethods() {
    const tabsContainer = document.getElementById('category-tabs');
    if (tabsContainer) tabsContainer.style.display = 'none';

    const grid = document.getElementById('cards-grid');
    if (!grid) return;

    const t = document.getElementById('section-title-text');
    const i = document.getElementById('section-icon-text');
    if (t) t.textContent = '科学上网机场测评方法与评分标准说明';
    if (i) i.textContent  = '';

    grid.innerHTML = `
      <div class="method-container" style="grid-column: 1 / -1; width: 100%;">
        <p class="method-intro-text">
          本站致力于建立一个公正、公开、透明的机场可靠性排名平台。所有的排名数据都来自于部署于不同云厂商的多节点自动化测试脚本。
          为了评估一个机场的“可靠性分值”，我们采用多维度的计算权重。
        </p>

        <div class="method-grid">
          <div class="method-step">
            <h4>全天候可用性监测</h4>
            <p>每隔30分钟，监测脚本从美国、新加坡、日本、中国香港等4个机房节点，向机场官网及订阅地址发起探测。</p>
          </div>
          <div class="method-step">
            <h4>订阅可用率 (50%)</h4>
            <p>评估订阅内容获取是否顺畅。如果订阅解析接口频繁超时或返回空配置，将会导致分值严重下滑。</p>
          </div>
          <div class="method-step">
            <h4>官网可用率 (30%)</h4>
            <p>官网是用户充值、找回密码、更换配置的唯一通道，官网的可用性与是否被污染直接影响最终评分。</p>
          </div>
          <div class="method-step">
            <h4>运营天数与信誉 (20%)</h4>
            <p>老牌机场拥有更丰富的运营经验 and 冗余带宽，新机场在初期会获得新秀分值保护，但高风险机场会被扣减分值。</p>
          </div>
        </div>

        <table class="method-table">
          <thead>
            <tr>
              <th>考核维度</th>
              <th>评测细节</th>
              <th>扣分规则</th>
              <th>加分规则</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>订阅可用率</strong></td>
              <td>Clash订阅内容拉取测试，响应时间需在 2.5s 内</td>
              <td>获取超时或返回500报错扣5-10分</td>
              <td>持续 7 天 100% 成功率加2分</td>
            </tr>
            <tr>
              <td><strong>官网可用率</strong></td>
              <td>官网域名在不同运营商下的延迟、解析成功率</td>
              <td>国内大面积DNS污染或拦截扣3-5分</td>
              <td>提供防污染多活域名保护加1分</td>
            </tr>
            <tr>
              <td><strong>防跑路系数</strong></td>
              <td>商家背景调查、是否退款保障、TG社群活跃度</td>
              <td>社群关闭/商家断联直接扣 50 分并拉入异常警报</td>
              <td>有退款保障、大站信用背书加5分</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
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
      window.location.href = `report.html?id=${airportId}`;
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
            amount:     0.50,
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
