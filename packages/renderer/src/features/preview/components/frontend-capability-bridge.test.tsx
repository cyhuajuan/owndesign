import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FrontendCapabilityBridge } from './frontend-capability-bridge';

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

describe('FrontendCapabilityBridge', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  it('opens a frontend capability stream for the active project', () => {
    render(<FrontendCapabilityBridge projectId="project-1" />);

    expect(MockEventSource.instances[0]?.url).toMatch(
      /^\/api\/projects\/project-1\/frontend-capabilities\/stream\?tabId=/,
    );
  });

  it('switches preview html when the frontend command arrives', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    render(<FrontendCapabilityBridge projectId="project-1" />);

    act(() => {
      MockEventSource.instances[0]?.dispatchEvent(
        new MessageEvent('frontend-command', {
          data: JSON.stringify({
            capability: 'preview.switchHtml',
            id: 'command-1',
            payload: { path: 'pages/detail.html' },
          }),
        }),
      );
    });

    expect(window.location.search).toBe('?previewPath=pages%2Fdetail.html');
    expect(
      dispatchEventSpy.mock.calls.some(
        ([event]) => event.type === 'owndesign:project-output-updated',
      ),
    ).toBe(true);
    dispatchEventSpy.mockRestore();
  });

  it('refreshes preview when the frontend command arrives', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    render(<FrontendCapabilityBridge projectId="project-1" />);

    act(() => {
      MockEventSource.instances[0]?.dispatchEvent(
        new MessageEvent('frontend-command', {
          data: JSON.stringify({
            capability: 'preview.refresh',
            id: 'command-1',
            payload: {},
          }),
        }),
      );
    });

    expect(
      dispatchEventSpy.mock.calls.some(([event]) => event.type === 'owndesign:preview-refresh'),
    ).toBe(true);
    dispatchEventSpy.mockRestore();
  });
});
