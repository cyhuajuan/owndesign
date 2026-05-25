import { describe, expect, it, vi } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";

import { ChatRunManager } from "./chat-run-manager";

describe("ChatRunManager", () => {
  it("rejects a second active run for the same project", () => {
    const manager = new ChatRunManager();
    const first = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });
    const second = manager.startRun({
      conversationId: "conversation-2",
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("allows runs for different projects", () => {
    const manager = new ChatRunManager();
    const first = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });
    const second = manager.startRun({
      conversationId: "conversation-2",
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-2",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("keeps a run alive after the initial subscriber disconnects", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const onFinish = vi.fn();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish,
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    source.enqueue({ messageId: "assistant-1", type: "start" });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: "assistant-1", type: "start" },
    });
    await reader.cancel();

    source.enqueue({ id: "text-1", type: "text-start" });
    source.enqueue({ delta: "完成", id: "text-1", type: "text-delta" });
    source.enqueue({ id: "text-1", type: "text-end" });
    source.enqueue({ type: "finish" });
    source.close();

    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalled();
    });
    expect(onFinish.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("replays cached chunks when reconnecting to an active run", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: "assistant-1", type: "start" });

    await vi.waitFor(() => {
      expect(
        manager.subscribeActiveRun("project-1", "conversation-1"),
      ).toBeDefined();
    });

    const replay = manager.subscribeActiveRun("project-1", "conversation-1");
    expect(replay).toBeDefined();

    const reader = replay!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { messageId: "assistant-1", type: "start" },
    });
    await reader.cancel();
  });

  it("returns an active run snapshot with latest messages and next chunk index", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: "assistant-1", type: "start" });
    source.enqueue({ id: "text-1", type: "text-start" });
    source.enqueue({ delta: "完成", id: "text-1", type: "text-delta" });
    source.enqueue({ id: "text-1", type: "text-end" });

    await vi.waitFor(() => {
      const snapshot = manager.getActiveRunSnapshot(
        "project-1",
        "conversation-1",
      );

      expect(snapshot?.activeRun.chunkCount).toBe(4);
      expect(snapshot?.nextChunkIndex).toBe(4);
      expect(snapshot?.messages).toHaveLength(2);
    });
  });

  it("replays only chunks after the requested chunk index", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    source.enqueue({ messageId: "assistant-1", type: "start" });
    source.enqueue({ id: "text-1", type: "text-start" });

    await vi.waitFor(() => {
      expect(
        manager.getActiveRunSnapshot("project-1", "conversation-1")
          ?.nextChunkIndex,
      ).toBe(2);
    });

    const replay = manager.subscribeActiveRun("project-1", "conversation-1", 1);
    expect(replay).toBeDefined();

    const reader = replay!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: "text-1", type: "text-start" },
    });
    await reader.cancel();
  });

  it("waits for live chunks when the requested chunk index is beyond the cache", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);

    const stream = manager.subscribeActiveRun("project-1", "conversation-1", 10);
    expect(stream).toBeDefined();

    const reader = stream!.getReader();
    const readPromise = reader.read();

    source.enqueue({ messageId: "assistant-1", type: "start" });

    await expect(readPromise).resolves.toEqual({
      done: false,
      value: { messageId: "assistant-1", type: "start" },
    });
    await reader.cancel();
  });

  it("batches live subscriber chunks without merging the run cache", async () => {
    const manager = new ChatRunManager();
    const source = createControlledStream();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: () => Promise.resolve(source.stream),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const reader = result.stream.getReader();
    const firstRead = reader.read();

    await delay(0);
    source.enqueue({ messageId: "assistant-1", type: "start" });
    source.enqueue({ id: "text-1", type: "text-start" });

    let resolvedBeforeFlush = false;
    firstRead.then(() => {
      resolvedBeforeFlush = true;
    });
    await delay(50);
    expect(manager.getActiveRun("project-1")?.chunkCount).toBe(2);
    expect(resolvedBeforeFlush).toBe(false);

    await expect(firstRead).resolves.toEqual({
      done: false,
      value: { messageId: "assistant-1", type: "start" },
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { id: "text-1", type: "text-start" },
    });
    await reader.cancel();
  });

  it("cancels the active run and releases the project lock", async () => {
    const manager = new ChatRunManager();
    const onFinish = vi.fn();
    const result = manager.startRun({
      conversationId: "conversation-1",
      createStream: (signal) => createAbortableStream(signal),
      initialMessages: createUserMessages(),
      onFinish,
      projectId: "project-1",
    });

    expect(result.ok).toBe(true);
    expect(manager.cancelActiveRun("project-1")?.status).toBe("cancelled");

    await vi.waitFor(() => {
      expect(onFinish).toHaveBeenCalledWith(expect.any(Array), "cancelled");
    });

    const next = manager.startRun({
      conversationId: "conversation-2",
      createStream: () => Promise.resolve(createPendingStream()),
      initialMessages: createUserMessages(),
      onFinish: vi.fn(),
      projectId: "project-1",
    });
    expect(next.ok).toBe(true);
  });
});

function createUserMessages(): UIMessage[] {
  return [
    {
      id: "user-1",
      parts: [{ text: "生成页面", type: "text" }],
      role: "user",
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
          "abort",
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
