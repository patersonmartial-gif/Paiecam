; Installateur Windows de PaieCam (Inno Setup 6).
; Construit par .github/workflows/windows-installer.yml :
;   iscc windows\paiecam.iss /DVersion=0.1.0 /DSource=<dossier assemblé>
; Le dossier assemblé contient node\, pgsql\, web\, outils\, services\ et scripts\.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Source
  #define Source "..\dist\paiecam"
#endif

[Setup]
AppId={{6B0E3C1A-9F4D-4C51-9B57-2B7C3E5A8D10}
AppName=PaieCam
AppVersion={#Version}
AppPublisher=PaieCam
DefaultDirName={autopf}\PaieCam
DefaultGroupName=PaieCam
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=PaieCam-Setup-{#Version}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=PaieCam {#Version}

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Files]
Source: "{#Source}\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "{#Source}\pgsql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs ignoreversion
Source: "{#Source}\web\*"; DestDir: "{app}\web"; Flags: recursesubdirs ignoreversion
Source: "{#Source}\outils\*"; DestDir: "{app}\outils"; Flags: recursesubdirs ignoreversion
Source: "{#Source}\services\*"; DestDir: "{app}\services"; Flags: ignoreversion
Source: "{#Source}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\PaieCam"; Filename: "http://localhost:3000"; IconFilename: "{app}\node\node.exe"
Name: "{commondesktop}\PaieCam"; Filename: "http://localhost:3000"; IconFilename: "{app}\node\node.exe"
Name: "{group}\Sauvegarder maintenant"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\sauvegarder.ps1"""
Name: "{group}\Restaurer une sauvegarde"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\restaurer.ps1"""
Name: "{group}\Dépanner un compte"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\depanner-compte.ps1"""
Name: "{group}\Dossier des sauvegardes"; Filename: "{commonappdata}\PaieCam\sauvegardes"

[Run]
Filename: "notepad.exe"; Parameters: """{commonappdata}\PaieCam\KIT-DE-RECUPERATION.txt"""; Description: "Ouvrir le kit de récupération (à imprimer, puis à supprimer du PC)"; Flags: postinstall shellexec skipifdoesntexist
Filename: "http://localhost:3000"; Description: "Ouvrir PaieCam"; Flags: postinstall shellexec nowait

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\desinstaller.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "PaieCamServices"

[Code]
// Avant de remplacer les fichiers (mise à jour) : arrêter les services, qui les verrouillent.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec('sc.exe', 'stop PaieCam-Web', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec('sc.exe', 'stop PaieCam-Worker', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec('sc.exe', 'stop PaieCam-Base', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(3000);
  Result := '';
end;

// Base de données, services et première sauvegarde ; un échec est signalé, jamais ignoré.
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Préparation de la base de données et des services (1 à 2 minutes)…';
    if not Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\installer.ps1') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
      MsgBox('La préparation de PaieCam a échoué (code ' + IntToStr(Code) + '). Le détail est dans ' +
        ExpandConstant('{commonappdata}\PaieCam\journaux\installation.log') + '.', mbError, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    MsgBox('PaieCam est désinstallé. Vos données de paie et vos sauvegardes sont CONSERVÉES dans ' +
      ExpandConstant('{commonappdata}\PaieCam') + '. Gardez-les le temps exigé par la loi.', mbInformation, MB_OK);
end;
