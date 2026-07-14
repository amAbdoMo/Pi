export const MIN_USER_MESSAGE_WIDTH = 8;

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
