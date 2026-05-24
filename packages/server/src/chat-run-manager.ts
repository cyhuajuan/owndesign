import {
  createUIMessageStreamResponse,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

export type ChatRunStatus = "running" | "completed" | "failed" | "cancelled";

export type ChatRunSummary = {
  conversationId: string;
  createdAt: string;
  projectId: string;
  runId: string;
  status: ChatRunStatus;
};

type ChatRun = ChatRunSummary & {
  abortController: AbortController;
  chunks: UIMessageChunk[];
  completedAt?: string;
  initialMessages: UIMessage[];
  latestMessages: UIMessage[];
  subscribers: Set<ReadableStreamDefaultController<UIMessageChunk>>;
};

type StartChatRunInput = {
  conversationId: string;
  createStream: (signal: AbortSignal) => Promise<ReadableStream<UIMessageChunk>>;
  initialMessages: UIMessage[];
  onFinish: (messages: UIMessage[], status: ChatRunStatus) => Promise<void>;
  projectId: string;
};

type StartChatRunResult =
  | {
      ok: true;
      run: ChatRunSummary;
      stream: ReadableStream<UIMessageChunk>;
    }
  | {
      activeRun: ChatRunSummary;
      ok: false;
    };

declare global {
  var __owndesignChatRunManagers:
    | Map<string, ChatRunManager>
    | undefined;
}

export class ChatRunManager {
  private readonly activeRunsByProjectId = new Map<string, ChatRun>();

  startRun(input: StartChatRunInput): StartChatRunResult {
    const activeRun = this.activeRunsByProjectId.get(input.projectId);

    if (activeRun?.status === "running") {
      return {
        activeRun: summarizeRun(activeRun),
        ok: false,
      };
    }

    const run: ChatRun = {
      abortController: new AbortController(),
      chunks: [],
      conversationId: input.conversationId,
      createdAt: new Date().toISOString(),
      initialMessages: input.initialMessages,
      latestMessages: input.initialMessages,
      projectId: input.projectId,
      runId: createRunId(),
      status: "running",
      subscribers: new Set(),
    };

    this.activeRunsByProjectId.set(input.projectId, run);
    void this.executeRun(run, input);

    return {
      ok: true,
      run: summarizeRun(run),
      stream: this.subscribe(run),
    };
  }

  getActiveRun(projectId: string) {
    const run = this.activeRunsByProjectId.get(projectId);

    return run?.status === "running" ? summarizeRun(run) : undefined;
  }

  subscribeActiveRun(projectId: string, conversationId: string) {
    const run = this.activeRunsByProjectId.get(projectId);

    if (!run || run.status !== "running" || run.conversationId !== conversationId) {
      return undefined;
    }

    return this.subscribe(run);
  }

  cancelActiveRun(projectId: string) {
    const run = this.activeRunsByProjectId.get(projectId);

    if (!run || run.status !== "running") {
      return undefined;
    }

    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    run.abortController.abort("cancelled");
    this.publish(run, { type: "abort", reason: "cancelled" });
    this.closeSubscribers(run);

    return summarizeRun(run);
  }

  clear() {
    for (const run of this.activeRunsByProjectId.values()) {
      if (run.status === "running") {
        run.abortController.abort("cleared");
      }
      this.closeSubscribers(run);
    }
    this.activeRunsByProjectId.clear();
  }

  private async executeRun(run: ChatRun, input: StartChatRunInput) {
    try {
      const stream = await input.createStream(run.abortController.signal);
      const [messageStream, broadcastStream] = stream.tee();
      const messagesPromise = this.trackMessages(run, messageStream);
      const reader = broadcastStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          this.publish(run, value);
        }
      } finally {
        reader.releaseLock();
      }

      await messagesPromise;

      if (run.status === "running") {
        run.status = "completed";
      }
    } catch (error) {
      if (run.status === "cancelled") {
        // Explicit cancellation is handled by cancelActiveRun.
      } else {
        run.status = "failed";
        this.publish(run, {
          errorText:
            error instanceof Error ? error.message : "生成失败：Unknown error",
          type: "error",
        });
      }
    } finally {
      run.completedAt = run.completedAt ?? new Date().toISOString();

      try {
        await input.onFinish(run.latestMessages, run.status);
      } finally {
        this.closeSubscribers(run);
        if (this.activeRunsByProjectId.get(run.projectId) === run) {
          this.activeRunsByProjectId.delete(run.projectId);
        }
      }
    }
  }

  private async trackMessages(
    run: ChatRun,
    stream: ReadableStream<UIMessageChunk>,
  ) {
    for await (const responseMessage of readUIMessageStream({
      message: getLastAssistantMessage(run.initialMessages),
      stream,
    })) {
      run.latestMessages = mergeResponseMessage(
        run.initialMessages,
        responseMessage,
      );
    }
  }

  private subscribe(run: ChatRun) {
    let controllerRef:
      | ReadableStreamDefaultController<UIMessageChunk>
      | undefined;

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        controllerRef = controller;

        for (const chunk of run.chunks) {
          controller.enqueue(chunk);
        }

        if (run.status === "running") {
          run.subscribers.add(controller);
        } else {
          controller.close();
        }
      },
      cancel: () => {
        if (controllerRef) {
          run.subscribers.delete(controllerRef);
        }
      },
    });
  }

  private publish(run: ChatRun, chunk: UIMessageChunk) {
    run.chunks.push(chunk);

    for (const subscriber of Array.from(run.subscribers)) {
      try {
        subscriber.enqueue(chunk);
      } catch {
        run.subscribers.delete(subscriber);
      }
    }
  }

  private closeSubscribers(run: ChatRun) {
    for (const subscriber of Array.from(run.subscribers)) {
      try {
        subscriber.close();
      } catch {
        // Subscriber already disconnected.
      }
    }
    run.subscribers.clear();
  }
}

export function getChatRunManager(key = "default") {
  globalThis.__owndesignChatRunManagers ??= new Map();

  const existing = globalThis.__owndesignChatRunManagers.get(key);
  if (existing) {
    return existing;
  }

  const manager = new ChatRunManager();
  globalThis.__owndesignChatRunManagers.set(key, manager);

  return manager;
}

export function createChatRunStreamResponse(
  stream: ReadableStream<UIMessageChunk>,
) {
  return createUIMessageStreamResponse({ stream });
}

function summarizeRun(run: ChatRun): ChatRunSummary {
  return {
    conversationId: run.conversationId,
    createdAt: run.createdAt,
    projectId: run.projectId,
    runId: run.runId,
    status: run.status,
  };
}

function createRunId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getLastAssistantMessage(messages: UIMessage[]) {
  const lastMessage = messages.at(-1);

  return lastMessage?.role === "assistant" ? lastMessage : undefined;
}

function mergeResponseMessage(
  messages: UIMessage[],
  responseMessage: UIMessage,
) {
  const lastMessage = messages.at(-1);

  if (lastMessage?.role === "assistant" && lastMessage.id === responseMessage.id) {
    return [...messages.slice(0, -1), responseMessage];
  }

  return [...messages, responseMessage];
}
