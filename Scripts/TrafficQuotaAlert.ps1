# ⚠️⚠️ 部署时必须以「UTF-8 带 BOM」落盘！
#
# 仓库里这份是无 BOM 的 UTF-8（跟随本仓库约定），但**服务器上实际跑的那份是带 BOM 的**。
# Windows PowerShell 5.1 读无 BOM 的 UTF-8 文件会按 GBK 解码，中文全部变乱码、脚本直接
# 语法报错（2026-10-18 实测：直接 scp 覆盖之后，计划任务 CrossingVoid 每 5 分钟失败一次）。
#
# 两种安全的部署方式：
#   1. 在服务器上原位改内容，别整文件覆盖；
#   2. 真要覆盖，用 [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($true)) 写回。
param(
    [string]$ConfigPath = 'C:\UEWatchdog\watchdog.config.psd1',
    [string]$StatePath = 'C:\UEWatchdog\traffic-quota-alert-state.json',
    [string]$LogPath = 'C:\UEWatchdog\logs\traffic-quota-alert.log',
    # 2026-10-18 起改指向官网静态文件：老地址 /api/toolbox-updates/traffic-status 统计的是
    # 阿里云 OSS 流量包，而 OSS 已经解除，那个数字不再代表真实额度。现在这份由香港下载机
    # 自己统计出口流量、经计划任务 CrossingVoid-TrafficStatusSync 同步到官网。
    [string]$TrafficStatusUrl = 'https://www.crossingvoid.top/traffic-status.json'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-TrafficAlertLog {
    param([string]$Message, [string]$Level = 'INFO')

    $directory = Split-Path -Parent $LogPath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value ('{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message)
}

function Format-ByteSize {
    param([double]$Bytes)

    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N2} KB' -f ($Bytes / 1KB)) }
    return ('{0:N0} B' -f $Bytes)
}

function Read-TrafficAlertState {
    if (!(Test-Path -LiteralPath $StatePath)) {
        return [pscustomobject]@{ IsLow = $false }
    }

    try {
        return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Write-TrafficAlertLog -Level 'WARN' -Message "State file is invalid and will be reset: $($_.Exception.Message)"
        return [pscustomobject]@{ IsLow = $false }
    }
}

function Write-TrafficAlertState {
    param([bool]$IsLow, [object]$Quota)

    $directory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = "$StatePath.tmp"
    [ordered]@{
        isLow = $IsLow
        checkedAt = (Get-Date).ToString('o')
        remainingBytes = [double]$Quota.remainingBytes
        thresholdBytes = [double]$Quota.thresholdBytes
        expiresAt = $Quota.expiresAt
    } | ConvertTo-Json | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
}

function Send-TrafficAlertMail {
    param(
        [hashtable]$Config,
        [string]$Subject,
        [string]$Body
    )

    $mail = $Config.Mail
    if ($null -eq $mail -or -not [bool]$mail.Enabled) {
        Write-TrafficAlertLog -Level 'WARN' -Message 'Watchdog mail is disabled; traffic alert mail was skipped.'
        return $false
    }

    $message = $null
    $client = $null
    try {
        $credentialPath = [string]$mail.CredentialPath
        if (!(Test-Path -LiteralPath $credentialPath)) {
            throw "SMTP credential file not found: $credentialPath"
        }

        if ($credentialPath.EndsWith('.json', [System.StringComparison]::OrdinalIgnoreCase)) {
            $storedCredential = Get-Content -LiteralPath $credentialPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $networkCredential = [System.Net.NetworkCredential]::new($storedCredential.UserName, $storedCredential.Password)
        }
        else {
            $credential = Import-Clixml -LiteralPath $credentialPath
            $networkCredential = $credential.GetNetworkCredential()
        }

        $message = [System.Net.Mail.MailMessage]::new()
        $message.From = [string]$mail.From
        $message.To.Add([string]$mail.To)
        $message.Subject = $Subject
        $message.Body = $Body
        $message.SubjectEncoding = [System.Text.Encoding]::UTF8
        $message.BodyEncoding = [System.Text.Encoding]::UTF8

        $client = [System.Net.Mail.SmtpClient]::new([string]$mail.SmtpServer, [int]$mail.Port)
        $client.EnableSsl = [bool]$mail.EnableSsl
        $client.Credentials = $networkCredential
        $client.Send($message)
        Write-TrafficAlertLog -Message "Mail sent: $Subject"
        return $true
    }
    catch {
        Write-TrafficAlertLog -Level 'ERROR' -Message "Mail failed: $($_.Exception.Message)"
        return $false
    }
    finally {
        if ($null -ne $message) { $message.Dispose() }
        if ($null -ne $client) { $client.Dispose() }
    }
}

try {
    if (!(Test-Path -LiteralPath $ConfigPath)) {
        throw "Watchdog config not found: $ConfigPath"
    }

    $config = Import-PowerShellDataFile -LiteralPath $ConfigPath
    $quota = Invoke-RestMethod -Uri $TrafficStatusUrl -TimeoutSec 15
    if (-not [bool]$quota.success -or -not [bool]$quota.available) {
        throw "Traffic quota endpoint is unavailable: $($quota.message)"
    }

    $isLow = [bool]$quota.isLow -or -not [bool]$quota.downloadAllowed
    $state = Read-TrafficAlertState
    $wasLow = [bool]$state.IsLow
    $remaining = Format-ByteSize ([double]$quota.remainingBytes)
    $threshold = Format-ByteSize ([double]$quota.thresholdBytes)
    $total = Format-ByteSize ([double]$quota.totalBytes)
    $expiry = if ([string]::IsNullOrWhiteSpace([string]$quota.expiresAt)) { '未知' } else { [string]$quota.expiresAt }

    $mailSent = $true
    if ($isLow -and -not $wasLow) {
        $subject = '[CrossingVoid] 服务器下载流量不足'
        $body = @"
服务器当前下载流量已低于阈值，零境交错源已暂停。

剩余流量: $remaining / $total
告警阈值: $threshold
最近到期: $expiry
检测时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
服务器: $env:COMPUTERNAME

请购买流量包或等待额度恢复，并在需要时切换启动器下载源。
"@
        $mailSent = Send-TrafficAlertMail -Config $config -Subject $subject -Body $body
        Write-TrafficAlertLog -Level 'WARN' -Message "Traffic entered low state: $remaining remaining, threshold $threshold."
    }
    elseif (-not $isLow -and $wasLow) {
        $subject = '[CrossingVoid] 服务器下载流量已恢复'
        $body = @"
服务器下载流量已恢复到安全阈值以上，零境交错源可以继续使用。

剩余流量: $remaining / $total
告警阈值: $threshold
最近到期: $expiry
检测时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
服务器: $env:COMPUTERNAME
"@
        $mailSent = Send-TrafficAlertMail -Config $config -Subject $subject -Body $body
        Write-TrafficAlertLog -Message "Traffic recovered: $remaining remaining, threshold $threshold."
    }

    if ($mailSent) {
        Write-TrafficAlertState -IsLow $isLow -Quota $quota
    }
    else {
        Write-TrafficAlertLog -Level 'WARN' -Message 'State was not changed because the alert mail failed; the next run will retry.'
    }
}
catch {
    Write-TrafficAlertLog -Level 'ERROR' -Message "Traffic quota check failed: $($_.Exception.Message)"
    exit 1
}
