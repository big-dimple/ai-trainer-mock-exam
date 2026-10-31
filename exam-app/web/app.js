'use strict';
/* ====== 常量 ====== */
const KP = {
  ethics: '职业道德与AI伦理', law: '法律法规与知识产权', office: '计算机与办公', security: 'AI安全与质量',
  bpm: '业务分析与流程', product: '产品与用户增长', pm: '项目管理', training: '培训与指导',
  ml: '机器学习', dl: '深度学习', algo: '数据结构与算法', data: '数据工程与智能训练',
  llm: '大模型与生成式AI', aisys: '智能系统设计',
};
const TYPE = { judge: '判断题', single: '单选题', multi: '多选题', short: '简答题', case: '实操/综合' };
const LETTERS = 'ABCDEFGH';
const Y26 = '2026样卷', Y25 = '2025真题';
const srcCls = q => q.src === Y26 ? 'y26' : q.src === Y25 ? 'y25' : 'new';
const isObj = q => ['judge', 'single', 'multi'].includes(q.type);
// focus: 该题型的 2026 样卷题全部入卷，余量从其他题按短板加权补足；only26: 只用样卷题（shuffle 时打乱题序，否则按原题号）
const EXAM_CFG = {
  y2026all: { name: '2026 样卷全题打乱卷（原题 83 道 · 72 分 · 65 分钟）', min: 65, only26: true, shuffle: true, parts: [['judge', 14, 0.5], ['single', 56, 0.5], ['multi', 7, 1], ['short', 6, 5]] },
  y2026obj: { name: '2026 样卷客观题打乱卷（原题 77 道 · 42 分 · 35 分钟）', min: 35, only26: true, shuffle: true, parts: [['judge', 14, 0.5], ['single', 56, 0.5], ['multi', 7, 1]] },
  y2026raw: { name: '2026 样卷原卷（原题顺序 · 72 分 · 65 分钟）', min: 65, only26: true, parts: [['judge', 14, 0.5], ['single', 56, 0.5], ['multi', 7, 1], ['short', 6, 5]] },
  y2026: { name: '2026 模拟卷（样卷 83 道 + 补足 35 道 · 100 分 · 90 分钟，第二阶段用）', min: 90, focus: true, parts: [['judge', 20, 0.5], ['single', 80, 0.5], ['multi', 10, 1], ['short', 8, 5]] },
  standard: { name: '2025 框架模拟卷（100 分 · 90 分钟）', min: 90, parts: [['judge', 10, 1], ['single', 40, 1], ['multi', 5, 2], ['short', 4, 10]] },
  quick: { name: '快速小卷（36 分 · 30 分钟）', min: 30, parts: [['judge', 5, 1], ['single', 15, 1], ['multi', 3, 2], ['short', 1, 10]] },
  shortonly: { name: '简答专练卷（30 分 · 36 分钟，每题 5 分）', min: 36, focus: true, parts: [['short', 6, 5]] },
};
const PLAN = [
  '样卷客观题 77 题通刷（样卷解析页遮挡答案自测），错题进错题本',
  '样卷简答 6 题：先背参考答案骨架，再“样卷简答专练”限时作答 → 评卷',
  '样卷 B1.1 质检流程（25 分钟限时）+ B1.2 会议室 pandas（默写参考 notebook）',
  '样卷 B2 冷链随机森林：代码默写到 10 分钟内 + 任务三结论',
  '样卷 B3 能源调度（35 分钟限时）+ B4 客服培训（15 分钟）',
  '样卷 C 场馆客流（30 分钟限时）→ 评卷',
  '第 1 次“样卷全题打乱卷”→ 评卷；“刷未掌握的样卷题”',
  '未掌握样卷题清零 + 错题本清零',
  '样卷 B2 + B1.2 脱稿限时再做，对照 checklist 补漏',
  '第 2 次“样卷全题打乱卷” + 低于 90% 的简答重写',
  '样卷 B3 + C 脱稿限时再做',
  '样卷 B1.1 + B4 脱稿限时再做；低于 85 分的实操再练一遍',
  '第 3 次“样卷全题打乱卷”→ 对照看板“熟练标准”查漏',
  '样卷原卷全真模拟 + 参考答案通读；熟练标准全部达标后再进入变式题阶段',
];
const GATE = { objStreak: 3, fullExams: 2, shortPass: 0.9, casePass: 0.85 };

/* ====== 状态 ====== */
let BANK = [], BYID = {}, P = null, SESSION = null, TIMER = null, CONF = { llm: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 题库里大量“4~8 周”“24~27℃”这类区间写法，marked 会把成对的单个 ~ 当成删除线；代码块和行内代码之外的单个 ~ 转成实体
const tildeSafe = s => s.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((p, i) => i % 2 ? p : p.replace(/(^|[^~])~(?!~)/g, '$1&#126;')).join('');
const md = s => (window.marked ? marked.parse(tildeSafe(String(s || ''))) : '<pre>' + esc(s) + '</pre>');
const today = () => new Date().toLocaleDateString('sv-SE');
const nowStr = () => new Date().toLocaleString('sv-SE').replace(' ', 'T');
const fmtTime = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
const toast = (t, ms = 2200) => { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), ms); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ====== API ====== */
// 每个浏览器自动分配独立身份：进度/答卷按用户隔离，多人共用互不干扰
const UID = localStorage.getItem('examUid') || (() => {
  const u = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  localStorage.setItem('examUid', u);
  return u;
})();
const LS_KEY = 'progress_' + UID;
if (!localStorage.getItem(LS_KEY) && localStorage.getItem('progress'))
  localStorage.setItem(LS_KEY, localStorage.getItem('progress'));  // 从旧存档迁移一次
async function api(path, body) {
  const headers = { 'X-Exam-Uid': UID };
  const r = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}
let saveT = null;
function saveProgress() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(P));
    api('/api/progress', P).catch(() => { });
  }, 400);
}
const docCache = {};
async function loadDoc(name) {
  if (!docCache[name]) docCache[name] = api('/api/doc?name=' + encodeURIComponent(name)).then(r => r.text).catch(() => '（文档读取失败：' + name + '）');
  return docCache[name];
}
function docSection(text, anchor) {
  const lines = text.split('\n');
  const i = lines.findIndex(l => /^#{2,4}\s/.test(l) && l.includes(anchor));
  if (i < 0) return text;
  const lvl = lines[i].match(/^#+/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(new RegExp('^#{1,' + lvl + '}\\s').test(lines[j]))) j++;
  return lines.slice(i, j).join('\n');
}

/* ====== 进度与自适应 ====== */
function initProgress(p) {
  p = p && typeof p === 'object' ? p : {};
  p.settings = Object.assign({ examDate: '2026-11-11', planStart: today() }, p.settings || {});
  for (const k of ['q', 'kp', 'wrong', 'daily']) p[k] = p[k] || {};
  p.history = p.history || [];
  p.appliedFeedback = p.appliedFeedback || [];
  p.fbApplied = p.fbApplied || {};
  p.recite = p.recite || {};
  return p;
}
function kpAcc(kp) { const s = P.kp[kp]; return s ? (s.score + 1) / (s.seen + 2) : 0.5; }
function record(q, frac) {
  const s = P.q[q.id] || (P.q[q.id] = { seen: 0, score: 0, streak: 0, wrongCount: 0 });
  s.seen++; s.score += frac; s.last = frac; s.lastAt = nowStr();
  if (frac >= 0.999) s.streak++; else { s.streak = 0; s.wrongCount++; }
  const k = P.kp[q.kp] || (P.kp[q.kp] = { seen: 0, score: 0 });
  k.seen++; k.score += frac;
  if (q.type !== 'case') {
    if (frac < 0.999) P.wrong[q.id] = { at: nowStr(), times: (P.wrong[q.id]?.times || 0) + 1 };
    else if (P.wrong[q.id] && s.streak >= 2) delete P.wrong[q.id];
  }
  P.daily[today()] = (P.daily[today()] || 0) + 1;
  saveProgress();
}
function weight(q) {
  let w = 0.5 + 2.5 * (1 - kpAcc(q.kp));
  const s = P.q[q.id];
  if (!s) w *= 1.6;
  else {
    if (s.last < 0.999) w *= 3;
    if (s.streak >= 2) w *= 0.25;
  }
  if (q.src === Y26) w *= 3;
  else if (q.src === Y25) w *= 1.2;
  return w;
}
const mastered = q => (P.q[q.id]?.streak || 0) >= (q.src === Y26 ? GATE.objStreak : 2);
const passedSubj = (q, th) => (P.q[q.id]?.last ?? -1) >= th;
function y26Stats() {
  const objs = BANK.filter(q => q.src === Y26 && isObj(q));
  const shorts = BANK.filter(q => q.src === Y26 && q.type === 'short');
  const cases = BANK.filter(q => q.src === Y26 && q.type === 'case');
  const recent = P.history.filter(h => ['y2026all', 'y2026obj'].includes(h.cfg)).slice(-GATE.fullExams);
  const fullExams = recent.filter(h => h.objMax && h.objScore >= h.objMax).length;
  const s = {
    objs, subj: shorts.concat(cases), total: objs.length,
    mastered: objs.filter(mastered).length,
    seen: objs.filter(q => P.q[q.id]).length,
    wrong: objs.filter(q => P.wrong[q.id]).length,
    subjDone: shorts.concat(cases).filter(q => P.q[q.id]).length,
    shortOk: shorts.filter(q => passedSubj(q, GATE.shortPass)), shorts,
    caseOk: cases.filter(q => passedSubj(q, GATE.casePass)), cases,
    fullExams, recentN: recent.length,
  };
  s.gates = [
    [`客观题 ${s.total} 道每题连续答对 ≥ ${GATE.objStreak} 次`, s.mastered, s.total],
    [`最近 ${GATE.fullExams} 次打乱卷客观题满分`, fullExams, GATE.fullExams],
    [`简答 ${shorts.length} 道最近一次 ≥ ${GATE.shortPass * 5} 分`, s.shortOk.length, shorts.length],
    [`实操 ${cases.length} 道最近一次 ≥ ${GATE.casePass * 100} 分`, s.caseOk.length, cases.length],
  ];
  s.unlocked = s.gates.every(([, a, b]) => a >= b);
  if (s.unlocked && !P.settings.stage2At) { P.settings.stage2At = today(); saveProgress(); }
  return s;
}
function start26Unmastered() {
  const { objs } = y26Stats();
  const rest = objs.filter(q => !mastered(q));
  if (!rest.length) return startPracticeList(shuffle(objs), '2026 样卷客观题 · 全部已掌握，再巩固一遍');
  const rank = q => P.wrong[q.id] ? 0 : !P.q[q.id] ? 1 : 2;
  startPracticeList(shuffle(rest).sort((a, b) => rank(a) - rank(b)), `2026 样卷 · 未掌握 ${rest.length} 题（错题优先）`);
}
function pickWeighted(pool, n, adaptive = true) {
  return pool.map(q => ({ q, k: Math.pow(Math.random(), 1 / (adaptive ? weight(q) : 1)) }))
    .sort((a, b) => b.k - a.k).slice(0, n).map(x => x.q);
}

/* ====== 判分 ====== */
function gradeObjective(q, ans) {
  ans = ans || '';
  if (q.type === 'multi') {
    if (ans === q.answer) return 1;
    if (!ans) return 0;
    for (const c of ans) if (!q.answer.includes(c)) return 0;
    return 0.5;
  }
  return ans === q.answer ? 1 : 0;
}
function keywordScore(items, text) {
  const t = (text || '').toLowerCase();
  let got = 0, max = 0;
  const detail = items.map(r => {
    const hits = (r.keywords || []).filter(k => k && t.includes(String(k).toLowerCase()));
    const sc = r.score || 0;
    max += sc;
    const g = hits.length >= 2 ? sc : hits.length === 1 ? sc * 0.6 : 0;
    got += g;
    return { point: r.point || r.item, score: sc, got: Math.round(g * 10) / 10, hits };
  });
  return { got: Math.round(got * 10) / 10, max, detail };
}
const ansText = (q, a) => q.type === 'judge' ? (a === 'T' ? '正确' : a === 'F' ? '错误' : '未作答') : (a || '未作答');

/* ====== 路由 ====== */
const VIEWS = {};
function go(view, ...args) {
  if (SESSION && SESSION.running && view !== 'exam-run' && !confirm('考试进行中，离开会保留进度（可回到"模拟考试"继续）。确定离开？')) return;
  const tab = { 'case-run': 'cases', 'exam-run': 'exam', 'practice-run': 'practice', 'memorize-run': 'memorize' }[view] || view;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === tab));
  if (!view.startsWith('exam-run') && !view.startsWith('case-run')) stopTimer();
  window.scrollTo(0, 0);
  VIEWS[view](...args);
}
document.addEventListener('click', e => { const a = e.target.closest('#nav a'); if (a) go(a.dataset.view); });
function openModal(html, wide = false) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.toggle('wide', wide);
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function startTimer(endTs, onEnd) {
  stopTimer();
  const box = $('#timerbox'); box.classList.remove('hidden');
  const tick = () => {
    const left = (endTs - Date.now()) / 1000;
    box.textContent = '⏱ ' + fmtTime(left);
    box.classList.toggle('low', left < 300);
    if (left <= 0) { stopTimer(); onEnd(); }
  };
  tick(); TIMER = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(TIMER); TIMER = null; $('#timerbox').classList.add('hidden'); }

