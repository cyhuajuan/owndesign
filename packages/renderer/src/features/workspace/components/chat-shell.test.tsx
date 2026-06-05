import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatShell } from './chat-shell';

vi.mock('@/features/preview/components/frontend-capability-bridge', () => ({
  FrontendCapabilityBridge: () => null,
}));

describe('ChatShell', () => {
  const anchorClicks: string[] = [];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          defaultModelId: null,
          interfaceLanguage: 'zh-CN',
          modelConfigurations: [],
          resources: { fontLibraries: [], iconLibraries: [] },
        }),
      ),
    );
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    anchorClicks.length = 0;
    vi.restoreAllMocks();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const element = originalCreateElement(tagName, options);

      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'click', {
          configurable: true,
          value() {
            anchorClicks.push((element as HTMLAnchorElement).href);
          },
        });
      }

      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders conversation workflow and preview regions', () => {
    render(<ChatShell />);

    expect(screen.getByRole('region', { name: '会话工作流' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '预览面板' })).toBeInTheDocument();
  });

  it('renders optional top bar shell slots', () => {
    render(
      <ChatShell
        shellSlots={{
          topBarDragRegion: <div data-testid="topbar-drag-region" />,
          topBarTrailing: <button type="button">窗口关闭</button>,
        }}
      />,
    );

    expect(screen.getByTestId('topbar-drag-region')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '窗口关闭' })).toBeInTheDocument();
  });

  it('collapses and re-expands the conversation workflow from the preview header toggle', async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    const [previewPane] = screen.getAllByRole('region', { name: '预览面板' });

    await user.click(
      within(previewPane).getByRole('button', {
        name: '收起会话面板',
      }),
    );

    expect(within(previewPane).getByRole('button', { name: '展开会话面板' })).toBeInTheDocument();

    await user.click(within(previewPane).getByRole('button', { name: '展开会话面板' }));

    expect(screen.getAllByRole('region', { name: '会话工作流' })).not.toHaveLength(0);
  });

  it('remembers collapsed state across remounts', async () => {
    const user = userEvent.setup();
    const firstRender = render(<ChatShell />);
    const [previewPane] = screen.getAllByRole('region', { name: '预览面板' });

    await user.click(
      within(previewPane).getByRole('button', {
        name: '收起会话面板',
      }),
    );

    expect(within(previewPane).getByRole('button', { name: '展开会话面板' })).toBeInTheDocument();

    firstRender.unmount();
    render(<ChatShell />);

    expect(screen.getAllByRole('button', { name: '展开会话面板' })).not.toHaveLength(0);
  });

  it('renders grouped preview HTML selector from preview file events', async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'index-v2.html',
            files: ['index-v1.html', 'index-v2.html', 'detail-v3.html', 'legacy.html'],
          },
        }),
      );
    });

    const switchButton = screen.getByRole('button', { name: '切换预览 HTML' });
    expect(switchButton).toHaveTextContent('index / v2');

    await user.click(switchButton);
    await user.click(await screen.findByText('detail'));

    expect(window.location.search).toBe('?previewPath=detail-v3.html');
  });

  it('switches old versions and other files from the preview HTML selector', async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'index-v2.html',
            files: ['index-v1.html', 'index-v2.html', 'legacy.html'],
          },
        }),
      );
    });

    await user.click(screen.getByRole('button', { name: '切换预览 HTML' }));
    await user.click(await screen.findByText('index-v1.html'));

    expect(window.location.search).toBe('?previewPath=index-v1.html');

    await user.click(screen.getByRole('button', { name: '切换预览 HTML' }));
    await user.click(await screen.findByRole('menuitem', { name: 'legacy.html' }));

    expect(window.location.search).toBe('?previewPath=legacy.html');
  });

  it('renders icon-only download menu before refresh button and shows both download actions', async () => {
    const user = userEvent.setup();

    render(<ChatShell previewProjectId="project-1" />);

    const previewPane = screen.getByRole('region', { name: '预览面板' });
    const deviceSelect = within(previewPane).getByRole('combobox', { name: '预览设备' });
    const downloadButton = within(previewPane).getByRole('button', { name: '下载' });
    const refreshButton = within(previewPane).getByRole('button', {
      name: '刷新预览',
    });
    const headerButtons = within(previewPane).getAllByRole('button');

    expect(deviceSelect).toHaveTextContent('桌面端');
    expect(deviceSelect.compareDocumentPosition(downloadButton)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(headerButtons.indexOf(downloadButton)).toBeLessThan(
      headerButtons.indexOf(refreshButton),
    );
    expect(downloadButton).toHaveAccessibleName('下载');
    expect(downloadButton).not.toHaveTextContent('下载');

    await user.click(downloadButton);

    expect(await screen.findByText('下载当前HTML')).toBeInTheDocument();
    expect(await screen.findByText('下载全部打包成ZIP')).toBeInTheDocument();
  });

  it('switches the preview device selector to mobile', async () => {
    const user = userEvent.setup();

    render(<ChatShell />);

    const previewPane = screen.getByRole('region', { name: '预览面板' });
    const deviceSelect = within(previewPane).getByRole('combobox', { name: '预览设备' });

    expect(deviceSelect).toHaveTextContent('桌面端');

    await user.click(deviceSelect);
    await user.click(await screen.findByRole('option', { name: '移动端' }));

    expect(deviceSelect).toHaveTextContent('移动端');
  });

  it('persists preview device per project html and uses the current device for new html', async () => {
    const user = userEvent.setup();

    render(<ChatShell previewProjectId="project-1" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'index.html',
            files: ['index.html', 'dashboard.html'],
          },
        }),
      );
    });

    const previewPane = screen.getByRole('region', { name: '预览面板' });
    const deviceSelect = within(previewPane).getByRole('combobox', { name: '预览设备' });

    await user.click(deviceSelect);
    await user.click(await screen.findByRole('option', { name: '移动端' }));
    expect(deviceSelect).toHaveTextContent('移动端');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'dashboard.html',
            files: ['index.html', 'dashboard.html'],
          },
        }),
      );
    });

    await waitFor(() => expect(deviceSelect).toHaveTextContent('移动端'));

    await user.click(deviceSelect);
    await user.click(await screen.findByRole('option', { name: '桌面端' }));
    expect(deviceSelect).toHaveTextContent('桌面端');

    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'index.html',
            files: ['index.html', 'dashboard.html'],
          },
        }),
      );
    });

    await waitFor(() => expect(deviceSelect).toHaveTextContent('移动端'));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'dashboard.html',
            files: ['index.html', 'dashboard.html'],
          },
        }),
      );
    });

    await waitFor(() => expect(deviceSelect).toHaveTextContent('桌面端'));
  });

  it('disables the download trigger when no active project exists', () => {
    render(<ChatShell />);

    expect(screen.getByRole('button', { name: '下载' })).toBeDisabled();
  });

  it('downloads current preview html using the active preview path', async () => {
    const user = userEvent.setup();

    render(<ChatShell previewProjectId="project-1" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('owndesign:preview-files-updated', {
          detail: {
            activePath: 'pages/detail.html',
            files: ['index.html', 'pages/detail.html'],
          },
        }),
      );
    });

    await user.click(screen.getByRole('button', { name: '下载' }));
    await user.click(await screen.findByText('下载当前HTML'));

    expect(anchorClicks).toEqual([
      'http://localhost:3000/api/projects/project-1/download?kind=current-html&previewPath=pages%2Fdetail.html',
    ]);
  });
});
