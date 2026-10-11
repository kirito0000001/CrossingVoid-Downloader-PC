<#
.SYNOPSIS
    在服务器上安装/更新「玩家反馈中转」服务（计划任务 + IIS 反向代理规则）。

.DESCRIPTION
    照抄服务器上既有的做法（CrossingVoidLauncherDiagnostics 任务 + ReverseProxyToLauncherDiagnostics 规则）：
      1) 复制 IssueFeedbackServer.ps1 到 C:\Users\Administrator\Desktop\OSSAPI\IssueFeedback\
      2) 注册计划任务（SYSTEM / 开机启动 / 崩溃重启）
      3) 加 IIS URL Rewrite 规则 /api/issue-feedback/* -> http://127.0.0.1:51990/api/issue-feedback/{R:1}

    令牌**不由本脚本写入**：需要手工把 PAT 放进
    C:\ProgramData\CrossingVoidIssueFeedback\github-token.txt（只一行，无引号）。
    这样令牌永远不会出现在脚本、命令行历史或本仓库里。

.PARAMETER ServerScriptPath
    要部署的 IssueFeedbackServer.ps1 路径（默认取本脚本同目录下的同名文件）。

.PARAMETER SkipProxyRule
    只注册计划任务，不动 IIS 规则。

.EXAMPLE
    pwsh -NoProfile -File .\Scripts\Server\Install-IssueFeedbackServer.ps1
#>

[CmdletBinding()]
param(
    [string]$ServerScriptPath = (Join-Path $PSScriptRoot "IssueFeedbackServer.ps1"),
    [string]$TargetDirectory = "C:\Users\Administrator\Desktop\OSSAPI\IssueFeedback",
    [string]$TaskName = "CrossingVoidIssueFeedback",
    [string]$SiteName = "Default Web Site",
    [string]$RuleName = "ReverseProxyToIssueFeedback",
    [string]$ProxyPrefix = "api/issue-feedback",
    [string]$ProxyTarget = "http://127.0.0.1:51990/api/issue-feedback/{R:1}",
    [switch]$SkipProxyRule
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ServerScriptPath)) {
    throw "找不到要部署的服务脚本：$ServerScriptPath"
}

Write-Host ">>> 部署服务脚本到 $TargetDirectory" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
$target = Join-Path $TargetDirectory "IssueFeedbackServer.ps1"
# 就地运行时（脚本已经在目标目录里）不能复制到自己身上，否则 Copy-Item 直接报错。
$sourceFull = [IO.Path]::GetFullPath($ServerScriptPath)
$targetFull = [IO.Path]::GetFullPath($target)
if ($sourceFull -ne $targetFull) {
    Copy-Item -LiteralPath $ServerScriptPath -Destination $target -Force
    Write-Host "    -> $target"
} else {
    Write-Host "    源与目标相同，跳过复制：$target"
}

Write-Host ">>> 注册/更新计划任务 $TaskName" -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$target`""
# 触发时机跟服务器上其它服务保持一致：开机 + 每天凌晨 4 点（用户 2026-10-11 拍板）。
# 服务本身是常驻监听，这两条只是"开机拉起"和"每天兜底重启一次"，不是干活周期。
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Daily -At 4:00AM)
)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 72) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ">>> 重启任务以加载新脚本" -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "    任务状态：$state"

Write-Host ">>> 本机自测 /health" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:51990/health" -TimeoutSec 15
    Write-Host ("    " + ($health | ConvertTo-Json -Compress))
} catch {
    Write-Warning "健康检查失败：$($_.Exception.Message)"
    Write-Warning "如果是首次安装，先确认令牌文件存在：C:\ProgramData\CrossingVoidIssueFeedback\github-token.txt"
}

if (-not $SkipProxyRule) {
    Write-Host ">>> 配置 IIS 反向代理规则 $RuleName" -ForegroundColor Cyan
    Import-Module WebAdministration
    $rulesPath = "IIS:\Sites\$SiteName"

    # 用 XML 片段建规则：`Add-WebConfigurationProperty -Value @{...}` 对嵌套属性（match/action）
    # 不可靠——实测建出来的规则 name/action 都在，但 `match.url` 是空的，
    # 结果 IIS 匹配不到任何请求，公网返回 500（本机直连 51990 却是好的）。
    # 而 `Add-WebConfiguration -Value ([xml]...)` 会抛 FormatException，
    # 所以这里直接对**规则元素的属性**逐个赋值：先加 <rule>，再写 match/action。
    $existing = Get-WebConfiguration -PSPath $rulesPath -Filter "system.webServer/rewrite/rules/rule[@name='$RuleName']" -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "    规则已存在，先删除再重建"
        Remove-WebConfigurationProperty -PSPath $rulesPath -Filter "system.webServer/rewrite/rules" `
            -Name "." -AtElement @{ name = $RuleName } -ErrorAction SilentlyContinue
    }

    Add-WebConfigurationProperty -PSPath $rulesPath -Filter "system.webServer/rewrite/rules" -Name "." `
        -Value @{ name = $RuleName; stopProcessing = "true" }

    $ruleFilter = "system.webServer/rewrite/rules/rule[@name='$RuleName']"
    $pattern = "^$ProxyPrefix/(.*)"
    Set-WebConfigurationProperty -PSPath $rulesPath -Filter "$ruleFilter/match" -Name "url" -Value $pattern
    Set-WebConfigurationProperty -PSPath $rulesPath -Filter "$ruleFilter/action" -Name "type" -Value "Rewrite"
    Set-WebConfigurationProperty -PSPath $rulesPath -Filter "$ruleFilter/action" -Name "url" -Value $ProxyTarget
    Set-WebConfigurationProperty -PSPath $rulesPath -Filter "$ruleFilter/action" -Name "appendQueryString" -Value "true"

    # 回读校验：match.url 为空说明没配对，宁可这里报错也别等玩家发现 500。
    $created = Get-WebConfiguration -PSPath $rulesPath -Filter $ruleFilter
    if ([string]::IsNullOrWhiteSpace($created.match.url)) {
        throw "反向代理规则 $RuleName 的 match.url 为空，创建失败"
    }
    Write-Host ("    {0} -> {1}" -f $created.match.url, $created.action.url)
}

Write-Host ""
Write-Host "完成。公网自测：" -ForegroundColor Green
Write-Host "  curl.exe -sS https://www.crossingvoid.top/api/issue-feedback/health"
Write-Host ""
Write-Host "注意：令牌文件不在本脚本职责内，需手工放置：" -ForegroundColor Yellow
Write-Host "  C:\ProgramData\CrossingVoidIssueFeedback\github-token.txt"
