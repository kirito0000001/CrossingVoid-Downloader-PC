param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Bucket = "download-server-xj",
    [string]$Endpoint = "https://oss-cn-chengdu.aliyuncs.com",
    [string]$Region = "cn-chengdu",
    [string]$OssObjectPrefix = "toolboxes/crossingvoid-launcher-pc/releases",
    [string]$LegacyProductKey = "crossingvoid-launcher",
    [string]$PcProductKey = "crossingvoid-launcher-pc",
    [string]$AndroidProductKey = "crossingvoid-launcher-android",
    [string]$ReleasePackageDir = "D:\启动器新包",
    [string]$IntermediateOutputDir = (Join-Path $ProjectRoot "dist-launcher-update"),
    [string]$InstallerPath = "",
    [string]$ManifestPath = "",
    [string]$ServerSshTarget = "crossing-server",
    [string]$ServerUpdateJsonPath = "C:\Users\Administrator\Desktop\OSSAPI\ToolboxUpdateServer\app\Data\products\crossingvoid-launcher\update.json",
    [string]$ServerPcUpdateJsonPath = "C:\Users\Administrator\Desktop\OSSAPI\ToolboxUpdateServer\app\Data\products\crossingvoid-launcher-pc\update.json",
    [switch]$SkipBuild,
    [switch]$SkipOss,
    [switch]$SkipServer,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-DevProgress {
    param(
        [string]$Stage,
        [double]$Percent,
        [string]$Message
    )

    $payload = [ordered]@{
        stage = $Stage
        percent = [Math]::Max(0, [Math]::Min(100, $Percent))
        message = $Message
    }
    Write-Output ("::progress" + ($payload | ConvertTo-Json -Compress))
}

