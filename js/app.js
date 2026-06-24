/* =========================================================================
 *  대전동화중학교 생활기록부 도우미 - UI 로직 (학생별 키워드 표 방식)
 * ========================================================================= */
(function () {
  'use strict';
  const E = window.DHEngine;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'dh_saeng_2026';

  /* ---------- 저장소 ---------- */
  let STORE = load();
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(STORE)); }
  STORE.drafts = STORE.drafts || {};
  STORE.settings = STORE.settings || { apiKey: '', model: 'claude-haiku-4-5', useAI: false };

  /* ---------- 상태 ---------- */
  const state = { grade: null, cls: null, cat: 'autonomy', itemId: null };
  const regenCount = {};

  /* ---------- 학생 ---------- */
  const STU = (window.DH_STUDENTS || []).map(a => ({ grade: a[0], cls: a[1], num: a[2], name: a[3] }));
  function classStudents(g, c) { return STU.filter(s => s.grade === g && s.cls === c); }

  /* ---------- 드래프트 ---------- */
  function dkey(num, cat, itemId) { return num + '|' + cat + '|' + itemId; }
  function getDraft(num) { return STORE.drafts[dkey(num, state.cat, state.itemId)] || { text: '', kw: [] }; }
  function setDraft(num, patch) {
    const k = dkey(num, state.cat, state.itemId);
    const d = STORE.drafts[k] || { text: '', kw: [] };
    Object.assign(d, patch, { updated: Date.now() });
    if (!d.text && (!d.kw || !d.kw.length)) delete STORE.drafts[k];
    else STORE.drafts[k] = d;
    save();
  }

  /* ---------- 카테고리/아이템 ---------- */
  function curCat() { return window.DH_CATEGORIES.find(c => c.id === state.cat); }
  function dateKey(s) { const m = (s || '').match(/(\d+)월\s*(\d+)일/); return m ? (+m[1]) * 100 + (+m[2]) : 9999; }
  function itemOptions() {
    const cat = state.cat;
    if (cat === 'club') return window.DH_CLUBS.map(n => ({ id: 'club:' + n, label: n, club: n }));
    if (cat === 'subject') return window.DH_SUBJECTS.map(s => ({ id: 'subj:' + s.name, label: s.name + ' 세특', subj: s }));
    if (cat === 'behavior') return [{ id: 'behavior', label: '행동특성 및 종합의견' }];
    // 자율/진로/봉사 → 활동을 날짜 오름차순으로 정렬
    return window.DH_ACTIVITIES.filter(a => a.cat === cat)
      .filter(a => !state.grade || a.grades.indexOf(state.grade) >= 0)
      .slice()
      .sort((a, b) => dateKey(a.date) - dateKey(b.date))
      .map(a => ({ id: a.id, label: a.name + (a.date ? ' (' + a.date + ')' : ''), act: a, dk: dateKey(a.date) }));
  }
  function curItem() { const o = itemOptions(); return o.find(x => x.id === state.itemId) || o[0]; }

  /* ---------- 생성 ---------- */
  function buildGenOpts(num, kws, variant) {
    const it = curItem();
    const base = { seed: num, variant: variant || 0, keywords: kws, category: state.cat };
    if (state.cat === 'club') base.clubName = it.club;
    else if (state.cat === 'subject') base.subject = it.subj;
    else if (state.cat !== 'behavior') base.activity = it.act;
    return base;
  }
  function genLocal(num, kws, variant) { return E.generate(buildGenOpts(num, kws, variant)); }

  /* ---------- AI 생성 (Claude API, 선택) ---------- */
  function aiOn() { return !!(STORE.settings.useAI && STORE.settings.apiKey); }
  function aiContext() {
    const it = curItem();
    if (state.cat === 'behavior') return '영역: 행동특성 및 종합의견 (담임교사 종합 관찰 의견)';
    if (state.cat === 'club') return '영역: 동아리활동\n동아리명: ' + it.club;
    if (state.cat === 'subject') return '영역: 교과 세부능력 및 특기사항\n과목: ' + it.subj.name + '\n주요 학습: ' + it.subj.topics.join(', ');
    return '영역: ' + curCat().name + '\n활동: ' + it.act.name + (it.act.date ? ' (' + it.act.date + ')' : '') + '\n활동 개요: ' + it.act.intro[0];
  }
  async function aiGenerate(kws) {
    const sys = '너는 대한민국 중학교 생활기록부 작성을 돕는 보조교사다. 교사가 제공한 키워드와 활동 정보에만 근거해 사실적으로 작성하고, 지어내지 않는다. ' +
      '문장은 명사형 종결어미(~함, ~임, ~보임, ~기름)로 끝나는 음슴체로 쓰고, 공백 제외 200~300자 분량의 한 단락으로 작성한다. ' +
      '학생 이름, 성적·점수·석차, 교외 수상, 부모 정보, 특정 시험/자격증 점수는 절대 포함하지 않는다. 설명 없이 생활기록부 문구만 출력한다.';
    const usr = aiContext() + '\n키워드: ' + (kws.length ? kws.join(', ') : '(없음 — 활동 참여 모습 위주로)') +
      '\n위 내용을 반영해 200~300자 생활기록부 문구를 한 단락으로 작성해줘.';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': STORE.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: STORE.settings.model || 'claude-haiku-4-5',
        max_tokens: 700, system: sys,
        messages: [{ role: 'user', content: usr }]
      })
    });
    if (!res.ok) { let t = ''; try { t = (await res.json()).error.message; } catch (e) {} throw new Error('API ' + res.status + (t ? ': ' + t : '')); }
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('').trim();
  }
  /* 동시 실행 제한 풀 */
  async function pool(items, worker, size, onProgress) {
    let i = 0, done = 0; const out = [];
    async function run() { while (i < items.length) { const idx = i++; try { out[idx] = await worker(items[idx], idx); } catch (e) { out[idx] = { error: e }; } done++; onProgress && onProgress(done, items.length); } }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
    return out;
  }

  /* ============================ 렌더 ============================ */
  function renderGradeClass() {
    const gb = $('gradeBtns'); gb.innerHTML = '';
    [1, 2, 3].forEach(g => {
      const b = document.createElement('button');
      b.className = 'pick-btn' + (state.grade === g ? ' active' : '');
      b.textContent = g + '학년';
      b.onclick = () => { state.grade = g; state.cls = null; renderGradeClass(); renderItemPick(); renderStudents(); renderTable(); };
      gb.appendChild(b);
    });
    const cb = $('classBtns'); cb.innerHTML = '';
    for (let c = 1; c <= 8; c++) {
      const b = document.createElement('button');
      b.className = 'pick-btn' + (state.cls === c ? ' active' : '');
      b.textContent = c + '반'; b.disabled = !state.grade;
      b.onclick = () => { state.cls = c; renderGradeClass(); renderStudents(); renderTable(); };
      cb.appendChild(b);
    }
  }

  function renderCatTabs() {
    const t = $('catTabs'); t.innerHTML = '';
    window.DH_CATEGORIES.forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat-tab' + (state.cat === c.id ? ' active' : '');
      b.innerHTML = c.icon + ' ' + c.name;
      b.onclick = () => {
        state.cat = c.id;
        const o = itemOptions(); state.itemId = o.length ? o[0].id : null;
        renderCatTabs(); renderItemPick(); renderStudents(); renderTable();
      };
      t.appendChild(b);
    });
  }

  function renderItemPick() {
    const wrap = $('itemPick'); wrap.innerHTML = '';
    const opts = itemOptions();
    if (!state.itemId || !opts.find(o => o.id === state.itemId)) state.itemId = opts[0] && opts[0].id;
    if (state.cat === 'behavior') { wrap.innerHTML = '<label>행동특성 및 종합의견</label>'; return; }
    const lab = document.createElement('label');
    lab.textContent = (state.cat === 'club' ? '동아리' : state.cat === 'subject' ? '과목' : '활동');
    const sel = document.createElement('select');
    opts.forEach(o => { const op = document.createElement('option'); op.value = o.id; op.textContent = o.label; sel.appendChild(op); });
    sel.value = state.itemId;
    sel.onchange = () => { state.itemId = sel.value; renderStudents(); renderTable(); };
    wrap.appendChild(lab); wrap.appendChild(sel);
  }

  function renderStudents() {
    const head = $('classTitle'), prog = $('progress'), list = $('studentList');
    list.innerHTML = '';
    if (!state.grade || !state.cls) { head.textContent = '학년·반을 선택하세요'; prog.textContent = ''; return; }
    let arr = classStudents(state.grade, state.cls);
    head.textContent = state.grade + '학년 ' + state.cls + '반 · ' + arr.length + '명';
    const done = arr.filter(s => (STORE.drafts[dkey(s.num, state.cat, state.itemId)] || {}).text).length;
    prog.textContent = '작성 ' + done + '/' + arr.length;
    const q = ($('search').value || '').trim();
    if (q) arr = arr.filter(s => s.name.indexOf(q) >= 0 || String(s.num).indexOf(q) >= 0);
    arr.forEach(s => {
      const li = document.createElement('li');
      const written = (STORE.drafts[dkey(s.num, state.cat, state.itemId)] || {}).text;
      li.innerHTML = '<span class="s-name">' + esc(s.name) + '</span>' +
        '<span class="s-meta"><span class="s-no">' + s.num + '</span>' + (written ? '<span class="s-dot" title="작성됨"></span>' : '') + '</span>';
      li.onclick = () => focusRow(s.num);
      list.appendChild(li);
    });
  }

  /* ---------- 표 ---------- */
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
  function cntClass(n) { const c = n === 0 ? '' : n < 200 ? 'low' : n > 300 ? 'over' : 'ok'; return '<span class="' + c + '">' + n + '</span>'; }
  function kwToStr(kw) { return (kw || []).join(', '); }
  function parseKw(v) { return (v || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean); }

  function renderTable() {
    const body = $('grid'), empty = $('gridEmpty'), hint = $('tableHint');
    body.innerHTML = '';
    if (!state.grade || !state.cls) { empty.classList.remove('hidden'); hint.textContent = ''; return; }
    empty.classList.add('hidden');
    const it = curItem();
    const label = it ? it.label : curCat().name;
    hint.innerHTML = '<b>' + esc(curCat().name) + '</b> · ' + esc(label) +
      ' &nbsp;|&nbsp; 왼쪽 칸에 학생별 <b>키워드</b>(쉼표로 구분)를 적고 <b>반 전체 초안 생성</b>을 누르면 각자 다른 문장이 채워집니다. 칸은 길이에 맞춰 자동으로 늘어나며 직접 수정·삭제할 수 있어요.';

    const arr = classStudents(state.grade, state.cls);
    const q = ($('search').value || '').trim();
    arr.forEach(s => {
      if (q && s.name.indexOf(q) < 0 && String(s.num).indexOf(q) < 0) return;
      const d = STORE.drafts[dkey(s.num, state.cat, state.itemId)] || { text: '', kw: [] };
      const tr = document.createElement('tr');
      tr.dataset.num = s.num;
      tr.innerHTML =
        '<td>' + s.num + '</td>' +
        '<td class="bt-name">' + esc(s.name) + '</td>' +
        '<td><textarea class="kw" data-num="' + s.num + '" placeholder="예) 성실, 리더십">' + esc(kwToStr(d.kw)) + '</textarea></td>' +
        '<td><textarea class="content" data-num="' + s.num + '" placeholder="생성 또는 직접 입력">' + esc(d.text || '') + '</textarea></td>' +
        '<td class="bt-cnt" data-cnt="' + s.num + '">' + cntClass(E.charCount(d.text || '')) + '</td>' +
        '<td><div class="row-acts">' +
          '<button class="icon-btn gen" data-gen="' + s.num + '" title="이 학생 생성/다시 생성">🔄</button>' +
          '<button class="icon-btn del" data-del="' + s.num + '" title="이 학생 내용 삭제">🗑</button>' +
        '</div></td>';
      body.appendChild(tr);
    });

    // 자동 높이 + 이벤트
    body.querySelectorAll('textarea').forEach(autoGrow);
    body.querySelectorAll('textarea.kw').forEach(ta => {
      ta.oninput = () => { autoGrow(ta); setDraft(+ta.dataset.num, { kw: parseKw(ta.value) }); };
    });
    body.querySelectorAll('textarea.content').forEach(ta => {
      ta.oninput = () => {
        autoGrow(ta);
        const num = +ta.dataset.num;
        setDraft(num, { text: ta.value });
        $('grid').querySelector('[data-cnt="' + num + '"]').innerHTML = cntClass(E.charCount(ta.value));
      };
      ta.onblur = renderStudents;
    });
    body.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => genOne(+b.dataset.gen));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delOne(+b.dataset.del));
  }

  function rowKw(num) {
    const ta = $('grid').querySelector('textarea.kw[data-num="' + num + '"]');
    const fromCell = ta ? parseKw(ta.value) : null;
    if (fromCell && fromCell.length) return fromCell;
    const saved = (STORE.drafts[dkey(num, state.cat, state.itemId)] || {}).kw;
    if (saved && saved.length) return saved;
    return parseKw($('commonKw').value); // 공통 키워드 폴백
  }
  function putRow(num, text) {
    setDraft(num, { text: text, kw: (STORE.drafts[dkey(num, state.cat, state.itemId)] || {}).kw || [] });
    const ta = $('grid').querySelector('textarea.content[data-num="' + num + '"]');
    if (ta) { ta.value = text; autoGrow(ta); }
    const cnt = $('grid').querySelector('[data-cnt="' + num + '"]');
    if (cnt) cnt.innerHTML = cntClass(E.charCount(text));
  }

  async function genOne(num) {
    if (STORE.settings.useAI && !STORE.settings.apiKey) { toast('AI 모드: 설정에서 API 키를 입력하세요'); settingsModal(); return; }
    const k = dkey(num, state.cat, state.itemId);
    regenCount[k] = (regenCount[k] || 0) + 1;
    const kws = rowKw(num);
    if (aiOn()) {
      const btn = $('grid').querySelector('[data-gen="' + num + '"]'); const old = btn ? btn.textContent : '';
      if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
      try { putRow(num, await aiGenerate(kws)); }
      catch (e) { toast('AI 실패 — 로컬로 대체: ' + e.message); putRow(num, genLocal(num, kws, regenCount[k])); }
      if (btn) { btn.textContent = old || '🔄'; btn.disabled = false; }
    } else {
      putRow(num, genLocal(num, kws, regenCount[k]));
    }
    renderStudents();
  }
  function delOne(num) {
    setDraft(num, { text: '' });
    const ta = $('grid').querySelector('textarea.content[data-num="' + num + '"]');
    if (ta) { ta.value = ''; autoGrow(ta); }
    const cnt = $('grid').querySelector('[data-cnt="' + num + '"]'); if (cnt) cnt.innerHTML = cntClass(0);
    renderStudents();
  }
  async function genAll() {
    if (!state.grade || !state.cls) { toast('학년·반을 먼저 선택하세요'); return; }
    if (STORE.settings.useAI && !STORE.settings.apiKey) { toast('AI 모드: 설정에서 API 키를 입력하세요'); settingsModal(); return; }
    const arr = classStudents(state.grade, state.cls);
    if (aiOn()) {
      const btn = $('genAll'); const old = btn.textContent; btn.disabled = true;
      let fails = 0;
      await pool(arr, async (s) => {
        const kws = rowKw(s.num);
        try { putRow(s.num, await aiGenerate(kws)); }
        catch (e) { fails++; putRow(s.num, genLocal(s.num, kws, 0)); }
      }, 4, (d, n) => { btn.textContent = '✨ AI 생성 중 ' + d + '/' + n; });
      btn.textContent = old; btn.disabled = false; renderStudents();
      toast('AI 생성 완료' + (fails ? ' (실패 ' + fails + '건은 로컬로 대체)' : ''));
    } else {
      arr.forEach(s => { const k = dkey(s.num, state.cat, state.itemId); putRow(s.num, genLocal(s.num, rowKw(s.num), regenCount[k] || 0)); });
      renderStudents();
      toast(arr.length + '명 초안 생성 완료(로컬)');
    }
  }
  function renderEngineToggle() {
    const hasKey = !!STORE.settings.apiKey;
    document.querySelectorAll('#engineToggle button').forEach(b => {
      const on = STORE.settings.useAI ? b.dataset.eng === 'ai' : b.dataset.eng === 'local';
      b.classList.toggle('active', on);
      b.title = b.dataset.eng === 'ai' ? (hasKey ? 'Claude AI로 생성 (' + (STORE.settings.model || 'claude-haiku-4-5') + ')' : '설정에서 API 키 입력 필요') : '로컬 생성(무료·오프라인)';
    });
  }
  function setEngine(useAI) {
    if (useAI && !STORE.settings.apiKey) { toast('AI 모드를 쓰려면 먼저 API 키를 입력하세요'); settingsModal(); return; }
    STORE.settings.useAI = useAI; save(); renderEngineToggle();
    toast(useAI ? '✨ AI 생성 모드' : '🔒 로컬 생성 모드');
  }
  function delAll() {
    if (!state.grade || !state.cls) return;
    const arr = classStudents(state.grade, state.cls);
    const n = arr.filter(s => (STORE.drafts[dkey(s.num, state.cat, state.itemId)] || {}).text).length;
    if (!n) { toast('삭제할 내용이 없습니다'); return; }
    if (!confirm('현재 화면(' + curCat().name + ')의 ' + n + '명 생기부 내용을 모두 삭제할까요?\n키워드는 유지됩니다.')) return;
    arr.forEach(s => setDraft(s.num, { text: '' }));
    renderTable(); renderStudents();
    toast(n + '명 내용 삭제 완료');
  }

  function focusRow(num) {
    const tr = $('grid').querySelector('tr[data-num="' + num + '"]');
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.add('flash');
    setTimeout(() => tr.classList.remove('flash'), 900);
    const ta = tr.querySelector('textarea.kw'); if (ta) ta.focus();
  }

  /* ---------- 내보내기 ---------- */
  function copyAll() {
    if (!state.grade || !state.cls) return;
    const arr = classStudents(state.grade, state.cls);
    const lines = arr.map(s => {
      const d = STORE.drafts[dkey(s.num, state.cat, state.itemId)] || {};
      return s.num + ' ' + s.name + '\n' + (d.text || '') + '\n';
    });
    copy(lines.join('\n')); toast('반 전체 내용을 복사했습니다');
  }
  function csvAll() {
    if (!state.grade || !state.cls) return;
    const arr = classStudents(state.grade, state.cls);
    const it = curItem();
    const rows = [['학번', '이름', '영역', '항목', '키워드', '내용']];
    arr.forEach(s => {
      const d = STORE.drafts[dkey(s.num, state.cat, state.itemId)] || {};
      rows.push([s.num, s.name, curCat().name, it ? it.label : '', kwToStr(d.kw), (d.text || '').replace(/\r?\n/g, ' ')]);
    });
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    download('﻿' + csv, '동화중_' + state.grade + '학년' + state.cls + '반_' + curCat().name + '.csv', 'text/csv;charset=utf-8');
    toast('CSV 파일을 내려받았습니다');
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /* ---------- 모달 ---------- */
  function modal(title, html) { $('modalTitle').textContent = title; $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); }
  function closeModal() { $('modal').classList.add('hidden'); }

  function guideModal() {
    modal('사용법', `
      <h3>1. 학급 선택</h3><p>왼쪽 위에서 <b>학년 → 반</b>을 클릭하면 그 반 학생이 표로 나타납니다.</p>
      <h3>2. 영역 선택</h3><p>상단 탭에서 <b>자율활동·동아리·진로·봉사·행동특성·교과세특</b> 중 작성할 영역을, 활동/과목 드롭다운에서 세부 항목을 고릅니다. (자율·진로·봉사 활동은 <b>날짜 순</b>으로 정렬됩니다.)</p>
      <h3>3. 키워드 입력 → 생성</h3><p>각 학생의 <b>왼쪽 칸</b>에 키워드(예: 성실, 리더십, 발표)를 쉼표로 적고 <b>⚡ 반 전체 초안 생성</b>을 누르면, 키워드를 반영한 200~300자 문장이 학생마다 다르게 채워집니다. 줄 칸은 길이에 맞춰 자동으로 늘어납니다.</p>
      <h3>4. 개별 작업</h3><p>각 행의 <b>🔄</b>는 그 학생만 다시 생성, <b>🗑</b>는 그 학생 내용만 삭제합니다. 내용은 직접 고쳐 써도 자동 저장됩니다. <b>🗑 일괄 삭제</b>는 현재 영역 전체 내용을 지웁니다(키워드는 유지).</p>
      <h3>5. 내보내기</h3><p><b>전체 복사</b>·<b>CSV</b>로 NEIS 입력에 활용하세요. 모든 작업은 인터넷 없이 이 브라우저에서 동작하고 자동 저장됩니다.</p>
      <p style="color:#6b7280;margin-top:12px">※ 결과는 <b>초안</b>입니다. 학생의 실제 활동·관찰 내용을 확인하고 교사가 검토·수정한 뒤 기재하세요. 성적·교외수상·부모정보 등 기재 금지 항목이 들어가지 않도록 유의하세요.</p>
    `);
  }
  function settingsModal() {
    const s = STORE.settings;
    modal('설정', `
      <div class="field-label">AI 고급생성</div>
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <input type="checkbox" id="setUseAI" ${s.useAI ? 'checked' : ''}> Claude API로 더 자연스러운 문장 생성 (인터넷 필요 · 상단 ✨AI 토글과 연동)
      </label>
      <div class="field-label">Claude API Key</div>
      <input type="password" id="setKey" placeholder="sk-ant-..." value="${esc(s.apiKey || '')}">
      <div class="field-label">모델</div>
      <select id="setModel">
        <option value="claude-haiku-4-5">claude-haiku-4-5 (가장 저렴·권장)</option>
        <option value="claude-sonnet-4-6">claude-sonnet-4-6 (문장 품질↑)</option>
        <option value="claude-opus-4-8">claude-opus-4-8 (최고품질·고가)</option>
      </select>
      <p style="color:#6b7280">키는 <b>이 브라우저에만</b> 저장되며, 생성 시 Anthropic API로만 직접 전송됩니다(학생 이름은 전송되지 않음). 1건당 약 ${s.model === 'claude-opus-4-8' ? '₩22' : s.model === 'claude-sonnet-4-6' ? '₩13' : '₩4'} 내외. 콘솔에서 <b>월 지출 상한</b> 설정을 권장합니다. AI 실패 시 자동으로 로컬 생성으로 대체됩니다.</p>
      <div class="row-btns">
        <button class="primary" id="setSave">저장</button>
        <button class="ghost" id="setReset">전체 작성내용 초기화</button>
      </div>
    `);
    $('setModel').value = s.model || 'claude-haiku-4-5';
    $('setSave').onclick = () => {
      STORE.settings = { useAI: $('setUseAI').checked, apiKey: $('setKey').value.trim(), model: $('setModel').value };
      if (STORE.settings.useAI && !STORE.settings.apiKey) STORE.settings.useAI = false;
      save(); closeModal(); renderEngineToggle(); toast('설정을 저장했습니다');
    };
    $('setReset').onclick = () => {
      if (confirm('저장된 모든 생기부 작성 내용을 삭제할까요? (되돌릴 수 없습니다)')) {
        STORE.drafts = {}; save(); closeModal(); renderStudents(); renderTable(); toast('초기화되었습니다');
      }
    };
  }
  function backupModal() {
    const cnt = Object.keys(STORE.drafts).length;
    modal('백업 / 복원', `
      <p>현재 저장된 작성 항목: <b>${cnt}개</b></p>
      <p>다른 컴퓨터로 옮기거나 보관하려면 백업 파일을 내려받으세요.</p>
      <div class="row-btns">
        <button class="primary" id="bkExport">⬇️ 백업 파일 내려받기</button>
        <label class="ghost" style="display:inline-flex;align-items:center;cursor:pointer">📂 복원하기
          <input type="file" id="bkImport" accept="application/json" style="display:none"></label>
      </div>
      <p style="color:#6b7280;margin-top:10px">복원하면 같은 항목은 덮어쓰며, 나머지는 합쳐집니다.</p>
    `);
    $('bkExport').onclick = () => download(JSON.stringify({ drafts: STORE.drafts, exportedAt: new Date().toISOString() }, null, 1),
      '동화중_생기부백업_' + ymd() + '.json', 'application/json');
    $('bkImport').onchange = (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { const o = JSON.parse(rd.result); Object.assign(STORE.drafts, o.drafts || o); save(); closeModal(); renderStudents(); renderTable(); toast('복원 완료'); } catch (e) { toast('파일을 읽을 수 없습니다'); } };
      rd.readAsText(f);
    };
  }

  /* ---------- 유틸 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  function copy(t) { if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => fb(t)); else fb(t); function fb(x) { const a = document.createElement('textarea'); a.value = x; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); } }
  function download(text, name, type) { const b = new Blob([text], { type: type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  function ymd() { const d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  let toastT; function toast(m) { const el = $('toast'); el.textContent = m; el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2200); }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('search').oninput = () => { renderStudents(); renderTable(); };
    document.querySelectorAll('#engineToggle button').forEach(b => b.onclick = () => setEngine(b.dataset.eng === 'ai'));
    $('genAll').onclick = genAll;
    $('delAll').onclick = delAll;
    $('copyAll').onclick = copyAll;
    $('csvAll').onclick = csvAll;
    $('btnGuide').onclick = guideModal;
    $('btnSettings').onclick = settingsModal;
    $('btnBackup').onclick = backupModal;
    $('modalClose').onclick = closeModal;
    $('modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }

  function init() {
    const o = itemOptions(); state.itemId = o[0] && o[0].id;
    renderGradeClass(); renderCatTabs(); renderItemPick(); renderStudents(); renderTable(); renderEngineToggle(); bind();
  }
  init();
})();
