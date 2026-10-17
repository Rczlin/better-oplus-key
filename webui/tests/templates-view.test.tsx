import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TemplatesView } from "../src/components/TemplatesView";
import { upsertTemplate, type ShellTemplate } from "../src/lib/templates";

afterEach(cleanup);
const templates: ShellTemplate[] = [{ id: "a", name: "桌面", command: "input keyevent 3", updatedAt: 1 }, { id: "b", name: "返回", command: "input keyevent 4", updatedAt: 2 }];
it("searches name/command and validates duplicate edits before replacing a template", async () => {
  const save = vi.fn((template: ShellTemplate) => { upsertTemplate(templates, template); });
  render(<TemplatesView templates={templates} busy={false} onEdit={() => {}} onDelete={() => {}} onUse={() => {}} onSave={save} onReload={() => {}} />);
  fireEvent.change(screen.getByLabelText("搜索模板"), { target: { value: "keyevent 3" } });
  expect(screen.getByText("桌面")).toBeInTheDocument(); expect(screen.queryByText("返回")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑模板" }));
  fireEvent.change(screen.getByLabelText("模板命令"), { target: { value: "input keyevent 4" } });
  fireEvent.click(screen.getByRole("button", { name: "保存模板" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/重复|已存在/);
  expect(screen.getByLabelText("模板名称")).toBeInTheDocument();
});
