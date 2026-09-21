param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$PrivateKeyPath = (Join-Path $ProjectRoot "src-tauri\private\updater.key"),
    [string]$GiteeRepository = "xiaojie578/CrossingVoid-Downloader-PC",
    [string]$GiteeReleaseTagPrefix = "launcher-v",
    [string]$ProductKey = "crossingvoid-launcher",
    [string]$DisplayName = "零境启动器",
    [string]$OutputDir = "D:\启动器新包",
    [string]$IntermediateOutputDir = (Join-Path $ProjectRoot "dist-launcher-update"),
    [double]$ProgressStart = 0,
    [double]$ProgressEnd = 100
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
        type = 'progress'
        stage = $Stage
        percent = $ProgressStart + (($ProgressEnd - $ProgressStart) * ([Math]::Max(0, [Math]::Min(100, $Percent)) / 100))
        message = $Message
    }
    Write-Output ("::axtools " + ($payload | ConvertTo-Json -Compress))
}

function Get-JsonValue {
    param([object]$Json, [string]$Name)
    return $Json.$Name
}

function Test-SamePath {
    param([string]$Left, [string]$Right)

    $leftFullPath = [System.IO.Path]::GetFullPath($Left).TrimEnd('\')
    $rightFullPath = [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($leftFullPath, $rightFullPath, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathIsDriveRoot {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPath = [System.IO.Path]::GetPathRoot($fullPath)
    return [string]::Equals($fullPath.TrimEnd('\'), $rootPath.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-ReleasePackageDir {
    param([string]$ReleaseDir)

    if ([string]::IsNullOrWhiteSpace($ReleaseDir)) {
        throw "启动器新包输出目录不能为空。"
    }

    $fullPath = [System.IO.Path]::GetFullPath($ReleaseDir)
    if (Test-PathIsDriveRoot -Path $fullPath) {
        return (Join-Path $fullPath "启动器新包")
    }

    return $fullPath
}

function Initialize-ReleasePackageDir {
    param(
        [string]$ReleaseDir,
        [string]$StagingDir
    )

    $resolvedReleaseDir = Resolve-ReleasePackageDir -ReleaseDir $ReleaseDir

    if (Test-PathIsDriveRoot -Path $resolvedReleaseDir) {
        throw "拒绝使用磁盘根目录作为启动器新包输出目录：$resolvedReleaseDir"
    }

    if (Test-SamePath -Left $resolvedReleaseDir -Right $StagingDir) {
        throw "启动器新包输出目录不能和中间产物目录相同：$StagingDir"
    }

    New-Item -ItemType Directory -Path $resolvedReleaseDir -Force | Out-Null

    return [ordered]@{
        Root = $resolvedReleaseDir
    }
}

function Export-ReleasePackageFiles {
    param(
        [string]$InstallerPath,
        [string]$SignaturePath,
        [string]$BackendManifestPath,
        [string]$ReleaseDir,
        [string]$StagingDir
    )

    $releaseDirs = Initialize-ReleasePackageDir -ReleaseDir $ReleaseDir -StagingDir $StagingDir
    $manualInstallerPath = Join-Path $releaseDirs.Root (Split-Path -Leaf $InstallerPath)
    Copy-Item -LiteralPath $InstallerPath -Destination $manualInstallerPath -Force
    $manualSignaturePath = Join-Path $releaseDirs.Root (Split-Path -Leaf $SignaturePath)
    Copy-Item -LiteralPath $SignaturePath -Destination $manualSignaturePath -Force

    $serverManifestPath = Join-Path $releaseDirs.Root "update.json"
    Copy-Item -LiteralPath $BackendManifestPath -Destination $serverManifestPath -Force

    return [ordered]@{
        Root = $releaseDirs.Root
        Installer = $manualInstallerPath
        Signature = $manualSignaturePath
        Manifest = $serverManifestPath
    }
}

function Update-UpdaterSignature {
    param(
        [string]$FilePath,
        [string]$SignaturePath
    )

    Push-Location $ProjectRoot
    try {
        $signatureOutput = npm run tauri -- signer sign --private-key-path $PrivateKeyPath --password= $FilePath
    } finally {
        Pop-Location
    }

    if ($LASTEXITCODE -ne 0) {
        throw "重新生成 Tauri updater 签名失败，exit code $LASTEXITCODE"
    }

    $signatureText = ($signatureOutput | Where-Object { $_ -match '^[A-Za-z0-9+/=]+$' } | Select-Object -Last 1)
    if ([string]::IsNullOrWhiteSpace($signatureText)) {
        throw "没有从 Tauri signer 输出里解析到签名。"
    }

    Set-Content -LiteralPath $SignaturePath -Value $signatureText.Trim() -Encoding UTF8
}

function ConvertTo-UrlPathSegment {
    param([string]$Value)

    return [System.Uri]::EscapeDataString($Value)
}

function Get-MakensisCommand {
    $candidates = @(
        "C:\Users\liuyu\AppData\Local\tauri\NSIS\Bin\makensis.exe",
        "C:\Users\liuyu\AppData\Local\tauri\NSIS\makensis.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    $command = Get-Command "makensis" -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    throw "没有找到 makensis，无法重新生成带自定义文件图标的 NSIS 安装包。"
}

$script:NsisReinstallPageMarker = '; === 零境启动器：跳过“维护/重装”页面 ==='

function Disable-NsisReinstallPage {
    <#
        手动双击 setup.exe 时，NSIS 模板会先弹一页"已安装 / 选择维护操作"：
        默认选中「安装前卸载」，点下一步就真的去跑旧版卸载器。中途点错或关窗口，
        机器上就只剩一个空目录 —— 用户实测踩过这个坑。

        我们本来就是覆盖安装（同名文件直接替换），不需要先卸载，所以整页跳过。
        Tauri 每次 bundle 都会重新生成 installer.nsi，这里在编译前打补丁；
        模板结构变了就抛错，宁可构建失败也不要悄悄失去这道保护。
    #>
    param([string]$ScriptText)

    if ($ScriptText.Contains($script:NsisReinstallPageMarker)) {
        return $ScriptText
    }

    $pagePattern = '(?m)^Function[ \t]+PageReinstall[ \t\r]*$'
    if ($ScriptText -notmatch $pagePattern) {
        throw "NSIS 脚本里找不到 PageReinstall 页面，无法保证安装程序不会误卸载启动器。请检查 Tauri 的 NSIS 模板是否变了。"
    }

    $skipBlock = @(
        'Function PageReinstall'
        "  $($script:NsisReinstallPageMarker)"
        '  ; 这一页默认选中"安装前卸载"，会真的调用旧版卸载器；我们改成直接跳过整页，'
        '  ; 让安装程序只做覆盖安装。卸载仍然可以通过控制面板或启动器里的卸载入口完成。'
        '  Abort'
    ) -join "`r`n"

    return [regex]::Replace($ScriptText, $pagePattern, $skipBlock.Replace('$', '$$'))
}

function Rebuild-NsisInstallerWithFileIcon {
    param(
        [string]$BundleInstallerPath,
        [string]$IconPath
    )

    $nsisWorkDir = Join-Path $ProjectRoot "src-tauri\target\release\nsis\x64"
    $installerScript = Join-Path $nsisWorkDir "installer.nsi"
    if (!(Test-Path -LiteralPath $installerScript -PathType Leaf)) {
        throw "没有找到 NSIS 脚本：$installerScript"
    }

    if (!(Test-Path -LiteralPath $IconPath -PathType Leaf)) {
        throw "图标文件不存在：$IconPath"
    }

    $scriptText = Get-Content -LiteralPath $installerScript -Raw
    if ($scriptText -match '(?m)^Icon\s+') {
        $scriptText = $scriptText -replace '(?m)^Icon\s+.*$', "Icon `"$IconPath`""
    } else {
        $scriptText = $scriptText -replace '(?m)^(OutFile "\$\{OUTFILE\}")', "`$1`r`nIcon `"$IconPath`""
    }

    if ($scriptText -match '(?m)^UninstallIcon\s+') {
        $scriptText = $scriptText -replace '(?m)^UninstallIcon\s+.*$', "UninstallIcon `"$IconPath`""
    } else {
        $scriptText = $scriptText -replace '(?m)^(!define MUI_UNICON "\$\{UNINSTALLERICON\}")', "`$1`r`nUninstallIcon `"$IconPath`""
    }

    $scriptText = Disable-NsisReinstallPage -ScriptText $scriptText

    [System.IO.File]::WriteAllText(
        $installerScript,
        $scriptText,
        [System.Text.UTF8Encoding]::new($true)
    )

    $makensis = Get-MakensisCommand
    Push-Location $nsisWorkDir
    try {
        & $makensis $installerScript
        if ($LASTEXITCODE -ne 0) {
            throw "makensis 重新生成安装包失败，exit code $LASTEXITCODE"
        }

        $rebuiltInstaller = Join-Path $nsisWorkDir "nsis-output.exe"
        if (!(Test-Path -LiteralPath $rebuiltInstaller -PathType Leaf)) {
            throw "makensis 没有生成预期文件：$rebuiltInstaller"
        }

        Copy-Item -LiteralPath $rebuiltInstaller -Destination $BundleInstallerPath -Force
    } finally {
        Pop-Location
    }
}

function Resolve-LauncherVersion {
    $developerVersionPath = Join-Path $ProjectRoot "Saved\Launcher\developer-version.json"
    if (Test-Path -LiteralPath $developerVersionPath -PathType Leaf) {
        $developerVersion = Get-Content -LiteralPath $developerVersionPath -Raw | ConvertFrom-Json
        $value = [string](Get-JsonValue $developerVersion "version")
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value.Trim()
        }
    }

    $config = Get-Content -LiteralPath (Join-Path $ProjectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
    return ([string](Get-JsonValue $config "version")).Trim()
}

function Assert-CommandAvailable {
    param([string]$Name)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "打包环境缺少命令：$Name"
    }
}

if (-not (Test-Path -LiteralPath $PrivateKeyPath)) {
    throw "Updater private key not found: $PrivateKeyPath"
}

Write-DevProgress -Stage "prepare" -Percent 3 -Message "检查环境"
Assert-CommandAvailable -Name "npm"
Assert-CommandAvailable -Name "cargo"
New-Item -ItemType Directory -Force -Path $IntermediateOutputDir | Out-Null
$version = Resolve-LauncherVersion
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "启动器版本号格式不正确：$version"
}
Write-DevProgress -Stage "version" -Percent 6 -Message "确认版本 $version"
$versionOverridePath = Join-Path $IntermediateOutputDir "tauri-version.override.json"
[ordered]@{ version = $version } | ConvertTo-Json | Set-Content -LiteralPath $versionOverridePath -Encoding UTF8
Write-DevProgress -Stage "output" -Percent 8 -Message "准备文件"

$previousSigningPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousSigningPrivateKeyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
$previousSigningPrivateKeyPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$previousLauncherVersion = $env:CV_LAUNCHER_VERSION
$privateKeyText = (Get-Content -LiteralPath $PrivateKeyPath -Raw).Trim()
Write-DevProgress -Stage "signing-env" -Percent 11 -Message "读取签名"
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKeyText
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $PrivateKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$env:CV_LAUNCHER_VERSION = $version
Push-Location $ProjectRoot
try {
    Write-DevProgress -Stage "tauri-build" -Percent 16 -Message "构建启动器"
    npm run tauri -- build --no-bundle --config $versionOverridePath --ci
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri Release 程序构建失败，exit code $LASTEXITCODE。请查看完整构建日志。"
    }

    Write-DevProgress -Stage "bundle" -Percent 48 -Message "生成安装包"
    npm run tauri -- bundle --config $versionOverridePath --ci
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri 安装包构建失败，exit code $LASTEXITCODE。请查看完整构建日志。"
    }
} finally {
    Pop-Location
    if ($null -eq $previousSigningPrivateKey) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    } else {
        $env:TAURI_SIGNING_PRIVATE_KEY = $previousSigningPrivateKey
    }

    if ($null -eq $previousSigningPrivateKeyPath) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
    } else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $previousSigningPrivateKeyPath
    }

    if ($null -eq $previousSigningPrivateKeyPassword) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    } else {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousSigningPrivateKeyPassword
    }

    if ($null -eq $previousLauncherVersion) {
        Remove-Item Env:\CV_LAUNCHER_VERSION -ErrorAction SilentlyContinue
    } else {
        $env:CV_LAUNCHER_VERSION = $previousLauncherVersion
    }

}

