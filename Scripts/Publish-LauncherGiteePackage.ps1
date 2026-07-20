param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$GiteeRepository = "xiaojie578/CrossingVoid-Downloader-PC",
    [string]$GiteeBranch = "master",
    [string]$GiteeAccessToken = "",
    [string]$ReleasePackageDir = "D:\启动器新包",
    [string]$IntermediateOutputDir = (Join-Path $ProjectRoot "dist-launcher-update"),
    [string]$InstallerPath = "",
    [string]$ManifestPath = "",
    [switch]$SkipBuild,
    [switch]$DryRun
)

. (Join-Path $PSScriptRoot "LauncherManifestUtilities.ps1")

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$script:GiteeAttachmentLimitBytes = 100MB

function Write-DevProgress {
    param([string]$Stage, [double]$Percent, [string]$Message)

    $payload = [ordered]@{
        stage = $Stage
        percent = [Math]::Max(0, [Math]::Min(100, $Percent))
        message = $Message
    }
    Write-Output ("::progress" + ($payload | ConvertTo-Json -Compress))
}

function Get-GiteeApiUrl {
    param([string]$Path)
    return "https://gitee.com/api/v5/repos/$GiteeRepository/$Path"
}

function Assert-GiteeAccessToken {
    if ([string]::IsNullOrWhiteSpace($GiteeAccessToken)) {
        throw "未找到 Gitee 访问令牌。请配置 FANTASYTOOLS_GITEE_TOKEN、GITEE_TOKEN 或 GITEE_ACCESS_TOKEN 后重新发布。"
    }
}

function Get-GiteeAccessToken {
    param([string]$CurrentValue)

    if (![string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue.Trim()
    }

    foreach ($name in @("FANTASYTOOLS_GITEE_TOKEN", "GITEE_TOKEN", "GITEE_ACCESS_TOKEN")) {
        foreach ($scope in @("Process", "User", "Machine")) {
            $value = [Environment]::GetEnvironmentVariable($name, $scope)
            if (![string]::IsNullOrWhiteSpace($value)) {
                return $value.Trim()
            }
        }
    }

    return ""
}

function Convert-BackendManifestToTauriManifest {
    param(
        [object]$BackendManifest,
        [string]$InstallerName
    )

    $release = $BackendManifest.latest
    if ($null -eq $release -or [string]::IsNullOrWhiteSpace([string]$release.version)) {
        throw "update.json 缺少 latest.version，无法生成启动器更新清单。"
    }

    $asset = @($release.assets | Where-Object { $_.runtime -eq "windows-x86_64" } | Select-Object -First 1)
    if ($asset.Count -ne 1) {
        throw "update.json 缺少 Windows 启动器资产，无法生成启动器更新清单。"
    }
    $asset = $asset[0]
    if ([string]::IsNullOrWhiteSpace([string]$asset.signature) -or [string]::IsNullOrWhiteSpace([string]$asset.downloadUrl)) {
        throw "update.json 缺少 Windows 启动器的签名或下载地址。"
    }
    if (![string]::Equals([string]$asset.fileName, $InstallerName, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "所选安装包与 update.json 不匹配：清单为 $($asset.fileName)，安装包为 $InstallerName。"
    }

    return [ordered]@{
        version = [string]$release.version
        notes = if ([string]::IsNullOrWhiteSpace([string]$release.releaseNotes)) { "Crossing Void launcher update $($release.version)" } else { [string]$release.releaseNotes }
        pub_date = Convert-ToRfc3339Timestamp $release.publishedAt
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = [string]$asset.signature
                url = [string]$asset.downloadUrl
            }
        }
    }
}

