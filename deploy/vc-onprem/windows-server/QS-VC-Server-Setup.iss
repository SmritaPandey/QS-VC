; QS-VC Server for Windows Server (Hyper-V). Build: iscc /DAppVersion=1.0.0 QS-VC-Server-Setup.iss
; Ships next to QS-VC-Server-Appliance-<version>-HyperV.zip (+ .sha256) in the same folder.
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
[Setup]
AppId={{6F0A3C2E-8D51-4E6B-9C3A-2B7D5E1F4A90}
AppName=QS-VC Server
AppVersion={#AppVersion}
AppPublisher=QS-VC
AppPublisherURL=https://qsvcmeet.com
DefaultDirName={autopf}\QS-VC Server
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputBaseFilename=QS-VC-Server-Setup-{#AppVersion}
SetupIconFile=..\..\..\frontend\desktop\assets\icon.ico
UninstallDisplayIcon={app}\icon.ico
LicenseFile=..\installer\EULA.txt
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
SetupLogging=yes

[Files]
Source: "Install-QSVCAppliance.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\frontend\desktop\assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\QS-VC Server console"; Filename: "{sys}\vmconnect.exe"; Parameters: "localhost ""QS-VC Server"""; IconFilename: "{app}\icon.ico"

[Code]
var
  OptPage: TInputQueryWizardPage;
  ZipPage: TInputFileWizardPage;
  ResultCode: Integer;

procedure InitializeWizard;
begin
  ZipPage := CreateInputFilePage(wpSelectDir, 'QS-VC appliance', 'Select the Hyper-V appliance file',
    'Choose QS-VC-Server-Appliance-<version>-HyperV.zip (downloaded with this setup).');
  ZipPage.Add('Appliance file:', 'Appliance (*-HyperV.zip)|*-HyperV.zip', '.zip');
  ZipPage.Values[0] := ExpandConstant('{src}\QS-VC-Server-Appliance-{#AppVersion}-HyperV.zip');
  OptPage := CreateInputQueryPage(ZipPage.ID, 'Virtual machine', 'Hyper-V settings',
    'The QS-VC Server runs as a Rocky Linux 9 virtual machine on this server.');
  OptPage.Add('External Hyper-V switch on the hub network:', False);
  OptPage.Add('Memory (GB, 16 recommended):', False);
  OptPage.Add('Virtual CPUs (8 recommended):', False);
  OptPage.Values[1] := '16'; OptPage.Values[2] := '8';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = ZipPage.ID) and not FileExists(ZipPage.Values[0]) then begin
    MsgBox('The appliance file was not found.', mbError, MB_OK); Result := False; end;
  if (CurPageID = OptPage.ID) and (Trim(OptPage.Values[0]) = '') then begin
    MsgBox('Enter the name of the External Hyper-V switch.', mbError, MB_OK); Result := False; end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Params: String;
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption := 'Creating the QS-VC Server virtual machine (several minutes)…';
    Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\Install-QSVCAppliance.ps1') +
      '" -VhdxZip "' + ZipPage.Values[0] + '" -Switch "' + OptPage.Values[0] + '" -MemoryGB ' + OptPage.Values[1] + ' -Cpus ' + OptPage.Values[2];
    if not Exec('powershell.exe', Params, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then ResultCode := -1;
    if ResultCode = 3010 then
      MsgBox('Hyper-V was enabled. Restart this server, then run QS-VC Server Setup again.', mbInformation, MB_OK)
    else if ResultCode <> 0 then
      MsgBox('The virtual machine could not be created (code ' + IntToStr(ResultCode) + '). See %ProgramData%\QS-VC\setup.log.', mbError, MB_OK);
  end;
end;
