const DISPLAY_PASTE_MARKER_RE = /\[(?:Image \d+|\d+ lines? pasted #\d+|paste #\d+(?: (?:\+\d+ lines|\d+ chars))?|Pasted ~\d+ lines?)\]/gi;

export function highlightPasteMarkers(line: string, highlight: (marker: string) => string): string {
	return line.replace(DISPLAY_PASTE_MARKER_RE, (marker) => highlight(marker));
}
