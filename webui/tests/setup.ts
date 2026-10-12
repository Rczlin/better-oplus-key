import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest 未开启 globals，@testing-library/react 无法自动注册 afterEach(cleanup)。
// 这里显式注册，避免前一个用例的 DOM 残留到后一个用例（否则 document 中会累积多个 App）。
afterEach(() => {
  cleanup();
});

// 测试环境补丁：jsdom 不实现 window.matchMedia，而 sonner 会无条件调用它
// （sonner dist/index.mjs 第 1072 行）。这里提供一个最小桩，只用于测试，不影响生产代码。
// 真实 WebView 中 matchMedia 存在，因此生产环境不需要此桩。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
