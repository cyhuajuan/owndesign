import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageParts, StreamingConversationPanel } from './streaming-conversation-panel';
import { setCurrentPreviewPath } from '@/features/preview/preview-path';

function getProjectOutputUpdatedEvents(dispatchEventSpy: ReturnType<typeof vi.spyOn>) {
  return dispatchEventSpy.mock.calls.filter(
    ([event]: [Event]) => event.type === 'owndesign:project-output-updated',
  );
}

type TestTransport = {
  api: string;
  prepareReconnectToStreamRequest?: () => { api: string };
  prepareSendMessagesRequest?: (options: {
    api: string;
    body?: Record<string, unknown>;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
    id: string;
    messageId?: string;
    messages: UIMessage[];
    requestMetadata?: unknown;
    trigger: 'submit-message' | 'regenerate-message';
  }) => {
    api?: string;
    body: object;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
  };
};

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(),
}));

vi.mock('@/features/preview/components/frontend-capability-bridge', () => ({
  FRONTEND_TAB_ID: 'tab-1',
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');

  class MockDefaultChatTransport {
    api: string;
    body?: Record<string, unknown> | (() => Record<string, unknown>);
    prepareSendMessagesRequest?: (options: {
      api: string;
      body?: Record<string, unknown>;
      credentials?: RequestCredentials;
      headers?: HeadersInit;
      id: string;
      messageId?: string;
      messages: unknown[];
      requestMetadata?: unknown;
      trigger: 'submit-message' | 'regenerate-message';
    }) => {
      api?: string;
      body: object;
      credentials?: RequestCredentials;
      headers?: HeadersInit;
    };
    prepareReconnectToStreamRequest?: () => { api: string };

    constructor(options: {
      api: string;
      body?: Record<string, unknown> | (() => Record<string, unknown>);
      prepareSendMessagesRequest?: (options: {
        api: string;
        body?: Record<string, unknown>;
        credentials?: RequestCredentials;
        headers?: HeadersInit;
        id: string;
        messageId?: string;
        messages: unknown[];
        requestMetadata?: unknown;
        trigger: 'submit-message' | 'regenerate-message';
      }) => {
        api?: string;
        body: object;
        credentials?: RequestCredentials;
        headers?: HeadersInit;
      };
      prepareReconnectToStreamRequest?: () => { api: string };
    }) {
      this.api = options.api;
      this.body = options.body;
      this.prepareSendMessagesRequest = options.prepareSendMessagesRequest;
      this.prepareReconnectToStreamRequest = options.prepareReconnectToStreamRequest;
    }
  }

  return {
    ...actual,
    DefaultChatTransport: MockDefaultChatTransport,
    getToolName: (part: { toolName?: string; type: string }) =>
      part.type === 'dynamic-tool' ? part.toolName : part.type.replace(/^tool-/, ''),
    isToolUIPart: (part: unknown) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof part.type === 'string' &&
      (part.type.startsWith('tool-') || part.type === 'dynamic-tool'),
  };
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  setCurrentPreviewPath(undefined);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/checkpoints')) {
        return Response.json([]);
      }

      return Response.json({
        defaultModelId: 'model-1',
        interfaceLanguage: 'zh-CN',
        modelConfigurations: [
          {
            apiKey: '',
            baseUrl: '',
            contextSizeK: 1000,
            hasApiKey: true,
            id: 'model-1',
            model: 'deepseek-v4-flash',
            provider: 'deepseek',
          },
        ],
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useChat).mockReset();
  vi.unstubAllGlobals();
});

function stubOpenAICompatibleSettings() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/checkpoints')) {
        return Response.json([]);
      }

      return Response.json({
        defaultModelId: 'model-1',
        interfaceLanguage: 'zh-CN',
        modelConfigurations: [
          {
            apiKey: '',
            baseUrl: 'https://example.test/v1',
            contextSizeK: 200,
            hasApiKey: true,
            id: 'model-1',
            model: 'gpt-4o',
            provider: 'openai-compatible',
          },
        ],
      });
    }),
  );
}

