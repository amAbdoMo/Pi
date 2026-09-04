import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, app, favicon, appIcon] = await Promise.all([
  readFile(new URL("../browser/public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../browser/public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../browser/public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../browser/public/pi-harness-favicon.png", import.meta.url)),
  readFile(new URL("../browser/public/pi-harness-icon.png", import.meta.url)),
]);

test("responsive shell contains horizontal content and auto-collapses only the narrow breakpoint", () => {
  assert.match(css, /\.app-frame\s*\{[^}]*width:\s*100vw;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.conversation-scroll\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.code-block pre\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /\.table-scroll\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
  assert.match(app, /const compact = innerWidth <= 600;/);
  assert.match(app, /addEventListener\("resize", syncSidebarToViewport\)/);
});

test("sidebar collapse and expansion animate smoothly while respecting reduced motion", () => {
  assert.match(css, /\.app-frame\s*\{[^}]*transition:\s*grid-template-columns 240ms cubic-bezier\(\.22, 1, \.36, 1\);/s);
  assert.match(css, /\.sidebar\s*\{[^}]*transition:\s*padding 240ms cubic-bezier\(\.22, 1, \.36, 1\);/s);
  assert.match(css, /\.profile-trigger-copy\s*\{[^}]*transition:\s*opacity 150ms ease 80ms, visibility 0s;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration:\s*\.001ms !important;/s);
});

test("account controls expose an accessible generic profile menu and responsive manager", () => {
  assert.match(html, /id="profile-trigger"[^>]+aria-haspopup="menu"[^>]+aria-controls="profile-menu"/);
  assert.match(html, /id="profile-menu"[^>]+role="menu"/);
  assert.match(html, /id="accounts-dialog"[^>]+aria-labelledby="accounts-title"/);
  assert.match(html, /id="accounts-title" tabindex="-1"/);
  assert.match(html, /id="accounts-refresh"[^>]*>[\s\S]*?viewBox="0 0 24 24"[\s\S]*?M21 12a9 9/);
  assert.match(html, />Active account</);
  assert.match(html, /Switch accounts in one click/);
  assert.doesNotMatch(html, /Active Codex account|Switch Codex accounts/);
  for (const id of ["profile-identity", "accounts-refresh", "accounts-add", "account-login-cancel"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /id="profile-usage"|id="manage-accounts"|>Usage remaining<|>Manage accounts</);
  assert.match(app, /elements\.profileIdentity\.addEventListener\("click", \(\) => openAccountsDialog\(\)\);/);
  assert.match(css, /\.account-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 190px\) minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.account-card\[data-active="true"\]\s*\{[^}]*border-color:\s*var\(--business\);[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.account-card-copy strong\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*700;/s);
  assert.match(css, /\.usage-window-heading\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*600;/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?#accounts-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 14px\);/s);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.account-card\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(app, /function relativeResetTime\(resetsAtMs, nowMs = Date\.now\(\)\)/);
  assert.match(app, /\/api\/accounts\/activate/);
  assert.match(app, /\/api\/accounts\/login\/cancel/);
  assert.match(app, /state\.streaming \|\| accountUiBusy\(\)/);
  assert.match(app, /`Switch to \$\{account\.name\}`/);
  assert.match(app, /rename\.dataset\.tooltip = "Rename";/);
  assert.match(app, /remove\.dataset\.tooltip = "Remove";/);
  assert.match(app, /secondaryActions\.className = "account-secondary-actions";\s*secondaryActions\.append\(rename, remove\);\s*actions\.append\(switchButton, secondaryActions\);/);
  assert.match(css, /\.account-actions\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*center;/s);
  assert.match(css, /\.account-secondary-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.account-icon-action\s*\{[^}]*background:\s*var\(--interactive-hover\);[^}]*color:\s*var\(--label-tertiary\);/s);
  assert.match(css, /\.account-icon-action:hover:not\(:disabled\), \.account-icon-action:focus-visible\s*\{[^}]*background:\s*var\(--business\);[^}]*color:\s*#fff;/s);
  assert.doesNotMatch(css, /\.account-icon-action\.danger:hover/);
  assert.match(app, /M4 16h3l9-9a2\.12 2\.12 0 0 0-3-3l-9 9v3Z/);
  assert.match(app, /if \(accountUiBusy\(\)\) \{[\s\S]*?Wait for the account update to finish\./);
  assert.match(app, /Connection interrupted; retrying…/);
  assert.match(app, /state\.accountLoginObservedRunning = false;/);
  assert.match(app, /elements\.accountsDialog\.showModal\(\);\s*elements\.accountsTitle\.focus\(\{ preventScroll: true \}\);\s*hideIconTooltip\(\);/);
});

test("every positioned popup is clamped to an eight-pixel viewport boundary", () => {
  assert.match(app, /Math\.max\(8, Math\.min\(preferredLeft, innerWidth - popupRect\.width - 8\)\)/);
  assert.match(app, /innerHeight - popupRect\.height - 8/);
  assert.match(css, /#ui-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);[^}]*overflow:\s*auto;/s);
});

test("external session changes reconcile through the active guarded event stream", () => {
  assert.match(app, /case "session_changed": void syncSessionMessages\(state\.stream, \{ reload: true \}\);/);
  assert.match(app, /api\("\/api\/sessions\/refresh", \{ method: "POST", body: \{\} \}\)/);
  assert.match(app, /if \(!stream \|\| stream !== state\.stream \|\| state\.streaming \|\| state\.activeSessionId === null\) return;/);
  assert.match(app, /sessionRequestId !== state\.sessionOpenRequestId \|\| syncRequestId !== state\.messageSyncRequestId/);
  assert.match(app, /stream\.onopen = \(\) => \{[\s\S]*?void syncSessionMessages\(stream, \{ reload: hasOpened \}\);/);
  assert.match(app, /state\.stream\?\.close\(\);\s*state\.stream = null;\s*const previousSessionId/);
});

test("conversation updates stay pinned to the real scroll container above a bottom gutter", () => {
  assert.match(app, /conversationScroll:\s*document\.querySelector\("\.conversation-scroll"\)/);
  assert.match(app, /function scrollConversationToEnd\(\)\s*\{[^}]*scroller\.scrollTop = scroller\.scrollHeight;[^}]*requestAnimationFrame/s);
  assert.doesNotMatch(app, /elements\.transcript\.scrollTop/);
  assert.ok([...app.matchAll(/scrollConversationToEnd\(\);/g)].length >= 6);
  assert.match(css, /\.composer\s*\{[^}]*bottom:\s*16px;[^}]*margin:\s*0 auto 16px;/s);
});

test("active transcript, message content, and composer share one unobstructed horizontal frame", () => {
  assert.match(css, /\.transcript\s*\{[^}]*width:\s*min\(780px, calc\(100% - 32px\)\);[^}]*max-width:\s*780px;[^}]*padding:\s*24px 0;/s);
  assert.match(css, /\.message\s*\{[^}]*position:\s*relative;[^}]*display:\s*block;/s);
  assert.match(css, /\.composer\s*\{[^}]*width:\s*min\(780px, calc\(100% - 32px\)\);[^}]*max-width:\s*780px;[^}]*box-shadow:\s*var\(--shadow-lv2\), 0 18px 0 18px var\(--bg-base\);/s);
});

