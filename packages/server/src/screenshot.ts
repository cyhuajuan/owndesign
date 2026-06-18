import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export type ScreenshotDevice = 'desktop' | 'mobile';

type CaptureProjectScreenshotOptions = {
  device: ScreenshotDevice;
  url: string;
};

type ScreenshotViewport = {
  height: number;
  width: number;
};

export class ScreenshotBrowserUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      'No supported browser was found. Install Chrome/Edge or set OWNDESIGN_SCREENSHOT_BROWSER_EXECUTABLE.',
      { cause },
    );
    this.name = 'ScreenshotBrowserUnavailableError';
  }
}

const SCREENSHOT_VIEWPORTS: Record<ScreenshotDevice, ScreenshotViewport> = {
  desktop: { height: 1024, width: 1440 },
  mobile: { height: 844, width: 390 },
};

const BROWSER_CHANNELS = ['msedge', 'chrome'] as const;

export function getScreenshotViewport(device: ScreenshotDevice) {
  return SCREENSHOT_VIEWPORTS[device];
}

export async function captureProjectScreenshot({ device, url }: CaptureProjectScreenshotOptions) {
  const browser = await launchSystemBrowser();
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: getScreenshotViewport(device),
    });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);

    await page.goto(url, { waitUntil: 'networkidle' });
    await waitForFonts(page);

    return await page.screenshot({ fullPage: true, type: 'png' });
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function launchSystemBrowser() {
  let lastError: unknown;

  for (const channel of BROWSER_CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      lastError = error;
    }
  }

  const executablePath = process.env.OWNDESIGN_SCREENSHOT_BROWSER_EXECUTABLE?.trim();

  if (executablePath) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch (error) {
      lastError = error;
    }
  }

  throw new ScreenshotBrowserUnavailableError(lastError);
}

async function waitForFonts(page: Page) {
  await page
    .evaluate(async () => {
      await document.fonts?.ready;
    })
    .catch(() => {});
}

export type ScreenshotBrowser = Browser;
