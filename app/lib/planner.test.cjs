const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretTaskCommand } = require('../../.test-build/planner.js');

const task = (id, title, extra = {}) => ({ id, title, category: 'Focus', done: false, seconds: 42, ...extra });

test('normal add creates one task without command framing', () => {
  const result = interpretTaskCommand('Add paint two paintings', []);
  assert.equal(result.intent, 'ADD');
  assert.equal(result.tasks[0].title, 'Paint two paintings');
  assert.equal(result.tasks.length, 1);
});

test('follow-up addition splits coordinated actions into separate task cards', () => {
  const result = interpretTaskCommand('Fix my fan and fold my clothes', []);
  assert.equal(result.intent, 'ADD');
  assert.deepEqual(result.tasks.map(item => item.title), ['Fix my fan', 'Fold my clothes']);
  assert.equal(result.proposedChanges.length, 2);
});

test('follow-up addition keeps all three tasks from a spoken list', () => {
  const result = interpretTaskCommand('Add fix my fan, fold my clothes, and call my mom', []);
  assert.deepEqual(result.tasks.map(item => item.title), ['Fix my fan', 'Fold my clothes', 'Call my mom']);
  assert.equal(result.proposedChanges.length, 3);
});

test('new single task is added instead of replacing an unrelated active card', () => {
  const tasks = [task('active', 'Read the book')];
  const result = interpretTaskCommand('Call the dentist', tasks, { activeTaskId: 'active' });
  assert.equal(result.intent, 'ADD');
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].title, 'Read the book');
  assert.equal(result.tasks[1].title, 'Call the dentist');
});

test('new tasks remain append-only after every existing card is completed', () => {
  const tasks = [task('done-1', 'Finish cake studies', { done: true, seconds: 120 }), task('done-2', 'Read the book', { done: true, seconds: 45 })];
  const result = interpretTaskCommand('Add complete cake studies', tasks, { activeTaskId: 'done-2' });
  assert.equal(result.intent, 'ADD');
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(result.tasks.slice(0, 2), tasks);
  assert.equal(result.tasks[2].title, 'Complete cake studies');
  assert.equal(result.tasks[2].done, false);
});

test('a new “Complete …” task is accepted when no unfinished task can be completed', () => {
  const tasks = [task('done', 'Read the book', { done: true, seconds: 150 })];
  const result = interpretTaskCommand('Complete cake studies', tasks, { activeTaskId: 'done' });
  assert.equal(result.intent, 'ADD');
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks[0], tasks[0]);
  assert.equal(result.tasks[1].title, 'Complete cake studies');
});

test('indirect “remove the last added task” resolves the latest addition', () => {
  const tasks = [task('old', 'Read a book'), task('new', 'Paint two paintings')];
  const result = interpretTaskCommand('Could you remove the last added task?', tasks, { history: [{ text: 'Paint two paintings', intent: 'ADD', taskId: 'new' }] });
  assert.equal(result.intent, 'DELETE');
  assert.equal(result.matchedTaskId, 'new');
  assert.deepEqual(result.tasks.map(t => t.id), ['old']);
});

test('self-correction updates the active card and preserves its ID and timer', () => {
  const tasks = [task('a', 'Refer perfume')];
  const result = interpretTaskCommand('No, I meant refill perfume', tasks, { activeTaskId: 'a' });
  assert.equal(result.intent, 'CORRECT');
  assert.equal(result.tasks[0].id, 'a');
  assert.equal(result.tasks[0].title, 'Refill perfume');
  assert.equal(result.tasks[0].seconds, 42);
});

test('in-sentence “refill, not refer” correction keeps the intended wording', () => {
  const result = interpretTaskCommand("It's refill, not refer", [task('a', 'Refer perfume', { time: '3 PM' })], { activeTaskId: 'a' });
  assert.equal(result.intent, 'CORRECT');
  assert.equal(result.tasks[0].title, 'Refill perfume');
  assert.equal(result.tasks[0].time, '3 PM');
});

test('likely speech recognition mistake uses active task context', () => {
  const result = interpretTaskCommand('Go to fish market', [task('fish', 'Go to fish bowl')], { activeTaskId: 'fish', transcript: 'Go to fish market' });
  assert.equal(result.matchedTaskId, 'fish');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, 'Go to fish market');
});

test('negation postpones the active task instead of deleting it', () => {
  const result = interpretTaskCommand("I don't want that today", [task('study', 'Study for exam')], { activeTaskId: 'study' });
  assert.equal(result.intent, 'POSTPONE');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].postponed, true);
});

test('ambiguous destructive reference asks before changing anything', () => {
  const tasks = [task('read', 'Read the book'), task('read2', 'Read exam notes')];
  const result = interpretTaskCommand('Delete reading', tasks);
  assert.equal(result.needsClarification, true);
  assert.equal(result.tasks.length, 2);
});

test('a vague correction request asks for wording without changing the card', () => {
  const tasks = [task('a', 'Refill perfume')];
  const result = interpretTaskCommand('That name is wrong', tasks, { activeTaskId: 'a' });
  assert.equal(result.needsClarification, true);
  assert.deepEqual(result.tasks, tasks);
});

test('multi-turn “do reading first” prioritizes an existing card, not a duplicate', () => {
  const tasks = [task('read', 'Read the book'), task('clean', 'Clean your desk')];
  const result = interpretTaskCommand('Actually, do reading first', tasks, { activeTaskId: 'clean', history: [{ text: 'Read the book', intent: 'ADD', taskId: 'read' }] });
  assert.equal(result.intent, 'PRIORITIZE');
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].priority, 0);
});

test('conversation references complete and reschedule the active item', () => {
  const source = [task('a', 'Read the book')];
  const completed = interpretTaskCommand('I finished it', source, { activeTaskId: 'a' });
  assert.equal(completed.intent, 'COMPLETE');
  assert.equal(completed.tasks[0].done, true);
  const moved = interpretTaskCommand('Move it to evening', source, { activeTaskId: 'a' });
  assert.equal(moved.intent, 'RESCHEDULE');
  assert.equal(moved.tasks[0].time, 'Evening');
});

test('consecutive edit, add, and delete instructions use the latest task state', () => {
  let current = [task('market', 'Go to fish bowl')];

  const corrected = interpretTaskCommand('Go to fish market', current, { activeTaskId: 'market' });
  assert.equal(corrected.tasks[0].title, 'Go to fish market');
  current = corrected.tasks;

  const added = interpretTaskCommand('Add fold my clothes', current, { activeTaskId: 'market' });
  assert.deepEqual(added.tasks.map(item => item.title), ['Go to fish market', 'Fold my clothes']);
  current = added.tasks;

  const deleted = interpretTaskCommand('Delete fold my clothes', current, { activeTaskId: 'market' });
  assert.deepEqual(deleted.tasks.map(item => item.title), ['Go to fish market']);
});
