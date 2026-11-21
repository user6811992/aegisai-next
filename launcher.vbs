' AegisAI (next) launcher (Windows Script Host)
Option Explicit
On Error Resume Next

Dim wshShell, fso, base
Set wshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Dim appPort
appPort = wshShell.ExpandEnvironmentStrings("%PORT%")
If appPort = "%PORT%" Or appPort = "" Then appPort = "8080"

base = fso.GetParentFolderName(WScript.ScriptFullName)
If base = "" Then base = wshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\aegisai-next"

' Discover Node.js
Dim nodeExe
nodeExe = ""
If fso.FileExists(base & "\runtime\node\node.exe") Then
  nodeExe = """" & base & "\runtime\node\node.exe"""
ElseIf fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = """C:\Program Files\nodejs\node.exe"""
ElseIf fso.FileExists("C:\Program Files (x86)\nodejs\node.exe") Then
  nodeExe = """C:\Program Files (x86)\nodejs\node.exe"""
End If

If nodeExe = "" Then
  MsgBox "Node.js was not found." & vbCrLf & vbCrLf & _
         "Please install Node.js 22+ from https://nodejs.org/", _
         vbCritical, "AegisAI (next) Launcher"
  WScript.Quit 1
End If

' Ensure dependencies
If Not fso.FolderExists(base & "\node_modules") Then
  Dim npmExe
  npmExe = ""
  If fso.FileExists(base & "\runtime\node\npm.cmd") Then
    npmExe = """" & base & "\runtime\node\npm.cmd"""
  ElseIf fso.FileExists("C:\Program Files\nodejs\npm.cmd") Then
    npmExe = """C:\Program Files\nodejs\npm.cmd"""
  End If
  If npmExe <> "" Then
    wshShell.Run "cmd /c cd /d """ & base & """ && " & npmExe & " install", 1, True
  End If
End If

' Start server if not running
Dim http, portOpen
portOpen = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://127.0.0.1:" & appPort & "/", False
http.Send
If Err.Number = 0 And http.Status = 200 Then portOpen = True
Err.Clear
On Error GoTo 0
Set http = Nothing

If Not portOpen Then
  wshShell.Run "cmd /c cd /d """ & base & """ && " & nodeExe & " server.js > """ & base & "\server.log"" 2>&1", 0, False
  ' Wait for server
  Dim serverReady, serverWait
  serverReady = False
  For serverWait = 1 To 30
    WScript.Sleep 1000
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "http://127.0.0.1:" & appPort & "/", False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then serverReady = True
    Err.Clear
    On Error GoTo 0
    Set http = Nothing
    If serverReady Then Exit For
  Next
End If

' Launch browser
Dim appUrl
appUrl = "http://127.0.0.1:" & appPort
wshShell.Run appUrl, 1, False

On Error GoTo 0
