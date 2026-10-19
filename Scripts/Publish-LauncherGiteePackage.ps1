param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$GiteeRepository = "xiaojie578/CrossingVoid-Launcher-PC",
    [string]$GiteeBranch = "master",
    [string]$GiteeAccessToken = "",
    [string]$ReleasePackageDir = "D:\启动器新包",
    [string]$IntermediateOutputDir = (Join-Path $ProjectRoot "dist-launcher-update"),
    [string]$InstallerPath = "",
    [string]$ManifestPath = "",
    [string]$ProductKey = "crossingvoid-launcher",
    [string]$InstallerManifestProductKey = "crossingvoid-launcher-pc-installer",
    [string]$ServerSshTarget = "crossing-server",
    [string]$WebsiteMirrorDirectory = "C:\inetpub\wwwroot\manifests\launcher",
    [string]$TauriManifestMirrorName = "pc-latest.json",
    [string]$InstallerManifestMirrorName = "pc-installer-latest.json",
    [switch]$SkipBuild,
    [switch]$SkipWebsiteMirror,
    [switch]$WithOssCompat,
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
        type = 'progress'
        stage = $Stage
        percent = [Math]::Max(0, [Math]::Min(100, $Percent))
        message = $Message
    }
    Write-Output ("::axtools " + ($payload | ConvertTo-Json -Compress))
}

function Set-DevCancellationMode {
    param([ValidateSet('stop','locked')][string]$Mode,[string]$Message)
    Write-Output ("::axtools " + ([ordered]@{ type='cancellation'; mode=$Mode; message=$Message } | ConvertTo-Json -Compress))
}

function Get-GiteeApiUrl {
    param([string]$Path)
    return "https://gitee.com/api/v5/repos/$GiteeRepository/$Path"
}

function Assert-GiteeAccessToken {
    if ([string]::IsNullOrWhiteSpace($GiteeAccessToken)) {
        throw "未找到 Gitee 访问令牌。请配置 AXTOOLS_GITEE_TOKEN、FANTASYTOOLS_GITEE_TOKEN、GITEE_TOKEN 或 GITEE_ACCESS_TOKEN 后重新发布。"
    }
}

