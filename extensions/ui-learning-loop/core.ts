import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type LessonStatus = "pending" | "reviewing" | "promoted" | "project" | "dismissed";
export type CaptureSource = "automatic" | "manual" | "agent" | "history";

export interface LessonOccurrence {
	capturedAt: string;
	cwd: string;
	sessionFile?: string;
	source: CaptureSource;
}

export interface UiLesson {
	id: string;
	fingerprint: string;
	issueKey?: string;
	correction: string;
	examples: string[];
	tags: string[];
	status: LessonStatus;
	scope?: "project";
	occurrenceCount: number;
	createdAt: string;
	updatedAt: string;
	occurrences: LessonOccurrence[];
	note?: string;
}

export interface LessonData {
	version: 1;
	enabled: boolean;
	lessons: UiLesson[];
}

export interface CaptureRequest {
	text: string;
	cwd: string;
	sessionFile?: string;
	source: CaptureSource;
	tags?: string[];
	issueKey?: string;
}

export interface CaptureResult {
	lesson: UiLesson;
	created: boolean;
	reopened: boolean;
}

const EMPTY_DATA: LessonData = { version: 1, enabled: true, lessons: [] };
const MAX_CORRECTION_LENGTH = 1_200;
const MAX_OCCURRENCES = 10;
const LOCK_ATTEMPTS = 20;
const LOCK_DELAY_MS = 25;
const STALE_LOCK_MS = 60_000;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SENSITIVE_KEY_SOURCE = "(?:password|passwd|secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|authorization|cookie|set-cookie)";
const JSON_SECRET_PATTERN = new RegExp(`([\"']${SENSITIVE_KEY_SOURCE}[\"']\\s*:\\s*)[\"'][^\"']*[\"']`, "gi");
const NAMED_SECRET_PATTERN = new RegExp(`\\b(${SENSITIVE_KEY_SOURCE})\\b\\s*[:=]\\s*(?:[\"'][^\"']*[\"']|[^\\s,;}\\]]+)`, "gi");

