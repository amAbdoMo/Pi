import {
  childProfileArgs,
  type ChildProfile,
} from "../child-profile.ts";

export function childExtensionArgs(
  parentArgs: readonly string[],
  extensionPath: string,
): string[] {
  return [
    ...(parentArgs.includes("--no-extensions") ? ["--no-extensions"] : []),
    "-e",
    extensionPath,
  ];
}

export function buildChildLaunchArgs(options: {
  parentArgs: readonly string[];
  label: string;
  extensionPath: string;
  persistSessions: boolean;
  sessionDir: string;
  profile: ChildProfile;
}): string[] {
  return [
    "--mode",
    "rpc",
    "--name",
    options.label,
    ...childExtensionArgs(options.parentArgs, options.extensionPath),
    ...(options.persistSessions
      ? ["--session-dir", options.sessionDir]
      : ["--no-session"]),
    ...childProfileArgs(options.profile),
  ];
}
