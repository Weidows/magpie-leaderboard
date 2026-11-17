(function () {
  'use strict';

  const AA = window.AA_DATA;
  const H = window.HARNESS_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  if (!AA || !H) {
    document.body.innerHTML =
      '<div style="padding:48px;font:14px/1.6 system-ui;color:#7b7468">数据快照缺失。请先运行 <code>npm run sync</code> 生成 <code>page/data-aa.js</code> 与 <code>page/data-harness.js</code>。</div>';
    return;
  }

  // `magpie.ready` is a promise the host settles once it has answered with the
  // window theme. Opened directly in a browser there is no bridge, and a host
  // that never answers must not leave the page blank.
  const hostReady = (() => {
    const bridge = globalThis.magpie;
    if (!bridge) return Promise.resolve(null);
    let readiness;
    try {
      readiness = Promise.resolve(bridge.ready).catch(() => null);
    } catch {
      readiness = Promise.resolve(null);
    }
    return Promise.race([
      readiness,
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
  })();

  const state = {
    view: 'overview',
    theme: 'system',
    hostDark: null,
    query: '',
    scope: 'all',
    creator: 'all',
    sort: 'intelligence',
    agentModel: H.models[0]?.id ?? null,
    scatterMetric: 'price',
    scatterScope: 'all',
  };

  let preferencesTouched = false;
  let lastFocused = null;

  /* ------------------------------------------------------------------ */
  /* formatting                                                          */
  /* ------------------------------------------------------------------ */

  const ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
  }

  function num(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toFixed(digits).replace(/\.0+$/, '');
  }

  function integer(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Math.round(Number(value)).toLocaleString('en-US');
  }

  function pct(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(1)}%`;
  }

  function money(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    if (number === 0) return '$0';
    if (number >= 100) return `$${number.toFixed(0)}`;
    const fixed = number.toFixed(number < 0.1 ? Math.max(digits + 1, 3) : digits);
    return `$${fixed.replace(/0+$/, '').replace(/\.$/, '')}`;
  }

  function price(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    if (number >= 100) return `$${number.toFixed(0)}`;
    if (number >= 10) return `$${number.toFixed(1).replace(/\.0$/, '')}`;
    if (number >= 1) return `$${number.toFixed(2).replace(/0$/, '')}`;
    if (number >= 0.1) return `$${number.toFixed(2)}`;
    return `$${number.toFixed(3)}`;
  }

  function context(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    if (number >= 1_000_000) return `${num(number / 1_000_000, 1)}M`;
    if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
    return String(number);
  }

  function duration(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
    const value = Number(seconds);
    if (value < 90) return `${Math.round(value)}s`;
    return `${(value / 60).toFixed(1)}m`;
  }

  function barWidth(value, max) {
    if (value == null || !Number.isFinite(Number(value))) return 0;
    return Math.max(0, Math.min(100, (Number(value) / max) * 100));
  }

  function creatorColor(model) {
    const color = model.color || 'var(--accent)';
    if (document.documentElement.dataset.lbTheme !== 'dark') return color;
    const match = String(color).match(/^#([0-9a-f]{6})$/i);
    if (!match) return color;
    const value = Number.parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luminance >= 0.28) return color;
    const lift = 0.52;
    const mix = (channel) => Math.round(channel + (255 - channel) * lift);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  function harnessById(id) {
    return H.harnesses.find((item) => item.id === id);
  }

  function modelById(id) {
    return H.models.find((item) => item.id === id);
  }

  /* ------------------------------------------------------------------ */
  /* theme                                                               */
  /* ------------------------------------------------------------------ */

  function systemDark() {
    if (typeof state.hostDark === 'boolean') return state.hostDark;
    if (globalThis.magpie?.theme && typeof globalThis.magpie.theme.dark === 'boolean') {
      return globalThis.magpie.theme.dark;
    }
    return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  }

  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'system' && systemDark());
    document.documentElement.dataset.lbTheme = dark ? 'dark' : 'light';
    const button = $('#theme-toggle');
    if (button) {
      button.title =
        state.theme === 'system' ? '跟随系统' : state.theme === 'dark' ? '深色' : '浅色';
      button.setAttribute(
        'aria-label',
        `当前${state.theme === 'system' ? '跟随系统' : state.theme === 'dark' ? '深色' : '浅色'}，点击切换`,
      );
    }
  }

  async function loadPreferences() {
    try {
      const stored = await globalThis.magpie?.options?.get?.();
      if (
        !preferencesTouched &&
        (stored?.theme === 'light' || stored?.theme === 'dark' || stored?.theme === 'system')
      ) {
        state.theme = stored.theme;
        applyTheme();
        refreshForTheme();
        return;
      }
    } catch {
      // Fall back to browser storage.
    }
    // No host options (page opened directly in a browser): use local storage.
    try {
      const local = globalThis.localStorage?.getItem('magpie-leaderboard');
      if (!local || preferencesTouched) return;
      const parsed = JSON.parse(local);
      if (parsed?.theme === 'light' || parsed?.theme === 'dark' || parsed?.theme === 'system') {
        state.theme = parsed.theme;
        applyTheme();
        refreshForTheme();
      }
    } catch {
      // Sandbox pages can throw SecurityError for localStorage.
    }
  }

  function savePreferences() {
    preferencesTouched = true;
    try {
      globalThis.magpie?.options?.set?.({ theme: state.theme });
    } catch {
      // Ignore host option failures.
    }
    try {
      globalThis.localStorage?.setItem('magpie-leaderboard', JSON.stringify({ theme: state.theme }));
    } catch {
      // Ignore sandbox storage failures.
    }
  }

  function cycleTheme() {
    const dark = document.documentElement.dataset.lbTheme === 'dark';
    state.theme = dark ? 'light' : 'dark';
    applyTheme();
    savePreferences();
    refreshForTheme();
  }

  function refreshForTheme() {
    applyTheme();
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'models') renderModels();
    else renderAgents();
  }

  /* ------------------------------------------------------------------ */
  /* navigation                                                          */
  /* ------------------------------------------------------------------ */

  function setView(view, { scroll = true } = {}) {
    if (!['overview', 'models', 'agents'].includes(view)) return;
    state.view = view;
    $$('.view').forEach((element) => {
      const active = element.id === `view-${view}`;
      element.hidden = !active;
      element.classList.toggle('is-active', active);
    });
    $$('.tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    if (view === 'models') renderModels();
    if (view === 'agents') renderAgents();
    try {
      const next = view === 'overview' ? '#overview' : `#${view}`;
      if (globalThis.location.hash !== next) {
        globalThis.history?.replaceState?.(null, '', next);
      }
    } catch {
      // History can be restricted in an opaque sandbox.
    }
    if (scroll) globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ */
  /* overview                                                            */
  /* ------------------------------------------------------------------ */

  function renderOverview() {
    const topModel = AA.models[0];
    const topOpen = AA.models.find((model) => model.open);
    const bestRateRow = H.rows.reduce(
      (best, row) =>
        row.rate != null && (!best || row.rate > best.rate) ? row : best,
      null,
    );
    const bestRateModel = bestRateRow ? modelById(bestRateRow.model) : null;
    const bestRateHarness = bestRateRow ? harnessById(bestRateRow.harness) : null;
    const topHarness = H.harnesses[0];
    const openShare = Math.round((AA.openCount / AA.total) * 100);

    const topRows = AA.models
      .slice(0, 12)
      .map((model) => {
        const width = barWidth(model.intelligence, 70);
        return `
          <button class="rank-row" type="button" data-model="${esc(model.slug)}">
            <span class="rank-no">${String(model.rank).padStart(2, '0')}</span>
            <span class="rank-name">
              <strong>${esc(model.name)}${model.variant ? ` <span class="badge">${esc(model.variant)}</span>` : ''}</strong>
              <small>${esc(model.creator)} · ${model.open ? '开源权重' : '闭源'}</small>
            </span>
            <span class="rank-bar"><i style="width:${width}%;background:${esc(creatorColor(model))}"></i></span>
            <span class="rank-score">${num(model.intelligence)}</span>
          </button>`;
      })
      .join('');

    const openRows = AA.models
      .filter((model) => model.open)
      .slice(0, 12)
      .map(
        (model) => `
          <div class="open-row">
            <span>${esc(model.name)}</span>
            <span class="mini-track"><i style="width:${barWidth(model.intelligence, 70)}%;background:${esc(creatorColor(model))}"></i></span>
            <span class="score">${num(model.intelligence)}</span>
          </div>`,
      )
      .join('');

    const agentColumns = H.models
      .map((model) => {
        const rows = H.rows
          .filter((row) => row.model === model.id)
          .sort((a, b) => (a.overallRank ?? 99) - (b.overallRank ?? 99) || b.overall - a.overall)
          .slice(0, 3);
        const harness = harnessById(model.bestHarness);
        const rateHarness = harnessById(model.bestRateHarness);
        return `
          <button class="agent-column" type="button" data-agent-jump="${esc(model.id)}">
            <div class="agent-column-head">
              <strong>${esc(model.name)}</strong>
              <span>${num(model.bestOverall)}</span>
            </div>
            <p class="agent-column-sub">综合最佳 ${esc(harness?.name ?? '—')} · 最高通过率 ${pct(model.bestRate)}${rateHarness && rateHarness.id !== harness?.id ? `（${esc(rateHarness.name)}）` : ''}</p>
            ${rows
              .map(
                (row, index) => `
                <div class="mini-agent-row">
                  <span class="pos">${index + 1}</span>
                  <span class="nm"><i style="background:${esc(harnessById(row.harness)?.color ?? 'var(--muted)')}"></i><span>${esc(harnessById(row.harness)?.name ?? row.harness)}</span></span>
                  <span class="val">${num(row.overall)}</span>
                </div>`,
              )
              .join('')}
          </button>`;
      })
      .join('');

    $('#view-overview').innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <p class="hero-kicker">Artificial Analysis × Harness Leaderboard</p>
          <h1>模型在变强，<br><span class="accent">Agent 决定上限。</span></h1>
          <p class="hero-lede">把前沿模型的综合分、价格与速度，和同一批开源底座在不同 coding-agent 外壳下的实测放在同一张桌上。两个信源，一套口径，数据随包发布。</p>
          <div class="hero-actions">
            <button class="primary-button" type="button" data-go="models">浏览模型榜
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5"></path></svg>
            </button>
            <button class="ghost-button" type="button" data-go="agents">进入 Agent 战场
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5.5 15.5 10 11 14.5"></path></svg>
            </button>
          </div>
          <p class="hero-meta">
            <span>${AA.total} 个模型</span>
            <span>${AA.openCount} 个开源权重</span>
            <span>${AA.creators} 家厂商</span>
            <span>${H.rows.length} 个 Agent 组合</span>
          </p>
        </div>
        <aside class="hero-board" aria-label="当前榜首">
          <header class="hero-board-head"><span>当前榜首</span><span>快照 ${esc(AA.fetchedAt)}</span></header>
          <div class="hero-leader">
            <div class="hero-leader-top"><span class="hero-leader-rank">01</span>综合智能</div>
            <strong class="hero-leader-name">${esc(topModel?.name ?? '—')}</strong>
            <div class="hero-leader-score">
              <b>${num(topModel?.intelligence)}</b>
              <span>Intelligence Index</span>
            </div>
            <div class="hero-leader-bar"><i style="width:${barWidth(topModel?.intelligence, 70)}%"></i></div>
          </div>
          <div class="hero-board-rows">
            <div class="hero-board-row">
              <span class="hb-label">开源权重</span>
              <span class="hb-name">${esc(topOpen?.name ?? '—')}</span>
              <span class="hb-score">${num(topOpen?.intelligence)}</span>
            </div>
            <div class="hero-board-row">
              <span class="hb-label">Agent 通过率</span>
              <span class="hb-name">${esc(bestRateModel?.name ?? '—')} × ${esc(bestRateHarness?.name ?? '—')}</span>
              <span class="hb-score">${bestRateRow ? pct(bestRateRow.rate) : '—'}</span>
            </div>
          </div>
          <footer class="hero-board-foot">
            <span>${H.models.length} 个底座 × ${H.harnesses.length} 套外壳</span>
            <span>离线快照</span>
          </footer>
        </aside>
      </section>

      <div class="overview-grid">
        <section class="card span-7">
          <header class="card-head">
            <div>
              <h2 class="card-title">综合智能 Top 12</h2>
              <p class="card-sub">Artificial Analysis Intelligence Index · 同一模型只取最高档</p>
            </div>
            <button class="link-button" type="button" data-go="models">全部 ${AA.total} 个 →</button>
          </header>
          <div class="rank-list">${topRows}</div>
        </section>

        <section class="card span-5">
          <header class="card-head">
            <div>
              <h2 class="card-title">开源阵营</h2>
              <p class="card-sub">开放权重模型在榜内的位置</p>
            </div>
            <span class="card-kicker">${openShare}% 开源</span>
          </header>
          <div class="open-total"><strong>${AA.openCount}</strong><span>个开源权重模型<br>共 ${AA.total} 个在榜</span></div>
          <div class="split-bar" aria-hidden="true">
            <i class="open" style="width:${openShare}%"></i>
            <i class="closed" style="width:${100 - openShare}%"></i>
          </div>
          <div class="split-legend"><span><i></i>开源 ${AA.openCount}</span><span><i></i>闭源 ${AA.total - AA.openCount}</span></div>
          ${openRows}
          <p class="footnote" style="margin-top:10px">封闭模型仍占据综合分头部；开源最强是 ${esc(topOpen?.name ?? '—')}，与榜首相差 ${num((topModel?.intelligence ?? 0) - (topOpen?.intelligence ?? 0))} 分。</p>
        </section>

        <section class="card span-12" id="scatter-card">
          <header class="card-head">
            <div>
              <h2 class="card-title">智能 × 成本，谁在效率前沿？</h2>
              <p class="card-sub">每个点是一个模型；开放权重用虚线圈标出。点击查看完整指标。</p>
            </div>
            <div class="chart-toolbar">
              <div class="segments" role="group" aria-label="散点范围">
                <button type="button" class="segment ${state.scatterScope === 'all' ? 'is-active' : ''}" data-scatter-scope="all">全部</button>
                <button type="button" class="segment ${state.scatterScope === 'open' ? 'is-active' : ''}" data-scatter-scope="open">只看开源</button>
              </div>
              <div class="segments" role="group" aria-label="横轴指标">
                <button type="button" class="segment ${state.scatterMetric === 'price' ? 'is-active' : ''}" data-metric="price">混合价格</button>
                <button type="button" class="segment ${state.scatterMetric === 'cost' ? 'is-active' : ''}" data-metric="cost">每任务成本</button>
                <button type="button" class="segment ${state.scatterMetric === 'speed' ? 'is-active' : ''}" data-metric="speed">输出速度</button>
              </div>
            </div>
          </header>
          <div class="scatter-shell" id="scatter-shell"></div>
        </section>

        <section class="card span-12">
          <header class="card-head">
            <div>
              <h2 class="card-title">Agent 高光：每个模型的前三套外壳</h2>
              <p class="card-sub">每列单独按模型内 overall 排名；跨模型请比较最高通过率</p>
            </div>
            <button class="link-button" type="button" data-go="agents">进入战场 →</button>
          </header>
          <div class="agent-highlight">${agentColumns}</div>
          <p class="footnote" style="margin-top:12px">跨模型平均通过率最高的是 <strong style="color:var(--ink)">${esc(topHarness?.name ?? '—')}</strong>（${pct(topHarness?.averageRate)}）。模型内的 overall 冠军可能不同，因为它把成本效率也算进了 50%。</p>
        </section>
      </div>`;

    drawScatter();
  }

  /* ------------------------------------------------------------------ */
  /* scatter                                                             */
  /* ------------------------------------------------------------------ */

  function metricValue(model) {
    if (state.scatterMetric === 'cost') return model.costPerTask;
    if (state.scatterMetric === 'speed') return model.speed;
    return model.blended;
  }

  function metricLabel() {
    if (state.scatterMetric === 'cost') return '每任务成本（美元，log）';
    if (state.scatterMetric === 'speed') return '输出速度（tokens/s）';
    return '混合价格（$/1M tokens，log）';
  }

  function metricFormat(value) {
    if (state.scatterMetric === 'cost') return money(value, 3);
    if (state.scatterMetric === 'speed') return `${num(value, 0)} tok/s`;
    return `${price(value)}/1M`;
  }

  function drawScatter() {
    const shell = $('#scatter-shell');
    if (!shell) return;
    let models = AA.models.filter((model) => {
      const value = metricValue(model);
      return value != null && Number.isFinite(Number(value)) && value > 0 && model.intelligence != null;
    });
    if (state.scatterScope === 'open') models = models.filter((model) => model.open);

    if (!models.length) {
      shell.innerHTML = '<p class="empty-state">这个筛选下没有可绘制的数据。</p>';
      return;
    }

    const narrow = (globalThis.innerWidth || 1200) < 720;
    const W = narrow ? 520 : 960;
    const HGT = narrow ? 430 : 475;
    const pad = narrow
      ? { left: 40, right: 12, top: 12, bottom: 44 }
      : { left: 54, right: 22, top: 16, bottom: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = HGT - pad.top - pad.bottom;

    const values = models.map((model) => Number(metricValue(model)));
    const useLog = state.scatterMetric !== 'speed';
    let xMin;
    let xMax;
    if (useLog) {
      const logs = values.map((value) => Math.log10(value));
      xMin = Math.floor(Math.min(...logs) * 2) / 2 - 0.1;
      xMax = Math.ceil(Math.max(...logs) * 2) / 2 + 0.1;
    } else {
      xMin = 0;
      xMax = Math.ceil(Math.max(...values) / 100) * 100 + 20;
    }

    const scores = models.map((model) => Number(model.intelligence));
    const yMin = Math.max(0, Math.floor((Math.min(...scores) - 3) / 10) * 10);
    const yMax = Math.ceil((Math.max(...scores) + 3) / 10) * 10;

    const xFor = (value) => {
      if (useLog) {
        return pad.left + ((Math.log10(value) - xMin) / (xMax - xMin)) * plotW;
      }
      return pad.left + ((value - xMin) / (xMax - xMin)) * plotW;
    };
    const yFor = (score) => pad.top + plotH - ((score - yMin) / (yMax - yMin)) * plotH;

    const yTicks = [];
    for (let value = yMin; value <= yMax; value += 10) yTicks.push(value);

    let xTicks;
    if (useLog) {
      const minExp = Math.ceil(xMin);
      const maxExp = Math.floor(xMax);
      xTicks = [];
      for (let exp = minExp; exp <= maxExp; exp += 1) xTicks.push(10 ** exp);
      const extra = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30];
      for (const value of extra) {
        if (Math.log10(value) > xMin && Math.log10(value) < xMax) xTicks.push(value);
      }
      xTicks = [...new Set(xTicks)].sort((a, b) => a - b);
    } else {
      xTicks = [];
      for (let value = 0; value <= xMax; value += 100) xTicks.push(value);
    }

    const xTickLabel = (value) => {
      if (state.scatterMetric === 'speed') return String(value);
      if (value >= 1) return `$${value}`;
      return `$${value.toFixed(2).replace(/0$/, '')}`;
    };

    const grid = [];
    for (const value of yTicks) {
      const y = yFor(value);
      grid.push(`<line class="grid-line" x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"/>`);
      grid.push(`<text class="axis-text" x="${pad.left - 9}" y="${y + 3}" text-anchor="end">${value}</text>`);
    }
    for (const value of xTicks) {
      const x = xFor(value);
      grid.push(`<line class="grid-line" x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + plotH}"/>`);
      grid.push(`<text class="axis-text" x="${x}" y="${pad.top + plotH + 17}" text-anchor="middle">${xTickLabel(value)}</text>`);
    }

    const positions = new Map();
    for (const model of models) {
      const value = Number(metricValue(model));
      positions.set(model.slug, {
        x: xFor(value),
        y: yFor(model.intelligence),
        r: 3.8 + Math.min(5.2, Math.sqrt(Math.max(0, model.speed ?? 10)) / 5.5),
      });
    }

    const labels = new Map();
    const labelBoxes = [];
    const fontPx = narrow ? 13 : 9.5;
    const labelHeight = narrow ? 16 : 12;
    const labelCandidates = [...models]
      .sort((a, b) => b.intelligence - a.intelligence)
      .slice(0, narrow ? 4 : 7);
    for (const model of labelCandidates) {
      const point = positions.get(model.slug);
      const textWidth = model.name.length * fontPx * 0.56 + 4;
      const offsets = [
        [point.r + 6, 3, 'start'],
        [point.r + 6, -9, 'start'],
        [-(point.r + 6), 3, 'end'],
        [-(point.r + 6), -9, 'end'],
        [point.r + 6, 15, 'start'],
        [-(point.r + 6), 15, 'end'],
      ];
      for (const [dx, dy, anchor] of offsets) {
        const lx = point.x + dx;
        const ly = point.y + dy;
        const box = {
          x: anchor === 'end' ? lx - textWidth : lx,
          y: ly - labelHeight,
          w: textWidth,
          h: labelHeight,
        };
        if (box.x < pad.left + 2 || box.x + box.w > W - pad.right - 2) continue;
        if (
          labelBoxes.some(
            (other) =>
              !(
                box.x + box.w < other.x - 2 ||
                box.x > other.x + other.w + 2 ||
                box.y + box.h < other.y - 2 ||
                box.y > other.y + other.h + 2
              ),
          )
        ) {
          continue;
        }
        labels.set(model.slug, { x: lx, y: ly, anchor });
        labelBoxes.push(box);
        break;
      }
    }

    const points = [...models]
      .sort((a, b) => a.intelligence - b.intelligence)
      .map((model, index) => {
        const point = positions.get(model.slug);
        const x = point.x;
        const y = point.y;
        const radius = point.r;
        const color = creatorColor(model);
        const label = labels.get(model.slug);
        return `
          <g class="scatter-point" data-model="${esc(model.slug)}" tabindex="0" role="button" aria-label="${esc(model.name)}，智能 ${num(model.intelligence)}，${esc(metricFormat(metricValue(model)))}" style="color:${esc(color)};--i:${index}">
            ${model.open ? `<circle class="halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius + 3.2).toFixed(1)}"/>` : ''}
            <circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${esc(color)}"/>
            ${
              label
                ? `<text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="${label.anchor}">${esc(model.name)}</text>`
                : ''
            }
          </g>`;
      })
      .join('');

    const creators = [...new Set(models.map((model) => model.creator))]
      .slice(0, 8)
      .map((creator) => {
        const model = models.find((item) => item.creator === creator);
        return `<span><i style="background:${esc(creatorColor(model))}"></i>${esc(creator)}</span>`;
      })
      .join('');
    const scopeTotal =
      state.scatterScope === 'open' ? AA.models.filter((model) => model.open).length : AA.models.length;
    const missing = Math.max(0, scopeTotal - models.length);

    shell.innerHTML = `
      <svg class="scatter-svg ${narrow ? 'is-narrow' : ''}" viewBox="0 0 ${W} ${HGT}" role="img" aria-label="模型智能与${esc(metricLabel())}的散点图">
        ${grid.join('')}
        <line class="axis-line" x1="${pad.left}" y1="${pad.top + plotH}" x2="${W - pad.right}" y2="${pad.top + plotH}"/>
        <text class="axis-title" x="${pad.left}" y="${HGT - 10}">${esc(metricLabel())}</text>
        <text class="axis-title" x="14" y="${pad.top + plotH / 2}" transform="rotate(-90 14 ${pad.top + plotH / 2})" text-anchor="middle">Intelligence Index</text>
        ${points}
      </svg>
      <div class="scatter-legend">
        ${creators}
        <span><i class="hollow"></i>开源权重</span>
        <span style="margin-left:auto">${models.length} 个模型${missing ? `（${missing} 个缺${state.scatterMetric === 'speed' ? '速度' : '价格'}未入图）` : ''} · 点越大输出越快</span>
      </div>`;

    const tooltip = $('#tooltip');
    $$('.scatter-point', shell).forEach((node) => {
      const model = AA.models.find((item) => item.slug === node.dataset.model);
      if (!model) return;
      node.addEventListener('pointerenter', (event) => {
        tooltip.hidden = false;
        tooltip.innerHTML = `<strong>${esc(model.name)}${model.variant ? ` · ${esc(model.variant)}` : ''}</strong>
          <span>${esc(model.creator)} · ${model.open ? '开源权重' : '闭源'} · 第 ${model.rank} 名</span>
          <span>智能 ${num(model.intelligence)} · ${esc(metricFormat(metricValue(model)))}</span>
          <span>${model.speed != null ? `速度 ${num(model.speed, 0)} tok/s` : '速度 —'} · ${model.blended != null ? `混合价 $${num(model.blended, 1)}/1M` : '价格 —'}</span>`;
        moveTooltip(event);
      });
      node.addEventListener('pointermove', moveTooltip);
      node.addEventListener('pointerleave', () => {
        tooltip.hidden = true;
      });
    });
  }

  function moveTooltip(event) {
    const tooltip = $('#tooltip');
    if (!tooltip || tooltip.hidden) return;
    const x = Math.max(120, Math.min(globalThis.innerWidth - 120, event.clientX));
    const y = Math.max(90, event.clientY);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  /* ------------------------------------------------------------------ */
  /* models                                                              */
  /* ------------------------------------------------------------------ */

  function fillCreatorFilter() {
    const select = $('#creator-filter');
    if (!select) return;
    const creators = [...new Set(AA.models.map((model) => model.creator))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
    select.innerHTML = `<option value="all">全部厂商</option>${creators
      .map((creator) => `<option value="${esc(creator)}">${esc(creator)}</option>`)
      .join('')}`;
  }

  function filteredModels() {
    const query = state.query.trim().toLowerCase();
    let models = AA.models.filter((model) => {
      if (state.scope === 'open' && !model.open) return false;
      if (state.scope === 'closed' && model.open) return false;
      if (state.creator !== 'all' && model.creator !== state.creator) return false;
      if (!query) return true;
      return [model.name, model.slug, model.creator, model.variant]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    const nullLast = (value) => (value == null ? -Infinity : value);
    const sorters = {
      intelligence: (a, b) => b.intelligence - a.intelligence,
      coding: (a, b) => nullLast(b.coding) - nullLast(a.coding),
      agent: (a, b) => nullLast(b.agent) - nullLast(a.agent),
      value: (a, b) => nullLast(b.value) - nullLast(a.value),
      speed: (a, b) => nullLast(b.speed) - nullLast(a.speed),
      price: (a, b) => {
        if (a.blended == null) return 1;
        if (b.blended == null) return -1;
        return a.blended - b.blended;
      },
    };
    return models.sort(sorters[state.sort] || sorters.intelligence);
  }

  function renderModels() {
    const models = filteredModels();
    const tbody = $('#model-rows');
    const empty = $('#model-empty');
    const count = $('#model-count');
    if (!tbody) return;

    count.textContent = `${models.length} 个模型 · ${AA.openCount} 个开源 · ${AA.creators} 家厂商 · 快照 ${AA.fetchedAt}`;
    empty.hidden = models.length > 0;

    tbody.innerHTML = models
      .map(
        (model) => `
        <tr tabindex="0" data-model="${esc(model.slug)}">
          <td class="model-rank">${model.rank}</td>
          <td>
            <div class="model-name">
              <span class="line">
                <strong>${esc(model.name)}</strong>
                ${model.variant ? `<span class="badge">${esc(model.variant)}</span>` : ''}
                ${model.reasoning ? '<span class="badge reason" title="推理模型">推理</span>' : ''}
              </span>
            </div>
          </td>
          <td class="hide-sm">
            <span class="creator-name"><i class="creator-dot" style="background:${esc(creatorColor(model))}"></i>${esc(model.creator)}</span>
          </td>
          <td>
            <span class="score-cell"><b>${num(model.intelligence)}</b><span class="mini-track"><i style="width:${barWidth(model.intelligence, 70)}%;background:${esc(creatorColor(model))}"></i></span></span>
          </td>
          <td class="metric-cell hide-sm ${model.coding == null ? 'empty' : ''}">${model.coding == null ? '—' : pct(model.coding)}</td>
          <td class="metric-cell hide-sm ${model.agent == null ? 'empty' : ''}">${model.agent == null ? '—' : pct(model.agent)}</td>
          <td class="price-cell ${model.blended == null ? 'empty' : ''}" title="${model.priceIn == null ? '无公开标价' : `输入 $${model.priceIn} / 输出 $${model.priceOut} 每百万 token`}">
            <b>${model.blended == null ? '—' : price(model.blended)}</b>
            <small>${model.priceIn == null ? 'no list price' : `${price(model.priceIn)} / ${price(model.priceOut)}`}</small>
          </td>
          <td class="metric-cell hide-sm ${model.speed == null ? 'empty' : ''}">${model.speed == null ? '—' : num(model.speed, 0)}</td>
          <td class="context-cell hide-sm">${context(model.context)}</td>
          <td><span class="badge ${model.open ? 'open' : ''}">${model.open ? '开源' : '闭源'}</span></td>
        </tr>`,
      )
      .join('');
  }

  function bindModels() {
    const search = $('#model-search');
    search?.addEventListener('input', () => {
      state.query = search.value;
      renderModels();
    });
    $$('[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        state.scope = button.dataset.scope;
        $$('[data-scope]').forEach((item) => item.classList.toggle('is-active', item === button));
        renderModels();
      });
    });
    $('#creator-filter')?.addEventListener('change', (event) => {
      state.creator = event.target.value;
      renderModels();
    });
    $('#sort-filter')?.addEventListener('change', (event) => {
      state.sort = event.target.value;
      renderModels();
    });
    $('#model-rows')?.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-model]');
      if (row) openDetail(row.dataset.model);
    });
    $('#model-rows')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-model]');
      if (!row) return;
      event.preventDefault();
      openDetail(row.dataset.model);
    });
  }

  /* ------------------------------------------------------------------ */
  /* detail modal                                                        */
  /* ------------------------------------------------------------------ */

  function openDetail(slug) {
    const model = AA.models.find((item) => item.slug === slug);
    if (!model) return;
    lastFocused = document.activeElement;
    const badge = model.open ? '<span class="badge open">开源权重</span>' : '<span class="badge">闭源</span>';
    const reasoning = model.reasoning ? '<span class="badge reason">推理模型</span>' : '';
    const variant = model.variant ? `<span class="badge">${esc(model.variant)}</span>` : '';

    const bars = [
      ['综合智能', model.intelligence, 70, creatorColor(model)],
      ['编程', model.coding, 100, 'var(--accent)'],
      ['Agent', model.agent, 100, 'var(--coral)'],
      ['终端', model.terminal, 100, 'var(--amber)'],
      ['全知', model.omniscience, 100, 'var(--blue)'],
    ]
      .filter(([, value]) => value != null)
      .map(
        ([label, value, max, color]) => `
        <div class="modal-bar-row">
          <span>${esc(label)}</span>
          <span class="mini-track" style="height:7px"><i style="width:${barWidth(value, max)}%;background:${color}"></i></span>
          <b>${num(value)}</b>
        </div>`,
      )
      .join('');

    $('#modal-content').innerHTML = `
      <div class="modal-hero">
        <div>
          <span class="modal-rank">#${model.rank}</span>
          <h2 id="modal-title">${esc(model.name)}</h2>
          <div class="byline">
            <i class="creator-dot" style="background:${esc(creatorColor(model))}"></i>
            <span>${esc(model.creator)}</span>
            ${badge}${variant}${reasoning}
          </div>
        </div>
        <div class="modal-score">
          <strong>${num(model.intelligence)}</strong>
          <span>AA Intelligence Index</span>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>编程</span><b class="${model.coding == null ? 'empty' : ''}">${model.coding == null ? '—' : pct(model.coding)}</b></div>
        <div class="metric"><span>Agent</span><b class="${model.agent == null ? 'empty' : ''}">${model.agent == null ? '—' : pct(model.agent)}</b></div>
        <div class="metric"><span>终端</span><b class="${model.terminal == null ? 'empty' : ''}">${model.terminal == null ? '—' : pct(model.terminal)}</b></div>
        <div class="metric"><span>全知</span><b class="${model.omniscience == null ? 'empty' : ''}">${model.omniscience == null ? '—' : num(model.omniscience)}</b></div>
        <div class="metric"><span>混合价格</span><b class="${model.blended == null ? 'empty' : ''}">${model.blended == null ? '—' : `${price(model.blended)}`}</b></div>
        <div class="metric"><span>每任务成本</span><b class="${model.costPerTask == null ? 'empty' : ''}">${model.costPerTask == null ? '—' : money(model.costPerTask)}</b></div>
        <div class="metric"><span>输出速度</span><b class="${model.speed == null ? 'empty' : ''}">${model.speed == null ? '—' : `${num(model.speed, 0)} tok/s`}</b></div>
        <div class="metric"><span>上下文</span><b>${context(model.context)}</b></div>
      </div>
      <div class="modal-bars">${bars}</div>
      <div class="modal-foot">
        <a href="https://artificialanalysis.ai/models/${encodeURIComponent(model.slug)}" target="_blank" rel="noreferrer">在 Artificial Analysis 查看 ↗</a>
        <span>${model.priceIn != null ? `输入 ${price(model.priceIn)} · 输出 ${price(model.priceOut)} · 缓存 ${model.cacheHit == null ? '—' : price(model.cacheHit)} / 1M` : '无公开标价'} · 快照 ${AA.fetchedAt}</span>
      </div>`;

    const modal = $('#modal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.modal-close', modal)?.focus();
  }

  function closeModal() {
    const modal = $('#modal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  /* ------------------------------------------------------------------ */
  /* agents                                                              */
  /* ------------------------------------------------------------------ */

  function heatColor(value, min, max, dark) {
    const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
    const low = dark ? [27, 37, 34] : [234, 242, 238];
    const high = dark ? [110, 231, 200] : [15, 123, 108];
    const mix = low.map((channel, index) => Math.round(channel + (high[index] - channel) * t));
    const text = t > 0.58 ? (dark ? '#08120f' : '#ffffff') : 'var(--ink)';
    return { background: `rgb(${mix.join(',')})`, color: text, t };
  }

  function renderAgents() {
    if (!H.models.some((model) => model.id === state.agentModel)) {
      state.agentModel = H.models[0]?.id ?? null;
    }
    const model = modelById(state.agentModel) || H.models[0];
    const rows = H.rows
      .filter((row) => row.model === model.id)
      .sort((a, b) => (a.overallRank ?? 99) - (b.overallRank ?? 99) || b.overall - a.overall);
    const best = rows[0];
    const totalCellScores = H.rows.map((row) => row.rate).filter((value) => value != null);
    const cellMin = Math.min(...totalCellScores);
    const cellMax = Math.max(...totalCellScores);
    const dark = document.documentElement.dataset.lbTheme === 'dark';

    const switchHtml = H.models
      .map(
        (item) => `
        <button class="model-choice ${item.id === model.id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${item.id === model.id}" data-agent-model="${esc(item.id)}">
          <strong>${esc(item.name)}</strong>
          <span class="best"><b>${num(item.bestRate)}%</b><span>${esc(harnessById(item.bestRateHarness)?.name ?? '—')}</span></span>
          <span class="mini-track"><i style="width:${barWidth(item.bestRate, 100)}%;background:var(--accent)"></i></span>
        </button>`,
      )
      .join('');
    $('#agent-model-switch').innerHTML = switchHtml;

    const rankingRows = rows
      .map((row) => {
        const harness = harnessById(row.harness);
        const tieCount = rows.filter((item) => item.overallRank === row.overallRank).length;
        const ciLeft = row.ci ? barWidth(row.ci[0], 100) : null;
        const ciWidth = row.ci ? Math.max(0.8, barWidth(row.ci[1], 100) - ciLeft) : 0;
        return `
          <div class="agent-row">
            <span class="agent-rank">#${row.overallRank ?? '—'}${tieCount > 1 ? '<span class="tie-badge" title="并列名次">=</span>' : ''}</span>
            <span class="agent-name">
              <span class="top"><i class="dot" style="background:${esc(harness?.color ?? 'var(--muted)')}"></i><strong>${esc(harness?.name ?? row.harness)}</strong></span>
              <small>${esc(harness?.vendor ?? '')}${row.versions?.[0] ? ` · v${esc(row.versions[0])}` : ''}</small>
            </span>
            <span class="agent-meter">
              <i style="width:${barWidth(row.overall, 100)}%;background:${esc(harness?.color ?? 'var(--accent)')}"></i>
              ${row.ci ? `<span class="ci" style="left:${ciLeft}%;width:${ciWidth}%"></span>` : ''}
            </span>
            <span class="agent-score">${num(row.overall)}</span>
            <span class="agent-meta">
              <span>通过率 <b>${pct(row.rate)}</b></span>
              <span>$/次通过 <b>${money(row.costPerPass, 3)}</b></span>
              <span>平均耗时 <b>${duration(row.agentSec)}</b></span>
              <span>有效 / 总试次 <b>${integer(row.scored)} / ${integer(row.trials)}</b></span>
            </span>
          </div>`;
      })
      .join('');

    const heatRows = H.harnesses
      .map((harness) => {
        const cells = H.models.map((item) => {
          const row = H.rows.find((entry) => entry.model === item.id && entry.harness === harness.id);
          if (!row || row.rate == null) {
            return '<div class="hm-cell" style="background:var(--surface-3);color:var(--faint)">—</div>';
          }
          const color = heatColor(row.rate, cellMin, cellMax, dark);
          return `<button class="hm-cell ${item.id === model.id ? 'is-selected' : ''}" type="button" data-heat-model="${esc(item.id)}" title="${esc(item.name)} × ${esc(harness.name)} · 通过率 ${pct(row.rate)} · ${money(row.costPerPass, 3)}/次通过" style="background:${color.background};color:${color.color}">${num(row.rate)}</button>`;
        });
        return `
          <span class="hm-row-label"><i style="background:${esc(harness.color)}"></i>${esc(harness.name)}</span>
          ${cells.join('')}`;
      })
      .join('');

    const heatHeads = H.models
      .map((item) => `<span class="hm-head">${esc(item.name)}</span>`)
      .join('');

    const benchRows = rows
      .map((row) => {
        const harness = harnessById(row.harness);
        const cell = (benchmark) => {
          const item = row.benchmarks?.[benchmark];
          if (!item || item.rate == null) return '<td class="metric-cell empty">—</td>';
          return `<td><span class="bench-cell"><span class="mini-track"><i style="width:${barWidth(item.rate, 100)}%;background:${esc(harness?.color ?? 'var(--accent)')}"></i></span><b>${pct(item.rate)}</b></span></td>`;
        };
        const tie = rows.filter((item) => item.overallRank === row.overallRank).length > 1;
        return `
          <tr>
            <td><span class="agent"><i style="background:${esc(harness?.color ?? 'var(--muted)')}"></i>${esc(harness?.name ?? row.harness)} <span class="tie-badge" title="名次">#${row.overallRank ?? '—'}${tie ? '=' : ''}</span></span></td>
            ${cell('terminal-bench-2.1')}
            ${cell('deep-swe')}
            <td class="cost">${money(row.costPerPass, 3)}</td>
            <td class="cost">${duration(row.agentSec)}</td>
            <td class="cost">${integer(row.pass)} / ${integer(row.scored)}</td>
          </tr>`;
      })
      .join('');

    const lowColor = heatColor(cellMin, cellMin, cellMax, dark).background;
    const highColor = heatColor(cellMax, cellMin, cellMax, dark).background;
    const modelBest = rows.find((row) => row.overallRank === 1);

    $('#agent-body').innerHTML = `
      <div class="agent-layout">
        <section class="card">
          <header class="card-head">
            <div>
              <h2 class="card-title">${esc(model.name)} × Agent 排名</h2>
              <p class="card-sub">overall = 50% 通过率 + 50% 成本效率，只在当前模型内归一化；横线是 95% 置信区间。当前冠军 ${esc(harnessById(modelBest?.harness)?.name ?? '—')}。</p>
            </div>
            <span class="card-kicker">${rows.length} 套 harness</span>
          </header>
          <div class="agent-ranking">${rankingRows}</div>
        </section>

        <section class="card">
          <header class="card-head">
            <div>
              <h2 class="card-title">全景热力：任务通过率</h2>
              <p class="card-sub">跨模型可比的是通过率，不是模型内的 overall；点击任意格切换模型</p>
            </div>
          </header>
          <div class="heatmap" style="--cols:${H.models.length};--hm-low:${lowColor};--hm-high:${highColor}">
            <span class="hm-head"></span>${heatHeads}
            ${heatRows}
          </div>
          <div class="heatmap-legend"><span>${num(cellMin)}%</span><span class="ramp"></span><span>${num(cellMax)}%</span></div>
          <div class="hm-averages">
            <p>跨模型平均通过率</p>
            ${H.harnesses
              .map(
                (harness) => `
                <div class="hm-avg-row">
                  <span>${esc(harness.name)}</span>
                  <span class="mini-track"><i style="width:${barWidth(harness.averageRate, 100)}%;background:${esc(harness.color)}"></i></span>
                  <b>${num(harness.averageRate)}%</b>
                </div>`,
              )
              .join('')}
          </div>
        </section>
      </div>

      <section class="card" style="margin-top:18px">
        <header class="card-head">
          <div>
            <h2 class="card-title">拆开看：两个基准的相对强弱</h2>
            <p class="card-sub">${esc(model.name)} 下各 harness 的任务通过率；同一 harness 在不同基准上未必同样强</p>
          </div>
          <span class="card-kicker">宏平均通过率</span>
        </header>
        <div style="overflow:auto">
          <table class="bench-table">
            <thead><tr><th>Agent</th><th>Terminal-Bench 2.1</th><th>Deep-SWE</th><th>$/次通过</th><th>耗时</th><th>通过 / 有效</th></tr></thead>
            <tbody>${benchRows}</tbody>
          </table>
        </div>
      </section>`;

    $('#noise-rerun').textContent = H.noise.rerunFlip == null ? '—' : `${H.noise.rerunFlip}%`;
    $('#noise-harness').textContent =
      H.noise.harnessFlip == null ? '—' : `${H.noise.harnessFlip}%`;

    $$('[data-agent-model]').forEach((button) => {
      button.addEventListener('click', () => {
        state.agentModel = button.dataset.agentModel;
        renderAgents();
      });
    });
    $$('[data-heat-model]', $('#agent-body')).forEach((cell) => {
      cell.addEventListener('click', () => {
        state.agentModel = cell.dataset.heatModel;
        renderAgents();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */

  function bindGlobal() {
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => setView(tab.dataset.view));
    });
    $$('[data-view-link]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        setView(link.dataset.viewLink);
      });
    });
    $('#theme-toggle')?.addEventListener('click', cycleTheme);

    const overview = $('#view-overview');
    overview.addEventListener('click', (event) => {
      const jump = event.target.closest('[data-agent-jump]');
      if (jump) {
        state.agentModel = jump.dataset.agentJump;
        setView('agents');
        return;
      }
      const go = event.target.closest('[data-go]');
      if (go) {
        setView(go.dataset.go);
        return;
      }
      const metric = event.target.closest('[data-metric]');
      if (metric) {
        state.scatterMetric = metric.dataset.metric;
        $$('[data-metric]', overview).forEach((button) =>
          button.classList.toggle('is-active', button === metric),
        );
        drawScatter();
        return;
      }
      const scope = event.target.closest('[data-scatter-scope]');
      if (scope) {
        state.scatterScope = scope.dataset.scatterScope;
        $$('[data-scatter-scope]', overview).forEach((button) =>
          button.classList.toggle('is-active', button === scope),
        );
        drawScatter();
        return;
      }
      const model = event.target.closest('[data-model]');
      if (model) openDetail(model.dataset.model);
    });
    overview.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const point = event.target.closest('.scatter-point[data-model]');
      if (!point) return;
      event.preventDefault();
      openDetail(point.dataset.model);
    });

    $$('[data-close-modal]').forEach((element) => {
      element.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      ) {
        event.preventDefault();
        setView('models', { scroll: false });
        $('#model-search')?.focus();
      }
    });

    globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
      if (state.theme !== 'system') return;
      refreshForTheme();
    });

    if (typeof globalThis.magpie?.onTheme === 'function') {
      globalThis.magpie.onTheme((theme) => {
        if (theme && typeof theme.dark === 'boolean') state.hostDark = theme.dark;
        if (state.theme !== 'system') return;
        refreshForTheme();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  (async function boot() {
    const hostTheme = await hostReady;
    if (hostTheme && typeof hostTheme.dark === 'boolean') state.hostDark = hostTheme.dark;

    $('#snapshot-date').textContent = AA.fetchedAt;
    applyTheme();
    fillCreatorFilter();
    renderOverview();
    renderModels();
    bindGlobal();
    bindModels();
    const initial = (globalThis.location?.hash || '').replace('#', '');
    if (initial === 'models' || initial === 'agents') setView(initial, { scroll: false });
    globalThis.addEventListener?.('hashchange', () => {
      const view = (globalThis.location?.hash || '').replace('#', '');
      if (view === 'models' || view === 'agents' || view === 'overview') {
        setView(view, { scroll: false });
      }
    });
    await loadPreferences();
  })();
})();
