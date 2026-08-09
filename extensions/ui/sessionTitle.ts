import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const MAX_TITLE_WORDS = 6;
const MAX_TITLE_LENGTH = 48;

const TASK_ACTIONS = [
  "add",
  "analyze",
  "audit",
  "build",
  "change",
  "configure",
  "create",
  "debug",
  "design",
  "document",
  "enhance",
  "fix",
  "implement",
  "improve",
  "install",
  "investigate",
  "make",
  "migrate",
  "optimize",
  "refactor",
  "remove",
  "repair",
  "replace",
  "research",
  "resolve",
  "restore",
  "review",
  "set up",
  "setup",
  "support",
  "test",
  "update",
  "verify",
] as const;

const ACTION_PATTERN = new RegExp(`\\b(?:${TASK_ACTIONS.join("|")})\\b`, "gi");
const LEADING_ACTION_PATTERN = new RegExp(`^(?:${TASK_ACTIONS.join("|")})\\b\\s*`, "i");

const BRAND_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwoocommerce\b/i, "WooCommerce"],
  [/\bwordpress\b/i, "WordPress"],
  [/\belementor\b/i, "Elementor"],
  [/\bopencode\b/i, "OpenCode"],
  [/\bchatgpt\b/i, "ChatGPT"],
  [/\bgithub\b/i, "GitHub"],
  [/\bffmpeg\b/i, "FFmpeg"],
  [/\bffprobe\b/i, "FFprobe"],
  [/\bwindows\b/i, "Windows"],
  [/\bmacos\b/i, "macOS"],
  [/\blinux\b/i, "Linux"],
  [/\bpi\b/i, "Pi"],
];

const SESSION_TITLE_BRANDS = new Set([
  "ChatGPT",
  "Elementor",
  "OpenCode",
  "Pi",
  "WooCommerce",
  "WordPress",
]);