/* ====== 看板 ====== */
VIEWS.home = () => {
  const objCount = BANK.filter(q => ['judge', 'single', 'multi'].includes(q.type)).length;
  const shortCount = BANK.filter(q => q.type === 'short').length;
  const caseCount = BANK.filter(q => q.type === 'case').length;
  const seen = Object.keys(P.q).length;
  let tot = 0, sc = 0; Object.values(P.kp).forEach(k => { tot += k.seen; sc += k.score; });
  const acc = tot ? Math.round(sc / tot * 100) : 0;
  const daysLeft = Math.ceil((new Date(P.settings.examDate) - new Date(today())) / 86400000);
  const dayIdx = Math.min(13, Math.max(0, Math.floor((new Date(today()) - new Date(P.settings.planStart)) / 86400000)));
  const kps = Object.keys(KP).map(k => ({ k, acc: kpAcc(k), seen: P.kp[k]?.seen || 0, total: BANK.filter(q => q.kp === k).length }));
  const tried = kps.filter(x => x.seen > 0).sort((a, b) => a.acc - b.acc);
  const weak = tried.slice(0, 3);
  const untried = kps.filter(x => x.seen === 0 && x.total > 0);
  const wrongN = Object.keys(P.wrong).length;
  const color = a => a >= 0.85 ? 'var(--ok)' : a >= 0.7 ? '#65a30d' : a >= 0.55 ? 'var(--warn)' : 'var(--bad)';
  const ys = y26Stats();
  const pct = n => ys.total ? Math.round(n / ys.total * 100) : 0;
  const unmastered = ys.total - ys.mastered;
  const subjLeft = ys.shorts.filter(q => !ys.shortOk.includes(q)).concat(ys.cases.filter(q => !ys.caseOk.includes(q)));
  $('#view').innerHTML = `
  <div class="card" style="border:2px solid var(--pri);background:linear-gradient(180deg,#f0f4ff,#fff)">
    <div class="row"><h3 style="margin:0">🧠 背题强化（考前强记主模式）</h3><span class="label">看题自测 → 空格翻答案 → 标记记住/没记住；没记住的自动进错题本并加大抽中权重</span></div>
    <div class="row" style="margin-top:10px">
      <button class="btn pri" onclick="memQuick('unmastered')">先背未掌握样卷题（${unmastered}）</button>
      <button class="btn" onclick="memQuick('y26obj')">样卷客观题（${ys.objs.length}）</button>
      <button class="btn" onclick="memQuick('wrong')">错题本重背（${wrongN}）</button>
      <button class="btn" onclick="startExam('y2026all')">刷样卷打乱卷</button>
      <button class="btn" onclick="go('memorize')">自定义范围 →</button>
    </div>
  </div>
  <div class="card y26card">
    <div class="row"><h3 style="margin:0">🎯 2026 样卷 · 原题熟练</h3>
      ${ys.unlocked ? `<span class="tag ok">第二阶段 · 变式题（${esc(P.settings.stage2At)} 达标）</span>` : '<span class="tag y26">第一阶段 · 只练原题</span>'}
      <span class="spacer"></span><span class="label">${ys.unlocked ? '原题已熟练，可在 Cursor 聊天里说“出变式题”' : '四项熟练标准全部达标后，再进入变式题阶段'}</span></div>
    <div class="row" style="margin:10px 0 6px;align-items:baseline"><div class="stat">${ys.mastered}<small> / ${ys.total} 客观题已熟练（${pct(ys.mastered)}%）</small></div>
      <span class="label">做过 ${ys.seen} · 错题本中 ${ys.wrong} · 简答/实操练过 ${ys.subjDone} / ${ys.subj.length}</span></div>
    <div class="bar"><i style="width:${pct(ys.mastered)}%;background:var(--ok)"></i></div>
    <div class="gates">${ys.gates.map(([t, a, b]) => `<div class="${a >= b ? 'ok' : ''}">${a >= b ? '✅' : '⬜'} ${t}<b>${a} / ${b}</b></div>`).join('')}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn pri" onclick="startExam('y2026all')">样卷全题打乱卷（83 道原题）</button>
      <button class="btn" onclick="start26Unmastered()">刷未熟练的样卷客观题（${unmastered}）</button>
      <button class="btn" onclick="startExam('y2026obj')">客观题打乱卷</button>
      <button class="btn" onclick="startExam('shortonly')">样卷简答专练</button>
      <button class="btn" onclick="go('cases')">样卷实操 B/C${subjLeft.filter(q => q.type === 'case').length ? `（未达标 ${subjLeft.filter(q => q.type === 'case').length}）` : ''}</button>
      <button class="btn" onclick="startExam('y2026raw')">原题顺序全真</button>
      <button class="btn" onclick="RV.year='2026';go('review')">样卷解析</button>
      ${ys.unlocked ? `<button class="btn" onclick="startExam('y2026')">2026 模拟卷（含补足题）</button>` : ''}
    </div>
  </div>
  <div class="grid g4">
    <div class="card"><div class="label">距考试</div><div class="stat">${daysLeft}<small>天</small></div>
      <div class="label">考试日 <input type="date" id="examDate" value="${P.settings.examDate}" style="padding:2px 6px"></div></div>
    <div class="card"><div class="label">今日已做</div><div class="stat">${P.daily[today()] || 0}<small>题</small></div><div class="label">建议每天 ≥ 80 题客观题 + 1 道主观题</div></div>
    <div class="card"><div class="label">累计作答 / 题库覆盖</div><div class="stat">${tot}<small>次 · ${seen}/${BANK.length} 题</small></div><div class="label">总体得分率 ${acc}%</div></div>
    <div class="card"><div class="label">错题本</div><div class="stat">${wrongN}<small>题</small></div><a onclick="go('wrong')">去清错题 →</a></div>
  </div>
  <div class="grid g2">
    <div class="card">
      <h3 style="margin-top:0">今日任务（14 天计划 · 第 ${dayIdx + 1} 天）</h3>
      <ol class="plan">${PLAN.map((t, i) => `<li class="${i === dayIdx ? 'today' : i < dayIdx ? 'past' : ''}">D${i + 1}：${t}</li>`).join('')}</ol>
      <div class="label">计划起始日 <input type="date" id="planStart" value="${P.settings.planStart}" style="padding:2px 6px"></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">快速开始</h3>
      <div class="row" style="margin-bottom:10px">
        <button class="btn pri" onclick="startExam('y2026all')">样卷全题打乱卷</button>
        <button class="btn" onclick="startExam('quick')">30 分钟小卷</button>
        <button class="btn" onclick="startWeak()">弱项强化 30 题</button>
        <button class="btn" onclick="go('cases')">实操 B/C</button>
      </div>
      <h3>短板诊断</h3>
      ${weak.length ? weak.map(w => `<div>⚠️ <b>${KP[w.k]}</b> 得分率 ${Math.round(w.acc * 100)}%（${w.seen} 次）<a onclick="startPractice(['${w.k}'])"> 专练 →</a></div>`).join('') : '<div class="label">还没有作答数据，先做一套模拟卷吧。</div>'}
      ${untried.length ? `<div class="label" style="margin-top:8px">未练过：${untried.map(x => KP[x.k]).join('、')}</div>` : ''}
      <h3>题库</h3>
      <div class="label">客观题 ${objCount} · 简答 ${shortCount} · 实操/综合 ${caseCount}（2026 样卷 ${BANK.filter(q => q.src === Y26).length} 道 · 2025 真题 ${BANK.filter(q => q.src === Y25).length} 道）</div>
      <div class="notice" style="margin-top:10px">${CONF.llm ? `主观题交卷后由 <b>${esc(CONF.model)}</b> 自动评卷，结果在交卷页和“评卷记录”中显示。` : '服务端未配置评卷模型。'}需要按短板追加新题时，在 Cursor 聊天里说 <b>“评卷”</b>。</div>
    </div>
  </div>
  <div class="card"><h3 style="margin-top:0">知识点掌握度（越靠前越弱）</h3>
    ${kps.sort((a, b) => (a.seen ? a.acc : 2) - (b.seen ? b.acc : 2)).map(x => `<div class="kprow"><span>${KP[x.k]}</span>
      <div class="bar"><i style="width:${x.seen ? Math.round(x.acc * 100) : 0}%;background:${color(x.acc)}"></i></div>
      <span class="n">${x.seen ? Math.round(x.acc * 100) + '% · ' + x.seen + '次' : '未练'} / 库 ${x.total}</span></div>`).join('')}
  </div>`;
  $('#examDate').onchange = e => { P.settings.examDate = e.target.value; saveProgress(); VIEWS.home(); };
  $('#planStart').onchange = e => { P.settings.planStart = e.target.value; saveProgress(); VIEWS.home(); };
};

