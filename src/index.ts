import { createServer } from './server/server.ts';
import { createBrowserController } from './browser/controller.ts';
import { createAgent } from './agent/core.ts';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const runCli = args.includes('--cli');

dotenv.config();

async function main() {
  const browserCtrl = await createBrowserController();
  const agent = createAgent(browserCtrl);
  const server = await createServer(agent);

  if (runCli) {
    const task = args.filter(a => a !== '--cli').join(' ').trim();
    if (!task) {
      console.error('Provide a task: npm run agent "<task text>"');
      process.exit(1);
    }
    server.events.broadcast({ type: 'status', message: 'CLI task received' });
    const result = await agent.runTask({
      goal: task,
      onEvent: (e) => server.events.broadcast(e),
    });
    console.log('Result:', result.status, result.summary);
    await browserCtrl.dispose();
    process.exit(result.status === 'success' ? 0 : 2);
  } else {
    console.log('Server running. Open UI at http://localhost:5173');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
