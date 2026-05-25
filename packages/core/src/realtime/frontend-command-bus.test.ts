import { afterEach, describe, expect, it } from "vitest";

import { FrontendCommandBus } from "./frontend-command-bus";

describe("FrontendCommandBus", () => {
  const bus = new FrontendCommandBus();

  afterEach(() => {
    bus.clear();
  });

  it("sends frontend-command events to the matching project tab", async () => {
    const stream = bus.registerConnection({
      frontendTabId: "tab-1",
      projectId: "project-1",
    });
    const reader = stream.getReader();

    await reader.read();
    const result = bus.sendCommand({
      capability: "preview.switchHtml",
      frontendTabId: "tab-1",
      payload: { path: "pages/detail.html" },
      projectId: "project-1",
    });
    const chunk = await reader.read();

    expect(result).toMatchObject({
      command: {
        capability: "preview.switchHtml",
        payload: { path: "pages/detail.html" },
      },
      delivered: true,
    });
    expect(new TextDecoder().decode(chunk.value)).toContain(
      "event: frontend-command",
    );
    expect(new TextDecoder().decode(chunk.value)).toContain(
      '"capability":"preview.switchHtml"',
    );
  });

  it("removes connections after abort", () => {
    const controller = new AbortController();
    bus.registerConnection({
      frontendTabId: "tab-1",
      projectId: "project-1",
      signal: controller.signal,
    });

    expect(bus.hasConnection("project-1", "tab-1")).toBe(true);

    controller.abort();

    expect(bus.hasConnection("project-1", "tab-1")).toBe(false);
  });

  it("reports undelivered commands when target tab has no connection", () => {
    expect(
      bus.sendCommand({
        capability: "preview.refresh",
        frontendTabId: "missing-tab",
        payload: {},
        projectId: "project-1",
      }),
    ).toEqual({
      command: undefined,
      delivered: false,
    });
  });
});
