export const MIN_USER_MESSAGE_WIDTH = 8;

const TRAILING_SGR_SEQUENCE_PATTERN = /(?:\x1b\[[0-9;]*m)*$/;
const TRAILING_HORIZONTAL_PADDING_PATTERN = /[ \t]+$/;

export function trimUserMessageRightPadding(text: string): string {
  let output = text;

  while (output.length > 0) {
    const suffix = output.match(TRAILING_SGR_SEQUENCE_PATTERN)?.[0] ?? "";
    const body = suffix ? output.slice(0, -suffix.length) : output;
    const trimmedBody = body.replace(TRAILING_HORIZONTAL_PADDING_PATTERN, "");

    if (trimmedBody.length === body.length) {
      return output;
    }

    output = `${trimmedBody}${suffix}`;
  }

  return output;
}

export function fitUserMessageWidth(
  availableWidth: number,
  widestContentWidth: number,
  horizontalPaddingColumns: number,
): number {
  const safeAvailableWidth = Math.max(0, Math.floor(availableWidth));
  const contentWidth = Math.max(0, Math.floor(widestContentWidth));
  const framedContentWidth = contentWidth + horizontalPaddingColumns * 2 + 2;
  return Math.min(
    safeAvailableWidth,
    Math.max(MIN_USER_MESSAGE_WIDTH, framedContentWidth),
  );
}
