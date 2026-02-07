import { createInterface } from 'readline';
import { createBrowserController } from './browser/controller.js';
import { createAgent } from './agent/core.js';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';

dotenv.config();

function log(message: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '[ERROR]' : type === 'success' ? '[SUCCESS]' : type === 'warn' ? '[INPUT]' : '[INFO]';
  console.log(`${timestamp} ${prefix}: ${message}`);
}

function askUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    log('Usage: npm run agent "<task description>"', 'error');
    log('Example: npm run agent "Delete the last email in Gmail"', 'info');
    process.exit(1);
  }

  const task = args.join(' ').trim();
  if (!task) {
    log('Task description cannot be empty', 'error');
    process.exit(1);
  }

  log(`Starting browser automation task: "${task}"`, 'info');

  const startTime = performance.now();

  try {
    log('Initializing browser...', 'info');
    const browserCtrl = await createBrowserController();

    log('Initializing agent...', 'info');
    const agent = createAgent(browserCtrl);

    const result = await agent.runTask({
      goal: task,
      onEvent: (event) => {
        const message = event.message || JSON.stringify(event);
        if (event.type === 'need_user_input') log(message, 'warn');
        else if (event.type === 'request_confirmation') log(message, 'warn');
        else log(message, event.type === 'error' ? 'error' : 'info');
      },
      waitForUserInput: async (message: string) => {
        log(message, 'warn');
        await askUser('\n→ Сделайте нужное действие в браузере, затем нажмите Enter для продолжения... ');
      },
      waitForConfirmation: async (message: string, pendingAction) => {
        log(message, 'warn');
        const answer = await askUser(`Выполнить действие "${pendingAction.action}"? (y/n): `);
        return /^y|да|yes$/i.test(answer);
      },
    });

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    if (result.status === 'need_user_input') {
      log('Agent is waiting for user input. Run the same command again after you have completed the action, or the session was closed.', 'warn');
    } else {
      log(`Task completed in ${duration} seconds`, result.status === 'success' ? 'success' : 'error');
      log(`Status: ${result.status}`, 'info');
      log(`Summary: ${result.summary}`, 'info');
    }

    await browserCtrl.dispose();

    process.exit(result.status === 'success' ? 0 : 1);
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    process.exit(1);
  }
}

main().catch(err => {
  log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`, 'error');
  process.exit(1);
});
