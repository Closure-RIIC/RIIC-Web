/* ============================================================
   step.js —— 步进模拟页 v11
   - 时长 24/48/72/96h
   - 心情助力按天独立配置（最多 5 个自然日）
   - 助力目标仅限已排班干员
   ============================================================ */
(function () {
  'use strict';

  const C_WORK_PER_SEC = 7.2 / 3600;
  const C_REST_PER_SEC = 12 / 3600;
  const EPS = 1e-6;

  const ROOM_KEYS = ['central', 'manufactA', 'manufactB', 'culture', 'meeting'];
  const ROOM_LABELS = { central:'总控中枢', manufactA:'制造舱 A', manufactB:'制造舱 B', culture:'培养舱', meeting:'会客室' };
  const ROOM_RAW = { central:'总控中枢', manufactA:'制造舱', manufactB:'制造舱', culture:'培养舱', meeting:'会客室' };
  const ROOM_NEEDS_PRODUCT = { manufactA:'single', manufactB:'single', culture:'multi' };
  const PRODUCT_OPTIONS = {
    manufactA: [{ value:'exp', label:'干员经验' }, { value:'weapon', label:'武器经验' }],
    manufactB: [{ value:'exp', label:'干员经验' }, { value:'weapon', label:'武器经验' }],
    culture: [{ value:'mineral', label:'矿物' }, { value:'fungi', label:'菌类' }, { value:'plant', label:'晶植' }],
  };
  const PRODUCT_COLORS = { mineral:'#e08a2c', fungi:'#8a5e00', plant:'#6a9a3a' };
  const PRODUCT_LABELS = { mineral:'矿物', fungi:'菌类', plant:'晶植' };
  const TALENT_ORDER = ['1_1','2_1','1_2','2_2'];
  const TALENT_TIER = { '1_1':1, '2_1':1, '1_2':2, '2_2':2 };
  const ELITE_RANK = { none:0, 精零:1, 精一:2, 精二:3, 精三:4, 精四:5 };

  let rawData = null;
  let operators = [];
  let spriteImage = null;
  let spriteIndex = null;
  let spriteReady = false;
  const spriteCache = {};

  let roomConfigs = {};
  let initialMoods = {};
  let initialWork = {};
  let pickerCtx = null;
  let axisDrag = null;
  let hoverTooltipEl = null;

  // ★ 助力配置：按天存储，days[0] = 模拟起点所在自然日
  let boostConfigs = { dailyCount: 2, currentDay: 0, days: [] };

  const state = {
    tSec: 0, maxTSec: 24 * 3600, sampleSec: 60, startHour: 8, speed: 100,
    running: false, timer: null, ops: [], rooms: {}, output: {}, workTimeSec: {},
    history: [], log: [], lastMoodEvent: {}, nextSampleSec: 0, ended: false, boosts: [],
  };

  // ============ 工具 ============
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtTime(tSec) {
    const total = state.startHour * 3600 + tSec;
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    const base = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return d > 0 ? `${base} (+${d}d)` : base;
  }
  function fmtDur(seconds) {
    const total = Math.round(seconds);
    const H = Math.floor(total / 3600), M = Math.floor((total % 3600) / 60), S = total % 60;
    if (H === 0 && M === 0) return `${S}s`;
    if (H === 0) return `${M}m${S}s`;
    if (M === 0 && S === 0) return `${H}h`;
    if (S === 0) return `${H}h${M}m`;
    return `${H}h${M}m${S}s`;
  }
  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
    return `hsl(${hash % 360}, 65%, 45%)`;
  }
  function emptyTalents() { return { '1_1':false,'2_1':false,'1_2':false,'2_2':false }; }
  function normalizeElite(e) {
    if (e === '未拥有' || e === 'none' || e == null || e === '') return 'none';
    return ELITE_RANK[e] !== undefined ? e : 'none';
  }
  function parseConfigEntry(v) {
    if (typeof v === 'string') {
      const e = normalizeElite(v); const t = emptyTalents();
      if (e === '精一') t['1_1'] = true;
      else if (e === '精二') { t['1_1'] = t['2_1'] = true; }
      else if (e === '精三') { t['1_1'] = t['2_1'] = t['1_2'] = true; }
      else if (e === '精四') { t['1_1'] = t['2_1'] = t['1_2'] = t['2_2'] = true; }
      return { elite:e, talents:t };
    }
    if (v && typeof v === 'object') {
      const e = normalizeElite(v.elite); const t = emptyTalents();
      const list = Array.isArray(v.talents) ? v.talents : [];
      for (const tid of list) if (TALENT_ORDER.includes(tid)) t[tid] = true;
      if (e === 'none') for (const k of TALENT_ORDER) t[k] = false;
      return { elite:e, talents:t };
    }
    return { elite:'none', talents:emptyTalents() };
  }
  function getTalentList(raw, tid) {
    if (!raw) return [];
    if (Array.isArray(raw[tid]) && raw[tid].length) return raw[tid];
    const LEGACY = { '1_1':'精一','2_1':'精二','1_2':'精三','2_2':'精四' };
    if (Array.isArray(raw[LEGACY[tid]]) && raw[LEGACY[tid]].length) return raw[LEGACY[tid]];
    return [];
  }
  function isCluePower(t) { return t === '线索概率提升' || t === '线索概率小幅提升'; }
  function getGroupedTraits(op) {
    if (op.eliteLevel === 'none' || op.eliteLevel === '精零') return [];
    const raw = rawData[op.name] || {}; const all = [];
    for (const tid of TALENT_ORDER) {
      if (!op.activatedTalents[tid]) continue;
      const list = getTalentList(raw, tid);
      for (const t of list) all.push({ ...t, _tid:tid });
    }
    const map = new Map();
    for (const t of all) {
      const key = isCluePower(t.类型) ? `${t.舱室}|线索概率|${t.线索编号 || ''}` : `${t.舱室}|${t.类型}`;
      const tier = TALENT_TIER[t._tid] || 1;
      if (!map.has(key)) map.set(key, { trait:t, tier });
      else { const ex = map.get(key); if (tier > ex.tier) map.set(key, { trait:t, tier }); }
    }
    return Array.from(map.values()).map(v => v.trait);
  }

  // ============ 精灵图 ============
  async function loadSprite() {
    try {
      const res = await fetch('/dist/agent_sprite.json', { cache:'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      spriteIndex = await res.json();
      spriteImage = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('精灵图加载失败'));
        img.src = '/dist/' + (spriteIndex.image || 'agent_sprite.webp') + '?t=' + Date.now();
      });
      spriteReady = true;
    } catch (e) { console.warn('[step] 精灵图失败:', e); spriteReady = false; }
  }
  function getAvatar(name) {
    if (!spriteReady || !spriteImage || !spriteIndex) return `/Agent/${encodeURIComponent(name)}.webp`;
    if (spriteCache[name]) return spriteCache[name];
    const pos = spriteIndex.agents && spriteIndex.agents[name];
    if (!pos) return `/Agent/${encodeURIComponent(name)}.webp`;
    try {
      const c = document.createElement('canvas'); c.width = pos.w; c.height = pos.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(spriteImage, pos.x, pos.y, pos.w, pos.h, 0, 0, pos.w, pos.h);
      let url = ''; try { url = c.toDataURL('image/webp', 0.85); } catch (_) {}
      if (!url || url.indexOf('data:image/webp') !== 0) url = c.toDataURL('image/png');
      spriteCache[name] = url; return url;
    } catch (e) { return `/Agent/${encodeURIComponent(name)}.webp`; }
  }

  // ============ 数据加载 ============
  async function loadData() {
    const res = await fetch('/Agent_characteristics.json', { cache:'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawData = await res.json();
    let config = {};
    try { config = JSON.parse(sessionStorage.getItem('DijiangScheduleConfig') || '{}'); } catch (e) {}
    const order = rawData.operator_order || Object.keys(rawData).filter(k => k !== 'operator_order');
    operators = order.map(name => {
      const info = rawData[name]; if (!info) return null;
      const entry = parseConfigEntry(config[name]);
      return { name, star:info.star || '未知', attribute:info.attribute || '未知', eliteLevel:entry.elite, activatedTalents:entry.talents };
    }).filter(Boolean);
  }
  function getOperator(name) { return operators.find(o => o.name === name) || null; }

  // ============ 助力天数 ============
  function getMaxBoostDays() {
    const maxH = parseInt((document.getElementById('maxHours') || {}).value, 10) || 24;
    const startH = parseInt((document.getElementById('startHour') || {}).value, 10) || 8;
    return Math.min(5, Math.max(1, Math.ceil((startH + maxH) / 24)));
  }
  function createDefaultBoostDay() {
    return { list: [
      { hour:12, minute:0, target:null },
      { hour:18, minute:0, target:null },
    ]};
  }
  function ensureBoostDays() {
    const n = getMaxBoostDays();
    while (boostConfigs.days.length < n) boostConfigs.days.push(createDefaultBoostDay());
    if (boostConfigs.days.length > n) boostConfigs.days.length = n;
    if (boostConfigs.currentDay >= n) boostConfigs.currentDay = n - 1;
    for (const d of boostConfigs.days) {
      while (d.list.length < boostConfigs.dailyCount) d.list.push({ hour:12, minute:0, target:null });
    }
  }
  function getCurrentBoostDay() {
    ensureBoostDays();
    return boostConfigs.days[boostConfigs.currentDay] || createDefaultBoostDay();
  }

  // ============ 配置初始化 ============
  function initRoomConfigs() {
    roomConfigs = {};
    for (const rk of ROOM_KEYS) {
      const isCentral = rk === 'central';
      roomConfigs[rk] = {
        enabled: true, shiftEnabled: false,
        round1: [null,null,null], round2: [null,null,null],
        shiftABHours: isCentral ? 13 : 14,
        shiftBAHours: isCentral ? 11 : 10,
        shiftR2StartHour: isCentral ? 13 : 14,
        product: null, products: [],
      };
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem('DijiangStepRoomConfigs') || 'null');
      if (saved) for (const rk of ROOM_KEYS) if (saved[rk]) Object.assign(roomConfigs[rk], saved[rk]);
    } catch (e) {}
    try { initialMoods = JSON.parse(sessionStorage.getItem('DijiangStepInitialMood') || '{}') || {}; } catch (e) {}
    try { initialWork = JSON.parse(sessionStorage.getItem('DijiangStepInitialWork') || '{}') || {}; } catch (e) {}

    // ★ 加载助力配置（兼容旧格式）
    try {
      const rawBoost = sessionStorage.getItem('DijiangStepBoostConfigs');
      if (rawBoost) {
        const parsed = JSON.parse(rawBoost);
        if (parsed && Array.isArray(parsed.days)) {
          boostConfigs = { dailyCount: parsed.dailyCount || 2, currentDay: parsed.currentDay || 0, days: parsed.days };
        } else if (parsed && Array.isArray(parsed.list)) {
          boostConfigs = { dailyCount: parsed.dailyCount || 2, currentDay: 0, days: [{ list: parsed.list }] };
        }
      }
    } catch (e) {}

    importFromManualSilent();
  }
  function importFromManualSilent() {
    try {
      const raw = sessionStorage.getItem('DijiangManualSchedule');
      if (!raw) return;
      const manual = JSON.parse(raw);
      if (!manual || !manual.rooms) return;
      const isDouble = manual.mode === 'double';
      for (const rk of ROOM_KEYS) {
        const r = manual.rooms[rk]; if (!r) continue;
        const r1 = r.round1 || [null,null,null];
        const r2 = r.round2 || [null,null,null];
        roomConfigs[rk].round1 = [r1[0] || null, r1[1] || null, r1[2] || null];
        roomConfigs[rk].round2 = [r2[0] || null, r2[1] || null, r2[2] || null];
        if (isDouble && r2.some(n => n)) roomConfigs[rk].shiftEnabled = true;
      }
    } catch (e) {}
    try {
      const raw = sessionStorage.getItem('DijiangManualProduct');
      if (raw) {
        const prod = JSON.parse(raw) || {};
        if (prod.manufactA) roomConfigs.manufactA.product = prod.manufactA;
        if (prod.manufactB) roomConfigs.manufactB.product = prod.manufactB;
        if (prod.culture) {
          const c = prod.culture; let order = [];
          if (c && typeof c === 'object' && !Array.isArray(c)) {
            const products = Array.isArray(c.products) ? c.products : [];
            if (Array.isArray(c.priority) && c.priority.length > 0) {
              order = c.priority.filter(x => products.includes(x));
              for (const x of products) if (!order.includes(x)) order.push(x);
            } else {
              for (const x of ['plant','mineral','fungi']) if (products.includes(x)) order.push(x);
              for (const x of products) if (!order.includes(x)) order.push(x);
            }
          } else if (Array.isArray(c)) order = c.slice();
          else if (typeof c === 'string') order = [c];
          roomConfigs.culture.products = order;
        }
      }
    } catch (e) {}
    try {
      const raw = sessionStorage.getItem('DijiangManualOptimalHA');
      if (raw) {
        const optimal = JSON.parse(raw);
        for (const rk of ROOM_KEYS) {
          const t = optimal[rk]; if (!t) continue;
          if (typeof t.h1 === 'number' && typeof t.h2 === 'number') {
            const a = Math.max(1, Math.min(23, Math.round(t.h1)));
            roomConfigs[rk].shiftABHours = a;
            roomConfigs[rk].shiftBAHours = 24 - a;
            roomConfigs[rk].shiftR2StartHour = a;
          }
        }
      }
    } catch (e) {}
  }
  function saveRoomConfigs() { try { sessionStorage.setItem('DijiangStepRoomConfigs', JSON.stringify(roomConfigs)); } catch (e) {} }
  function saveBoostConfigs() { try { sessionStorage.setItem('DijiangStepBoostConfigs', JSON.stringify(boostConfigs)); } catch (e) {} }

  function onConfigChanged() {
    saveRoomConfigs();
    if (state.running) pause();
    state.ops = []; state.rooms = {}; state.output = {}; state.workTimeSec = {};
    state.history = []; state.log = []; state.tSec = 0; state.ended = false;
    state.lastMoodEvent = {}; state.nextSampleSec = 0; state.boosts = [];
    hideTooltip(); renderAll();
  }
  function validateBeforeStart() {
    const missing = [];
    for (const rk of ROOM_KEYS) {
      const c = roomConfigs[rk]; if (!c.enabled) continue;
      const need = ROOM_NEEDS_PRODUCT[rk];
      if (need === 'single' && !c.product) missing.push(`${ROOM_LABELS[rk]}：未选择追踪素材`);
      else if (need === 'multi' && (!c.products || c.products.length === 0)) missing.push(`${ROOM_LABELS[rk]}：未选择追踪素材`);
    }
    return missing;
  }

  // ============ 数轴 ============
  function calcLogicalSegments(rk) {
    const c = roomConfigs[rk]; const baH = c.shiftBAHours;
    const s = ((c.shiftR2StartHour % 24) + 24) % 24;
    return { r2:[s, s + baH], r1:[s + baH, s + 24], s, baH };
  }
  function normHour(h) { return ((h % 24) + 24) % 24; }
  function roundAtHour(rk, h) {
    const { s, baH } = calcLogicalSegments(rk); const r2End = s + baH; const hNorm = normHour(h);
    if (r2End <= 24) return (hNorm >= s && hNorm < r2End) ? 'round2' : 'round1';
    return (hNorm >= s || hNorm < r2End - 24) ? 'round2' : 'round1';
  }
  function nextSwitchSec(rk, h) {
    const { s, baH } = calcLogicalSegments(rk); const hNorm = normHour(h);
    if (roundAtHour(rk, h) === 'round2') {
      let dist = s + baH - hNorm; while (dist <= 0) dist += 24; while (dist > 24) dist -= 24; return dist * 3600;
    }
    let dist = s + 24 - hNorm; while (dist <= 0) dist += 24; while (dist > 24) dist -= 24; return dist * 3600;
  }
  function splitVisual(seg) {
    const [a, b] = seg; if (b <= 24) return [[a, b]];
    const parts = []; if (a < 24) parts.push([a, 24]); parts.push([0, b - 24]); return parts;
  }
  function calcShiftSegments(rk) {
    const { r1, r2 } = calcLogicalSegments(rk);
    return { r1Segs: splitVisual(r1), r2Segs: splitVisual(r2) };
  }
  function renderShiftAxis(rk) {
    const W = 1000, H = 52, unit = W / 24;
    const { r1Segs, r2Segs } = calcShiftSegments(rk);
    const r1Continuous = r1Segs.length === 1, r2Continuous = r2Segs.length === 1;
    let svg = `<svg class="shift-axis" data-room="${rk}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect x="0" y="12" width="${W}" height="22" fill="#f0f2f5" rx="3"/>`;
    for (const [a, b] of r1Segs) {
      svg += `<rect class="axis-seg-green${r1Continuous ? ' axis-seg-draggable' : ''}" data-room="${rk}" data-seg="round1" x="${(a*unit).toFixed(1)}" y="12" width="${((b-a)*unit).toFixed(1)}" height="22" fill="#93c8b1" rx="3"/>`;
    }
    for (const [a, b] of r2Segs) {
      svg += `<rect class="axis-seg-yellow${r2Continuous ? ' axis-seg-draggable' : ''}" data-room="${rk}" data-seg="round2" x="${(a*unit).toFixed(1)}" y="12" width="${((b-a)*unit).toFixed(1)}" height="22" fill="#f0d98a" rx="3"/>`;
    }
    for (const [a, b] of r1Segs) {
      const cx = ((a+b)/2)*unit; const txt = (b-a) >= 3 ? `一轮 ${b-a}h` : '一轮';
      svg += `<text class="axis-label" x="${cx.toFixed(1)}" y="27" text-anchor="middle" style="font-size:10px;fill:#2a5a4a;pointer-events:none;">${txt}</text>`;
    }
    for (const [a, b] of r2Segs) {
      const cx = ((a+b)/2)*unit; const txt = (b-a) >= 3 ? `二轮 ${b-a}h` : '二轮';
      svg += `<text class="axis-label" x="${cx.toFixed(1)}" y="27" text-anchor="middle" style="font-size:10px;fill:#8a5e00;pointer-events:none;">${txt}</text>`;
    }
    const rx = state.startHour * unit;
    svg += `<line x1="${rx.toFixed(1)}" y1="6" x2="${rx.toFixed(1)}" y2="44" stroke="#c0392b" stroke-width="2"/>`;
    svg += `<circle cx="${rx.toFixed(1)}" cy="6" r="3" fill="#c0392b"/>`;
    svg += `<text x="${rx.toFixed(1)}" y="${H-2}" font-size="10" fill="#c0392b" text-anchor="middle" font-weight="600">起点 ${pad2(state.startHour)}:00</text>`;
    for (let h = 0; h <= 24; h += 3) {
      const x = h * unit;
      svg += `<line x1="${x.toFixed(1)}" y1="36" x2="${x.toFixed(1)}" y2="40" stroke="#aaa"/>`;
      svg += `<text class="axis-tick" x="${x.toFixed(1)}" y="49" text-anchor="middle">${h}h</text>`;
    }
    svg += '</svg>'; return svg;
  }
  function renderAxisInfo(rk) {
    const { r1, r2 } = calcLogicalSegments(rk);
    const fmtEnd = b => b === 24 ? '24:00' : b > 24 ? pad2(b-24) + ':00（次日）' : pad2(b) + ':00';
    const fmtSeg = seg => `${pad2(seg[0] % 24)}:00-${fmtEnd(seg[1])}`;
    return `一轮 ${fmtSeg(r1)}，二轮 ${fmtSeg(r2)}`;
  }

  // ============ 渲染舱室配置 ============
  function renderRoomConfigs() {
    const area = document.getElementById('roomConfigArea'); if (!area) return;
    area.innerHTML = ROOM_KEYS.map(rk => renderRoomConfigCard(rk)).join('');
    bindRoomConfigEvents();
  }
  function renderRoomConfigCard(rk) {
    const c = roomConfigs[rk]; const label = ROOM_LABELS[rk];
    const disabledCls = c.enabled ? '' : 'disabled';
    const renderSlot = (round, idx) => {
      const name = c[round][idx]; const op = name ? getOperator(name) : null;
      if (op && op.eliteLevel !== 'none') {
        return `<div class="rc-slot filled" data-room="${rk}" data-round="${round}" data-idx="${idx}"><img src="${getAvatar(op.name)}" onerror="this.style.display='none';" alt=""><div class="rc-name">${esc(op.name)}</div></div>`;
      }
      return `<div class="rc-slot" data-room="${rk}" data-round="${round}" data-idx="${idx}">空位</div>`;
    };
    let productRow = ''; const need = ROOM_NEEDS_PRODUCT[rk];
    if (need === 'single') {
      const opts = PRODUCT_OPTIONS[rk]; const isMissing = c.enabled && !c.product;
      productRow = `<div class="rc-product-row ${isMissing ? 'missing' : ''}"><span class="rc-product-label">追踪素材</span>${opts.map(o => `<label><input type="radio" name="prod-${rk}" value="${o.value}" data-room="${rk}" data-type="single" ${c.product === o.value ? 'checked' : ''}> ${o.label}</label>`).join('')}</div>`;
    } else if (need === 'multi') {
      const opts = PRODUCT_OPTIONS[rk]; const isMissing = c.enabled && (!c.products || c.products.length === 0);
      productRow = `<div class="rc-product-row ${isMissing ? 'missing' : ''}"><span class="rc-product-label">追踪素材</span>${opts.map(o => `<label><input type="checkbox" value="${o.value}" data-room="${rk}" data-type="multi" ${c.products.includes(o.value) ? 'checked' : ''}> ${o.label}</label>`).join('')}</div>`;
    }
    const allNames = new Set();
    for (const rnd of ['round1','round2']) for (const n of c[rnd]) if (n) allNames.add(n);
    const moodRows = Array.from(allNames).map(name => {
      const v = initialMoods[name] !== undefined ? initialMoods[name] : 100;
      const w = initialWork[name] !== false;
      return `<div class="rc-mood-row"><span class="rc-mood-name">${esc(name)}</span><input type="number" min="0" max="100" value="${v}" data-name="${esc(name)}" class="rc-mood-input"><span style="color:#888;font-size:0.68rem;">%</span><label class="rc-mood-work" title="初始是否工作"><input type="checkbox" class="rc-work-toggle" data-name="${esc(name)}" ${w ? 'checked' : ''}> 工作</label></div>`;
    }).join('');
    const axisHtml = c.shiftEnabled ? `<div class="rc-axis-wrap">${renderShiftAxis(rk)}<div class="rc-axis-info">${renderAxisInfo(rk)}</div></div>` : '';
    return `<div class="rc-card ${disabledCls}" data-room="${rk}">
      <div class="rc-header"><div class="rc-title">${label}</div><div class="rc-checkboxes"><label><input type="checkbox" data-action="enable" data-room="${rk}" ${c.enabled ? 'checked' : ''}> 模拟</label><label><input type="checkbox" data-action="shift" data-room="${rk}" ${c.shiftEnabled ? 'checked' : ''}> 两轮</label></div></div>
      ${c.shiftEnabled ? `<div class="rc-shift-row"><span>一轮时长</span><input type="number" min="1" max="23" value="${c.shiftABHours}" data-action="ab" data-room="${rk}"><span>h，二轮时长</span><input type="number" min="1" max="23" value="${c.shiftBAHours}" data-action="ba" data-room="${rk}"><span>h</span></div>` : ''}
      ${axisHtml}${productRow}
      <div class="rc-round-block"><div class="rc-round-label"><span class="rc-dot"></span>一轮</div><div class="rc-slots">${[0,1,2].map(i => renderSlot('round1', i)).join('')}</div></div>
      ${c.shiftEnabled ? `<div class="rc-round-block"><div class="rc-round-label r2"><span class="rc-dot"></span>二轮</div><div class="rc-slots">${[0,1,2].map(i => renderSlot('round2', i)).join('')}</div></div>` : ''}
      <div class="rc-mood-toggle" data-action="toggle-mood"><span>心情设置（默认 100%）</span><span class="rc-mood-arrow">▼</span></div>
      <div class="rc-mood-body" id="rc-mood-${rk}">${moodRows || '<div style="font-size:0.7rem;color:#999;padding:4px 0;">暂无干员</div>'}</div>
    </div>`;
  }

  function bindRoomConfigEvents() {
    const area = document.getElementById('roomConfigArea'); if (!area) return;
    area.querySelectorAll('.rc-slot').forEach(el => el.addEventListener('click', function () {
      const rk = this.dataset.room; if (!roomConfigs[rk].enabled) return;
      openPicker(rk, this.dataset.round, parseInt(this.dataset.idx, 10));
    }));
    area.querySelectorAll('input[data-action="enable"]').forEach(cb => cb.addEventListener('change', function () {
      roomConfigs[this.dataset.room].enabled = this.checked;
      onConfigChanged(); renderRoomConfigs(); renderBoostConfigs();
    }));
    area.querySelectorAll('input[data-action="shift"]').forEach(cb => cb.addEventListener('change', function () {
      const rk = this.dataset.room; const c = roomConfigs[rk];
      c.shiftEnabled = this.checked; if (this.checked) c.shiftR2StartHour = c.shiftABHours;
      onConfigChanged(); renderRoomConfigs();
    }));
    area.querySelectorAll('input[data-action="ab"]').forEach(inp => inp.addEventListener('change', function () {
      const v = Math.max(1, Math.min(23, parseInt(this.value, 10) || 14));
      const rk = this.dataset.room; roomConfigs[rk].shiftABHours = v; roomConfigs[rk].shiftBAHours = 24 - v;
      onConfigChanged(); renderRoomConfigs();
    }));
    area.querySelectorAll('input[data-action="ba"]').forEach(inp => inp.addEventListener('change', function () {
      const v = Math.max(1, Math.min(23, parseInt(this.value, 10) || 10));
      const rk = this.dataset.room; roomConfigs[rk].shiftBAHours = v; roomConfigs[rk].shiftABHours = 24 - v;
      onConfigChanged(); renderRoomConfigs();
    }));
    area.querySelectorAll('input[data-type="single"]').forEach(inp => inp.addEventListener('change', function () {
      if (this.checked) { roomConfigs[this.dataset.room].product = this.value; saveRoomConfigs(); onConfigChanged(); renderRoomConfigs(); }
    }));
    area.querySelectorAll('input[data-type="multi"]').forEach(inp => inp.addEventListener('change', function () {
      const rk = this.dataset.room; const set = new Set(roomConfigs[rk].products);
      if (this.checked) set.add(this.value); else set.delete(this.value);
      roomConfigs[rk].products = Array.from(set); saveRoomConfigs(); onConfigChanged(); renderRoomConfigs();
    }));
    area.querySelectorAll('.rc-mood-toggle').forEach(t => t.addEventListener('click', function () {
      const rk = this.closest('.rc-card').dataset.room;
      const body = document.getElementById('rc-mood-' + rk);
      body.classList.toggle('open');
      this.querySelector('.rc-mood-arrow').textContent = body.classList.contains('open') ? '▲' : '▼';
    }));
    area.querySelectorAll('.rc-mood-input').forEach(inp => {
      inp.addEventListener('input', function () {
        let v = parseInt(this.value, 10); if (isNaN(v)) v = 0; v = Math.max(0, Math.min(100, v));
        initialMoods[this.dataset.name] = v;
        try { sessionStorage.setItem('DijiangStepInitialMood', JSON.stringify(initialMoods)); } catch (e) {}
      });
      inp.addEventListener('blur', function () {
        let v = parseInt(this.value, 10); if (isNaN(v)) v = 0; v = Math.max(0, Math.min(100, v));
        this.value = v; initialMoods[this.dataset.name] = v;
        try { sessionStorage.setItem('DijiangStepInitialMood', JSON.stringify(initialMoods)); } catch (e) {}
      });
    });
    area.querySelectorAll('.rc-work-toggle').forEach(cb => cb.addEventListener('change', function () {
      initialWork[this.dataset.name] = this.checked;
      try { sessionStorage.setItem('DijiangStepInitialWork', JSON.stringify(initialWork)); } catch (e) {}
    }));
    area.querySelectorAll('.axis-seg-draggable').forEach(el => {
      el.addEventListener('mousedown', startAxisDrag);
      el.addEventListener('touchstart', startAxisDrag, { passive:false });
    });
  }

  // ============ 助力 UI ============
  function renderBoostDayTabs() {
    const el = document.getElementById('boostDayTabs'); if (!el) return;
    const n = getMaxBoostDays();
    let html = '';
    for (let i = 0; i < n; i++) html += `<button class="boost-day-tab ${i === boostConfigs.currentDay ? 'active' : ''}" data-day="${i}">第 ${i+1} 天</button>`;
    el.innerHTML = html;
    el.querySelectorAll('.boost-day-tab').forEach(btn => btn.onclick = function () {
      boostConfigs.currentDay = parseInt(this.dataset.day, 10);
      saveBoostConfigs(); renderBoostConfigs();
    });
  }

  function renderBoostConfigs() {
    const countSel = document.getElementById('dailyBoostCount'); if (!countSel) return;
    countSel.value = boostConfigs.dailyCount;
    ensureBoostDays();
    renderBoostDayTabs();
    const container = document.getElementById('boostConfigList'); if (!container) return;
    const dayCfg = getCurrentBoostDay();
    const scheduledNames = collectAllNames();
    let html = '';
    for (let i = 0; i < boostConfigs.dailyCount; i++) {
      const cfg = dayCfg.list[i];
      const targetOp = cfg.target ? getOperator(cfg.target) : null;
      const isTargetValid = targetOp && scheduledNames.has(targetOp.name);
      const targetDisplay = isTargetValid ? targetOp.name : '选择干员';
      html += `<div class="boost-config-row">
        <span>第 ${i+1} 次助力：</span>
        <input type="number" class="boost-hour" data-idx="${i}" value="${cfg.hour}" min="0" max="23"> 时
        <input type="number" class="boost-minute" data-idx="${i}" value="${cfg.minute}" min="0" max="59"> 分
        <button class="boost-target-btn ${isTargetValid ? 'has-target' : ''}" data-idx="${i}">${targetDisplay}</button>
        ${isTargetValid ? `<span class="boost-target-level">(${targetOp.eliteLevel})</span>` : ''}
      </div>`;
    }
    container.innerHTML = html;

    countSel.onchange = function () {
      boostConfigs.dailyCount = parseInt(this.value, 10);
      ensureBoostDays(); saveBoostConfigs(); renderBoostConfigs();
    };
    container.querySelectorAll('.boost-hour').forEach(inp => inp.onchange = function () {
      let v = parseInt(this.value, 10); if (isNaN(v)) v = 0;
      dayCfg.list[this.dataset.idx].hour = Math.max(0, Math.min(23, v));
      this.value = dayCfg.list[this.dataset.idx].hour; saveBoostConfigs();
    });
    container.querySelectorAll('.boost-minute').forEach(inp => inp.onchange = function () {
      let v = parseInt(this.value, 10); if (isNaN(v)) v = 0;
      dayCfg.list[this.dataset.idx].minute = Math.max(0, Math.min(59, v));
      this.value = dayCfg.list[this.dataset.idx].minute; saveBoostConfigs();
    });
    container.querySelectorAll('.boost-target-btn').forEach(btn => btn.onclick = function () {
      openPicker('boost', null, parseInt(this.dataset.idx, 10));
    });
  }

  // ============ 干员选择弹窗 ============
  function openPicker(roomKey, roundKey, idx) {
    pickerCtx = { roomKey, roundKey, idx };
    if (roomKey === 'boost') document.getElementById('opPickerTitle').textContent = `选择助力目标 · 第 ${boostConfigs.currentDay + 1} 天 · 第 ${idx + 1} 次`;
    else document.getElementById('opPickerTitle').textContent = `选择干员 · ${ROOM_LABELS[roomKey]} ${roundKey === 'round1' ? '一轮' : '二轮'} 槽位 ${idx + 1}`;
    renderPickerGrid();
    document.getElementById('opPickerOverlay').classList.add('open');
  }
  function closePicker() { document.getElementById('opPickerOverlay').classList.remove('open'); pickerCtx = null; }
  function collectAllNames() {
    const set = new Set();
    for (const rk of ROOM_KEYS) for (const rnd of ['round1','round2']) for (const n of roomConfigs[rk][rnd]) if (n) set.add(n);
    return set;
  }
  function renderPickerGrid() {
    if (!pickerCtx) return;
    const grid = document.getElementById('opPickerGrid');
    const star = document.getElementById('opStarFilter').value;
    const attr = document.getElementById('opAttrFilter').value;
    const isBoost = pickerCtx.roomKey === 'boost';
    const scheduledSet = collectAllNames();
    let currentName = null;
    if (isBoost) currentName = getCurrentBoostDay().list[pickerCtx.idx].target;
    else currentName = roomConfigs[pickerCtx.roomKey][pickerCtx.roundKey][pickerCtx.idx];

    const filtered = operators.filter(op => {
      if (op.eliteLevel === 'none') return false;
      if (star !== 'all' && op.star !== star) return false;
      if (attr !== 'all' && op.attribute !== attr) return false;
      if (isBoost && !scheduledSet.has(op.name)) return false;
      return true;
    });
    if (filtered.length === 0) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;padding:30px 0;">没有符合条件的干员</div>'; return; }
    grid.innerHTML = filtered.map(op => {
      const isSel = op.name === currentName;
      const isSch = !isBoost && scheduledSet.has(op.name) && !isSel;
      const cls = ['picker-card', isSel ? 'is-selected' : '', isSch ? 'is-scheduled' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" data-name="${esc(op.name)}"><div class="picker-elite">${esc(op.eliteLevel)}</div>${isSch ? '<div class="picker-scheduled-tag">已排</div>' : ''}<img class="picker-avatar" src="${getAvatar(op.name)}" onerror="this.style.display='none';" alt=""><div class="picker-name">${esc(op.name)}</div></div>`;
    }).join('');
    grid.querySelectorAll('.picker-card').forEach(card => card.addEventListener('click', function () {
      const name = this.dataset.name;
      if (isBoost) {
        getCurrentBoostDay().list[pickerCtx.idx].target = name;
        saveBoostConfigs(); renderBoostConfigs(); closePicker(); return;
      }
      for (const rk of ROOM_KEYS) for (const rnd of ['round1','round2']) for (let i = 0; i < 3; i++) if (roomConfigs[rk][rnd][i] === name) roomConfigs[rk][rnd][i] = null;
      roomConfigs[pickerCtx.roomKey][pickerCtx.roundKey][pickerCtx.idx] = name;
      onConfigChanged(); renderRoomConfigs(); closePicker();
    }));
  }

  function startAxisDrag(e) {
    e.preventDefault();
    const el = e.currentTarget; const svg = el.closest('svg'); const rk = el.dataset.room;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const mouseH = ((clientX - rect.left) / rect.width) * 24;
    const s = roomConfigs[rk].shiftR2StartHour;
    let offset = mouseH - s; while (offset > 12) offset -= 24; while (offset < -12) offset += 24;
    axisDrag = { rk, rect, svg, offset };
    document.addEventListener('mousemove', onAxisDragMove);
    document.addEventListener('mouseup', onAxisDragUp);
    document.addEventListener('touchmove', onAxisDragMove, { passive:false });
    document.addEventListener('touchend', onAxisDragUp);
  }
  function onAxisDragMove(e) {
    if (!axisDrag) return; if (e.cancelable) e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rk = axisDrag.rk;
    const mouseH = ((clientX - axisDrag.rect.left) / axisDrag.rect.width) * 24;
    let sNew = Math.round(mouseH - axisDrag.offset); sNew = ((sNew % 24) + 24) % 24;
    if (sNew === roomConfigs[rk].shiftR2StartHour) return;
    roomConfigs[rk].shiftR2StartHour = sNew;
    const wrap = axisDrag.svg.closest('.rc-card').querySelector('.rc-axis-wrap');
    if (wrap) {
      wrap.innerHTML = renderShiftAxis(rk) + `<div class="rc-axis-info">${renderAxisInfo(rk)}</div>`;
      wrap.querySelectorAll('.axis-seg-draggable').forEach(el => {
        el.addEventListener('mousedown', startAxisDrag);
        el.addEventListener('touchstart', startAxisDrag, { passive:false });
      });
      axisDrag.svg = wrap.querySelector('svg');
      axisDrag.rect = axisDrag.svg.getBoundingClientRect();
    }
  }
  function onAxisDragUp() {
    if (!axisDrag) return; saveRoomConfigs();
    document.removeEventListener('mousemove', onAxisDragMove);
    document.removeEventListener('mouseup', onAxisDragUp);
    document.removeEventListener('touchmove', onAxisDragMove);
    document.removeEventListener('touchend', onAxisDragUp);
    axisDrag = null; onConfigChanged();
  }

  // ============================================================
  //                    事件驱动模拟核心
  // ============================================================
  function buildSimulationState() {
    state.tSec = 0;
    state.maxTSec = parseInt(document.getElementById('maxHours').value, 10) * 3600;
    state.sampleSec = parseInt(document.getElementById('sampleSec').value, 10) || 60;
    let v = parseInt((document.getElementById('startHour').value || '').trim(), 10);
    if (isNaN(v)) v = 8;
    state.startHour = Math.max(0, Math.min(23, v));
    state.speed = parseInt(document.getElementById('speedSel').value, 10) || 100;
    state.ops = []; state.rooms = {}; state.output = {}; state.workTimeSec = {};
    state.history = []; state.log = []; state.lastMoodEvent = {}; state.nextSampleSec = 0; state.ended = false;

    // ★ 按自然日生成助力事件
    state.boosts = [];
    ensureBoostDays();
    const tAbsStart = state.startHour * 3600;
    const tAbsEnd = tAbsStart + state.maxTSec;
    const baseDayStart = Math.floor(tAbsStart / 86400) * 86400;
    let dayStart = baseDayStart, relDay = 0;
    while (dayStart <= tAbsEnd) {
      const dayCfg = boostConfigs.days[relDay] || boostConfigs.days[boostConfigs.days.length - 1];
      if (dayCfg) {
        const list = dayCfg.list.slice(0, boostConfigs.dailyCount);
        for (const b of list) {
          if (!b.target) continue;
          const tAbs = dayStart + b.hour * 3600 + b.minute * 60;
          if (tAbs >= tAbsStart && tAbs <= tAbsEnd) {
            state.boosts.push({ tSec: tAbs - tAbsStart, target: b.target, triggered: false });
          }
        }
      }
      dayStart += 86400; relDay++;
    }
    state.boosts.sort((a, b) => a.tSec - b.tSec);

    for (const rk of ROOM_KEYS) {
      const c = roomConfigs[rk]; if (!c.enabled) continue;
      const r1 = c.round1;
      const r2 = c.shiftEnabled ? c.round2 : [null,null,null];
      const hasRound2 = !!c.shiftEnabled;
      const shiftABSec = c.shiftABHours * 3600;
      const shiftBASec = c.shiftBAHours * 3600;
      let initialRound = 'round1', nextSwitchAtSec = null;
      if (hasRound2) { initialRound = roundAtHour(rk, state.startHour); nextSwitchAtSec = nextSwitchSec(rk, state.startHour); }
      state.rooms[rk] = { activeRound: initialRound, shiftEnabled: hasRound2, paused: false, shiftABSec, shiftBASec, nextSwitchAtSec };
      if (rk === 'culture') {
        state.output[rk] = {};
        for (const p of (c.products || [])) state.output[rk][p] = 0;
      } else state.output[rk] = 0;
      state.workTimeSec[rk] = 0;

      const seen = new Set();
      for (const [round, list] of [['round1', r1], ['round2', r2]]) {
        for (const name of list) {
          if (!name || seen.has(name)) continue; seen.add(name);
          const op = getOperator(name); if (!op) continue;
          const traits = getGroupedTraits(op).filter(t => t.舱室 === ROOM_RAW[rk]);
          let reduce = 0; const effMap = {};
          for (const t of traits) {
            const val = t.数值 || 0;
            if (t.类型 === '心情消耗减少') { reduce += val; continue; }
            if (rk === 'central' && t.类型 === '心情恢复提升') effMap.restore = (effMap.restore || 0) + val;
            else if (rk === 'manufactA' || rk === 'manufactB') {
              if (t.类型 === '干员素材效率') effMap.exp = (effMap.exp || 0) + val;
              if (t.类型 === '武器素材效率') effMap.weapon = (effMap.weapon || 0) + val;
            } else if (rk === 'culture') {
              if (t.类型 === '矿物效率') effMap.mineral = (effMap.mineral || 0) + val;
              if (t.类型 === '菌类效率') effMap.fungi = (effMap.fungi || 0) + val;
              if (t.类型 === '晶植效率') effMap.plant = (effMap.plant || 0) + val;
            } else if (rk === 'meeting') {
              if (t.类型 === '收集线索效率') effMap.clue = (effMap.clue || 0) + val;
            }
          }
          const im = initialMoods[name] !== undefined ? initialMoods[name] : 100;
          const iw = initialWork[name] !== false;
          const isActiveInitially = round === initialRound;
          const willWork = isActiveInitially && iw && im > 0;
          state.ops.push({ name, roomKey: rk, round, mood: im, working: willWork, wantWork: iw && im > 0, reduce, effMap, isActive: isActiveInitially });
          state.lastMoodEvent[name] = im <= 0 ? 'zero' : im >= 100 ? 'full' : null;
        }
      }
    }
    logEvent('start', `▶ 模拟开始（事件驱动 · 精度 1s）：起点 ${pad2(state.startHour)}:00，时长 ${fmtDur(state.maxTSec)}，采样 ${state.sampleSec}s`);
    for (const rk of ROOM_KEYS) {
      if (!state.rooms[rk]) continue;
      const room = state.rooms[rk];
      const names1 = state.ops.filter(o => o.roomKey === rk && o.round === 'round1').map(o => o.name);
      const shiftInfo = room.shiftEnabled ? `（一轮 ${room.shiftABSec/3600}h，二轮 ${room.shiftBASec/3600}h）` : '（不轮班）';
      logEvent('start', `   ${ROOM_LABELS[rk]}${shiftInfo} 一轮：${names1.join(' / ') || '空'}`, rk);
      if (room.shiftEnabled) {
        const names2 = state.ops.filter(o => o.roomKey === rk && o.round === 'round2').map(o => o.name);
        logEvent('start', `   ${ROOM_LABELS[rk]} 二轮：${names2.join(' / ') || '空'}`, rk);
      }
    }
    recordSampleAt(0); state.nextSampleSec = state.sampleSec;
  }

  function logEvent(type, text, room) {
    state.log.push({ type, tSec: state.tSec, text, room });
    if (state.log.length > 2000) state.log.shift();
  }
  function calcCentralBonus() {
    const room = state.rooms.central; if (!room || room.paused) return 0;
    const ar = room.activeRound; let sum = 0;
    for (const op of state.ops) {
      if (op.roomKey !== 'central' || op.round !== ar) continue;
      if (op.mood <= 0 || !op.wantWork) continue;
      sum += op.effMap.restore || 0;
    }
    return sum;
  }
  function calcRoomReduce(rk) {
    const room = state.rooms[rk]; if (!room || room.paused) return 0;
    const ar = room.activeRound; let sum = 0;
    for (const op of state.ops) {
      if (op.roomKey !== rk || op.round !== ar || !op.working) continue;
      sum += op.reduce;
    }
    return sum;
  }
  function calcRoomRate(rk) {
    const room = state.rooms[rk]; if (!room || room.paused) return 0;
    const ar = room.activeRound; const c = roomConfigs[rk];
    let eff = 0, N = 0;
    for (const op of state.ops) {
      if (op.roomKey !== rk || op.round !== ar) continue;
      if (op.mood <= 0 || !op.wantWork) continue;
      N++;
      if (rk === 'central') eff += op.effMap.restore || 0;
      else if (rk === 'manufactA' || rk === 'manufactB') { const k = c.product; if (k) eff += op.effMap[k] || 0; }
      else if (rk === 'culture') { for (const p of c.products || []) eff += op.effMap[p] || 0; }
      else if (rk === 'meeting') eff += op.effMap.clue || 0;
    }
    if (N === 0) return 0;
    return (1 + eff / 100) * (1 + 0.4 * N);
  }
  function calcRoomRateByProduct(rk, product) {
    const room = state.rooms[rk]; if (!room || room.paused) return 0;
    const ar = room.activeRound; let eff = 0, N = 0;
    for (const op of state.ops) {
      if (op.roomKey !== rk || op.round !== ar) continue;
      if (op.mood <= 0 || !op.wantWork) continue;
      N++; eff += op.effMap[product] || 0;
    }
    if (N === 0) return 0;
    return (1 + eff / 100) * (1 + 0.4 * N);
  }

  function nextMoodEventSec(op, centralBonus) {
    if (op.working && op.mood > 0) {
      const roomReduce = calcRoomReduce(op.roomKey);
      const cw = C_WORK_PER_SEC * (1 - roomReduce / 100);
      if (cw <= 0) return Infinity;
      return state.tSec + op.mood / cw;
    }
    if (!op.working && op.mood < 100) {
      const cr = C_REST_PER_SEC * (1 + centralBonus / 100);
      if (cr <= 0) return Infinity;
      return state.tSec + (100 - op.mood) / cr;
    }
    return Infinity;
  }
  function findNextEventSec() {
    let tNext = state.maxTSec;
    for (const rk of ROOM_KEYS) {
      const room = state.rooms[rk];
      if (!room || !room.shiftEnabled) continue;
      if (room.nextSwitchAtSec != null) tNext = Math.min(tNext, room.nextSwitchAtSec);
    }
    if (state.boosts) for (const boost of state.boosts) {
      if (!boost.triggered && boost.tSec >= state.tSec) tNext = Math.min(tNext, boost.tSec);
    }
    const cb = calcCentralBonus();
    for (const op of state.ops) { const t = nextMoodEventSec(op, cb); if (t < tNext) tNext = t; }
    if (state.nextSampleSec < tNext) tNext = state.nextSampleSec;
    return tNext;
  }
  function advanceTo(tSec) {
    const dtSec = tSec - state.tSec; if (dtSec <= 0) return;
    const cb = calcCentralBonus();
    const roomReduces = {};
    for (const rk of ROOM_KEYS) roomReduces[rk] = calcRoomReduce(rk);
    for (const op of state.ops) {
      const room = state.rooms[op.roomKey]; if (!room || room.paused) continue;
      if (op.working) {
        const cw = C_WORK_PER_SEC * (1 - (roomReduces[op.roomKey] || 0) / 100);
        op.mood = Math.max(0, op.mood - cw * dtSec);
      } else {
        const cr = C_REST_PER_SEC * (1 + cb / 100);
        op.mood = Math.min(100, op.mood + cr * dtSec);
      }
    }
    for (const rk of ROOM_KEYS) {
      if (rk === 'central') continue;
      const room = state.rooms[rk]; if (!room || room.paused) continue;
      const hasWorker = state.ops.some(o => o.roomKey === rk && o.round === room.activeRound && o.working);
      if (hasWorker) {
        if (rk === 'culture') {
          const c = roomConfigs[rk];
          if (!state.output[rk] || typeof state.output[rk] !== 'object') state.output[rk] = {};
          for (const p of (c.products || [])) {
            const rate = calcRoomRateByProduct(rk, p);
            state.output[rk][p] = (state.output[rk][p] || 0) + rate * (dtSec / 3600);
          }
        } else {
          const rate = calcRoomRate(rk);
          state.output[rk] += rate * (dtSec / 3600);
        }
        state.workTimeSec[rk] += dtSec;
      }
    }
    state.tSec = tSec;
  }
  function processEventsAt(tSec) {
    let needExtraSample = false;
    if (state.boosts) for (const boost of state.boosts) {
      if (!boost.triggered && Math.abs(boost.tSec - tSec) < EPS) {
        boost.triggered = true;
        const op = state.ops.find(o => o.name === boost.target);
        if (op) {
          const oldMood = op.mood;
          op.mood = Math.min(100, op.mood + 30);
          logEvent('boost', `⚡ 助力：${op.name}（${ROOM_LABELS[op.roomKey]}）心情 +30（${oldMood.toFixed(1)}% → ${op.mood.toFixed(1)}%）`, op.roomKey);
          needExtraSample = true;
        }
      }
    }
    for (const op of state.ops) {
      if (op.working && op.mood <= EPS) { op.mood = 0; op.working = false; op.wantWork = false; needExtraSample = true; }
      else if (!op.working && op.mood >= 100 - EPS) {
        op.mood = 100; op.wantWork = true;
        const room = state.rooms[op.roomKey];
        if (room && !room.paused && op.round === room.activeRound) { op.working = true; needExtraSample = true; }
      }
    }
    for (const op of state.ops) {
      const last = state.lastMoodEvent[op.name];
      if (op.mood <= EPS && last !== 'zero') { logEvent('mood-zero', `💤 ${op.name}（${ROOM_LABELS[op.roomKey]}）心情归零`, op.roomKey); state.lastMoodEvent[op.name] = 'zero'; }
      else if (op.mood >= 100 - EPS && last !== 'full') { logEvent('mood-full', `☀️ ${op.name}（${ROOM_LABELS[op.roomKey]}）心情回满`, op.roomKey); state.lastMoodEvent[op.name] = 'full'; }
      else if (op.mood > EPS && op.mood < 100 - EPS && last) state.lastMoodEvent[op.name] = null;
    }
    for (const rk of ROOM_KEYS) {
      const room = state.rooms[rk]; if (!room || !room.shiftEnabled) continue;
      if (room.nextSwitchAtSec != null && tSec >= room.nextSwitchAtSec - EPS) {
        const from = room.activeRound, to = from === 'round1' ? 'round2' : 'round1';
        room.activeRound = to;
        for (const op of state.ops) {
          if (op.roomKey !== rk) continue;
          if (op.round === to && op.mood > 0) { op.wantWork = true; op.working = true; }
          else op.working = false;
        }
        logEvent('switch', `🔄 ${ROOM_LABELS[rk]} ${from === 'round1' ? '一轮' : '二轮'} → ${to === 'round1' ? '一轮' : '二轮'}`, rk);
        room.nextSwitchAtSec = tSec + (to === 'round2' ? room.shiftBASec : room.shiftABSec);
        needExtraSample = true;
      }
    }
    if (tSec >= state.nextSampleSec - EPS) { recordSampleAt(tSec); state.nextSampleSec += state.sampleSec; }
    else if (needExtraSample) recordSampleAt(tSec);
  }
  function processNextEvent() {
    if (state.ended) return false;
    if (checkSimulationEnd()) { renderAll(); return false; }
    let tNext = Math.ceil(findNextEventSec() - EPS);
    if (tNext > state.maxTSec) tNext = state.maxTSec;
    if (tNext <= state.tSec) tNext = state.tSec + 1;
    advanceTo(tNext); processEventsAt(tNext); checkSimulationEnd();
    return !state.ended;
  }
  function recordSampleAt(tSec) {
    const moods = {}, workings = {};
    for (const op of state.ops) { moods[op.name] = op.mood; workings[op.name] = op.working; }
    const rates = {}, activeRounds = {};
    for (const rk of ROOM_KEYS) {
      if (!state.rooms[rk]) continue;
      activeRounds[rk] = state.rooms[rk].activeRound;
      if (rk === 'central') rates[rk] = { _total: calcCentralBonus() };
      else if (rk === 'culture') {
        const c = roomConfigs[rk], obj = {};
        for (const p of (c.products || [])) obj[p] = calcRoomRateByProduct(rk, p);
        rates[rk] = obj;
      } else rates[rk] = { _total: calcRoomRate(rk) };
    }
    state.history.push({ tSec, moods, workings, rates, activeRounds });
    if (state.history.length > 20000) state.history.shift();
  }
  function checkSimulationEnd() {
    if (state.ended) return false;
    if (state.tSec >= state.maxTSec - EPS) {
      if (state.nextSampleSec <= state.maxTSec) recordSampleAt(state.maxTSec);
      state.tSec = state.maxTSec;
      logEvent('end', '✅ 模拟结束');
      state.ended = true; stop(); return true;
    }
    return false;
  }

  // ============ 控制 ============
  function syncButtons() {
    const startBtn = document.getElementById('startBtn'), pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn'), fastBtn = document.getElementById('fastBtn');
    if (state.ended) {
      startBtn.disabled = true; pauseBtn.disabled = true; fastBtn.disabled = true;
      resetBtn.classList.add('step-btn-danger'); resetBtn.textContent = '⏹ 重置（模拟已结束）';
    } else if (state.running) {
      startBtn.disabled = true; pauseBtn.disabled = false; fastBtn.disabled = false;
      resetBtn.classList.remove('step-btn-danger'); resetBtn.textContent = '⏹ 重置';
    } else {
      startBtn.disabled = false; pauseBtn.disabled = true; fastBtn.disabled = false;
      resetBtn.classList.remove('step-btn-danger'); resetBtn.textContent = '⏹ 重置';
    }
  }
  function start() {
    if (state.running || state.ended) return;
    const missing = validateBeforeStart();
    if (missing.length > 0) { alert('请先设置以下舱室的追踪素材：\n\n' + missing.join('\n')); return; }
    if (state.ops.length === 0) buildSimulationState();
    state.running = true; state.ended = false; syncButtons();
    const tickMs = 100, tickRealSec = tickMs / 1000;
    state.timer = setInterval(() => {
      if (!state.running) return;
      const uiTargetSec = Math.min(state.maxTSec, state.tSec + state.speed * tickRealSec);
      let safety = 0;
      while (state.tSec < uiTargetSec && !state.ended && safety < 100000) {
        if (!processNextEvent()) break; safety++;
      }
      checkSimulationEnd(); renderAll();
    }, tickMs);
    renderAll();
  }
  function pause() {
    if (!state.running) return;
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    logEvent('pause', '⏸ 已暂停'); syncButtons(); renderAll();
  }
  function stop() {
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    syncButtons();
  }
  function reset() {
    stop(); state.ended = false; state.running = false;
    state.ops = []; state.rooms = {}; state.output = {}; state.workTimeSec = {};
    state.history = []; state.log = []; state.tSec = 0; state.nextSampleSec = 0;
    state.lastMoodEvent = {}; state.boosts = []; hideTooltip();
    document.getElementById('moodCharts').innerHTML = '<div class="chart-placeholder">点击「开始」后绘制</div>';
    document.getElementById('logList').innerHTML = '<div class="log-empty">暂无事件</div>';
    document.getElementById('statsArea').innerHTML = '<div class="stats-placeholder">尚未开始</div>';
    document.getElementById('roomsGrid').innerHTML = '<div class="rooms-placeholder">尚未开始</div>';
    document.getElementById('timelineFill').style.width = '0%';
    document.getElementById('timelineCursor').style.left = '0%';
    document.getElementById('timeInfo').textContent = '尚未开始';
    syncButtons();
  }
  function fastForward() {
    // 1. 如果正在运行，先暂停（否则 state.running=true 会直接 return，表现为"按钮失效"）
    if (state.running) {
      pause();
    }

    // 2. 如果模拟已结束，自动重置（用户意图是"从头快进到结束"）
    if (state.ended) {
      reset();
    }

    // 3. 参数校验
    const missing = validateBeforeStart();
    if (missing.length > 0) { alert('请先设置以下舱室的追踪素材：\n\n' + missing.join('\n')); return; }

    // 4. 初始化状态
    if (state.ops.length === 0) buildSimulationState();

    // 5. 推进到结束（提高 safety 上限，避免 96h + 多 boost 场景被打断）
    let safety = 0;
    const safetyLimit = 5000000;
    while (state.tSec < state.maxTSec && !state.ended && safety < safetyLimit) {
      if (!processNextEvent()) break;
      safety++;
    }

    // 6. 兜底：如果仍未结束（safety 到上限或 processNextEvent 异常返回），强制推进到末尾
    if (!state.ended && state.tSec < state.maxTSec) {
      advanceTo(state.maxTSec);
      processEventsAt(state.maxTSec);
    }

    // 7. 结束检查与刷新
    checkSimulationEnd();
    renderAll();
    console.log(`[步进模拟] 快进完成：tSec=${state.tSec}/${state.maxTSec}, safety=${safety}, ended=${state.ended}`);
  }

  // ============ 渲染：时间轴 ============
  function renderTimeline() {
    const pct = state.maxTSec > 0 ? (state.tSec / state.maxTSec) * 100 : 0;
    document.getElementById('timelineFill').style.width = pct + '%';
    document.getElementById('timelineCursor').style.left = pct + '%';
    const info = document.getElementById('timeInfo');
    if (state.ops.length === 0) info.textContent = '尚未开始';
    else info.textContent = `当前：${fmtTime(state.tSec)}（已模拟 ${fmtDur(state.tSec)} / 剩余 ${fmtDur(state.maxTSec - state.tSec)}）`;
  }

  // ============ 渲染：曲线 ============
  function renderCharts() {
    const container = document.getElementById('moodCharts'); if (!container) return;
    if (state.history.length === 0) { container.innerHTML = '<div class="chart-placeholder">点击「开始」后绘制</div>'; return; }
    const grouped = {}; for (const rk of ROOM_KEYS) grouped[rk] = [];
    for (const op of state.ops) { if (!grouped[op.roomKey]) grouped[op.roomKey] = []; grouped[op.roomKey].push(op); }
    let html = '';
    for (const rk of ROOM_KEYS) { if (grouped[rk] && grouped[rk].length) html += renderOneChart(rk, grouped[rk]); }
    container.innerHTML = html; bindChartHover();
  }
  function buildStepPolyline(samples, getVal, xs, ys) {
    const pts = []; let prevY = null;
    for (const s of samples) {
      const v = getVal(s); if (v == null) continue;
      const x = xs(s.tSec), y = ys(v);
      if (prevY === null) pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      else { pts.push(`${x.toFixed(1)},${prevY.toFixed(1)}`); pts.push(`${x.toFixed(1)},${y.toFixed(1)}`); }
      prevY = y;
    }
    return pts.join(' ');
  }
  function renderOneChart(rk, ops) {
    const W = 640, H = 240, padL = 44, padR = 56, padT = 12, padB = 24;
    const pw = W - padL - padR, ph = H - padT - padB;
    const isCentral = rk === 'central', isCulture = rk === 'culture';
    const cultureProducts = isCulture ? (roomConfigs[rk].products || []) : [];
    let rateMax = 0;
    for (const s of state.history) {
      const r = s.rates && s.rates[rk]; if (!r) continue;
      for (const k in r) { const v = r[k]; if (v > rateMax) rateMax = v; }
    }
    rateMax = rateMax * 1.15;
    rateMax = isCentral ? Math.max(10, Math.ceil(rateMax)) : Math.max(1, Math.ceil(rateMax * 10) / 10);
    const xs = tSec => padL + (tSec / state.maxTSec) * pw;
    const ysMood = v => padT + ph - (v / 100) * ph;
    const ysRate = v => padT + ph - (v / rateMax) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-room="${rk}">`;
    const totalH = state.maxTSec / 3600;
    const gs = totalH > 36 ? 12 : totalH > 16 ? 6 : 3;
    for (let h = 0; h <= totalH; h += gs) {
      const x = xs(h * 3600);
      svg += `<line class="chart-grid" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + ph}"/>`;
      svg += `<text class="chart-label" x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${h}h</text>`;
    }
    for (let v = 0; v <= 100; v += 25) {
      const y = ysMood(v);
      svg += `<line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + pw}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="chart-label" x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v}%</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const v = (rateMax / 4) * i, y = ysRate(v);
      const txt = isCentral ? v.toFixed(0) : v.toFixed(1);
      svg += `<text class="chart-label chart-label-rate" x="${padL + pw + 4}" y="${(y + 3).toFixed(1)}" text-anchor="start">${txt}</text>`;
    }
    svg += `<text class="chart-label chart-label-rate" x="${W - 4}" y="${padT + 8}" text-anchor="end" style="font-size:9px;fill:#e08a2c;">${isCentral ? '%/h' : '产率'}</text>`;
    for (const ev of state.log) {
      if (ev.type === 'switch' && ev.room === rk) {
        const x = xs(ev.tSec);
        svg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + ph}" stroke="#3f7e6b" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
      }
      if (ev.type === 'boost' && ev.room === rk) {
        const x = xs(ev.tSec);
        svg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + ph}" stroke="#f0b400" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
      }
    }
    for (const op of ops) {
      const color = colorForName(op.name); const pts = [];
      for (const s of state.history) {
        const v = s.moods[op.name]; if (v === undefined) continue;
        pts.push(`${xs(s.tSec).toFixed(1)},${ysMood(v).toFixed(1)}`);
      }
      if (pts.length >= 2) svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (isCulture) {
      for (const p of cultureProducts) {
        const color = PRODUCT_COLORS[p] || '#e08a2c';
        const pts = buildStepPolyline(state.history, s => { const r = s.rates[rk]; return r ? r[p] : null; }, xs, ysRate);
        if (pts) svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt"/>`;
      }
    } else {
      const pts = buildStepPolyline(state.history, s => { const r = s.rates[rk]; return r ? r._total : null; }, xs, ysRate);
      if (pts) svg += `<polyline points="${pts}" fill="none" stroke="#e08a2c" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt"/>`;
    }
    const cx = xs(state.tSec);
    svg += `<line x1="${cx.toFixed(1)}" y1="${padT}" x2="${cx.toFixed(1)}" y2="${padT + ph}" stroke="#c0392b" stroke-width="1.5"/>`;
    svg += `<line class="chart-hover-line" data-room="${rk}" x1="0" y1="${padT}" x2="0" y2="${padT + ph}" stroke="#222" stroke-width="1" opacity="0.5" style="display:none;pointer-events:none;"/>`;
    svg += `<rect class="chart-hover-area" data-room="${rk}" x="${padL}" y="${padT}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair;"/>`;
    svg += '</svg>';
    const legendMood = ops.map(op => `<span class="legend-item"><span class="legend-dot" style="background:${colorForName(op.name)}"></span>${esc(op.name)}</span>`).join('');
    let legendRate = '';
    if (isCulture) for (const p of cultureProducts) {
      const color = PRODUCT_COLORS[p] || '#e08a2c';
      legendRate += `<span class="legend-item"><span class="legend-line-rate" style="background:${color};height:2px;width:16px;display:inline-block;"></span>${PRODUCT_LABELS[p] || p}产率</span>`;
    } else legendRate = `<span class="legend-item"><span class="legend-line-rate total" style="height:2px;width:16px;display:inline-block;background:#e08a2c;"></span>${isCentral ? '恢复值' : '产率'}</span>`;
    return `<div class="mood-chart-card" data-room="${rk}"><div class="mood-chart-title">${ROOM_LABELS[rk]}</div><div class="mood-chart-svg">${svg}</div><div class="mood-chart-legend">${legendMood}${legendRate}</div></div>`;
  }

  // ============ 悬停 ============
  function ensureTooltip() {
    if (!hoverTooltipEl) { hoverTooltipEl = document.createElement('div'); hoverTooltipEl.className = 'chart-tooltip'; document.body.appendChild(hoverTooltipEl); }
    return hoverTooltipEl;
  }
  function hideTooltip() {
    if (hoverTooltipEl) hoverTooltipEl.style.display = 'none';
    document.querySelectorAll('.chart-hover-line').forEach(el => el.style.display = 'none');
  }
  function bindChartHover() {
    const container = document.getElementById('moodCharts'); if (!container) return;
    container.querySelectorAll('.chart-hover-area').forEach(area => {
      area.addEventListener('mousemove', onChartHover);
      area.addEventListener('mouseleave', hideTooltip);
    });
  }
  function onChartHover(e) {
    const area = e.currentTarget, svg = area.closest('svg'), rk = area.dataset.room;
    const rect = svg.getBoundingClientRect();
    const W = 640, padL = 44, padR = 56, pw = W - padL - padR;
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const innerX = svgX - padL;
    if (innerX < 0 || innerX > pw) { hideTooltip(); return; }
    const tSec = (innerX / pw) * state.maxTSec;
    const hist = state.history; if (!hist.length) return;
    let lo = 0, hi = hist.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (hist[mid].tSec < tSec) lo = mid + 1; else hi = mid; }
    let idx = lo;
    if (lo > 0 && Math.abs(hist[lo - 1].tSec - tSec) < Math.abs(hist[lo].tSec - tSec)) idx = lo - 1;
    const sample = hist[idx];
    const lineX = padL + (sample.tSec / state.maxTSec) * pw;
    const line = svg.querySelector('.chart-hover-line');
    if (line) { line.setAttribute('x1', lineX); line.setAttribute('x2', lineX); line.style.display = ''; }
    const tooltip = ensureTooltip();
    const isCentral = rk === 'central', isCulture = rk === 'culture';
    const rates = sample.rates[rk] || {};
    let html = `<div class="chart-tooltip-title">${fmtTime(sample.tSec)}</div>`;
    if (isCulture) {
      for (const p of (roomConfigs[rk].products || [])) {
        const v = rates[p] != null ? rates[p] : 0;
        const color = PRODUCT_COLORS[p] || '#e08a2c';
        html += `<div class="chart-tooltip-row"><span class="label" style="color:${color};">${PRODUCT_LABELS[p] || p}</span><span class="val chart-tooltip-rate">${v.toFixed(2)}</span></div>`;
      }
    } else {
      const v = rates._total != null ? rates._total : 0;
      html += `<div class="chart-tooltip-row"><span class="label">${isCentral ? '恢复值' : '产率'}</span><span class="val chart-tooltip-rate">${isCentral ? '+' + v.toFixed(0) + '%/h' : v.toFixed(2)}</span></div>`;
    }
    html += `<div style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;">`;
    const sampleActiveRound = (sample.activeRounds && sample.activeRounds[rk]) || null;
    for (const op of state.ops) {
      if (op.roomKey !== rk) continue;
      const v = sample.moods[op.name]; if (v === undefined) continue;
      const isWorking = sample.workings ? !!sample.workings[op.name] : false;
      let st = '待命';
      if (sampleActiveRound && op.round === sampleActiveRound) st = isWorking ? '工作' : '休息';
      const roundTag = op.round === 'round2' ? 'Ⅱ' : '';
      html += `<div class="chart-tooltip-row"><span class="label">${esc(op.name)}${roundTag} · ${st}</span><span class="val">${v.toFixed(1)}%</span></div>`;
    }
    html += '</div>';
    tooltip.innerHTML = html; tooltip.style.display = 'block';
    const tipW = tooltip.offsetWidth, tipH = tooltip.offsetHeight;
    let tipX = e.clientX + 14, tipY = e.clientY + 14;
    if (tipX + tipW > window.innerWidth - 8) tipX = e.clientX - tipW - 14;
    if (tipY + tipH > window.innerHeight - 8) tipY = e.clientY - tipH - 14;
    tooltip.style.left = tipX + 'px'; tooltip.style.top = tipY + 'px';
  }

  // ============ 渲染：实时舱室 ============
  function renderRooms() {
    const c = document.getElementById('roomsGrid'); if (!c) return;
    if (state.ops.length === 0) { c.innerHTML = '<div class="rooms-placeholder">尚未开始</div>'; return; }
    let html = '';
    for (const rk of ROOM_KEYS) {
      const room = state.rooms[rk]; if (!room) continue;
      const roundL = room.activeRound === 'round1' ? '一轮' : '二轮';
      const roundCls = room.activeRound === 'round2' ? 'round2' : '';
      const pausedCls = room.paused ? 'paused' : '';
      const ops = state.ops.filter(o => o.roomKey === rk);
      const rows = ops.map(op => {
        const isActive = op.round === room.activeRound;
        const isWorking = isActive && op.working && !room.paused;
        const aCls = isWorking ? '' : 'inactive';
        const mPct = Math.max(0, Math.min(100, op.mood));
        const mCls = mPct < 30 ? 'low' : '';
        const sTxt = room.paused ? '暂停' : isWorking ? '工作' : isActive ? '休息' : '待命';
        const sCls = isWorking ? 'working' : 'resting';
        const rTag = op.round === 'round1' ? '' : '<span style="font-size:0.62rem;color:#b0885a;">Ⅱ</span>';
        return `<div class="op-row"><img class="op-avatar ${aCls}" src="${getAvatar(op.name)}" onerror="this.style.display='none';" alt=""><span class="op-name">${esc(op.name)}${rTag}</span><div class="op-mood-bar"><div class="op-mood-fill ${mCls}" style="width:${mPct.toFixed(2)}%"></div></div><span class="op-mood-text">${mPct.toFixed(1)}%</span><span class="op-status ${sCls}">${sTxt}</span></div>`;
      }).join('');
      let footer = '';
      if (rk === 'central') footer = `<span>总控恢复 <span class="stat-val">+${calcCentralBonus()}%</span>/h</span>`;
      else if (rk === 'culture') {
        const c2 = roomConfigs[rk], parts = [];
        for (const p of (c2.products || [])) {
          const r = calcRoomRateByProduct(rk, p);
          const cum = (state.output[rk] && state.output[rk][p]) || 0;
          parts.push(`${PRODUCT_LABELS[p] || p} <span class="stat-val">${r.toFixed(2)}</span>/h，累计 <span class="stat-val">${cum.toFixed(2)}</span>`);
        }
        footer = parts.join(' · ') + `<span>有效 <span class="stat-val">${fmtDur(state.workTimeSec[rk])}</span></span>`;
      } else {
        const rate = calcRoomRate(rk);
        const workH = state.workTimeSec[rk] / 3600;
        const avg = workH > 0 ? state.output[rk] / workH : 0;
        footer = `<span>产率 <span class="stat-val">${rate.toFixed(2)}</span></span><span>累计 <span class="stat-val">${state.output[rk].toFixed(2)}</span></span><span>均产 <span class="stat-val">${avg.toFixed(2)}</span>/h</span><span>有效 <span class="stat-val">${fmtDur(state.workTimeSec[rk])}</span></span>`;
      }
      html += `<div class="room-card ${pausedCls}"><div class="room-card-header"><div><span class="room-card-title">${ROOM_LABELS[rk]}</span>${room.shiftEnabled ? `<span class="room-card-round ${roundCls}">${roundL}</span>` : '<span class="room-card-round">不轮班</span>'}</div></div>${rows || '<div style="font-size:0.72rem;color:#999;text-align:center;padding:6px 0;">空舱</div>'}<div class="room-card-footer">${footer}</div></div>`;
    }
    c.innerHTML = html;
  }
  function renderLog() {
    const c = document.getElementById('logList'); if (!c) return;
    if (state.log.length === 0) { c.innerHTML = '<div class="log-empty">暂无事件</div>'; return; }
    c.innerHTML = state.log.map(ev => {
      let cls = '';
      if (ev.type === 'switch') cls = 'log-switch';
      else if (ev.type === 'end') cls = 'log-success';
      else if (ev.type === 'mood-zero') cls = 'log-warn';
      else if (ev.type === 'boost') cls = 'log-boost';
      return `<div class="log-line ${cls}"><span class="log-time">[${fmtTime(ev.tSec)}]</span><span>${esc(ev.text)}</span></div>`;
    }).join('');
    c.scrollTop = c.scrollHeight;
  }
  function renderStats() {
    const c = document.getElementById('statsArea'); if (!c) return;
    if (state.ops.length === 0) { c.innerHTML = '<div class="stats-placeholder">尚未开始</div>'; return; }
    let rows = '';
    for (const rk of ROOM_KEYS) {
      const room = state.rooms[rk]; if (!room) continue;
      if (rk === 'central') rows += `<tr><td>${ROOM_LABELS[rk]}</td><td class="num">—</td><td class="num">—</td><td class="num">+${calcCentralBonus()}%/h</td><td class="num">${fmtDur(state.workTimeSec[rk] || 0)}</td></tr>`;
      else if (rk === 'culture') {
        const c2 = roomConfigs[rk], workH = state.workTimeSec[rk] / 3600, lines = [];
        for (const p of (c2.products || [])) {
          const cum = (state.output[rk] && state.output[rk][p]) || 0;
          const avg = workH > 0 ? cum / workH : 0;
          lines.push(`${PRODUCT_LABELS[p] || p}：${cum.toFixed(2)}（${avg.toFixed(2)}/h）`);
        }
        rows += `<tr><td>${ROOM_LABELS[rk]}</td><td class="num" colspan="2">${lines.join('<br>')}</td><td class="num">—</td><td class="num">${fmtDur(state.workTimeSec[rk])}</td></tr>`;
      } else {
        const total = state.output[rk], workH = state.workTimeSec[rk] / 3600;
        const avg = workH > 0 ? total / workH : 0;
        rows += `<tr><td>${ROOM_LABELS[rk]}</td><td class="num">${total.toFixed(2)}</td><td class="num">${avg.toFixed(2)}/h</td><td class="num">—</td><td class="num">${fmtDur(state.workTimeSec[rk])}</td></tr>`;
      }
    }
    let opRows = '';
    for (const op of state.ops) {
      let minM = 100, maxM = 0;
      for (const s of state.history) { const v = s.moods[op.name]; if (v === undefined) continue; if (v < minM) minM = v; if (v > maxM) maxM = v; }
      opRows += `<tr><td>${esc(op.name)}（${ROOM_LABELS[op.roomKey]}）</td><td class="num">${minM.toFixed(1)}%</td><td class="num">${maxM.toFixed(1)}%</td><td class="num">${op.mood.toFixed(1)}%</td></tr>`;
    }
    c.innerHTML = `<table class="stats-table"><thead><tr><th>舱室</th><th>总产出</th><th>均产</th><th>恢复/产率</th><th>有效工作</th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:14px;font-size:0.8rem;color:#2a5a4a;font-weight:700;">干员心情</div><table class="stats-table" style="margin-top:4px;"><thead><tr><th>干员</th><th>最低</th><th>最高</th><th>结束</th></tr></thead><tbody>${opRows}</tbody></table>`;
  }
  function renderAll() { renderTimeline(); renderCharts(); renderRooms(); renderLog(); renderStats(); syncButtons(); }

  // ============ 绑定 ============
  function bindUI() {
    document.getElementById('startBtn').addEventListener('click', start);
    document.getElementById('pauseBtn').addEventListener('click', pause);
    document.getElementById('resetBtn').addEventListener('click', reset);
    document.getElementById('fastBtn').addEventListener('click', fastForward);
    document.getElementById('logClearBtn').addEventListener('click', () => { state.log = []; renderLog(); });
    document.getElementById('opPickerCloseBtn').addEventListener('click', closePicker);
    document.getElementById('opPickerOverlay').addEventListener('click', e => { if (e.target.id === 'opPickerOverlay') closePicker(); });
    document.getElementById('opStarFilter').addEventListener('change', renderPickerGrid);
    document.getElementById('opAttrFilter').addEventListener('change', renderPickerGrid);
    document.getElementById('opClearBtn').addEventListener('click', () => {
      if (!pickerCtx) return;
      if (pickerCtx.roomKey === 'boost') {
        getCurrentBoostDay().list[pickerCtx.idx].target = null;
        saveBoostConfigs(); renderBoostConfigs(); closePicker(); return;
      }
      roomConfigs[pickerCtx.roomKey][pickerCtx.roundKey][pickerCtx.idx] = null;
      onConfigChanged(); renderRoomConfigs(); closePicker();
    });
    document.getElementById('importFromManualBtn').addEventListener('click', () => {
      if (!confirm('从手动排班重新导入将覆盖当前舱室配置，是否继续？')) return;
      importFromManualSilent(); onConfigChanged(); renderRoomConfigs(); renderBoostConfigs();
    });
    document.getElementById('collapseAllBtn').addEventListener('click', function () {
      const area = document.getElementById('roomConfigArea');
      const collapsed = area.style.display === 'none';
      area.style.display = collapsed ? '' : 'none';
      this.textContent = collapsed ? '全部收起' : '全部展开';
    });
    document.getElementById('startHour').addEventListener('change', function () {
      let v = parseInt((this.value || '').trim(), 10); if (isNaN(v)) v = 8;
      v = Math.max(0, Math.min(23, v)); this.value = v; state.startHour = v;
      document.querySelectorAll('.rc-axis-wrap').forEach(wrap => {
        const rk = wrap.closest('.rc-card').dataset.room;
        if (roomConfigs[rk].shiftEnabled) {
          wrap.innerHTML = renderShiftAxis(rk) + `<div class="rc-axis-info">${renderAxisInfo(rk)}</div>`;
          wrap.querySelectorAll('.axis-seg-draggable').forEach(el => {
            el.addEventListener('mousedown', startAxisDrag);
            el.addEventListener('touchstart', startAxisDrag, { passive:false });
          });
        }
      });
      onConfigChanged(); renderBoostConfigs();
    });
    // ★ 时长变化时重算助力天数
    document.getElementById('maxHours').addEventListener('change', function () {
      renderBoostConfigs();
    });
  }

  // ============ 启动 ============
  async function init() {
    try { await loadSprite(); await loadData(); }
    catch (e) {
      console.error(e);
      document.getElementById('roomConfigArea').innerHTML = `<div class="rooms-placeholder" style="color:#c0392b;">❌ ${esc(e.message)}</div>`;
      return;
    }
    initRoomConfigs();
    renderRoomConfigs();
    renderBoostConfigs();
    bindUI();
    reset();
    console.log('[步进模拟] 初始化完成（v11 · 24/48/72/96h · 助力按天独立）');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
