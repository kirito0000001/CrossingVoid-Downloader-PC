param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $true)]
    [ValidateSet("Windows", "Android")]
    [string]$Platform,

    [Parameter(Mandatory = $true)]
    [ValidateSet("Stable", "Test")]
    [string]$Channel,

    [Parameter(Mandatory = $true)]
    [string]$GameDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseVersion,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseTitle,

    [string]$PackageOutputRoot = ""
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($null -ne (Get-Variable -Name PSStyle -ErrorAction SilentlyContinue)) {
    $PSStyle.OutputRendering = "PlainText"
}

$publishScript = Join-Path $PSScriptRoot "Publish-GamePackageCore.ps1"
if (!(Test-Path -LiteralPath $publishScript -PathType Leaf)) {
    throw "没有找到游戏发布脚本：$publishScript"
}
if (!(Test-Path -LiteralPath $GameDirectory -PathType Container)) {
    throw "游戏打包目录不存在：$GameDirectory"
}
if ([string]::IsNullOrWhiteSpace($PackageOutputRoot)) {
    $PackageOutputRoot = Join-Path $ProjectRoot "Saved\GamePackages"
}

$startPayload = [ordered]@{
    stage   = "inspect"
    percent = 1
    message = "$(if ($Channel -eq 'Test') { '测试服 · ' })$(if ($Platform -eq 'Windows') { '正在准备 PC 游戏发布' } else { '正在准备 Android 游戏发布' })"
}
[Console]::Out.WriteLine("::progress" + ($startPayload | ConvertTo-Json -Compress))

& $publishScript `
    -Platform $Platform `
    -Channel $Channel `
    -GameDirectory $GameDirectory `
    -PackageOutputRoot $PackageOutputRoot `
    -ReleaseVersion $ReleaseVersion `
    -ReleaseTitle $ReleaseTitle

if ($LASTEXITCODE -ne 0) {
    throw "游戏包上传失败，exit code $LASTEXITCODE"
}

$metadataPublisher = Join-Path $PSScriptRoot "Publish-GameMetadataGitee.ps1"
if (!(Test-Path -LiteralPath $metadataPublisher -PathType Leaf)) {
    throw "没有找到 Gitee 游戏清单同步脚本：$metadataPublisher"
}

$metadataPayload = [ordered]@{
    stage = "gitee-manifest"
    percent = 96
    message = "同步 Gitee 游戏版本信息"
}
[Console]::Out.WriteLine("::progress" + ($metadataPayload | ConvertTo-Json -Compress))
& $metadataPublisher -Platform $Platform -Channel $Channel -ReleaseVersion $ReleaseVersion
if ($LASTEXITCODE -ne 0) {
    throw "Gitee 游戏清单同步失败，exit code $LASTEXITCODE"
}