function Get-GiteeAccessToken {
    param([string]$CurrentValue)

    if (![string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue.Trim()
    }

    foreach ($name in @("AXTOOLS_GITEE_TOKEN", "FANTASYTOOLS_GITEE_TOKEN", "GITEE_TOKEN", "GITEE_ACCESS_TOKEN")) {
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
        [ValidateSet("Get", "Post", "Put", "Patch", "Delete")]
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
        Write-DevProgress -Stage "checkpoint-reset" -Percent 70 -Message "断点附件不匹配，正在重新上传 $($file.Name)"
        Invoke-GiteeApi -Method Delete -Path ("releases/{0}/attach_files/{1}" -f $ReleaseId, $existing[0].id) -Body @{} | Out-Null
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

<#
.SYNOPSIS
    发布前确认"清单里写出去的下载地址"真的能匿名下到、而且是这一次的包。

.DESCRIPTION
    地址是本地拼出来的（仓库名 + tag + 文件名），拼错了不会有任何报错：
    客户端"检测到新版本 → 下载 404"，玩家看到的是更新失败，比不推更新更糟。
    所以在清单提交之前先 HEAD 一次：连续跟随 302（gitee → foruda 带 token 的短链），
    要求最后一跳 200 且 Content-Length 等于本地安装包大小。
#>
function Assert-GiteeAssetDownloadable {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][int64]$ExpectedSize
    )

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($null -eq $curl) { throw "没有找到 curl.exe，无法校验启动器下载地址。" }

    $headers = & curl.exe -sSIL -m 60 --fail $Url 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "校验启动器下载地址失败（curl exit code $LASTEXITCODE）：$Url`n$($headers -join "`n")"
    }

    $codes = @($headers | Select-String -Pattern '^HTTP/\S+\s+(\d{3})' |
        ForEach-Object { [int]$_.Matches[0].Groups[1].Value })
    $finalCode = if ($codes.Count -gt 0) { $codes[$codes.Count - 1] } else { 0 }
    if ($finalCode -ne 200) {
        throw "启动器下载地址最后一跳返回 HTTP ${finalCode}：$Url"
    }

    $lengthLine = $headers | Select-String -Pattern '^Content-Length:\s*(\d+)' | Select-Object -Last 1
    if ($null -ne $lengthLine) {
        $length = [int64]$lengthLine.Matches[0].Groups[1].Value
        if ($length -ne $ExpectedSize) {
            throw "启动器下载地址大小不符：$Url 返回 $length 字节，期望 $ExpectedSize 字节。"
        }
    }

    Write-Host "  下载地址可用：HTTP 200，$ExpectedSize 字节" -ForegroundColor Green
}

<#
.SYNOPSIS
    把清单同步到站点静态目录（客户端实际读的就是这里）。

.DESCRIPTION
    为什么不用 Gitee raw 给客户端读：
      - Gitee raw 有 CDN 缓存，改完要等一段时间；
      - 仓库被判"RAW 外链滥用"后会整体 403（旧的 PC 发布仓库就是这么被关的）。
    所以客户端只读 www，Gitee 里的副本是发布源/追溯用。

    **两份清单必须一起换**：客户端先读扁平清单 `pc-installer-latest.json` 判断有没有新版，
    只有它拉不到时才去问 Tauri 清单 `pc-latest.json`。一次发布如果只换成功了其中一份
    （扁平清单还停在上一版），所有客户端都会一直以为"已是最新"，静默漏掉整个版本 ——
    不报错、不弹提示，从现场根本看不出来。

    所以这里按"一批"处理：先全部 scp 到 Windows\Temp → 一次 ssh 里校验全部内容 →
    全部通过才备份/覆盖 → 覆盖后再回读两份断言版本一致 → 最后统一修 ACL。
    任何一步不对都抛错（发布显示失败），而不是发出去一个"一半新一半旧"的站点。
#>
function Publish-WebsiteMirrorSet {
    param(
        [Parameter(Mandatory)][object[]]$Files
    )

    $plan = @()
    foreach ($file in $Files) {
        if (!(Test-Path -LiteralPath $file.LocalPath -PathType Leaf)) {
            throw "站点镜像源文件不存在：$($file.LocalPath)"
        }
        $plan += [pscustomobject]@{
            temp       = "C:\Windows\Temp\launcher-mirror-$([Guid]::NewGuid().ToString('N')).json"
            target     = Join-Path $WebsiteMirrorDirectory $file.RemoteFileName
            versionKey = [string]$file.ExpectedVersionProperty
            version    = [string]$file.ExpectedVersion
        }
    }

    for ($index = 0; $index -lt $plan.Count; $index += 1) {
        & scp $Files[$index].LocalPath "${ServerSshTarget}:$($plan[$index].temp)"
        if ($LASTEXITCODE -ne 0) {
            throw "上传站点镜像失败：$($Files[$index].RemoteFileName)，scp exit code $LASTEXITCODE"
        }
    }

    # 远端脚本用单引号 here-string：不做本地展开，$plan 通过 base64 注进去，
    # 免得 JSON 里的引号/中文/反引号在两层引号里互相打架。
    $remoteScriptTemplate = @'
$ErrorActionPreference = 'Stop'
$plan = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PLAN__')) | ConvertFrom-Json

function Read-ManifestVersion([string]$Path, [string]$Property) {
    $manifest = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    return [string]$manifest.$Property
}

try {
    # 1) 全部先校验：任何一份内容不对，一份都不覆盖
    foreach ($item in $plan) {
        $actual = Read-ManifestVersion -Path $item.temp -Property $item.versionKey
        if ($actual -ne [string]$item.version) {
            throw ("站点镜像内容不匹配：{0} 是 {1}，期望 {2}" -f $item.target, $actual, $item.version)
        }
    }

    # 2) 全部校验通过，才备份 + 覆盖
    foreach ($item in $plan) {
        $targetDir = Split-Path -Parent $item.target
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        if (Test-Path -LiteralPath $item.target -PathType Leaf) {
            Copy-Item -LiteralPath $item.target -Destination "$($item.target).bak" -Force
        }
        Move-Item -LiteralPath $item.temp -Destination $item.target -Force
    }

    # 3) 回读确认：覆盖之后两份都必须等于本次版本（防"看着移动成功、其实没写进去"）
    foreach ($item in $plan) {
        $actual = Read-ManifestVersion -Path $item.target -Property $item.versionKey
        if ($actual -ne [string]$item.version) {
            throw ("站点镜像覆盖后校验失败：{0} 是 {1}，期望 {2}" -f $item.target, $actual, $item.version)
        }
    }

    # 4) ACL：权限模板从本站根 index.html 抄，另外无条件补一次 IIS 匿名读权限
    $targetDirs = @($plan | ForEach-Object { Split-Path -Parent $_.target } | Select-Object -Unique)
    foreach ($targetDir in $targetDirs) {
        $items = @($plan | Where-Object { (Split-Path -Parent $_.target) -eq $targetDir })
        $aclFilled = $false
        foreach ($aclDir in @($targetDir, (Split-Path -Parent $targetDir))) {
            $aclSource = Join-Path $aclDir 'index.html'
            if (Test-Path -LiteralPath $aclSource -PathType Leaf) {
                foreach ($item in $items) {
                    Set-Acl -LiteralPath $item.target -AclObject (Get-Acl -LiteralPath $aclSource)
                }
                $aclFilled = $true
                break
            }
        }
        & icacls $targetDir /grant 'IIS_IUSRS:(OI)(CI)(RX)' 'IUSR:(OI)(CI)(RX)' | Out-Null
        if (-not $aclFilled) {
            foreach ($item in $items) {
                & icacls $item.target /grant 'IIS_IUSRS:(RX)' 'IUSR:(RX)' | Out-Null
            }
        }
    }

    foreach ($item in $plan) {
        Write-Output ("站点镜像已更新：{0}（{1}={2}）" -f $item.target, $item.versionKey, $item.version)
    }
}
catch {
    foreach ($item in $plan) {
        Remove-Item -LiteralPath $item.temp -Force -ErrorAction SilentlyContinue
    }
    throw
}
'@

    $planJson = ConvertTo-Json -InputObject @($plan) -Compress -Depth 4
    $planBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($planJson))
    $remoteScript = $remoteScriptTemplate.Replace('__PLAN__', $planBase64)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
    & ssh $ServerSshTarget "powershell -NoProfile -EncodedCommand $encoded"
    if ($LASTEXITCODE -ne 0) {
        throw "发布站点镜像失败，ssh exit code $LASTEXITCODE"
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
    Set-DevCancellationMode -Mode 'stop' -Message '正在构建发布包；停止后会保留已完成产物。'
    Write-DevProgress -Stage "build" -Percent 5 -Message "构建启动器"
    & $buildScript -ProjectRoot $ProjectRoot -OutputDir $ReleasePackageDir -IntermediateOutputDir $IntermediateOutputDir -GiteeRepository $GiteeRepository -ProgressStart 5 -ProgressEnd 55
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

# 扁平清单：客户端自己读、自己下载、自己校验的那一份。
# 下载地址先按"本次发布的标准 Gitee 资产地址"拼一个兜底值；真发布时以 Gitee
# 上传完回给的真实地址为准（见下面 `$installerAsset.browser_download_url`）。
$signatureText = (Get-Content -LiteralPath $signaturePath -Raw -Encoding UTF8).Trim()
$downloadUrl = "https://gitee.com/$GiteeRepository/releases/download/$tag/$([uri]::EscapeDataString((Split-Path -Leaf $installerPath)))"

Write-DevProgress -Stage "prepare" -Percent 60 -Message "准备 Gitee 发布"
if (!$DryRun) {
    Set-DevCancellationMode -Mode 'stop' -Message '正在续传发布附件；停止后可再次点击继续。'
    $release = Ensure-GiteeRelease -Tag $tag -Title $notes -Notes $notes
    $existingAssets = Get-GiteeReleaseAssets -ReleaseId ([int]$release.id)
    Write-DevProgress -Stage "upload" -Percent 75 -Message "上传安装包到 Gitee"
    Add-GiteeReleaseAsset -ReleaseId ([int]$release.id) -Path $installerPath -ExistingAssets $existingAssets
    $existingAssets = Get-GiteeReleaseAssets -ReleaseId ([int]$release.id)
    Add-GiteeReleaseAsset -ReleaseId ([int]$release.id) -Path $signaturePath -ExistingAssets $existingAssets

    # 地址不要靠拼：本地拼错、或者 Gitee 换了资产地址格式，都不会报错，
    # 只会让客户端"检测到更新 → 下载 404"。以它回给的真实地址为准。
    $uploadedAssets = Get-GiteeReleaseAssets -ReleaseId ([int]$release.id)
    $installerAsset = @($uploadedAssets | Where-Object { $_.name -eq (Split-Path -Leaf $installerPath) } | Select-Object -First 1)
    if ($null -ne $installerAsset -and ![string]::IsNullOrWhiteSpace([string]$installerAsset.browser_download_url)) {
        $resolvedDownloadUrl = [string]$installerAsset.browser_download_url
        if (![string]::Equals($resolvedDownloadUrl, $downloadUrl, [StringComparison]::Ordinal)) {
            Write-Host "Gitee 返回的资产地址与本地拼的不一致，改用 Gitee 的：" -ForegroundColor Yellow
            Write-Host "  本地：$downloadUrl" -ForegroundColor DarkGray
            Write-Host "  Gitee：$resolvedDownloadUrl" -ForegroundColor DarkGray
        }
        $downloadUrl = $resolvedDownloadUrl
    }
}

# 两份清单在这里统一生成：下载地址已经定下来（DryRun 用本地拼的那个兜底值）。
# 复用旧断点时，latest.json 里的地址可能还指着上一个仓库/上一套域名（本次就是仓库迁移）。
# 发布出去的清单必须指向"这次真正上传到的地址"，否则客户端会去下 404。
$currentDownloadUrl = [string]$manifest.platforms.'windows-x86_64'.url
if (![string]::Equals($currentDownloadUrl, $downloadUrl, [StringComparison]::Ordinal)) {
    Write-Host "清单下载地址与本次发布目标不一致，已改写：" -ForegroundColor Yellow
    Write-Host "  旧：$currentDownloadUrl" -ForegroundColor DarkGray
    Write-Host "  新：$downloadUrl" -ForegroundColor DarkGray
    $manifest.platforms.'windows-x86_64'.url = $downloadUrl
    $rewrittenPath = Join-Path $IntermediateOutputDir "latest.rewritten.json"
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $rewrittenPath -Encoding UTF8
    $latestManifestPath = $rewrittenPath
}

$installerManifest = New-LauncherInstallerManifest `
    -ProductKey $InstallerManifestProductKey `
    -VersionName ([string]$manifest.version) `
    -Notes ([string]$manifest.notes) `
    -InstallerPath $installerPath `
    -DownloadUrl $downloadUrl `
    -PublishedAt ([string]$manifest.pub_date) `
    -Signature $signatureText
$installerManifestPath = Join-Path $IntermediateOutputDir "pc-installer-latest.json"
$installerManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $installerManifestPath -Encoding UTF8

if ($DryRun) {
    Write-Host "DryRun：将发布 $installerPath、$signaturePath" -ForegroundColor Yellow
    Write-Host "DryRun：将写入 launcher/latest.json、launcher/pc-installer-latest.json 到 $GiteeRepository" -ForegroundColor Yellow
    Write-Host "DryRun：将同步站点镜像 $TauriManifestMirrorName / $InstallerManifestMirrorName 到 ${ServerSshTarget}:$WebsiteMirrorDirectory" -ForegroundColor Yellow
}
else {
    # 清单里要写出去的地址，在提交任何清单之前先真的下一次头。
    # 客户端那条链路是"检测到新版 → 立刻下载"，地址 404 就是全员更新失败。
    Write-DevProgress -Stage "verify-download" -Percent 90 -Message "校验安装包下载地址"
    Assert-GiteeAssetDownloadable -Url $downloadUrl -ExpectedSize ([int64](Get-Item -LiteralPath $installerPath).Length)

    Set-DevCancellationMode -Mode 'locked' -Message '附件已完成，正在提交版本清单，不可停止。'
    Write-DevProgress -Stage "manifest" -Percent 92 -Message "更新 Gitee 版本信息"
    Publish-GiteeRepositoryFile -LocalPath $latestManifestPath -RepositoryPath "launcher/latest.json" -CommitMessage "Update launcher to $($manifest.version)"
    Publish-GiteeRepositoryFile -LocalPath $installerManifestPath -RepositoryPath "launcher/pc-installer-latest.json" -CommitMessage "Update launcher installer manifest to $($manifest.version)"
    if (!$SkipWebsiteMirror) {
        Write-DevProgress -Stage "website-mirror" -Percent 95 -Message "同步站点更新清单"
        # 两份清单一次换完：只换成功一份会让所有客户端静默漏更（详见函数注释）。
        Publish-WebsiteMirrorSet -Files @(
            [pscustomobject]@{
                LocalPath               = $latestManifestPath
                RemoteFileName          = $TauriManifestMirrorName
                ExpectedVersionProperty = "version"
                ExpectedVersion         = [string]$manifest.version
            },
            [pscustomobject]@{
                LocalPath               = $installerManifestPath
                RemoteFileName          = $InstallerManifestMirrorName
                ExpectedVersionProperty = "versionName"
                ExpectedVersion         = [string]$manifest.version
            }
        )
    }
}

if ($WithOssCompat) {
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
        -DryRun:$DryRun `
        -ProgressStart 96 `
        -ProgressEnd 99
}
else {
    Write-Host "已跳过 OSS/服务器兼容发布：阿里云 OSS bucket download-server-xj 已删除，旧通道下不动。" -ForegroundColor DarkYellow
    Write-Host "确需回旧通道时再加 -WithOssCompat（会重新要求 ossutil 与服务器覆盖）。" -ForegroundColor DarkYellow
}

Write-DevProgress -Stage "completed" -Percent 100 -Message "Gitee 发布完成"
Write-Host "Gitee Release：https://gitee.com/$GiteeRepository/releases/tag/$tag"
Write-Host "Tauri 清单（Gitee）：https://gitee.com/$GiteeRepository/raw/$GiteeBranch/launcher/latest.json"
Write-Host "Tauri 清单（站点）：https://www.crossingvoid.top/manifests/launcher/$TauriManifestMirrorName"
Write-Host "扁平清单（Gitee）：https://gitee.com/$GiteeRepository/raw/$GiteeBranch/launcher/pc-installer-latest.json"
Write-Host "扁平清单（站点）：https://www.crossingvoid.top/manifests/launcher/$InstallerManifestMirrorName"