function Convert-TauriManifestToBackendManifest {
    param(
        [object]$TauriManifest,
        [System.IO.FileInfo]$InstallerFile,
        [string]$Signature
    )

    $platform = $TauriManifest.platforms.'windows-x86_64'
    if ([string]::IsNullOrWhiteSpace([string]$TauriManifest.version) -or $null -eq $platform) {
        throw "latest.json 缺少版本或 Windows 平台信息，无法生成 OSS 兼容清单。"
    }
    $publishedAt = Convert-ToRfc3339Timestamp $TauriManifest.pub_date
    $asset = [ordered]@{
        runtime = "windows-x86_64"
        fileName = $InstallerFile.Name
        downloadUrl = [string]$platform.url
        sha256 = (Get-FileHash -LiteralPath $InstallerFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = $InstallerFile.Length
        contentType = "application/octet-stream"
        signature = $Signature
    }
    $versionEntry = [ordered]@{
        version = [string]$TauriManifest.version
        title = "零境启动器 $($TauriManifest.version)"
        channel = "stable"
        publishedAt = $publishedAt
        minSupportedVersion = "0.0.0"
        releaseNotesUrl = ""
        releaseNotes = [string]$TauriManifest.notes
        requiresManualMigration = $false
        requiresRestart = $true
        assets = @($asset)
    }
    return [ordered]@{
        schemaVersion = 1
        toolboxStableKey = "CrossingVoidLauncher"
        productKey = "crossingvoid-launcher"
        displayName = "零境启动器"
        latest = $versionEntry
        versions = @($versionEntry)
        channels = [ordered]@{ stable = [string]$TauriManifest.version; beta = $null }
    }
}

$GiteeAccessToken = Get-GiteeAccessToken -CurrentValue $GiteeAccessToken

function Invoke-GiteeApi {
    param(
        [ValidateSet("Get", "Post", "Put", "Patch")]
        [string]$Method,
        [string]$Path,
        [hashtable]$Body
    )

    Assert-GiteeAccessToken
    $uri = Get-GiteeApiUrl -Path $Path
    $payload = @{} + ($Body ?? @{})
    $payload.access_token = $GiteeAccessToken
    if ($Method -eq "Get") {
        $query = @($payload.GetEnumerator() | ForEach-Object {
                "{0}={1}" -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value)
            }) -join "&"
        $separator = if ($uri.Contains("?")) { "&" } else { "?" }
        return Invoke-RestMethod -Method Get -Uri "${uri}$separator$query"
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -ContentType "application/x-www-form-urlencoded; charset=utf-8" -Body $payload
}

function Get-GiteeRelease {
    param([string]$Tag)

    $releases = Invoke-GiteeApi -Method Get -Path "releases?per_page=100" -Body @{}
    return @($releases | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1)
}

function Ensure-GiteeRelease {
    param(
        [string]$Tag,
        [string]$Title,
        [string]$Notes
    )

    $repository = Invoke-GiteeApi -Method Get -Path "" -Body @{}
    $defaultBranch = [string]$repository.default_branch
    if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
        throw "Gitee 仓库尚未初始化分支。请先在仓库创建 README 并保留 master 分支。"
    }

    $existing = Get-GiteeRelease -Tag $Tag
    $body = @{
        tag_name = $Tag
        name = $Title
        body = $Notes
        prerelease = $false
        target_commitish = $defaultBranch
    }
    if ($null -eq $existing) {
        Write-Host ">>> 创建 Gitee Release：$GiteeRepository / $Tag" -ForegroundColor Cyan
        return Invoke-GiteeApi -Method Post -Path "releases" -Body $body
    }

    Write-Host ">>> 更新 Gitee Release：$GiteeRepository / $Tag" -ForegroundColor Cyan
    return Invoke-GiteeApi -Method Patch -Path ("releases/{0}" -f $existing.id) -Body $body
}

function Get-GiteeReleaseAssets {
    param([int]$ReleaseId)
    return @(Invoke-GiteeApi -Method Get -Path ("releases/{0}/attach_files?per_page=100" -f $ReleaseId) -Body @{})
}

function Add-GiteeReleaseAsset {
    param(
        [int]$ReleaseId,
        [string]$Path,
        [object[]]$ExistingAssets
    )

    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "发布附件不存在：$Path"
    }

    $file = Get-Item -LiteralPath $Path
    if ($file.Length -gt $script:GiteeAttachmentLimitBytes) {
        throw "Gitee Release 单个附件上限按 100 MiB 处理：$($file.Name) 当前为 $([Math]::Round($file.Length / 1MB, 2)) MB。"
    }
    $existing = @($ExistingAssets | Where-Object { $_.name -eq $file.Name } | Select-Object -First 1)
    if ($existing.Count -gt 0) {
        if ([int64]$existing[0].size -eq $file.Length) {
            Write-Host "  已存在同名同大小附件，跳过：$($file.Name)" -ForegroundColor DarkGray
            return
        }
        throw "Gitee Release 已有同名但大小不同的附件：$($file.Name)。请使用新的版本号。"
    }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($null -eq $curl) { throw "没有找到 curl.exe，无法上传 Gitee Release 附件。" }
    Write-Host "  上传 Gitee 附件：$($file.Name) ($(('{0:N2}' -f ($file.Length / 1MB))) MB)" -ForegroundColor Cyan
    $uri = Get-GiteeApiUrl -Path ("releases/{0}/attach_files" -f $ReleaseId)
    & curl.exe --fail-with-body --show-error --progress-bar --request POST --form "access_token=$GiteeAccessToken" --form "file=@$($file.FullName);filename=$($file.Name)" $uri
    if ($LASTEXITCODE -ne 0) { throw "Gitee 附件上传失败：$($file.Name)，curl exit code $LASTEXITCODE" }
}