/* ====== 模拟考试 ====== */
VIEWS.exam = () => {
  const saved = JSON.parse(localStorage.getItem('session') || 'null');
  $('#view').innerHTML = `
  <h1>模拟考试</h1>
  ${saved && saved.running ? `<div class="notice" style="margin-bottom:16px">有未交卷的考试：${esc(saved.title)} <button class="btn sm pri" onclick="resumeExam()">继续作答</button> <button class="btn sm" onclick="localStorage.removeItem('session');go('exam')">放弃</button></div>` : ''}
  <div class="card">
    <h3 style="margin-top:0">组卷设置</h3>
    <div class="row" style="margin-bottom:12px">
      <label>试卷类型 <select id="cfg">${Object.entries(EXAM_CFG).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
      <label>补足题源 <select id="srcSel"><option value="all">全部（真题 + 新编）</option><option value="new">仅新编题</option><option value="y25">仅 2025 真题</option></select></label>
      <label><input type="checkbox" id="adaptive" checked> 按短板加权抽题</label>
    </div>
    <button class="btn pri" onclick="startExam($('#cfg').value,$('#srcSel').value,$('#adaptive').checked)">生成试卷并开始计时</button>
    <p class="label"><b>第一阶段（原题熟练）</b>：用“样卷全题打乱卷 / 客观题打乱卷”，只出 2026 样卷原题、每次打乱题序，分值按 2026 框架（判断、单选每题 0.5 分，多选 1 分且少选得一半，简答 5 分）。打乱卷的客观题连续 2 次满分是进入第二阶段的条件之一。<br>
    <b>第二阶段</b>：“2026 模拟卷”按完整 2026 框架出 118 题 100 分，样卷 83 道全部入卷，其余 35 道从“补足题源”按短板加权抽取。简答先按关键词预估，交卷后 AI 评卷修正。</p>
  </div>
  <div class="card"><h3 style="margin-top:0">历史成绩</h3>
    ${P.history.length ? P.history.slice().reverse().slice(0, 15).map(h => `<div class="list-item"><span class="tag">${esc(h.date)}</span><span>${esc(h.title)}</span><span class="spacer"></span><b>${h.score} / ${h.max}</b><span class="label">客观题 ${h.objScore}/${h.objMax}</span></div>`).join('') : '<div class="label">暂无</div>'}
  </div>`;
};
function buildPaper(cfgKey, src, adaptive) {
  const cfg = EXAM_CFG[cfgKey];
  const qs = [];
  for (const [type, n, pts] of cfg.parts) {
    const all = BANK.filter(q => q.type === type);
    let picked = [];
    if (cfg.only26 || cfg.focus) {
      const y26 = all.filter(q => q.src === Y26);
      picked = cfg.only26 && !cfg.shuffle ? y26.sort((a, b) => a.no - b.no).slice(0, n) : shuffle(y26).slice(0, n);
    }
    if (!cfg.only26 && picked.length < n) {
      let pool = cfg.focus ? all.filter(q => q.src !== Y26) : all;
      if (src === 'new') pool = pool.filter(q => q.src !== Y25 && q.src !== Y26);
      if (src === 'y25') pool = pool.filter(q => q.src === Y25);
      picked = cfg.focus ? shuffle(picked.concat(pickWeighted(pool, n - picked.length, adaptive))) : pickWeighted(pool, n, adaptive);
    }
    picked.forEach(q => qs.push({ id: q.id, pts }));
  }
  return { id: 'exam-' + Date.now(), kind: 'exam', cfg: cfgKey, title: cfg.name, questions: qs, answers: {}, marks: {}, start: Date.now(), end: Date.now() + cfg.min * 60000, running: true };
}
function startExam(cfgKey, src = 'all', adaptive = true) {
  SESSION = buildPaper(cfgKey, src, adaptive);
  persistSession();
  go('exam-run');
}
function startWeak() {
  const stage1 = !y26Stats().unlocked;
  const objs = BANK.filter(q => isObj(q) && (!stage1 || q.src === Y26));
  startPracticeList(pickWeighted(objs, 30, true), stage1 ? '弱项强化 30 题（第一阶段 · 只抽样卷原题）' : '弱项强化 30 题');
}
function resumeExam() { SESSION = JSON.parse(localStorage.getItem('session')); go('exam-run'); }
function persistSession() { localStorage.setItem('session', JSON.stringify(SESSION)); }

function optionHtml(q, i, state) {
  const L = LETTERS[i];
  return `<div class="opt ${state}" data-q="${q.id}" data-v="${L}"><b>${L}.</b><span>${esc(q.options[i])}</span></div>`;
}
function judgeOpts(q) { return [['T', '正确 ✓'], ['F', '错误 ✗']]; }

VIEWS['exam-run'] = () => {
  const S = SESSION;
  const groups = {};
  S.questions.forEach((x, i) => { const q = BYID[x.id]; if (!q) return; (groups[q.type] = groups[q.type] || []).push([x, i]); });
  let html = `<div class="exam-wrap"><div><h1>${esc(S.title)}</h1>`;
  for (const t of ['judge', 'single', 'multi', 'short']) {
    if (!groups[t]) continue;
    const pts = groups[t][0][0].pts;
    html += `<div class="secthead">${TYPE[t]}（共 ${groups[t].length} 题，每题 ${pts} 分）</div>`;
    for (const [x, i] of groups[t]) html += examQ(BYID[x.id], i, x.pts);
  }
  html += `<div class="row" style="margin:20px 0 60px"><button class="btn pri" onclick="submitExam()">交卷</button></div></div>
  <div class="side card">${sideBar(true)}<div class="label side-title">答题卡（橙框=标记）</div><div class="navgrid" id="navgrid"></div>
  <button class="btn pri side-submit-full" onclick="submitExam()">交卷</button></div></div>`;
  $('#view').innerHTML = html;
  bindExamInputs();
  refreshNav();
  startTimer(S.end, () => { toast('时间到，自动交卷'); submitExam(true); });
};
function examQ(q, i, pts) {
  const a = SESSION.answers[q.id] || '';
  let body = '';
  if (q.type === 'judge') body = judgeOpts(q).map(([v, t]) => `<div class="opt ${a === v ? 'sel' : ''}" data-q="${q.id}" data-v="${v}"><span>${t}</span></div>`).join('');
  else if (q.type === 'single' || q.type === 'multi') body = q.options.map((_, k) => optionHtml(q, k, a.includes(LETTERS[k]) ? 'sel' : '')).join('');
  else body = `<textarea data-q="${q.id}" placeholder="分点作答：先界定问题，再分层列要点，每点写“做什么 + 为什么/指标”">${esc(a)}</textarea>`;
  return `<div class="q" id="q-${i}"><div class="qhead"><b>${i + 1}.</b><span class="tag">${TYPE[q.type]}${q.type === 'multi' ? '（多选）' : ''}</span><span class="tag">${KP[q.kp] || q.kp}</span><span>${pts} 分</span>
    <span class="markbtn ${SESSION.marks[q.id] ? 'on' : ''}" data-mark="${q.id}">${SESSION.marks[q.id] ? '★ 已标记' : '☆ 标记'}</span></div>
    <div class="stem">${esc(q.stem)}</div>${body}</div>`;
}
function bindExamInputs() {
  $('#view').onclick = e => {
    const m = e.target.closest('[data-mark]');
    if (m) { const id = m.dataset.mark; SESSION.marks[id] = !SESSION.marks[id]; m.classList.toggle('on'); m.textContent = SESSION.marks[id] ? '★ 已标记' : '☆ 标记'; persistSession(); refreshNav(); return; }
    const o = e.target.closest('.opt[data-q]');
    if (!o || !SESSION.running) return;
    const q = BYID[o.dataset.q], v = o.dataset.v;
    let a = SESSION.answers[q.id] || '';
    if (q.type === 'multi') a = a.includes(v) ? a.replace(v, '') : [...a + v].sort().join('');
    else a = v;
    SESSION.answers[q.id] = a;
    o.parentElement.querySelectorAll(`.opt[data-q="${q.id}"]`).forEach(x => x.classList.toggle('sel', a.includes(x.dataset.v)));
    persistSession(); refreshNav();
  };
  $('#view').oninput = e => { if (e.target.matches('textarea[data-q]')) { SESSION.answers[e.target.dataset.q] = e.target.value; persistSession(); refreshNav(); } };
}
// 手机上答题卡收成底部浮条：进度 + 展开题号 + 交卷；桌面端只显示进度
const sideBar = withSubmit => `<div class="side-bar"><span class="label" id="progressTxt"></span><span class="spacer"></span>
  <button class="btn sm side-toggle" onclick="this.closest('.side').classList.toggle('open')">答题卡</button>
  ${withSubmit ? '<button class="btn sm pri side-toggle" onclick="submitExam()">交卷</button>' : ''}</div>`;