Write-DevProgress -Stage "collect" -Percent 66 -Message "查找安装包"
$bundleRoot = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
$nsisBundleRoot = Join-Path $bundleRoot "nsis"
$installer = Get-ChildItem -LiteralPath $nsisBundleRoot -File |
    Where-Object { $_.Name -like "*setup.exe" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    throw "No NSIS setup.exe installer found under $nsisBundleRoot"
}

$signature = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File |
    Where-Object { $_.FullName -eq "$($installer.FullName).sig" -or $_.Name -eq "$($installer.Name).sig" } |
    Select-Object -First 1

if (-not $signature) {
    throw "No updater signature found for $($installer.FullName). Make sure TAURI_SIGNING_PRIVATE_KEY is set during build."
}

if ($installer.Extension.Equals(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-DevProgress -Stage "icon" -Percent 72 -Message "设置安装包图标"
    $installerIconPath = Join-Path $ProjectRoot "src-tauri\icons\installer.ico"
    Rebuild-NsisInstallerWithFileIcon -BundleInstallerPath $installer.FullName -IconPath $installerIconPath
    Write-DevProgress -Stage "signature" -Percent 80 -Message "生成更新签名"
    Update-UpdaterSignature -FilePath $installer.FullName -SignaturePath $signature.FullName
}

Write-DevProgress -Stage "copy-staging" -Percent 84 -Message "复制打包文件"
$targetInstaller = Join-Path $IntermediateOutputDir $installer.Name
$targetSignature = Join-Path $IntermediateOutputDir $signature.Name
Copy-Item -LiteralPath $installer.FullName -Destination $targetInstaller -Force
Copy-Item -LiteralPath $signature.FullName -Destination $targetSignature -Force

Write-DevProgress -Stage "manifest" -Percent 88 -Message "生成更新信息"
$signatureText = (Get-Content -LiteralPath $targetSignature -Raw).Trim()
$installerHash = (Get-FileHash -LiteralPath $targetInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
$installerSize = (Get-Item -LiteralPath $targetInstaller).Length
$releaseTag = "$GiteeReleaseTagPrefix$version"
$downloadUrl = "https://gitee.com/$GiteeRepository/releases/download/$releaseTag/$([uri]::EscapeDataString($installer.Name))"
$staticManifest = [ordered]@{
    version = $version
    notes = "Crossing Void launcher update $version"
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signatureText
            url = $downloadUrl
        }
    }
}

