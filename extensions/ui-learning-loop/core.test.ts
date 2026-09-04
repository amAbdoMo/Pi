import assert from "node:assert/strict";
import { mkdtemp, readFile, rm as remove } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	inferUiIssueKey,
	inferUiTags,
	isUiCorrection,
	LessonStore,
	redactSensitiveText,
	sanitizeCorrection,
} from "./core.ts";

async function temporaryStore(): Promise<{ directory: string; store: LessonStore }> {
	const directory = await mkdtemp(join(tmpdir(), "pi-ui-learning-"));
	return { directory, store: new LessonStore(join(directory, "lessons.json")) };
}

async function rm(directory: string, options: { recursive: true; force: true }): Promise<void> {
	await remove(directory, { ...options, maxRetries: 10, retryDelay: 25 });
}

test("detects explicit UI corrections", () => {
	assert.equal(isUiCorrection("The dropdown is still using the native style", false), true);
	assert.equal(isUiCorrection("The button text is not centered again", false), true);
	assert.equal(isUiCorrection("Please fix this dropdown, it is getting cut", false), true);
	assert.equal(isUiCorrection("The icon text is not perfectly centerd vertically", false), true);
	assert.equal(isUiCorrection("Do not change the database query", false), false);
});

test("uses recent UI context for short follow-up corrections", () => {
	assert.equal(isUiCorrection("It is still wrong and too low", true), true);
	assert.equal(isUiCorrection("It is still wrong and too low", false), false);
	assert.equal(isUiCorrection("looks great", true), false);
});

test("captures corrective UI steering without treating ordinary steering as a lesson", () => {
	assert.equal(isUiCorrection("center that", true, true), true);
	assert.equal(isUiCorrection("Looks great", true, true), false);
	assert.equal(isUiCorrection("Continue", true, true), false);
	assert.equal(isUiCorrection("Build a new WordPress UI layout; it should be responsive", false), false);
	assert.equal(isUiCorrection("/ui-learning off", true, true), false);
});

test("redacts likely credentials and caps correction text", () => {
	// Provider-shaped fixtures exercise redaction and are allowlisted one line at a time by the public scan.
	const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123"; // public-scan: synthetic-credential
	const redacted = redactSensitiveText([
		'password=hunter2 token:abc123 {"password":"json-secret"}',
		"Authorization: Bearer short",
		"Cookie: session=browser-secret",
		"OPENAI_API_KEY=sk-proj-1234567890abcdef", // public-scan: synthetic-credential
		'{"access_token":"oauth-secret","clientSecret":"client-secret"}',
		jwt,
		"https://me:pw@example.com",
	].join("\n"));
	for (const secret of ["hunter2", "abc123", "json-secret", "Bearer short", "browser-secret", "sk-proj-1234567890abcdef", "oauth-secret", "client-secret", jwt, "me:pw"]) { // public-scan: synthetic-credential
		assert.equal(redacted.includes(secret), false, `secret was not redacted: ${secret}`);
	}
	assert.equal(sanitizeCorrection("x".repeat(2_000)).length, 1_200);
});

test("infers reusable UI categories", () => {
	assert.deepEqual(inferUiTags("The Elementor dropdown is clipped on mobile and not centered"), [
		"alignment",
		"dropdown",
		"frontend-widget",
		"responsive",
	]);
	assert.equal(inferUiIssueKey("The settings dropdown is getting cut"), "dropdown-clipping");
	assert.equal(inferUiIssueKey("Button icon and text are not centered vertically"), "control-vertical-alignment");
	assert.equal(inferUiIssueKey("The bottom padding still does not match the top"), "spacing-symmetry");
	assert.equal(inferUiIssueKey("Make labels on top and fields under them"), "field-label-layout");
	assert.equal(inferUiIssueKey("The checkboxes still have an issue"), "custom-control-consistency");
	assert.equal(inferUiIssueKey("These colors do not work when clicked"), "interactive-color-state");
	assert.equal(inferUiIssueKey("The floating label should move on focus"), "floating-label-state");
});

