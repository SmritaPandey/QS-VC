<#
  QS-VC Server for Windows Server: creates the QS-VC appliance VM in Hyper-V.
  Called by QS-VC-Server-Setup.exe (or by IT directly):
    powershell -ExecutionPolicy Bypass -File Install-QSVCAppliance.ps1 -VhdxZip .\QS-VC-Server-Appliance-<v>-HyperV.zip `
      -Switch "Hub LAN" -MemoryGB 16 -Cpus 8 -VmName "QS-VC Server"
  The appliance's console then shows the network menu and the QS-VC setup wizard.
#>
param(
  [Parameter(Mandatory)] [string] $VhdxZip,
  [Parameter(Mandatory)] [string] $Switch,
  [int] $MemoryGB = 16,
  [int] $Cpus = 8,
  [string] $VmName = 'QS-VC Server',
  [string] $Root = "$env:ProgramData\QS-VC\VM"
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:ProgramData 'QS-VC\setup.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Log($m) { "$(Get-Date -Format s) $m" | Tee-Object -FilePath $log -Append }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator.' }
$os = Get-CimInstance Win32_OperatingSystem
Log "Windows: $($os.Caption) $($os.Version)"
if (-not (Get-Command New-VM -ErrorAction SilentlyContinue)) {
  Log 'Hyper-V is not installed; enabling it (a restart is required).'
  if ($os.ProductType -ne 1) { Install-WindowsFeature -Name Hyper-V -IncludeManagementTools | Out-Null }
  else { Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart | Out-Null }
  exit 3010   # restart required; run setup again after restarting
}
if (-not (Get-VMSwitch -Name $Switch -ErrorAction SilentlyContinue)) { throw "Hyper-V switch '$Switch' not found. Create an External switch on the hub network adapter first." }
if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) { throw "A VM named '$VmName' already exists." }
if (-not (Test-Path $VhdxZip)) { throw "Appliance file not found: $VhdxZip" }
$sumFile = "$VhdxZip.sha256"
if (Test-Path $sumFile) {
  $expected = ((Get-Content $sumFile -Raw).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $VhdxZip).Hash.ToLower()
  if ($expected -ne $actual) { throw 'The appliance file is damaged (SHA-256 mismatch).' }
  Log 'Appliance SHA-256 verified.'
} else { Log 'WARNING: no .sha256 file next to the appliance; checksum not verified.' }
$free = (Get-PSDrive -Name ($Root.Substring(0,1))).Free / 1GB
if ($free -lt 150) { throw "Only $([int]$free) GB free on $($Root.Substring(0,2)); 150 GB is required." }

New-Item -ItemType Directory -Force -Path $Root | Out-Null
Log 'Extracting the appliance disk…'
Expand-Archive -Path $VhdxZip -DestinationPath $Root -Force
$vhdx = Get-ChildItem $Root -Filter *.vhdx | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$disk = Join-Path $Root "$($VmName -replace '[^A-Za-z0-9-]','-').vhdx"
Move-Item $vhdx.FullName $disk -Force

Log "Creating VM '$VmName' ($Cpus vCPU, $MemoryGB GB, switch '$Switch')"
New-VM -Name $VmName -Generation 2 -MemoryStartupBytes ($MemoryGB * 1GB) -VHDPath $disk -SwitchName $Switch -Path $Root | Out-Null
Set-VM -Name $VmName -ProcessorCount $Cpus -StaticMemory -AutomaticStartAction Start -AutomaticStopAction ShutDown -CheckpointType Disabled
Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
Enable-VMIntegrationService -VMName $VmName -Name 'Guest Service Interface','Time Synchronization' -ErrorAction SilentlyContinue
Start-VM -Name $VmName
Log 'VM started. Opening the console for network and QS-VC setup.'
Start-Process vmconnect.exe -ArgumentList 'localhost', "`"$VmName`""
exit 0
