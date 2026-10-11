<#
.SYNOPSIS
    零境启动器玩家反馈的服务器中转服务（IIS 反代到本机 127.0.0.1:51990）。

.DESCRIPTION
    玩家侧不持有任何 GitHub 令牌：启动器把"已经校验过的"建单内容发到这里，
    由本服务用服务器上的 fine-grained PAT 去 GitHub 建 issue。

    为什么要有这一层（Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md §2）：
    - GitHub 不接受匿名建 issue，令牌又绝不能放进玩家机器；
    - 未认证读取按**出口 IP** 限 60 次/小时，一群玩家共用出口会互相抢额度；
    - 服务器持令牌是 5000 次/小时，且能缓存列表。

    架构沿用仓库里既有的做法（见 LauncherDiagnostics / MinecraftPerformanceReceiver）：
    一条功能 = 一个本机监听端口 + 一条 IIS URL Rewrite 反向代理规则。
    本服务对应端口 51990，暴露前缀 /api/issue-feedback/*。

.NOTES
    部署：
      1) 把本文件放到 C:\Users\Administrator\Desktop\OSSAPI\IssueFeedback\
      2) 把令牌写入 C:\ProgramData\CrossingVoidIssueFeedback\github-token.txt（只写一行）
      3) 注册计划任务（开机启动、SYSTEM、崩溃自动重启）——见 Install-IssueFeedbackServer.ps1
      4) IIS 加反向代理规则 /api/issue-feedback/* -> http://127.0.0.1:51990/api/issue-feedback/{R:1}
    改动本文件后需要重启计划任务才会生效。
#>

$ErrorActionPreference = "Stop"

# ── 配置 ────────────────────────────────────────────────
$listenPrefix = "http://127.0.0.1:51990/"
$storageRoot = "C:\ProgramData\CrossingVoidIssueFeedback"
$tokenPath = Join-Path $storageRoot "github-token.txt"
$serviceLog = Join-Path $storageRoot "service.log"
$attemptLog = Join-Path $storageRoot "attempts.jsonl"

$githubRepository = "kirito0000001/CrossingVoid"
$githubApiRoot = "https://api.github.com"

# 反馈接口只收启动器提交的，别的产品键一律拒绝（与 diagnostics 服务同一套约定）。
$allowedProductKey = "crossingvoid-launcher-pc"

$maxPayloadBytes = 256KB
$maxTitleChars = 120          # 启动器已按 4-80 校正过，这里只做上限防滥用
$maxBodyChars = 8000
$maxCommentChars = 2000

# 只允许这几个标签，防止调用方用它往仓库里塞任意标签（GitHub 会自动创建不存在的标签）。
$allowedLabels = @("bug", "enhancement", "优化", "question", "来源:启动器", "待确认")

# 建单限频：每个 IP 每 10 分钟最多 5 条；同一内容 10 分钟内只建一次（防连点/脚本重放）。
$submitWindowMinutes = 10
$submitLimitPerWindow = 5
$submitRateLimit = @{}
$recentFingerprints = @{}

# 读取类接口宽松一些：每个 IP 每分钟 60 次。
$readWindowMinutes = 1
$readLimitPerWindow = 60
$readRateLimit = @{}

# ── 准备工作目录 ────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null

function Write-ServiceLog([string]$message) {
    try { Add-Content -LiteralPath $serviceLog -Value "$(Get-Date -Format o) $message" -Encoding utf8 } catch { }
}

function Get-GithubToken {
    if (-not (Test-Path -LiteralPath $tokenPath)) { return $null }
    $value = (Get-Content -LiteralPath $tokenPath -Raw -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return $value.Trim()
}

$script:GithubToken = Get-GithubToken
if (-not $script:GithubToken) {
    Write-ServiceLog "启动失败：缺少令牌文件 $tokenPath"
    throw "缺少 GitHub 令牌：$tokenPath"
}
Write-ServiceLog "starting issue-feedback listener（令牌已加载，长度 $($script:GithubToken.Length)）"

# 清理 30 天前的尝试日志
Get-ChildItem -Path $storageRoot -Filter "attempts-*.jsonl" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-30) } |
    Remove-Item -Force

# ── 响应助手（与 LauncherDiagnostics 保持一致） ─────────
function Write-Response([System.Net.HttpListenerResponse]$response, [int]$statusCode, [object]$payload) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress -Depth 8))
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
}

function Read-Text([object]$value, [int]$maxLength) {
    if ($null -eq $value) { return "" }
    $text = [string]$value
    if ($text.Length -le $maxLength) { return $text }
    return $text.Substring(0, $maxLength)
}

function Read-RequestBytes([System.Net.HttpListenerRequest]$request, [int64]$maximumBytes) {
    $output = [IO.MemoryStream]::new()
    $buffer = [byte[]]::new(64KB)
    try {
        while (($count = $request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($output.Length + $count -gt $maximumBytes) { throw [IO.InvalidDataException]::new("Payload too large") }
            $output.Write($buffer, 0, $count)
        }
        return $output.ToArray()
    } finally { $output.Dispose() }
}

function Test-RateLimit([hashtable]$table, [string]$key, [int]$windowMinutes, [int]$limit) {
    $now = [DateTimeOffset]::UtcNow
    $entry = $table[$key]
    if ($null -eq $entry -or $entry.Window.AddMinutes($windowMinutes) -lt $now) {
        $entry = [PSCustomObject]@{ Window = $now; Count = 0 }
        $table[$key] = $entry
    }
    $entry.Count++
    return ($entry.Count -le $limit)
}

function Invoke-GitHubApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $headers = @{
        "User-Agent"           = "CrossingVoidIssueFeedback/1.0"
        "Accept"               = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
        "Authorization"        = "Bearer $($script:GithubToken)"
    }
    $uri = "$githubApiRoot$Path"
    try {
        if ($null -ne $Body) {
            # 关键：用 UTF8 字节发，别让 PowerShell 把中文变成 "?"（这个坑在本地踩过）
            $json = $Body | ConvertTo-Json -Compress -Depth 8
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $response = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers `
                -ContentType "application/json; charset=utf-8" -Body $bytes -UseBasicParsing -TimeoutSec 25
        } else {
            $response = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers -UseBasicParsing -TimeoutSec 25
        }
        $reader = [IO.StreamReader]::new($response.RawContentStream, [Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
        $reader.Dispose()
        return @{ ok = $true; status = [int]$response.StatusCode; body = ($text | ConvertFrom-Json) }
    } catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) {
            return @{ ok = $false; status = 0; message = $_.Exception.Message }
        }
        $status = [int]$webResponse.StatusCode
        $contentType = [string]$webResponse.ContentType
        $stream = $webResponse.GetResponseStream()
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
        $reader.Dispose()
        # 站点级限制返回的是 HTML 页面而不是 API 错误对象（文档 §9.1）：单独标出来，别当业务错误。
        $isHtml = $contentType -like "*text/html*"
        $message = if ($isHtml) { "GitHub 临时限制了服务器访问，请稍后再试" } else { $text }
        return @{ ok = $false; status = $status; message = $message; isHtml = $isHtml }
    }
}

function Get-AllowedLabels([object]$rawLabels) {
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($rawLabels)) {
        $name = Read-Text $item 32
        if ($allowedLabels -contains $name -and -not $result.Contains($name)) { $result.Add($name) }
    }
    if (-not $result.Contains("来源:启动器")) { $result.Add("来源:启动器") }
    if (-not $result.Contains("待确认")) { $result.Add("待确认") }
    return $result
}

# ── 监听 ────────────────────────────────────────────────
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($listenPrefix)
try {
    $listener.Start()
    Write-ServiceLog "listening on $listenPrefix"
} catch {
    Write-ServiceLog "listener startup failed: $($_.Exception.Message)"
    throw
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $request = $context.Request
            $path = $request.Url.AbsolutePath.TrimEnd("/")
            $ip = $request.RemoteEndPoint.Address.ToString()

            if ($request.HttpMethod -eq "GET" -and ($path -eq "/health" -or $path -eq "/api/issue-feedback/health")) {
                Write-Response $context.Response 200 @{ success = $true; service = "issue-feedback"; repository = $githubRepository }
                continue
            }

            # ── 建 issue ───────────────────────────────────
            if ($request.HttpMethod -eq "POST" -and $path -eq "/api/issue-feedback/issues") {
                if ($request.ContentLength64 -gt $maxPayloadBytes) {
                    Write-Response $context.Response 413 @{ success = $false; message = "Payload too large" }
                    continue
                }
                $raw = Read-RequestBytes $request $maxPayloadBytes
                $body = [Text.Encoding]::UTF8.GetString($raw)
                try { $payload = $body | ConvertFrom-Json } catch {
                    Write-Response $context.Response 400 @{ success = $false; message = "Invalid JSON" }
                    continue
                }

                if ((Read-Text $payload.productKey 64) -ne $allowedProductKey) {
                    Write-Response $context.Response 400 @{ success = $false; message = "Unknown product" }
                    continue
                }

                $title = (Read-Text $payload.title $maxTitleChars).Trim()
                $issueBody = Read-Text $payload.body $maxBodyChars
                if ([string]::IsNullOrWhiteSpace($title) -or [string]::IsNullOrWhiteSpace($issueBody)) {
                    Write-Response $context.Response 400 @{ success = $false; message = "Title and body are required" }
                    continue
                }

                if (-not (Test-RateLimit $submitRateLimit $ip $submitWindowMinutes $submitLimitPerWindow)) {
                    Write-ServiceLog "提交被限频：ip=$ip"
                    Write-Response $context.Response 429 @{ success = $false; message = "提交太频繁，请过一会儿再试" }
                    continue
                }

                # 同一内容 10 分钟内只建一次：玩家连点、网络重试都落在这里。
                $fingerprint = [BitConverter]::ToString(
                    [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes("$title`n$issueBody"))
                ).Replace("-", "")
                $seen = $recentFingerprints[$fingerprint]
                if ($null -ne $seen -and $seen.AddMinutes($submitWindowMinutes) -gt [DateTimeOffset]::UtcNow) {
                    Write-Response $context.Response 200 @{ success = $true; duplicated = $true; number = $seen.Number; htmlUrl = $seen.HtmlUrl }
                    continue
                }

                $labels = Get-AllowedLabels $payload.labels
                $created = Invoke-GitHubApi -Method "POST" -Path "/repos/$githubRepository/issues" -Body @{
                    title  = $title
                    body   = $issueBody
                    labels = @($labels)
                }

                if (-not $created.ok) {
                    Write-ServiceLog "建单失败：status=$($created.status) message=$($created.message)"
                    $status = if ($created.status -ge 400) { $created.status } else { 502 }
                    Write-Response $context.Response $status @{ success = $false; message = $created.message }
                    continue
                }

                $number = $created.body.number
                $htmlUrl = [string]$created.body.html_url
                $recentFingerprints[$fingerprint] = [PSCustomObject]@{
                    Number = $number; HtmlUrl = $htmlUrl; At = [DateTimeOffset]::UtcNow
                }
                Add-Content -LiteralPath (Join-Path $storageRoot ("attempts-{0:yyyy-MM-dd}.jsonl" -f (Get-Date))) `
                    -Value (@{ at = (Get-Date -Format o); ip = $ip; number = $number; title = $title } | ConvertTo-Json -Compress) -Encoding utf8

                Write-ServiceLog "建单成功：#$number（$ip）"
                Write-Response $context.Response 201 @{ success = $true; number = $number; htmlUrl = $htmlUrl }
                continue
            }

            # ── 读列表 / 详情 / 评论 ────────────────────────
            if ($request.HttpMethod -eq "GET" -and $path -eq "/api/issue-feedback/issues") {
                if (-not (Test-RateLimit $readRateLimit $ip $readWindowMinutes $readLimitPerWindow)) {
                    Write-Response $context.Response 429 @{ success = $false; message = "Rate limit exceeded" }
                    continue
                }
                $perPage = 100
                $result = Invoke-GitHubApi -Method "GET" -Path "/repos/$githubRepository/issues?state=open&per_page=$perPage&sort=updated&direction=desc"
                if (-not $result.ok) {
                    Write-Response $context.Response 502 @{ success = $false; message = $result.message }
                    continue
                }
                Write-Response $context.Response 200 @{ success = $true; issues = @($result.body) }
                continue
            }

            if ($request.HttpMethod -eq "GET" -and $path -match "^/api/issue-feedback/issues/(\d+)$") {
                if (-not (Test-RateLimit $readRateLimit $ip $readWindowMinutes $readLimitPerWindow)) {
                    Write-Response $context.Response 429 @{ success = $false; message = "Rate limit exceeded" }
                    continue
                }
                $number = $Matches[1]
                $result = Invoke-GitHubApi -Method "GET" -Path "/repos/$githubRepository/issues/$number"
                if (-not $result.ok) {
                    Write-Response $context.Response 502 @{ success = $false; message = $result.message }
                    continue
                }
                Write-Response $context.Response 200 @{ success = $true; issue = $result.body }
                continue
            }

            if ($request.HttpMethod -eq "GET" -and $path -match "^/api/issue-feedback/issues/(\d+)/comments$") {
                if (-not (Test-RateLimit $readRateLimit $ip $readWindowMinutes $readLimitPerWindow)) {
                    Write-Response $context.Response 429 @{ success = $false; message = "Rate limit exceeded" }
                    continue
                }
                $number = $Matches[1]
                $result = Invoke-GitHubApi -Method "GET" -Path "/repos/$githubRepository/issues/$number/comments?per_page=100"
                if (-not $result.ok) {
                    Write-Response $context.Response 502 @{ success = $false; message = $result.message }
                    continue
                }
                Write-Response $context.Response 200 @{ success = $true; comments = @($result.body) }
                continue
            }

            # ── 发评论 ─────────────────────────────────────
            if ($request.HttpMethod -eq "POST" -and $path -match "^/api/issue-feedback/issues/(\d+)/comments$") {
                if ($request.ContentLength64 -gt $maxPayloadBytes) {
                    Write-Response $context.Response 413 @{ success = $false; message = "Payload too large" }
                    continue
                }
                $raw = Read-RequestBytes $request $maxPayloadBytes
                $body = [Text.Encoding]::UTF8.GetString($raw)
                try { $payload = $body | ConvertFrom-Json } catch {
                    Write-Response $context.Response 400 @{ success = $false; message = "Invalid JSON" }
                    continue
                }
                if ((Read-Text $payload.productKey 64) -ne $allowedProductKey) {
                    Write-Response $context.Response 400 @{ success = $false; message = "Unknown product" }
                    continue
                }
                $text = (Read-Text $payload.body $maxCommentChars).Trim()
                if ([string]::IsNullOrWhiteSpace($text)) {
                    Write-Response $context.Response 400 @{ success = $false; message = "Comment body is required" }
                    continue
                }
                if (-not (Test-RateLimit $submitRateLimit $ip $submitWindowMinutes $submitLimitPerWindow)) {
                    Write-Response $context.Response 429 @{ success = $false; message = "提交太频繁，请过一会儿再试" }
                    continue
                }
                $number = $Matches[1]
                $result = Invoke-GitHubApi -Method "POST" -Path "/repos/$githubRepository/issues/$number/comments" -Body @{ body = $text }
                if (-not $result.ok) {
                    $status = if ($result.status -ge 400) { $result.status } else { 502 }
                    Write-Response $context.Response $status @{ success = $false; message = $result.message }
                    continue
                }
                Write-Response $context.Response 201 @{
                    success = $true
                    comment = @{
                        id        = $result.body.id
                        author    = $result.body.user.login
                        body      = $result.body.body
                        createdAt = $result.body.created_at
                    }
                }
                continue
            }

            Write-Response $context.Response 404 @{ success = $false; message = "Not found" }
        } catch {
            Write-ServiceLog "处理请求出错：$($_.Exception.Message)"
            try { Write-Response $context.Response 500 @{ success = $false; message = "Internal error" } } catch { }
        }
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
    Write-ServiceLog "listener stopped"
}
