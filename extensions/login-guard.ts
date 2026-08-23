import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Login Guard
 *
 * Stops the agent from working around WordPress dashboards it could not log
 * into. When a browser session hits /wp-admin while logged out, or a login
 * attempt fails, every further browser call except verify calls
 * (navigate/snapshot) is blocked until the user confirms they logged in.
 *
 * Commands:
 *   /logged-in              user confirms manual login -> agent re-verifies
 *   /login-guard on|off|status   enable, disable, or inspect the guard
 */

const BROWSER_SERVER_PATTERN = /^browser$/i;
const VERIFY_TOOLS = new Set(["browser_navigate", "browser_snapshot", "browser_take_screenshot"]);

const LOGIN_PAGE_MARKERS = [
  "wp-login.php",
  "Username or Email Address",
  "user_login",
  "Log back in",
];

const LOGIN_FAILED_MARKERS = [
  "The password you entered for the username",
  "The username you entered is not registered",
  "The password you entered is incorrect",
  "Error: The password",
];

const LOGGED_IN_MARKERS = [
  "/wp-admin/",
  "Howdy,",
  "Dashboard",
  "wp-admin_bar",
];

interface BrowserCall {
	server: string;
	tool: string;
	args: Record<string, unknown>;
}

interface Gate {
	site: string;
	phase: "login-required" | "login-failed";
}

function parseBrowserCall(toolName: string, input: unknown): BrowserCall | null {
	if (toolName !== "mcp" || typeof input !== "object" || input === null) return null;
	const record = input as Record<string, unknown>;
	if (record.action !== "call") return null;
	const server = record.server;
	const tool = record.tool;
	if (typeof server !== "string" || !BROWSER_SERVER_PATTERN.test(server)) return null;
	if (typeof tool !== "string" || !tool.startsWith("browser_")) return null;
	let args: Record<string, unknown> = {};
	if (typeof record.args === "string" && record.args.trim()) {
		try {
			const parsed: unknown = JSON.parse(record.args);
			if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
		} catch {
			args = {};
		}
	}
	return { server, tool, args };
}

function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block && typeof block === "object" && "text" in block
				? String((block as { text: unknown }).text ?? "")
				: "",
		)
		.join("\n");
}

function matchesAny(haystack: string, needles: string[]): string | null {
	for (const needle of needles) {
		if (haystack.includes(needle)) return needle;
	}
	return null;
}

export default function loginGuardExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let gate: Gate | null = null;

	function stopMessage(g: Gate): string {
		const what =
			g.phase === "login-failed"
				? "a WordPress login attempt FAILED (wrong credentials or error)"
				: "the WordPress dashboard requires a login you do not have";
		return (
			`LOGIN GUARD ACTIVE: ${what}. Do NOT continue other work, do NOT fall back to the ` +
			`live/public site, and do NOT retry credentials. Stop now and tell the user exactly this: ` +
			`"I could not access the WordPress dashboard (${g.site}). Please log in manually in my ` +
			`browser window (the Edge session I am driving), then run /logged-in or tell me to continue." ` +
			`Then wait for the user. You may only use browser_navigate/browser_snapshot to re-check.`
		);
	}

	pi.on("tool_call", async (event) => {
		if (!enabled) return;
		const call = parseBrowserCall(event.toolName, event.input);
		if (!call) return;

		if (gate && !VERIFY_TOOLS.has(call.tool)) {
			return { block: true, reason: stopMessage(gate) };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!enabled) return;
		const call = parseBrowserCall(event.toolName, event.input);
		if (!call || event.isError) return;

		const text = resultText(event.content);
		if (!text) return;

		// Success first: any dashboard evidence clears the gate.
		const loggedInMarker = matchesAny(text, LOGGED_IN_MARKERS);
		const urlArg = typeof call.args.url === "string" ? call.args.url : "";
		if (loggedInMarker && !urlArg.includes("wp-login.php")) {
			if (gate) {
				gate = null;
				ctx.ui.notify("Login detected — guard released, resuming.", "info");
			}
			return;
		}

		// A login form appeared where admin was expected -> require manual login.
		const failedMarker = matchesAny(text, LOGIN_FAILED_MARKERS);
		const loginPageMarker = matchesAny(text, LOGIN_PAGE_MARKERS);
		if (failedMarker || loginPageMarker) {
			const site = (() => {
				try {
					const candidate = urlArg || text.match(/https?:\/\/[^\s"'<>]+/)?.[0] || "";
				return new URL(candidate).origin;
				} catch {
					return "the target site";
				}
			})();
			const phase = failedMarker ? "login-failed" : "login-required";
			if (!gate || gate.phase !== phase || gate.site !== site) {
				gate = { site, phase };
				ctx.ui.notify(
					failedMarker
						? "WordPress login FAILED. Please log in manually in my browser window, then run /logged-in."
						: "WordPress dashboard needs login. Please log in manually in my browser window, then run /logged-in.",
					"warning",
				);
			}
			// Append the instruction straight into the tool result the model sees.
			return {
				content: [
					...(Array.isArray(event.content) ? event.content : []),
					{ type: "text", text: `\n\n${stopMessage(gate)}` },
				],
			};
		}
	});

	pi.registerCommand("logged-in", {
		description: "Confirm you logged into the agent browser; the agent will re-check the dashboard",
		handler: async (_args, ctx) => {
			if (!gate) {
				ctx.ui.notify("No login guard is active.", "info");
				return;
			}
			const site = gate.site;
			gate = null;
			ctx.ui.notify(`Guard cleared for ${site}. Asking agent to re-verify…`, "info");
			pi.sendUserMessage(
				`I logged into ${site} in your browser session. Re-open the WordPress dashboard now to verify, then continue where you left off.`,
				{ deliverAs: "followUp" },
			);
		},
	});

	pi.registerCommand("login-guard", {
		description: "WordPress login guard: /login-guard on|off|status",
		getArgumentCompletions: (prefix: string) => {
			const options = ["on", "off", "status"].filter((o) => o.startsWith(prefix));
			return options.length ? { items: options.map((value) => ({ value, label: value })) } : null;
		},
		handler: async (args, ctx) => {
			const sub = (args ?? "").trim().toLowerCase();
			if (sub === "on") {
				enabled = true;
				ctx.ui.notify("Login guard enabled.", "info");
			} else if (sub === "off") {
				enabled = false;
				gate = null;
				ctx.ui.notify("Login guard disabled and any active gate cleared.", "warning");
			} else {
				ctx.ui.notify(
					gate
						? `Login guard ${enabled ? "enabled" : "DISABLED"} — gate active (${gate.phase}) for ${gate.site}. Run /logged-in after logging in.`
						: `Login guard ${enabled ? "enabled" : "disabled"} — no active gate.`,
					gate ? "warning" : "info",
				);
			}
		},
	});
}
