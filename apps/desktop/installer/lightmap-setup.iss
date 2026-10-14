; LightMap for Windows: the installer.
;
; Installed FOR ONE USER under %LOCALAPPDATA%\Programs\LightMap, the way Chrome and VS Code are,
; so the app owns its folder and can update itself with no administrator prompt. A silent run
; (/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCANCEL) is how the desktop app applies an update:
; add /nolaunch=1 and setup does not start LightMap afterwards (the update-on-close case).
;
; Never touched here: %LOCALAPPDATA%\LightMap, where the app keeps its saved places (in the
; WebView2 profile), settings, logs and staged updates. Install, update and uninstall replace the
; PROGRAM only.
;
; Compile (the desktop workflow does this on windows-latest; locally needs Inno Setup 6):
;   iscc /DAppVersion=0.3.0 /DPayloadDir=..\stage installer\lightmap-setup.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z: the installer must not guess its own version
#endif
#ifndef PayloadDir
  #define PayloadDir "..\stage"
#endif

[Setup]
; LightMap's permanent installer identity: how a newer setup finds an older install and upgrades
; it in place. Never change it.
AppId={{6F1C2B7E-4A8D-4E53-9C21-0B7D5E9A3F41}
AppName=LightMap
AppVersion={#AppVersion}
AppVerName=LightMap {#AppVersion}
AppPublisher=Formicaria
AppPublisherURL=https://github.com/the-x1x1/lightmap
AppUpdatesURL=https://github.com/the-x1x1/lightmap/releases
DefaultDirName={localappdata}\Programs\LightMap
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
OutputDir=Output
OutputBaseFilename=LightMap-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#SourcePath}\..\LightMap.Desktop\lightmap.ico
UninstallDisplayIcon={app}\LightMap.exe
UninstallDisplayName=LightMap
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion={#AppVersion}
VersionInfoProductName=LightMap

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; The server and runtime are replaced whole, so files a newer build no longer ships do not linger.
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The marker that tells the app it was INSTALLED (and so may update itself), not run from a build folder.
Source: "{#SourcePath}\lightmap-installed.txt"; DestDir: "{app}"; DestName: ".lightmap-installed"

[Icons]
Name: "{autoprograms}\LightMap"; Filename: "{app}\LightMap.exe"
Name: "{autodesktop}\LightMap"; Filename: "{app}\LightMap.exe"; Tasks: desktopicon

[Run]
; NOT skipifsilent: a silent install is an update, and LightMap comes back when it is done,
; unless /nolaunch=1 asked otherwise (the app was closed; the update just goes in).
Filename: "{app}\LightMap.exe"; Description: "{cm:LaunchProgram,LightMap}"; Flags: nowait postinstall; Check: ShouldLaunch

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// The desktop app holds this mutex for its whole life (apps/desktop/LightMap.Desktop/App.cs).
// "Restart now" and update-on-close start setup and then exit; setup waits for the app to be
// gone before it replaces anything, because a silent setup answers "file in use" with Abort.
const
  ShellMutex = 'Local\LightMapDesktopShell';
  ShellPatienceMs = 120000;

function ShouldLaunch(): Boolean;
begin
  Result := ExpandConstant('{param:nolaunch|0}') <> '1';
end;

function InitializeSetup(): Boolean;
var
  Waited: Integer;
begin
  Waited := 0;
  while CheckForMutexes(ShellMutex) and (Waited < ShellPatienceMs) do
  begin
    Sleep(500);
    Waited := Waited + 500;
  end;
  if CheckForMutexes(ShellMutex) then
  begin
    Log('LightMap is still running after ' + IntToStr(Waited div 1000) + ' s; setup stops without changing anything.');
    if not WizardSilent then
      MsgBox('LightMap is still running. Close it and run setup again.', mbError, MB_OK);
    Result := False;
    exit;
  end;
  if Waited > 0 then
  begin
    Log('LightMap left after ' + IntToStr(Waited) + ' ms; continuing.');
    Sleep(1500);
  end;
  Result := True;
end;
