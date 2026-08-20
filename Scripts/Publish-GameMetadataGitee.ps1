param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Windows", "Android")]
    [string]$Platform,

    [Parameter(Mandatory = $true)]
    [ValidateSet("Stable", "Test")]
    [string]$Channel,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseVersion,

    [string]$GiteeAccessToken = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$normalizedReleaseVersion = if ($ReleaseVersion.StartsWith("V")) { $ReleaseVersion } else { "V$ReleaseVersion" }

function Get-GiteeToken {
    if (![string]::IsNullOrWhiteSpace($GiteeAccessToken)) { return $GiteeAccessToken.Trim() }
    foreach ($name in @("FANTASYTOOLS_GITEE_TOKEN", "GITEE_TOKEN", "GITEE_ACCESS_TOKEN")) {
        foreach ($scope in @("Process", "User", "Machine")) {
            $value = [Environment]::GetEnvironmentVariable($name, $scope)
            if (![string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
        }
    }
    throw "未找到 Gitee 访问令牌。"
}

function Invoke-GiteeApi {
    param(
        [ValidateSet("Get", "Post", "Put")]
        [string]$Method,
        [string]$Repository,
        [string]$Path,
        [hashtable]$Body = @{}
    )

    $uri = "https://gitee.com/api/v5/repos/$Repository/$Path"
    $payload = @{} + $Body
    $payload.access_token = $script:GiteeToken
    if ($Method -eq "Get") {
        $query = @($payload.GetEnumerator() | ForEach-Object {
            "{0}={1}" -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value)
        }) -join "&"
        return Invoke-RestMethod -Method Get -Uri "$uri`?$query"
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -ContentType "application/x-www-form-urlencoded; charset=utf-8" -Body $payload
}

function Get-GitHubManifest {
    param([string]$Tag, [string[]]$AssetNames)

    $headers = @{ "User-Agent" = "CrossingVoidLauncherPublisher"; "Accept" = "application/vnd.github+json" }
    $tagPath = [uri]::EscapeDataString($Tag)
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/kirito0000001/CrossingVoid/releases/tags/$tagPath"
    $asset = @($release.assets | Where-Object { $AssetNames -contains $_.name } | Select-Object -First 1)
    if ($asset.Count -ne 1) {
        throw "GitHub Release $Tag 缺少游戏更新清单：$($AssetNames -join ' / ')"
    }

    $downloadHeaders = @{ "User-Agent" = "CrossingVoidLauncherPublisher"; "Accept" = "application/octet-stream" }
    return Invoke-RestMethod -Headers $downloadHeaders -Uri $asset[0].url
}

function Publish-GiteeManifest {
    param([string]$Repository, [string]$RepositoryPath, [object]$Manifest)

    $escapedPath = ($RepositoryPath -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
    $current = $null
    try {
        $current = Invoke-GiteeApi -Method Get -Repository $Repository -Path "contents/$escapedPath" -Body @{ ref = "master" }
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }

    $json = $Manifest | ConvertTo-Json -Depth 16
    $body = @{
        branch = "master"
        message = "Update $Platform game metadata to $ReleaseVersion"
        content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    }
    if ($null -ne $current -and ![string]::IsNullOrWhiteSpace([string]$current.sha)) {
        $body.sha = [string]$current.sha
        Invoke-GiteeApi -Method Put -Repository $Repository -Path "contents/$escapedPath" -Body $body | Out-Null
    } else {
        Invoke-GiteeApi -Method Post -Repository $Repository -Path "contents/$escapedPath" -Body $body | Out-Null
    }
}

$target = if ($Platform -eq "Windows") {
    [ordered]@{
        Repository = "xiaojie578/CrossingVoid-Downloader-PC"
        RepositoryPath = "game/windows-latest.json"
        ReleaseTag = "PC-$normalizedReleaseVersion"
        AssetNames = @("CrossingVoid-PC-update.json", "update.json")
        ProductKey = "crossingvoid-game"
        Runtime = "Windows"
    }
} else {
    [ordered]@{
        Repository = "xiaojie578/CrossingVoid-Downloader-Android"
        RepositoryPath = "game/android-latest.json"
        ReleaseTag = "Android-$normalizedReleaseVersion"
        AssetNames = @("crossingvoid-android-update.json", "CrossingVoid-Android-update.json")
        ProductKey = "crossingvoid-android-game"
        Runtime = "Android"
    }
}

$manifest = Get-GitHubManifest -Tag $target.ReleaseTag -AssetNames $target.AssetNames
if ($manifest.schemaVersion -ne 2) { throw "GitHub 游戏清单必须使用 schemaVersion 2。" }
if ($manifest.productKey -ne $target.ProductKey) { throw "GitHub 游戏清单产品标识不匹配。" }
if ($manifest.downloadReleaseTag -ne $target.ReleaseTag) { throw "GitHub 游戏清单下载标签不匹配。" }
$latestAsset = @($manifest.latest.assets | Where-Object { $_.runtime -eq $target.Runtime } | Select-Object -First 1)
if ($latestAsset.Count -ne 1) { throw "GitHub 游戏清单缺少 $($target.Runtime) 资源。" }

if ($DryRun) {
    Write-Host "DryRun：将发布 $($target.ReleaseTag) 到 $($target.Repository)/$($target.RepositoryPath)" -ForegroundColor Yellow
    return
}

$script:GiteeToken = Get-GiteeToken
Publish-GiteeManifest -Repository $target.Repository -RepositoryPath $target.RepositoryPath -Manifest $manifest
Write-Output "Gitee 游戏清单：https://gitee.com/$($target.Repository)/raw/master/$($target.RepositoryPath)"