function refreshNav() {
  const g = $('#navgrid'); if (!g) return;
  let done = 0;
  g.innerHTML = SESSION.questions.map((x, i) => {
    const a = SESSION.answers[x.id]; if (a) done++;
    let cls = a ? 'done' : '';
    if (SESSION.result) { const r = SESSION.result.items[x.id]; cls = r.frac >= 0.999 ? 'r-ok' : r.frac > 0 ? 'r-part' : 'r-bad'; }
    if (SESSION.marks[x.id]) cls += ' mark';
    return `<a class="${cls}" onclick="this.closest('.side').classList.remove('open');document.getElementById('q-${i}').scrollIntoView({behavior:'smooth'})">${i + 1}</a>`;
  }).join('');
  const pt = $('#progressTxt'); if (pt) pt.textContent = SESSION.result ? `得分 ${SESSION.result.score} / ${SESSION.result.max}` : `已答 ${done} / ${SESSION.questions.length}`;
}
async function submitExam(force) {
  const S = SESSION;
  if (!S || !S.running) return;
  const un = S.questions.filter(x => !S.answers[x.id]).length;
  if (!force && !confirm(un ? `还有 ${un} 题未作答，确定交卷？` : '确定交卷？')) return;
  S.running = false; stopTimer();
  const items = {}; let score = 0, max = 0, objScore = 0, objMax = 0;
  const subj = [];
  for (const x of S.questions) {
    const q = BYID[x.id]; if (!q) continue;
    const a = S.answers[q.id] || '';
    let frac, extra = null;
    if (q.type === 'short') { const k = keywordScore(q.rubric, a); frac = k.max ? k.got / k.max : 0; extra = k; subj.push({ qid: q.id, kp: q.kp, max: x.pts, stem: q.stem, answer: a, autoScore: Math.round(frac * x.pts * 10) / 10, rubricHits: k.detail }); }
    else { frac = gradeObjective(q, a); objScore += frac * x.pts; objMax += x.pts; }
    items[q.id] = { frac, got: Math.round(frac * x.pts * 10) / 10, pts: x.pts, extra };
    score += frac * x.pts; max += x.pts;
    record(q, frac);
  }
  score = Math.round(score * 10) / 10; objScore = Math.round(objScore * 10) / 10;
  S.result = { items, score, max, objScore, objMax };
  P.history.push({ date: today(), cfg: S.cfg, title: S.title, score, max, objScore, objMax });
  saveProgress();
  localStorage.removeItem('session');
  const wrongList = S.questions.map(x => BYID[x.id]).filter(q => q && q.type !== 'short' && items[q.id].frac < 0.999)
    .map(q => ({ qid: q.id, kp: q.kp, type: q.type, yours: S.answers[q.id] || '', answer: q.answer }));
  const kpSum = {};
  S.questions.forEach(x => { const q = BYID[x.id]; if (!q) return; const r = items[q.id]; const k = kpSum[q.kp] || (kpSum[q.kp] = { got: 0, max: 0 }); k.got += r.got; k.max += r.pts; });
  S.submitted = await api('/api/submit', { id: S.id, created: nowStr(), kind: 'exam', title: S.title, autoScore: score, maxScore: max, objScore, objMax, wrong: wrongList, kpSummary: kpSum, subjective: subj, durationMin: Math.round((Date.now() - S.start) / 60000) }).then(() => true).catch(() => false);
  renderExamResult();
}
async function renderExamResult() {
  const S = SESSION, R = S.result;
  const byType = {}; const byKp = {};
  S.questions.forEach(x => { const q = BYID[x.id]; if (!q) return; const r = R.items[q.id];
    const t = byType[q.type] || (byType[q.type] = { got: 0, max: 0 }); t.got += r.got; t.max += r.pts;
    const k = byKp[q.kp] || (byKp[q.kp] = { got: 0, max: 0 }); k.got += r.got; k.max += r.pts; });
  const hasShort = S.questions.some(x => BYID[x.id]?.type === 'short');
  let html = `<div class="exam-wrap"><div>
  <div class="card"><div class="row"><div><div class="label">${esc(S.title)}</div><div class="scorebig">${R.score}<small style="font-size:20px;color:var(--muted)"> / ${R.max}</small></div>
    <div class="label">客观题 ${R.objScore} / ${R.objMax}${hasShort ? ' · 简答为关键词预估分' : ''}</div></div><span class="spacer"></span>
    <div>${Object.entries(byType).map(([t, v]) => `<div>${TYPE[t]}：<b>${Math.round(v.got * 10) / 10}</b> / ${v.max}</div>`).join('')}</div></div>
  </div>
  ${hasShort ? (S.submitted ? gradingBox(S.id) : '<div class="notice">⚠️ 答卷保存失败（服务未启动？）</div>') : ''}
  <div class="card"><h3 style="margin-top:0">知识点得分</h3>${Object.entries(byKp).sort((a, b) => a[1].got / a[1].max - b[1].got / b[1].max).map(([k, v]) => `<div class="kprow"><span>${KP[k] || k}</span><div class="bar"><i style="width:${v.got / v.max * 100}%;background:${v.got / v.max >= .8 ? 'var(--ok)' : v.got / v.max >= .6 ? 'var(--warn)' : 'var(--bad)'}"></i></div><span class="n">${Math.round(v.got * 10) / 10}/${v.max}</span></div>`).join('')}
  <div class="row" style="margin-top:12px"><button class="btn pri" onclick="startWeak()">针对短板再练 30 题</button><button class="btn" onclick="go('exam')">再来一套</button></div></div>`;
  const groups = {};
  S.questions.forEach((x, i) => { const q = BYID[x.id]; if (q) (groups[q.type] = groups[q.type] || []).push([q, i, x.pts]); });
  for (const t of ['judge', 'single', 'multi', 'short']) {
    if (!groups[t]) continue;
    html += `<div class="secthead">${TYPE[t]}</div>`;
    for (const [q, i] of groups[t]) html += reviewQ(q, S.answers[q.id] || '', R.items[q.id], i);
  }
  html += `</div><div class="side card">${sideBar(false)}<div class="label side-title">绿=对 橙=部分 红=错</div><div class="navgrid" id="navgrid"></div></div></div>`;
  $('#view').innerHTML = html; $('#view').onclick = null; $('#view').oninput = null;
  refreshNav();
  loadRefs();
  if (hasShort && S.submitted) watchGrading(S.id);
}
/* 人话版答案：口诀 + 费曼式口语得分句，考场能背能写 */
function plainHtml(q) {
  if (!q.plain) return '';
  const lines = q.plain.feynman.split('\n').filter(l => l.trim());
  return `<div class="plain-answer"><b>🗣️ 人话版得分答案（每行一个得分点，考场按序号分行写）</b>
    ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
    ${q.plain.mnemonic ? `<div class="plain-mnemonic">🧷 口诀：${esc(q.plain.mnemonic)}</div>` : ''}</div>`;
}
function reviewQ(q, a, r, i) {
  const head = `<div class="qhead"><b>${i + 1}.</b><span class="tag">${TYPE[q.type]}</span><span class="tag">${KP[q.kp] || q.kp}</span><span class="tag ${srcCls(q)}">${q.src}</span><span>${r ? r.got + ' / ' + r.pts + ' 分' : ''}</span></div>`;
  if (q.type === 'short') {
    const k = r.extra;
    return `<div class="q" id="q-${i}">${head}<div class="stem">${esc(q.stem)}</div>
      <h3>你的作答</h3><div class="stem-pre">${esc(a) || '（未作答）'}</div>
      ${shortFeedback(q, k)}</div>`;
  }
  return `<div class="q" id="q-${i}">${head}${objBody(q, a, true)}</div>`;
}
function objBody(q, a, showResult) {
  let opts;
  if (q.type === 'judge') opts = judgeOpts(q).map(([v, t]) => { let c = 'locked'; if (showResult) { if (v === q.answer) c += ' right'; else if (a === v) c += ' wrong'; } return `<div class="opt ${c}"><span>${t}</span></div>`; }).join('');
  else opts = q.options.map((o, k) => { const L = LETTERS[k]; let c = 'locked'; if (showResult) { if (q.answer.includes(L)) c += ' right'; else if (a.includes(L)) c += ' wrong'; } return `<div class="opt ${c}"><b>${L}.</b><span>${esc(o)}</span></div>`; }).join('');
  const f = gradeObjective(q, a);
  const verdict = showResult ? `<div class="verdict ${f >= .999 ? 'ok' : f > 0 ? 'part' : 'bad'}">${f >= .999 ? '✓ 正确' : f > 0 ? '△ 少选（半分）' : '✗ 错误'}　你的答案：${esc(ansText(q, a))}　正确答案：${esc(ansText(q, q.answer))}</div>` : '';
  return `<div class="stem">${esc(q.stem)}</div>${opts}${verdict}${showResult ? explainBox(q) : ''}`;
}
const explainBox = q => `<div class="explain"><div>${esc(q.explain)}</div><div class="think">💡 ${esc(q.thinking)}</div></div>`;
function shortFeedback(q, k) {
  const table = `<h3>${k ? `关键词预估：${k.got} / ${k.max}` : '评分要点'}</h3>    <table class="rubric"><tr><th>得分点</th><th>分值</th>${k ? '<th>命中关键词</th>' : ''}</tr>
    ${(k ? k.detail : q.rubric.map(x => ({ point: x.point, score: x.score, hits: [] }))).map(d => `<tr class="${k ? (d.hits.length ? 'hit' : 'miss') : ''}"><td>${k ? (d.hits.length ? '✓ ' : '✗ ') : ''}${esc(d.point)}</td><td>${k ? d.got + '/' : ''}${d.score}</td>${k ? `<td>${esc(d.hits.join('、')) || '—'}</td>` : ''}</tr>`).join('')}
    </table>`;
  const think = `<h3>答题思路</h3><div class="explain md">${md(q.thinking)}</div>`;
  const plain = plainHtml(q);
  if (q.points) return plain + pointsHtml(q) + think + table;
  return plain + table + think + `<h3>参考答案</h3><div class="md ref" data-qid="${q.id}">${q.reference ? md(q.reference) : '加载中…'}</div>`;
}

/* ====== 结构化参考答案：考场速写版为主，每行可展开理解，支持背诵模式 ====== */
const reciteOn = () => localStorage.getItem('reciteMode') === '1';
function pointsHtml(q) {
  const rec = P.recite[q.id] || {};
  const ok = q.points.filter((_, i) => rec[i] === 1).length;
  const big = q.type === 'case';
  const recBtns = i => `<span class="pt-rec"><a onclick="markRecite('${q.id}',${i},1,this)">✓ 记住了</a><a onclick="markRecite('${q.id}',${i},0,this)">✗ 没记住</a></span>`;
  const more = `<a class="pt-more" onclick="this.closest('li').classList.toggle('open')">为什么？</a>`;
  const explain = p => `<div class="pt-explain md">${md(`**怎么做**：${p.how}\n\n**为什么**：${p.why}${p.tip ? `\n\n**小提醒**：${p.tip}` : ''}`)}</div>`;
  const item = (p, i) => big
    ? `<div class="pt-line"><b class="pt-t">${esc(p.t)}</b><span class="tag">占 ${p.score}%</span><span class="tag">建议 ${p.min} 分钟</span><span class="spacer"></span>${recBtns(i)}${more}</div>
       <div class="pt-quick block md" onclick="this.classList.add('shown')">${md(p.quick)}</div>${explain(p)}`
    : `<div class="pt-line"><b class="pt-t">${esc(p.t)}：</b><span class="pt-quick" onclick="this.classList.add('shown')">${esc(p.quick)}</span>${recBtns(i)}${more}</div>${explain(p)}`;
  return `<div class="pts ${big ? 'big' : ''} ${reciteOn() ? 'recite' : ''}" data-qid="${q.id}">
    <div class="pts-head"><b>✍️ ${big ? '答题卡 · 考场速写版' : '考场速写版'}</b><span class="label">${big ? '按小问拆开，考场照着写' : '每点一行，考场直接誊抄'}</span><span class="spacer"></span>
      <span class="label pts-count">背熟 ${ok} / ${q.points.length}</span>
      <button class="btn sm ${reciteOn() ? 'pri' : ''}" onclick="toggleRecite()">${reciteOn() ? '退出背诵模式' : '背诵模式'}</button>
      <button class="btn sm" onclick="this.closest('.pts').querySelectorAll('.pts-list > li').forEach(li => li.classList.toggle('open', !this.dataset.open)); this.dataset.open = this.dataset.open ? '' : '1'; this.textContent = this.dataset.open ? '收起全部理解' : '展开全部理解'">展开全部理解</button></div>
    ${q.hook ? `<div class="pts-hook">🔑 ${esc(q.hook)}</div>` : ''}
    ${q.timeplan ? `<div class="pts-hook">⏱ ${esc(q.timeplan)}</div>` : ''}
    ${q.terms?.length ? `<details class="pts-terms"><summary>📖 本题术语（${q.terms.length} 个，基础薄弱先看这里）</summary><dl>${q.terms.map(x => `<dt>${esc(x.t)}</dt><dd>${esc(x.d)}</dd>`).join('')}</dl></details>` : ''}
    ${reciteOn() ? `<div class="label">背诵模式：先看标题默背${big ? '或在纸上默写' : ''}，再点模糊处对照，然后标记“记住了 / 没记住”。</div>` : ''}
    <ol class="pts-list">${q.points.map((p, i) => `<li class="${rec[i] === 1 ? 'ok' : rec[i] === 0 ? 'bad' : ''}">${item(p, i)}</li>`).join('')}</ol></div>`;
}
function toggleRecite() {
  localStorage.setItem('reciteMode', reciteOn() ? '0' : '1');
  document.querySelectorAll('.pts[data-qid]').forEach(el => { el.outerHTML = pointsHtml(BYID[el.dataset.qid]); });
}
function markRecite(qid, i, v, a) {
  (P.recite[qid] = P.recite[qid] || {})[i] = v;
  saveProgress();
  const box = a.closest('.pts'), q = BYID[qid];
  a.closest('li').className = v ? 'ok' : 'bad';
  box.querySelector('.pts-count').textContent = `背熟 ${q.points.filter((_, j) => P.recite[qid][j] === 1).length} / ${q.points.length}`;
}
async function loadRefs() {
  for (const el of document.querySelectorAll('.ref[data-qid]')) {
    const q = BYID[el.dataset.qid];
    if (q.reference || !q.referenceDoc) continue;
    const t = await loadDoc(q.referenceDoc);
    el.innerHTML = md(q.referenceAnchor ? docSection(t, q.referenceAnchor) : t);
  }
}

