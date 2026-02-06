import fetch from 'node-fetch';

export type ChatMessage = { role: 'system'|'user'|'assistant'|'tool'; content: string; name?: string };

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function normalizeBaseUrl(input: string) {
  let base = input.replace(/\/$/, '');

  // ✅ Ollama (local or cloud)
  if (/ollama\.com/.test(base) || /localhost:11434/.test(base)) {
    return `${base}/chat`;
  }

  // ✅ If full OpenAI-compatible endpoint already provided
  if (/\/chat\/completions$/.test(base)) return base;

  // ✅ OpenAI official
  if (/api\.openai\.com/.test(base)) {
    if (!/\/v1$/.test(base)) base += '/v1';
    return `${base}/chat/completions`;
  }

  // ✅ Default: assume OpenAI-compatible
  return `${base}/chat/completions`;
}

export async function chat(messages: ChatMessage[], opts?: { temperature?: number; max_tokens?: number }) {
  const rawBase = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const url = normalizeBaseUrl(rawBase);
  const key = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';

  // Require key for OpenAI cloud; allow missing key for local servers (localhost)
  if (!key && /api\.openai\.com/.test(url)) {
    throw new Error('LLM API key is missing. Set LLM_API_KEY for OpenAI.');
  }

  const payload = {
    model,
    messages,
    temperature: opts?.temperature ?? 0.2,
    max_tokens: opts?.max_tokens ?? 600,
  } as any;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const maxRetries = 5;
  let attempt = 0;
  let lastErr: any = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const retryAfter = Number(res.headers.get('retry-after') || '0');
        const errMsg = `LLM error ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`;
        if (res.status === 429 || res.status === 503) {
          const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * attempt, 8000);
          lastErr = new Error(errMsg);
          await sleep(backoff);
          continue;
        }
        throw new Error(errMsg);
      }
      const text = await res.text();
      let content = '';

      try {
        // Ollama often returns NDJSON (one JSON per line)
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);

            // Ollama chat format
            if (obj?.message?.content) {
              content += obj.message.content;
            }

            // Ollama generate format
            if (typeof obj?.response === 'string') {
              content += obj.response;
            }

            // OpenAI-compatible fallback
            if (obj?.choices?.[0]?.message?.content) {
              content += obj.choices[0].message.content;
            }
          } catch {
            // ignore broken chunks
          }
        }
      } catch {
        content = '';
      }
      return content;
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(2000 * attempt, 8000));
    }
  }
  throw lastErr || new Error('LLM request failed');
}
