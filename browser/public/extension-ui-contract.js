export const DIALOG_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);
export const FIRE_AND_FORGET_UI_METHODS = new Set(["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]);

const MAX_ID_CHARS = 256;
const MAX_TITLE_CHARS = 512;
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_OPTIONS = 50;
const MAX_OPTION_CHARS = 2_048;
const MAX_WIDGET_LINES = 50;

function exactKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function requiredText(value, label, max) {
  if (typeof value !== "string" || !value || value.length > max) throw new TypeError(`${label} is invalid`);
  return value;
}

function optionalText(value, label, max) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) throw new TypeError(`${label} is invalid`);
  return value;
}

function commonRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || request.type !== "extension_ui_request") {
    throw new TypeError("Interaction request is invalid");
  }
  return {
    type: request.type,
    id: requiredText(request.id, "Interaction request ID", MAX_ID_CHARS),
    method: requiredText(request.method, "Interaction method", 64),
  };
}

function normalizeDialog(request, common) {
  const allowed = new Set(["type", "id", "method", "title", "message", "options", "placeholder", "prefill", "timeout"]);
  if (!exactKeys(request, allowed)) throw new TypeError("Interaction request contains unsupported fields");
  const output = { ...common, title: requiredText(request.title, "Interaction title", MAX_TITLE_CHARS) };
  const message = optionalText(request.message, "Interaction message", MAX_OPTION_CHARS);
  if (message !== undefined) output.message = message;
  if (request.method === "select") {
    if (!Array.isArray(request.options) || request.options.length < 1 || request.options.length > MAX_OPTIONS) throw new TypeError("Interaction options are invalid");
    output.options = request.options.map((option) => requiredText(option, "Interaction option", MAX_OPTION_CHARS));
  }
  if (request.method === "input") {
    const placeholder = optionalText(request.placeholder, "Interaction placeholder", MAX_OPTION_CHARS);
    if (placeholder !== undefined) output.placeholder = placeholder;
  }
  if (request.method === "editor") {
    const prefill = optionalText(request.prefill, "Interaction prefill", MAX_MESSAGE_CHARS);
    if (prefill !== undefined) output.prefill = prefill;
  }
  if (request.timeout !== undefined) {
    if (!Number.isSafeInteger(request.timeout) || request.timeout < 1 || request.timeout > 24 * 60 * 60 * 1000) throw new TypeError("Interaction timeout is invalid");
    output.timeout = request.timeout;
  }
  return output;
}

function normalizeNotice(request, common) {
  const methodKeys = {
    notify: ["message", "notifyType"],
    setStatus: ["statusKey", "statusText"],
    setWidget: ["widgetKey", "widgetLines", "widgetPlacement"],
    setTitle: ["title"],
    set_editor_text: ["text"],
  };
  const allowed = new Set(["type", "id", "method", ...methodKeys[request.method]]);
  if (!exactKeys(request, allowed)) throw new TypeError("Interaction notice contains unsupported fields");
  if (request.method === "notify") {
    const notifyType = request.notifyType ?? "info";
    if (!new Set(["info", "warning", "error"]).has(notifyType)) throw new TypeError("Notification type is invalid");
    return { ...common, message: requiredText(request.message, "Notification message", MAX_OPTION_CHARS), notifyType };
  }
  if (request.method === "setStatus") return {
    ...common,
    statusKey: requiredText(request.statusKey, "Status key", 128),
    ...(request.statusText === undefined ? {} : { statusText: optionalText(request.statusText, "Status text", MAX_OPTION_CHARS) }),
  };
  if (request.method === "setWidget") {
    if (request.widgetLines !== undefined && (!Array.isArray(request.widgetLines) || request.widgetLines.length > MAX_WIDGET_LINES)) throw new TypeError("Widget lines are invalid");
    const lines = request.widgetLines?.map((line) => requiredText(line, "Widget line", MAX_OPTION_CHARS));
    const placement = request.widgetPlacement ?? "aboveEditor";
    if (!new Set(["aboveEditor", "belowEditor"]).has(placement)) throw new TypeError("Widget placement is invalid");
    return { ...common, widgetKey: requiredText(request.widgetKey, "Widget key", 128), ...(lines ? { widgetLines: lines } : {}), widgetPlacement: placement };
  }
  if (request.method === "setTitle") return { ...common, title: requiredText(request.title, "Window title", MAX_TITLE_CHARS) };
  return { ...common, text: optionalText(request.text, "Editor text", MAX_MESSAGE_CHARS) ?? "" };
}

export function normalizeExtensionUiRequest(request) {
  const common = commonRequest(request);
  if (DIALOG_UI_METHODS.has(common.method)) return normalizeDialog(request, common);
  if (FIRE_AND_FORGET_UI_METHODS.has(common.method)) return normalizeNotice(request, common);
  throw new TypeError("Interaction method is unsupported");
}