function Get-OssutilCommand {
    $localToolPath = "C:\Users\liuyu\Tools\ossutil\ossutil.exe"
    if (Test-Path -LiteralPath $localToolPath) {
        return $localToolPath
    }

    foreach ($name in @("ossutil", "ossutil64", "ossutil.exe", "ossutil64.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    throw "没有找到 ossutil。请先安装并配置阿里云 ossutil。"
}

function Format-FileSize {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Test-PathIsDriveRoot {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    return [string]::Equals($fullPath.TrimEnd('\'), $rootPath.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-ReleasePackageDir {
    param([string]$OutputDir)

    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        throw "启动器新包输出目录不能为空。"
    }

    $fullPath = [System.IO.Path]::GetFullPath($OutputDir)
    if (Test-PathIsDriveRoot -Path $fullPath) {
        return (Join-Path $fullPath "启动器新包")
    }

    return $fullPath
}

function Export-ServerPatchFile {
    param(
        [string]$SourcePath,
        [string]$OutputDir,
        [string]$FileName
    )

    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        throw "服务器覆盖文件输出目录不能为空。"
    }

    $targetPath = Join-Path $OutputDir $FileName
    if (![string]::Equals(
        [System.IO.Path]::GetFullPath($SourcePath),
        [System.IO.Path]::GetFullPath($targetPath),
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        Copy-Item -LiteralPath $SourcePath -Destination $targetPath -Force
    }

    Write-Host "已生成服务器覆盖文件：$targetPath"
    return $targetPath
}

function Copy-ManifestForProduct {
    param(
        [object]$Manifest,
        [string]$ProductKey,
        [string]$ToolboxStableKey
    )

    $copy = $Manifest | ConvertTo-Json -Depth 12 | ConvertFrom-Json
    $copy | Add-Member -NotePropertyName productKey -NotePropertyValue $ProductKey -Force
    $copy | Add-Member -NotePropertyName toolboxStableKey -NotePropertyValue $ToolboxStableKey -Force
    return $copy
}

function Set-LauncherManifestObjectKey {
    param(
        [object]$Manifest,
        [string]$Runtime,
        [string]$FileName,
        [string]$ObjectKey
    )

    $assets = New-Object System.Collections.Generic.List[object]
    foreach ($candidate in @($Manifest.latest.assets)) {
        $assets.Add($candidate) | Out-Null
    }
    foreach ($version in @($Manifest.versions)) {
        foreach ($candidate in @($version.assets)) {
            $assets.Add($candidate) | Out-Null
        }
    }

    foreach ($candidate in $assets) {
        if ([string]::Equals([string]$candidate.runtime, $Runtime, [System.StringComparison]::OrdinalIgnoreCase) -and
            [string]::Equals([string]$candidate.fileName, $FileName, [System.StringComparison]::OrdinalIgnoreCase)) {
            $candidate | Add-Member -NotePropertyName objectKey -NotePropertyValue $ObjectKey -Force
        }
    }
}

function Initialize-ReleasePackageDir {
    param([string]$OutputDir)

    $resolvedOutputDir = Resolve-ReleasePackageDir -OutputDir $OutputDir
    if (Test-PathIsDriveRoot -Path $resolvedOutputDir) {
        throw "拒绝使用磁盘根目录作为启动器新包输出目录：$resolvedOutputDir"
    }

    $skipClean = $script:ManualPublishInputDir -and [string]::Equals(
        [System.IO.Path]::GetFullPath($resolvedOutputDir).TrimEnd('\'),
        [System.IO.Path]::GetFullPath($script:ManualPublishInputDir).TrimEnd('\'),
        [System.StringComparison]::OrdinalIgnoreCase
    )

    if ((Test-Path -LiteralPath $resolvedOutputDir) -and !$skipClean) {
        Remove-Item -LiteralPath $resolvedOutputDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null

    return [ordered]@{
        Root = $resolvedOutputDir
    }
}

function Export-OssUploadFiles {
    param(
        [string]$InstallerPath,
        [string]$OutputDir
    )

    if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw "安装包不存在：$InstallerPath"
    }

    $targetPath = Join-Path $OutputDir (Split-Path -Leaf $InstallerPath)
    if (![string]::Equals(
        [System.IO.Path]::GetFullPath($InstallerPath),
        [System.IO.Path]::GetFullPath($targetPath),
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        Copy-Item -LiteralPath $InstallerPath -Destination $targetPath -Force
    }
    Write-Host "已生成 OSS 手动上传文件：$targetPath"
    return $targetPath
}

function Invoke-OssUpload {
    param(
        [string]$OssutilPath,
        [string]$LocalPath,
        [string]$ObjectKey,
        [string]$CheckpointDir
    )

    if (!(Test-Path -LiteralPath $LocalPath -PathType Leaf)) {
        throw "本地文件不存在：$LocalPath"
    }

    $file = Get-Item -LiteralPath $LocalPath
    $ossUri = "oss://$Bucket/$ObjectKey"
    Write-Host ""
    Write-Host ">>> 上传启动器文件到 OSS：$($file.Name)" -ForegroundColor Cyan
    Write-Host "    大小：$(Format-FileSize -Bytes $file.Length)"
    Write-Host "    目标：$ossUri"

    if ($DryRun) {
        Write-Host "    DryRun：跳过实际上传。" -ForegroundColor Yellow
        return
    }

    if (!(Test-Path -LiteralPath $CheckpointDir -PathType Container)) {
        New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null
    }

    & $OssutilPath cp $LocalPath $ossUri -e $Endpoint --region $Region -f --update --checkpoint-dir $CheckpointDir
    if ($LASTEXITCODE -ne 0) {
        throw "OSS 上传失败：$($file.Name)，ossutil exit code $LASTEXITCODE"
    }

    Write-Host "<<< OSS 上传完成：$($file.Name)" -ForegroundColor Green
}

function Invoke-RemotePowerShell {
    param(
        [string]$Target,
        [string]$Script
    )

    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Script))
    & ssh $Target "powershell -NoProfile -EncodedCommand $encoded"
    if ($LASTEXITCODE -ne 0) {
        throw "远端 PowerShell 执行失败，ssh exit code $LASTEXITCODE"
    }
}

function Get-RemoteManifestSnapshot {
    param(
        [string]$Target,
        [string]$RemoteUpdateJsonPath
    )

    if ([string]::IsNullOrWhiteSpace($Target) -or [string]::IsNullOrWhiteSpace($RemoteUpdateJsonPath)) {
        return $null
    }

    $remoteScript = @"
`$ErrorActionPreference = 'Stop'
`$path = '$RemoteUpdateJsonPath'
if (Test-Path -LiteralPath `$path -PathType Leaf) {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(`$false)
    [Console]::Out.Write((Get-Content -LiteralPath `$path -Raw -Encoding UTF8))
}
"@
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($remoteScript))
    $output = & ssh $Target "powershell -NoProfile -EncodedCommand $encoded"
    if ($LASTEXITCODE -ne 0) {
        throw "读取服务器旧清单失败：$RemoteUpdateJsonPath，ssh exit code $LASTEXITCODE"
    }

    $json = ($output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($json)) {
        return $null
    }
    return $json | ConvertFrom-Json
}

function Get-LauncherManifestObjectKeys {
    param([object[]]$Manifests)

    return @($Manifests |
        Where-Object { $null -ne $_ -and $null -ne $_.latest } |
        ForEach-Object { @($_.latest.assets) } |
        ForEach-Object { [string]$_.objectKey } |
        Where-Object { ![string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique)
}

function Remove-PreviousLauncherObjects {
    param(
        [string]$OssutilPath,
        [string[]]$ObjectKeys,
        [string[]]$CurrentObjectKeys
    )

    $allowedPrefixes = @(
        "toolboxes/crossingvoid-launcher/versions/",
        "toolboxes/crossingvoid-launcher-pc/releases/"
    )
    $protected = @($CurrentObjectKeys | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
    foreach ($objectKey in @($ObjectKeys | Select-Object -Unique)) {
        if ($protected -contains $objectKey) { continue }
        if (!($allowedPrefixes | Where-Object { $objectKey.StartsWith($_, [System.StringComparison]::Ordinal) })) {
            throw "拒绝删除启动器目录之外的 OSS 对象：$objectKey"
        }

        $ossUri = "oss://$Bucket/$objectKey"
        Write-Host "    删除旧启动器安装包：$ossUri" -ForegroundColor DarkYellow
        if ($DryRun) { continue }
        & $OssutilPath rm $ossUri -e $Endpoint --region $Region -f
        if ($LASTEXITCODE -ne 0) {
            throw "旧启动器安装包删除失败：$ossUri，ossutil exit code $LASTEXITCODE"
        }
    }
}

function Remove-LegacyLauncherPrefix {
    param([string]$OssutilPath)

    $legacyUri = "oss://$Bucket/toolboxes/crossingvoid-launcher/versions/"
    Write-Host "    清理旧版启动器历史目录：$legacyUri" -ForegroundColor DarkYellow
    if ($DryRun) { return }
    & $OssutilPath rm $legacyUri -e $Endpoint --region $Region -r -f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    旧版历史目录不存在或已清理，跳过。" -ForegroundColor DarkGray
    }
}

function Copy-BackendManifestToServer {
    param(
        [string]$ManifestPath,
        [string]$Target,
        [string]$RemoteUpdateJsonPath,
        [string]$ExpectedProductKey
    )

    if (!(Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "后端清单不存在：$ManifestPath"
    }

    if ([string]::IsNullOrWhiteSpace($Target)) {
        throw "服务器 SSH 目标不能为空。"
    }

    if ([string]::IsNullOrWhiteSpace($RemoteUpdateJsonPath) -or [string]::IsNullOrWhiteSpace($ExpectedProductKey)) {
        throw "服务器 update.json 路径不能为空。"
    }

    $remoteTempPath = "C:\Windows\Temp\crossingvoid-launcher-update.$([Guid]::NewGuid().ToString('N')).json"
    & scp $ManifestPath "${Target}:$remoteTempPath"
    if ($LASTEXITCODE -ne 0) {
        throw "上传后端清单到服务器失败，scp exit code $LASTEXITCODE"
    }

    $remoteScript = @"
`$ErrorActionPreference = 'Stop'
`$target = '$RemoteUpdateJsonPath'
`$temp = '$remoteTempPath'
if (!(Test-Path -LiteralPath `$temp -PathType Leaf)) {
    throw "临时清单不存在：`$temp"
}
`$targetDir = Split-Path -Parent `$target
New-Item -ItemType Directory -Force -Path `$targetDir | Out-Null
try {
    `$parsed = Get-Content -LiteralPath `$temp -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace(`$parsed.productKey) -or `$parsed.productKey -ne '$ExpectedProductKey') {
        throw "productKey 不正确：`$(`$parsed.productKey)"
    }
    if ([string]::IsNullOrWhiteSpace(`$parsed.latest.version)) {
        throw "latest.version 为空"
    }
    if (!`$parsed.latest.assets -or `$parsed.latest.assets.Count -lt 1) {
        throw "latest.assets 为空"
    }
    if (Test-Path -LiteralPath `$target -PathType Leaf) {
        `$backup = "`$target.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item -LiteralPath `$target -Destination `$backup -Force
    }
    Move-Item -LiteralPath `$temp -Destination `$target -Force
    [ordered]@{
        success = `$true
        target = `$target
        version = `$parsed.latest.version
        asset = `$parsed.latest.assets[0].fileName
    } | ConvertTo-Json -Compress
} catch {
    Remove-Item -LiteralPath `$temp -Force -ErrorAction SilentlyContinue
    throw
}
"@

    Invoke-RemotePowerShell -Target $Target -Script $remoteScript
}

$buildScript = Join-Path $PSScriptRoot "Build-LauncherUpdaterPackage.ps1"
if (!(Test-Path -LiteralPath $buildScript -PathType Leaf)) {
    throw "没有找到构建脚本：$buildScript"
}

$manualPublish = ![string]::IsNullOrWhiteSpace($InstallerPath) -or ![string]::IsNullOrWhiteSpace($ManifestPath)
if ($manualPublish) {
    if ([string]::IsNullOrWhiteSpace($InstallerPath) -or [string]::IsNullOrWhiteSpace($ManifestPath)) {
        throw "手动发布需要同时选择安装包 exe 和后端 update.json。"
    }
    if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw "选择的安装包不存在：$InstallerPath"
    }
    if (!(Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "选择的后端清单不存在：$ManifestPath"
    }
    $script:ManualPublishInputDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($InstallerPath))
    $SkipBuild = $true
}
else {
    $script:ManualPublishInputDir = $null
}

if (!$SkipBuild) {
    Write-DevProgress -Stage "build" -Percent 5 -Message "准备打包"
    & $buildScript -ProjectRoot $ProjectRoot -OssObjectPrefix $OssObjectPrefix -OutputDir $ReleasePackageDir -IntermediateOutputDir $IntermediateOutputDir
}

Write-DevProgress -Stage "manifest" -Percent 72 -Message "读取更新信息"
$outputDir = $IntermediateOutputDir
$generatedManifestPath = if ($manualPublish) {
    [System.IO.Path]::GetFullPath($ManifestPath)
}
else {
    Join-Path $IntermediateOutputDir "update.json"
}
if (!(Test-Path -LiteralPath $generatedManifestPath -PathType Leaf)) {
    throw "没有找到启动器后端清单：$generatedManifestPath。请先运行 Build-LauncherUpdaterPackage.ps1。"
}

$manifest = Get-Content -LiteralPath $generatedManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$asset = @($manifest.latest.assets | Select-Object -First 1)
if ($asset.Count -eq 0) {
    throw "启动器 update.json 没有 assets。"
}

$installerPath = if ($manualPublish) {
    [System.IO.Path]::GetFullPath($InstallerPath)
}
else {
    Join-Path $outputDir $asset[0].fileName
}
if (!(Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "启动器安装包不存在：$installerPath"
}
$installerFile = Get-Item -LiteralPath $installerPath
if (![string]::Equals($installerFile.Name, [string]$asset[0].fileName, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "所选安装包与 update.json 不匹配：清单为 $($asset[0].fileName)，安装包为 $($installerFile.Name)。"
}
if ($asset[0].sizeBytes -and [int64]$asset[0].sizeBytes -ne $installerFile.Length) {
    throw "所选安装包大小与 update.json 不匹配：清单为 $($asset[0].sizeBytes)，实际为 $($installerFile.Length)。"
}
$actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
if (![string]::IsNullOrWhiteSpace([string]$asset[0].sha256) -and
    ![string]::Equals($actualHash, [string]$asset[0].sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "所选安装包 SHA-256 与 update.json 不匹配。"
}

$objectPrefix = $OssObjectPrefix.Trim().TrimEnd('/')
if ([string]::IsNullOrWhiteSpace($objectPrefix)) {
    throw "OSS 对象键前缀不能为空。"
}
$runtime = if ([string]::IsNullOrWhiteSpace([string]$asset[0].runtime)) { "windows-x86_64" } else { [string]$asset[0].runtime }
$serverObjectKey = "$objectPrefix/$($manifest.latest.version)/$actualHash/$runtime/$($installerFile.Name)"
Set-LauncherManifestObjectKey -Manifest $manifest -Runtime $runtime -FileName $installerFile.Name -ObjectKey $serverObjectKey
Write-Host "已将 OSS 对象键写入 latest 与 versions：$serverObjectKey" -ForegroundColor Yellow
$legacyManifest = Copy-ManifestForProduct -Manifest $manifest -ProductKey $LegacyProductKey -ToolboxStableKey "CrossingVoidLauncher"
$pcManifest = Copy-ManifestForProduct -Manifest $manifest -ProductKey $PcProductKey -ToolboxStableKey "CrossingVoidLauncherPc"
$legacyManifestPath = Join-Path $IntermediateOutputDir "update.legacy.json"
$pcManifestPath = Join-Path $IntermediateOutputDir "update.pc.json"
$legacyManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $legacyManifestPath -Encoding UTF8
$pcManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $pcManifestPath -Encoding UTF8
$signaturePath = Join-Path $outputDir "$($asset[0].fileName).sig"
if (!(Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
    $signaturePath = Get-ChildItem -LiteralPath $outputDir -File |
        Where-Object { $_.Name -like "*.sig" } |
        Select-Object -First 1 -ExpandProperty FullName
}

Write-DevProgress -Stage "export" -Percent 78 -Message "准备服务器文件"
$releaseDirs = Initialize-ReleasePackageDir -OutputDir $ReleasePackageDir
$manualInstallerPath = Export-OssUploadFiles -InstallerPath $installerPath -OutputDir $releaseDirs.Root
$serverPatchManifestPath = Export-ServerPatchFile -SourcePath $legacyManifestPath -OutputDir $releaseDirs.Root -FileName "update.json"
$serverPcPatchManifestPath = Export-ServerPatchFile -SourcePath $pcManifestPath -OutputDir $releaseDirs.Root -FileName "update.pc.json"

$previousLegacyManifest = $null
$previousPcManifest = $null
if (!$SkipServer -and !$DryRun) {
    Write-DevProgress -Stage "snapshot" -Percent 80 -Message "读取服务器当前版本"
    $previousLegacyManifest = Get-RemoteManifestSnapshot -Target $ServerSshTarget -RemoteUpdateJsonPath $ServerUpdateJsonPath
    $previousPcManifest = Get-RemoteManifestSnapshot -Target $ServerSshTarget -RemoteUpdateJsonPath $ServerPcUpdateJsonPath
}

if (!$SkipOss) {
    $ossutil = Get-OssutilCommand
    $checkpointRoot = Join-Path $ProjectRoot "Saved\OssCheckpoints\LauncherUpdater"
    Write-DevProgress -Stage "upload" -Percent 84 -Message "上传安装包"
    Invoke-OssUpload `
        -OssutilPath $ossutil `
        -LocalPath $installerPath `
        -ObjectKey $asset[0].objectKey `
        -CheckpointDir (Join-Path $checkpointRoot "installer")

    Write-DevProgress -Stage "upload" -Percent 94 -Message "更新服务器信息"
}
else {
    Write-Host "已跳过 OSS 上传。" -ForegroundColor Yellow
}

if (!$SkipServer) {
    Write-DevProgress -Stage "server" -Percent 97 -Message "同步服务器"
    if ($DryRun) {
        Write-Host "DryRun：跳过服务器覆盖。" -ForegroundColor Yellow
    }
    else {
        Copy-BackendManifestToServer `
            -ManifestPath $legacyManifestPath `
            -Target $ServerSshTarget `
            -RemoteUpdateJsonPath $ServerUpdateJsonPath `
            -ExpectedProductKey $LegacyProductKey
        Copy-BackendManifestToServer `
            -ManifestPath $pcManifestPath `
            -Target $ServerSshTarget `
            -RemoteUpdateJsonPath $ServerPcUpdateJsonPath `
            -ExpectedProductKey $PcProductKey
    }
}
else {
    Write-Host "已跳过服务器覆盖。" -ForegroundColor Yellow
}

if (!$SkipOss -and !$SkipServer) {
    Write-DevProgress -Stage "cleanup" -Percent 99 -Message "删除旧启动器安装包"
    $previousObjectKeys = Get-LauncherManifestObjectKeys -Manifests @($previousLegacyManifest, $previousPcManifest)
    Remove-PreviousLauncherObjects `
        -OssutilPath $ossutil `
        -ObjectKeys $previousObjectKeys `
        -CurrentObjectKeys @($asset[0].objectKey)
    Remove-LegacyLauncherPrefix -OssutilPath $ossutil
}

Write-DevProgress -Stage "completed" -Percent 100 -Message "发布完成"
Write-Host ""
Write-Host "启动器更新包发布准备完成。" -ForegroundColor Green
Write-Host "Legacy Manifest：$legacyManifestPath"
Write-Host "PC Manifest：$pcManifestPath"
Write-Host "Installer：$installerPath"
Write-Host "OSS Key：$($asset[0].objectKey)"
Write-Host "Release Package：$($releaseDirs.Root)"
Write-Host "  Installer：$manualInstallerPath"
Write-Host "  Manifest：$serverPatchManifestPath"
Write-Host "  PC Manifest：$serverPcPatchManifestPath"
Write-Host "  旧版 PC：$ServerSshTarget -> $ServerUpdateJsonPath"
Write-Host "  新版 PC：$ServerSshTarget -> $ServerPcUpdateJsonPath"
Write-Host "  Android 产品键（预留）：$AndroidProductKey"