/* ====== 专项练习（逐题即时反馈）====== */
let PR = null;
VIEWS.practice = () => {
  const counts = t => Object.keys(KP).map(k => [k, BANK.filter(q => q.kp === k && t.includes(q.type)).length]);
  $('#view').innerHTML = `<h1>专项练习</h1>
  <div class="card">
    <h3 style="margin-top:0">选择知识点（可多选）</h3>
    <div class="chips" id="kpchips">${counts(['judge', 'single', 'multi', 'short']).map(([k, n]) => `<span class="chip" data-k="${k}">${KP[k]} <small>${Math.round(kpAcc(k) * 100)}% · ${n}题</small></span>`).join('')}</div>
    <div class="row" style="margin-top:14px">
      <label>题型 <select id="ptype"><option value="obj">客观题（判断/单选/多选）</option><option value="judge">仅判断</option><option value="single">仅单选</option><option value="multi">仅多选</option><option value="short">仅简答</option></select></label>
      <label>题源 <select id="psrc"><option value="all">全部（2026 样卷优先抽）</option><option value="y26" ${y26Stats().unlocked ? '' : 'selected'}>仅 2026 样卷</option><option value="y25">2025 真题</option><option value="new">新编</option></select></label>
      <label>数量 <input type="number" id="pn" value="20" min="1" max="200" style="width:80px"></label>
      <button class="btn pri" onclick="practiceFromForm()">开始练习</button>
      <button class="btn" onclick="startWeak()">让系统按短板出题</button>
    </div>
  </div>`;
  $('#kpchips').onclick = e => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); };
};
function practiceFromForm() {
  const kps = [...document.querySelectorAll('#kpchips .chip.on')].map(c => c.dataset.k);
  const t = $('#ptype').value, src = $('#psrc').value, n = +$('#pn').value || 20;
  startPractice(kps, t, src, n);
}
function startPractice(kps, t = 'obj', src = 'all', n = 20) {
  const types = t === 'obj' ? ['judge', 'single', 'multi'] : [t];
  let pool = BANK.filter(q => types.includes(q.type) && (!kps.length || kps.includes(q.kp)));
  if (src === 'y26') pool = pool.filter(q => q.src === Y26);
  if (src === 'y25') pool = pool.filter(q => q.src === Y25);
  if (src === 'new') pool = pool.filter(q => q.src !== Y25 && q.src !== Y26);
  if (!pool.length) return toast('没有符合条件的题目');
  startPracticeList(pickWeighted(pool, n, true), (kps.length ? kps.map(k => KP[k]).join('、') : '全部知识点') + ' · 专项');
}
function startPracticeList(list, title) {
  PR = { title, list, i: 0, ans: {}, done: {}, got: 0, subj: [] };
  go('practice-run');
}
VIEWS['practice-run'] = () => {
  const q = PR.list[PR.i];
  if (!q) return practiceSummary();
  const done = PR.done[q.id];
  const a = PR.ans[q.id] || '';
  let body;
  if (q.type === 'short') {
    body = `<div class="stem">${esc(q.stem)}</div><textarea id="sa" ${done ? 'disabled' : ''} placeholder="分点作答">${esc(a)}</textarea>
      ${done ? `<div id="sfb">${shortFeedback(q, done.k)}</div>` : `<div class="row" style="margin-top:10px"><button class="btn pri" onclick="practiceSubmitShort()">提交</button></div>`}`;
  } else if (done) body = objBody(q, a, true);
  else {
    const opts = q.type === 'judge' ? judgeOpts(q).map(([v, t]) => `<div class="opt ${a === v ? 'sel' : ''}" data-v="${v}"><span>${t}</span></div>`).join('')
      : q.options.map((o, k) => `<div class="opt ${a.includes(LETTERS[k]) ? 'sel' : ''}" data-v="${LETTERS[k]}"><b>${LETTERS[k]}.</b><span>${esc(o)}</span></div>`).join('');
    body = `<div class="stem">${esc(q.stem)}</div><div id="opts">${opts}</div>
      <div class="row" style="margin-top:10px"><button class="btn pri" onclick="practiceCheck()">${q.type === 'multi' ? '确认提交' : '提交'}</button><span class="label">${q.type === 'single' || q.type === 'judge' ? '提示：单选/判断点击选项即判分' : ''}</span></div>`;
  }
  $('#view').innerHTML = `<div class="row"><h1 style="margin:0">${esc(PR.title)}</h1><span class="spacer"></span><span class="label">第 ${PR.i + 1} / ${PR.list.length} 题 · 得分 ${Math.round(PR.got * 10) / 10}</span></div>
  <div class="bar" style="margin:10px 0 16px"><i style="width:${PR.i / PR.list.length * 100}%;background:var(--pri)"></i></div>
  <div class="q"><div class="qhead"><span class="tag">${TYPE[q.type]}${q.type === 'multi' ? '（多选）' : ''}</span><span class="tag">${KP[q.kp] || q.kp}</span><span class="tag ${srcCls(q)}">${q.src}${q.no ? ' 第' + q.no + '题' : ''}</span>${P.q[q.id] ? `<span class="label">做过 ${P.q[q.id].seen} 次</span>` : ''}</div>${body}</div>
  <div class="row">${PR.i > 0 ? '<button class="btn" onclick="PR.i--;VIEWS[\'practice-run\']()">上一题</button>' : ''}<span class="spacer"></span>
  <button class="btn" onclick="practiceSummary()">结束练习</button>${done ? `<button class="btn pri" id="nextBtn" onclick="PR.i++;VIEWS['practice-run']()">下一题 →</button>` : ''}</div>`;
  const box = $('#opts');
  if (box) box.onclick = e => {
    const o = e.target.closest('.opt'); if (!o) return;
    let v = o.dataset.v, cur = PR.ans[q.id] || '';
    cur = q.type === 'multi' ? (cur.includes(v) ? cur.replace(v, '') : [...cur + v].sort().join('')) : v;
    PR.ans[q.id] = cur;
    box.querySelectorAll('.opt').forEach(x => x.classList.toggle('sel', cur.includes(x.dataset.v)));
    if (q.type !== 'multi') practiceCheck();
  };
  if (done && q.type === 'short') loadRefs();
};
function practiceCheck() {
  const q = PR.list[PR.i], a = PR.ans[q.id] || '';
  if (!a) return toast('请先作答');
  const f = gradeObjective(q, a);
  PR.done[q.id] = { f }; PR.got += f; record(q, f);
  VIEWS['practice-run']();
}
document.addEventListener('keydown', e => {
  if (!PR || !$('#nextBtn') || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Enter' || e.key === 'ArrowRight') $('#nextBtn').click();
});
function practiceSubmitShort() {
  const q = PR.list[PR.i], a = $('#sa').value;
  if (!a.trim()) return toast('请先作答');
  PR.ans[q.id] = a;
  const k = keywordScore(q.rubric, a), f = k.max ? k.got / k.max : 0;
  PR.done[q.id] = { f, k }; PR.got += f; record(q, f);
  PR.subj.push({ qid: q.id, kp: q.kp, max: q.score || 10, stem: q.stem, answer: a, autoScore: Math.round(f * (q.score || 10) * 10) / 10, rubricHits: k.detail });
  VIEWS['practice-run']();
}
async function practiceSummary() {
  const n = Object.keys(PR.done).length;
  const objDone = PR.list.filter(q => PR.done[q.id] && q.type !== 'short');
  const right = objDone.filter(q => PR.done[q.id].f >= .999).length;
  let saved = '';
  if (PR.subj.length && !PR.saved) {
    PR.saved = true;
    const sid = 'practice-' + Date.now();
    const ok = await api('/api/submit', { id: sid, created: nowStr(), kind: 'practice', title: PR.title, autoScore: PR.subj.reduce((s, x) => s + x.autoScore, 0), maxScore: PR.subj.reduce((s, x) => s + x.max, 0), subjective: PR.subj, wrong: objDone.filter(q => PR.done[q.id].f < .999).map(q => ({ qid: q.id, kp: q.kp, yours: PR.ans[q.id], answer: q.answer })) }).then(() => true).catch(() => false);
    if (ok) { PR.sid = sid; saved = gradingBox(sid); }
  }
  const wrongs = objDone.filter(q => PR.done[q.id].f < .999);
  $('#view').innerHTML = `<h1>练习小结 · ${esc(PR.title)}</h1><div class="card">
    <div class="scorebig">${right} / ${objDone.length}</div><div class="label">客观题正确数（共作答 ${n} 题）</div>${saved}
    <div class="row" style="margin-top:12px"><button class="btn pri" onclick="startWeak()">继续弱项强化</button><button class="btn" onclick="go('practice')">换个专项</button><button class="btn" onclick="go('home')">回看板</button></div></div>
    ${wrongs.length ? '<h2>本次错题</h2>' + wrongs.map((q, i) => `<div class="q"><div class="qhead"><span class="tag">${TYPE[q.type]}</span><span class="tag">${KP[q.kp]}</span></div>${objBody(q, PR.ans[q.id] || '', true)}</div>`).join('') : ''}`;
  if (saved && PR.sid) watchGrading(PR.sid);
}

/* ====== 错题本 ====== */
VIEWS.wrong = () => {
  const ids = Object.keys(P.wrong).filter(id => BYID[id]).sort((a, b) => (P.wrong[b].times - P.wrong[a].times));
  const byKp = {}; ids.forEach(id => { const k = BYID[id].kp; byKp[k] = (byKp[k] || 0) + 1; });
  $('#view').innerHTML = `<div class="row"><h1 style="margin:0">错题本（${ids.length}）</h1><span class="spacer"></span>
    ${ids.length ? `<button class="btn pri" onclick="startPracticeList(shuffle(Object.keys(P.wrong).filter(i=>BYID[i]).map(i=>BYID[i])),'错题重做')">全部重做</button>` : ''}</div>
    <p class="label">规则：答错自动入本；同一题连续答对 2 次自动移出。</p>
    <div class="chips" style="margin-bottom:14px">${Object.entries(byKp).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip" onclick="startPracticeList(Object.keys(P.wrong).filter(i=>BYID[i]&&BYID[i].kp==='${k}').map(i=>BYID[i]),'错题重做 · ${KP[k]}')">${KP[k]} ${n}</span>`).join('')}</div>
    ${ids.map((id, i) => { const q = BYID[id]; return `<div class="q"><div class="qhead"><span class="tag">${TYPE[q.type]}</span><span class="tag">${KP[q.kp]}</span><span class="tag bad">错 ${P.wrong[id].times} 次</span><span class="label">${P.wrong[id].at.slice(0, 16).replace('T', ' ')}</span></div>
      ${q.type === 'short' ? `<div class="stem">${esc(q.stem)}</div>` : objBody(q, '', true)}</div>`; }).join('') || '<div class="card label">暂无错题 🎉</div>'}`;
};

/* ====== 实操 B/C ====== */
let CS = null;
VIEWS.cases = () => {
  const order = c => c.src === Y26 ? 0 : c.src === Y25 ? 1 : 2;
  const cases = BANK.filter(q => q.type === 'case').sort((a, b) => order(a) - order(b));
  const mods = ['B1.1', 'B1.2', 'B2', 'B3', 'B4', 'C'];
  const done = id => P.q[id] ? `<span class="tag ok">练过 ${P.q[id].seen} 次 · 预估 ${Math.round(P.q[id].score / P.q[id].seen * 100)}</span>` : '';
  $('#view').innerHTML = `<h1>实操 B / 综合评审 C</h1>
  <div class="notice" style="margin-bottom:16px">2026 下午场：B 120 分钟（B1.1 质检 25 分钟/15 分 · B1.2 会议室 20 分钟/10 分 · B2 冷链 25 分钟/30 分 · B3 能源 35 分钟/40 分 · B4 培训 15 分钟/5 分）+ C 30 分钟/100 分。<b>2026 样卷题排在每个模块第一位，必须反复练到能脱稿写完。</b>B1.2、B2 素材在 <code>2026样卷/</code>，参考 notebook 在 <code>备考输出/2026/notebooks/</code>。限时作答 → 提交后看 checklist 与参考答案 → AI 评卷。流程图建议在 Word/WPS 画，这里用文字箭头写即可。</div>
  ${mods.map(m => { const list = cases.filter(c => c.module === m); if (!list.length) return ''; return `<div class="card"><h3 style="margin-top:0">${m}</h3>${list.map(c => `<div class="list-item"><span class="tag ${srcCls(c)}">${c.src}</span><b>${esc(c.title)}</b><span class="label">${c.minutes} 分钟</span>${done(c.id)}<span class="spacer"></span><button class="btn sm" onclick="viewCase('${c.id}')">看题与参考</button><button class="btn sm pri" onclick="startCase('${c.id}')">限时作答</button></div>`).join('')}</div>`; }).join('')}`;
};
function caseStemHtml(c) { return c.stemFormat === 'pre' ? `<div class="stem-pre">${esc(c.stem)}</div>` : `<div class="md stem-pre">${md(c.stem)}</div>`; }
async function caseRefHtml(c) {
  let ref = c.reference ? md(c.reference) : '';
  if (c.referenceDoc) ref += md(await loadDoc(c.referenceDoc));
  return ref;
}
async function viewCase(id) {
  const c = BYID[id];
  const jump = (sel, t) => `<a class="btn sm" onclick="document.getElementById('${sel}').scrollIntoView({behavior:'smooth'})">${t}</a>`;
  openModal(`<h2 style="margin-top:0">${esc(c.title)} <span class="tag ${srcCls(c)}">${c.module}</span></h2>
  <div class="split-tabs" onclick="const a = event.target.closest('a'); if (!a) return; this.querySelectorAll('a').forEach(x => x.classList.toggle('on', x === a)); this.nextElementSibling.className = 'split show-' + a.dataset.t; $('#modal').scrollTop = 0">
    <a class="on" data-t="r">✅ 参考答案</a><a data-t="l">📄 题目</a></div>
  <div class="split show-r">
    <div class="split-col"><div class="split-head">📄 题目</div>${caseStemHtml(c)}</div>
    <div class="split-col" id="case-right">
      <div class="split-head">✅ 参考答案 <span class="spacer"></span>${c.points ? jump('sec-card', '答题卡') : ''}${jump('sec-ck', '评分要点')}${c.thinking ? jump('sec-th', '答题思路') : ''}${jump('sec-full', c.points ? '完整版' : '参考答案')}${c.templateDoc ? jump('sec-tpl', '模板') : ''}</div>
      ${c.points ? `<div id="sec-card">${pointsHtml(c)}</div>` : ''}
      ${plainHtml(c)}
      <h3 id="sec-ck">评分要点 checklist</h3>${checklistTable(c)}
      ${c.thinking ? `<h3 id="sec-th">答题思路</h3><div class="explain md">${md(c.thinking)}</div>` : ''}
      ${c.points ? `<details id="sec-full" class="full-ref"><summary>完整参考答案（文档版，备查）</summary><div id="sec-ref" class="md">加载中…</div></details>`
        : `<h3 id="sec-full">参考答案</h3><div id="sec-ref" class="md">加载中…</div>`}
      ${c.templateDoc ? `<h3 id="sec-tpl">答题卷模板</h3><div class="md" id="sec-tplbox">加载中…</div>` : ''}
    </div>
  </div>`, true);
  $('#sec-ref').innerHTML = await caseRefHtml(c);
  if (c.templateDoc) $('#sec-tplbox').innerHTML = md(await loadDoc(c.templateDoc));
}
function checklistTable(c, k) {
  const rows = k ? k.detail : c.checklist.map(x => ({ point: x.item, score: x.score, hits: [] }));
  return `<table class="rubric"><tr><th>评分项</th><th>分值</th>${k ? '<th>命中关键词</th>' : ''}</tr>${rows.map(d => `<tr class="${k ? (d.hits.length ? 'hit' : 'miss') : ''}"><td>${k ? (d.hits.length ? '✓ ' : '✗ ') : ''}${esc(d.point)}</td><td>${k ? d.got + '/' : ''}${d.score}</td>${k ? `<td>${esc(d.hits.join('、')) || '—'}</td>` : ''}</tr>`).join('')}</table>`;
}
function startCase(id) {
  const c = BYID[id];
  const saved = JSON.parse(localStorage.getItem('case-' + id) || 'null');
  CS = saved && saved.running ? saved : { id, answer: '', start: Date.now(), end: Date.now() + c.minutes * 60000, running: true };
  go('case-run');
}
VIEWS['case-run'] = () => {
  const c = BYID[CS.id];
  $('#view').innerHTML = `<div class="row"><h1 style="margin:0">${esc(c.title)}</h1><span class="tag">${c.module} · ${c.minutes} 分钟</span><span class="spacer"></span><button class="btn" onclick="go('cases')">返回</button></div>
  <div class="grid g2" style="margin-top:14px;align-items:start">
    <div>${caseStemHtml(c)}</div>
    <div><textarea class="big" id="caseAns" placeholder="按题面任务一/二/三分节作答。流程图可写成：用户下单 → NLP解析 →〈置信度≥0.9?〉是→ 后厨；否→ 人工校对 …">${esc(CS.answer)}</textarea>
    <div class="row" style="margin-top:10px"><span class="label" id="wc"></span><span class="spacer"></span><button class="btn pri" onclick="submitCase()">交卷</button></div></div>
  </div>`;
  const ta = $('#caseAns');
  const wc = () => $('#wc').textContent = ta.value.length + ' 字';
  ta.oninput = () => { CS.answer = ta.value; localStorage.setItem('case-' + CS.id, JSON.stringify(CS)); wc(); };
  wc();
  startTimer(CS.end, () => { toast('时间到！可继续写完再交卷，但请记录超时'); });
};
async function submitCase() {
  const c = BYID[CS.id];
  if (!CS.answer.trim()) return toast('还没有作答');
  if (!confirm('确定交卷？')) return;
  stopTimer(); CS.running = false; localStorage.removeItem('case-' + CS.id);
  const k = keywordScore(c.checklist, CS.answer);
  const frac = k.got / k.max;
  record(c, frac);
  const used = Math.round((Date.now() - CS.start) / 60000);
  const sid = 'case-' + Date.now();
  const ok = await api('/api/submit', { id: sid, created: nowStr(), kind: 'case', title: `${c.module} ${c.title}`, autoScore: k.got, maxScore: 100, durationMin: used, limitMin: c.minutes,
    subjective: [{ qid: c.id, kp: c.kp, max: 100, stem: c.title, answer: CS.answer, autoScore: k.got, rubricHits: k.detail }] }).then(() => true).catch(() => false);
  $('#view').innerHTML = `<h1>${esc(c.title)} · 交卷</h1>
  <div class="card"><div class="row"><div><div class="label">关键词预估（仅供参考）</div><div class="scorebig">${k.got}<small style="font-size:20px;color:var(--muted)"> / 100</small></div><div class="label">用时 ${used} 分钟（限时 ${c.minutes}）</div></div></div>
  </div>${ok ? gradingBox(sid) : '<div class="notice">⚠️ 提交失败</div>'}
  <div class="card"><h3 style="margin-top:0">评分要点对照</h3>${checklistTable(c, k)}</div>
  <div class="card"><h3 style="margin-top:0">你的作答</h3><div class="stem-pre">${esc(CS.answer)}</div></div>
  ${c.points ? `<div class="card">${pointsHtml(c)}</div>` : ''}
  ${c.thinking ? `<div class="card"><h3 style="margin-top:0">答题思路</h3><div class="md">${md(c.thinking)}</div></div>` : ''}
  <div class="card"><div class="row"><h3 style="margin:0">参考答案</h3><span class="spacer"></span><button class="btn sm pri" onclick="viewCase('${c.id}')">左右对照：题目 | 参考答案</button></div><div class="md" id="refbox">加载中…</div></div>`;
  if (ok) watchGrading(sid);
  $('#refbox').innerHTML = await caseRefHtml(c);
}

/* ====== 真题 / 样卷解析 ====== */
let RV = { tab: 'judge', hide: false, year: '2026' };
const REVIEW_DOCS = {
  '2026': ['2026/A理论参考答案.md', '2026/B1.1参考答案.md', '2026/B1.2参考答案.md', '2026/B2参考答案.md', '2026/B3参考答案.md', '2026/B4参考答案.md', '2026/C参考答案.md', '11-每日速记卡.md'],
  '2025': ['01-评委拆解与学习路径.md', '02-A理论参考答案.md', '03-下午场总览-思考路径与学习方法.md', '04-B1.1参考答案与思考路径.md', '05-B1.2参考答案与思考路径.md', '06-B2参考答案与思考路径.md', '07-B3参考答案与思考路径.md', '08-B4参考答案与思考路径.md', '09-C参考答案与思考路径.md', '11-每日速记卡.md'],
};
VIEWS.review = (tab, year) => {
  if (tab) RV.tab = tab;
  if (year) RV.year = year;
  const SRCN = RV.year === '2026' ? Y26 : Y25;
  const y = BANK.filter(q => q.src === SRCN);
  const cnt = t => y.filter(q => q.type === t).length;
  const tabs = [['judge', '判断 ' + cnt('judge')], ['single', '单选 ' + cnt('single')], ['multi', '多选 ' + cnt('multi')], ['short', '简答 ' + cnt('short')], ['case', '实操 B/C'], ['docs', '参考文档']];
  const mtag = q => mastered(q) ? '<span class="tag ok">已掌握</span>' : P.wrong[q.id] ? '<span class="tag bad">错题本</span>' : '';
  let body = '';
  if (['judge', 'single', 'multi'].includes(RV.tab)) {
    body = y.filter(q => q.type === RV.tab).sort((a, b) => a.no - b.no).map(q => `<div class="q"><div class="qhead"><b>${q.no}.</b><span class="tag">${KP[q.kp]}</span>${mtag(q)}</div>
      ${RV.hide ? `<div class="stem">${esc(q.stem)}</div>${q.options ? q.options.map((o, k) => `<div class="opt locked"><b>${LETTERS[k]}.</b><span>${esc(o)}</span></div>`).join('') : ''}
        <div class="blur" onclick="this.classList.remove('blur')"><div class="verdict ok">答案：${ansText(q, q.answer)}</div>${explainBox(q)}</div>`
        : objBody(q, q.answer, true).replace(/<div class="verdict[^>]*>.*?<\/div>/, `<div class="verdict ok">答案：${ansText(q, q.answer)}</div>`)}</div>`).join('');
  } else if (RV.tab === 'short') {
    body = y.filter(q => q.type === 'short').sort((a, b) => a.no - b.no).map(q => `<div class="q"><div class="qhead"><b>简答 ${q.no}</b><span class="tag">${KP[q.kp]}</span><span>${q.score || 10} 分</span></div>
      <div class="stem">${esc(q.stem)}</div><div ${RV.hide ? 'class="blur" onclick="this.classList.remove(\'blur\')"' : ''}>${shortFeedback(q, null)}</div></div>`).join('');
  } else if (RV.tab === 'case') {
    body = y.filter(q => q.type === 'case').map(c => `<div class="card"><div class="row"><span class="tag ${srcCls(c)}">${c.module}</span><b>${esc(c.title)}</b><span class="label">${c.minutes} 分钟</span><span class="spacer"></span><button class="btn sm" onclick="viewCase('${c.id}')">题面 + 评分点 + 参考答案</button><button class="btn sm pri" onclick="startCase('${c.id}')">限时作答</button></div></div>`).join('');
  } else {
    body = `<div class="card">${REVIEW_DOCS[RV.year].map(d => `<div class="list-item"><span>📄 ${d}</span><span class="spacer"></span><button class="btn sm" onclick="showDoc('${d}')">打开</button></div>`).join('')}</div>`;
  }
  $('#view').innerHTML = `<div class="row"><h1 style="margin:0">真题 / 样卷解析</h1>
    <div class="tabs" style="margin:0 0 0 12px">${[['2026', '2026 样卷（必考）'], ['2025', '2025 真题']].map(([k, t]) => `<a class="${RV.year === k ? 'on' : ''}" onclick="VIEWS.review(null,'${k}')">${t}</a>`).join('')}</div>
    <span class="spacer"></span><label><input type="checkbox" id="hideAns" ${RV.hide ? 'checked' : ''}> 遮挡答案自测（点击模糊区显示）</label></div>
  <p class="label">官方未公布标准答案，以下为依据法规与专业知识整理的参考答案；每题附“答题思路”（快速判断/排除方法）。${RV.year === '2026' ? '2026 评分框架：判断/单选每题 0.5 分，多选每题 1 分，简答每题 5 分。' : ''}</p>
  <div class="tabs">${tabs.map(([k, t]) => `<a class="${RV.tab === k ? 'on' : ''}" onclick="VIEWS.review('${k}')">${t}</a>`).join('')}
  <span class="spacer"></span>${['judge', 'single', 'multi'].includes(RV.tab) ? `<button class="btn sm pri" onclick="startPracticeList(BANK.filter(q=>q.src==='${SRCN}'&&q.type==='${RV.tab}').sort((a,b)=>a.no-b.no),'${SRCN} · ${TYPE[RV.tab]}顺序练')">按顺序刷这一类</button>` : ''}</div>${body}`;
  $('#hideAns').onchange = e => { RV.hide = e.target.checked; VIEWS.review(); };
  if (RV.tab === 'short') loadRefs();
};
async function showDoc(name) { openModal(`<h2 style="margin-top:0">${esc(name)}</h2><div class="md">加载中…</div>`); $('#modal-body .md').innerHTML = md(await loadDoc(name)); }

