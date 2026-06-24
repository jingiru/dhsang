/* =========================================================================
 *  생활기록부 문장 생성 엔진 (로컬, 오프라인)
 *  - 키워드 + 학교 활동 데이터를 결합해 200~300자 초안을 생성
 *  - 학생마다(좌석번호 seed) 다른 문장이 나오도록 구성
 * ========================================================================= */
(function () {
  'use strict';

  /* ---- 한글 글자 수 (공백 포함) ---- */
  function charCount(s) { return (s || '').replace(/\s/g, '').length; }      // 공백 제외 순수 글자 수
  function lenAll(s) { return (s || '').length; }                            // 공백 포함

  /* ---- 시드 기반 난수 (mulberry32) ---- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function shuffled(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---- 한글 조사 자동 선택 (받침 유무) ---- */
  function hasJong(word) {
    if (!word) return false;
    const c = word[word.length - 1].charCodeAt(0);
    if (c < 0xAC00 || c > 0xD7A3) return false;
    return (c - 0xAC00) % 28 !== 0;
  }
  function josa(word, withJong, withoutJong) {
    return word + (hasJong(word) ? withJong : withoutJong);
  }

  /* ---- 키워드 → 생기부 문장 확장 ---- */
  function expandKeyword(kw, r) {
    const dict = window.DH_KEYWORDS || {};
    if (dict[kw]) return pick(dict[kw], r);
    // 사전에 없는 자유 키워드 → 조사 처리한 안전한 문장
    const fallbacks = [
      josa(kw, '', '') + ' 면에서 강점이 돋보이며 이를 꾸준히 발휘하는 모습을 보임',
      josa(kw, '과', '와') + ' 관련하여 적극적이고 성실한 태도로 활동에 참여함',
      '평소 ' + josa(kw, '을', '를') + ' 바탕으로 활동에 진지하게 임하는 모습이 인상적임',
      '특히 ' + josa(kw, '이', '가') + ' 돋보이며 관련 활동에서 두각을 나타냄'
    ];
    return pick(fallbacks, r);
  }

  /* ---- 문장 마침표 정리 ---- */
  function endDot(s) {
    s = s.trim();
    if (!s) return s;
    if (/[.!?]$/.test(s)) return s;
    return s + '.';
  }

  /* ---- 조립기: 우선순위 문장들을 200~300자 목표로 합침 ----
   *  parts = { intro, keywordSents[], bodyPool[], outcome }
   */
  function assemble(parts, r, opts) {
    opts = opts || {};
    const MIN = opts.min || 200;
    const MAX = opts.max || 300;
    const connectors = window.DH_CONNECTORS || [''];

    const out = [];
    if (parts.intro) out.push(endDot(parts.intro));

    // 키워드 문장 (교사 입력 우선)
    (parts.keywordSents || []).forEach(function (s, i) {
      let c = (i > 0 && r() > 0.5) ? pick(connectors, r) : '';
      out.push(endDot(c + s));
    });

    // 본문 풀에서 길이 채우기 (caller가 우선순위대로 정렬해 전달)
    const bodies = parts.bodyPool || [];
    let bi = 0;
    function curLen() { return charCount(out.join(' ')); }
    // outcome 길이 예약
    const outcomeLen = parts.outcome ? charCount(parts.outcome) : 0;
    while (bi < bodies.length && curLen() + outcomeLen < MIN) {
      out.push(endDot(bodies[bi++]));
    }
    // 키워드가 없거나 너무 짧으면 본문 하나 더
    if (curLen() + outcomeLen < MIN - 30 && bi < bodies.length) {
      out.push(endDot(bodies[bi++]));
    }

    if (parts.outcome) out.push(endDot(parts.outcome));

    // 길이 초과 시 본문 문장부터 제거 (intro/키워드/outcome 보존)
    let text = out.join(' ');
    while (charCount(text) > MAX && out.length > 2) {
      // 뒤에서부터 outcome 직전(본문)을 제거
      let removeIdx = -1;
      for (let i = out.length - 2; i >= 1; i--) {
        // intro(0)·키워드 문장은 보존, 본문만 제거 대상
        removeIdx = i; break;
      }
      if (removeIdx <= 0) break;
      out.splice(removeIdx, 1);
      text = out.join(' ');
    }
    return text.trim();
  }

  /* ---- 활동(자율/진로/봉사) 생성 ---- */
  function genActivity(activity, keywords, seed, variant) {
    const r = rng(seed * 131 + (variant || 0) * 977 + 17);
    const kwSents = (keywords || []).filter(Boolean).map(function (k) { return expandKeyword(k, r); });
    const bodyPool = shuffled(activity.body, r).concat(shuffled(window.DH_COMMON_BODY || [], r));
    return assemble({
      intro: pick(activity.intro, r),
      keywordSents: kwSents,
      bodyPool: bodyPool,
      outcome: pick(activity.outcome, r)
    }, r);
  }

  /* ---- 동아리 생성 ---- */
  function genClub(clubName, keywords, seed, variant) {
    const r = rng(seed * 197 + (variant || 0) * 613 + 41);
    const tpl = window.DH_CLUB_TPL;
    const kwSents = (keywords || []).filter(Boolean).map(function (k) { return expandKeyword(k, r); });
    const intro = '‘' + clubName + '’ ' + pick(tpl.intro, r);
    return assemble({
      intro: intro,
      keywordSents: kwSents,
      bodyPool: shuffled(tpl.body, r),
      outcome: pick(tpl.outcome, r)
    }, r);
  }

  /* ---- 교과 세특 생성 ---- */
  function genSubject(subject, keywords, seed, variant) {
    const r = rng(seed * 241 + (variant || 0) * 419 + 53);
    const tpl = window.DH_SUBJECT_TPL;
    const topic = pick(subject.topics, r);
    const intro = pick(tpl.intro, r).replace('{subj}', subject.name).replace('{topic}', topic);
    const kwSents = (keywords || []).filter(Boolean).map(function (k) { return expandKeyword(k, r); });
    return assemble({
      intro: intro,
      keywordSents: kwSents,
      bodyPool: shuffled(tpl.body, r),
      outcome: pick(tpl.outcome, r)
    }, r);
  }

  /* ---- 행동특성 및 종합의견 생성 (조금 더 길게 허용) ---- */
  function genBehavior(keywords, seed, variant) {
    const r = rng(seed * 271 + (variant || 0) * 353 + 89);
    const tpl = window.DH_BEHAVIOR_TPL;
    const kwSents = (keywords || []).filter(Boolean).map(function (k) { return expandKeyword(k, r); });
    return assemble({
      intro: pick(tpl.intro, r),
      keywordSents: kwSents,
      bodyPool: shuffled(tpl.body || [], r),
      outcome: pick(tpl.outcome, r)
    }, r, { min: 200, max: 350 });
  }

  /* ---- 통합 진입점 ---- */
  function generate(o) {
    const seed = o.seed || 1;
    const variant = o.variant || 0;
    const kws = o.keywords || [];
    switch (o.category) {
      case 'club': return genClub(o.clubName, kws, seed, variant);
      case 'subject': return genSubject(o.subject, kws, seed, variant);
      case 'behavior': return genBehavior(kws, seed, variant);
      default: return genActivity(o.activity, kws, seed, variant); // autonomy/career/volunteer
    }
  }

  /* ---- 생기부 점검: 기재 유의 표현 경고 (가벼운 안내) ---- */
  const WARN_WORDS = ['토익', '토플', 'TOEIC', 'TOEFL', '모의고사', '아버지', '어머니', '부모님', '학원', '과외', '영재원', '경시대회', '올림피아드'];
  function review(text) {
    const warns = [];
    WARN_WORDS.forEach(function (w) {
      if (text.indexOf(w) >= 0) warns.push('‘' + w + '’ 표현이 포함되어 있습니다. 생기부 기재 유의 사항을 확인하세요.');
    });
    // 영어 점수/숫자 등급 의심
    if (/\b\d{2,4}\s*점\b/.test(text)) warns.push('점수(숫자) 표현이 포함되어 있을 수 있습니다.');
    return warns;
  }

  window.DHEngine = {
    generate: generate,
    charCount: charCount,
    lenAll: lenAll,
    review: review,
    expandKeyword: function (k) { return expandKeyword(k, rng(7)); }
  };
})();