function Publish-GiteeRepositoryFile {
    param(
        [string]$LocalPath,
        [string]$RepositoryPath,
        [string]$CommitMessage
    )

    if (!(Test-Path -LiteralPath $LocalPath -PathType Leaf)) {
        throw "仓库清单文件不存在：$LocalPath"
    }

    $escapedPath = ($RepositoryPath -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
    $current = $null
    try {
        $current = Invoke-GiteeApi -Method Get -Path ("contents/{0}?ref={1}" -f $escapedPath, [uri]::EscapeDataString($GiteeBranch)) -Body @{}
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -ne 404) { throw }
    }

    $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
    $body = @{
        branch = $GiteeBranch
        message = $CommitMessage
        content = [Convert]::ToBase64String($bytes)
    }
    if ($null -ne $current -and ![string]::IsNullOrWhiteSpace($current.sha)) {
        $body.sha = $current.sha
        Invoke-GiteeApi -Method Put -Path ("contents/{0}" -f $escapedPath) -Body $body | Out-Null
    }
    else {
        Invoke-GiteeApi -Method Post -Path ("contents/{0}" -f $escapedPath) -Body $body | Out-Null
    }
}

$buildScript = Join-Path $PSScriptRoot "Build-LauncherUpdaterPackage.ps1"
if (!(Test-Path -LiteralPath $buildScript -PathType Leaf)) {
    throw "没有找到构建脚本：$buildScript"
}

$manualPublish = ![string]::IsNullOrWhiteSpace($InstallerPath) -or ![string]::IsNullOrWhiteSpace($ManifestPath)
if ($manualPublish -and ([string]::IsNullOrWhiteSpace($InstallerPath) -or [string]::IsNullOrWhiteSpace($ManifestPath))) {
    throw "手动发布需要同时选择安装包 exe 和 latest.json。"
}

if (!$SkipBuild -and !$manualPublish) {
    Write-DevProgress -Stage "build" -Percent 5 -Message "构建启动器"
    & $buildScript -ProjectRoot $ProjectRoot -OutputDir $ReleasePackageDir -IntermediateOutputDir $IntermediateOutputDir -GiteeRepository $GiteeRepository
    if ($LASTEXITCODE -ne 0) {
        throw "启动器构建失败，exit code $LASTEXITCODE"
    }
}

$manifestInputPath = if ($manualPublish) { [System.IO.Path]::GetFullPath($ManifestPath) } else { Join-Path $IntermediateOutputDir "latest.json" }
if (!(Test-Path -LiteralPath $manifestInputPath -PathType Leaf)) {
    throw "没有找到启动器更新清单：$manifestInputPath"
}

$sourceManifest = Get-Content -LiteralPath $manifestInputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest = $sourceManifest

