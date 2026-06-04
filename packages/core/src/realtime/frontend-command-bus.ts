import type {
  FrontendCapabilityId,
  FrontendCapabilityPayloads,
  FrontendCommand,
} from './frontend-capabilities';

const KEEPALIVE_INTERVAL_MS = 15_000;

type FrontendCommandConnection = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  keepaliveTimer: ReturnType<typeof setInterval>;
};

type RegisterFrontendConnectionInput = {
  frontendTabId: string;
  projectId: string;
  signal?: AbortSignal;
};

type SendFrontendCommandInput<Capability extends FrontendCapabilityId> = {
  capability: Capability;
  frontendTabId: string;
  payload: FrontendCapabilityPayloads[Capability];
  projectId: string;
};

declare global {
  var __owndesignFrontendCommandBus: FrontendCommandBus | undefined;
}

export class FrontendCommandBus {
  private readonly connections = new Map<string, FrontendCommandConnection>();

  registerConnection({ frontendTabId, projectId, signal }: RegisterFrontendConnectionInput) {
    const key = buildConnectionKey(projectId, frontendTabId);
    const encoder = new TextEncoder();
    let connection: FrontendCommandConnection | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.unregisterConnection(projectId, frontendTabId);

        connection = {
          controller,
          encoder,
          keepaliveTimer: setInterval(() => {
            enqueueSseComment(controller, encoder, 'keepalive');
          }, KEEPALIVE_INTERVAL_MS),
        };
        connection.keepaliveTimer.unref?.();
        this.connections.set(key, connection);
        enqueueSseComment(controller, encoder, 'connected');

        signal?.addEventListener(
          'abort',
          () => {
            this.unregisterConnection(projectId, frontendTabId);
          },
          { once: true },
        );
      },
      cancel: () => {
        this.unregisterConnection(projectId, frontendTabId);
      },
    });

    return stream;
  }

  sendCommand<Capability extends FrontendCapabilityId>({
    capability,
    frontendTabId,
    payload,
    projectId,
  }: SendFrontendCommandInput<Capability>) {
    const connection = this.connections.get(buildConnectionKey(projectId, frontendTabId));

    if (!connection) {
      return {
        delivered: false as const,
        command: undefined,
      };
    }

    const command: FrontendCommand = {
      capability,
      id: createCommandId(),
      payload,
    } as FrontendCommand;

    enqueueSseEvent(connection.controller, connection.encoder, 'frontend-command', command);

    return {
      command,
      delivered: true as const,
    };
  }

  unregisterConnection(projectId: string, frontendTabId: string) {
    const key = buildConnectionKey(projectId, frontendTabId);
    const connection = this.connections.get(key);

    if (!connection) {
      return;
    }

    this.connections.delete(key);
    clearInterval(connection.keepaliveTimer);

    try {
      connection.controller.close();
    } catch {
      // Already closed by the stream consumer.
    }
  }

  hasConnection(projectId: string, frontendTabId: string) {
    return this.connections.has(buildConnectionKey(projectId, frontendTabId));
  }

  clear() {
    for (const key of Array.from(this.connections.keys())) {
      const [projectId, frontendTabId] = parseConnectionKey(key);
      this.unregisterConnection(projectId, frontendTabId);
    }
  }
}

export function getFrontendCommandBus() {
  globalThis.__owndesignFrontendCommandBus ??= new FrontendCommandBus();

  return globalThis.__owndesignFrontendCommandBus;
}

export function registerFrontendConnection(input: RegisterFrontendConnectionInput) {
  return getFrontendCommandBus().registerConnection(input);
}

export function sendFrontendCommand<Capability extends FrontendCapabilityId>(
  input: SendFrontendCommandInput<Capability>,
) {
  return getFrontendCommandBus().sendCommand(input);
}

function enqueueSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function enqueueSseComment(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  comment: string,
) {
  controller.enqueue(encoder.encode(`: ${comment}\n\n`));
}

function buildConnectionKey(projectId: string, frontendTabId: string) {
  return `${encodeURIComponent(projectId)}:${encodeURIComponent(frontendTabId)}`;
}

function parseConnectionKey(key: string) {
  const [projectId = '', frontendTabId = ''] = key.split(':');

  return [decodeURIComponent(projectId), decodeURIComponent(frontendTabId)] as const;
}

function createCommandId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
