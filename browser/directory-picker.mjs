import { execFile } from "node:child_process";
import process from "node:process";

const WINDOWS_PICKER_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;

public static class ModernFolderPicker {
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr filterSpecs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem folder);
    void SetFolder(IShellItem folder);
    void GetFolder(out IShellItem folder);
    void GetCurrentSelection(out IShellItem selection);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
    void AddPlace(IShellItem item, uint alignment);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
    void Close(int result);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr filter);
  }

  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr bindingContext, ref Guid handler, ref Guid interfaceId, out IntPtr pointer);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint displayName, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem item, uint hint, out int order);
  }

  public static string Pick(string title) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialog();
    try {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | 0x20u | 0x40u | 0x800u);
      dialog.SetTitle(title);
      int result = dialog.Show(GetForegroundWindow());
      if (result == unchecked((int)0x800704C7)) return null;
      if (result != 0) Marshal.ThrowExceptionForHR(result);
      IShellItem item;
      dialog.GetResult(out item);
      try {
        IntPtr name;
        item.GetDisplayName(0x80058000u, out name);
        try { return Marshal.PtrToStringUni(name); }
        finally { Marshal.FreeCoTaskMem(name); }
      } finally {
        Marshal.FinalReleaseComObject(item);
      }
    } finally {
      Marshal.FinalReleaseComObject(dialog);
    }
  }
}
`;

const WINDOWS_PICKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -TypeDefinition @'\n${WINDOWS_PICKER_SOURCE}\n'@`,
  "$folder = [ModernFolderPicker]::Pick('Select Workspace Directory')",
  "if ($null -ne $folder) { [Console]::Out.Write($folder) }",
].join("\n");

function encodedPowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function pickDirectory({ signal, platform = process.platform, execFileImpl = execFile } = {}) {
  if (platform !== "win32") throw new Error("Native folder browsing is available on Windows only");
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let child;
    let completed = false;
    let abort = () => {};
    const finish = (action) => {
      if (completed) return;
      completed = true;
      signal?.removeEventListener("abort", abort);
      action();
    };
    abort = () => {
      child?.kill();
      finish(() => resolve(null));
    };
    child = execFileImpl("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand",
      encodedPowerShell(WINDOWS_PICKER_SCRIPT),
    ], { encoding: "utf8", windowsHide: false }, (error, stdout = "") => {
      if (signal?.aborted) { abort(); return; }
      if (error) { finish(() => reject(error)); return; }
      finish(() => resolve(stdout.trim() || null));
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