function stubAnthropicSettings() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/checkpoints')) {
        return Response.json([]);
      }

      return Response.json({
        defaultModelId: 'model-anthropic',
        interfaceLanguage: 'zh-CN',
        modelConfigurations: [
          {
            apiKey: '',
            baseUrl: '',
            contextSizeK: 200,
            hasApiKey: true,
            id: 'model-anthropic',
            model: 'claude-sonnet-4-5',
            provider: 'anthropic',
          },
        ],
      });
    }),
  );
}

function prepareChatRequestBody(
  transport: TestTransport | undefined,
  messages: UIMessage[] = [
    {
      id: 'user-1',
      parts: [{ text: '生成页面', type: 'text' }],
      role: 'user',
    },
  ],
  body: Record<string, unknown> = {},
) {
  const prepared = transport?.prepareSendMessagesRequest?.({
    api: transport.api,
    body,
    id: 'conversation-1',
    messageId: undefined,
    messages,
    trigger: 'submit-message',
  });

  return prepared?.body as Record<string, unknown>;
}

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    parts: [{ text, type: 'text' }],
    role: 'user',
  };
}

describe('MessageParts', () => {
  it('hides completed reasoning parts', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'done',
              text: '需要先判断信息架构。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.queryByText('需要先判断信息架构。')).not.toBeInTheDocument();
  });

  it('shows only a pending label for streaming reasoning', () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'streaming',
              text: '需要先判断信息架构。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('需要先判断信息架构。')).not.toBeInTheDocument();
  });

  it('does not show reasoning content while streaming', () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'streaming',
              text: '还在分析布局。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('还在分析布局。')).not.toBeInTheDocument();
  });

  it('renders the streaming assistant text part without markdown parsing', () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: 'assistant-1',
          parts: [{ text: '第一行\n第二行', type: 'text' }],
          role: 'assistant',
        }}
      />,
    );

    const streamingText = container.querySelector('[data-streaming-text="true"]');

    expect(streamingText?.textContent).toBe('第一行\n第二行');
    expect(streamingText).toHaveClass('whitespace-pre-wrap');
  });

  it('uses full markdown rendering after assistant streaming finishes', () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming={false}
        message={{
          id: 'assistant-1',
          parts: [{ text: '**完成**', type: 'text' }],
          role: 'assistant',
        }}
      />,
    );

    expect(container.querySelector('[data-streaming-text="true"]')).not.toBeInTheDocument();
  });

  it('renders user text without markdown parsing', () => {
    const { container } = render(
      <MessageParts
        message={{
          id: 'user-1',
          parts: [{ text: '**不要加粗**\n`code`', type: 'text' }],
          role: 'user',
        }}
      />,
    );

    expect(container.textContent).toBe('**不要加粗**\n`code`');
    expect(container.querySelector('strong')).not.toBeInTheDocument();
    expect(container.querySelector('code')).not.toBeInTheDocument();
  });

  it('renders original user prompts without markdown parsing', () => {
    const { container } = render(
      <MessageParts
        message={{
          id: 'user-1',
          metadata: {
            originalUserPrompt: '**原始输入**',
          },
          parts: [{ text: '改写后的输入', type: 'text' }],
          role: 'user',
        }}
      />,
    );

    expect(screen.getByText('**原始输入**')).toBeInTheDocument();
    expect(screen.queryByText('改写后的输入')).not.toBeInTheDocument();
    expect(container.querySelector('strong')).not.toBeInTheDocument();
  });

  it('does not render streaming reasoning text', () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'streaming',
              text: '分析中\n继续分析',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    const streamingText = container.querySelector('[data-streaming-text="true"]');

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(streamingText).not.toBeInTheDocument();
    expect(screen.queryByText('分析中\n继续分析')).not.toBeInTheDocument();
  });

  it('hides reasoning indicator after streaming finishes', () => {
    const message = {
      id: 'assistant-1',
      parts: [
        {
          state: 'streaming' as const,
          text: '还在分析布局。',
          type: 'reasoning' as const,
        },
      ],
      role: 'assistant' as const,
    };

    const { rerender } = render(<MessageParts isLastMessage isStreaming message={message} />);

    expect(screen.getByText('正在思考')).toBeInTheDocument();

    rerender(<MessageParts isLastMessage isStreaming={false} message={message} />);

    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
  });

  it('shows only the latest streaming reasoning indicator', () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'done',
              text: '第一段思考已完成。',
              type: 'reasoning',
            },
            {
              state: 'streaming',
              text: '第二段思考还在输出。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getAllByText('正在思考')).toHaveLength(1);
    expect(screen.queryByText('第一段思考已完成。')).not.toBeInTheDocument();
    expect(screen.queryByText('第二段思考还在输出。')).not.toBeInTheDocument();
  });

  it('hides multiple completed reasoning parts', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              state: 'done',
              text: '第一步：判断信息架构。',
              type: 'reasoning',
            },
            {
              state: 'done',
              text: '第二步：组织首屏层级。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('第一步：判断信息架构。')).not.toBeInTheDocument();
    expect(screen.queryByText('第二步：组织首屏层级。')).not.toBeInTheDocument();
  });

  it('renders a simple completed edit tool description', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'index.html', search: 'old', replace: 'new' },
              output: { path: 'index.html', replacements: 1 },
              state: 'output-available',
              toolCallId: 'call-1',
              type: 'tool-edit',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('已更新页面内容')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('参数')).not.toBeInTheDocument();
    expect(screen.queryByText('结果')).not.toBeInTheDocument();
    expect(screen.queryByText('old')).not.toBeInTheDocument();
    expect(screen.queryByText('new')).not.toBeInTheDocument();
  });

  it('renders a simple running edit tool description', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'index.html', search: 'old', replace: 'new' },
              state: 'input-available',
              toolCallId: 'call-1',
              type: 'tool-edit',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('正在更新页面内容')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('参数')).not.toBeInTheDocument();
  });

  it('renders simple read tool descriptions without output content', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'pending.html' },
              state: 'input-available',
              toolCallId: 'call-1',
              type: 'tool-read',
            },
            {
              input: { path: 'done.html' },
              output: { content: 'Secret Detail', path: 'done.html' },
              state: 'output-available',
              toolCallId: 'call-2',
              type: 'tool-read',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('正在读取项目文件：pending.html')).toBeInTheDocument();
    expect(screen.getByText('已读取项目文件：done.html')).toBeInTheDocument();
    expect(screen.queryByText('Secret Detail')).not.toBeInTheDocument();
    expect(screen.queryByText('参数')).not.toBeInTheDocument();
    expect(screen.queryByText('结果')).not.toBeInTheDocument();
  });

  it('renders preview update tools without a file fallback suffix', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: {},
              output: {},
              state: 'output-available',
              toolCallId: 'call-1',
              type: 'tool-previewRefresh',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('已刷新预览')).toBeInTheDocument();
    expect(screen.queryByText('已刷新预览文件')).not.toBeInTheDocument();
  });

  it('renders simple tool error descriptions without error details', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              errorText: '权限不足',
              input: { path: 'index.html' },
              output: undefined,
              state: 'output-error',
              toolCallId: 'call-1',
              type: 'tool-write',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('重写页面文件失败')).toBeInTheDocument();
    expect(screen.queryByText('权限不足')).not.toBeInTheDocument();
    expect(screen.queryByText('错误')).not.toBeInTheDocument();
  });

  it('renders failed workspace tool results as failures', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'index.html' },
              output: { ok: false },
              state: 'output-available',
              toolCallId: 'call-1',
              type: 'tool-write',
            },
            {
              input: { path: 'missing.txt' },
              output: { ok: false },
              state: 'output-available',
              toolCallId: 'call-2',
              type: 'tool-read',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('重写页面文件失败')).toBeInTheDocument();
    expect(screen.getByText('读取项目文件失败：missing.txt')).toBeInTheDocument();
    expect(screen.queryByText('已重写页面文件：index.html')).not.toBeInTheDocument();
    expect(screen.queryByText('已读取项目文件：missing.txt')).not.toBeInTheDocument();
  });

  it('uses sanitized output paths before tool input paths', () => {
    render(
      <MessageParts
        message={{
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'index.html' },
              output: { ok: true, path: 'index.copy.html' },
              state: 'output-available',
              toolCallId: 'call-1',
              type: 'tool-read',
            },
          ],
          role: 'assistant',
        }}
      />,
    );

    expect(screen.getByText('已读取项目文件：index.copy.html')).toBeInTheDocument();
    expect(screen.queryByText('已读取页面内容：index.html')).not.toBeInTheDocument();
  });

  it('does not dispatch preview refresh after mutation tool output completes', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    vi.mocked(useChat).mockReturnValue({
      error: undefined,
      messages: [
        {
          id: 'assistant-1',
          parts: [
            {
              input: { path: 'index.html' },
              output: { path: 'index.html', replacements: 1 },
              state: 'output-available',
              toolCallId: 'call-1',
              type: 'tool-edit',
            },
          ],
          role: 'assistant',
        },
      ],
      addToolApprovalResponse: vi.fn(),
      sendMessage: vi.fn(),
      status: 'ready',
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(getProjectOutputUpdatedEvents(dispatchEventSpy)).toHaveLength(0);
    dispatchEventSpy.mockRestore();
  });

  it('emits conversation update after generation completes', () => {
    const useChatMock = vi.mocked(useChat);
    const onConversationUpdate = vi.fn();

    useChatMock.mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: 'user-1',
          parts: [{ text: '设计一个 CRM 仪表盘', type: 'text' }],
          role: 'user',
        },
      ],
      sendMessage: vi.fn(),
      status: 'streaming',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    const { rerender } = render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        onConversationUpdate={onConversationUpdate}
        projectId="project-1"
      />,
    );

    expect(onConversationUpdate).not.toHaveBeenCalled();

    useChatMock.mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: 'user-1',
          parts: [{ text: '设计一个 CRM 仪表盘', type: 'text' }],
          role: 'user',
        },
        {
          id: 'assistant-1',
          parts: [{ text: '已完成。', type: 'text' }],
          role: 'assistant',
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    rerender(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        onConversationUpdate={onConversationUpdate}
        projectId="project-1"
      />,
    );

    expect(onConversationUpdate).toHaveBeenCalledTimes(1);
    expect(onConversationUpdate.mock.calls[0]?.[0]).toMatchObject({
      id: 'conversation-1',
      messages: [
        {
          id: 'user-1',
          parts: [{ text: '设计一个 CRM 仪表盘', type: 'text' }],
          role: 'user',
        },
        {
          id: 'assistant-1',
          parts: [{ text: '已完成。', type: 'text' }],
          role: 'assistant',
        },
      ],
      title: '设计一个 CRM 仪表盘',
    });
  });

  it('shows checkpoint restore actions for user messages with checkpoints', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(input);

      if (requestUrl.endsWith('/api/settings')) {
        return Response.json({
          defaultModelId: 'model-1',
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [
            {
              apiKey: '',
              baseUrl: '',
              contextSizeK: 1000,
              hasApiKey: true,
              id: 'model-1',
              model: 'deepseek-v4-flash',
              provider: 'deepseek',
            },
          ],
        });
      }

      if (requestUrl.endsWith('/api/projects/project-1/checkpoints') && !init) {
        return Response.json([
          {
            id: 'cp_1',
            conversationId: 'conversation-1',
            createdAt: '2026-06-09T10:00:00.000Z',
            files: ['index.html'],
            projectId: 'project-1',
            userMessageId: 'user-1',
            userPrompt: '设计首页',
          },
        ]);
      }

      if (requestUrl.endsWith('/api/projects/project-1/checkpoints/cp_1/restore')) {
        return Response.json({ href: '/projects/project-1/conversations/conversation-1' });
      }

      if (requestUrl.startsWith('/api/workspace')) {
        return Response.json({
          activeConversationId: 'conversation-1',
          conversations: [
            {
              id: 'conversation-1',
              createdAt: '2026-06-09T09:00:00.000Z',
              messages: [],
              projectId: 'project-1',
              title: '新建会话',
              updatedAt: '2026-06-09T10:01:00.000Z',
            },
          ],
          projects: [],
          settings: {},
        });
      }

      return Response.json([]);
    });
    const setMessages = vi.fn();
    const onConversationUpdate = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [createUserMessage('user-1', '设计首页')],
      sendMessage: vi.fn(),
      setMessages,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        onConversationUpdate={onConversationUpdate}
        projectId="project-1"
      />,
    );

    await user.click(await screen.findByRole('button', { name: '回退' }));
    await user.click(await screen.findByText('回退文件和对话'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/projects/project-1/checkpoints/cp_1/restore',
        expect.objectContaining({
          body: JSON.stringify({ mode: 'both' }),
          method: 'POST',
        }),
      ),
    );
    expect(setMessages).toHaveBeenCalledWith([]);
    expect(onConversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        messages: [],
        title: '新建会话',
      }),
    );
  });

  it('does not show checkpoint restore actions without a matching checkpoint', async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [createUserMessage('user-without-checkpoint', '设计首页')],
      sendMessage: vi.fn(),
      setMessages: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await waitFor(() => expect(screen.getByText('设计首页')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '回退' })).not.toBeInTheDocument();
  });

  it('shows only the last message reasoning indicator while chat streams', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: 'assistant-1',
          parts: [
            {
              state: 'streaming',
              text: '第一条思考不应因全局 streaming 显示。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        },
        {
          id: 'assistant-2',
          parts: [
            {
              state: 'streaming',
              text: '最后一条思考应显示。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        },
      ],
      sendMessage: vi.fn(),
      status: 'streaming',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.getAllByText('正在思考')).toHaveLength(1);
    expect(screen.queryByText('第一条思考不应因全局 streaming 显示。')).not.toBeInTheDocument();
    expect(screen.queryByText('最后一条思考应显示。')).not.toBeInTheDocument();
  });

  it('hides earlier reasoning when a later non-reasoning message streams', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: 'assistant-1',
          parts: [
            {
              state: 'streaming',
              text: '历史思考不应显示。',
              type: 'reasoning',
            },
          ],
          role: 'assistant',
        },
        {
          id: 'assistant-2',
          parts: [{ text: '正在写页面。', type: 'text' }],
          role: 'assistant',
        },
      ],
      sendMessage: vi.fn(),
      status: 'streaming',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('历史思考不应显示。')).not.toBeInTheDocument();
  });

  it('includes current preview path in the chat transport body', () => {
    setCurrentPreviewPath('dashboard.html');
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;
    const transport = useChatOptions?.transport;

    expect(transport).toBeDefined();
    expect(transport?.api).toBe('/api/chat');
    expect(prepareChatRequestBody(transport)).toEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        frontendTabId: 'tab-1',
        message: {
          files: [],
          id: 'user-1',
          text: '生成页面',
        },
        previewPath: 'dashboard.html',
        projectId: 'project-1',
      }),
    );
    expect(prepareChatRequestBody(transport)).not.toHaveProperty('messages');
    expect(prepareChatRequestBody(transport)).not.toHaveProperty('pageEditMode');
  });

  it('extracts only the current user text and files for the chat request body', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[
          {
            id: 'assistant-1',
            parts: [{ text: '历史回复', type: 'text' }],
            role: 'assistant',
          },
        ]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;
    const filePart = {
      filename: 'reference.png',
      mediaType: 'image/png',
      type: 'file' as const,
      url: 'data:image/png;base64,AAAA',
    };

    expect(
      prepareChatRequestBody(useChatOptions?.transport, [
        {
          id: 'assistant-1',
          parts: [{ text: '历史回复', type: 'text' }],
          role: 'assistant',
        },
        {
          id: 'user-2',
          parts: [{ text: '当前输入', type: 'text' }, filePart],
          role: 'user',
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        message: {
          files: [filePart],
          id: 'user-2',
          text: '当前输入',
        },
      }),
    );
  });

  it('omits preview path from the chat transport body when no real preview file is published', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;

    expect(prepareChatRequestBody(useChatOptions?.transport)).not.toHaveProperty('previewPath');
  });

  it('sends Anthropic effort selection in the chat transport body', async () => {
    const user = userEvent.setup();
    stubAnthropicSettings();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'claude-sonnet-4-5 · high' }));
    await user.hover(await screen.findByRole('menuitem', { name: 'claude-sonnet-4-5' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'xhigh' }));

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;

    expect(prepareChatRequestBody(useChatOptions?.transport)).toEqual(
      expect.objectContaining({
        providerOptionsSelection: {
          anthropic: 'xhigh',
        },
      }),
    );
    expect(JSON.parse(window.localStorage.getItem('owndesign:anthropic-efforts') ?? '{}')).toEqual({
      'model-anthropic': 'xhigh',
    });
  });

  it('restores Anthropic effort selection after refresh', async () => {
    window.localStorage.setItem(
      'owndesign:anthropic-efforts',
      JSON.stringify({ 'model-anthropic': 'max' }),
    );
    stubAnthropicSettings();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(
      await screen.findByRole('button', {
        name: 'claude-sonnet-4-5 · max',
      }),
    ).toBeInTheDocument();

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;

    expect(prepareChatRequestBody(useChatOptions?.transport)).toEqual(
      expect.objectContaining({
        providerOptionsSelection: {
          anthropic: 'max',
        },
      }),
    );
  });

  it('does not render the removed page edit mode select in the composer tool area', () => {
    stubOpenAICompatibleSettings();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.queryByRole('combobox', { name: '页面模式' })).not.toBeInTheDocument();
  });

  it('does not send page edit mode in the chat transport body', () => {
    setCurrentPreviewPath('index.html');
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: TestTransport }
      | undefined;

    expect(prepareChatRequestBody(useChatOptions?.transport)).not.toHaveProperty('pageEditMode');
  });

  it('submits without page edit mode in the send request body', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    setCurrentPreviewPath('index.html');
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.type(screen.getByPlaceholderText(/输入消息/), '移除标题');
    await user.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      body: expect.objectContaining({
        previewPath: 'index.html',
      }),
    });
    expect(sendMessage.mock.calls[0]?.[1]?.body).not.toHaveProperty('pageEditMode');
  });

  it('uses current preview path published after render without page edit mode', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    act(() => {
      setCurrentPreviewPath('generated.html');
    });

    await user.type(screen.getByPlaceholderText(/输入消息/), '移除标题');
    await user.click(screen.getByRole('button', { name: '提交' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      body: expect.objectContaining({
        previewPath: 'generated.html',
      }),
    });
    expect(sendMessage.mock.calls[0]?.[1]?.body).not.toHaveProperty('pageEditMode');
  });

  it('configures stream resume for the current conversation active run', async () => {
    const setMessages = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/runs/active/snapshot')) {
          return Response.json({
            activeRun: {
              chunkCount: 2,
              conversationId: 'conversation-1',
              createdAt: '2026-01-01T00:00:00.000Z',
              projectId: 'project-1',
              runId: 'run-1',
              status: 'running',
            },
            messages: [
              {
                id: 'user-1',
                parts: [{ text: '生成页面', type: 'text' }],
                role: 'user',
              },
            ],
            nextChunkIndex: 2,
          });
        }

        return Response.json({
          defaultModelId: 'model-1',
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [],
        });
      }),
    );

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      setMessages,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectActiveRun={{
          chunkCount: 1,
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          projectId: 'project-1',
          runId: 'run-1',
          status: 'running',
        }}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | {
          resume: boolean;
          transport: {
            prepareReconnectToStreamRequest?: () => { api: string };
          };
        }
      | undefined;

    expect(useChatOptions?.resume).toBe(false);
    expect(screen.queryByText('运行中')).not.toBeInTheDocument();
    expect(
      screen.queryByText('当前会话正在生成，刷新或切换回来会继续显示进度。'),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      const latestUseChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
        | {
            resume: boolean;
            transport: {
              prepareReconnectToStreamRequest?: () => { api: string };
            };
          }
        | undefined;

      expect(latestUseChatOptions?.resume).toBe(true);
      expect(latestUseChatOptions?.transport.prepareReconnectToStreamRequest?.().api).toBe(
        '/api/projects/project-1/conversations/conversation-1/runs/active/stream?after=2',
      );
    });
    expect(setMessages).toHaveBeenCalledWith([
      {
        id: 'user-1',
        parts: [{ text: '生成页面', type: 'text' }],
        role: 'user',
      },
    ]);
  });

  it('disables input when another conversation in the project is running', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-2"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectActiveRun={{
          chunkCount: 1,
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          projectId: 'project-1',
          runId: 'run-1',
          status: 'running',
        }}
        projectId="project-1"
      />,
    );

    expect(screen.getByPlaceholderText(/输入消息/)).toBeDisabled();
    expect(
      screen.getByText('当前项目已有任务正在执行，完成或停止后才能继续输入。'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '停止' }));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows live elapsed time for an active task', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:01:05.000Z'));
    const messages: UIMessage[] = [
      createUserMessage('user-1', '生成页面'),
      {
        id: 'assistant-1',
        parts: [{ text: '正在生成页面。', type: 'text' }],
        role: 'assistant',
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/runs/active/snapshot')) {
          return new Response(null, { status: 204 });
        }

        if (String(input).includes('/checkpoints')) {
          return Response.json([]);
        }

        return Response.json({
          defaultModelId: 'model-1',
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [],
        });
      }),
    );

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages,
      sendMessage: vi.fn(),
      status: 'streaming',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={messages}
        projectActiveRun={{
          chunkCount: 1,
          conversationId: 'conversation-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          projectId: 'project-1',
          runId: 'run-1',
          status: 'running',
        }}
        projectId="project-1"
      />,
    );

    expect(screen.getByText('耗时 1:05')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('耗时 1:07')).toBeInTheDocument();
  });

  it('keeps completed task elapsed time hidden until the assistant message is hovered', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        createUserMessage('user-1', '生成页面'),
        {
          id: 'assistant-1',
          metadata: {
            taskTiming: {
              completedAt: '2026-01-01T00:02:03.000Z',
              elapsedMs: 123000,
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          parts: [{ text: '已完成。', type: 'text' }],
          role: 'assistant',
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const elapsedText = screen.getByText('耗时 2:03');
    const elapsedContainer = elapsedText.closest('div');

    expect(elapsedText).toBeInTheDocument();
    expect(elapsedContainer).toHaveClass('opacity-0');
    expect(elapsedContainer).toHaveClass('group-hover/message:opacity-100');
  });

  it('stops streaming generation from the composer submit button', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    const stop = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: 'streaming',
      stop,
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const stopButton = await screen.findByRole('button', { name: '停止' });

    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stops submitted generation from the composer submit button', async () => {
    const user = userEvent.setup();
    const stop = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'submitted',
      stop,
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const stopButton = await screen.findByRole('button', { name: '停止' });

    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the ready submit button disabled when no model is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          defaultModelId: null,
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [],
        }),
      ),
    );
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole('button', { name: '提交' })).toBeDisabled();
  });

  it('renders the attachment action menu', async () => {
    const user = userEvent.setup();
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(await screen.findByRole('button', { name: '添加附件' }));

    const addItem = await screen.findByText('添加图片或文件');
    expect(addItem).toBeInTheDocument();

    await user.click(addItem);

    expect(inputClickSpy).toHaveBeenCalled();
    inputClickSpy.mockRestore();
  });

  it('hides attachment controls for DeepSeek models', async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument();
  });

  it('clears attachments after switching to a DeepSeek model', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          defaultModelId: 'model-openai',
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [
            {
              apiKey: '',
              baseUrl: 'https://example.test/v1',
              contextSizeK: 200,
              hasApiKey: true,
              id: 'model-openai',
              model: 'gpt-4o',
              provider: 'openai-compatible',
            },
            {
              apiKey: '',
              baseUrl: '',
              contextSizeK: 1000,
              hasApiKey: true,
              id: 'model-deepseek',
              model: 'deepseek-v4-flash',
              provider: 'deepseek',
            },
          ],
        }),
      ),
    );

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.upload(
      screen.getByLabelText('上传文件'),
      new File([new Uint8Array(1024)], 'reference.png', {
        type: 'image/png',
      }),
    );

    expect(screen.getByText('reference.png')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'gpt-4o' }));
    await user.click(await screen.findByText('deepseek-v4-flash'));

    expect(screen.queryByText('reference.png')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument();
  });

  it('shows image attachment previews', async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText('上传文件');
    const file = new File([new Uint8Array(1024)], 'hero.png', {
      type: 'image/png',
    });

    await user.upload(input, file);

    expect(screen.getByText('hero.png')).toBeInTheDocument();
    expect(screen.getByText('1 KB')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'hero.png' })).toHaveAttribute('src', 'blob:hero.png');
  });

  it('shows file attachment previews and removes them', async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText('上传文件');
    const file = new File([new Uint8Array(2048)], 'brief.pdf', {
      type: 'application/pdf',
    });

    await user.upload(input, file);

    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'brief.pdf' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '移除 brief.pdf' }));

    expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:brief.pdf');
  });

  it('sends attachment-only messages with files', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText('上传文件');
    const file = new File([new Uint8Array(1024)], 'reference.png', {
      type: 'image/png',
    });

    await user.upload(input, file);
    await user.click(await screen.findByRole('button', { name: '提交' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        {
          files: [
            expect.objectContaining({
              filename: 'reference.png',
              mediaType: 'image/png',
              type: 'file',
            }),
          ],
          text: '',
        },
        {
          body: expect.not.objectContaining({
            pageEditMode: expect.anything(),
          }),
        },
      );
    });
  });

  it('limits attachment count and size', async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText('上传文件');
    const files = Array.from(
      { length: 9 },
      (_, index) =>
        new File([new Uint8Array(1024)], `asset-${index + 1}.txt`, {
          type: 'text/plain',
        }),
    );

    await user.upload(input, files);

    expect(screen.getByText('asset-8.txt')).toBeInTheDocument();
    expect(screen.queryByText('asset-9.txt')).not.toBeInTheDocument();

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.zip', {
      type: 'application/zip',
    });

    await user.upload(input, oversized);

    expect(screen.queryByText('large.zip')).not.toBeInTheDocument();
  });

  it('renders context usage next to model selection', async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole('button', { name: '上下文 0%' })).toBeInTheDocument();
  });

  it('updates context usage from latest assistant message metadata', async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: 'assistant-1',
          metadata: {
            contextUsage: {
              inputTokens: 8000,
              outputTokens: 2000,
              totalTokens: 10000,
            },
          },
          parts: [{ text: '完成。', type: 'text' }],
          role: 'assistant',
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole('button', { name: '上下文 1%' })).toBeInTheDocument();
  });

  it('does not configure chat approval continuation', () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: 'ready',
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(useChat).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sendAutomaticallyWhen: expect.anything(),
      }),
    );
  });
});
