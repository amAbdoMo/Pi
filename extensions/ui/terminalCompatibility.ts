const EMPTY_BRACKETED_PASTE = "\x1b[200~\x1b[201~";
const SGR_MOUSE_SEQUENCE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
const MOUSE_MODIFIER_MASK = 4 | 8 | 16;
const WHEEL_UP_BUTTON = 64;
const WHEEL_DOWN_BUTTON = 65;

export interface ParsedTerminalMouseInput {
  data: string;
  wheelNotches: number;
  mouseSequences: number;
}

export function isEmptyBracketedPaste(inputSequence: string): boolean {
  return inputSequence === EMPTY_BRACKETED_PASTE;
}

export function parseTerminalMouseInput(inputSequence: string): ParsedTerminalMouseInput {
  let wheelNotches = 0;
  let mouseSequences = 0;

  const data = inputSequence.replace(
    SGR_MOUSE_SEQUENCE,
    (_sequence, buttonCode, _x, _y, final) => {
      mouseSequences += 1;
      const baseButton = Number(buttonCode) & ~MOUSE_MODIFIER_MASK;
      if (final === "M" && baseButton === WHEEL_UP_BUTTON) wheelNotches += 1;
      if (final === "M" && baseButton === WHEEL_DOWN_BUTTON) wheelNotches -= 1;
      return "";
    },
  );

  return { data, wheelNotches, mouseSequences };
}
