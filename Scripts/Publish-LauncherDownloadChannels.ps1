param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,
    [string]$ServerSshTarget = "crossing-server",
    [string]$RemoteChannelsPath = "C:\inetpub\wwwroot\launcher-download-channels.json"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (!(Test-Path -LiteralPath $InputFile -PathType Leaf)) {
    throw "Download channel input file not found: $InputFile"
}

$channels = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($channels.schemaVersion -ne 1) {
    throw "Unsupported download channel schema version: $($channels.schemaVersion)"
}
if ($null -eq $channels.channels) {
    throw "Download channel payload has no channels object."
}
$entries = @($channels.channels)
if ($entries.Count -lt 1) {
    throw "Download channel payload must list at least one channel."
}
$seenKeys = @{}
foreach ($entry in $entries) {
    $key = [string]$entry.key
    if ([string]::IsNullOrWhiteSpace($key) -or $key -notmatch '^[a-z0-9][a-z0-9._-]{0,31}$') {
        throw "Invalid download channel key: $key"
    }
    if ($seenKeys.ContainsKey($key)) {
        throw "Duplicated download channel key: $key"
    }
    $seenKeys[$key] = $true
    if ($entry.enabled -isnot [bool]) {
        throw "Download channel '$key' must have a boolean enabled flag."
    }
    $note = [string]$entry.note
    if ($note.Length -gt 200) {
        throw "Download channel '$key' note is too long (max 200 characters)."
    }
}

$remoteTempPath = "C:\Windows\Temp\launcher-download-channels.$([Guid]::NewGuid().ToString('N')).json"
& scp $InputFile "${ServerSshTarget}:$remoteTempPath"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to upload download channels, scp exit code $LASTEXITCODE"
}

$remoteScript = @"
`$ErrorActionPreference = 'Stop'
`$temp = '$remoteTempPath'
`$target = '$RemoteChannelsPath'
try {
    `$channels = Get-Content -LiteralPath `$temp -Raw -Encoding UTF8 | ConvertFrom-Json
    if (`$channels.schemaVersion -ne 1 -or `$null -eq `$channels.channels) {
        throw 'Remote download channel validation failed.'
    }
    `$targetDir = Split-Path -Parent `$target
    New-Item -ItemType Directory -Path `$targetDir -Force | Out-Null
    if (Test-Path -LiteralPath `$target -PathType Leaf) {
        Copy-Item -LiteralPath `$target -Destination "`$target.bak" -Force
    }
    Move-Item -LiteralPath `$temp -Destination `$target -Force
    # 权限：优先照抄 index.html 的 ACL；子目录（notices / channels）里没有 index.html 时退到站点根目录的。
    # 以前只有 `$targetDir\index.html 一种来源，新目录一条都命中不了，于是目录只有 Administrator 的私有 ACL，
    # IIS 匿名读会 401 —— 2026-09-22 火影公告就是这样"看着发布成功、其实读不到"，启动器只能当"没有这一档公告"。
    `$aclFilled = `$false
    foreach (`$aclDir in @(`$targetDir, (Split-Path -Parent `$targetDir))) {
        `$aclSource = Join-Path `$aclDir 'index.html'
        if (Test-Path -LiteralPath `$aclSource -PathType Leaf) {
            Set-Acl -LiteralPath `$target -AclObject (Get-Acl -LiteralPath `$aclSource)
            `$aclFilled = `$true
            break
        }
    }
    # 兜底：不论有没有模板，都把匿名读权限补上（目录可继承，文件显式给一份）。
    & icacls `$targetDir /grant 'IIS_IUSRS:(OI)(CI)(RX)' 'IUSR:(OI)(CI)(RX)' | Out-Null
    if (-not `$aclFilled) {
        & icacls `$target /grant 'IIS_IUSRS:(RX)' 'IUSR:(RX)' | Out-Null
    }
} catch {
    Remove-Item -LiteralPath `$temp -Force -ErrorAction SilentlyContinue
    throw
}
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
& ssh $ServerSshTarget "powershell -NoProfile -EncodedCommand $encoded"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to activate remote download channels, ssh exit code $LASTEXITCODE"
}

Write-Host "Remote launcher download channels published: $RemoteChannelsPath"
