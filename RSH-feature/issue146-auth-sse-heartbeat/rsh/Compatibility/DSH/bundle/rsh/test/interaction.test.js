import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import React, { act } from 'react';
import { render } from 'ink';
import { App } from '../src/ui.js';

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'terminal state did not settle');
    await setImmediate();
  }
}

function terminal(t, controls = {}) {
  let frame = '';
  let consumer;
  const sent = [];
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  const stdout = new Writable({ write(chunk, encoding, done) { frame = chunk.toString(); done(); } });
  stdout.columns = 100;
  stdout.rows = 40;
  const app = render(React.createElement(App, {
    agent: { followup: message => sent.push(message) },
    initialEvents: [],
    onEvent: handler => { consumer = handler; },
    onExit() {},
    onInterrupt() {},
    controls,
  }), { stdin, stdout, stderr: stdout, debug: true, exitOnCtrlC: false, patchConsole: false });
  t.after(() => { app.unmount(); stdin.destroy(); stdout.destroy(); });
  return { stdin, sent, event: event => consumer(event), ready: () => typeof consumer === 'function', frame: () => frame };
}

test('compact executes a command without submitting a model message', async t => {
  const commands = [];
  const ui = terminal(t, { executeCommand: async line => { commands.push(line); return { kind: 'success', text: 'Compaction finished' }; } });
  await waitFor(ui.ready);
  await act(async () => { ui.stdin.write('/compact'); });
  await waitFor(() => ui.frame().includes('/compact'));
  await act(async () => { ui.stdin.write('\r'); });
  await waitFor(() => ui.frame().includes('Compaction finished'));
  assert.deepEqual(commands, ['/compact']);
  assert.deepEqual(ui.sent, []);
});

test('failed attempts clear transient text before a retry begins', async t => {
  const ui = terminal(t);
  await waitFor(ui.ready);
  ui.event({ type: 'turn/start', data: {} });
  ui.event({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'Discarded response' } } });
  await waitFor(() => ui.frame().includes('Discarded response'));
  ui.event({ type: 'assistant/attempt', data: { stream: [] } });
  await waitFor(() => !ui.frame().includes('Discarded response'));
});

test('approval requires an explicit answer and leaves the composer untouched', async t => {
  const ui = terminal(t);
  await waitFor(ui.ready);
  const answers = [];
  ui.event({ type: 'rsh/approval', data: { id: 'question', toolName: 'bash', reason: 'outside workspace', settle: outcome => answers.push(outcome) } });
  await waitFor(() => ui.frame().includes('Allow bash?'));
  await act(async () => { ui.stdin.write('\r'); });
  await setImmediate();
  assert.deepEqual(answers, []);
  await act(async () => { ui.stdin.write('n'); });
  await waitFor(() => answers.length === 1);
  assert.deepEqual(answers, ['rejected']);
  assert.deepEqual(ui.sent, []);
  ui.event({ type: 'rsh/approval-done', data: { id: 'question' } });
  await waitFor(() => !ui.frame().includes('Allow bash?'));
});

test('cancellation removes only queued messages that have not been accepted', async t => {
  const ui = terminal(t);
  await waitFor(ui.ready);
  await act(async () => { ui.event({ type: 'turn/start', data: {} }); });
  await act(async () => { ui.stdin.write('accepted-message'); });
  await act(async () => { ui.stdin.write('\r'); });
  await waitFor(() => ui.sent.length === 1);
  await act(async () => { ui.event({ type: 'user/message', data: ui.sent[0] }); });
  await act(async () => { ui.stdin.write('unstarted-message'); });
  await act(async () => { ui.stdin.write('\r'); });
  await waitFor(() => ui.sent.length === 2);
  await act(async () => { ui.stdin.write('\x03'); });
  await waitFor(() => !ui.frame().includes('unstarted-message'));
  assert.ok(ui.frame().includes('accepted-message'));
});

test('repeated Enter cannot start concurrent preset changes', async t => {
  const selection = Promise.withResolvers();
  let calls = 0;
  const ui = terminal(t, {
    listMode: async () => [{ label: 'Ask', kind: 'preset', id: 'ask' }],
    selectMode: () => { calls++; return selection.promise; },
  });
  await waitFor(ui.ready);
  await act(async () => { ui.stdin.write('/mode'); });
  await act(async () => { ui.stdin.write('\r'); });
  await waitFor(() => ui.frame().includes('Choose mode'));
  await act(async () => { ui.stdin.write('\r'); });
  await act(async () => { ui.stdin.write('\r'); });
  assert.equal(calls, 1);
  await act(async () => { selection.resolve({ preset: 'ask' }); });
  await waitFor(() => !ui.frame().includes('Choose mode'));
});

test('model text cannot emit terminal control sequences', async t => {
  const ui = terminal(t);
  await waitFor(ui.ready);
  await act(async () => {
    ui.event({ type: 'turn/start', data: {} });
    ui.event({ type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'visible\x1b]52;c;YXR0YWNr\x07 text' } } });
  });
  await waitFor(() => ui.frame().includes('visible'));
  assert.ok(!ui.frame().includes('\x1b]52;'), 'model output reached the terminal as a clipboard command');
});
