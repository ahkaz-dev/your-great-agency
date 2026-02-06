const logEl = document.getElementById('log')! as HTMLDivElement;
const form = document.getElementById('task-form')! as HTMLFormElement;
const goalEl = document.getElementById('goal')! as HTMLInputElement;

function format(obj: any) {
  try {
    if (typeof obj === 'string') return obj;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function append(type: string, message: any) {
  const div = document.createElement('div');
  div.className = 'entry';

  // Цвета для разных типов сообщений
  const typeColors = {
    error: '#ff4444',
    status: '#4444ff',
    milestone: '#00aa00',
    thought: '#aa00aa',
    plan: '#ff8c00',
    observation: '#0088cc',
    default: '#000000'
  };

  const color = typeColors[type as keyof typeof typeColors] || typeColors.default;
  div.style.color = color;

  // Форматирование сообщения
  let msg = typeof message === 'string' ? message : format(message);
  if (msg.length > 1000) {
    msg = msg.substring(0, 1000) + '...';
  }

  div.innerHTML = `<span class="type" style="color: ${color}; font-weight: bold;">[${type}]</span> ${msg}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}


let ws: WebSocket | null = null;
function connectWS() {
  try {
    ws = new WebSocket(`ws://localhost:8787/ws`);
    ws.onopen = () => append('status', 'WS connected');
    ws.onerror = (ev) => append('error', 'WS error');
    ws.onclose = () => append('status', 'WS closed');
    ws.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data);
      const msg = typeof e.message === 'string' ? e.message : JSON.stringify(e.message, null, 2);
        append(e.type || 'event', msg);
        if (e.data) append('data', JSON.stringify(e.data, null, 2));
      } catch (err) {
        append('error', `WS message parse failed: ${String(err)}`);
        append('raw', ev.data);
      }
    };
  } catch (e) {
    append('error', `WS init failed: ${String(e)}`);
  }
}

async function runTask(goal: string) {
  const collected = new Set<string>();
  append('status', 'Submitting task...');
  try {
    const res = await fetch('http://localhost:8787/api/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal })
    });

    let bodyText: string | null = null;
    if (!res.ok) {
      bodyText = await res.text().catch(() => null);
      append('error', `HTTP ${res.status} ${res.statusText}${bodyText ? `\n${bodyText}` : ''}`);
      return;
    }

    let json: any = null;
    try {
      json = await res.json();
    } catch (e) {
      bodyText = bodyText ?? (await res.text().catch(() => null));
      append('error', `Response JSON parse failed${bodyText ? `\n${bodyText}` : ''}`);
      return;
    }

    if (!json || typeof json !== 'object') {
      append('result', 'Unexpected response shape');
      append('data', json);
      return;
    }

    append('result', json.result ?? json);
  } catch (e) {
    append('error', `Fetch failed: ${String(e)}`);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const goal = goalEl.value.trim();
  if (!goal) {
    append('error', 'Please enter a goal.');
    return;
  }
  runTask(goal);
});

connectWS();
