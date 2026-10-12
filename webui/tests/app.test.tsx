import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";
import { SEQUENCES } from "../src/lib/config";

afterEach(() => {
  delete (globalThis as { ksu?: unknown }).ksu;
});

describe("App DOM contract", () => {
  it("shows the root warning", () => {
    render(<App />);
    expect(document.querySelector('[data-test="warning-root"]')).toBeInTheDocument();
  });

  it("shows the non-KSU banner when no ksu bridge exists", () => {
    render(<App />);
    expect(document.querySelector('[data-test="non-ksu-banner"]')).toBeInTheDocument();
  });

  it("renders exactly 14 binding inputs with stable data-test ids", () => {
    render(<App />);
    for (const s of SEQUENCES) {
      expect(document.querySelector(`[data-test="binding-${s}"]`)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('[data-test^="binding-"]')).toHaveLength(14);
  });

  it("renders the daemon toggle and log refresh controls", () => {
    render(<App />);
    expect(document.querySelector('[data-test="daemon-toggle"]')).toBeInTheDocument();
    expect(document.querySelector('[data-test="log-refresh"]')).toBeInTheDocument();
  });
});

describe("log panel", () => {
  it("does not read logs on mount, only on manual refresh", async () => {
    let calls = 0;
    (globalThis as { ksu?: unknown }).ksu = {
      exec: (_c: string, _o: string, cb: string) => {
        calls++;
        (globalThis as Record<string, unknown>)[cb]?.(0, "", "");
      },
    };
    render(<App />);
    expect(calls).toBe(0);
    fireEvent.click(document.querySelector('[data-test="log-refresh"]') as HTMLElement);
    await waitFor(() => expect(calls).toBeGreaterThan(0));
  });
});