$installerPath = if ($manualPublish) { [System.IO.Path]::GetFullPath($InstallerPath) } else {
    $url = [uri]$manifest.platforms.'windows-x86_64'.url
    Join-Path $IntermediateOutputDir ([uri]::UnescapeDataString([System.IO.Path]::GetFileName($url.AbsolutePath)))
}
if (!(Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "启动器安装包不存在：$installerPath"
}
$signaturePath = "$installerPath.sig"
if (!(Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
    $stagingInstallerPath = Join-Path $IntermediateOutputDir (Split-Path -Leaf $installerPath)
    $stagingSignaturePath = "$stagingInstallerPath.sig"
    if ((Test-Path -LiteralPath $stagingInstallerPath -PathType Leaf) -and (Test-Path -LiteralPath $stagingSignaturePath -PathType Leaf)) {
        $selectedHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
        $stagingHash = (Get-FileHash -LiteralPath $stagingInstallerPath -Algorithm SHA256).Hash
        if ([string]::Equals($selectedHash, $stagingHash, [System.StringComparison]::OrdinalIgnoreCase)) {
            Write-Host "  外部输出目录缺少签名，已校验并使用中间产物签名。" -ForegroundColor Yellow
            $signaturePath = $stagingSignaturePath
        }
    }
    if (!(Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
        throw "启动器签名不存在：$signaturePath。请重新打包，或选择包含同名 .sig 的安装包。"
    }
}

$latestManifestPath = $manifestInputPath
if ([string]::IsNullOrWhiteSpace([string]$manifest.version) -or !$manifest.platforms.'windows-x86_64'.url) {
    if (!$manualPublish) {
        throw "latest.json 缺少版本或 Windows 更新地址。"
    }

    $manifest = Convert-BackendManifestToTauriManifest -BackendManifest $manifest -InstallerName (Split-Path -Leaf $installerPath)
    $latestManifestPath = Join-Path $IntermediateOutputDir "latest.from-update.json"
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $latestManifestPath -Encoding UTF8
}

$backendCompatibilityManifestPath = if ($null -ne $sourceManifest.latest -and $sourceManifest.latest.assets) {
    $manifestInputPath
}
else {
    $generatedBackendPath = Join-Path $IntermediateOutputDir "update.json"
    if (!$manualPublish -and (Test-Path -LiteralPath $generatedBackendPath -PathType Leaf)) {
        $generatedBackendPath
    }
    else {
        $signatureText = (Get-Content -LiteralPath $signaturePath -Raw -Encoding UTF8).Trim()
        $backendCompatibilityManifest = Convert-TauriManifestToBackendManifest `
            -TauriManifest $manifest `
            -InstallerFile (Get-Item -LiteralPath $installerPath) `
            -Signature $signatureText
        $convertedBackendPath = Join-Path $IntermediateOutputDir "update.from-latest.json"
        $backendCompatibilityManifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $convertedBackendPath -Encoding UTF8
        $convertedBackendPath
    }
}

$tag = "launcher-v$($manifest.version)"
$notes = "零境启动器 $($manifest.version)"
Write-DevProgress -Stage "prepare" -Percent 60 -Message "准备 Gitee 发布"
if ($DryRun) {
    Write-Host "DryRun：将发布 $installerPath、$signaturePath 和 launcher/latest.json 到 $GiteeRepository。" -ForegroundColor Yellow
}
else {
    $release = Ensure-GiteeRelease -Tag $tag -Title $notes -Notes $notes
    $existingAssets = Get-GiteeReleaseAssets -ReleaseId ([int]$release.id)
    Write-DevProgress -Stage "upload" -Percent 75 -Message "上传安装包到 Gitee"
    Add-GiteeReleaseAsset -ReleaseId ([int]$release.id) -Path $installerPath -ExistingAssets $existingAssets
    $existingAssets = Get-GiteeReleaseAssets -ReleaseId ([int]$release.id)
    Add-GiteeReleaseAsset -ReleaseId ([int]$release.id) -Path $signaturePath -ExistingAssets $existingAssets
    Write-DevProgress -Stage "manifest" -Percent 92 -Message "更新 Gitee 版本信息"
    Publish-GiteeRepositoryFile -LocalPath $latestManifestPath -RepositoryPath "launcher/latest.json" -CommitMessage "Update launcher to $($manifest.version)"
}

$ossCompatibilityPublisher = Join-Path $PSScriptRoot "Publish-LauncherUpdaterPackage.ps1"
if (!(Test-Path -LiteralPath $ossCompatibilityPublisher -PathType Leaf)) {
    throw "没有找到 OSS 兼容发布脚本：$ossCompatibilityPublisher"
}
Write-DevProgress -Stage "oss-compatibility" -Percent 96 -Message "同步旧版启动器更新"
& $ossCompatibilityPublisher `
    -ProjectRoot $ProjectRoot `
    -ReleasePackageDir $ReleasePackageDir `
    -IntermediateOutputDir $IntermediateOutputDir `
    -SkipBuild `
    -InstallerPath $installerPath `
    -ManifestPath $backendCompatibilityManifestPath `
    -DryRun:$DryRun

Write-DevProgress -Stage "completed" -Percent 100 -Message "Gitee 发布完成"
Write-Host "Gitee Release：https://gitee.com/$GiteeRepository/releases/tag/$tag"
Write-Host "更新清单：https://gitee.com/$GiteeRepository/raw/$GiteeBranch/launcher/latest.json"