const UI_PATTERN = /\b(ui|design|layout|dropdown|select|combobox|button|tab|card|form|field|label|icon|heading|control|align(?:ed|ment)?|cent(?:er|ered|erd|ering)|vertically|spacing|padding|margin|responsive|mobile|desktop|font|color|border|hover|focus|menu|modal|popup|elementor|widget|wordpress|woocommerce|front[- ]?end|admin screen)\b/i;
const CORRECTION_PATTERN = /\b(still|again|same issue|issue with|please fix|fix this|wrong|misaligned|not aligned|not cent(?:er|ered|erd)|not perfectly|getting cut|is not|isn't|isnt|too (?:high|low|wide|narrow|large|small)|instead of|i (?:said|asked|prefer)|do not|don't|does not|doesn't|should not|shouldn't|always use|never use|why is|looks? (?:off|wrong|bad)|does not work|doesn't work|native dropdown|default dropdown|repeated issue)\b/i;
const STEERING_CORRECTION_PATTERN = /\b(move|change|replace|remove|increase|decrease|fix|align|center|use .* instead|make .* (?:higher|lower|wider|narrower))\b/i;
const UI_ISSUE_RULES: ReadonlyArray<readonly [string, readonly RegExp[]]> = [
	["dropdown-clipping", [/\b(dropdown|select|combobox|menu)\b/, /\b(cut|clipp?ed|overflow|outside|hidden)\b/]],
	["control-vertical-alignment", [/\b(text|icon|button|tab|label|field|heading|control)\b/, /\b(align|center|centred|centered|centerd|vertically|too high|too low|upper|line[- ]?height|go up|go down)\b/]],
	["spacing-symmetry", [/\b(padding|margin|spacing|space|gap)\b/, /\b(top|bottom|left|right|white|match|same|still)\b/]],
	["floating-label-state", [/\b(placeholder|floating label)\b/, /\b(focus|border|center|background|float|move)\b/]],
	["field-label-layout", [/\b(label|labels|placeholder|placeholders)\b/, /\b(top|above|under)\b/]],
	["custom-control-consistency", [/\b(checkbox|checkboxes|radio|date picker)\b/, /\b(custom|native|default|still|issue|wrong)\b/]],
	["interactive-color-state", [/\b(color|colors|swatch|swatches)\b/, /\b(click|change|work|working|selected|state)\b/]],
	["focus-treatment", [/\b(outline|focus ring|ring)\b/, /\b(tab|button|field|control|click|focus)\b/]],
	["custom-control-consistency", [/\b(custom|native|default)\b/, /\b(dropdown|select|checkbox|radio|date picker|field|control)\b/]],
	["card-layout-consistency", [/\b(card|cards)\b/, /\b(full width|width full|aligned|beside|side by side|same design)\b/]],
	["cross-screen-consistency", [/\b(whole plugin|global|same .* page|another same|other page)\b/]],
];

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultData(): LessonData {
	return { ...EMPTY_DATA, lessons: [] };
}

function normalizeCorrection(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function fingerprintCorrection(text: string): string {
	return createHash("sha256").update(normalizeCorrection(text)).digest("hex").slice(0, 16);
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeProjectPath(projectPath: string): string {
	const normalized = projectPath.replace(/[\\/]+/g, "/").replace(/\/$/, "");
	return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function canMergeIntoLesson(lesson: UiLesson, projectPath: string): boolean {
	if (lesson.scope !== "project") return true;
	const normalizedProject = normalizeProjectPath(projectPath);
	return lesson.occurrences.some((occurrence) => normalizeProjectPath(occurrence.cwd) === normalizedProject);
}

function lessonId(timestamp: string, fingerprint: string): string {
	return `ui-${Date.parse(timestamp).toString(36)}-${fingerprint.slice(0, 8)}`;
}

function joinLockOwner(lockPath: string): string {
	return `${lockPath}/owner`;
}

function appendOccurrence(lesson: UiLesson, occurrence: LessonOccurrence): void {
	lesson.occurrences.push(occurrence);
	lesson.occurrences = lesson.occurrences.slice(-MAX_OCCURRENCES);
	lesson.occurrenceCount += 1;
	lesson.updatedAt = occurrence.capturedAt;
}

export function redactSensitiveText(text: string): string {
	return text
		.replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
		.replace(/\b(?:Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, (header) => `${header.split(":", 1)[0]}: [REDACTED]`)
		.replace(/\bBearer\s+[^\s,;"'}]+/gi, "Bearer [REDACTED]")
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED JWT]")
		.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/gi, "[REDACTED KEY]")
		.replace(JSON_SECRET_PATTERN, "$1\"[REDACTED]\"")
		.replace(NAMED_SECRET_PATTERN, "$1=[REDACTED]")
		.replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE)[A-Z0-9_]*)\s*=\s*(?:["'][^"']*["']|[^\s,;}\]]+)/g, "$1=[REDACTED]")
		.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

export function sanitizeCorrection(text: string): string {
	return redactSensitiveText(text).replace(/\s+/g, " ").trim().slice(0, MAX_CORRECTION_LENGTH);
}

export function containsUiTerms(text: string): boolean {
	return UI_PATTERN.test(text);
}

export function isUiCorrection(text: string, recentUiContext: boolean, isSteering = false): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.startsWith("/ui-")) return false;
	const uiContext = containsUiTerms(trimmed) || recentUiContext;
	const correctionSignal = CORRECTION_PATTERN.test(trimmed) || (isSteering && STEERING_CORRECTION_PATTERN.test(trimmed));
	return uiContext && correctionSignal;
}

export function inferUiIssueKey(text: string): string | undefined {
	const normalized = text.toLowerCase();
	return UI_ISSUE_RULES.find(([, patterns]) => patterns.every((pattern) => pattern.test(normalized)))?.[0];
}

export function inferUiTags(text: string): string[] {
	const tags: string[] = [];
	const patterns: Array<[string, RegExp]> = [
		["dropdown", /\b(dropdown|select|combobox|menu|option)\b/i],
		["alignment", /\b(align(?:ed|ment)?|cent(?:er|ered|ering)|too high|too low|misaligned)\b/i],
		["responsive", /\b(responsive|mobile|tablet|desktop|viewport|overflow|clip)\b/i],
		["states", /\b(hover|focus|active|selected|disabled|error|loading)\b/i],
		["spacing", /\b(spacing|padding|margin|gap)\b/i],
		["wordpress-admin", /\b(wordpress|admin screen|plugin settings)\b/i],
		["frontend-widget", /\b(front[- ]?end|elementor|widget)\b/i],
	];
	for (const [tag, pattern] of patterns) if (pattern.test(text)) tags.push(tag);
	return uniqueStrings(tags);
}

