require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Sanitize key to avoid common copy/paste issues (e.g., including "api=" or "Bearer ")
const BAICHUAN_API_KEY_RAW = process.env.BAICHUAN_API_KEY || '';
const BAICHUAN_API_KEY = BAICHUAN_API_KEY_RAW
  .replace(/^api=/i, '')
  .replace(/^Bearer\s+/i, '')
  .trim();
const BAICHUAN_MODEL = process.env.BAICHUAN_MODEL || 'Baichuan4-Turbo';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function detectLanguage(text) {
  if (!text) return 'en';
  const hasHiragana = /[\u3040-\u309F]/.test(text);
  const hasKatakana = /[\u30A0-\u30FF]/.test(text);
  const hasCJK = /[\u4E00-\u9FFF]/.test(text);
  const hasJaMarks = /[ー・〜「」『』々]/.test(text); // common JP-only marks
  if (hasHiragana || hasKatakana || hasJaMarks) return 'ja';
  if (hasCJK) return 'zh';
  return 'en';
}

function safetySystemPrompt(userLang) {
  const localPref = userLang === 'ja'
    ? 'Prefer Japanese sources (厚生労働省 MHLW, 日本医師会 JMA, PMDA, relevant Japanese society guidelines).'
    : userLang === 'zh'
      ? 'Prefer Chinese or international sources (WHO, 中国疾控中心 China CDC, CMA), plus global guidelines.'
      : 'Prefer international sources (WHO, CDC, NICE, BMJ Best Practice, Cochrane, UpToDate).';

  const labels = userLang === 'ja'
    ? { summary: '要約', causes: '考えられる原因', now: '今できること', redflags: '緊急受診の目安', next: '次のステップ／医師と話す内容', sources: '参考資料' }
    : userLang === 'zh'
      ? { summary: '概述', causes: '可能原因与理由', now: '现在可以做的事', redflags: '何时需要紧急就医', next: '下一步与医生讨论', sources: '参考资料' }
      : { summary: 'Summary', causes: 'Possible causes', now: 'What you can do now', redflags: 'Urgent care (red flags)', next: 'Next steps with a clinician', sources: 'Sources' };

  return `You are a physician‑style health educator for a layperson.

Goal: produce a crisp, scannable handout. Output PLAIN TEXT only.

Style rules:
- Short sentences, everyday words, calm and empathetic tone.
- Use numbered points like 1), 2), 3). No paragraphs.
- Keep each point to one line (≈18 words max).
- Put exactly one blank line between sections.
- Reply strictly in the user's language: ${userLang}. Do not switch languages.
- Provide general health information only; do not diagnose or prescribe.

Evidence:
- ${localPref}
- Cite 3–5 trustworthy sources. Each on a separate line as "Organization (Year): URL". Do not invent citations.

Layout (use these labels exactly and in this order):
${labels.summary}:
${labels.causes}:
${labels.now}:
${labels.redflags}:
${labels.next}:
${labels.sources}:

Content expectations:
- ${labels.summary}: One sentence that orients the user.
- ${labels.causes}: 3–5 numbered points.
- ${labels.now}: 4–6 numbered points with practical actions users can take now.
- ${labels.redflags}: 4–6 numbered points starting with "If" or "Sudden" to signal urgency.
- ${labels.next}: 3–5 numbered points on what to discuss or prepare for a clinician.
- ${labels.sources}: 3–5 lines, real public‑facing URLs.

Formatting constraints:
- No Markdown or HTML, no symbols like #, *, _, or code fences.
- Only the six sections above. No extra preface or closing.`;
}

app.post('/api/chat', async (req, res) => {
  try {
    if (!BAICHUAN_API_KEY) {
      return res.status(500).json({ error: 'Missing Baichuan API key. Set BAICHUAN_API_KEY in .env.' });
    }

    const { messages = [], language = 'auto', stream = false, temperature = 0.2, max_tokens = 1024 } = req.body || {};
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lang = language === 'auto' ? detectLanguage(lastUser?.content || '') : language;
    const system = safetySystemPrompt(lang);

    const payload = {
      model: BAICHUAN_MODEL,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ],
      temperature,
      max_tokens,
      stream: Boolean(stream)
    };

    const response = await fetch('https://api.baichuan-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BAICHUAN_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({ error: data || { message: 'Baichuan API error' } });
    }

    // Try common fields for chat completion responses
    let content = null;
    if (data && Array.isArray(data.choices) && data.choices.length) {
      const choice = data.choices[0];
      content = choice?.message?.content || choice?.delta?.content || choice?.text || null;
    }
    // Fallback if API uses a different field
    content = content || data?.output_text || data?.result || null;

    if (!content) {
      return res.status(500).json({ error: 'No content in Baichuan response', raw: data });
    }

    // Sanitize: strip simple Markdown/HTML and normalize URLs
    const stripMd = (t) => {
      if (!t) return '';
      return String(t)
        .replace(/```[\s\S]*?```/g, ' ') // remove code blocks
        .replace(/`+/g, '') // remove backticks
        .replace(/^\s*#{1,6}\s*/gm, '') // remove headings
        .replace(/\*\*(.*?)\*\*/g, '$1') // bold
        .replace(/\*(.*?)\*/g, '$1') // italics/bullets asterisks
        .replace(/_(.*?)_/g, '$1') // underscores
        .replace(/<[^>]+>/g, '') // any HTML tags
        .replace(/[\t\r]+/g, ' ') // tabs/CR
        .replace(/\n{3,}/g, '\n\n') // collapse newlines
        .trim();
    };

    const normalizeUrls = (t) => {
      if (!t) return '';
      let out = t.replace(/\[URL\]/gi, ''); // remove placeholders
      out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2'); // unwrap markdown links
      out = out.replace(/\s{2,}/g, ' '); // dedupe spaces
      return out.trim();
    };

    const cleaned = normalizeUrls(stripMd(content));
    return res.json({ content: cleaned });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err) });
  }
});

app.listen(PORT, () => {
  const masked = BAICHUAN_API_KEY ? `${BAICHUAN_API_KEY.slice(0,3)}…${BAICHUAN_API_KEY.slice(-4)} (len=${BAICHUAN_API_KEY.length})` : 'missing';
  console.log(`MediJp server running at http://localhost:${PORT}`);
  console.log(`Baichuan API key: ${masked}`);
});