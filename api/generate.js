/* =========================================================================
 *  Vercel 서버리스 함수 — 생활기록부 AI 생성 프록시
 *  API 키는 환경변수에서만 읽으며 브라우저에 노출되지 않음.
 *
 *  필요한 환경변수 (Vercel → Project → Settings → Environment Variables):
 *    ANTHROPIC_API_KEY   (필수)  예: sk-ant-...
 *    ANTHROPIC_MODEL     (선택)  기본값 claude-haiku-4-5
 * ========================================================================= */
'use strict';

const ALLOWED_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다.' });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'AI가 설정되지 않았습니다(ANTHROPIC_API_KEY 환경변수 없음).' });
    return;
  }

  // 본문 파싱 (Vercel은 보통 자동 파싱하지만 방어적으로 처리)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // 입력 정리(길이 제한 — 오남용 방지)
  const context = String(body.context || '').slice(0, 1500);
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.slice(0, 25).map(k => String(k).slice(0, 40)).filter(Boolean)
    : [];
  let model = body.model;
  if (ALLOWED_MODELS.indexOf(model) < 0) model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  // 프롬프트는 서버에서 고정(생기부 외 용도로 못 쓰게)
  const system =
    '너는 대한민국 중학교 생활기록부 작성을 돕는 보조교사다. 교사가 제공한 키워드와 활동 정보에만 근거해 ' +
    '사실적으로 작성하고, 지어내지 않는다. 문장은 명사형 종결어미(~함, ~임, ~보임, ~기름)로 끝나는 음슴체로 쓰고, ' +
    '공백 제외 200~300자 분량의 한 단락으로 작성한다. 학생 이름, 성적·점수·석차, 교외 수상, 부모 정보, ' +
    '특정 시험/자격증 점수는 절대 포함하지 않는다. 설명 없이 생활기록부 문구만 출력한다.';
  const userMsg =
    context +
    '\n키워드: ' + (keywords.length ? keywords.join(', ') : '(없음 — 활동 참여 모습 위주로)') +
    '\n위 내용을 반영해 200~300자 생활기록부 문구를 한 단락으로 작성해줘.';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 700,
        system: system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data && data.error && data.error.message) || ('API 오류 ' + r.status) });
      return;
    }
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    res.status(200).json({ text: text, model: model });
  } catch (e) {
    res.status(502).json({ error: '생성 요청 실패: ' + (e && e.message ? e.message : String(e)) });
  }
};