export function formatLessonLabel(lesson: UiLesson): string {
	const summary = lesson.correction.length > 72 ? `${lesson.correction.slice(0, 69)}...` : lesson.correction;
	const category = lesson.issueKey ? ` ${lesson.issueKey}` : "";
	return `[${lesson.occurrenceCount}×${category}] ${summary}`;
}

export class LessonStore {
	readonly storePath: string;
	readonly lockPath: string;
	private lockOwner?: string;

	constructor(storePath: string) {
		this.storePath = storePath;
		this.lockPath = `${storePath}.lock`;
	}

	async read(): Promise<LessonData> {
		try {
			const parsed = JSON.parse(await readFile(this.storePath, "utf8")) as LessonData;
			if (parsed.version !== 1 || !Array.isArray(parsed.lessons)) throw new Error("Unsupported UI lesson store schema");
			for (const lesson of parsed.lessons) {
				lesson.issueKey ??= inferUiIssueKey(lesson.correction);
				if (lesson.status === "project") lesson.scope = "project";
				const otherExamples = (lesson.examples ?? []).filter((example) => example !== lesson.correction);
				lesson.examples = [lesson.correction, ...otherExamples.slice(-5)];
			}
			return parsed;
		} catch (error) {
			if (errorCode(error) === "ENOENT") return defaultData();
			throw error;
		}
	}

	async capture(request: CaptureRequest): Promise<CaptureResult> {
		const correction = sanitizeCorrection(request.text);
		if (!correction) throw new Error("A non-empty correction is required");
		return this.withLockedData((data) => this.captureInData(data, request, correction));
	}

	async captureMany(requests: CaptureRequest[]): Promise<CaptureResult[]> {
		return this.withLockedData((data) => requests.flatMap((request) => {
			const correction = sanitizeCorrection(request.text);
			return correction ? [this.captureInData(data, request, correction)] : [];
		}));
	}

	async setEnabled(enabled: boolean): Promise<LessonData> {
		return this.withLockedData((data) => {
			data.enabled = enabled;
			return data;
		});
	}

	async updateStatus(id: string, status: LessonStatus, note?: string): Promise<UiLesson> {
		return this.withLockedData((data) => {
			const lesson = data.lessons.find((candidate) => candidate.id === id);
			if (!lesson) throw new Error(`UI lesson not found: ${id}`);
			lesson.status = status;
			if (status === "project") lesson.scope = "project";
			if (status === "promoted" || status === "dismissed") delete lesson.scope;
			lesson.updatedAt = new Date().toISOString();
			lesson.note = note?.trim() || lesson.note;
			return lesson;
		});
	}

	async remove(id: string): Promise<boolean> {
		return this.withLockedData((data) => {
			const previousLength = data.lessons.length;
			data.lessons = data.lessons.filter((lesson) => lesson.id !== id);
			return data.lessons.length !== previousLength;
		});
	}

