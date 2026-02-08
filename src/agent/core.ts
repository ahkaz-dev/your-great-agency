import { chat } from './llm.js';
import { Memory } from './memory.js';
import { createTools } from './tools.js';
import { pageSnapshotToSummary } from './context.js';
import type { PageSnapshot } from '../browser/controller.js';
import type { ToolEvent } from './tools.js';
import type { MemoryItem } from './memory.js';

export type AgentEvent = ToolEvent | { type: 'thought'|'plan'|'observation'|'milestone'|'status'|'error'|'need_user_input'|'request_confirmation'; message: string; data?: any };
export type AgentResult = { status: 'success'|'need_user_input'|'failed'; summary: string };

/** Вызывается, когда агент просит пользователя что-то сделать в браузере (логин, капча и т.д.). После возврата из Promise агент продолжит с текущей страницы. */
export type WaitForUserInputFn = (message: string) => Promise<void>;
/** Вызывается перед деструктивным действием. true = выполнить действие, false = отменить. */
export type WaitForConfirmationFn = (message: string, pendingAction: { action: string; args: any }) => Promise<boolean>;

type TaskPlan = { steps: string[] };



export function createAgent(browser: any) {
  const memory = new Memory();
  const tools = createTools(browser);
  const collected = new Set<string>();

  const system = `You are an autonomous web agent. Your behavior is driven only by the user's goal and the current page content — no fixed scripts. You infer from the page what to do and find ways to solve the request.

When the goal requires finding information, options, or choices (recipes, links, articles, products, etc.), first search: navigate to a search engine, type a clear query, get results, then choose from the results by clicking. Do not guess or ask the user to choose — search, then act on what you see.

When the page is a login/sign-in page (URL or content shows sign-in, email field, password field, "Далее", "Next", "Sign in"): you MUST use request_user_input. Do NOT type email, password, or any placeholder (e.g. your_email@example.com) into login fields. The user must enter their own credentials in the browser. Your message must ask them to do that, e.g. "Please enter your email and password in the browser to sign in."

From the goal and the page you infer: what to do next, whether the last action worked, whether something is blocking (overlay/modal), whether to close a popup or try another element. Use observations to adapt. If Hints say "LOGIN/SIGN-IN PAGE" — use request_user_input immediately. request_confirmation only before irreversible actions (delete, pay, order). When the goal is done, return finish with summary.

For click and type: args.intent must be 1-3 semantic words only (e.g. "Sign in", "Next", "email", "search", "first link"). Never use selector syntax or example values in intent or args.text. Pick intent from the element text/role/placeholder listed in the page summary.

Actions: navigate (args.url), click (args.intent), type (args.intent, args.text, args.pressEnter), scroll (args.pixels), observe, bookmark_current_page, request_user_input (message: string), request_confirmation, finish. Return JSON: milestone?, next_action, args?, rationale, summary? (if finish), message? (required for request_user_input), pending_action?.`


  type PlanOutput = {
    milestone?: string;
    next_action: string;
    args?: any;
    rationale?: string;
    summary?: string;
    message?: string;
    pending_action?: { action: string; args: any };
  };

  async function plan(goal: string, history: string, snap?: PageSnapshot): Promise<PlanOutput> {
    const pageContext = snap
      ? `Current page (after your last action):\n${pageSnapshotToSummary(snap)}\n`
      : 'No page loaded yet. Suggest next step from the goal (e.g. if goal needs info or options: navigate to a search engine, then type query).\n';
    const lastStepSummary = snap
      ? `\nYou are now on: "${snap.title}" @ ${snap.url}. Use the elements listed below to choose intent.\n`
      : '';
    const reflectionHint = /reflection:|after failure:/i.test(history)
      ? '\nThe history above may suggest an adjustment (e.g. close popup, scroll, different click). Consider it for the next step.\n'
      : '';
    const context = `Goal: ${goal}\n${lastStepSummary}\nHistory:\n${history}\n\n${pageContext}${reflectionHint}`;
    const prompt = `Decide the single next step. Intent: use only short semantic words from the page (e.g. "Next", "Sign in", "search"). If Hints say "LOGIN/SIGN-IN PAGE" → request_user_input (do not type email/password). Overlay/modal in Hints → close or accept first. Return JSON only.`;
    const res = await chat([
      { role: 'system', content: system },
      { role: 'user', content: context + '\n' + prompt }
    ], { temperature: 0.2, max_tokens: 620 });
    try {
      const json = safeParseJSON(res) as PlanOutput | null;
      if (!json?.next_action) return { next_action: 'observe', args: {}, rationale: 'Parsing failed, observe' };
      return json;
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
    - Ask the user for input if it is required.
    
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
    const prompt = `Goal: ${goal}\nRecent:\n${recent}\n\nFrom this, are we stuck or blocked? If yes, suggest one concrete next step (e.g. close popup, scroll, different click, or search first). If we are making progress, return {}. Return JSON {adjustment?: string}.`;
    const res = await chat([
      { role: 'system', content: 'From the goal and history you infer whether we are stuck or blocked; if so, suggest one next step. No fixed rules.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.15, max_tokens: 280 });
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
          try {
            const snap = await tools.observe();
            emit({ type: 'observation', message: `After click: page is now "${snap.title}" @ ${snap.url}`, data: r });
          } catch {
            emit({ type: 'observation', message: `Clicked.`, data: r });
          }
          return { ok: true };
        }
        case 'type': {
          const intent = String(args.intent || 'search');
          const text = String(args.text || '');
          const pressEnter = !!args.pressEnter;
          emit({ type: 'status', message: `Type by intent -> ${intent}: ${text}` });
          const r = await tools.type_by_intent(intent, text, pressEnter);
          try {
            const snap = await tools.observe();
            emit({ type: 'observation', message: `After type: page is now "${snap.title}" @ ${snap.url}`, data: r });
          } catch {
            emit({ type: 'observation', message: `Typed.`, data: r });
          }
          return { ok: true };
        }
        case 'observe': {
          const snap = await tools.observe();
          emit({ type: 'observation', message: `${snap.title} @ ${snap.url}` });
          return { ok: true };
        }
        case 'scroll': {
          const pixels = args.pixels ?? 800;
          emit({ type: 'status', message: `Scroll -> ${pixels}px` });
          await tools.scroll(pixels);
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

  async function runTask(params: {
    goal: string;
    onEvent?: (e: AgentEvent) => void;
    waitForUserInput?: WaitForUserInputFn;
    waitForConfirmation?: WaitForConfirmationFn;
  }): Promise<AgentResult> {
    const { goal, onEvent, waitForUserInput, waitForConfirmation } = params;
    const emit = (e: AgentEvent) => {
      onEvent?.(e);
      memory.add({
        ts: Date.now(),
        type: (e.type || 'thought') as MemoryItem['type'],
        content: e.message || JSON.stringify(e)
      });
    };

    emit({ type: 'status', message: 'Starting task execution...' });

    let steps = 0;
    let lastSnap: PageSnapshot | undefined;
    const maxSteps = 80;
    const startTime = Date.now();

    while (steps < maxSteps) {
      steps++;
      const history = memory.summarize();

      const planOut = await plan(goal, history, lastSnap);
      if (planOut.milestone) emit({ type: 'milestone', message: planOut.milestone });
      emit({ type: 'thought', message: planOut.rationale || 'Processing...' });

      const action = planOut.next_action;
      const args = planOut.args || {};

      // Агент просит пользователя что-то сделать в браузере (логин, пароль, капча)
      if (action === 'request_user_input') {
        const message = planOut.message || 'Please complete the required action in the browser.';
        emit({ type: 'need_user_input', message });
        if (waitForUserInput) {
          await waitForUserInput(message);
          try {
            lastSnap = await tools.observe();
          } catch (e) {
            emit({ type: 'error', message: `Failed to observe after user input: ${e}` });
          }
          continue;
        }
        return { status: 'need_user_input', summary: message };
      }

      // Слой безопасности: подтверждение перед деструктивным действием
      if (action === 'request_confirmation' && planOut.pending_action) {
        const message = planOut.message || 'Confirm this action?';
        emit({ type: 'request_confirmation', message, data: planOut.pending_action });
        let confirmed = false;
        if (waitForConfirmation) {
          confirmed = await waitForConfirmation(message, planOut.pending_action);
        }
        if (confirmed) {
          const result = await execute(planOut.pending_action.action, planOut.pending_action.args, emit);
          if (!result.ok) {
            emit({ type: 'thought', message: 'Action failed after confirmation, observing...' });
            await execute('observe', {}, emit);
          }
        } else {
          emit({ type: 'thought', message: 'User declined. Observing page.' });
          await execute('observe', {}, emit);
        }
        try {
          lastSnap = await tools.observe();
        } catch (_) {}
        continue;
      }

      // Критическое осмысление чаще: каждые 4 шага или после ошибки
      if (steps % 4 === 0) {
        const critique = await reflect(goal, memory.summarize());
        if (critique.adjustment) {
          emit({ type: 'thought', message: `Reflection: ${critique.adjustment}` });
        }
      }

      const result = await execute(action, args, emit);

      if (!result.ok) {
        emit({ type: 'thought', message: 'Action failed, observing page state...' });
        await execute('observe', {}, emit);
        // После ошибки — рефлексия: что попробовать (закрыть попап, скролл, другой клик)
        const critique = await reflect(goal, memory.summarize());
        if (critique.adjustment) {
          emit({ type: 'thought', message: `After failure: ${critique.adjustment}` });
        }
      }

      if (action === 'finish' || (result as any).done) {
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
        emit({ type: 'status', message: `Task completed in ${executionTime}s` });
        return { status: 'success', summary: memory.summarize().slice(-1000) };
      }

      try {
        lastSnap = await tools.observe();
      } catch (error) {
        emit({ type: 'error', message: `Failed to update page snapshot: ${error}` });
      }

      if (Date.now() - startTime > 300000) {
        emit({ type: 'error', message: 'Execution timeout reached' });
        return { status: 'failed', summary: 'Task execution timed out' };
      }
    }

    emit({ type: 'error', message: `Maximum steps (${maxSteps}) exceeded` });
    return { status: 'failed', summary: `Task could not be completed within ${maxSteps} steps` };
  }

  return { runTask };
}
