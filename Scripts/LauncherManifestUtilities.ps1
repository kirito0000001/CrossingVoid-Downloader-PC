function Convert-ToRfc3339Timestamp {
    param([AllowNull()][object]$Value)

    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $utc = if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        [DateTimeOffset]::UtcNow
    } elseif ($Value -is [DateTimeOffset]) {
        ([DateTimeOffset]$Value).ToUniversalTime()
    } elseif ($Value -is [DateTime]) {
        $dateTime = [DateTime]$Value
        if ($dateTime.Kind -eq [DateTimeKind]::Unspecified) {
            $dateTime = [DateTime]::SpecifyKind($dateTime, [DateTimeKind]::Utc)
        }
        [DateTimeOffset]::new($dateTime.ToUniversalTime())
    } else {
        $parsed = [DateTimeOffset]::MinValue
        $styles = [System.Globalization.DateTimeStyles]::AllowWhiteSpaces -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
        if (![DateTimeOffset]::TryParse([string]$Value, $culture, $styles, [ref]$parsed)) {
            throw "无法将发布时间转换为 RFC 3339：$Value"
        }
        $parsed.ToUniversalTime()
    }

    return $utc.ToString("yyyy-MM-ddTHH:mm:ss.fffffff'Z'", $culture)
}

<#
.SYNOPSIS
    生成扁平启动器安装包清单（与零境 Android 启动器同款 schemaVersion=1）。

.DESCRIPTION
    PC 端原来只有 Tauri 的 `latest.json`（靠 minisign 签名 + 编译期写死的端点）。
    扁平清单的目的：
      1. 客户端可以自己读清单、比对版本、下载、校验 sha256 —— 换仓库/换地址不用发版；
      2. 和 Android 启动器同构，发布脚本/运维口径一致；
      3. AxTools 发布后的公网核验比读死接口更直白。

    字段与 Android 的 `android-installer-latest.json` 保持一致，只把
    `versionCode` 固定成 1（PC 端没有 Android 那套 versionCode 语义）。
#>
function New-LauncherInstallerManifest {
    param(
        [Parameter(Mandatory)][string]$ProductKey,
        [Parameter(Mandatory)][string]$VersionName,
        [int]$VersionCode = 1,
        [string]$Notes = '',
        [Parameter(Mandatory)][string]$InstallerPath,
        [Parameter(Mandatory)][string]$DownloadUrl,
        [string]$PublishedAt = '',
        [string]$Signature = ''
    )

    if ($VersionName -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
        throw "启动器版本必须使用三段数字（可带预发布后缀，例如 1.5.0 或 1.5.0-Beta）：$VersionName"
    }
    if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw "启动器安装包不存在：$InstallerPath"
    }
    if ([string]::IsNullOrWhiteSpace($DownloadUrl)) {
        throw '启动器安装包下载地址不能为空。'
    }

    $installer = Get-Item -LiteralPath $InstallerPath
    $asset = [ordered]@{
        fileName  = $installer.Name
        url       = $DownloadUrl
        sizeBytes = [int64]$installer.Length
        sha256    = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if (![string]::IsNullOrWhiteSpace($Signature)) {
        $asset.signature = $Signature.Trim()
    }

    # 注意：`ConvertFrom-Json` 会把 `pub_date` 变成 DateTime，直接 [string] 会掉进本地化格式
    # （"10/12/2026 03:25:02"）。统一走 RFC 3339，和 Tauri 清单同一口径。
    $published = Convert-ToRfc3339Timestamp $(if ([string]::IsNullOrWhiteSpace($PublishedAt)) {
        [DateTimeOffset]::UtcNow
    } else {
        $PublishedAt
    })

    return [ordered]@{
        schemaVersion = 1
        productKey    = $ProductKey
        versionName   = $VersionName
        versionCode   = [int]$VersionCode
        notes         = $Notes
        publishedAt   = $published
        asset         = $asset
    }
}
