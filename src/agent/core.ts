import { chat } from './llm.ts';
import { Memory } from './memory.ts';
import { createTools } from './tools.ts';
import type { PageSnapshot } from '../browser/controller.ts';
import type { ToolEvent } from './tools.ts';

export type AgentEvent = ToolEvent | { type: 'thought'|'plan'|'observation'|'milestone'|'status'|'error'; message: string; data?: any };
export type AgentResult = { status: 'success'|'need_user_input'|'failed'; summary: string };
type TaskPlan = {
  steps: string[];
};



export function createAgent(browser: any) {
  const memory = new Memory();
  const tools = createTools(browser);

  const system = `You are an autonomous web agent. Goals: plan, act in a browser, observe, and iterate until the user's goal is achieved.\nRules:\n- Never rely on hardcoded selectors or page-specific URLs.\n- Choose actions using semantic cues (text, aria, role) and heuristics.\n- Keep steps safe and incremental.\n- Ask for missing information only when strictly necessary.\n- Provide concise thoughts and a clear next action.\nAvailable tools: navigate(url), observe(), click_by_intent(intent), type_by_intent(intent, text, pressEnter). Return JSON for tool calls as: {tool:"name", args:{...}}.`;

  async function plan(goal: string, history: string, snap?: PageSnapshot) {
    const context = `Goal: ${goal}\nRecent:\n${history}\nCurrent: ${snap ? `${snap.title} @ ${snap.url}` : 'No page yet'}\n`;
    const prompt = `${context}\nDevise next high-level plan milestone and immediate next step.\nReturn JSON with fields: milestone, next_action (one of: navigate, click, type, observe, finish),\nargs (object), and rationale (short).\nIf finish, include summary. Avoid page-specific assumptions.`;
    const res = await chat([
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ], { temperature: 0.2, max_tokens: 500 });
    try {
      const json = safeParseJSON(res) || { next_action: 'observe', args: {}, rationale: 'Parsing failed, observe' };
      return json as { milestone?: string; next_action: string; args?: any; rationale?: string; summary?: string };
    } catch {
      return { next_action: 'observe', args: {}, rationale: 'Parsing failed, observe' };
    }
  }

  function safeParseJSON(str: string) {
    const start = str.indexOf('{');
    const end = str.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(str.slice(start, end + 1));
    } catch {
      return null;
    }
  }
      
  async function decomposeGoal(goal: string): Promise<TaskPlan> {
      const prompt = `
    User goal: "${goal}"

    Break this goal into a clear, ordered list of concrete browser actions.
    Rules:
    - Each step must be atomic and executable in a browser
    - Use natural language
    - If the goal requires multiple items, repeat actions until the count is satisfied.
    - Never stop after a single successful item if more are required.
    - Use scroll when content may be below the fold.

    Return JSON:
    { "steps": [ "...", "..." ] }
    `;

      const res = await chat([
        { role: 'system', content: 'You are a task planner for a web automation agent.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, max_tokens: 300 });

      const parsed = safeParseJSON(res);
      if (!parsed?.steps?.length) {
        throw new Error('Failed to decompose goal');
      }
      return parsed as TaskPlan;
    }

  async function reflect(goal: string, recent: string) {
    const prompt = `Goal: ${goal}\nRecent: ${recent}\nAssess for loops or wrong direction. If adjustment needed, propose a brief correction. Return JSON {adjustment?: string}.`;
    const res = await chat([
      { role: 'system', content: 'You are a critical reviewer detecting loops, proposing minor adjustments.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.1, max_tokens: 400 });
    try { return JSON.parse(res.match(/\{[\s\S]*\}$/)?.[0] || '{}'); } catch { return {}; }
  }

  async function execute(action: string, args: any, emit: (e: AgentEvent) => void) {
    try {
      switch (action) {
        case 'navigate': {
          emit({ type: 'status', message: `Navigate -> ${args.url}` });
          await tools.navigate(args.url);
          const snap = await tools.observe();
          emit({ type: 'observation', message: `${snap.title} @ ${snap.url}` });
          return { ok: true };
        }
        case 'click': {
          const intent = String(args.intent || args.target || 'primary action');
          emit({ type: 'status', message: `Click by intent -> ${intent}` });
          const r = await tools.click_by_intent(intent);
          emit({ type: 'observation', message: `Clicked. New title?` , data: r});
          return { ok: true };
        }
        case 'type': {
          const intent = String(args.intent || 'search');
          const text = String(args.text || '');
          const pressEnter = !!args.pressEnter;
          emit({ type: 'status', message: `Type by intent -> ${intent}: ${text}` });
          const r = await tools.type_by_intent(intent, text, pressEnter);
          emit({ type: 'observation', message: `Typed`, data: r });
          return { ok: true };
        }
        case 'observe': {
          const snap = await tools.observe();
          emit({ type: 'observation', message: `${snap.title} @ ${snap.url}` });
          return { ok: true };
        }
        case 'bookmark_current_page': {
            const snap = await tools.observe();
            collected.add(snap.url);
            emit({ type: 'milestone', message: `Bookmarked: ${snap.title}`, data: snap.url });
            return { ok: true };
        }
        case 'finish': {
          emit({ type: 'status', message: 'Finish requested by planner' });
          return { ok: true, done: false };
        }
        default:
          emit({ type: 'error', message: `Unknown action ${action}` });
          return { ok: false };
      }
    } catch (e: any) {
      emit({ type: 'error', message: String(e?.message || e) });
      return { ok: false };
    }
  }

  async function runTask(params: { goal: string; onEvent?: (e: AgentEvent) => void }): Promise<AgentResult> {
    
    
    const { goal, onEvent } = params;
    const collected = new Set<string>();
    const emit = (e: AgentEvent) => {
      onEvent?.(e);
      memory.add({
        ts: Date.now(),
        type: (e.type as any) || 'thought',
        content: e.message || JSON.stringify(e)
      });
    };    
    emit({ type: 'status', message: 'Decomposing task...' });

    const taskPlan = await decomposeGoal(goal);

    emit({
      type: 'plan',
      message: 'Task plan created',
      data: taskPlan.steps
    });

    emit({ type: 'status', message: `Task started: ${goal}` });

    let steps = 0;
    let lastSnap: PageSnapshot | undefined;

    while (steps < 100) {
      let currentStepIndex = 0;
      steps++;
      const history = memory.summarize();
      const planOut = await plan(goal, history, lastSnap);
      if (planOut.milestone) emit({ type: 'milestone', message: planOut.milestone });
      emit({ type: 'thought', message: planOut.rationale || '...' });

      // ReAct: select tool
      let action = planOut.next_action;
      let args = planOut.args || {};

      // Optional critic every few steps
      if (steps % 5 === 0) {
        const critique = await reflect(goal, memory.summarize());
        if (critique.adjustment) emit({ type: 'thought', message: `Adjustment: ${critique.adjustment}` });
      }

      const result = await execute(action, args, emit);
      if (!result.ok) {
        // fallback observe then continue
        await execute('observe', {}, emit);
      }
      if ((result as any).done) {
        const sum = memory.summarize();
        return { status: 'success', summary: sum.slice(-800) };
      }

      // Check if missing info is needed
      const needInfo = false; // Could be inferred from planOut in future
      if (needInfo) {
        return { status: 'need_user_input', summary: 'Agent requires additional input.' };
      }

      // refresh snapshot
      lastSnap = await tools.observe();

      // budget checks
      if (steps >= 30) break;
    }

    emit({
      type: 'error',
      message: 'Step budget exhausted, attempting graceful stop'
    });

    return {
      status: collected.size > 0 ? 'success' : 'failed',
      summary: `Collected ${collected.size} items before stopping`
    };
  }

  return { runTask };
}
