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

  return `You are a physician-style health educator speaking to a layperson patient.
Rules:
- Provide reliable, general health information. Do not diagnose or prescribe.
- Use a calm, empathetic tone and explain in plain language.
- Structure your answer as:
  1) Summary
  2) Possible causes (most common first) and simple reasoning
  3) What you can do now (self-care, monitoring, lifestyle)
  4) When to seek urgent care (red flags)
  5) Next steps / what to discuss with a clinician
  6) Sources
- Evidence: ${localPref} Cite 3–5 high-quality sources with organization + year and an accessible URL. Do NOT invent citations; only include sources you are confident exist. If uncertain, say you cannot confidently cite and provide general organizations to consult.
- IMPORTANT: Reply strictly in the user's language as detected: ${userLang}. Do not switch languages. Do not translate the user's question. If uncertain, ask the user to confirm their preferred language.
 - Keep the output concise but complete; avoid jargon; include brief pathophysiology only when helpful for understanding.\n - Formatting: DO NOT use Markdown or HTML. Output plain text only (no headings, lists with asterisks, code fences, or inline markup).`;
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