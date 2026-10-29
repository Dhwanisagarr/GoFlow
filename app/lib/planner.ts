export type PlannerIntent = 'ADD' | 'EDIT' | 'CORRECT' | 'DELETE' | 'COMPLETE' | 'POSTPONE' | 'RESCHEDULE' | 'PRIORITIZE' | 'BREAK_DOWN' | 'UNCLEAR';
export type PlannerTask = {
  id?: string; title: string; detail?: string; category?: string; time?: string;
  fixed?: boolean; done?: boolean; seconds?: number; priority?: number;
  postponed?: boolean; steps?: string[]; addedAt?: number; sourceTranscript?: string;
};
export type TaskDraft = Pick<PlannerTask, 'title' | 'detail' | 'category'>;
export type CommandHistoryEntry = { text: string; transcript?: string; intent?: PlannerIntent; taskId?: string; at?: number };
export type CommandContext = { activeTaskId?: string; history?: CommandHistoryEntry[]; transcript?: string };
export type TaskCommandResult = {
  intent: PlannerIntent; matchedTaskId: string | null; proposedChanges: Array<{ type: string; taskId?: string; changes?: Partial<PlannerTask>; task?: PlannerTask }>;
  confidence: number; needsClarification: boolean; clarification?: string; response: string; tasks: PlannerTask[];
};

/** Rebase a completed request on the newest local state, retaining timer progress and concurrent additions. */
export function rebaseTaskResult(submitted: PlannerTask[], proposed: PlannerTask[], latest: PlannerTask[]): PlannerTask[] {
  const submittedById = new Map(submitted.map(task => [task.id, task]));
  const latestById = new Map(latest.map(task => [task.id, task]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const rebased = proposed.flatMap(candidate => {
    const original = candidate.id ? submittedById.get(candidate.id) : undefined;
    const current = candidate.id ? latestById.get(candidate.id) : undefined;
    if (!original) return [current ? { ...current, ...candidate } : candidate];
    if (!current) return [];
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(candidate)) {
      if (field === 'id' || same(value, original[field as keyof PlannerTask])) continue;
      // Keep a newer same-field write if it changed while this request was in flight.
      if (same(current[field as keyof PlannerTask], original[field as keyof PlannerTask])) patch[field] = value;
    }
    return [{ ...current, ...patch }];
  });
  const submittedIds = new Set(submitted.map(task => task.id));
  return [...rebased, ...latest.filter(task => !submittedIds.has(task.id))];
}

const stopWords = new Set('the a an to for from my me i we our it on at of and that this please task card item today into with get going have has had want need should must can could would like do does did is are am be been being then about off out up in by as'.split(' '));
const normalize = (value: string) => value.toLowerCase().replace(/\bfishbowl\b/g, 'fish bowl').replace(/\bfishmarket\b/g, 'fish market').replace(/\bpaintings\b/g, 'painting').replace(/\breading\b/g, 'read').replace(/\bstudying\b/g, 'study').replace(/\bcleaning\b/g, 'clean').replace(/\bgoing\b/g, 'go').replace(/\bshopping\b/g, 'shop').replace(/\bgetting\b/g, 'get').replace(/\bdoing\b/g, 'do').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (value: string) => normalize(value).split(' ').filter(word => word.length > 1 && !stopWords.has(word));
const titleCase = (value: string) => value.trim().replace(/^\w/, first => first.toUpperCase());

function cleanTask(raw: string): TaskDraft | null {
  let text = raw.trim().replace(/^[-*•\d.)\s]+/, '').replace(/[.!?]+$/, '').trim();
  if (!text || /\b(?:not in (?:(?:the|a) )?mood|don't feel like|do not feel like|i don't want to|i do not want to|i can't|i cannot|i won't|not feeling up to|feeling (?:tired|sad|anxious|overwhelmed)|i woke up|i got up|i slept|i feel|i am feeling|i'm feeling|i was feeling|i have things to do|i've got things to do|things i have to do|tasks i have to do|what i have to do today|the tasks? i have to complete|things i have to do today|you did it|i did it|that's done)\b/i.test(text)) return null;
  text = text.replace(/^(?:today\s+)?(?:my\s+)?(?:tasks?|things|items)\s+(?:i\s+(?:have|need)\s+to\s+)?(?:complete|do|finish)\s+(?:today\s+)?(?:are|include|:)?\s*/i, '');
  text = text.replace(/^(?:(?:today\s+)?i\s+)?(?:want|wanted|need|needed|have|had|should|must|plan|planned|would like)\s+to\s+/i, '');
  text = text.replace(/^(?:please\s+)?(?:remember to|make sure to|try to)\s+/i, '').replace(/^(?:telling that|that)\s+/i, '').trim();
  if (!text || /^(?:study|work|do it|complete things)$/i.test(text)) return null;
  const category = /paint|market|shop|fish|meal|lunch|dinner|food|cook|clean|tidy|laundry|errand|appointment|meeting|call|email|visit|grocery|buy|pick up|routine/i.test(text) ? 'Life' : /read|book|rest|break|walk|stretch|meditat/i.test(text) ? 'Rest' : 'Focus';
  return { title: titleCase(text), category };
}

export function extractTasks(text: string): TaskDraft[] {
  const lines = text.split(/\n+/).flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z0-9I])/u)).map(x => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (let content of lines) {
    const listStart = content.match(/\b(?:tasks?|things|items|to dos?)\b[^:]{0,100}:/i);
    if (listStart) content = content.slice((listStart.index || 0) + listStart[0].length);
    else content = content.replace(/^.*?\b(?:tasks?|things|items)\s+(?:i\s+(?:have|need)\s+to\s+)?(?:complete|do|finish)\s+today\s+(?:are|include)\s+/i, '');
    for (const commaChunk of content.split(/[,;\n]+/).map(x => x.trim().replace(/^(?:and|then)\s+/i, '')).filter(Boolean)) {
      chunks.push(...commaChunk.split(/\s+(?:and then|then)\s+|\s+and\s+(?=(?:(?:i\s+)?(?:want|need|have|should|must|plan|remember|go|paint|buy|call|email|clean|read|study|learn|prepare|make|cook|pick|take|finish|submit|book|water|feed|send|write|pay|schedule|visit|drop|tidy|start|work|practice|fix|fold|wash|iron|organize|arrange|repair|check|open|close|pack|collect|return|move|deliver|drive|run|exercise|meditate|stretch|refill|charge|install|replace|review|apply|ask|find|order|shop|vacuum|sweep|mop|dust|declutter|text|message)\b))/i));
    }
  }
  const seen = new Set<string>(), tasks: TaskDraft[] = [];
  for (const chunk of chunks) { const task = cleanTask(chunk); if (!task) continue; const key = normalize(task.title); if (key && !seen.has(key)) { seen.add(key); tasks.push(task); } }
  return tasks;
}

function editSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let diagonal = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)); diagonal = old; } }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
function scoreTarget(query: string, task: PlannerTask) {
  const wanted = tokens(query), have = tokens(`${task.title} ${task.detail || ''}`); if (!wanted.length || !have.length) return 0;
  const coverage = wanted.filter(word => have.some(candidate => candidate === word || editSimilarity(candidate, word) >= .72)).length / wanted.length;
  const overlap = wanted.filter(word => have.some(candidate => candidate === word || editSimilarity(candidate, word) >= .72)).length / Math.max(wanted.length, have.length);
  return coverage * .76 + overlap * .24;
}
function rankTasks(query: string, tasks: PlannerTask[]) { return tasks.map(task => ({ task, score: scoreTarget(query, task) })).filter(x => !x.task.done).sort((a, b) => b.score - a.score); }
function activeTask(tasks: PlannerTask[], context: CommandContext) { return tasks.find(t => t.id === context.activeTaskId && !t.done); }
function resolveReference(reference: string, tasks: PlannerTask[], context: CommandContext) {
  const ref = reference.trim().toLowerCase();
  if (/^(?:the )?(?:last|most recent|just added|latest added) (?:added )?(?:task|card|item)?$/.test(ref) || /^(?:the )?last added task$/.test(ref)) {
    const lastAddedId = [...(context.history || [])].reverse().find(entry => entry.intent === 'ADD' && entry.taskId)?.taskId;
    const found = lastAddedId ? tasks.find(t => t.id === lastAddedId && !t.done) : undefined;
    return found || [...tasks].reverse().find(t => !t.done);
  }
  if (/^(?:it|that|this|that one|the last one|the previous one)$/.test(ref)) return activeTask(tasks, context) || [...(context.history || [])].reverse().map(entry => tasks.find(t => t.id === entry.taskId && !t.done)).find(Boolean);
  return undefined;
}
function matchTask(reference: string, tasks: PlannerTask[], context: CommandContext) {
  const explicit = resolveReference(reference, tasks, context); if (explicit) return { task: explicit, confidence: .97, ambiguous: false };
  const ranked = rankTasks(reference, tasks); if (!ranked.length || ranked[0].score < .40) return { confidence: 0, ambiguous: false };
  const gap = ranked[0].score - (ranked[1]?.score || 0);
  if (ranked[0].score < .58 || (ranked[1] && gap < .14)) return { task: ranked[0].task, confidence: ranked[0].score, ambiguous: true };
  return { task: ranked[0].task, confidence: Math.min(.97, .62 + ranked[0].score * .36 + gap * .1), ambiguous: false };
}
const response = (text: string, intent: PlannerIntent, task?: PlannerTask) => {
  if (intent === 'DELETE') return `Removed “${task?.title}”.`;
  if (intent === 'ADD') return `Added “${task?.title}”.`;
  if (intent === 'CORRECT' || intent === 'EDIT') return `Updated “${task?.title}”.`;
  if (intent === 'COMPLETE') return `Marked “${task?.title}” complete.`;
  if (intent === 'POSTPONE') return `Moved “${task?.title}” out of today.`;
  if (intent === 'RESCHEDULE') return `Rescheduled “${task?.title}”.`;
  if (intent === 'PRIORITIZE') return `Moved “${task?.title}” to the front.`;
  if (intent === 'BREAK_DOWN') return `Added smaller steps to “${task?.title}”.`;
  return text;
};
function result(intent: PlannerIntent, tasks: PlannerTask[], changes: TaskCommandResult['proposedChanges'], confidence: number, message: string, matched?: PlannerTask, needsClarification = false): TaskCommandResult {
  return { intent, matchedTaskId: matched?.id || null, proposedChanges: changes, confidence, needsClarification, ...(needsClarification ? { clarification: message } : {}), response: message, tasks };
}
function clarification(intent: PlannerIntent, tasks: PlannerTask[], message: string, match?: PlannerTask, confidence = .35) { return result(intent, tasks, [], confidence, message, match, true); }
function updateTask(tasks: PlannerTask[], task: PlannerTask, changes: Partial<PlannerTask>, intent: PlannerIntent, confidence: number) {
  const next = tasks.map(item => item.id === task.id ? { ...item, ...changes } : item);
  return result(intent, next, [{ type: 'update', taskId: task.id, changes }], confidence, response('', intent, { ...task, ...changes }), task);
}