test("interactive surfaces expose labels, modal semantics, live regions, and reduced motion", () => {
  for (const id of ["session-actions", "context-trigger", "model-trigger", "commands-trigger", "sidebar-toggle", "abort-run"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]+aria-`), id);
  }
  assert.match(html, /<dialog id="ui-dialog"[^>]+aria-labelledby="dialog-title"/);
  assert.match(html, /role="log" aria-live="polite"/);
  assert.match(html, /id="toast-region"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /closeSessionMenu\(\{ restoreFocus: true \}\)/);
});

test("menu rows, compact model metadata, and composer icons stay visually consistent", () => {
  assert.match(css, /--option-row-gap:\s*3px/);
  for (const selector of [
    ".session-menu button + button",
    ".popup-option + .popup-option",
    ".view-menu button + button",
    ".command-option + .command-option",
  ]) {
    assert.match(css, new RegExp(selector.replaceAll("+", "\\+").replaceAll(".", "\\.")));
  }
  assert.match(html, /class="model-separator"[^>]*>·<\/span>/);
  assert.match(css, /\.send-button:disabled\s*\{[^}]*background:\s*color-mix\([^}]*opacity:\s*1;/s);
  assert.match(html, /<svg class="select-chevron"/);
  assert.match(html, /<svg class="action-icon"/);
  assert.doesNotMatch(html, />⌄<\/span>/);
  assert.match(app, /elements\.model\.textContent = model \? modelLabel\(model\) : "Pi model";/);
  assert.doesNotMatch(app, /elements\.model\.textContent = modelIdentity\(model\);/);
});

test("model selection uses one centered modal and rotates its centered chevron", () => {
  assert.match(html, /<dialog id="model-dialog"[^>]+aria-labelledby="model-dialog-title"/);
  assert.match(html, /<h2 id="model-dialog-title">Pi model &amp; thinking level<\/h2>/);
  assert.doesNotMatch(html, /Choose model and effort/);
  assert.match(html, /class="model-dialog-grid"/);
  assert.match(html, /id="model-options"[^>]+role="listbox"/);
  assert.match(html, /id="thinking-submenu"[^>]+role="radiogroup"/);
  assert.match(css, /#model-dialog\s*\{[^}]*width:\s*min\(780px,[^}]*max-height:\s*calc\(100vh - 32px\)/s);
  assert.match(css, /\.model-dialog-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 210px/s);
  assert.match(css, /\.select-chevron\s*\{[^}]*align-self:\s*center;[^}]*transform-origin:\s*center;/s);
  assert.match(css, /\.model-select\[aria-expanded="true"\] \.select-chevron\s*\{[^}]*rotate\(180deg\)/s);
  assert.match(app, /state\.modelDialogSelectionCount = 0;/);
  assert.match(app, /state\.modelDialogSelectionCount \+= 1;/);
  assert.match(app, /state\.modelDialogSelectionCount < 2/);
  assert.ok([...app.matchAll(/recordModelDialogSelection\(\)/g)].length >= 3);
  assert.match(app, /elements\.modelDialog\.showModal\(\)/);
  assert.match(app, /elements\.modelSearch\.focus\(\)/);
  assert.match(app, /function updateModelState\(runtimeState = \{\}\)/);
  assert.match(app, /connectEvents\(\);\s*\} else \{\s*updateModelState\(runtimeState\);/);
  assert.match(app, /if \(runtimeState\.active\) updateRuntime\(runtimeState\);\s*else updateModelState\(runtimeState\);/);
  assert.match(app, /if \(runtimeState\.active\) updateRuntime\(nextState\);\s*else updateModelState\(nextState\);/);
  assert.match(app, /closeModelDialog\(\{ restoreFocus: true \}\)/);
});

test("fresh chats show one functional Choose Project strip above the composer", () => {
  assert.match(html, /class="fresh-project-picker">[\s\S]*?id="workspace-picker"[\s\S]*?<span>Choose Project<\/span>[\s\S]*?<form class="composer"/);
  assert.doesNotMatch(html, /Choose workspace/);
  assert.match(css, /\.app-frame\[data-session-active="false"\] \.fresh-composer-stack\s*\{[^}]*width:\s*min\(780px, calc\(100% - 32px\)\);[^}]*flex-direction:\s*column;[^}]*margin:\s*0 auto 16px;/s);
  assert.match(css, /\.fresh-project-picker\s*\{[^}]*z-index:\s*6;[^}]*width:\s*calc\(100% - 28px\);[^}]*min-height:\s*50px;[^}]*margin:\s*0 auto -12px;[^}]*border-radius:\s*16px;[^}]*background:\s*var\(--bg-layer-2\);/s);
  assert.match(css, /\.app-frame\[data-session-active="false"\] \.fresh-project-picker\s*\{\s*display:\s*flex;/s);
  assert.match(css, /\.fresh-project-picker button\s*\{[^}]*align-items:\s*center;[^}]*padding:\s*0 14px 12px;/s);
  assert.match(css, /\.app-frame\[data-session-active="false"\] \.composer\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;/s);
  assert.match(app, /api\("\/api\/workspaces\/pick", \{ method: "POST", body: \{\} \}\)/);
  assert.match(app, /if \(state\.workspacePicking\) return;[\s\S]*?setWorkspacePickerBusy\(true\);[\s\S]*?finally \{[\s\S]*?setWorkspacePickerBusy\(false\);/);
  assert.match(app, /return selection\.cancelled \? null : selection\.cwd;/);
  assert.match(app, /updateModelState\(runtimeState\);\s*elements\.input\.disabled = false;\s*elements\.send\.disabled = false;/);
  assert.match(app, /function deactivateSession\(\)[\s\S]*?elements\.input\.disabled = false;[\s\S]*?elements\.input\.focus\(\);/);
  assert.match(app, /if \(state\.activeSessionId === null\) \{\s*const cwd = await requestWorkspace\(\);\s*if \(!cwd \|\| !await openSession\(\{ cwd \}\)\) return;\s*\}/);
  assert.match(app, /elements\.input\.focus\(\);\s*return true;\s*\} catch \(error\)/);
  assert.match(app, /showToast\(error\.message, "error"\);\s*return false;/);
});

test("sub-agent parent updates render as minimal floating cards with icon-led fields", () => {
  assert.match(app, /function subagentNoticeBlock\(content\)/);
  assert.match(app, /subagentNoticeMeta\("Depth"/);
  assert.match(app, /subagentNoticeMeta\("Reason"/);
  assert.match(app, /subagentNoticeMeta\("Type"/);
  assert.match(app, /if \(notice\.blocking\) metadata\.append/);
  assert.match(app, /subagentNoticeSection\("Message"/);
  assert.match(app, /if \(notice\.recommendation\) card\.append/);
  assert.match(css, /\.subagent-notice\s*\{[^}]*border-radius:\s*14px;[^}]*background:\s*var\(--button-floating\);[^}]*box-shadow:\s*var\(--shadow-lv2\);/s);
  assert.match(css, /\.message\[data-role="custom"\] > \.message-header\s*\{\s*display:\s*none;/s);
});

test("active work mirrors the source-derived sidebar chase and chat shimmer", () => {
  assert.match(html, /id="agent-working-status"[^>]+role="status"[^>]+aria-live="polite"[^>]+hidden/);
  assert.match(html, />Deep diving\.\.\.<\/span><time class="agent-working-clock"/);
  assert.match(app, /const SESSION_WORKING_CELLS = Object\.freeze\(\[\s*\[0, 0\], \[4, 0\], \[8, 0\], \[8, 4\], \[8, 8\], \[4, 8\], \[0, 8\], \[0, 4\],/s);
  assert.match(app, /const working = session\.id === state\.activeSessionId && state\.streaming;/);
  assert.match(app, /if \(working\) button\.setAttribute\("aria-label", `\$\{nameText\}, working`\);/);
  assert.match(app, /elements\.agentWorkingClock\.hidden = elapsed < 15_000;/);
  assert.match(app, /window\.setInterval\(updateAgentWorkingClock, 1_000\)/);
  assert.match(app, /syncAgentWorkingStatus\(streaming\);\s*if \(changed\) renderSessions\(\);/);
  assert.match(css, /\.session-working-cell\s*\{[^}]*animation:\s*session-working-chase 1s/s);
  assert.match(css, /@keyframes session-working-chase\s*\{[\s\S]*?12\.5%, 24\.9%\s*\{\s*opacity:\s*\.6;/);
  assert.match(css, /\.agent-working-status\s*\{[^}]*background:\s*linear-gradient\([^}]*animation:\s*agent-working-shimmer 1\.8s linear infinite;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.agent-working-status\s*\{[^}]*animation:\s*none;/s);
});

test("completed assistant turns use one Codex-like sparse activity disclosure", () => {
  assert.match(app, /function collectOperationalContent\(article\)/);
  assert.match(app, /node\.matches\("\.thinking-block, \.tool-row"\)/);
  assert.match(app, /elapsedActivityLabel\(/);
  assert.match(app, /Used \$\{names\}\$\{more\} across \$\{count\} action/);
  assert.match(app, /operations\.forEach\(\(node\) => node\.remove\(\)\)/);
  assert.match(css, /\.turn-activity\s*\{[^}]*margin:\s*0 0 14px;[^}]*color:\s*var\(--label-tertiary\)/s);
  assert.match(css, /\.turn-activity-rule\s*\{[^}]*height:\s*1px;[^}]*flex:\s*1;[^}]*background:\s*var\(--border-l1\)/s);
  assert.match(css, /\.message\[data-role="user"\]\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*82%;[^}]*margin:\s*0 0 28px auto;/s);
  assert.match(css, /\.message\[data-role="assistant"\] > \.message-header\s*\{\s*display:\s*none;/s);
});

test("floating notices use one compact alert icon and fit their content", () => {
  assert.match(app, /function toastIcon\(\)/);
  assert.match(app, /toast\.append\(toastIcon\(\), text\)/);
  assert.match(app, /const existingToast = matchingToast\(message, tone\);\s*if \(existingToast\) \{\s*scheduleToastRemoval\(existingToast\);\s*return;/s);
  assert.match(html, /<main class="conversation-root">[\s\S]*id="toast-region"[\s\S]*<\/main>\s*<aside class="details-panel"/);
  assert.match(css, /\.conversation-root\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.toast-region\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*123px 0 auto;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*justify-items:\s*center;/s);
  assert.doesNotMatch(css, /\.toast-region\s*\{[^}]*left:\s*50%|\.toast-region\s*\{[^}]*translateX\(-50%\)/s);
  assert.match(css, /\.toast\s*\{[^}]*width:\s*fit-content;[^}]*min-height:\s*44px;[^}]*padding:\s*8px 15px;[^}]*border-radius:\s*15px;/s);
  assert.match(css, /\.toast svg\s*\{[^}]*width:\s*17px;[^}]*color:\s*rgb\(224 139 39\);/s);
});

test("conversation days are centered and copy actions use conventional icons", () => {
  assert.match(app, /function conversationSeparator\(timestamp\)/);
  assert.match(app, /day !== localDayKey\(state\.lastMessageTimestamp\)/);
  assert.match(app, /function copyButtonIcon\(copied = false\)/);
  assert.match(app, /button\.replaceChildren\(copyButtonIcon\(copied\)\)/);
  assert.doesNotMatch(app, /button\.textContent = "Copy"/);
  assert.match(css, /\.conversation-separator\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
  assert.match(css, /\.copy-button, \.message-copy\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*place-items:\s*center;/s);
});

test("completed tasks render an exact edited-files card with review and safe undo", () => {
  assert.match(app, /case "workspace_edit_summary": renderTaskEditSummary\(event\);/);
  assert.match(app, /className = "task-edit-card"/);
  assert.match(app, /className = "task-edit-path"/);
  assert.match(app, /className = "task-edit-counts"/);
  assert.match(app, /card\.dataset\.sessionId = String\(state\.activeSessionId \?\? ""\)/);
  assert.match(app, /const preservedEditCards = clearRenderedMessages\(\)/);
  assert.match(app, /elements\.transcript\.append\(\.\.\.preservedEditCards\)/);
  assert.match(app, /\/api\/task-edits\/\$\{encodeURIComponent\(summary\.id\)\}\/undo/);
  assert.match(app, /showToolDetails\(\{ title: `Edited \$\{summary\.files\.length\} files`, output: response\.patch/);
  assert.match(css, /\.task-edit-card\s*\{[^}]*margin:\s*2px 0 28px;[^}]*border-radius:\s*12px;[^}]*background:\s*var\(--bg-layer-1\)/s);
  assert.match(css, /\.task-edit-file\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.task-edit-counts span:first-child[^}]*color:\s*var\(--success/s);
});

test("command picker mirrors the compact two-column action menu", () => {
  assert.match(css, /\.command-menu\s*\{[^}]*max-height:\s*min\(380px,[^}]*border-radius:\s*14px/s);
  assert.match(css, /\.command-option\s*\{[^}]*grid-template-columns:\s*minmax\(120px, 190px\) minmax\(0, 1fr\);[^}]*min-height:\s*36px/s);
  assert.match(css, /\.command-option span\s*\{[^}]*text-align:\s*right/s);
  assert.match(app, /elements\.commandMenu\.style\.width = `\$\{elements\.composer\.getBoundingClientRect\(\)\.width\}px`/);
  assert.match(app, /positionAbove\(elements\.composer, elements\.commandMenu, \{ align: "left", gap: 8 \}\)/);
});

test("keyboard focus uses inset or background states without visible outlines", () => {
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*none;/);
  assert.doesNotMatch(css, /outline-offset/);
  const visibleOutline = [...css.matchAll(/outline:\s*([^;]+);/g)]
    .map((match) => match[1].trim())
    .find((value) => value !== "none" && value !== "0");
  assert.equal(visibleOutline, undefined);
  assert.match(css, /button:focus-visible[^\{]*\{[^}]*background:\s*var\(--interactive-hover\)/s);
  assert.match(css, /\.composer textarea:focus-visible\s*\{\s*box-shadow:\s*none;/);
});

test("supplied Pi Harness artwork is wired to browser and in-app brand surfaces", () => {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(favicon.subarray(0, 4), pngSignature);
  assert.deepEqual(appIcon.subarray(0, 4), pngSignature);
  assert.match(html, /rel="icon"[^>]+href="\/pi-harness-favicon\.png"/);
  assert.match(html, /class="brand-mark"[^>]+src="\/pi-harness-icon\.png"/);
  assert.match(html, /class="hero-mark"[^>]+src="\/pi-harness-icon\.png"/);
  assert.match(html, /class="brand-name">Pi Harness<\/span>/);
  assert.doesNotMatch(html, /build-revision|>HARNESS<\/span>/);
  assert.match(css, /\.hero-headline\s*\{[^}]*grid-template-columns:\s*52px auto;/s);
  assert.doesNotMatch(html, /preview-badge|>Preview</);
});

test("sidebar session rows contain titles only and use conventional action icons", () => {
  const sessionButtonSource = app.match(/function sessionOpenButton\(session\)[\s\S]*?function pinSessionButton/)?.[0] ?? "";
  const sessionEntrySource = app.match(/function sessionEntry\(session\)[\s\S]*?function sessionMoreButton/)?.[0] ?? "";
  assert.match(sessionButtonSource, /button\.append\(name\)/);
  assert.match(sessionEntrySource, /return row;/);
  assert.doesNotMatch(sessionButtonSource, /session-preview|session-meta|formatAge|session\.cwd|updatedAt/);
  assert.match(html, /id="new-session"[\s\S]*?<svg[^>]+>[\s\S]*?m9 11 1-\.2 6\.1-6\.1/i);
  const projectButton = html.match(/<button[^>]+id="add-workspace"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(projectButton, /aria-label="Start in a new project"[^>]+data-tooltip="New project"/);
  assert.equal([...projectButton.matchAll(/<path /g)].length, 1);
  assert.doesNotMatch(projectButton, /M14\.5 2\.75|M12\.25 5/);
  assert.doesNotMatch(html, /workspace-tree-label|>Pi sessions</);
  assert.doesNotMatch(app, /workspaceTreeLabel/);
  assert.match(html, /id="settings-trigger"[\s\S]*?<svg[^>]+>[\s\S]*?<circle cx="10" cy="9" r="2\.25"/);
});

test("settings tabs use compact outline icons and expose the MCP manager", () => {
  for (const tab of ["general", "models", "extensions", "mcp", "archive"]) {
    assert.match(html, new RegExp(`data-settings-tab="${tab}">[\\s\\S]*?<svg[^>]+viewBox="0 0 20 20"[\\s\\S]*?<span>`, "i"));
  }
  assert.match(css, /\.settings-tab svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*stroke-width:\s*1\.45;/s);
  assert.match(html, /id="settings-panel-mcp" role="tabpanel"[^>]+data-settings-panel="mcp" hidden/);
  assert.match(html, /id="mcp-list"[^>]+aria-live="polite"[^>]+aria-busy="true"/);
  assert.match(html, /id="mcp-form" hidden/);
  assert.match(html, /data-mcp-transport="stdio"/);
  assert.match(html, /data-mcp-transport="streamable-http"/);
  assert.match(app, /if \(tab\.dataset\.settingsTab === "mcp"\) void loadMcpSettings\(\);/);
  assert.match(app, /state\.mcpTestGeneration \+= 1;\s*state\.mcpTestResults\.clear\(\);/);
  assert.match(app, /if \(generation !== state\.mcpTestGeneration\) return;/);
  assert.match(app, /for \(const control of elements\.mcpForm\.querySelectorAll\("button, input"\)\) control\.disabled = surfaceBusy;/);
  assert.match(app, /credential\.action === "delete" && existing && existing\.action !== "delete"/);
  assert.match(app, /const configValues = \{ env: \{\}, headers: \{\} \};/);
  assert.match(app, /state\.mcpApplying \|\| state\.mcpLoading/);
  assert.match(css, /\.mcp-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items:\s*stretch;[^}]*gap:\s*10px;/s);
  assert.match(css, /\.mcp-card\s*\{[^}]*min-height:\s*158px;[^}]*border-radius:\s*14px;/s);
  assert.match(css, /\.mcp-card-heading\s*\{[^}]*display:\s*flex;[^}]*height:\s*126px;[^}]*flex-direction:\s*column;[^}]*justify-content:\s*space-between;/s);
  assert.match(css, /\.mcp-card-actions\s*\{[^}]*min-height:\s*30px;[^}]*justify-content:\s*flex-end;/s);
  assert.match(css, /\.mcp-card-actions \.extension-toggle\s*\{[^}]*margin-right:\s*auto;/s);
  assert.match(css, /\.mcp-list::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent;/s);
  assert.match(app, /case "workspace_edit_summary": renderTaskEditSummary\(event\);/);
});

test("session hover actions pin or archive locally and Settings can restore archived sessions", () => {
  assert.match(html, /data-settings-tab="archive">[\s\S]*?<span>Archive<\/span><\/button>/);
  assert.match(html, /role="tab" aria-selected="false" aria-controls="settings-panel-archive" tabindex="-1" data-settings-tab="archive"/);
  assert.match(html, /id="settings-panel-archive" role="tabpanel" aria-labelledby="settings-tab-archive" data-settings-panel="archive" hidden/);
  assert.match(html, /id="archived-sessions"[^>]+aria-live="polite"/);
  assert.match(html, /class="archive-delete-all" id="archive-delete-all"[^>]+hidden>[\s\S]*?<span>Delete all<\/span>/);
  assert.doesNotMatch(html, /Restore all/);
  assert.match(html, /id="session-tooltip"[^>]+role="tooltip"[^>]+hidden/);
  assert.match(html, /id="icon-tooltip"[^>]+role="tooltip"[^>]+hidden/);
  assert.match(css, /\.icon-tooltip\s*\{[^}]*position:\s*fixed;[^}]*border-radius:\s*7px;[^}]*background:\s*rgb\(53, 54, 56\);[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.session-entry\s*\{[^}]*padding:\s*7px 8px;/s);
  assert.match(css, /\.session-row:hover \.session-entry[^\{]*\{[^}]*padding-right:\s*62px;/s);
  assert.match(css, /\.session-name\s*\{[^}]*flex:\s*1;[^}]*text-overflow:\s*clip;[^}]*mask-image:\s*linear-gradient\(to right,[^}]*transparent 100%\)/s);
  assert.match(css, /\.session-row-action\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /\.session-row:hover \.session-row-actions[^\{]*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*?\.session-entry\s*\{[^}]*padding-right:\s*62px;[\s\S]*?\.session-row-actions\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(css, /\.session-tooltip\s*\{[^}]*position:\s*fixed;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /#settings-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);[^}]*overflow:\s*hidden;/s);
  assert.match(app, /sessionPreferences:\s*readSessionPreferences\(localStorage\)/);
  assert.match(app, /writeSessionPreferences\(localStorage, preferences\)/);
  assert.match(app, /showToast\(message\);\s*restoreFocus\?\.\(\);/);
  assert.match(app, /label: `\$\{verb\} \$\{sessionDisplayName\(session\)\}`/);
  assert.match(app, /label: `Archive \$\{sessionDisplayName\(session\)\}`/);
  assert.match(app, /`Restore \$\{sessionDisplayName\(session\)\}`,[\s\S]*?"Restore"/);
  assert.match(app, /`Delete \$\{sessionDisplayName\(session\)\}`,[\s\S]*?"Delete"/);
  assert.doesNotMatch(app, /button\.title = label/);
  assert.match(app, /archiveDateFormatter\.format\(new Date\(session\.updatedAt\)\)/);
  assert.match(app, /title: "Delete archived session\?"[\s\S]*?confirmLabel: "Delete"/);
  assert.match(app, /title: "Delete all archived sessions\?"[\s\S]*?confirmLabel: "Delete all"/);
  assert.match(app, /elements\.archiveDeleteAll\.addEventListener\("click"/);
  assert.match(css, /\.archive-row\s*\{[^}]*border:\s*1px solid var\(--border-l2\);[^}]*border-radius:\s*14px;/s);
  assert.match(css, /\.archive-list\s*\{[^}]*scrollbar-color:\s*var\(--label-caption\) transparent;/s);
  assert.match(css, /\.archive-list::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/s);
  assert.match(css, /\.archive-list::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--label-caption\);[^}]*background-clip:\s*padding-box;/s);
  assert.match(app, /togglePinnedSession\(state\.sessionPreferences, session\.id\)/);
  assert.match(app, /archiveSession\(state\.sessionPreferences, session\.id\)/);
  assert.match(app, /restoreSession\(state\.sessionPreferences, session\.id\)/);
  assert.match(app, /function pinnedSessionSection\(sessions\)[\s\S]*?title\.textContent = "Pinned";[\s\S]*?sessions\.map\(sessionEntry\)/);
  assert.match(app, /function recentSessionSection\(sessions\)[\s\S]*?title\.textContent = "Recents";[\s\S]*?sessions\.map\(sessionEntry\)/);
  assert.match(app, /pinnedSessionSection\(pinned\)[\s\S]*?recentSessionSection\(regular\)/);
  assert.match(app, /workspaceGroups\(sessions, state\.sessionView\.orderBy\)[\s\S]*?regularIds\.has\(session\.id\)/);
  assert.match(app, /sessionNodes\(sessionPartitions\(matches\)\)/);
  assert.match(app, /state\.sessionPreferences\.pinned\.includes\(session\.id\)\) button\.append\(sessionPinnedMark\(\)\)/);
  assert.match(app, /sessionActionIcon\(SESSION_PIN_ICON_PATHS\)/);
  assert.match(app, /paths: SESSION_PIN_ICON_PATHS/);
  assert.match(app, /paths: SESSION_ARCHIVE_ICON_PATHS/);
  assert.match(css, /\.pinned-sessions-title, \.recent-sessions-title\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*600;/s);
  assert.match(css, /\.session-pinned-mark\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s);
  assert.match(app, /elements\.sessionList\.addEventListener\("scroll", hideSessionTooltip/);
  assert.match(app, /document\.addEventListener\("pointerover"[\s\S]*?showIconTooltip\(anchor\)/);
  assert.match(app, /document\.addEventListener\("focusin"[\s\S]*?showIconTooltip\(anchor\)/);
  assert.match(app, /button\.setAttribute\("aria-selected", String\(active\)\)/);
});

test("composer uses real approval modes, aligned model metadata, and a conventional pin", () => {
  assert.doesNotMatch(html, /id="agent-mode"|>Pi mode</);
  assert.match(html, /id="permission-status"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  for (const mode of ["read-only", "workspace-write", "full-access"]) {
    assert.match(html, new RegExp(`role="menuitemradio" data-approval-mode="${mode}"`));
  }
  assert.match(css, /#model-trigger\s*\{\s*transform:\s*translateY\(2px\);\s*\}/);
  assert.match(css, /\.mode-select \.select-chevron\s*\{[^}]*transform:\s*translateY\(3px\)/s);
  assert.match(css, /\.model-select \.select-chevron\s*\{[^}]*transform:\s*translateY\(3px\)/s);
  assert.match(css, /\.mode-select\[aria-expanded="true"\] \.select-chevron\s*\{[^}]*translateY\(3px\) rotate\(180deg\)/s);
  assert.match(css, /\.model-select\[aria-expanded="true"\] \.select-chevron\s*\{[^}]*translateY\(3px\) rotate\(180deg\)/s);
  assert.match(css, /\.approval-menu button\[aria-checked="true"\]::after\s*\{[^}]*content:\s*"✓"/s);
  assert.match(app, /readApprovalMode\(localStorage\)/);
  assert.match(app, /api\("\/api\/approval-mode", \{ method: "POST", body: \{ mode: state\.approvalMode \} \}\)/);
  assert.doesNotMatch(app, /APPROVAL_MODE_DETAILS\[mode\]\.label} enabled/);
  assert.match(app, /m7\.25 9\.75 1\.75 1\.75 3\.75-4/);
  assert.match(app, /viewBox: "0 0 16 16"/);
  assert.match(app, /M8\.08887 0\.251709C8\.20479 0\.23085/);
  assert.match(app, /M8\.14852 14\.1308L7\.33925 15\.4976/);
  assert.match(css, /svg\.approval-filled-icon[^\{]*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*fill:\s*currentColor;[^}]*stroke:\s*none;/s);
  assert.match(app, /"M7 3\.5h6l-\.75 5 2 2V12h-9v-1\.5l2-2z"/);
  assert.doesNotMatch(app, /M13\.1 3\.5a2\.4/);
});

test("appearance choices use centered conventional theme icons", () => {
  for (const choice of ["light", "dark", "system"]) {
    const button = html.match(new RegExp(`<button[^>]+data-theme-choice="${choice}"[\\s\\S]*?<\\/button>`))?.[0] ?? "";
    assert.match(button, /<svg viewBox="0 0 20 20" aria-hidden="true">/);
    assert.match(button, new RegExp(`<span>${choice[0].toUpperCase()}${choice.slice(1)}<\\/span>`));
  }
  assert.match(css, /\.appearance button\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*align-content:\s*center;[^}]*gap:\s*7px;/s);
  assert.match(css, /\.appearance button svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
});

test("settings models expose guided provider CRUD without returning saved keys to the form", () => {
  assert.match(html, /id="provider-add"[^>]*>[\s\S]*?<span>Add provider<\/span>/);
  assert.match(html, /id="provider-form"[^>]+hidden/);
  assert.match(html, /id="provider-id"[^>]+pattern="\[a-z0-9\]\[a-z0-9\._-\]\{0,63\}"/);
  assert.match(html, /id="provider-api-key"[^>]+type="password"[^>]+autocomplete="new-password"/);
  assert.doesNotMatch(html, /<select[^>]+id="provider-api"/);
  assert.match(html, /id="provider-api"[^>]+aria-haspopup="listbox"[^>]+aria-expanded="false"[^>]+aria-controls="provider-api-options"/);
  assert.match(html, /id="provider-api-options"[^>]+role="listbox"[^>]+hidden/);
  assert.equal([...html.matchAll(/role="option"[^>]+data-provider-api=/g)].length, 4);
  assert.match(html, /id="provider-model-list"/);
  assert.match(css, /\.provider-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.provider-add, \.provider-models-heading button\s*\{[^}]*border:\s*1px dashed var\(--border-l3\);[^}]*border-radius:\s*12px;[^}]*background:\s*transparent;/s);
  assert.match(html, /id="provider-model-add"[^>]*>[\s\S]*?<svg[^>]*>[\s\S]*?<span>Add model<\/span>/);
  assert.match(css, /\.provider-fields label[^\{]*\{[^}]*display:\s*grid;[^}]*gap:\s*5px;/s);
  assert.doesNotMatch(app, /checkbox\("Reasoning"|checkbox\("Image input"|name="reasoning"|name="imageInput"/);
  assert.doesNotMatch(css, /\.provider-model-options/);
  assert.match(app, /row\.dataset\.reasoning = String\(model\.reasoning === true\)/);
  assert.match(app, /row\.dataset\.imageInput = String\(model\.input\?\.includes\("image"\) === true\)/);
  assert.match(app, /function setProviderApi\(api, \{ focus = false \} = \{\}\)/);
  assert.match(app, /function moveProviderApiOption\(event\)/);
  assert.match(app, /elements\.providerApi\.addEventListener\("keydown"/);
  assert.match(app, /closeProviderApiMenu\(\{ restoreFocus: true \}\)/);
  assert.match(app, /api\("\/api\/providers"\)/);
  assert.match(app, /api\("\/api\/providers\/apply", \{ method: "POST", body \}\)/);
  assert.match(app, /body: \{ providerId: provider\.id, deleteCredential \}/);
  assert.match(app, /elements\.providerApiKey\.value = "";[\s\S]*?api\("\/api\/providers\/apply"/);
  assert.match(app, /if \(tab\.dataset\.settingsTab === "models"\) void loadProviders\(\)/);
});

test("settings extensions use staged accessible cards and a vertically centered close icon", () => {
  assert.match(html, /id="settings-close"[^>]+data-tooltip="Close">\s*<svg[^>]+>[\s\S]*?m5\.5 5\.5 9 9/);
  assert.match(css, /\.dialog-close\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*height:\s*30px;/s);
  assert.match(css, /\.dialog-close svg\s*\{[^}]*display:\s*block;[^}]*width:\s*17px;[^}]*height:\s*17px;/s);
  assert.match(html, /id="extension-list"[^>]+aria-live="polite"[^>]+aria-busy="true"/);
  assert.match(html, /id="extensions-apply"[^>]+disabled>Apply and reload<\/button>/);
  assert.match(css, /\.extension-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.extension-card\s*\{[^}]*border:\s*1px solid var\(--border-l2\);[^}]*border-radius:\s*12px;/s);
  assert.match(css, /\.extension-toggle\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--business\)/s);
  assert.match(app, /toggle\.setAttribute\("role", "switch"\)/);
  assert.match(app, /api\("\/api\/extensions"\)/);
  assert.match(app, /api\("\/api\/extensions\/apply", \{ method: "POST", body: \{ enabled \} \}\)/);
  assert.match(app, /setExtensionTogglesDisabled\(true\)[\s\S]*?setExtensionTogglesDisabled\(false\)/);
  assert.match(app, /if \(tab\.dataset\.settingsTab === "extensions"\) void loadExtensions\(\)/);
});

test("initial page boot shows only the animated Pi mark until session restoration settles", () => {
  assert.match(html, /<body data-theme="dark" data-booting="true">/);
  assert.match(html, /class="boot-screen" role="status" aria-label="Loading Pi Harness">[\s\S]*?class="boot-brand"[\s\S]*?<img src="\/pi-harness-icon\.png"[\s\S]*?<span>Pi Harness<\/span>/);
  assert.match(css, /\.boot-screen\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*display:\s*none;[^}]*place-items:\s*center;/s);
  assert.match(css, /body\[data-booting="true"\] \.boot-screen\s*\{\s*display:\s*grid;/s);
  assert.match(css, /\.boot-brand\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*12px;/s);
  assert.match(css, /body\[data-booting="true"\] #app,[^{]+\{\s*visibility:\s*hidden;/s);
  assert.match(css, /\.boot-screen img\s*\{[^}]*animation:\s*harness-pulse 1\.5s ease-in-out infinite;/s);
  assert.match(app, /finally \{\s*document\.body\.removeAttribute\("data-booting"\);\s*\}/);
});

test("restored tabs retry while the background harness starts or awaits one-time authentication", () => {
  assert.match(app, /const HARNESS_RETRY_DELAYS_MS = \[500, 1_000, 2_000, 5_000\]/);
  assert.match(app, /error instanceof TypeError \|\| error\.message === "Authentication required"/);
  assert.match(app, /await new Promise\(\(resolve\) => setTimeout\(resolve, delay\)\)/);
  assert.match(app, /await authenticateWhenAvailable\(\)/);
  assert.doesNotMatch(app, /Launch Pi Harness from its terminal command/);
});

test("session navigation selects immediately and shows a branded loading state", () => {
  assert.match(html, /id="conversation-loading"[^>]+role="status"[^>]+aria-live="polite"[^>]+hidden/);
  assert.match(html, /id="conversation-loading"[\s\S]*?pi-harness-icon\.png[\s\S]*?Loading conversation…/);
  assert.match(css, /\.conversation-loading img\s*\{[^}]*animation:\s*harness-pulse/s);
  assert.match(css, /\.transcript\[data-loading="true"\][^{]*\{[^}]*place-items:\s*center/s);
  assert.match(css, /\.transcript\[data-loading="true"\] > :not\(\.conversation-loading\)\s*\{[^}]*display:\s*none;/s);
  const openSessionSource = app.match(/async function openSession\(selection\)\s*\{.*?\n\}/s)?.[0] ?? "";
  assert.ok(openSessionSource.indexOf("renderSessions();") < openSessionSource.indexOf('await api("/api/sessions/open"'));
  assert.ok(openSessionSource.indexOf("setConversationLoading(true);") < openSessionSource.indexOf('await api("/api/sessions/open"'));
  assert.match(openSessionSource, /requestId !== state\.sessionOpenRequestId/);
  assert.match(openSessionSource, /previousSessionId = state\.confirmedSessionId/);
  assert.match(app, /elements\.transcript\.setAttribute\("aria-busy", String\(loading\)\)/);
});
