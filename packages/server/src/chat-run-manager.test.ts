import { describe, expect, it, vi } from 'vitest';
import { uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai';

import { ChatRunManager } from './chat-run-manager';

describe('ChatRunManager', () => {
  it('rejects a second active run for the same project', () => {
    const manager = new ChatRunManager();
    const first = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });
    const second = manager.startRun({
      conversationId: 'conversation-2',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it('allows runs for different projects', () => {
    const manager = new ChatRunManager();
    const first = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });
    const second = manager.startRun({
      conversationId: 'conversation-2',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-2',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('keeps a run alive after the initial subscriber disconnects', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const onFinish = vi.fn();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish,
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await reader.cancel();

    source.enqueue({ id: 'text-1', type: 'text-start' });
    source.enqueue({ delta: '完成', id: 'text-1', type: 'text-delta' });
    source.enqueue({ id: 'text-1', type: 'text-end' });
    source.enqueue({ type: 'finish' });
    source.close();

    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalled();
    });
    expect(onFinish.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('replays cached chunks when reconnecting to an active run', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: 'assistant-1', type: 'start' });

    await vi.waitFor(() => {
      expect(manager.subscribeActiveRun('project-1', 'conversation-1')).toBeDefined();
    });

    const replay = manager.subscribeActiveRun('project-1', 'conversation-1');
    expect(replay).toBeDefined();

    const reader = replay!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await reader.cancel();
  });

  it('returns an active run snapshot with latest messages and next chunk index', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    source.enqueue({ id: 'text-1', type: 'text-start' });
    source.enqueue({ delta: '完成', id: 'text-1', type: 'text-delta' });
    source.enqueue({ id: 'text-1', type: 'text-end' });

    await vi.waitFor(() => {
      const snapshot = manager.getActiveRunSnapshot('project-1', 'conversation-1');

      expect(snapshot?.activeRun.chunkCount).toBe(4);
      expect(snapshot?.nextChunkIndex).toBe(4);
      expect(snapshot?.messages).toHaveLength(2);
    });
  });

  it('returns a resumable snapshot before an active tool input stream', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    source.enqueue({
      toolCallId: 'call-1',
      toolName: 'write',
      type: 'tool-input-start',
    });
    source.enqueue({
      inputTextDelta: '{"path"',
      toolCallId: 'call-1',
      type: 'tool-input-delta',
    });

    await vi.waitFor(() => {
      expect(manager.getActiveRun('project-1')?.chunkCount).toBe(3);
    });

    const snapshot = manager.getActiveRunSnapshot('project-1', 'conversation-1');

    expect(snapshot?.nextChunkIndex).toBe(0);
    expect(snapshot?.messages).toHaveLength(1);

    const replay = manager.subscribeActiveRun(
      'project-1',
      'conversation-1',
      snapshot?.nextChunkIndex,
    );
    expect(replay).toBeDefined();

    const reader = replay!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        toolCallId: 'call-1',
        toolName: 'write',
        type: 'tool-input-start',
      },
    });
    await reader.cancel();
  });

  it('sanitizes live and replayed chunks for frontend subscribers', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    source.enqueue({ id: 'reasoning-1', type: 'reasoning-start' });
    source.enqueue({
      delta: 'private thought',
      id: 'reasoning-1',
      type: 'reasoning-delta',
    });
    source.enqueue({ id: 'reasoning-1', type: 'reasoning-end' });
    source.enqueue({
      toolCallId: 'call-1',
      toolName: 'edit',
      type: 'tool-input-start',
    });
    source.enqueue({
      inputTextDelta: '{"path":"index.html","replace":"secret"}',
      toolCallId: 'call-1',
      type: 'tool-input-delta',
    });
    source.enqueue({
      input: { path: 'index.html', replace: 'secret' },
      toolCallId: 'call-1',
      toolName: 'edit',
      type: 'tool-input-available',
    });
    source.enqueue({
      output: { path: 'index.html', content: 'secret output' },
      toolCallId: 'call-1',
      type: 'tool-output-available',
    });
    source.enqueue({
      output: { error: 'secret failure', ok: false, wallTimeMs: 1 },
      toolCallId: 'call-2',
      type: 'tool-output-available',
    });

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: 'reasoning-1', type: 'reasoning-start' },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: 'reasoning-1', type: 'reasoning-end' },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        toolCallId: 'call-1',
        toolName: 'edit',
        type: 'tool-input-start',
      },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        input: { path: 'index.html' },
        toolCallId: 'call-1',
        toolName: 'edit',
        type: 'tool-input-available',
      },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        output: { path: 'index.html' },
        toolCallId: 'call-1',
        type: 'tool-output-available',
      },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: {
        output: { ok: false },
        toolCallId: 'call-2',
        type: 'tool-output-available',
      },
    });
    await reader.cancel();

    const replay = manager.subscribeActiveRun('project-1', 'conversation-1');
    expect(replay).toBeDefined();

    const replayReader = replay!.getReader();
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: { id: 'reasoning-1', type: 'reasoning-start' },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: { id: 'reasoning-1', type: 'reasoning-end' },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: {
        toolCallId: 'call-1',
        toolName: 'edit',
        type: 'tool-input-start',
      },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: {
        input: { path: 'index.html' },
        toolCallId: 'call-1',
        toolName: 'edit',
        type: 'tool-input-available',
      },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: {
        output: { path: 'index.html' },
        toolCallId: 'call-1',
        type: 'tool-output-available',
      },
    });
    await expect(replayReader.read()).resolves.toEqual({
      done: false,
      value: {
        output: { ok: false },
        toolCallId: 'call-2',
        type: 'tool-output-available',
      },
    });
    await replayReader.cancel();
  });

  it('emits sanitized chunks that still match the AI SDK stream schema', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    source.enqueue({ id: 'reasoning-1', type: 'reasoning-start' });
    source.enqueue({ id: 'reasoning-1', type: 'reasoning-end' });
    source.enqueue({
      input: { path: 'index.html', secret: true },
      toolCallId: 'call-1',
      toolName: 'edit',
      type: 'tool-input-available',
    });
    source.enqueue({
      errorText: 'private input error',
      input: { path: 'broken.html', secret: true },
      toolCallId: 'call-2',
      toolName: 'read',
      type: 'tool-input-error',
    });
    source.enqueue({
      output: { path: 'index.html', secret: true },
      toolCallId: 'call-1',
      type: 'tool-output-available',
    });
    source.enqueue({
      errorText: 'private output error',
      toolCallId: 'call-3',
      type: 'tool-output-error',
    });
    source.enqueue({
      toolCallId: 'call-4',
      type: 'tool-output-denied',
    });

    for (let index = 0; index < 7; index += 1) {
      const result = await reader.read();

      expect(result.done).toBe(false);
      await expect(uiMessageChunkSchema().validate?.(result.value)).resolves.toEqual({
        success: true,
        value: result.value,
      });
    }

    await reader.cancel();
  });

  it('sanitizes active run snapshots while keeping internal messages complete', async () => {
    const manager = new ChatRunManager();
    const initialMessages: UIMessage[] = [
      ...createUserMessages(),
      {
        id: 'assistant-1',
        parts: [
          { text: 'secret thought', type: 'reasoning' },
          {
            input: { path: 'index.html', replace: 'secret input' },
            output: { content: 'secret output', path: 'index.html' },
            state: 'output-available',
            toolCallId: 'call-1',
            type: 'tool-edit',
          },
        ],
        role: 'assistant',
      },
    ];
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages,
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);

    const snapshot = manager.getActiveRunSnapshot('project-1', 'conversation-1');

    expect(snapshot?.messages.at(1)?.parts).toEqual([
      {
        input: { path: 'index.html' },
        output: { path: 'index.html' },
        state: 'output-available',
        toolCallId: 'call-1',
        type: 'tool-edit',
      },
    ]);
  });

  it('replays only chunks after the requested chunk index', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    source.enqueue({ id: 'text-1', type: 'text-start' });

    await vi.waitFor(() => {
      expect(manager.getActiveRun('project-1')?.chunkCount).toBe(2);
    });

    const replay = manager.subscribeActiveRun('project-1', 'conversation-1', 1);
    expect(replay).toBeDefined();

    const reader = replay!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: 'text-1', type: 'text-start' },
    });
    await reader.cancel();
  });

  it('waits for live chunks when the requested chunk index is beyond the cache', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);

    const stream = manager.subscribeActiveRun('project-1', 'conversation-1', 10);
    expect(stream).toBeDefined();

    const reader = stream!.getReader();
    const readPromise = reader.read();

    source.enqueue({ messageId: 'assistant-1', type: 'start' });

    await expect(readPromise).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await reader.cancel();
  });

  it('batches live subscriber chunks without merging the run cache', async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    const firstRead = reader.read();

    await delay(0);
    source.enqueue({ messageId: 'assistant-1', type: 'start' });
    source.enqueue({ id: 'text-1', type: 'text-start' });

    let resolvedBeforeFlush = false;
    firstRead.then(() => {
      resolvedBeforeFlush = true;
    });
    await delay(50);
    expect(manager.getActiveRun('project-1')?.chunkCount).toBe(2);
    expect(resolvedBeforeFlush).toBe(false);

    await expect(firstRead).resolves.toEqual({
      done: false,
      value: { messageId: 'assistant-1', type: 'start' },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: 'text-1', type: 'text-start' },
    });
    await reader.cancel();
  });

  it('cancels the active run and releases the project lock', async () => {
    const manager = new ChatRunManager();
    const onFinish = vi.fn();
    const result = manager.startRun({
      conversationId: 'conversation-1',
      createStream: (signal) => createAbortableStream(signal),
      initialMessages: createUserMessages(),
      onFinish,
      projectId: 'project-1',
    });

    expect(result.ok).toBe(true);
    expect(manager.cancelActiveRun('project-1')?.status).toBe('cancelled');

    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalledWith(expect.any(Array), 'cancelled');
    });

    const next = manager.startRun({
      conversationId: 'conversation-2',
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: 'project-1',
    });
    expect(next.ok).toBe(true);
  });
});

function createUserMessages(): UIMessage[] {
  return [
    {
      id: 'user-1',
      parts: [{ text: '生成页面', type: 'text' }],
      role: 'user',
    },
  ];
}

function createPendingStream() {
  return new ReadableStream<UIMessageChunk>();
}

function createControlledStream() {
  let controller: ReadableStreamDefaultController<UIMessageChunk>;
  const stream = new ReadableStream<UIMessageChunk>({
    start: (nextController) => {
      controller = nextController;
    },
  });

  return {
    close: () => controller.close(),
    enqueue: (chunk: UIMessageChunk) => controller.enqueue(chunk),
    stream,
  };
}

function createAbortableStream(signal: AbortSignal) {
  return new Promise<ReadableStream<UIMessageChunk>>((resolve) => {
    let controller: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({
      start: (nextController) => {
        controller = nextController;
        signal.addEventListener(
          'abort',
          () => {
            controller.close();
          },
          { once: true },
        );
      },
    });
    resolve(stream);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
