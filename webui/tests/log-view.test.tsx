import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandPreview } from "../src/components/CommandPreview";
import { LogRows } from "../src/components/LogRows";
import { formatExplainRow, parseExplainLog } from "../src/lib/log";

afterEach(cleanup);
describe("bounded command and log presentation", () => {
  it("keeps a long command in a local container and expands it on request", () => {
    const command = "echo " + "x".repeat(1200);
    render(<CommandPreview command={command} testId="command" />);
    expect(screen.getByTestId("command")).toHaveClass("min-w-0", "max-w-full");
    expect(screen.queryByText(command)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开完整命令" }));
    expect(screen.getByText(command)).toHaveClass("[overflow-wrap:anywhere]", "overflow-auto");
    fireEvent.click(screen.getByRole("button", { name: "收起命令" }));
    expect(screen.queryByText(command)).toBeNull();
  });
  it("formats results and expands long actions locally", () => {
    const action = "x".repeat(1000);
    const rows = parseExplainLog(`2026-10-17 10:00:00 INFO seq=01 action=${action} result=0\ninvalid\n2026-10-17 10:00:01 WARN seq=0 action=none result=dropped`);
    expect(formatExplainRow(rows[0])).toEqual({ resultLabel: "执行成功", summary: "短按 → 长按" });
    render(<LogRows rows={rows} logsRead />);
    expect(screen.getByText("执行成功")).toBeInTheDocument();
    expect(screen.getByText("未匹配")).toBeInTheDocument();
    expect(screen.queryByText(action)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开完整命令" }));
    expect(screen.getByText(action)).toHaveClass("[overflow-wrap:anywhere]");
  });
  it("shows readable pending and empty states", () => {
    const { rerender } = render(<LogRows rows={[]} logsRead={false} />);
    expect(screen.getByText("点击刷新读取")).toBeInTheDocument();
    rerender(<LogRows rows={[]} logsRead />);
    expect(screen.getByText("暂无可用记录")).toBeInTheDocument();
  });
  it("bounds long service messages behind a local disclosure", () => {
    const message = "service/".repeat(400);
    render(<LogRows rows={[{ time: "2026-10-17 10:00:00", level: "ERROR", message }]} logsRead />);
    const full = screen.getByText(message);
    expect(full.closest("details")).not.toBeNull();
    expect(full.closest("details")).not.toHaveAttribute("open");
    expect(full).toHaveClass("max-h-48", "overflow-auto");
  });
});
