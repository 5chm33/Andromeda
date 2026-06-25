' Andromeda AI — Silent Launcher
' Launches Electron without any visible cmd or PowerShell window.
' Double-click this file to start Andromeda.

Option Explicit

Dim oShell, oFSO, sDir, sElectron, sCmd

Set oShell = CreateObject("WScript.Shell")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

' Project root is the folder containing this .vbs file
sDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

' Try local electron first (installed in node_modules/.bin)
Dim sLocalElectron
sLocalElectron = sDir & "\node_modules\.bin\electron.cmd"

If oFSO.FileExists(sLocalElectron) Then
    sElectron = """" & sLocalElectron & """"
Else
    ' Fall back to globally installed electron
    sElectron = "electron"
End If

' Build the command
sCmd = sElectron & " """ & sDir & "\launcher\main.cjs"""

' Run silently (0 = hidden window, False = don't wait)
oShell.Run sCmd, 0, False

Set oShell = Nothing
Set oFSO   = Nothing
