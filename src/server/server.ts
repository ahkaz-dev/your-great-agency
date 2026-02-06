import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

export async function createServer(agent: { runTask: (p: { goal: string; onEvent?: (e: any) => void }) => Promise<any> }) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const sockets = new Set<any>();
  const events = {
    broadcast: (e: any) => {
      for (const ws of Array.from(sockets)) {
        try {
          if (!ws || typeof ws.send !== 'function' || ws.readyState !== 1) {
            sockets.delete(ws);
            continue;
          }
          ws.send(JSON.stringify(e));
        } catch (err) {
          console.error('WS send failed', err);
          try { sockets.delete(ws); } catch {}
        }
      }
    },
  };

  app.get('/ws', { websocket: true }, (conn) => {
    console.log('WS client connected');
    sockets.add(conn.socket);
    conn.socket.on('close', () => { sockets.delete(conn.socket); console.log('WS client disconnected'); });
  });

  app.post('/api/task', async (req: any, res: any) => {
    const body = req.body || {};
    const goal = String(body.goal || '');
    console.log('POST /api/task', { goal });
    if (!goal) return res.status(400).send({ error: 'goal required' });
    try {
      const result = await agent.runTask({ goal, onEvent: (e) => { console.log('[agent]', e); events.broadcast({...e, ts: Date.now()}); } });
      console.log('Task result', result);
      return { result };
    } catch (err: any) {
      console.error('Task failed', err);
      const message = String(err?.message || err);
      const stack = String(err?.stack || '');
      events.broadcast({ type: 'error', message });
      return res.status(500).send({ error: message, stack });
    }
  });

  const port = 8787;
  await app.listen({ port });
  console.log(`API listening on http://localhost:${port}`);

  return { app, events };
}
