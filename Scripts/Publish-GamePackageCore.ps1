param(
    [Parameter(Mandatory = $true)][ValidateSet("Windows", "Android")][string]$Platform,
    [Parameter(Mandatory = $true)][ValidateSet("Stable", "Test")][string]$Channel,
    [Parameter(Mandatory = $true)][string]$GameDirectory,
    [Parameter(Mandatory = $true)][string]$PackageOutputRoot,
    [Parameter(Mandatory = $true)][string]$ReleaseVersion,
    [Parameter(Mandatory = $true)][string]$ReleaseTitle,
    [string]$Bucket = "download-server-xj",
    [string]$Endpoint = "https://oss-cn-chengdu.aliyuncs.com",
    [string]$Region = "cn-chengdu",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($null -ne (Get-Variable -Name PSStyle -ErrorAction SilentlyContinue)) { $PSStyle.OutputRendering = "PlainText" }

function Write-DevProgress { param([string]$Stage,[double]$Percent,[string]$Message) [Console]::Out.WriteLine("::progress" + ([ordered]@{ stage=$Stage; percent=$Percent; message=$Message } | ConvertTo-Json -Compress)) }
function Get-OssutilCommand {
    foreach ($candidate in @("C:\Users\liuyu\Tools\ossutil\ossutil.exe", "ossutil.exe", "ossutil")) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($null -ne $command) { return $command.Source }
    }
    throw "没有找到 ossutil。请先安装并配置阿里云 ossutil。"
}
function Get-GameProductKey {
    if ($Platform -eq "Android") { return $(if ($Channel -eq "Test") { "crossingvoid-android-game-test" } else { "crossingvoid-android-game" }) }
    return $(if ($Channel -eq "Test") { "crossingvoid-game-test" } else { "crossingvoid-game" })
}
function Remove-PreviousChannelObjects {
    param([string]$OssutilPath,[string[]]$PreviousObjectKeys,[string[]]$CurrentObjectKeys)
    foreach ($objectKey in @($PreviousObjectKeys | Select-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($objectKey) -or $CurrentObjectKeys -contains $objectKey) { continue }
        if ($DryRun) { Write-Host "DryRun：跳过旧对象清理：$objectKey"; continue }
        & $OssutilPath rm "oss://$Bucket/$objectKey" -e $Endpoint --region $Region -f
        if ($LASTEXITCODE -ne 0) { throw "同频道旧对象删除失败：$objectKey" }
    }
}

