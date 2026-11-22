' AegisAI (next) launcher (Windows Script Host)
Option Explicit
On Error Resume Next

Dim wshShell, fso, base
Set wshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Find an executable on %PATH% (quoted entries and trailing slashes tolerated).
Function FindOnPath(fileName)
  Dim pathValue, entries, i, entry
  FindOnPath = ""
  pathValue = wshShell.ExpandEnvironmentStrings("%PATH%")
  If pathValue = "%PATH%" Or pathValue = "" Then Exit Function
  entries = Split(pathValue, ";")
  For i = 0 To UBound(entries)
    entry = Trim(Replace(entries(i), """", ""))
    If entry <> "" Then
      If Right(entry, 1) <> "\" Then entry = entry & "\"
      If fso.FileExists(entry & fileName) Then
        FindOnPath = entry & fileName
        Exit Function
      End If
    End If
  Next
End Function

' Return Node's major version, or 0 when it cannot be determined (don't block
' startup just because the probe failed).
Function NodeMajorVersion(filePath)
  Dim proc, line, parts
  NodeMajorVersion = 0
  On Error Resume Next
  Set proc = wshShell.Exec("""" & filePath & """ --version")
  If Err.Number <> 0 Then Err.Clear: Exit Function
  line = Trim(proc.StdOut.ReadLine())
  If Left(line, 1) = "v" Then line = Mid(line, 2)
  parts = Split(line, ".")
  If IsNumeric(parts(0)) Then NodeMajorVersion = CInt(parts(0))
  On Error GoTo 0
End Function

Dim appPort
appPort = wshShell.ExpandEnvironmentStrings("%PORT%")
If appPort = "%PORT%" Or appPort = "" Then appPort = "8080"

base = fso.GetParentFolderName(WScript.ScriptFullName)
If base = "" Then base = wshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents\aegisai-next"

' Guard against quote injection in paths
If InStr(base, """") > 0 Then
  MsgBox "Invalid installation path.", vbCritical, "AegisAI (next) Launcher"
  WScript.Quit 1
End If

' Discover Node.js: bundled runtime first, then PATH, then standard locations.
Dim nodePath, nodeExe
nodePath = ""
If fso.FileExists(base & "\runtime\node\node.exe") Then
  nodePath = base & "\runtime\node\node.exe"
Else
  nodePath = FindOnPath("node.exe")
End If
If nodePath = "" And fso.FileExists("C:\Program Files\nodejs\node.exe") Then nodePath = "C:\Program Files\nodejs\node.exe"
If nodePath = "" And fso.FileExists("C:\Program Files (x86)\nodejs\node.exe") Then nodePath = "C:\Program Files (x86)\nodejs\node.exe"

If nodePath = "" Then
  MsgBox "Node.js was not found." & vbCrLf & vbCrLf & _
         "Please install Node.js 22+ from https://nodejs.org/", _
         vbCritical, "AegisAI (next) Launcher"
  WScript.Quit 1
End If

Dim nodeMajor
nodeMajor = NodeMajorVersion(nodePath)
If nodeMajor > 0 And nodeMajor < 22 Then
  MsgBox "Node.js 22 or newer is required, but version " & nodeMajor & " was found." & vbCrLf & _
         "Please upgrade from https://nodejs.org/", vbCritical, "AegisAI (next) Launcher"
  WScript.Quit 1
End If

nodeExe = """" & nodePath & """"

' Ensure dependencies: bundled npm, then npm next to node, then PATH.
If Not fso.FolderExists(base & "\node_modules") Then
  Dim npmPath, npmExe
  npmPath = ""
  If fso.FileExists(base & "\runtime\node\npm.cmd") Then
    npmPath = base & "\runtime\node\npm.cmd"
  ElseIf fso.FileExists(fso.GetParentFolderName(nodePath) & "\npm.cmd") Then
    npmPath = fso.GetParentFolderName(nodePath) & "\npm.cmd"
  Else
    npmPath = FindOnPath("npm.cmd")
  End If
  If npmPath <> "" Then
    npmExe = """" & npmPath & """"
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