/* ====== 评卷记录 ====== */
VIEWS.grading = async () => {
  $('#view').innerHTML = '<h1>评卷记录</h1><div class="card label">加载中…</div>';
  let list = [];
  try { list = await api('/api/submissions'); } catch { }
  applyFeedback(list);
  const pending = list.filter(s => !s.feedback && s.hasSubjective);
  const status = s => s.feedback ? `<span class="tag ok">AI ${s.feedback.total ?? '-'} / ${s.feedback.max ?? s.maxScore ?? '-'}</span>`
    : s.grading?.status === 'grading' ? `<span class="tag warn">评卷中 ${s.grading.done || 0}/${s.grading.total || '?'}</span>`
    : s.grading?.status === 'error' ? `<span class="tag bad" title="${esc(s.grading.error)}">评卷失败</span>`
    : s.hasSubjective ? '<span class="tag warn">待评卷</span>' : '<span class="tag">仅客观题</span>';
  const action = s => !s.hasSubjective || !CONF.llm || s.grading?.status === 'grading' ? ''
    : `<button class="btn sm" onclick="regrade('${s.id}')">${s.feedback ? '重新评卷' : 'AI 评卷'}</button>`;
  $('#view').innerHTML = `<h1>评卷记录</h1>
  <div class="notice" style="margin-bottom:16px">${CONF.llm ? `交卷后服务端自动调用 <b>${esc(CONF.model)}</b> 评卷，通常 1–3 分钟出结果，评分会同步修正知识点掌握度。` : '服务端未配置评卷模型。'}
    待评 ${pending.length} 份。想要更深入的点评和按短板追加新题，可在 Cursor 聊天里说 <b>“评卷”</b>。</div>
  <div class="card">${list.length ? list.map(s => `<div class="list-item"><span class="tag">${esc((s.created || '').slice(0, 16).replace('T', ' '))}</span><span class="tag">${{ exam: '模拟卷', case: '实操', practice: '练习' }[s.kind] || s.kind}</span>
    <span>${esc(s.title)}</span><span class="spacer"></span><span class="label">预估 ${s.autoScore ?? '-'} / ${s.maxScore ?? '-'}</span>
    ${status(s)}${action(s)}<button class="btn sm" onclick="showSubmission('${s.id}')">查看</button></div>`).join('') : '<div class="label">暂无提交</div>'}</div>`;
  if (list.some(s => s.grading?.status === 'grading')) setTimeout(() => { if ($('#view h1')?.textContent === '评卷记录' && $('#modal').classList.contains('hidden')) VIEWS.grading(); }, 5000);
};
function applyFeedback(list) {
  let changed = false;
  for (const s of list) {
    if (!s.feedback) continue;
    const stamp = s.feedback.graded_at || '1';
    const prev = P.fbApplied[s.id];
    if (prev && prev.stamp === stamp) continue;
    if (!prev && P.appliedFeedback.includes(s.id)) continue;
    const rec = { stamp, items: {} };
    for (const it of s.feedback.items || []) {
      const q = BYID[it.qid]; if (!q || !it.max) continue;
      const ai = it.score / it.max;
      const base = prev?.items?.[it.qid] ?? (it.autoScore != null ? it.autoScore / it.max : null);
      const k = P.kp[q.kp] || (P.kp[q.kp] = { seen: 0, score: 0 });
      const qs = P.q[q.id];
      if (base !== null && qs) { const d = ai - base; k.score += d; qs.score += d; qs.last = ai; }
      else { k.seen++; k.score += ai; }
      rec.items[it.qid] = ai;
    }
    P.fbApplied[s.id] = rec;
    if (!P.appliedFeedback.includes(s.id)) P.appliedFeedback.push(s.id);
    changed = true;
  }
  if (changed) { saveProgress(); toast('已同步 AI 评卷结果到掌握度'); }
}
function gradingBox(sid) {
  return `<div class="card" id="gbox-${sid}">${CONF.llm ? `⏳ 正在提交 AI 评卷（${esc(CONF.model)}）…` : '<div class="notice">服务端未配置评卷模型，可在 Cursor 聊天里说“评卷”。</div>'}</div>`;
}
function feedbackHtml(s, f) {
  const fbItem = qid => (f.items || []).find(x => x.qid === qid);
  return `<h3 style="margin-top:0">AI 评卷：<span style="color:var(--pri)">${f.total ?? '-'} / ${f.max ?? s.maxScore}</span> <span class="label">${esc(f.grader || '')} · ${esc(f.graded_at || '')}</span></h3>
    <div class="md">${md(f.summary || '')}</div>
    ${(f.next_actions || []).length ? `<h3>下一步</h3><div class="md">${md(f.next_actions.map(x => '- ' + x).join('\n'))}</div>` : ''}
    ${(s.subjective || []).map(it => { const fi = fbItem(it.qid); const q = BYID[it.qid]; if (!fi) return '';
      return `<div class="q"><div class="qhead"><span class="tag">${q ? TYPE[q.type] : ''}</span><span class="tag">${KP[it.kp] || it.kp}</span><span>关键词预估 ${it.autoScore}/${it.max}</span><span class="tag ok">AI ${fi.score}/${fi.max}</span></div>
        <div class="stem">${esc(q && q.type === 'case' ? q.title : it.stem)}</div><div class="explain md">${md(fi.comment || '')}</div></div>`; }).join('')}`;
}
async function watchGrading(sid) {
  if (!CONF.llm) return;
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60000) {
    const el = document.getElementById('gbox-' + sid); if (!el) return;
    let r; try { r = await api('/api/submission/' + sid); } catch { await sleep(4000); continue; }
    if (r.feedback) { el.innerHTML = feedbackHtml(r.submission, r.feedback); applyFeedback([{ id: sid, feedback: r.feedback }]); return; }
    if (r.grading?.status === 'error') { el.innerHTML = `<div class="notice">⚠️ AI 评卷失败：${esc(r.grading.error)} <button class="btn sm" onclick="regrade('${sid}')">重试</button></div>`; return; }
    if (!r.grading) { el.innerHTML = `<button class="btn pri" onclick="regrade('${sid}')">开始 AI 评卷</button>`; return; }
    el.innerHTML = `⏳ AI 评卷中…已完成 ${r.grading.done || 0} / ${r.grading.total || '?'} 题（${esc(CONF.model)}）。可以先看下方解析，评完会自动显示在这里。`;
    await sleep(3000);
  }
}
async function regrade(sid) {
  const r = await api('/api/grade/' + sid, {}).catch(() => ({ ok: false }));
  if (!r.ok) return toast(r.error || '无法开始评卷');
  const el = document.getElementById('gbox-' + sid);
  if (el) { el.innerHTML = '⏳ AI 评卷中…'; watchGrading(sid); }
  else { toast('已开始评卷'); if ($('#view h1')?.textContent === '评卷记录') VIEWS.grading(); }
}
async function showSubmission(id) {
  const { submission: s, feedback: f, grading: g } = await api('/api/submission/' + id);
  if (f) applyFeedback([{ id, feedback: f }]);
  openModal(`<h2 style="margin-top:0">${esc(s.title)}</h2><div class="label">${esc(s.created)} · 预估 ${s.autoScore} / ${s.maxScore}${s.durationMin != null ? ' · 用时 ' + s.durationMin + ' 分钟' : ''}</div>
    ${f ? `<div class="card" style="margin-top:12px;background:#f8fafc">${feedbackHtml(s, f)}</div>` : (s.subjective || []).length ? gradingBox(id) : ''}
    ${(s.subjective || []).length ? '<h3>你的作答</h3>' : ''}
    ${(s.subjective || []).map(it => { const q = BYID[it.qid]; return `<div class="q"><div class="qhead"><span class="tag">${q ? TYPE[q.type] : ''}</span><span class="tag">${KP[it.kp] || it.kp}</span><span>预估 ${it.autoScore}/${it.max}</span></div>
      <div class="stem">${esc(q && q.type === 'case' ? q.title : it.stem)}</div><div class="stem-pre">${esc(it.answer)}</div></div>`; }).join('')}
    ${s.wrong && s.wrong.length ? `<h3>客观题错题（${s.wrong.length}）</h3>${s.wrong.map(w => { const q = BYID[w.qid]; return q ? `<div class="q">${objBody(q, w.yours || '', true)}</div>` : ''; }).join('')}` : ''}`);
  if (!f && (s.subjective || []).length) watchGrading(id);
}

