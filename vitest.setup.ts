import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  cleanup();
});
