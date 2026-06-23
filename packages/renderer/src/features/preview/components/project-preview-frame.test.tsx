import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPreviewFrame } from './project-preview-frame';

describe('ProjectPreviewFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as typeof fetch);
  });

  it('renders styled loading empty state before preview session resolves', () => {
    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    expect(screen.getByText('预览服务启动中')).toBeInTheDocument();
    expect(
      screen.getByText('正在为当前项目启动预览环境。准备完成后，这里会自动显示最新页面。'),
    ).toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('clears legacy preview path query and requests a single index preview session', async () => {
    window.history.replaceState(null, '', '/?previewPath=dashboard.html&panel=right');
    const fetchMock = mockPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    expect(parseBody(getSessionPosts(fetchMock)[0])).toEqual({
      clientId: expect.any(String),
    });
    expect(window.location.search).toBe('?panel=right');
  });

  it('publishes the preview href returned by the initial preview session', async () => {
    const fetchMock = mockPreviewFetch();
    const publishedHrefs: unknown[] = [];
    window.addEventListener('owndesign:preview-href-updated', (event) => {
      publishedHrefs.push(event instanceof CustomEvent ? event.detail?.href : undefined);
    });

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await screen.findByTitle('Project One HTML 预览');

    expect(getSessionPosts(fetchMock)).toHaveLength(1);
    expect(publishedHrefs.at(-1)).toBe('http://127.0.0.1:3000/index.html');
  });

  it('publishes preview hash route messages from the current iframe origin', async () => {
    mockPreviewFetch();
    const previewRouteEvents: CustomEvent[] = [];
    window.addEventListener('owndesign:preview-route-updated', (event) => {
      previewRouteEvents.push(event as CustomEvent);
    });

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const iframe = (await screen.findByTitle('Project One HTML 预览')) as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          hash: '#/pricing',
          source: 'owndesign-preview',
          type: 'route-changed',
          version: 1,
        },
        origin: 'http://127.0.0.1:3000',
        source: iframe.contentWindow,
      }),
    );

    expect(previewRouteEvents.at(-1)?.detail).toEqual({
      hash: '#/pricing',
      projectId: 'project-1',
    });
  });

  it('ignores preview hash route messages from the wrong origin or payload', async () => {
    mockPreviewFetch();
    const previewRouteEvents: CustomEvent[] = [];
    window.addEventListener('owndesign:preview-route-updated', (event) => {
      previewRouteEvents.push(event as CustomEvent);
    });

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const iframe = (await screen.findByTitle('Project One HTML 预览')) as HTMLIFrameElement;
    const baselineEvents = previewRouteEvents.length;

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          hash: '#/pricing',
          source: 'owndesign-preview',
          type: 'route-changed',
          version: 1,
        },
        origin: 'http://malicious.test',
        source: iframe.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          hash: '/pricing',
          source: 'owndesign-preview',
          type: 'route-changed',
          version: 1,
        },
        origin: 'http://127.0.0.1:3000',
        source: iframe.contentWindow,
      }),
    );

    expect(previewRouteEvents).toHaveLength(baselineEvents);
  });

  it('renders the desktop preview iframe with the existing full-size class by default', async () => {
    mockPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    expect(await screen.findByTitle('Project One HTML 预览')).toHaveClass(
      'size-full',
      'border-0',
      'bg-white',
    );
  });

  it('renders the mobile preview in a fixed phone-sized frame without changing session body', async () => {
    const fetchMock = mockPreviewFetch();

    const { rerender } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await screen.findByTitle('Project One HTML 预览');

    rerender(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        previewDevice="mobile"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const mobilePreview = screen.getByTestId('mobile-preview');
    const phoneFrame = mobilePreview.firstElementChild;

    expect(mobilePreview).toHaveClass('size-full', 'overflow-auto', 'bg-muted/40', 'p-4');
    expect(phoneFrame).toHaveClass('h-[844px]', 'max-h-full', 'w-[390px]');
    expect(screen.getByTitle('Project One HTML 预览')).toHaveClass('size-full');
    expect(getSessionPosts(fetchMock)).toHaveLength(1);
    expect(parseBody(getSessionPosts(fetchMock)[0])).toEqual({
      clientId: expect.any(String),
    });
  });

  it('does not publish a preview href for an empty workspace', async () => {
    const fetchMock = mockEmptyPreviewFetch();
    const publishedHrefs: unknown[] = [];
    const handlePreviewHref = (event: Event) => {
      if (event instanceof CustomEvent) {
        publishedHrefs.push(event.detail?.href);
      }
    };
    window.addEventListener('owndesign:preview-href-updated', handlePreviewHref);

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await screen.findByText('尚无预览内容');

    expect(getSessionPosts(fetchMock)).toHaveLength(1);
    expect(window.location.search).toBe('');
    expect(screen.queryByTitle('Project One HTML 预览')).not.toBeInTheDocument();
    expect(publishedHrefs.at(-1)).toBeUndefined();
    window.removeEventListener('owndesign:preview-href-updated', handlePreviewHref);
  });

  it('renders the iframe after an empty preview refresh finds HTML', async () => {
    const fetchMock = mockEmptyPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await screen.findByText('尚无预览内容');

    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      return Response.json({
        previewFileExists: true,
        url: 'http://127.0.0.1:3000/index.html',
      });
    });

    fireEvent(window, new Event('owndesign:preview-refresh'));

    await screen.findByTitle('Project One HTML 预览');
    expect(getHeartbeatPosts(fetchMock)).toHaveLength(1);
  });

  it('releases the preview session when the frame unmounts', async () => {
    const fetchMock = mockPreviewFetch();

    const { unmount } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    unmount();

    expect(getDeletes(fetchMock)).toHaveLength(1);
    expect(getCallUrl(getDeletes(fetchMock)[0])).toBe('/api/projects/project-1/preview-session');
    expect(parseBody(getDeletes(fetchMock)[0])).toEqual({
      clientId: expect.any(String),
    });
  });

  it('releases the old project and acquires the new one when projectId changes', async () => {
    const fetchMock = mockPreviewFetch();

    const { rerender } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    rerender(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-2"
        projectName="Project Two"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(2);
      expect(getDeletes(fetchMock)).toHaveLength(1);
    });

    expect(getCallUrl(getDeletes(fetchMock)[0])).toBe('/api/projects/project-1/preview-session');
    expect(getCallUrl(getSessionPosts(fetchMock)[1])).toBe(
      '/api/projects/project-2/preview-session',
    );
  });

  it('syncs the preview session on iframe load without writing a preview path query', async () => {
    const fetchMock = mockPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const iframe = await screen.findByTitle('Project One HTML 预览');
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(getHeartbeatPosts(fetchMock)).toHaveLength(1);
    });

    expect(parseBody(getHeartbeatPosts(fetchMock).at(-1)!)).toEqual({
      clientId: expect.any(String),
    });
    expect(window.location.search).toBe('');
  });
});

function mockPreviewFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return Response.json({
      previewFileExists: true,
      url: 'http://127.0.0.1:3000/index.html',
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function mockEmptyPreviewFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return Response.json({
      previewFileExists: false,
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function getSessionPosts(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      init?.method === 'POST' && getCallUrl([input, init]).endsWith('/preview-session'),
  );
}

function getDeletes(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
}

function getHeartbeatPosts(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      init?.method === 'POST' && getCallUrl([input, init]).endsWith('/preview-session/heartbeat'),
  );
}

function getCallUrl(call: unknown[]) {
  return String(call[0]);
}

function parseBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? '{}'));
}
