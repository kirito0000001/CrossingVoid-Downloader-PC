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

$unrealRoot = Join-Path (Split-Path -Parent $ProjectRoot) "CrossingVoid"
$publishScript = Join-Path $unrealRoot "Scripts\上传三端游戏到阿里云OSS.ps1"
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