/* ====== 背题模式：看题自测 → 翻答案 → 记住/没记住，直接计入掌握度与错题本 ====== */
let MEM = null;
function memSave() {
  if (!MEM) { localStorage.removeItem('mem'); return; }
  localStorage.setItem('mem', JSON.stringify({ ids: MEM.list.map(q => q.id), i: MEM.i, title: MEM.title, done: MEM.done, right: MEM.right }));
}
function memStart(list, title) {
  if (!list.length) return toast('该范围内没有题目');
  MEM = { list, i: 0, flipped: false, sel: '', graded: false, title, done: 0, right: 0 };
  memSave();
  go('memorize-run');
}
function memPool(scopeKey, types) {
  let pool = BANK.filter(q => types.includes(q.type));
  if (scopeKey === 'y26') pool = pool.filter(q => q.src === Y26);
  if (scopeKey === 'y25') pool = pool.filter(q => q.src === Y25);
  if (scopeKey === 'wrong') pool = pool.filter(q => P.wrong[q.id]);
  if (scopeKey === 'unmastered') pool = pool.filter(q => q.src === Y26 && !mastered(q));
  return pool;
}
function memQuick(scopeKey) {
  const types = scopeKey === 'y26obj' ? ['judge', 'single', 'multi'] : ['judge', 'single', 'multi', 'short'];
  const key = scopeKey === 'y26obj' ? 'y26' : scopeKey;
  const names = { y26: '2026 样卷', y26obj: '2026 样卷客观题', y25: '2025 真题', wrong: '错题本重背', unmastered: '未掌握样卷题' };
  memStart(shuffle(memPool(key, types)), `背题 · ${names[scopeKey]}`);
}
VIEWS.memorize = () => {
  const saved = JSON.parse(localStorage.getItem('mem') || 'null');
  const savedList = saved ? saved.ids.map(id => BYID[id]).filter(Boolean) : [];
  const cnt = (scopeKey, types) => memPool(scopeKey, types).length;
  $('#view').innerHTML = `<h1>🧠 背题模式</h1>
  <div class="card" style="border:2px solid var(--pri);background:linear-gradient(180deg,#f0f4ff,#fff)">
    <div class="row"><h3 style="margin:0">一分钟上手</h3></div>
    <ol style="margin:8px 0 0;padding-left:22px;line-height:2">
      <li><b>看题自测</b>：心里想出答案，可点选项对一下（可选）</li>
      <li><b>空格 / 点按钮翻答案</b>：对答案、看解析和答题思路</li>
      <li><b>标记“记住了 / 没记住”</b>：没记住的自动进错题本、加大抽中权重</li>
      <li>键盘：<kbd>空格</kbd> 翻页 · <kbd>←</kbd><kbd>→</kbd> 上一题/下一题 · <kbd>A</kbd>-<kbd>D</kbd>/<kbd>T</kbd><kbd>F</kbd> 选项</li>
    </ol>
  </div>
  ${savedList.length ? `<div class="notice" style="margin-bottom:16px">有未背完的卡片：${esc(saved.title)}（第 ${saved.i + 1} / ${savedList.length} 题）　<button class="btn sm pri" onclick="memResume()">继续背</button> <button class="btn sm" onclick="localStorage.removeItem('mem');VIEWS.memorize()">放弃</button></div>` : ''}
  <div class="card">
    <h3 style="margin-top:0">快速入口（按考试优先级）</h3>
    <div class="row">
      <button class="btn pri" onclick="memQuick('unmastered')">未掌握样卷题（${cnt('unmastered', ['judge', 'single', 'multi'])}）</button>
      <button class="btn" onclick="memQuick('y26obj')">2026 样卷客观题（${cnt('y26', ['judge', 'single', 'multi'])}）</button>
      <button class="btn" onclick="memQuick('y26')">2026 样卷全部（含简答 ${cnt('y26', ['short'])}）</button>
      <button class="btn" onclick="memQuick('wrong')">错题本（${Object.keys(P.wrong).filter(id => BYID[id] && isObj(BYID[id])).length}）</button>
      <button class="btn" onclick="memQuick('y25')">2025 真题（${cnt('y25', ['judge', 'single', 'multi', 'short'])}）</button>
      <button class="btn" onclick="memQuick('all')">全部题库</button>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">自定义范围</h3>
    <div class="label" style="margin-bottom:6px">题源</div>
    <div class="chips" id="memsrc">
      <span class="chip on" data-v="all">全部</span><span class="chip" data-v="y26">2026 样卷</span><span class="chip" data-v="y25">2025 真题</span>
    </div>
    <div class="label" style="margin:12px 0 6px">题型</div>
    <div class="chips" id="memtype">
      ${['judge', 'single', 'multi', 'short'].map(t => `<span class="chip ${t !== 'short' ? 'on' : ''}" data-v="${t}">${TYPE[t]}</span>`).join('')}
    </div>
    <div class="label" style="margin:12px 0 6px">知识点（不选 = 全部）</div>
    <div class="chips" id="memkp">${Object.keys(KP).map(k => `<span class="chip" data-v="${k}">${KP[k]}</span>`).join('')}</div>
    <div class="row" style="margin-top:14px">
      <label><input type="checkbox" id="memshuffle" checked> 打乱顺序（防止记位置）</label>
      <button class="btn pri" onclick="memCustom()">开始背题</button>
    </div>
  </div>`;
  for (const id of ['memsrc', 'memtype', 'memkp'])
    $('#' + id).onclick = e => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); };
};
function memCustom() {
  const src = $('#memsrc .chip.on')?.dataset.v || 'all';
  const types = [...document.querySelectorAll('#memtype .chip.on')].map(c => c.dataset.v);
  const kps = [...document.querySelectorAll('#memkp .chip.on')].map(c => c.dataset.v);
  if (!types.length) return toast('至少选一种题型');
  let pool = memPool(src === 'all' ? 'all' : src, types);
  if (kps.length) pool = pool.filter(q => kps.includes(q.kp));
  if ($('#memshuffle').checked) pool = shuffle(pool);
  memStart(pool, `背题 · 自定义（${pool.length} 题）`);
}
VIEWS['memorize-run'] = () => {
  const q = MEM.list[MEM.i];
  if (!q) return VIEWS.memorize();
  const a = MEM.sel;
  let body;
  if (q.type === 'short') {
    body = MEM.flipped
      ? `${shortFeedback(q, null)}${q.points ? pointsHtml(q) : ''}`
      : `<div class="label" style="margin:10px 0">简答题：先回忆要点，再翻答案对照评分点。${q.score ? `（${q.score} 分）` : ''}</div>`;
  } else {
    const opts = q.type === 'judge' ? judgeOpts(q).map(([v, t]) => `<div class="opt ${a === v ? 'sel' : ''}" data-mv="${v}"><span>${t}</span></div>`).join('')
      : q.options.map((o, k) => `<div class="opt ${a.includes(LETTERS[k]) ? 'sel' : ''}" data-mv="${LETTERS[k]}"><b>${LETTERS[k]}.</b><span>${esc(o)}</span></div>`).join('');
    body = `<div id="memopts">${opts}</div>`;
  }
  const tried = MEM.flipped && q.type !== 'short' && a;
  const f = tried ? gradeObjective(q, a) : null;
  const back = MEM.flipped ? `<div class="verdict ${f === null ? 'ok' : f >= .999 ? 'ok' : f > 0 ? 'part' : 'bad'}">${f === null ? '' : f >= .999 ? '✓ 你答对了　' : f > 0 ? '△ 少选（半分）　' : '✗ 你选错了　'}正确答案：${esc(ansText(q, q.answer))}</div>
      ${explainBox(q)}` : '';
  $('#view').innerHTML = `<div class="row"><h1 style="margin:0">${esc(MEM.title)}</h1><span class="spacer"></span>
    <span class="label">第 ${MEM.i + 1} / ${MEM.list.length} 题 · 已记 ${MEM.done} · 记住率 ${MEM.done ? Math.round(MEM.right / MEM.done * 100) : 0}%</span></div>
    <div class="bar" style="margin:10px 0 16px"><i style="width:${(MEM.i + (MEM.flipped ? 1 : 0)) / MEM.list.length * 100}%;background:var(--pri)"></i></div>
    <div class="q mem-card" id="mem-card">
      <div class="qhead"><span class="tag">${TYPE[q.type]}${q.type === 'multi' ? '（多选）' : ''}</span><span class="tag">${KP[q.kp] || q.kp}</span><span class="tag ${srcCls(q)}">${q.src}</span>${q.no ? `<span class="label">第 ${q.no} 题</span>` : ''}<span class="label">${P.q[q.id] ? '历史做过 ' + P.q[q.id].seen + ' 次' : '没做过'}</span></div>
      <div class="stem">${esc(q.stem)}</div>
      ${body}
      ${back}
    </div>
    <div id="memctl">${MEM.flipped
      ? `<div class="mem-grade">${q.type === 'short'
          ? `<button class="btn ok" onclick="memGrade(1)">✓ 记住了</button><button class="btn" style="color:var(--bad);border-color:var(--bad)" onclick="memGrade(0)">✗ 没记住</button>`
          : `<button class="btn ok" onclick="memGrade(${f >= .999 ? 1 : 0})">✓ 记住了${f !== null && f < .999 ? '（仍计入 1 次）' : ''}</button><button class="btn" style="color:var(--bad);border-color:var(--bad)" onclick="memGrade(0)">✗ 没记住</button>`}
        <button class="btn" onclick="memNext(true)">跳过 · 下一题 →</button></div>`
      : `<button class="btn pri mem-flipbtn" onclick="memFlip()">显示答案（空格）</button>`}</div>
    <div class="row" style="margin-top:14px">${MEM.i > 0 ? '<button class="btn" onclick="memPrev()">← 上一题</button>' : ''}<span class="label mem-hint">📱 点题面翻答案 · 左右滑动翻页</span><span class="spacer"></span>
      <button class="btn" onclick="memQuit()">结束背题</button></div>`;
  const box = $('#memopts');
  if (box) box.onclick = e => {
    if (MEM.flipped) return;
    const o = e.target.closest('.opt'); if (!o) return;
    const v = o.dataset.mv;
    MEM.sel = q.type === 'multi' ? (MEM.sel.includes(v) ? MEM.sel.replace(v, '') : [...MEM.sel + v].sort().join('')) : v;
    box.querySelectorAll('.opt').forEach(x => x.classList.toggle('sel', MEM.sel.includes(x.dataset.mv)));
  };
  // 手机手势：点题面翻答案/下一题，左右滑动翻页
  const card = $('#mem-card');
  let tx0 = 0, ty0 = 0;
  card.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - tx0, dy = t.clientY - ty0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? (MEM.flipped ? memNext() : memFlip()) : memPrev(); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !e.target.closest('.opt')) { MEM.flipped ? memNext() : memFlip(); }
  });
};
function memFlip() {
  MEM.flipped = true;
  VIEWS['memorize-run']();
}
function memResume() {
  const saved = JSON.parse(localStorage.getItem('mem') || 'null');
  if (!saved) return;
  const list = saved.ids.map(id => BYID[id]).filter(Boolean);
  if (!list.length) { localStorage.removeItem('mem'); return VIEWS.memorize(); }
  MEM = { list, i: Math.min(saved.i, list.length - 1), flipped: false, sel: '', graded: true, title: saved.title, done: saved.done || 0, right: saved.right || 0 };
  go('memorize-run');
}
function memGrade(v) {
  const q = MEM.list[MEM.i];
  if (!MEM.graded) {
    record(q, v);
    MEM.done++; MEM.right += v;
    MEM.graded = true;
  }
  memSave();
  memNext();
}
function memNext(skip) {
  if (MEM.i >= MEM.list.length - 1) return memFinish();
  MEM.i++; MEM.flipped = false; MEM.sel = ''; MEM.graded = false;
  memSave();
  VIEWS['memorize-run']();
}
function memPrev() { if (MEM.i > 0) { MEM.i--; MEM.flipped = false; MEM.sel = ''; MEM.graded = true; memSave(); VIEWS['memorize-run'](); } }
function memFinish() {
  const n = MEM.done, acc = n ? Math.round(MEM.right / n * 100) : 0;
  localStorage.removeItem('mem');
  $('#view').innerHTML = `<h1>背题完成 🎉</h1><div class="card">
    <div class="scorebig">${acc}<small style="font-size:20px;color:var(--muted)">% 记住率</small></div>
    <div class="label">本次标记 ${n} 题 · 记住 ${MEM.right} · 没记住 ${n - MEM.right}（已进错题本并加大权重）</div>
    <div class="row" style="margin-top:14px">
      <button class="btn pri" onclick="memQuick('wrong')">去背错题本</button>
      <button class="btn" onclick="memQuick('unmastered')">再背未掌握样卷题</button>
      <button class="btn" onclick="go('home')">回看板</button></div></div>`;
}
function memQuit() {
  if (MEM.i < MEM.list.length - 1 && MEM.done > 0) memSave(); else localStorage.removeItem('mem');
  MEM = null;
  go('memorize');
}
document.addEventListener('keydown', e => {
  if (!document.getElementById('mem-card') || !MEM || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ') { e.preventDefault(); MEM.flipped ? memNext() : memFlip(); }
  else if (e.key === 'ArrowRight') memNext();
  else if (e.key === 'ArrowLeft') memPrev();
});

/* ====== Mermaid 流程图：任何位置渲染出的 ```mermaid 代码块都自动转成图形 ====== */
let mmSeq = 0, mmPending = false;
const MM_SEL = 'pre > code.language-mermaid:not([data-mm])';
if (window.mermaid) mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', htmlLabels: false,
  fontFamily: '"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif', flowchart: { useMaxWidth: true, htmlLabels: false, wrappingWidth: 260 } });
