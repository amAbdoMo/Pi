const EMPTY_BRACKETED_PASTE = "\x1b[200~\x1b[201~";
const LEGACY_ARABIC_ALT_S = "\x1bس";
const LEGACY_LATIN_ALT_S = "\x1bs";
const SGR_MOUSE_SEQUENCE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const MOUSE_MODIFIER_MASK = 4 | 8 | 16;
const MOTION_MASK = 32;
const WHEEL_MASK = 64;
const WHEEL_UP_BUTTON = 64;
const WHEEL_DOWN_BUTTON = 65;
const RELEASE_BUTTON = 3;

export interface TerminalMouseEvent {
  kind: "press" | "drag" | "release" | "wheel" | "other";
  button: number;
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  wheelNotches: number;
}

export interface ParsedTerminalMouseInput {
  data: string;
  wheelNotches: number;
  mouseSequences: number;
  events: TerminalMouseEvent[];
}

export function isEmptyBracketedPaste(inputSequence: string): boolean {
  return inputSequence === EMPTY_BRACKETED_PASTE;
}

export function legacyArabicAltSShortcut(
  inputSequence: string,
): string | undefined {
  return inputSequence === LEGACY_ARABIC_ALT_S
    ? LEGACY_LATIN_ALT_S
    : undefined;
}

export function parseTerminalMouseInput(inputSequence: string): ParsedTerminalMouseInput {
  let wheelNotches = 0;
  let mouseSequences = 0;
  const events: TerminalMouseEvent[] = [];

  const data = inputSequence.replace(
    SGR_MOUSE_SEQUENCE,
    (_sequence, buttonCode, x, y, final) => {
      const event = decodeTerminalMouseEvent(buttonCode, x, y, final);
      mouseSequences += 1;
      wheelNotches += event.wheelNotches;
      events.push(event);
      return "";
    },
  );

  return { data, wheelNotches, mouseSequences, events };
}

function decodeTerminalMouseEvent(
  buttonCode: string,
  x: string,
  y: string,
  final: string,
): TerminalMouseEvent {
  const code = Number(buttonCode);
  const unmodified = code & ~MOUSE_MODIFIER_MASK;
  const button = unmodified & 3;
  const wheelNotches = unmodified === WHEEL_UP_BUTTON
    ? 1
    : unmodified === WHEEL_DOWN_BUTTON
      ? -1
      : 0;
  return {
    kind: terminalMouseEventKind(unmodified, button, final),
    button,
    x: Number(x),
    y: Number(y),
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
    wheelNotches,
  };
}

function terminalMouseEventKind(
  unmodified: number,
  button: number,
  final: string,
): TerminalMouseEvent["kind"] {
  if ((unmodified & WHEEL_MASK) !== 0) return "wheel";
  if (final === "m" || button === RELEASE_BUTTON) return "release";
  if ((unmodified & MOTION_MASK) !== 0) return "drag";
  return button <= 2 ? "press" : "other";
}
