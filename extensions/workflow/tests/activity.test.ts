import { afterEach, describe, expect, test, vi } from "vitest";
import {
	beginWorkflowActivity,
	clearWorkflowActivity,
	getWorkflowActivitySnapshot,
	hasActiveWorkflowActivity,
	projectWorkflowActivityEvent,
	setWorkflowActivityPhase,
	subscribeWorkflowActivity,
} from "../activity.ts";

afterEach(() => clearWorkflowActivity());

describe("parent-process workflow activity projection", () => {
	test("publishes immutable lifecycle snapshots and subscriptions", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeWorkflowActivity(listener);
		beginWorkflowActivity("run-1", "pipeline");
		setWorkflowActivityPhase("run-1", "plan");

		const snapshot = getWorkflowActivitySnapshot();
		expect(snapshot).toMatchObject({ runId: "run-1", workflowId: "pipeline", phaseId: "plan" });
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot?.delegates)).toBe(true);
		expect(Object.isFrozen(snapshot?.mcpCalls)).toBe(true);
		expect(hasActiveWorkflowActivity()).toBe(true);
		expect(listener).toHaveBeenCalledTimes(2);

		clearWorkflowActivity("run-1");
		expect(getWorkflowActivitySnapshot()).toBeUndefined();
		unsubscribe();
		beginWorkflowActivity("run-2", "pipeline");
		expect(listener).toHaveBeenCalledTimes(3);
	});

	test("combines delegate events with status while clearing stale terminal counts", () => {
		beginWorkflowActivity("run-1", "pipeline");
		setWorkflowActivityPhase("run-1", "plan");
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_start", toolName: "delegate", toolCallId: "d1", args: { task: "inspect" } });
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 1, total: 1, waiting: 0, nested: 0 });
		projectWorkflowActivityEvent("run-1", {
			type: "extension_ui_request",
			method: "setStatus",
			statusKey: "subagents",
			statusText: "agents 2/3 running · 1 waiting · 2 nested",
		});
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 2, total: 3, waiting: 1, nested: 2 });

		projectWorkflowActivityEvent("run-1", { type: "tool_execution_end", toolName: "delegate", toolCallId: "d1", isError: false });
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 0, total: 3, waiting: 0, nested: 0 });
		projectWorkflowActivityEvent("run-1", {
			type: "extension_ui_request",
			method: "setStatus",
			statusKey: "subagents",
			statusText: "agents 1/3 running · 1 waiting · 1 nested",
		});
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 0, total: 3, waiting: 0, nested: 0 });
	});

	test("decrements concurrent delegate status only for matching terminal events", () => {
		beginWorkflowActivity("run-1", "pipeline");
		setWorkflowActivityPhase("run-1", "plan");
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_start", toolName: "delegate", toolCallId: "d1" });
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_start", toolName: "delegate", toolCallId: "d2" });
		projectWorkflowActivityEvent("run-1", {
			type: "extension_ui_request",
			method: "setStatus",
			statusKey: "subagents",
			statusText: "agents 2/2 running",
		});

		projectWorkflowActivityEvent("run-1", { type: "tool_execution_end", toolName: "delegate", toolCallId: "d1" });
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 1, total: 2, waiting: 0, nested: 0 });
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_end", toolName: "delegate", toolCallId: "d1" });
		expect(getWorkflowActivitySnapshot()?.delegates.running).toBe(1);
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_end", toolName: "delegate", toolCallId: "d2" });
		expect(getWorkflowActivitySnapshot()?.delegates).toEqual({ running: 0, total: 2, waiting: 0, nested: 0 });
	});

	test("retains the latest MCP outcome until the phase changes", () => {
		beginWorkflowActivity("run-1", "pipeline");
		setWorkflowActivityPhase("run-1", "plan");
		projectWorkflowActivityEvent("run-1", {
			type: "tool_execution_start",
			toolName: "mcp",
			toolCallId: "m1",
			args: { action: "call", server: "github", tool: "create_issue" },
		});
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_update", toolName: "mcp", toolCallId: "m1", args: { action: "call" } });
		expect(getWorkflowActivitySnapshot()?.mcpCalls).toEqual([
			expect.objectContaining({ id: "m1", action: "call", server: "github", tool: "create_issue", status: "running" }),
		]);
		expect(Object.isFrozen(getWorkflowActivitySnapshot()?.mcpCalls[0])).toBe(true);
		projectWorkflowActivityEvent("run-1", { type: "tool_execution_end", toolName: "mcp", toolCallId: "m1", isError: false });
		expect(getWorkflowActivitySnapshot()?.mcpCalls).toEqual([
			expect.objectContaining({ id: "m1", status: "succeeded", endedAt: expect.any(Number) }),
		]);
		setWorkflowActivityPhase("run-1", "execute");
		expect(getWorkflowActivitySnapshot()?.mcpCalls).toEqual([]);
	});
});
