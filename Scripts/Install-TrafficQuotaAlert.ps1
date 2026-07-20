param(
    [string]$InstallDirectory = 'C:\UEWatchdog',
    [string]$TaskName = 'CrossingVoid'
)

$ErrorActionPreference = 'Stop'

$sourcePath = Join-Path $PSScriptRoot 'TrafficQuotaAlert.ps1'
if (!(Test-Path -LiteralPath $sourcePath)) {
    throw "Traffic alert source script not found: $sourcePath"
}

New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
$installedScript = Join-Path $InstallDirectory 'TrafficQuotaAlert.ps1'
$sourceText = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
[System.IO.File]::WriteAllText($installedScript, $sourceText, [System.Text.UTF8Encoding]::new($true))

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installedScript`""
& schtasks.exe /Create /TN $TaskName /TR $taskCommand /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) {
    throw "Unable to create scheduled task $TaskName, schtasks exit code $LASTEXITCODE"
}

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started $TaskName."
