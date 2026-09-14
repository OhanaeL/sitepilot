import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const box = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) };
HTMLElement.prototype.getBoundingClientRect = function () {
  return this.hasAttribute("data-test-hidden") ? { ...box, width: 0, height: 0 } : box;
};
HTMLElement.prototype.scrollIntoView = () => {};
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
