/* =========================================================================
 *  대전동화중학교 생활기록부 도우미 - UI 로직
 *  - 학생별 키워드 표
 *  - 동아리/교과세특: 명단을 골라서 구성(기본 비어 있음)
 *  - 교과세특: 모달로 과목·대상 학생·주요 활동 설정 + 과제물 업로드(AI 인식)
 *  - AI: /api/generate (Vercel 환경변수 키) 사용, 실패 시 로컬 대체
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
  STORE.rosters = STORE.rosters || {};   // 'club|동아리명' / 'subj|과목명' -> [학번...]
  STORE.subjMeta = STORE.subjMeta || {}; // '과목명' -> { activity }
  STORE.settings = STORE.settings || { model: 'claude-haiku-4-5', useAI: false };

  /* 업로드 과제물(메모리 전용, localStorage에 저장 안 함) */
  const uploads = (window.DH_UPLOADS = window.DH_UPLOADS || {}); // ukey -> {name, mediaType, data}

  /* ---------- 상태 ---------- */
  const state = { grade: null, cls: null, cat: 'autonomy', itemId: null };
  const regenCount = {};

  /* ---------- 학생 ---------- */
  const STU = (window.DH_STUDENTS || []).map(a => ({ grade: a[0], cls: a[1], num: a[2], name: a[3] }));
  const byNum = {}; STU.forEach(s => byNum[s.num] = s);
  function classStudents(g, c) { return STU.filter(s => s.grade === g && s.cls === c); }

  /* ---------- 드래프트 ---------- */
  function dkey(num, cat, itemId) { return num + '|' + cat + '|' + itemId; }
  function ukey(num) { return dkey(num, state.cat, state.itemId); }
  function setDraft(num, patch) {
    const k = dkey(num, state.cat, state.itemId);
    const d = STORE.drafts[k] || { text: '', kw: [] };
    Object.assign(d, patch, { updated: Date.now() });
    if (!d.text && (!d.kw || !d.kw.length)) delete STORE.drafts[k];
    else STORE.drafts[k] = d;
    save();
  }
  function draftOf(num) { return STORE.drafts[dkey(num, state.cat, state.itemId)] || { text: '', kw: [] }; }

  /* ---------- 카테고리/아이템 ---------- */
  function curCat() { return window.DH_CATEGORIES.find(c => c.id === state.cat); }
  function dateKey(s) { const m = (s || '').match(/(\d+)월\s*(\d+)일/); return m ? (+m[1]) * 100 + (+m[2]) : 9999; }
  function itemOptions() {
    const cat = state.cat;
    if (cat === 'club') return window.DH_CLUBS.map(n => ({ id: 'club:' + n, label: n, club: n }));
    if (cat === 'subject') return window.DH_SUBJECTS.map(s => ({ id: 'subj:' + s.name, label: s.name + ' 세특', subj: s }));
    if (cat === 'behavior') return [{ id: 'behavior', label: '행동특성 및 종합의견' }];
    return window.DH_ACTIVITIES.filter(a => a.cat === cat)
      .filter(a => !state.grade || a.grades.indexOf(state.grade) >= 0)
      .slice().sort((a, b) => dateKey(a.date) - dateKey(b.date))
      .map(a => ({ id: a.id, label: a.name + (a.date ? ' (' + a.date + ')' : ''), act: a }));
  }
  function curItem() { const o = itemOptions(); return o.find(x => x.id === state.itemId) || o[0]; }
  const isClub = () => state.cat === 'club';
  const isSubj = () => state.cat === 'subject';
  const isRoster = () => isClub() || isSubj();

  /* ---------- 명단(동아리/교과 공통) ---------- */
  function clubName() { const it = curItem(); return it && it.club; }
  function subjName() { const it = curItem(); return it && it.subj && it.subj.name; }
  function rosterKey() { return isClub() ? 'club|' + clubName() : 'subj|' + subjName(); }
  function getRoster() { return (STORE.rosters[rosterKey()] || []).slice(); }
  function setRoster(arr) { STORE.rosters[rosterKey()] = arr; save(); }
  function inRoster(num) { return getRoster().indexOf(num) >= 0; }
  function toggleRoster(num) { const r = getRoster(); const i = r.indexOf(num); if (i >= 0) r.splice(i, 1); else r.push(num); setRoster(r); renderStudents(); renderTable(); }
  function addManyToRoster(nums) { const r = getRoster(); nums.forEach(n => { if (r.indexOf(n) < 0) r.push(n); }); setRoster(r); }

  /* ---------- 교과 주요활동 ---------- */
  function subjActivity() { return (STORE.subjMeta[subjName()] || {}).activity || ''; }
  function setSubjActivity(v) { STORE.subjMeta[subjName()] = { activity: v }; save(); }

  /* ---------- 표 대상 학생 ---------- */
  function tableStudents() {
    if (isRoster()) return getRoster().map(n => byNum[n]).filter(Boolean);
    if (!state.grade || !state.cls) return [];
    return classStudents(state.grade, state.cls);
  }
  function targetStudents() { return tableStudents(); }

  /* ---------- 생성 ---------- */
  function buildGenOpts(num, kws, variant) {
    const it = curItem();
    const base = { seed: num, variant: variant || 0, keywords: kws, category: state.cat };
    if (isClub()) base.clubName = it.club;
    else if (isSubj()) { base.subject = it.subj; base.subjectActivity = subjActivity(); }
    else if (state.cat !== 'behavior') base.activity = it.act;
    return base;
  }
  function genLocal(num, kws, variant) { return E.generate(buildGenOpts(num, kws, variant)); }

  /* ---------- AI ---------- */
  function aiOn() { return !!STORE.settings.useAI; }
  function aiContext() {
    const it = curItem();
    if (state.cat === 'behavior') return '영역: 행동특성 및 종합의견 (담임교사 종합 관찰 의견)';
    if (isClub()) return '영역: 동아리활동\n동아리명: ' + it.club;
    if (isSubj()) return '영역: 교과 세부능력 및 특기사항\n과목: ' + it.subj.name + '\n주요 학습: ' + it.subj.topics.join(', ') + (subjActivity() ? '\n수업 주요 활동: ' + subjActivity() : '');
    return '영역: ' + curCat().name + '\n활동: ' + it.act.name + (it.act.date ? ' (' + it.act.date + ')' : '') + '\n활동 개요: ' + it.act.intro[0];
  }
  async function aiGenerate(kws, file) {
    const payload = { context: aiContext(), keywords: kws, model: STORE.settings.model || 'claude-haiku-4-5' };
    if (file && file.data) payload.file = { mediaType: file.mediaType, data: file.data };
    const res = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    let data = {}; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('오류 ' + res.status));
    if (!data.text) throw new Error('빈 응답');
    return data.text;
  }
  async function pool(items, worker, size, onProgress) {
    let i = 0, done = 0;
    async function run() { while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch (e) {} done++; onProgress && onProgress(done, items.length); } }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
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
        if (isSubj() && getRoster().length === 0) subjectSetupModal();
      };
      t.appendChild(b);
    });
  }

  function renderItemPick() {
    const wrap = $('itemPick'); wrap.innerHTML = '';
    const opts = itemOptions();
    if (!state.itemId || !opts.find(o => o.id === state.itemId)) state.itemId = opts[0] && opts[0].id;
    $('subjSetup').classList.toggle('hidden', !isSubj());
    if (state.cat === 'behavior') { wrap.innerHTML = '<label>행동특성 및 종합의견</label>'; return; }
    const lab = document.createElement('label');
    lab.textContent = isClub() ? '동아리' : isSubj() ? '과목' : '활동';
    const sel = document.createElement('select');
    opts.forEach(o => { const op = document.createElement('option'); op.value = o.id; op.textContent = o.label; sel.appendChild(op); });
    sel.value = state.itemId;
    sel.onchange = () => { state.itemId = sel.value; renderStudents(); renderTable(); };
    wrap.appendChild(lab); wrap.appendChild(sel);
  }

  /* ---------- 사이드바 ---------- */
  function renderStudents() {
    const head = $('classTitle'), prog = $('progress'), list = $('studentList');
    list.innerHTML = '';
    const q = ($('search').value || '').trim();

    if (isRoster()) {
      head.textContent = (state.grade && state.cls) ? (state.grade + '학년 ' + state.cls + '반 · 학생 추가') : '학년·반을 고르세요';
      prog.textContent = '명단 ' + getRoster().length + '명';
      if (!state.grade || !state.cls) return;
      let arr = classStudents(state.grade, state.cls);
      if (q) arr = arr.filter(s => s.name.indexOf(q) >= 0 || String(s.num).indexOf(q) >= 0);
      arr.forEach(s => {
        const li = document.createElement('li');
        const added = inRoster(s.num);
        if (added) li.classList.add('added');
        li.innerHTML = '<span class="s-name">' + esc(s.name) + '</span>' +
          '<span class="s-meta"><span class="s-no">' + s.num + '</span>' +
          '<span class="add' + (added ? ' on' : '') + '">' + (added ? '✓ 추가됨' : '＋ 추가') + '</span></span>';
        li.onclick = () => toggleRoster(s.num);
        list.appendChild(li);
      });
      return;
    }

    if (!state.grade || !state.cls) { head.textContent = '학년·반을 선택하세요'; prog.textContent = ''; return; }
    let arr = classStudents(state.grade, state.cls);
    head.textContent = state.grade + '학년 ' + state.cls + '반 · ' + arr.length + '명';
    const done = arr.filter(s => draftOf(s.num).text).length;
    prog.textContent = '작성 ' + done + '/' + arr.length;
    if (q) arr = arr.filter(s => s.name.indexOf(q) >= 0 || String(s.num).indexOf(q) >= 0);
    arr.forEach(s => {
      const li = document.createElement('li');
      const written = draftOf(s.num).text;
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
  function updateGenLabel() { $('genAll').textContent = isClub() ? '⚡ 명단 전체 생성' : isSubj() ? '⚡ 명단 전체 생성' : '⚡ 반 전체 초안 생성'; }

  function renderTable() {
    const headEl = $('gridHead'), body = $('grid'), empty = $('gridEmpty'), hint = $('tableHint');
    updateGenLabel();
    body.innerHTML = ''; headEl.innerHTML = '';

    if (isRoster() && getRoster().length === 0) {
      empty.classList.remove('hidden');
      if (isSubj()) {
        empty.innerHTML = '<p>교과세특은 <b>원하는 학생만</b> 작성합니다.<br>상단 <b>🧩 대상·활동 설정</b>으로 과목·대상 학생·주요 활동을 정하거나, 왼쪽에서 학생의 <b>＋추가</b>를 누르세요.</p>';
        hint.innerHTML = '<b>교과 세특</b> · 과목과 대상 학생을 먼저 설정하세요.';
      } else {
        empty.innerHTML = '<p>이 동아리는 명단이 비어 있습니다.<br>👈 왼쪽에서 <b>학년·반</b>을 고른 뒤 학생의 <b>＋추가</b>를 눌러 명단을 만드세요.</p>';
        hint.innerHTML = '<b>동아리활동</b> · 반이 아니라 <b>지원 학생</b>으로 구성됩니다.';
      }
      return;
    }
    if (!isRoster() && (!state.grade || !state.cls)) {
      empty.classList.remove('hidden');
      empty.innerHTML = '<p>👈 왼쪽에서 <b>학년 → 반</b>을 선택하면 학생 명단이 표로 나타납니다.</p>';
      hint.textContent = ''; return;
    }
    empty.classList.add('hidden');

    const it = curItem(); const label = it ? it.label : curCat().name;
    if (isSubj()) hint.innerHTML = '<b>교과 세특</b> · ' + esc(label) + (subjActivity() ? ' &nbsp;|&nbsp; 주요 활동: <b>' + esc(subjActivity()) + '</b>' : '') + ' &nbsp;|&nbsp; 명단 <b>' + getRoster().length + '명</b>. 학생별 <b>키워드</b>·<b>과제물 업로드</b> 후 생성하세요. (과제물 인식은 ✨AI 모드 필요)';
    else if (isClub()) hint.innerHTML = '<b>동아리활동</b> · ' + esc(label) + ' &nbsp;|&nbsp; 명단 <b>' + getRoster().length + '명</b>. 행의 <b>✕</b>로 명단에서 뺄 수 있어요.';
    else hint.innerHTML = '<b>' + esc(curCat().name) + '</b> · ' + esc(label) + ' &nbsp;|&nbsp; 학생별 <b>키워드</b>(쉼표 구분)를 적고 <b>반 전체 초안 생성</b>을 누르세요.';

    // 머리글
    let h = '<tr>';
    if (isRoster()) h += '<th class="c-cls">학년·반</th>';
    h += '<th class="c-no">학번</th><th class="c-name">이름</th><th class="c-kw">키워드 입력</th>';
    if (isSubj()) h += '<th class="c-file">과제물</th>';
    h += '<th>생활기록부 내용</th><th class="c-cnt">글자</th><th class="c-act">동작</th></tr>';
    headEl.innerHTML = h;

    const q = ($('search').value || '').trim();
    tableStudents().forEach(s => {
      if (q && s.name.indexOf(q) < 0 && String(s.num).indexOf(q) < 0) return;
      const d = draftOf(s.num);
      const up = uploads[ukey(s.num)];
      const tr = document.createElement('tr'); tr.dataset.num = s.num;
      let row = '';
      if (isRoster()) row += '<td class="c-cls">' + s.grade + '-' + s.cls + '</td>';
      row += '<td>' + s.num + '</td><td class="bt-name">' + esc(s.name) + '</td>' +
        '<td><textarea class="kw" data-num="' + s.num + '" placeholder="예) 성실, 발표">' + esc(kwToStr(d.kw)) + '</textarea></td>';
      if (isSubj()) row += '<td class="c-file">' +
        '<label class="file-btn">📎 과제<input type="file" accept="image/*,application/pdf" data-file="' + s.num + '" hidden></label>' +
        '<div class="file-name" data-fname="' + s.num + '">' + (up ? '✓ ' + esc(up.name) + ' <span class="file-x" data-fx="' + s.num + '">✕</span>' : '') + '</div></td>';
      row += '<td><textarea class="content" data-num="' + s.num + '" placeholder="생성 또는 직접 입력">' + esc(d.text || '') + '</textarea></td>' +
        '<td class="bt-cnt" data-cnt="' + s.num + '">' + cntClass(E.charCount(d.text || '')) + '</td>' +
        '<td><div class="row-acts">' +
          '<button class="icon-btn gen" data-gen="' + s.num + '" title="생성/다시 생성">🔄</button>' +
          '<button class="icon-btn del" data-del="' + s.num + '" title="내용 삭제">🗑</button>' +
          (isRoster() ? '<button class="icon-btn rm" data-rm="' + s.num + '" title="명단에서 제거">✕</button>' : '') +
        '</div></td>';
      tr.innerHTML = row; body.appendChild(tr);
    });

    body.querySelectorAll('textarea').forEach(autoGrow);
    body.querySelectorAll('textarea.kw').forEach(ta => { ta.oninput = () => { autoGrow(ta); setDraft(+ta.dataset.num, { kw: parseKw(ta.value) }); }; });
    body.querySelectorAll('textarea.content').forEach(ta => {
      ta.oninput = () => { autoGrow(ta); const num = +ta.dataset.num; setDraft(num, { text: ta.value }); const c = $('grid').querySelector('[data-cnt="' + num + '"]'); if (c) c.innerHTML = cntClass(E.charCount(ta.value)); };
      ta.onblur = renderStudents;
    });
    body.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => genOne(+b.dataset.gen));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delOne(+b.dataset.del));
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => toggleRoster(+b.dataset.rm));
    body.querySelectorAll('[data-file]').forEach(inp => inp.onchange = () => onFile(inp));
    body.querySelectorAll('[data-fx]').forEach(x => x.onclick = () => { delete uploads[ukey(+x.dataset.fx)]; renderTable(); });
  }

  /* ---------- 과제물 업로드 ---------- */
  function onFile(inp) {
    const num = +inp.dataset.file; const f = inp.files && inp.files[0]; if (!f) return;
    const isImg = /^image\//.test(f.type);
    const isPdf = f.type === 'application/pdf';
    if (!isImg && !isPdf) { toast('이미지 또는 PDF만 업로드할 수 있습니다'); return; }
    if (!aiOn()) toast('과제물 인식은 ✨AI 모드에서만 반영됩니다(상단 토글)');
    if (isImg) {
      readImageDownscaled(f, (mediaType, data) => { uploads[ukey(num)] = { name: f.name, mediaType: mediaType, data: data }; setFname(num, f.name); });
    } else {
      const rd = new FileReader();
      rd.onload = () => {
        const data = String(rd.result).split(',')[1] || '';
        if (data.length > 4 * 1024 * 1024) { toast('PDF가 너무 큽니다(약 3MB 이하 권장). 이미지로 줄여 올려 주세요.'); return; }
        uploads[ukey(num)] = { name: f.name, mediaType: 'application/pdf', data: data }; setFname(num, f.name);
      };
      rd.readAsDataURL(f);
    }
  }
  function setFname(num, name) {
    const el = $('grid').querySelector('[data-fname="' + num + '"]');
    if (el) { el.innerHTML = '✓ ' + esc(name) + ' <span class="file-x" data-fx="' + num + '">✕</span>'; const x = el.querySelector('[data-fx]'); if (x) x.onclick = () => { delete uploads[ukey(num)]; renderTable(); }; }
  }
  function readImageDownscaled(file, cb) {
    try {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1568; let w = img.width || 1024, hgt = img.height || 768;
        const sc = Math.min(1, max / Math.max(w, hgt)); const cw = Math.round(w * sc), ch = Math.round(hgt * sc);
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
        const durl = cv.toDataURL('image/jpeg', 0.82); URL.revokeObjectURL(url);
        cb('image/jpeg', durl.split(',')[1] || '');
      };
      img.onerror = () => { toast('이미지를 읽을 수 없습니다'); };
      img.src = url;
    } catch (e) { toast('이미지 처리 실패'); }
  }

  /* ---------- 생성/삭제 ---------- */
  function rowKw(num) {
    const ta = $('grid').querySelector('textarea.kw[data-num="' + num + '"]');
    const cell = ta ? parseKw(ta.value) : null;
    if (cell && cell.length) return cell;
    const saved = draftOf(num).kw; if (saved && saved.length) return saved;
    return parseKw($('commonKw').value);
  }
  function putRow(num, text) {
    setDraft(num, { text: text, kw: draftOf(num).kw || [] });
    const ta = $('grid').querySelector('textarea.content[data-num="' + num + '"]'); if (ta) { ta.value = text; autoGrow(ta); }
    const c = $('grid').querySelector('[data-cnt="' + num + '"]'); if (c) c.innerHTML = cntClass(E.charCount(text));
  }
  async function genOne(num) {
    const k = dkey(num, state.cat, state.itemId);
    regenCount[k] = (regenCount[k] || 0) + 1;
    const kws = rowKw(num);
    if (aiOn()) {
      const btn = $('grid').querySelector('[data-gen="' + num + '"]'); const old = btn ? btn.textContent : '';
      if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
      try { putRow(num, await aiGenerate(kws, uploads[ukey(num)])); }
      catch (e) { toast('AI 실패 — 로컬로 대체: ' + e.message); putRow(num, genLocal(num, kws, regenCount[k])); }
      if (btn) { btn.textContent = old || '🔄'; btn.disabled = false; }
    } else putRow(num, genLocal(num, kws, regenCount[k]));
    renderStudents();
  }
  function delOne(num) {
    setDraft(num, { text: '' });
    const ta = $('grid').querySelector('textarea.content[data-num="' + num + '"]'); if (ta) { ta.value = ''; autoGrow(ta); }
    const c = $('grid').querySelector('[data-cnt="' + num + '"]'); if (c) c.innerHTML = cntClass(0);
    renderStudents();
  }
  async function genAll() {
    const arr = targetStudents();
    if (!arr.length) { toast(isSubj() ? '대상 학생을 먼저 설정하세요' : isClub() ? '명단에 학생을 추가하세요' : '학년·반을 먼저 선택하세요'); return; }
    if (aiOn()) {
      const btn = $('genAll'); const old = btn.textContent; btn.disabled = true; let fails = 0;
      await pool(arr, async (s) => {
        const kws = rowKw(s.num);
        try { putRow(s.num, await aiGenerate(kws, uploads[ukey(s.num)])); }
        catch (e) { fails++; putRow(s.num, genLocal(s.num, kws, 0)); }
      }, 4, (d, n) => { btn.textContent = '✨ AI 생성 중 ' + d + '/' + n; });
      btn.textContent = old; btn.disabled = false; renderStudents();
      toast('AI 생성 완료' + (fails ? ' (실패 ' + fails + '건은 로컬로 대체)' : ''));
    } else {
      arr.forEach(s => { const k = dkey(s.num, state.cat, state.itemId); putRow(s.num, genLocal(s.num, rowKw(s.num), regenCount[k] || 0)); });
      renderStudents(); toast(arr.length + '명 초안 생성 완료(로컬)');
    }
  }
  function delAll() {
    const arr = targetStudents();
    const n = arr.filter(s => draftOf(s.num).text).length;
    if (!n) { toast('삭제할 내용이 없습니다'); return; }
    const scope = isRoster() ? '명단' : curCat().name;
    if (!confirm(scope + ' ' + n + '명의 생기부 내용을 모두 삭제할까요?\n키워드는 유지됩니다.')) return;
    arr.forEach(s => setDraft(s.num, { text: '' }));
    renderTable(); renderStudents(); toast(n + '명 내용 삭제 완료');
  }
  function focusRow(num) {
    const tr = $('grid').querySelector('tr[data-num="' + num + '"]'); if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 900);
    const ta = tr.querySelector('textarea.kw'); if (ta) ta.focus();
  }

  /* ---------- 내보내기 ---------- */
  function copyAll() {
    const arr = targetStudents(); if (!arr.length) { toast('대상 학생이 없습니다'); return; }
    const lines = arr.map(s => { const d = draftOf(s.num); return s.num + ' ' + s.name + '\n' + (d.text || '') + '\n'; });
    copy(lines.join('\n')); toast('대상 학생 내용을 복사했습니다');
  }
  function csvAll() {
    const arr = targetStudents(); if (!arr.length) { toast('대상 학생이 없습니다'); return; }
    const it = curItem();
    const rows = [['학년', '반', '학번', '이름', '영역', '항목', '키워드', '내용']];
    arr.forEach(s => { const d = draftOf(s.num); rows.push([s.grade, s.cls, s.num, s.name, curCat().name, it ? it.label : '', kwToStr(d.kw), (d.text || '').replace(/\r?\n/g, ' ')]); });
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const tag = isClub() ? clubName() : isSubj() ? subjName() : (state.grade + '학년' + state.cls + '반');
    download('﻿' + csv, '동화중_' + curCat().name + '_' + tag + '.csv', 'text/csv;charset=utf-8');
    toast('CSV 파일을 내려받았습니다');
  }
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  /* ---------- 엔진 토글 ---------- */
  function renderEngineToggle() {
    document.querySelectorAll('#engineToggle button').forEach(b => {
      const on = STORE.settings.useAI ? b.dataset.eng === 'ai' : b.dataset.eng === 'local';
      b.classList.toggle('active', on);
      b.title = b.dataset.eng === 'ai' ? 'Claude AI로 생성 (배포 환경변수 키 · ' + (STORE.settings.model || 'claude-haiku-4-5') + ')' : '로컬 생성(무료·오프라인)';
    });
  }
  function setEngine(useAI) { STORE.settings.useAI = useAI; save(); renderEngineToggle(); toast(useAI ? '✨ AI 생성 모드' : '🔒 로컬 생성 모드'); }

  /* ---------- 모달 ---------- */
  function modal(title, html) { $('modalTitle').textContent = title; $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); }
  function closeModal() { $('modal').classList.add('hidden'); }

  /* 교과세특 설정 모달: 과목 / 대상 학생(전체·일부) / 주요 활동 */
  function subjectSetupModal() {
    if (!isSubj()) return;
    const subs = window.DH_SUBJECTS;
    const g0 = state.grade || 1, c0 = state.cls || 1;
    modal('교과 세특 설정', `
      <div class="field-label">과목</div>
      <select id="suSubj"></select>
      <div class="field-label">주요 활동 / 수업·평가 주제</div>
      <textarea id="suAct" rows="2" placeholder="예) 이차함수 그래프 탐구 발표, 모둠 신문 제작 프로젝트"></textarea>
      <div class="field-label">대상 학생 추가</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <select id="suGrade" style="flex:1"></select>
        <select id="suCls" style="flex:1"></select>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:8px">
        <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="suScope" value="all" checked> 이 반 전체</label>
        <label style="display:flex;gap:6px;align-items:center"><input type="radio" name="suScope" value="some"> 일부 선택</label>
      </div>
      <div id="suList" class="su-list hidden"></div>
      <div style="font-size:12px;color:#6b7280;margin:8px 0">현재 명단: <b id="suCount">0</b>명 &nbsp; <a href="#" id="suClear" style="color:#dc2626">명단 비우기</a></div>
      <div class="row-btns">
        <button class="primary" id="suAdd">＋ 선택 학생 추가</button>
        <button class="ghost" id="suDone">완료</button>
      </div>
    `);
    const suSubj = $('suSubj'); subs.forEach(s => { const o = document.createElement('option'); o.value = 'subj:' + s.name; o.textContent = s.name; suSubj.appendChild(o); });
    suSubj.value = state.itemId;
    const suGrade = $('suGrade'); [1, 2, 3].forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g + '학년'; suGrade.appendChild(o); }); suGrade.value = g0;
    const suCls = $('suCls'); for (let c = 1; c <= 8; c++) { const o = document.createElement('option'); o.value = c; o.textContent = c + '반'; suCls.appendChild(o); } suCls.value = c0;
    $('suAct').value = subjActivity();

    function refreshCount() { $('suCount').textContent = getRoster().length; }
    function rebuildList() {
      const box = $('suList'); box.innerHTML = '';
      classStudents(+suGrade.value, +suCls.value).forEach(s => {
        const id = 'su_' + s.num;
        const row = document.createElement('label'); row.className = 'su-item';
        row.innerHTML = '<input type="checkbox" id="' + id + '" value="' + s.num + '"' + (inRoster(s.num) ? ' checked' : '') + '> ' + esc(s.name) + ' <span class="s-no">' + s.num + '</span>';
        box.appendChild(row);
      });
    }
    function scope() { const r = document.querySelector('input[name="suScope"]:checked'); return r ? r.value : 'all'; }
    function syncScope() { $('suList').classList.toggle('hidden', scope() !== 'some'); if (scope() === 'some') rebuildList(); }

    suSubj.onchange = () => { state.itemId = suSubj.value; $('suAct').value = subjActivity(); refreshCount(); renderItemPick(); };
    suGrade.onchange = suCls.onchange = () => { if (scope() === 'some') rebuildList(); };
    Array.prototype.forEach.call(document.querySelectorAll('input[name="suScope"]'), r => r.onchange = syncScope);
    $('suAct').oninput = () => setSubjActivity($('suAct').value);
    $('suClear').onclick = (e) => { e.preventDefault(); if (confirm('이 과목의 명단을 모두 비울까요?')) { setRoster([]); refreshCount(); rebuildList && rebuildList(); renderStudents(); renderTable(); } };
    $('suAdd').onclick = () => {
      setSubjActivity($('suAct').value);
      let nums;
      if (scope() === 'all') nums = classStudents(+suGrade.value, +suCls.value).map(s => s.num);
      else nums = Array.prototype.map.call(document.querySelectorAll('#suList input:checked'), ch => +ch.value);
      if (!nums.length) { toast('추가할 학생이 없습니다'); return; }
      addManyToRoster(nums);
      state.grade = +suGrade.value; state.cls = +suCls.value;
      refreshCount(); renderGradeClass(); renderStudents(); renderTable();
      toast(nums.length + '명 추가 (명단 ' + getRoster().length + '명)');
    };
    $('suDone').onclick = () => { setSubjActivity($('suAct').value); closeModal(); renderItemPick(); renderStudents(); renderTable(); };
    refreshCount();
  }

  function guideModal() {
    modal('사용법', `
      <h3>1. 학급 선택</h3><p>왼쪽 위 <b>학년 → 반</b>을 클릭하면 그 반 학생이 표로 나타납니다.</p>
      <h3>2. 영역 선택</h3><p>상단 탭에서 영역을 고릅니다. 자율·진로·봉사는 <b>날짜 순</b> 정렬됩니다.</p>
      <h3>3. 키워드 → 생성</h3><p>학생 왼쪽 칸에 키워드(쉼표 구분)를 적고 <b>⚡ 생성</b>을 누르면 200~300자 문장이 학생마다 다르게 채워집니다.</p>
      <h3>4. 교과 세특</h3><p>기본 명단이 비어 있습니다. <b>🧩 대상·활동 설정</b>에서 <b>과목·대상 학생(전체/일부)·주요 활동</b>을 정하세요. 각 학생 행에서 <b>📎 과제</b>로 과제물(이미지/PDF)을 올리면, <b>✨AI 모드</b>에서 그 내용을 분석해 생기부 초안을 써 줍니다.</p>
      <h3>5. 동아리활동</h3><p>반이 아니라 지원 학생으로 구성됩니다. 왼쪽에서 학년·반을 옮겨 가며 <b>＋추가</b>로 명단을 만들고, 행의 <b>✕</b>로 제거합니다.</p>
      <h3>6. 그 밖에</h3><p>행별 <b>🔄</b>/<b>🗑</b>, 상단 <b>🗑 일괄 삭제</b>·<b>전체 복사</b>·<b>CSV</b>. 모든 작업 자동 저장(과제물 파일은 새로고침 시 다시 업로드 필요).</p>
      <h3>7. 로컬 / ✨AI</h3><p>기본은 로컬(무료·오프라인). ✨AI는 배포(Vercel) 환경변수 키로 동작하며 과제물 인식·고급 문장이 가능합니다. 실패 시 자동 로컬 대체.</p>
      <p style="color:#6b7280;margin-top:12px">※ 결과는 <b>초안</b>입니다. 실제 활동·관찰을 확인하고 검토·수정 후 기재하세요.</p>
    `);
  }
  function settingsModal() {
    const s = STORE.settings;
    modal('설정', `
      <div class="field-label">생성 방식</div>
      <label style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <input type="checkbox" id="setUseAI" ${s.useAI ? 'checked' : ''}> AI 고급생성 사용 (배포 환경변수 키 · 상단 ✨AI 토글과 연동)
      </label>
      <div class="field-label">AI 모델</div>
      <select id="setModel">
        <option value="claude-haiku-4-5">claude-haiku-4-5 (가장 저렴·권장)</option>
        <option value="claude-sonnet-4-6">claude-sonnet-4-6 (문장 품질↑)</option>
        <option value="claude-opus-4-8">claude-opus-4-8 (최고품질·고가)</option>
      </select>
      <p style="color:#6b7280">API 키는 앱에 저장하지 않습니다. <b>Vercel 환경변수 <code>ANTHROPIC_API_KEY</code></b> 로 주입되어 서버 함수(<code>/api/generate</code>)에서만 사용됩니다. 모델 기본값은 <code>ANTHROPIC_MODEL</code> 로도 지정 가능.</p>
      <div class="row-btns">
        <button class="primary" id="setSave">저장</button>
        <button class="ghost" id="setReset">전체 작성내용 초기화</button>
      </div>
    `);
    $('setModel').value = s.model || 'claude-haiku-4-5';
    $('setSave').onclick = () => { STORE.settings.useAI = $('setUseAI').checked; STORE.settings.model = $('setModel').value; save(); closeModal(); renderEngineToggle(); toast('설정을 저장했습니다'); };
    $('setReset').onclick = () => { if (confirm('저장된 모든 생기부 내용·동아리 명단·교과 설정을 삭제할까요? (되돌릴 수 없습니다)')) { STORE.drafts = {}; STORE.rosters = {}; STORE.subjMeta = {}; save(); closeModal(); renderStudents(); renderTable(); toast('초기화되었습니다'); } };
  }
  function backupModal() {
    modal('백업 / 복원', `
      <p>작성 항목 <b>${Object.keys(STORE.drafts).length}개</b> · 명단 <b>${Object.keys(STORE.rosters).length}개</b></p>
      <p>다른 컴퓨터로 옮기거나 보관하려면 백업 파일을 내려받으세요. (과제물 파일은 백업에 포함되지 않습니다)</p>
      <div class="row-btns">
        <button class="primary" id="bkExport">⬇️ 백업 파일 내려받기</button>
        <label class="ghost" style="display:inline-flex;align-items:center;cursor:pointer">📂 복원하기<input type="file" id="bkImport" accept="application/json" style="display:none"></label>
      </div>
    `);
    $('bkExport').onclick = () => download(JSON.stringify({ drafts: STORE.drafts, rosters: STORE.rosters, subjMeta: STORE.subjMeta, exportedAt: new Date().toISOString() }, null, 1), '동화중_생기부백업_' + ymd() + '.json', 'application/json');
    $('bkImport').onchange = (ev) => { const f = ev.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const o = JSON.parse(rd.result); Object.assign(STORE.drafts, o.drafts || {}); Object.assign(STORE.rosters, o.rosters || {}); Object.assign(STORE.subjMeta, o.subjMeta || {}); save(); closeModal(); renderStudents(); renderTable(); toast('복원 완료'); } catch (e) { toast('파일을 읽을 수 없습니다'); } }; rd.readAsText(f); };
  }

  /* ---------- 유틸 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  function copy(t) { if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => fb(t)); else fb(t); function fb(x) { const a = document.createElement('textarea'); a.value = x; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); } }
  function download(text, name, type) { const b = new Blob([text], { type: type }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  function ymd() { const d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  let toastT; function toast(m) { const el = $('toast'); el.textContent = m; el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2400); }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('search').oninput = () => { renderStudents(); renderTable(); };
    document.querySelectorAll('#engineToggle button').forEach(b => b.onclick = () => setEngine(b.dataset.eng === 'ai'));
    $('subjSetup').onclick = subjectSetupModal;
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