async function renderMermaid() {
  mmPending = false;
  const list = [...document.querySelectorAll(MM_SEL)];
  list.forEach(c => c.dataset.mm = '1');
  for (const code of list) {
    if (!code.isConnected) continue;
    const src = code.textContent, box = document.createElement('div');
    box.className = 'mermaid-box';
    code.parentElement.replaceWith(box);
    const id = 'mm' + (++mmSeq);
    try {
      box.innerHTML = (await mermaid.render(id, src)).svg;
    } catch (e) {
      document.getElementById('d' + id)?.remove();
      box.innerHTML = `<div class="label">流程图渲染失败：${esc(String(e.message || e).split('\n')[0])}</div>`;
    }
    box.insertAdjacentHTML('beforeend', `<details><summary>查看流程图源码</summary><pre>${esc(src)}</pre></details>`);
  }
}
if (window.mermaid) new MutationObserver(() => {
  if (!mmPending && document.querySelector(MM_SEL)) { mmPending = true; requestAnimationFrame(renderMermaid); }
}).observe(document.body, { childList: true, subtree: true });

/* ====== 启动 ====== */
(async function boot() {
  $('#view').innerHTML = '<div class="card">题库加载中…</div>';
  try {
    const r = await api('/api/bank');
    BANK = r.items.filter(q => q && q.id && q.type && (q.type === 'case' || q.type === 'short' || q.answer));
    const bad = r.files.filter(f => f.error);
    if (bad.length) toast('以下题库文件解析失败：' + bad.map(f => f.file).join(','), 5000);
  } catch (e) {
    $('#view').innerHTML = '<div class="card notice">无法连接本地服务。请在 exam-app 目录运行 <code>python server.py</code> 后访问 http://127.0.0.1:8848/</div>';
    return;
  }
  BANK.forEach(q => BYID[q.id] = q);
  CONF = await api('/api/config').catch(() => ({ llm: false }));
  let p = null;
  try { p = await api('/api/progress'); } catch { }
  if (!p || !Object.keys(p).length) p = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  P = initProgress(p);
  go('home');
})();