if (!(Test-Path -LiteralPath $GameDirectory -PathType Container)) { throw "游戏打包目录不存在：$GameDirectory" }
if ($ReleaseVersion -notmatch '^V?\d+\.\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?$') { throw "游戏版本号格式不正确。" }
$version = if ($ReleaseVersion.StartsWith("V")) { $ReleaseVersion } else { "V$ReleaseVersion" }
$safeVersion = $version -replace '[^A-Za-z0-9.-]', '_'
$releaseRoot = Join-Path ([IO.Path]::GetFullPath($PackageOutputRoot)) "$Platform-$Channel-$safeVersion"
if (Test-Path -LiteralPath $releaseRoot) { Remove-Item -LiteralPath $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$staging = Join-Path $releaseRoot "staging"
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-DevProgress -Stage "inspect" -Percent 5 -Message "检查 $Platform 游戏包"
$files = if ($Platform -eq "Android") {
    $apkFiles = @(Get-ChildItem -LiteralPath $GameDirectory -Recurse -File -Force | Where-Object { $_.Extension -ieq ".apk" })
    $obbFiles = @(Get-ChildItem -LiteralPath $GameDirectory -Recurse -File -Force | Where-Object { $_.Extension -ieq ".obb" })
    if ($apkFiles.Count -ne 1 -or $obbFiles.Count -ne 1) {
        throw "Android 打包目录必须只包含一个 APK 和一个 OBB。当前找到 APK：$($apkFiles.Count)，OBB：$($obbFiles.Count)。"
    }
    @($apkFiles[0], $obbFiles[0])
} else {
    @(Get-ChildItem -LiteralPath $GameDirectory -Recurse -File -Force | Where-Object { $_.Extension -ine ".pdb" -and $_.Name -ine "Manifest_DebugFiles_Win64.txt" })
}
if ($files.Count -eq 0) { throw "游戏打包目录没有可发布文件。" }
foreach ($file in $files) {
    $relative = if ($Platform -eq "Android") { $file.Name } else { [IO.Path]::GetRelativePath($GameDirectory, $file.FullName) }
    $target = Join-Path $staging $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
}
$manifestFiles = @(Get-ChildItem -LiteralPath $staging -Recurse -File -Force | Sort-Object FullName | ForEach-Object { [ordered]@{ path=[IO.Path]::GetRelativePath($staging,$_.FullName).Replace("\","/"); sizeBytes=$_.Length; sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
[ordered]@{ schemaVersion=1; productKey=(Get-GameProductKey); runtime=$Platform; version=$version; files=$manifestFiles } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $staging "CrossingVoid.manifest.json") -Encoding UTF8

Write-DevProgress -Stage "archive" -Percent 35 -Message "压缩游戏资源"
$archiveName = if ($Platform -eq "Android") { "CrossingVoid-Android-Package.zip" } else { "CrossingVoid.zip" }
$archivePath = Join-Path $releaseRoot $archiveName
Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archivePath -CompressionLevel Optimal
$archive = Get-Item -LiteralPath $archivePath
$chunkSizeBytes = [int64](500MB)
$chunkBaseName = if ($Platform -eq "Android") { "CrossingVoid手机端.碎片" } else { "CrossingVoid电脑端.碎片" }
$chunks = @(); $chunkCount = [Math]::Ceiling($archive.Length / [double]$chunkSizeBytes)
$stream = [IO.File]::OpenRead($archivePath)
try {
  for($chunkIndex=1;$chunkIndex -le $chunkCount;$chunkIndex++) {
    $name = "$chunkBaseName$($chunkIndex.ToString('D3'))"; $path=Join-Path $releaseRoot $name; $remaining=[Math]::Min($chunkSizeBytes,$stream.Length-$stream.Position); $output=[IO.File]::Create($path); $buffer=New-Object byte[] 8388608
    try { while($remaining -gt 0){ $read=$stream.Read($buffer,0,[Math]::Min($buffer.Length,$remaining)); if($read -le 0){throw "分片读取失败"}; $output.Write($buffer,0,$read); $remaining-=$read } } finally { $output.Dispose() }
    $part=Get-Item $path; $chunks += [ordered]@{ index=$chunkIndex; count=$chunkCount; fileName=$name; githubFileName=$name; objectKey="Akege304/CrossingVoid/channels/$($Channel.ToLower())/$Platform/releases/$safeVersion/$name"; sha256=(Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant(); sizeBytes=$part.Length }
    Write-DevProgress -Stage "split" -Percent (35 + 35 * $chunkIndex / $chunkCount) -Message "生成分片 $chunkIndex / $chunkCount"
  }
} finally { $stream.Dispose() }
$asset=[ordered]@{ runtime=$Platform; fileName=$archiveName; sha256=(Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant(); sizeBytes=$archive.Length; chunks=$chunks }
$releaseTag="$Platform-$version"
$update=[ordered]@{ schemaVersion=2; productKey=(Get-GameProductKey); downloadReleaseTag=$releaseTag; latest=[ordered]@{ version=$version; title=$ReleaseTitle; channel=$Channel.ToLower(); publishedAt=[DateTimeOffset]::UtcNow.ToString('o'); assets=@($asset) } }
$updatePath=Join-Path $releaseRoot $(if($Platform -eq "Android"){"crossingvoid-android-update.json"}else{"CrossingVoid-PC-update.json"})
$update | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $updatePath -Encoding UTF8

Write-DevProgress -Stage "upload" -Percent 75 -Message "上传游戏分片"
if (!$DryRun) {
  $ossutil=Get-OssutilCommand; $assetIndex=0; $ChunkCount=$chunks.Count; $repository="kirito0000001/CrossingVoid"
  & gh release view $releaseTag --repo $repository *> $null
  if($LASTEXITCODE -ne 0){ & gh release create $releaseTag --repo $repository --title "$Platform $version" --notes "$ReleaseTitle"; if($LASTEXITCODE -ne 0){throw "GitHub Release 创建失败"} }
  foreach($chunk in $chunks){ $assetIndex++; $chunkPath=Join-Path $releaseRoot $chunk.fileName; Write-Host "正在上传到 GitHub：第 $assetIndex / $ChunkCount 片"; & gh release upload $releaseTag $chunkPath --repo $repository --clobber; if($LASTEXITCODE -ne 0){throw "GitHub 上传失败：$($chunk.fileName)"}; Write-Host "正在上传到阿里云 OSS：第 $assetIndex / $($chunks.Count) 片"; & $ossutil cp $chunkPath "oss://$Bucket/$($chunk.objectKey)" -e $Endpoint --region $Region -f; if($LASTEXITCODE -ne 0){throw "OSS 上传失败：$($chunk.fileName)"} }
  & gh release upload $releaseTag $updatePath --repo $repository --clobber
  if($LASTEXITCODE -ne 0){throw "GitHub 清单上传失败"}
  & $ossutil cp $updatePath "oss://$Bucket/Akege304/CrossingVoid/channels/$($Channel.ToLower())/$Platform/latest/update.json" -e $Endpoint --region $Region -f
  if($LASTEXITCODE -ne 0){throw "OSS 清单上传失败"}
} else { Write-Host "DryRun：跳过本机后端清单同步" }
Write-DevProgress -Stage "completed" -Percent 100 -Message "游戏包发布完成"
