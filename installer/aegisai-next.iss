; AegisAI (next) Inno Setup installer
; Build: iscc installer\aegisai-next.iss
; Requires: Inno Setup 6 (https://jrsoftware.org/isinfo.php)

#define MyAppName "AegisAI (next)"
#define MyAppVersion "1.1.13"
#define MyAppPublisher "AegisAI"
#define MyAppURL "https://github.com/user6811992/aegisai-next"
#define MyAppExeName "launcher.vbs"

[Setup]
AppId={{B2C3D4E5-F6A7-8901-BCDE-F23456789012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=.\output
OutputBaseFilename=AegisAI-Next-Setup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full installation"
Name: "minimal"; Description: "Minimal installation (app only)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "app"; Description: "AegisAI (next) application"; Types: full minimal custom; Flags: fixed

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startupicon"; Description: "Start AegisAI automatically at login"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs
Source: "..\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs
Source: "..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs
Source: "..\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs
Source: "..\vite.config.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\launcher.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\installer\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\data"; Flags: uninsneveruninstall
Name: "{app}\workspace"; Flags: uninsneveruninstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm start"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm start"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm start"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Tasks: startupicon

[Run]
Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm install"; StatusMsg: "Installing npm dependencies..."; Flags: runhidden waituntilterminated
Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm run build"; StatusMsg: "Building frontend..."; Flags: runhidden waituntilterminated
Filename: "cmd.exe"; Parameters: "/c cd /d ""{app}"" && npm start"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[CustomMessages]
LaunchProgram=Launch {#MyAppName}
AdditionalIcons=Additional icons:
CreateDesktopIcon=Create a &desktop icon