import { describe, expect, it, vi } from 'vitest';

const playwrightMocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  chromiumLaunch: vi.fn(),
  contextClose: vi.fn(),
  evaluate: vi.fn(),
  goto: vi.fn(),
  newContext: vi.fn(),
  newPage: vi.fn(),
  screenshot: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  setDefaultTimeout: vi.fn(),
}));

vi.mock('playwright-core', () => ({
  chromium: {
    launch: playwrightMocks.chromiumLaunch,
  },
}));

import {
  captureProjectScreenshot,
  getScreenshotViewport,
  ScreenshotBrowserUnavailableError,
} from './screenshot';

describe('screenshot', () => {
  it('maps screenshot devices to stable viewports', () => {
    expect(getScreenshotViewport('desktop')).toEqual({ height: 1024, width: 1440 });
    expect(getScreenshotViewport('mobile')).toEqual({ height: 844, width: 390 });
  });

  it('captures a full-page png with the selected viewport', async () => {
    const screenshot = Buffer.from('png');

    setupBrowserMock(screenshot);

    await expect(
      captureProjectScreenshot({
        device: 'mobile',
        url: 'http://127.0.0.1:3000/index.html',
      }),
    ).resolves.toBe(screenshot);

    expect(playwrightMocks.chromiumLaunch).toHaveBeenCalledWith({
      channel: 'msedge',
      headless: true,
    });
    expect(playwrightMocks.newContext).toHaveBeenCalledWith({
      deviceScaleFactor: 1,
      viewport: { height: 844, width: 390 },
    });
    expect(playwrightMocks.goto).toHaveBeenCalledWith('http://127.0.0.1:3000/index.html', {
      waitUntil: 'networkidle',
    });
    expect(playwrightMocks.screenshot).toHaveBeenCalledWith({
      fullPage: true,
      type: 'png',
    });
  });

  it('falls back to chrome and then the executable path when channels fail', async () => {
    const screenshot = Buffer.from('png');

    setupBrowserMock(screenshot);
    playwrightMocks.chromiumLaunch
      .mockRejectedValueOnce(new Error('missing edge'))
      .mockRejectedValueOnce(new Error('missing chrome'))
      .mockResolvedValueOnce(createBrowserMock());
    vi.stubEnv('OWNDESIGN_SCREENSHOT_BROWSER_EXECUTABLE', 'C:/Browser/chrome.exe');

    await captureProjectScreenshot({
      device: 'desktop',
      url: 'http://127.0.0.1:3000/index.html',
    });

    expect(playwrightMocks.chromiumLaunch).toHaveBeenLastCalledWith({
      executablePath: 'C:/Browser/chrome.exe',
      headless: true,
    });

    vi.unstubAllEnvs();
  });

  it('throws a browser unavailable error when no browser can launch', async () => {
    playwrightMocks.chromiumLaunch.mockRejectedValue(new Error('missing browser'));

    await expect(
      captureProjectScreenshot({
        device: 'desktop',
        url: 'http://127.0.0.1:3000/index.html',
      }),
    ).rejects.toBeInstanceOf(ScreenshotBrowserUnavailableError);
  });
});

function setupBrowserMock(screenshot: Buffer) {
  vi.clearAllMocks();
  playwrightMocks.browserClose.mockResolvedValue(undefined);
  playwrightMocks.contextClose.mockResolvedValue(undefined);
  playwrightMocks.evaluate.mockResolvedValue(undefined);
  playwrightMocks.goto.mockResolvedValue(undefined);
  playwrightMocks.screenshot.mockResolvedValue(screenshot);
  playwrightMocks.newPage.mockResolvedValue(createPageMock());
  playwrightMocks.newContext.mockResolvedValue(createContextMock());
  playwrightMocks.chromiumLaunch.mockResolvedValue(createBrowserMock());
}

function createBrowserMock() {
  return {
    close: playwrightMocks.browserClose,
    newContext: playwrightMocks.newContext,
  };
}

function createContextMock() {
  return {
    close: playwrightMocks.contextClose,
    newPage: playwrightMocks.newPage,
  };
}

function createPageMock() {
  return {
    evaluate: playwrightMocks.evaluate,
    goto: playwrightMocks.goto,
    screenshot: playwrightMocks.screenshot,
    setDefaultNavigationTimeout: playwrightMocks.setDefaultNavigationTimeout,
    setDefaultTimeout: playwrightMocks.setDefaultTimeout,
  };
}
