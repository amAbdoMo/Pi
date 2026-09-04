Option Explicit

If WScript.Arguments.Count <> 2 Then WScript.Quit 64

Dim shell, command, powerShellPath, supervisorPath
powerShellPath = WScript.Arguments(0)
supervisorPath = WScript.Arguments(1)
command = Chr(34) & powerShellPath & Chr(34) _
    & " -NoProfile -NonInteractive -WindowStyle Hidden -File " _
    & Chr(34) & supervisorPath & Chr(34)

Set shell = CreateObject("WScript.Shell")
WScript.Quit shell.Run(command, 0, True)