$publishedAt = (Get-Date).ToUniversalTime().ToString("o")
$asset = [ordered]@{
    runtime = "windows-x86_64"
    fileName = $installer.Name
    downloadUrl = $downloadUrl
    sha256 = $installerHash
    sizeBytes = $installerSize
    contentType = "application/octet-stream"
    signature = $signatureText
}
$versionManifest = [ordered]@{
    version = $version
    title = "$DisplayName $version"
    channel = "stable"
    publishedAt = $publishedAt
    minSupportedVersion = "0.0.0"
    releaseNotesUrl = ""
    releaseNotes = "Crossing Void launcher update $version"
    requiresManualMigration = $false
    requiresRestart = $true
    assets = @($asset)
}
$backendManifest = [ordered]@{
    schemaVersion = 1
    toolboxStableKey = "CrossingVoidLauncher"
    productKey = $ProductKey
    displayName = $DisplayName
    latest = $versionManifest
    versions = @($versionManifest)
    channels = [ordered]@{
        stable = $version
        beta = $null
    }
}

$staticManifestPath = Join-Path $IntermediateOutputDir "latest.json"
$backendManifestPath = Join-Path $IntermediateOutputDir "update.json"
$staticManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $staticManifestPath -Encoding UTF8
$backendManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $backendManifestPath -Encoding UTF8

Write-DevProgress -Stage "export" -Percent 96 -Message "整理输出文件"
$releasePackage = Export-ReleasePackageFiles `
    -InstallerPath $targetInstaller `
    -SignaturePath $targetSignature `
    -BackendManifestPath $backendManifestPath `
    -ReleaseDir $OutputDir `
    -StagingDir $IntermediateOutputDir

Write-DevProgress -Stage "completed" -Percent 100 -Message "打包完成"
Write-Host "Launcher updater package generated:"
Write-Host "  Release Package : $($releasePackage.Root)"
Write-Host "  Installer       : $($releasePackage.Installer)"
Write-Host "  Signature       : $($releasePackage.Signature)"
Write-Host "  Manifest        : $($releasePackage.Manifest)"
Write-Host "  Staging Installer : $targetInstaller"
Write-Host "  Staging Signature : $targetSignature"
Write-Host "  Staging Static    : $staticManifestPath"
Write-Host "  Staging Backend   : $backendManifestPath"
Write-Host "  Gitee Release     : $GiteeRepository / $releaseTag"