function addTasks(drafts: TaskDraft[], current: PlannerTask[], text: string, context: CommandContext): TaskCommandResult {
  if (!drafts.length) return clarification('ADD', current, 'What task should I add?');
  for (const draft of drafts) {
    const duplicate = rankTasks(draft.title, [...current, ...drafts.slice(0, drafts.indexOf(draft)).map(item => ({ ...item, done: false }))]).find(item => item.score >= .72);
    if (duplicate) return clarification('ADD', current, `There’s already a similar card, “${duplicate.task.title}”. Should I update it or add another?`, duplicate.task, .62);
  }
  const added = drafts.map(draft => ({ ...draft, id: crypto.randomUUID(), done: false, seconds: 0, sourceTranscript: context.transcript || text, addedAt: Date.now() } as PlannerTask));
  const label = added.length === 1 ? `Added “${added[0].title}”.` : `Added ${added.length} tasks.`;
  return result('ADD', [...current, ...added], added.map(task => ({ type: 'add', task })), .91, label, added[added.length - 1]);
}

/** Deterministic, validated language fallback shared by the API and local UI fallback. */
export function interpretTaskCommand(command: string, current: PlannerTask[], context: CommandContext = {}): TaskCommandResult {
  const text = command.trim(); if (!text) return clarification('UNCLEAR', current, 'What would you like me to change?');
  const lower = text.toLowerCase().replace(/[?!.,]+$/g, '').trim();
  let intent: PlannerIntent = 'UNCLEAR', reference = '', payload = '';
  let m: RegExpMatchArray | null;
  if (/^(?:please\s+)?(?:add|also add|include|put in|remember)\s+/i.test(lower)) { intent = 'ADD'; payload = text.replace(/^(?:please\s+)?(?:add|also add|include|put in|remember(?:\s+to)?)\s+/i, ''); }
  else if ((m = lower.match(/\b(?:remove|delete|erase|drop|cancel|discard|take off|cross off|get rid of)\s+(.+?)(?:\s+from\s+(?:the\s+)?(?:task\s+)?(?:list|plan|cards?))?$/))) { intent = 'DELETE'; reference = m[1].replace(/^(?:the|my|any)\s+(?:last added )?(?:task|card|item)\s+(?:about|for|to|called)\s+/i, '').trim(); }
  else if ((m = lower.match(/\b(?:i(?:'m| am) done with|i finished|i have finished|finished|mark|check off|complete)\s+(.+)$/))) { intent = 'COMPLETE'; reference = m[1]; }
  else if (/\b(?:don't want|do not want|not doing|skip|leave|take)\b.*\b(?:today|for now|off today)\b/.test(lower) || /\b(?:postpone|put off|leave .* for later)\b/.test(lower)) { intent = 'POSTPONE'; reference = text.match(/(?:don't want|do not want|skip|postpone|put off|leave)\s+(.+?)(?:\s+(?:today|for now|until later))?$/i)?.[1] || 'it'; }
  else if ((m = lower.match(/\b(?:move|reschedule|shift|push)\s+(.+?)\s+(?:to|until|for)\s+(.+)$/))) { intent = 'RESCHEDULE'; reference = m[1]; payload = m[2]; }
  else if ((m = lower.match(/\b(?:do|put|make|take)\s+(.+?)\s+(?:first|next|before everything)\b/)) || (m = lower.match(/\b(?:prioritize|prioritise|do first|start with)\s+(.+)$/))) { intent = 'PRIORITIZE'; reference = m[1]; }
  else if ((m = lower.match(/\b(?:break down|break into|split)\s+(.+?)(?:\s+into\s+(.+))?$/))) { intent = 'BREAK_DOWN'; reference = m[1]; payload = m[2] || ''; }
  else if ((m = lower.match(/\b(?:update|change|modify|edit|replace|alter|revise|rename|correct)\s+(.+?)\s+(?:to|as|into|with)\s+(.+)$/))) { intent = 'EDIT'; reference = m[1]; payload = m[2]; }
  else if ((m = lower.match(/\b(?:no[, ]+)?(?:i meant|i mean|it's|it is|that should be|the name is wrong[, ]*(?:it should be)?|not .+? but)\s+(.+)$/))) { intent = 'CORRECT'; payload = m[1].replace(/^(?:to|that)\s+/i, ''); reference = 'it'; }
  else if (/\b(?:add|include|also|as well|another)\b/.test(lower) && !/\b(?:add this as well)\b/.test(lower)) { intent = 'ADD'; payload = text.replace(/^.*?\b(?:add|include|remember to)\s+/i, '').replace(/\s+as well\s*$/i, ''); }
  else if (/\b(?:no[, ]+)?i (?:meant|mean)\b|\b(?:that name is wrong|not .+ but .+)\b/.test(lower)) { intent = 'CORRECT'; payload = text.replace(/^.*?\b(?:i meant|i mean)\s+/i, ''); reference = 'it'; }
  else if (/\b(?:done|finished|completed)\b/.test(lower)) { intent = 'COMPLETE'; reference = 'it'; }
  else if (/\b(?:first|prioritize|prioritise)\b/.test(lower)) { intent = 'PRIORITIZE'; reference = text.replace(/\b(?:actually|do|put|first|prioritize|prioritise)\b/gi, '').trim() || 'it'; }
  else if (/\b(?:break down|split into)\b/.test(lower)) { intent = 'BREAK_DOWN'; reference = 'it'; }

  // Speech often keeps both sides of an in-sentence correction; retain only the intended wording.
  if (intent === 'CORRECT') {
    const correction = text.match(/\b(?:it's|it is)\s+(.+?),\s*not\s+.+$/i) || text.match(/^(.+?),\s*not\s+.+$/i);
    if (correction) payload = correction[1].replace(/^(?:no[, ]+)?(?:i meant|i mean)\s+/i, '').trim();
    if (/^(?:that name is wrong|the name is wrong)$/i.test(text)) return clarification('CORRECT', current, 'What should the card be called instead?', activeTask(current, context), .4);
  }

  if (intent === 'ADD') {
    if (/^(?:add\s+)?(?:this|that|it)\s+as well$/.test(lower)) {
      const previous = [...(context.history || [])].reverse().find(entry => entry.text && entry.intent === 'ADD');
      payload = previous?.text || '';
    }
    return addTasks(extractTasks(payload || text), current, text, context);
  }

  if (intent === 'UNCLEAR') {
    // Imperative correction fragments often contain no command verb: use the active card as context.
    const drafts = extractTasks(text), active = activeTask(current, context);
    if (drafts.length > 1) return addTasks(drafts, current, text, context);
    const draft = drafts[0];
    if (draft && active && scoreTarget(draft.title, active) >= .60) { intent = 'CORRECT'; reference = 'it'; payload = draft.title; }
    else if (draft) return addTasks(drafts, current, text, context);
    else return clarification('UNCLEAR', current, 'I’m not sure which change you mean. Could you say what to add, change, or remove?');
  }

  let match: ReturnType<typeof matchTask>;
  if (intent === 'CORRECT' && (!reference || /^(?:it|that|this)$/.test(reference))) {
    const active = activeTask(current, context); const previous = [...(context.history || [])].reverse().map(entry => current.find(task => task.id === entry.taskId && !task.done)).find(Boolean);
    match = active ? { task: active, confidence: .90, ambiguous: false } : previous ? { task: previous, confidence: .77, ambiguous: false } : { confidence: 0, ambiguous: false };
  } else match = matchTask(reference, current, context);
  // A short correction sentence is resolved against the active card even when its words were mistranscribed.
  if (!match.task && (intent === 'CORRECT' || intent === 'EDIT') && activeTask(current, context)) match = { task: activeTask(current, context), confidence: .78, ambiguous: false };
  if (!match.task && intent === 'COMPLETE' && /^\s*(?:please\s+)?complete\s+\S/i.test(text)) {
    const draft = cleanTask(text.replace(/^\s*(?:please\s+)?/i, ''));
    if (draft) return addTasks([draft], current, text, context);
  }
  if (!match.task) return clarification(intent, current, 'Which task do you mean? Name a word or two from its card.', undefined, match.confidence);
  if (match.ambiguous) return clarification(intent, current, `I found more than one possible card. Which one did you mean: “${match.task.title}” or another?`, match.task, match.confidence);
  const task = match.task;
  if (task.done) return clarification(intent, current, `“${task.title}” is already complete. Which unfinished card should I change?`, task, match.confidence);
  if (intent === 'DELETE') return result(intent, current.filter(item => item.id !== task.id), [{ type: 'remove', taskId: task.id }], match.confidence, response('', intent, task), task);
  if (intent === 'COMPLETE') return updateTask(current, task, { done: true }, intent, match.confidence);
  if (intent === 'POSTPONE') return updateTask(current, task, { postponed: true }, intent, match.confidence);
  if (intent === 'RESCHEDULE') return updateTask(current, task, { time: titleCase(payload) }, intent, match.confidence);
  if (intent === 'PRIORITIZE') return updateTask(current, task, { priority: 0 }, intent, match.confidence);
  if (intent === 'BREAK_DOWN') {
    const hints = payload.split(/[,;] |\band\b/i).map(s => s.trim()).filter(Boolean);
    const steps = hints.length ? hints : [`Start: ${task.title}`, `Continue: ${task.title}`, `Finish: ${task.title}`];
    return updateTask(current, task, { steps }, intent, match.confidence);
  }
  if (intent === 'EDIT' || intent === 'CORRECT') {
    let replacement = payload;
    replacement = replacement.replace(/^(?:no[, ]+)?(?:i meant|i mean)\s+/i, '').replace(/^(?:to|that)\s+/i, '').replace(/[.!?]+$/, '').trim();
    const draft = extractTasks(replacement)[0] || cleanTask(replacement);
    if (!draft) return clarification(intent, current, 'What should the card say instead?', task, match.confidence);
    // When a spoken correction fixes only the misheard word (“refill, not refer”), keep
    // the useful object already attached to that card instead of dropping it.
    if (draft.title.split(/\s+/).length === 1 && task.title.split(/\s+/).length > 1) draft.title = `${draft.title} ${task.title.split(/\s+/).slice(1).join(' ')}`;
    const actionVerb = task.title.match(/^[a-z]+\b/i)?.[0];
    const actionWords = /^(?:go|get|buy|paint|clean|visit|call|read|study|make|cook|tidy|write|send|pick|prepare|learn|finish|submit|book|water|feed|pay|schedule|drop|work|practice|take|open|close|organize|arrange|walk|stretch|meditate|email|review|update|repair|fix|sort|pack|wash|iron|collect|return|plan|start|continue|apply|ask|check|find|order|move|deliver|drive|run|exercise|do|refill)\b/i;
    if (!actionWords.test(draft.title) && actionVerb) draft.title = `${actionVerb} ${draft.title.charAt(0).toLowerCase()}${draft.title.slice(1)}`;
    const updated = { title: titleCase(draft.title), category: draft.category || task.category, sourceTranscript: task.sourceTranscript || context.transcript || text };
    return updateTask(current, task, updated, intent, Math.max(match.confidence, .78));
  }
  return clarification('UNCLEAR', current, 'What would you like me to do with that card?', task, match.confidence);
}

/** Compatibility wrapper for callers that only need task state and a short message. */
export function applyTaskCommand(command: string, current: PlannerTask[], activeId?: string, context: Omit<CommandContext, 'activeTaskId'> = {}) {
  const action = interpretTaskCommand(command, current, { ...context, activeTaskId: activeId });
  return { ...action, message: action.response };
}
