import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function framedPanel(
  theme: Theme,
  title: string,
  body: string[],
  width: number,
): string[] {
  const panelWidth = Math.max(4, width);
  const inner = panelWidth - 2;
  const padX = inner >= 4 ? 1 : 0;
  const contentWidth = Math.max(0, inner - padX * 2);
  const border = (text: string) => theme.fg("border", text);
  const maxTitleWidth = Math.max(0, inner - 2);
  const fittedTitle = truncateToWidth(theme.bold(title), maxTitleWidth, "", true);
  const heading = maxTitleWidth > 0 ? ` ${theme.fg("accent", fittedTitle)} ` : "";
  const right = Math.max(0, inner - visibleWidth(heading));
  const lines = [border("┌") + heading + border(`${"─".repeat(right)}┐`)];

  for (const raw of body) {
    const content = truncateToWidth(raw, contentWidth, "…", true);
    const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
    lines.push(
      border("│") +
        " ".repeat(padX) +
        content +
        fill +
        " ".repeat(padX) +
        border("│"),
    );
  }

  lines.push(border(`└${"─".repeat(inner)}┘`));
  return lines.map((line) => truncateToWidth(line, width, "", true));
}
