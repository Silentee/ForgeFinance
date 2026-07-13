; setup.iss — Inno Setup script for the Forge Finance Windows desktop app.
;
; Compiled by installer\build.ps1, which passes the version:
;     ISCC.exe /DAppVersion=1.0.0 installer\setup.iss
; Output: installer\Output\ForgeFinanceSetup-<version>.exe
;
; Per-user install (no admin / UAC). User data lives in
; %LOCALAPPDATA%\ForgeFinance and is left untouched by upgrades; uninstall
; offers to delete it.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; A stable AppId ties upgrades to the same installed app — do not change it.
AppId={{CAD1DEF8-5EE1-427F-BC8D-F64772EECAE2}
AppName=Forge Finance
AppVersion={#AppVersion}
AppPublisher=Forge Finance
DefaultDirName={localappdata}\Programs\ForgeFinance
DefaultGroupName=Forge Finance
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename=ForgeFinanceSetup-{#AppVersion}
SetupIconFile=forge.ico
UninstallDisplayIcon={app}\ForgeFinance.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Close a running instance before overwriting files during an upgrade.
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; Flags: unchecked

[Files]
Source: "dist\ForgeFinance\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Forge Finance"; Filename: "{app}\ForgeFinance.exe"
Name: "{autodesktop}\Forge Finance"; Filename: "{app}\ForgeFinance.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ForgeFinance.exe"; Description: "Launch Forge Finance"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: string;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\ForgeFinance');
    if DirExists(DataDir) then
    begin
      if MsgBox('Delete your Forge Finance data (accounts, transactions, settings)?'
                + #13#10 + #13#10
                + 'Choose No to keep it for a future reinstall.',
                mbConfirmation, MB_YESNO) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