const TOKEN_REPLACEMENTS = new Map<string, string>([
  ["api", "API"],
  ["chatgpt", "ChatGPT"],
  ["cli", "CLI"],
  ["elementor", "Elementor"],
  ["ffmpeg", "FFmpeg"],
  ["ffprobe", "FFprobe"],
  ["github", "GitHub"],
  ["linux", "Linux"],
  ["macos", "macOS"],
  ["mcp", "MCP"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
  ["rtl", "RTL"],
  ["tui", "TUI"],
  ["ui", "UI"],
  ["ux", "UX"],
  ["windows", "Windows"],
  ["woocommerce", "WooCommerce"],
  ["wordpress", "WordPress"],
]);

const TITLE_STOP_WORDS = new Set([
  "a",
  "about",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "current",
  "currently",
  "existing",
  "for",
  "from",
  "in",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "related",
  "really",
  "something",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "us",
  "was",
  "were",
  "with",
  "you",
  "your",
]);

const NON_TASK_PROMPT = /^(?:hi|hello|hey|thanks|thank you|okay|ok|yes|no|continue|go ahead|looks good|sounds good|help me)[\s!.?]*$/i;

type NamingApi = Pick<ExtensionAPI, "getSessionName" | "setSessionName">;
type NamingContext = Pick<ExtensionContext, "sessionManager">;

function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/<skill\b[^>]*>[\s\S]*?<\/skill>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[Image\s+\d+\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:^|\s)[#>*-]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectedBrand(text: string): string | undefined {
  const taskScope = text.split(/\b(?:like|similar to|based on)\b/i, 1)[0] ?? text;
  return BRAND_NAMES.find(([pattern]) => pattern.test(taskScope))?.[1];
}

function hasMultipleTasks(text: string): boolean {
  const actionCount = text.match(ACTION_PATTERN)?.length ?? 0;
  const requestCount = text.match(/\b(?:i need|we need|can we|could we)\b/gi)?.length ?? 0;
  return actionCount + requestCount >= 2 && /\b(?:also|and|then)\b|[,;]/i.test(text);
}

function focusedTopicTitle(text: string, brand: string | undefined): string | undefined {
  const sessionTitleTopic = /\b(?:session|conversation)\b.{0,36}\b(?:title|titles|name|names|naming)\b|\b(?:title|titles|naming)\b.{0,36}\b(?:session|conversation)\b/i;
  if (!sessionTitleTopic.test(text)) return undefined;

  const qualifier = /\b(?:automatic|automated|dynamic)\b/i.test(text) ? "Dynamic " : "";
  const product = brand && SESSION_TITLE_BRANDS.has(brand) ? `${brand} ` : "";
  return `${qualifier}${product}session titles`;
}

function stripRequestFraming(text: string): string {
  let result = text.trim();
  const framingPatterns = [
    /^(?:hi|hello|hey)[,!]?\s+/i,
    /^(?:so|well|okay|ok)[,]?\s+/i,
    /^(?:for (?:this|the) (?:task|session))[,;:]?\s+/i,
    /^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i,
    /^(?:i|we)\s+(?:really\s+)?(?:need|want|would like)\s+(?:you\s+)?(?:to\s+)?/i,
    /^(?:help me|go ahead and|let(?:'|’)s)\s+/i,
    /^please\s+/i,
  ];

  for (let pass = 0; pass < 3; pass += 1) {
    const previous = result;
    for (const pattern of framingPatterns) result = result.replace(pattern, "");
    if (result === previous) break;
  }

  return result.trim();
}

function intentSuffix(action: string | undefined): string | undefined {
  if (!action) return undefined;
  if (/^(?:improve|enhance|optimize)$/i.test(action)) return "improvements";
  if (/^(?:analyze|investigate|research)$/i.test(action)) return "investigation";
  if (/^(?:audit|review)$/i.test(action)) return "review";
  if (/^(?:debug|fix|repair|resolve)$/i.test(action)) return "fix";
  if (/^(?:configure|install|set up|setup)$/i.test(action)) return "setup";
  if (/^(?:change|update)$/i.test(action)) return "update";
  if (/^(?:remove|replace)$/i.test(action)) return "removal";
  if (/^restore$/i.test(action)) return "restoration";
  if (/^migrate$/i.test(action)) return "migration";
  if (/^refactor$/i.test(action)) return "refactor";
  if (/^(?:test|verify)$/i.test(action)) return "verification";
  if (/^document$/i.test(action)) return "documentation";
  return undefined;
}

function normalizeToken(token: string): string {
  const withoutPossessive = token.replace(/(?:'s|’s)$/i, "");
  return TOKEN_REPLACEMENTS.get(withoutPossessive.toLocaleLowerCase("en-US")) ?? withoutPossessive;
}

function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text[0].toLocaleUpperCase() + text.slice(1);
}

function truncateTitle(words: string[], preserveLast = false): string | undefined {
  const selected = words.slice(0, MAX_TITLE_WORDS);
  const minimumWords = preserveLast ? 2 : 1;
  while (selected.length > minimumWords && selected.join(" ").length > MAX_TITLE_LENGTH) {
    selected.splice(preserveLast ? selected.length - 2 : selected.length - 1, 1);
  }
  if (selected.length === 0) return undefined;

  const title = capitalizeFirst(selected.join(" "));
  if (title.length <= MAX_TITLE_LENGTH) return title;
  if (preserveLast && selected.length >= 2) {
    const suffix = selected.at(-1) ?? "";
    const subject = capitalizeFirst(selected.slice(0, -1).join(" "));
    const subjectLimit = Math.max(1, MAX_TITLE_LENGTH - suffix.length - 2);
    return `${subject.slice(0, subjectLimit).trimEnd()}… ${suffix}`;
  }
  return `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** Derive a stable, concise label from one substantive user task. */
export function deriveSessionTitle(prompt: string): string | undefined {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned || cleaned.startsWith("/") || cleaned.startsWith("!") || NON_TASK_PROMPT.test(cleaned)) {
    return undefined;
  }

  const brand = detectedBrand(cleaned);
  const focusedTitle = focusedTopicTitle(cleaned, brand);
  if (focusedTitle) return focusedTitle;
  if (brand && hasMultipleTasks(cleaned)) {
    return brand === "Pi" ? "Pi workspace improvements" : `${brand} improvements`;
  }

  const firstTaskClause = cleaned
    .split(/(?:[.!?]+\s+|\n+)/)
    .map(stripRequestFraming)
    .find((clause) => clause.length > 0 && !NON_TASK_PROMPT.test(clause));
  if (!firstTaskClause) return undefined;

  const purposeIndex = firstTaskClause.search(/\b(?:because|in order to|similar to|so that|so we|so i|based on|derived from)\b/i);
  const focusedClause = (purposeIndex > 0 ? firstTaskClause.slice(0, purposeIndex) : firstTaskClause).trim();
  const leadingAction = focusedClause.match(LEADING_ACTION_PATTERN)?.[0]?.trim();
  const withoutAction = focusedClause.replace(LEADING_ACTION_PATTERN, "");
  const suffix = intentSuffix(leadingAction);

  const words = withoutAction
    .replace(/[^\p{L}\p{N}+#./_'’:-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[./_'’:;-]+|[./_'’:;-]+$/g, ""))
    .filter(Boolean)
    .filter((token) => !TITLE_STOP_WORDS.has(token.toLocaleLowerCase("en-US")))
    .map(normalizeToken);

  if (suffix && !words.some((word) => word.toLocaleLowerCase("en-US") === suffix)) {
    return truncateTitle([
      ...words.slice(0, MAX_TITLE_WORDS - 1),
      suffix,
    ], true);
  }

  return truncateTitle(words);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ))
    .map((part) => part.text)
    .join("\n");
}

function firstSubstantiveTitle(ctx: NamingContext): string | undefined {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const title = deriveSessionTitle(messageText(entry.message.content));
    if (title) return title;
  }
  return undefined;
}

/** Name an unnamed session once, preserving native/manual session names. */
export function ensureAutomaticSessionTitle(
  pi: NamingApi,
  ctx: NamingContext,
  content?: unknown,
): string | undefined {
  if (pi.getSessionName()?.trim()) return undefined;

  const title = content === undefined
    ? firstSubstantiveTitle(ctx)
    : deriveSessionTitle(messageText(content));
  if (!title) return undefined;

  pi.setSessionName(title);
  return title;
}
