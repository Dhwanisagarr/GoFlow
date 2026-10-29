import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { extractTasks, interpretTaskCommand, type CommandHistoryEntry, type PlannerIntent, type PlannerTask, type TaskCommandResult } from '../../lib/planner';

const PLAN_INSTRUCTIONS = `You are the planning assistant for GoFlow. Return only actions the user says they want or need to do. Ignore conversational framing (“I woke up at 5:00”, “I have things to do”), explanations, and feelings. Preserve every distinct activity and explicit quantity. Do not invent tasks, times, or durations. Return JSON only with {"tasks":[{"title":"short action card","detail":"optional exact relevant context","category":"Focus|Life|Rest","time":"optional explicit time","fixed":false}],"note":"brief optional acknowledgement"}.`;
const UPDATE_INSTRUCTIONS = `Interpret natural, imperfect messages for a personal focus app. Read the full current message, original speech transcript, active task, recent conversation, and current cards. Do not require command keywords, exact task titles, or perfect grammar. Distinguish ADD, EDIT, CORRECT, DELETE, COMPLETE, POSTPONE, RESCHEDULE, PRIORITIZE, BREAK_DOWN, and UNCLEAR. Resolve “it/that/last added task” from active task and history. Treat self-corrections (“No, I meant refill perfume”, “refill, not refer”) as corrections to the relevant existing card, not new cards. Use likely speech-to-text corrections only when context makes intent clear. Respect negation: “I don’t want that today” postpones; it does not delete. If a destructive target is uncertain, ask a concise clarification and make no change. Never modify completed cards. Preserve IDs, completion, timer sessions, and unrelated schedule fields. Split coordinated activities into separate cards: “fix my fan and fold my clothes” means two actions, and a list of three actions means three cards. Never join separate actions into one title. ADD only actual activities, not framing. Return JSON only: {"intent":"ADD|EDIT|CORRECT|DELETE|COMPLETE|POSTPONE|RESCHEDULE|PRIORITIZE|BREAK_DOWN|UNCLEAR","matchedTaskId":null,"proposedChanges":{},"confidence":0.0,"needsClarification":false,"clarification":"optional short question","response":"brief natural confirmation"}. ADD proposedChanges.tasks=[{"title":"...","category":"Focus|Life|Rest"},...]; for others proposedChanges contains only changed task fields; DELETE has {}.`;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TASKS = 150;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

type JsonObject = Record<string, unknown>;
function isRecord(value: unknown): value is JsonObject { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, max-age=0', ...extraHeaders } });
}
function limited(ip: string) {
  const now = Date.now();
  if (rateBuckets.size > 5_000) for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) { rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS }); return { allowed: true, retryAfter: 0 }; }
  if (bucket.count >= RATE_LIMIT) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}
function cleanTasks(value: unknown): PlannerTask[] | null {
  if (!Array.isArray(value) || value.length > MAX_TASKS) return null;
  const tasks: PlannerTask[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300 || (item.id !== undefined && (typeof item.id !== 'string' || item.id.length > 100))) return null;
    if (item.detail !== undefined && (typeof item.detail !== 'string' || item.detail.length > 2_000)) return null;
    if (item.time !== undefined && (typeof item.time !== 'string' || item.time.length > 100)) return null;
    if (item.category !== undefined && (typeof item.category !== 'string' || item.category.length > 40)) return null;
    if (item.seconds !== undefined && (typeof item.seconds !== 'number' || !Number.isFinite(item.seconds) || item.seconds < 0 || item.seconds > 86_400)) return null;
    if (item.steps !== undefined && (!Array.isArray(item.steps) || item.steps.length > 20 || item.steps.some(step => typeof step !== 'string' || step.length > 500))) return null;
    tasks.push({ id: item.id as string | undefined, title: item.title.trim(), detail: item.detail as string | undefined, category: item.category as string | undefined, time: item.time as string | undefined, fixed: typeof item.fixed === 'boolean' ? item.fixed : undefined, done: typeof item.done === 'boolean' ? item.done : undefined, seconds: item.seconds as number | undefined, priority: typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : undefined, postponed: typeof item.postponed === 'boolean' ? item.postponed : undefined, steps: item.steps as string[] | undefined, addedAt: typeof item.addedAt === 'number' && Number.isFinite(item.addedAt) ? item.addedAt : undefined });
  }
  return tasks;
}

