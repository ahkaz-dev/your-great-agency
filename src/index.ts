import { createBrowserController } from './browser/controller.ts';
import { createAgent } from './agent/core.ts';
import dotenv from 'dotenv';
import { performance } from 'perf_hooks';

dotenv.config();

// Simple console logging helper
function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = type === 'error' ? '[ERROR]' : type === 'success' ? '[SUCCESS]' : '[INFO]';
  console.log(`${timestamp} ${prefix}: ${message}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log('Usage: npm run agent "<task description>"', 'error');
    log('Example: npm run agent "Find the latest news about AI"', 'info');
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
    // Initialize browser and agent
    log('Initializing browser...', 'info');
    const browserCtrl = await createBrowserController();
    
    log('Initializing agent...', 'info');
    const agent = createAgent(browserCtrl);
    
    // Execute task
    log('Executing task...', 'info');
    const result = await agent.runTask({
      goal: task,
      onEvent: (event) => {
        const message = event.message || JSON.stringify(event);
        log(message, event.type === 'error' ? 'error' : 'info');
      }
    });
    
    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    log(`Task completed in ${duration} seconds`, result.status === 'success' ? 'success' : 'error');
    log(`Status: ${result.status}`, 'info');
    log(`Summary: ${result.summary}`, 'info');
    
    // Cleanup
    await browserCtrl.dispose();
    
    // Exit with appropriate code
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
