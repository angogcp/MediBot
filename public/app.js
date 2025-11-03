const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('chatForm');
const languageSelect = document.getElementById('languageSelect');
const resetBtn = document.getElementById('resetBtn');
const disclaimerEl = document.getElementById('disclaimer');
const sendBtn = document.getElementById('sendBtn');

let conversation = [];

function detectLanguage(text) {
  if (!text) return 'en';
  const hasHiragana = /[\u3040-\u309F]/.test(text);
  const hasKatakana = /[\u30A0-\u30FF]/.test(text);
  const hasCJK = /[\u4E00-\u9FFF]/.test(text);
  if (hasHiragana || hasKatakana) return 'ja';
  if (hasCJK) return 'zh';
  return 'en';
}

function disclaimerFor(lang) {
  switch (lang) {
    case 'ja':
      return '免責事項: このチャットは一般的な健康情報のみを提供します。診断や処方には該当せず、個別の医療相談は医療機関の受診を推奨します。緊急の症状がある場合は、直ちに救急へ連絡してください。';
    case 'zh':
      return '免责声明：本聊天仅提供一般健康信息，不构成诊断或处方。个性化医疗建议请就诊专业医生。如有紧急或危及生命的症状，请立即联系当地急救服务。';
    default:
      return 'Disclaimer: This chat provides general health information only. It does not provide diagnosis or prescriptions. For personal medical advice, please see a qualified clinician. If urgent symptoms occur, call local emergency services immediately.';
  }
}

function renderDisclaimer() {
  const selected = languageSelect.value;
  const lang = selected === 'auto' ? detectLanguage(lastUserContent() || '') : selected;
  disclaimerEl.textContent = disclaimerFor(lang);
}

function lastUserContent() {
  const last = [...conversation].reverse().find(m => m.role === 'user');
  return last?.content || '';
}

function addMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'user' ? 'U' : 'M';

  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;

  if (role === 'user') {
    // user: bubble before avatar (align right)
    wrap.appendChild(bubble);
    wrap.appendChild(avatar);
  } else {
    // assistant: avatar before bubble (align left)
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setThinking(on) {
  let el = document.getElementById('thinking');
  if (on) {
    sendBtn.disabled = true;
    if (!el) {
      el = document.createElement('div');
      el.id = 'thinking';
      el.className = 'message assistant';
      const avatar = document.createElement('div');
      avatar.className = 'avatar assistant';
      avatar.textContent = 'M';
      const loader = document.createElement('div');
      loader.className = 'loader';
      el.appendChild(avatar);
      el.appendChild(loader);
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } else if (el) {
    sendBtn.disabled = false;
    el.remove();
  }
}

async function sendMessage(text) {
  const selectedLang = languageSelect.value;
  const body = {
    messages: conversation,
    language: selectedLang,
    stream: false
  };

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    const errorText = typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error || data);
    throw new Error(errorText);
  }
  return data.content;
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  const role = 'user';
  conversation.push({ role, content: text });
  addMessage(role, text);
  inputEl.value = '';
  renderDisclaimer();

  setThinking(true);
  try {
    const reply = await sendMessage(text);
    conversation.push({ role: 'assistant', content: reply });
    addMessage('assistant', reply);
  } catch (err) {
    addMessage('assistant', `Error: ${String(err.message || err)}`);
  } finally {
    setThinking(false);
    inputEl.focus();
  }
});

resetBtn.addEventListener('click', () => {
  conversation = [];
  messagesEl.innerHTML = '';
  renderDisclaimer();
});

languageSelect.addEventListener('change', renderDisclaimer);

// Initial disclaimer
renderDisclaimer();
// Enter submits, Shift+Enter newline
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});