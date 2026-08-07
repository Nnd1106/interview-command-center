/* ---------------------------------------------------------------------
 * aiClient.js — wrapper around Google's Gemini API (Google AI Studio
 * free tier: aistudio.google.com/apikey — free signup, no card, and
 * AI-Studio-issued keys cannot incur charges since no billing account
 * is attached; that's a separate, deliberate opt-in Google gates behind
 * its own upgrade flow, never touched by this app). Confirmed
 * CORS-enabled for direct browser calls (Access-Control-Allow-Origin
 * reflects the calling origin) — no proxy needed.
 *
 * PRIVACY CONTRACT (non-negotiable, enforced by construction): every
 * caller in interview.js passes only { role, roundLabel, question,
 * answer } (or short derivatives of those) into the prompt builders
 * below — never a resume, never a name/email, never anything else.
 * This module sends exactly the prompt string it's given and nothing
 * more: no cookies, no browser fingerprint, no analytics payload. The
 * API key lives only in this browser's localStorage and is sent only
 * to generativelanguage.googleapis.com, as a URL parameter Google's own
 * API requires — never anywhere else, never alongside interview
 * content in any log this app writes (this app writes no logs).
 * ------------------------------------------------------------------- */

const AiClientModule = (() => {
  const MODEL = 'gemini-2.0-flash';
  const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const LS_KEY_API = 'icc_gemini_api_key';

  function getApiKey() {
    try { return localStorage.getItem(LS_KEY_API) || ''; } catch { return ''; }
  }
  function setApiKey(key) {
    try {
      if (key) localStorage.setItem(LS_KEY_API, key.trim());
      else localStorage.removeItem(LS_KEY_API);
    } catch { /* localStorage unavailable — key just won't persist */ }
  }
  function hasApiKey() { return !!getApiKey(); }

  class AiError extends Error {
    constructor(message, kind) { super(message); this.kind = kind; }
  }

  /**
   * `systemInstruction`: string, the interviewer persona + ground rules.
   * `prompt`: string, the specific task for this call.
   * `schema`: Gemini responseSchema object (OpenAPI-subset) the JSON
   *   reply must match.
   * Returns the parsed JSON object. Throws AiError with a `.kind` of
   * 'no-key' | 'auth' | 'rate-limit' | 'blocked' | 'network' | 'parse'
   * so the UI can show a precise, honest message.
   */
  async function generate({ systemInstruction, prompt, schema }) {
    const apiKey = getApiKey();
    if (!apiKey) throw new AiError('No API key set.', 'no-key');

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.9,
      },
    };

    let res;
    try {
      res = await fetch(`${API_BASE}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AiError('Network error reaching Gemini — check your connection and try again.', 'network');
    }

    let json;
    try { json = await res.json(); } catch { throw new AiError('Gemini returned an unreadable response.', 'parse'); }

    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      if (res.status === 400 || res.status === 403) throw new AiError(`Invalid API key (${msg}). Double-check the key you pasted.`, 'auth');
      if (res.status === 429) throw new AiError('Gemini free-tier rate limit hit — wait a few seconds and try again.', 'rate-limit');
      throw new AiError(`Gemini error: ${msg}`, 'network');
    }

    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) throw new AiError(`Gemini declined to respond (${blockReason}) — try rephrasing your answer.`, 'blocked');

    const candidate = json?.candidates?.[0];
    if (!candidate) throw new AiError('Gemini returned no response — try again.', 'blocked');
    if (candidate.finishReason === 'SAFETY') throw new AiError('Gemini flagged this content — try rephrasing your answer.', 'blocked');

    const text = candidate.content?.parts?.map((p) => p.text || '').join('') || '';
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError('Gemini returned malformed JSON — try again.', 'parse');
    }
  }

  return { getApiKey, setApiKey, hasApiKey, generate, AiError, MODEL };
})();
