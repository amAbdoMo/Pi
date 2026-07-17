const EMPTY_BRACKETED_PASTE = "\x1b[200~\x1b[201~";

export function isEmptyBracketedPaste(inputSequence: string): boolean {
  return inputSequence === EMPTY_BRACKETED_PASTE;
}
