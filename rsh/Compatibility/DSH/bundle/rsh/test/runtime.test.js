import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { finishSession, liveChunkEvent, parseResumeArgs, resumePreset, resumeTitle } from '../src/runtime.js';

test('resume titles skip injected runtime-context messages', () => {
  assert.equal(resumeTitle([
    { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'Sandbox policy' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Review\n the code' }] } },
  ]), 'Review the code');
  assert.equal(resumeTitle([]), 'Untitled session');
});

test('resume retains an Ask selection made before the first turn', () => {
  assert.equal(resumePreset({ agentPreset: 'standard' }, [
    { type: 'agent-preset/selected', data: { agentPreset: 'coding' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'ask' } },
  ]), 'ask');
  assert.equal(resumePreset({ agentPreset: 'ask' }, []), 'ask');
  assert.equal(resumePreset({}, []), undefined);
});

describe('finishSession', () => {
  test('waits for cancellation settlement before flushing the closed turn', async () => {
    const idle = Promise.withResolvers();
    const flushed = [];
    const session = { events: [] };
    const agent = {
      session,
      cancel(reason, options) {
        assert.deepEqual(reason, { kind: 'user' });
        assert.deepEqual(options, { keepInbox: false });
      },
      whenIdle: () => idle.promise,
    };
    const done = finishSession(agent, { flush: async value => { flushed.push([...value.events]); } });
    assert.deepEqual(flushed, []);
    session.events.push('turn/end');
    idle.resolve();
    await done;
    assert.deepEqual(flushed, [['turn/end']]);
  });

  test('propagates durability failure instead of reporting successful exit', async () => {
    const failure = new Error('disk full');
    await assert.rejects(finishSession({
      session: {}, cancel() {}, whenIdle: async () => {},
    }, { flush: async () => { throw failure; } }), error => error === failure);
  });
});

describe('parseResumeArgs', () => {
  test('accepts fresh startup and the short resume form', () => {
    assert.deepEqual(parseResumeArgs([]), { kind: 'fresh' });
    assert.deepEqual(parseResumeArgs(['resume']), { kind: 'resume' });
    assert.deepEqual(parseResumeArgs(['resume', 'session-123']), { kind: 'resume', sessionId: 'session-123' });
  });

  test('accepts the explicit compatibility form and rejects unrelated argv', () => {
    assert.deepEqual(parseResumeArgs(['--resume', 'session-123']), { kind: 'resume', sessionId: 'session-123' });
    assert.throws(() => parseResumeArgs(['--resume']), /usage/);
    assert.throws(() => parseResumeArgs(['unknown']), /usage/);
  });
});

describe('liveChunkEvent', () => {
  test('forwards a reasoning delta to the TUI event format', () => {
    const chunk = { type: 'reasoning-delta', index: 0, text: 'inspect the request' };
    assert.deepEqual(liveChunkEvent({ type: 'chunk', chunk }), {
      type: 'assistant/chunk',
      data: { chunk },
    });
  });

  test('forwards text and tool chunks without changing their provider payload', () => {
    for (const chunk of [
      { type: 'text-delta', index: 0, text: 'answer' },
      { type: 'tool-call-delta', index: 1, id: 'call-1', argumentsDelta: '{' },
    ]) {
      assert.equal(liveChunkEvent({ type: 'chunk', chunk }).data.chunk, chunk);
    }
  });

  test('does not render start, end, or malformed frames as chunks', () => {
    assert.equal(liveChunkEvent({ type: 'start' }), undefined);
    assert.equal(liveChunkEvent({ type: 'end' }), undefined);
    assert.equal(liveChunkEvent(null), undefined);
  });
});