test("sanitizes correction text at the storage boundary", async () => {
	const { directory, store } = await temporaryStore();
	try {
		await store.capture({
			text: 'The field is wrong {"password":"json-secret"} Authorization: Bearer short',
			cwd: "C:/one",
			source: "automatic",
		});
		const stored = (await store.list())[0].correction;
		assert.equal(stored.includes("json-secret"), false);
		assert.equal(stored.includes("Bearer short"), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("deduplicates exact corrections and counts occurrences", async () => {
	const { directory, store } = await temporaryStore();
	try {
		const request = {
			text: "The dropdown is still native",
			cwd: "C:/project",
			source: "automatic" as const,
			tags: ["dropdown"],
		};
		const first = await store.capture(request);
		const second = await store.capture({ ...request, source: "manual" });
		assert.equal(first.created, true);
		assert.equal(second.created, false);
		assert.equal(second.lesson.occurrenceCount, 2);
		assert.equal((await store.list()).length, 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("groups differently worded corrections by canonical issue", async () => {
	const { directory, store } = await temporaryStore();
	try {
		await store.capture({ text: "The button text is too high", cwd: "C:/one", source: "automatic" });
		const grouped = await store.capture({ text: "Icon and text are not centered vertically in buttons", cwd: "C:/two", source: "history" });
		assert.equal((await store.list()).length, 1);
		assert.equal(grouped.lesson.issueKey, "control-vertical-alignment");
		assert.equal(grouped.lesson.occurrenceCount, 2);
		assert.equal(grouped.lesson.examples.length, 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("reopens a promoted lesson when the same correction recurs", async () => {
	const { directory, store } = await temporaryStore();
	try {
		const first = await store.capture({ text: "Button text is still too low", cwd: "C:/one", source: "automatic" });
		await store.updateStatus(first.lesson.id, "promoted", "Skill updated");
		const recurrence = await store.capture({ text: "Button text is still too low", cwd: "C:/two", source: "automatic" });
		assert.equal(recurrence.reopened, true);
		assert.equal(recurrence.lesson.status, "pending");
		assert.equal(recurrence.lesson.occurrenceCount, 2);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("keeps project-only lessons isolated from other projects", async () => {
	const { directory, store } = await temporaryStore();
	try {
		const first = await store.capture({ text: "Tabs should never stretch full width", cwd: "C:/project-one", source: "manual" });
		await store.updateStatus(first.lesson.id, "project", "Only this plugin uses that layout");
		const otherProject = await store.capture({ text: "Tabs should never stretch full width", cwd: "C:/project-two", source: "automatic" });
		assert.equal(otherProject.created, true);
		assert.equal((await store.list()).length, 2);
		const sameProject = await store.capture({ text: "Tabs should never stretch full width", cwd: "c:\\project-one\\", source: "automatic" });
		assert.equal(sameProject.created, false);
		assert.equal(sameProject.reopened, true);
		assert.equal(sameProject.lesson.scope, "project");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("serializes concurrent captures without losing occurrences", async () => {
	const { directory, store } = await temporaryStore();
	try {
		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				store.capture({ text: "The custom select is still wrong", cwd: `C:/project-${index}`, source: "automatic" }),
			),
		);
		const lessons = await store.list();
		assert.equal(lessons.length, 1);
		assert.equal(lessons[0].occurrenceCount, 8);
		assert.equal(lessons[0].occurrences.length, 8);
		JSON.parse(await readFile(store.storePath, "utf8"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("persists enabled state, status, notes, and deletion", async () => {
	const { directory, store } = await temporaryStore();
	try {
		await store.setEnabled(false);
		const capture = await store.capture({ text: "Tabs should never stretch full width", cwd: "C:/project", source: "manual" });
		const updated = await store.updateStatus(capture.lesson.id, "project", "Only this plugin uses that layout");
		assert.equal((await store.read()).enabled, false);
		assert.equal(updated.note, "Only this plugin uses that layout");
		assert.equal(updated.scope, "project");
		assert.equal(await store.remove(capture.lesson.id), true);
		assert.equal((await store.list()).length, 0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
