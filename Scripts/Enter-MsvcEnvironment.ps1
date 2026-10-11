# 进入 MSVC 环境后执行命令（Windows 本地开发/测试用）。
#
# 为什么需要它：本机装的是 Visual Studio 18 Insiders，它的 vcvars64.bat **只导出了部分变量**，
# 缺 `VCToolsInstallDir` / `INCLUDE` / `LIB` / `WindowsSDKVersion`，也不把 cl.exe 加进 PATH。
# 结果 `cargo test` 在编译 `zstd-sys` / `bzip2-sys` 这些 C 依赖时就失败
# （报 `failed to find tool "cl.exe"` 或 `INCLUDE` 缺失导致的编译错误）。
#
# 用法：
#   pwsh -NoProfile -File .\Scripts\Enter-MsvcEnvironment.ps1 -Command 'cargo test --manifest-path src-tauri\Cargo.toml'
#
# 本脚本只影响当前进程的环境变量，不改系统设置、不写注册表。

param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string]$VisualStudioRoot = "",
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Resolve-VisualStudioRoot {
    param([string]$Explicit)

    if ($Explicit) {
        if (Test-Path $Explicit) { return $Explicit }
        throw "指定的 Visual Studio 根目录不存在：$Explicit"
    }

    $candidates = @()
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * -property installationPath 2>$null
        if ($found) { $candidates += $found.Trim() }
    }

    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files')) {
        if (-not $base -or -not (Test-Path $base)) { continue }
        $vsDir = Join-Path $base 'Microsoft Visual Studio'
        if (-not (Test-Path $vsDir)) { continue }
        Get-ChildItem $vsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidates += $_.FullName
            }
        }
    }

    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'VC\Auxiliary\Build\vcvars64.bat')) { return $candidate }
    }

    throw "找不到带 MSVC 生成工具的 Visual Studio（需要 VC\Auxiliary\Build\vcvars64.bat）。"
}

$vsRoot = Resolve-VisualStudioRoot -Explicit $VisualStudioRoot
$vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { throw "找不到 vcvars64.bat：$vcvars" }

# 1) 先跑 vcvars，把它能给的变量都拿过来。
$envFile = [System.IO.Path]::GetTempFileName()
try {
    cmd.exe /c "`"$vcvars`" >nul 2>&1 & set > `"$envFile`"" | Out-Null
    Get-Content -LiteralPath $envFile | ForEach-Object {
        $index = $_.IndexOf('=')
        if ($index -le 0) { return }
        $name = $_.Substring(0, $index)
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_()]*$') { return }
        [System.Environment]::SetEnvironmentVariable($name, $_.Substring($index + 1))
    }
}
finally {
    Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
}

# 2) 补上 vcvars 漏掉的东西（这是本机 VS Insiders 的已知缺口）。
$msvcToolRoot = Get-ChildItem (Join-Path $vsRoot 'VC\Tools\MSVC') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } -Descending |
    Select-Object -First 1
if (-not $msvcToolRoot) { throw "找不到 MSVC 工具集目录：$vsRoot\VC\Tools\MSVC" }

$env:VCToolsInstallDir = "$($msvcToolRoot.FullName)\"
$hostArch = 'HostX64'
$targetArch = 'x64'
$clDir = Join-Path $msvcToolRoot.FullName "bin\$hostArch\$targetArch"
if (-not (Test-Path (Join-Path $clDir 'cl.exe'))) { throw "找不到 cl.exe：$clDir" }

if (-not $env:VCToolsVersion) { $env:VCToolsVersion = $msvcToolRoot.Name }

# PATH：编译器 + MSBuild + IDE 工具
$pathParts = @($clDir, (Join-Path $vsRoot 'Common7\IDE\VC\VCPackages'), (Join-Path $vsRoot 'MSBuild\Current\Bin'))
$env:PATH = (($pathParts + @($env:PATH)) -join ';')

# INCLUDE：MSVC 头 + Windows SDK 头（ucrt / um / shared / winrt / cppwinrt）
$sdkRoot = $env:WindowsSdkDir
if (-not $sdkRoot) { $sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\' }
if (-not $env:WindowsSDKVersion -and (Test-Path (Join-Path $sdkRoot 'Include'))) {
    $latest = Get-ChildItem (Join-Path $sdkRoot 'Include') -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { $env:WindowsSDKVersion = "$($latest.Name)\" }
}

$includeParts = @(
    (Join-Path $msvcToolRoot.FullName 'include'),
    (Join-Path $sdkRoot "Include\$($env:WindowsSDKVersion)ucrt"),
    (Join-Path $sdkRoot "Include\$($env:WindowsSDKVersion)um"),
    (Join-Path $sdkRoot "Include\$($env:WindowsSDKVersion)shared"),
    (Join-Path $sdkRoot "Include\$($env:WindowsSDKVersion)winrt"),
    (Join-Path $sdkRoot "Include\$($env:WindowsSDKVersion)cppwinrt")
) | Where-Object { Test-Path $_ }
$env:INCLUDE = ($includeParts + @($env:INCLUDE)) -join ';'

# LIB：MSVC 库 + Windows SDK 库（ucrt / um）
$libParts = @(
    (Join-Path $msvcToolRoot.FullName "lib\$targetArch"),
    (Join-Path $sdkRoot "Lib\$($env:WindowsSDKVersion)ucrt\$targetArch"),
    (Join-Path $sdkRoot "Lib\$($env:WindowsSDKVersion)um\$targetArch")
) | Where-Object { Test-Path $_ }
$env:LIB = ($libParts + @($env:LIB)) -join ';'

if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw "cl.exe 仍未进入 PATH，MSVC 环境不完整。"
}

if (-not $Quiet) {
    Write-Host "MSVC: $($msvcToolRoot.Name)   SDK: $($env:WindowsSDKVersion.TrimEnd('\'))" -ForegroundColor DarkGray
    Write-Host "cl.exe: $clDir" -ForegroundColor DarkGray
}

# 3) 在准备好的环境里执行命令。
& ([scriptblock]::Create($Command))
exit $LASTEXITCODE
