# MediJp – Medical Chatbot (Japanese / Chinese / English)

A simple, safe medical information chatbot for normal users, backed by Baichuan’s Chat Completions API.

- Multilingual: auto-detects Japanese, Chinese, or English and replies accordingly.
- Safety-first: includes a system prompt that avoids diagnosis/prescription and recommends professional care.
- Minimal UI: local web app served by an Express backend proxy to keep the API key private.

## Prerequisites
- Node.js 18+ recommended (for built-in `fetch`).
- A valid Baichuan API Key.

## Setup
1. In the project root, set your API key in `.env`:
   ```
   BAICHUAN_API_KEY=YOUR_API_KEY_HERE
   PORT=3000
   ```
   The key you provided was placed in `.env` for local use. `.env` is ignored by git via `.gitignore`.

   Optional: Stripe keys for mobile checkout (mock fallback if absent)
   ```
   STRIPE_SECRET_KEY=sk_live_or_test_key
   STRIPE_PUBLISHABLE_KEY=pk_live_or_test_key
   CURRENCY=JPY
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run the server:
   ```
   npm start
   ```
   Open `http://localhost:3000/` and chat.

### Notes
- For production, prefer enabling HTTPS and rate limiting.
- If you want streaming responses, set `stream: true` in the payload and implement server-side streaming (SSE) and incremental UI updates.
- You can change models via `BAICHUAN_MODEL` env var (defaults to `Baichuan4-Turbo`).

## How it works
- Backend: `server.js` exposes `POST /api/chat`, forwards requests to Baichuan at `https://api.baichuan-ai.com/v1/chat/completions` with headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <BAICHUAN_API_KEY>`
- Payload example:
  ```json
  {
    "model": "Baichuan4-Turbo",
    "messages": [
      {"role": "system", "content": "(safety prompt…)"},
      {"role": "user", "content": "質問/问题/Question"}
    ],
    "temperature": 0.2,
    "max_tokens": 1024,
    "stream": false
  }
  ```
- Frontend: sends the full conversation to `/api/chat`, displays assistant responses, and shows language-specific disclaimers.

## Language handling
- Auto detection rules:
  - Japanese if Hiragana/Katakana are present.
  - Chinese if CJK characters without kana.
  - English otherwise.
- You can override via the Language selector.

## Safety prompt (summary)
- Provides general health information only.
- No diagnosis and no prescriptions.
- Encourages professional care for personalized advice.
- If urgent symptoms are present (chest pain, difficulty breathing, stroke signs, severe bleeding, suicidal ideation), instructs to contact emergency services immediately.

## Notes
- For production, prefer enabling HTTPS and rate limiting.
- If you want streaming responses, set `stream: true` in the payload and implement server-side streaming (SSE) and incremental UI updates.
- You can change models via `BAICHUAN_MODEL` env var (defaults to `Baichuan4-Turbo`).

## Reference
- Baichuan API Docs: https://platform.baichuan-ai.com/docs/api