	async list(status?: LessonStatus): Promise<UiLesson[]> {
		const data = await this.read();
		return data.lessons
			.filter((lesson) => !status || lesson.status === status)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private captureInData(data: LessonData, request: CaptureRequest, correction: string): CaptureResult {
		const timestamp = new Date().toISOString();
		const fingerprint = fingerprintCorrection(correction);
		const issueKey = request.issueKey ?? inferUiIssueKey(correction);
		const existing = data.lessons.find((lesson) => {
			const sameIssue = lesson.fingerprint === fingerprint || (!!issueKey && lesson.issueKey === issueKey);
			return sameIssue && canMergeIntoLesson(lesson, request.cwd);
		});
		const occurrence: LessonOccurrence = {
			capturedAt: timestamp,
			cwd: request.cwd,
			sessionFile: request.sessionFile,
			source: request.source,
		};
		if (existing) return this.mergeOccurrence(existing, occurrence, request.tags ?? [], correction, issueKey);
		const lesson = this.createLesson(correction, fingerprint, occurrence, request.tags ?? [], issueKey);
		data.lessons.push(lesson);
		return { lesson, created: true, reopened: false };
	}

	private mergeOccurrence(
		lesson: UiLesson,
		occurrence: LessonOccurrence,
		tags: string[],
		correction: string,
		issueKey?: string,
	): CaptureResult {
		const reopened = lesson.status !== "pending" && lesson.status !== "reviewing";
		appendOccurrence(lesson, occurrence);
		lesson.issueKey ??= issueKey;
		const otherExamples = [...new Set([...(lesson.examples ?? []), correction])]
			.filter((example) => example !== lesson.correction)
			.slice(-5);
		lesson.examples = [lesson.correction, ...otherExamples];
		lesson.tags = uniqueStrings([...lesson.tags, ...tags]);
		if (reopened) {
			lesson.status = "pending";
			lesson.note = "Reopened because the same correction occurred again.";
		}
		return { lesson, created: false, reopened };
	}

	private createLesson(
		correction: string,
		fingerprint: string,
		occurrence: LessonOccurrence,
		tags: string[],
		issueKey?: string,
	): UiLesson {
		return {
			id: lessonId(occurrence.capturedAt, fingerprint),
			fingerprint,
			issueKey,
			correction,
			examples: [correction],
			tags: uniqueStrings(tags),
			status: "pending",
			occurrenceCount: 1,
			createdAt: occurrence.capturedAt,
			updatedAt: occurrence.capturedAt,
			occurrences: [occurrence],
		};
	}

	private async withLockedData<T>(mutate: (data: LessonData) => T | Promise<T>): Promise<T> {
		await this.acquireLock();
		try {
			const data = await this.read();
			const response = await mutate(data);
			await this.write(data);
			return response;
		} finally {
			await this.releaseLock();
		}
	}

	private async acquireLock(): Promise<void> {
		await this.ensurePrivateDirectory();
		for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
			try {
				await mkdir(this.lockPath);
				const owner = `${process.pid}-${randomUUID()}`;
				try {
					await writeFile(joinLockOwner(this.lockPath), owner, "utf8");
					this.lockOwner = owner;
					return;
				} catch (error) {
					await rm(this.lockPath, { recursive: true, force: true });
					throw error;
				}
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
				await this.removeStaleLock();
				await delay(LOCK_DELAY_MS);
			}
		}
		throw new Error("UI lesson store is busy; try again shortly");
	}

	private async releaseLock(): Promise<void> {
		const owner = this.lockOwner;
		this.lockOwner = undefined;
		if (!owner) return;
		try {
			if (await readFile(joinLockOwner(this.lockPath), "utf8") === owner) {
				await rm(this.lockPath, { recursive: true, force: true });
			}
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
	}

	private async removeStaleLock(): Promise<void> {
		try {
			const lockStats = await stat(this.lockPath);
			if (Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) await rm(this.lockPath, { recursive: true, force: true });
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
	}

	private async write(data: LessonData): Promise<void> {
		await this.ensurePrivateDirectory();
		const temporaryPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
		try {
			await rename(temporaryPath, this.storePath);
		} catch (error) {
			if (!["EEXIST", "EPERM"].includes(errorCode(error) ?? "")) throw error;
			await this.replaceExistingFile(temporaryPath);
		}
		if (process.platform !== "win32") await chmod(this.storePath, PRIVATE_FILE_MODE);
	}

	private async ensurePrivateDirectory(): Promise<void> {
		const storeDirectory = dirname(this.storePath);
		await mkdir(storeDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		if (process.platform !== "win32") await chmod(storeDirectory, PRIVATE_DIRECTORY_MODE);
	}

	private async replaceExistingFile(temporaryPath: string): Promise<void> {
		const backupPath = `${this.storePath}.backup`;
		await rm(backupPath, { force: true });
		let hasBackup = false;
		try {
			await rename(this.storePath, backupPath);
			hasBackup = true;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
		try {
			await rename(temporaryPath, this.storePath);
			if (hasBackup) await rm(backupPath, { force: true });
		} catch (error) {
			if (hasBackup) await rename(backupPath, this.storePath);
			throw error;
		}
	}
}