async function askModel(system: string, user: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Planner request failed');
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0]) || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== 'string') throw new Error('Invalid planner response');
  return JSON.parse(payload.choices[0].message.content) as unknown;
}
const validIntents = new Set<PlannerIntent>(['ADD', 'EDIT', 'CORRECT', 'DELETE', 'COMPLETE', 'POSTPONE', 'RESCHEDULE', 'PRIORITIZE', 'BREAK_DOWN', 'UNCLEAR']);
function acceptAiAction(raw: unknown, current: PlannerTask[]): TaskCommandResult | null {
  if (!isRecord(raw) || typeof raw.intent !== 'string' || !validIntents.has(raw.intent as PlannerIntent) || typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1 || !isRecord(raw.proposedChanges)) return null;
  const intent = raw.intent as PlannerIntent;
  const proposed = raw.proposedChanges;
  if (raw.needsClarification || intent === 'UNCLEAR') { const question = String(raw.clarification || raw.response || 'Which task do you mean?').slice(0, 300); return { intent, matchedTaskId: null, proposedChanges: [], confidence: raw.confidence, needsClarification: true, clarification: question, response: question, tasks: current }; }
  if (intent === 'ADD') {
    const drafts: unknown[] = Array.isArray(proposed.tasks) ? proposed.tasks : proposed.task ? [proposed.task] : [];
    if (!drafts.length || drafts.length > 20 || drafts.some(draft => !isRecord(draft) || typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 300) || current.length + drafts.length > MAX_TASKS) return null;
    const added: PlannerTask[] = drafts.map(draft => {
      if (!isRecord(draft) || typeof draft.title !== 'string') throw new Error('Invalid task draft');
      return { id: crypto.randomUUID(), title: draft.title.trim(), category: ['Focus', 'Life', 'Rest'].includes(String(draft.category)) ? String(draft.category) : 'Focus', done: false, seconds: 0, addedAt: Date.now() };
    });
    return { intent, matchedTaskId: added[added.length - 1].id || null, proposedChanges: added.map(task => ({ type: 'add', task })), confidence: raw.confidence, needsClarification: false, response: String(raw.response || (added.length === 1 ? `Added “${added[0].title}”.` : `Added ${added.length} tasks.`)).slice(0, 300), tasks: [...current, ...added] };
  }
  const target = typeof raw.matchedTaskId === 'string' ? current.find(task => task.id === raw.matchedTaskId && !task.done) : undefined;
  if (!target || raw.confidence < .72 || (intent === 'DELETE' && raw.confidence < .86)) return null;
  if (intent === 'DELETE') return { intent, matchedTaskId: target.id || null, proposedChanges: [{ type: 'remove', taskId: target.id }], confidence: raw.confidence, needsClarification: false, response: String(raw.response || `Removed “${target.title}”.`).slice(0, 300), tasks: current.filter(task => task.id !== target.id) };
  const allowed = ['title', 'detail', 'category', 'time', 'postponed', 'priority', 'steps', 'done'];
  const changes: Record<string, unknown> = {};
  for (const key of allowed) if (key in proposed) changes[key] = proposed[key];
  if (!Object.keys(changes).length || ('title' in changes && (typeof changes.title !== 'string' || !changes.title.trim() || changes.title.length > 300)) || ('detail' in changes && (typeof changes.detail !== 'string' || changes.detail.length > 2_000)) || ('time' in changes && (typeof changes.time !== 'string' || changes.time.length > 100)) || ('category' in changes && !['Focus', 'Life', 'Rest'].includes(String(changes.category))) || ('done' in changes && typeof changes.done !== 'boolean') || ('postponed' in changes && typeof changes.postponed !== 'boolean') || ('priority' in changes && (typeof changes.priority !== 'number' || !Number.isFinite(changes.priority) || changes.priority < 0 || changes.priority > 10)) || ('steps' in changes && (!Array.isArray(changes.steps) || changes.steps.length > 20 || changes.steps.some(step => typeof step !== 'string' || step.length > 500)))) return null;
  const updated = current.map(task => task.id === target.id ? { ...task, ...changes } : task);
  return { intent, matchedTaskId: target.id || null, proposedChanges: [{ type: 'update', taskId: target.id, changes }], confidence: raw.confidence, needsClarification: false, response: String(raw.response || 'Updated your plan.').slice(0, 300), tasks: updated };
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!origin || !host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })()) return json({ error: 'Request could not be verified.' }, 403);

  const forwardedIp = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const clientIp = forwardedIp.split(',')[0].trim().slice(0, 128) || 'unknown';
  const rateKey = createHash('sha256').update(clientIp).digest('hex');
  const rate = limited(rateKey);
  if (!rate.allowed) return json({ error: 'Please wait a moment before trying again.' }, 429, { 'Retry-After': String(rate.retryAfter) });

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return json({ error: 'A JSON request is required.' }, 415);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413);
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json({ error: 'Request is too large.' }, 413);
    body = JSON.parse(text);
  } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
  if (!isRecord(body) || (body.action !== 'plan' && body.action !== 'update')) return json({ error: 'Unsupported request.' }, 400);

  if (body.action === 'plan') {
    if (typeof body.brainDump !== 'string' || body.brainDump.length > 20_000) return json({ error: 'Please keep your brain dump under 20,000 characters.' }, 400);
    if (!process.env.OPENAI_API_KEY) return json({ mode: 'demo', tasks: extractTasks(body.brainDump) });
    try {
      const plan: unknown = await askModel(PLAN_INSTRUCTIONS, body.brainDump);
      if (!isRecord(plan) || !Array.isArray(plan.tasks) || plan.tasks.length > 150) throw new Error('Invalid planner result');
      const tasks = plan.tasks.map((task: unknown) => {
        if (!isRecord(task) || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 300) throw new Error('Invalid planner task');
        return { title: task.title.trim(), detail: typeof task.detail === 'string' ? task.detail.slice(0, 2_000) : undefined, category: ['Focus', 'Life', 'Rest'].includes(String(task.category)) ? String(task.category) : 'Focus', time: typeof task.time === 'string' ? task.time.slice(0, 100) : undefined, fixed: typeof task.fixed === 'boolean' ? task.fixed : undefined };
      });
      return json({ ...plan, tasks });
    } catch { return json({ mode: 'demo', tasks: extractTasks(body.brainDump) }); }
  }

  if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 4_000 || (body.transcript !== undefined && (typeof body.transcript !== 'string' || body.transcript.length > 4_000))) return json({ error: 'Please check the task update and try again.' }, 400);
  const tasks = cleanTasks(body.tasks);
  if (!tasks) return json({ error: 'The task data could not be processed.' }, 400);
  const history = Array.isArray(body.history) && body.history.length <= 30 ? body.history.filter((entry): entry is CommandHistoryEntry => isRecord(entry) && typeof entry.text === 'string').map(entry => ({ text: entry.text.slice(0, 4_000), transcript: typeof entry.transcript === 'string' ? entry.transcript.slice(0, 4_000) : undefined, intent: entry.intent, taskId: typeof entry.taskId === 'string' ? entry.taskId.slice(0, 100) : undefined, at: typeof entry.at === 'number' ? entry.at : undefined })) : [];
  const context = { activeTaskId: typeof body.activeTaskId === 'string' ? body.activeTaskId.slice(0, 100) : undefined, history, transcript: typeof body.transcript === 'string' ? body.transcript : undefined };
  const fallback = () => interpretTaskCommand(body.command as string, tasks, context);
  if (!process.env.OPENAI_API_KEY) return json({ mode: 'demo', ...fallback() });
  const deterministic = fallback();
  if (deterministic.intent === 'ADD') return json(deterministic);
  try {
    const ai = await askModel(UPDATE_INSTRUCTIONS, JSON.stringify({ message: body.command, originalSpeechTranscript: context.transcript || null, tasks, activeTaskId: context.activeTaskId, recentConversation: context.history.slice(-12) }));
    const accepted = acceptAiAction(ai, tasks);
    if (accepted?.intent === 'DELETE') {
      const checked = fallback();
      if (checked.needsClarification || checked.matchedTaskId !== accepted.matchedTaskId) return json(checked);
    }
    if (accepted?.intent === 'ADD' && fallback().needsClarification) return json(fallback());
    return json(accepted || { mode: 'demo', ...fallback() });
  } catch { return json({ mode: 'demo', ...fallback() }); }
}
