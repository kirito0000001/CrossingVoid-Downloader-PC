# 游戏碎片包生成规则（PC）

面向“网盘 / QQ 群分发的游戏碎片包”的生成方。启动器侧实现见
`src-tauri/src/game_package.rs` 的 `import_package_files`（第 1150 行起）。

## 0. 一句话契约

**zip 里的条目名 = 清单里的 `path`，逐字符一致；清单里的文件一个都不能少。**

其余全部自由：包名、包数量、拆分方式、压缩方式、包的先后顺序。

## 1. 唯一真相源

| 项 | 值 |
| --- | --- |
| 版本指针 | `https://dl.crossingvoid.top/games/crossingvoid/latest.json` |
| 当前清单（2026-10-19） | `https://dl.crossingvoid.top/games/crossingvoid/manifests/0.6.0.json` |
| 文件数 | **179** |
| 解压后总字节 | **2,870,088,070**（2737.1 MiB） |

生成时以这份清单为准，**不要拿游戏打包目录现扫**：目录里还有发布流程的中间产物，
清单里没有它们；而清单要求的版本标记文件，目录里可能还没生成（见第 3 节）。

推荐按清单驱动生成，而不是扫目录：

```text
读取 manifest.files
-> 逐条 path 去发布目录取同名文件；取不到立刻报错，不要静默跳过
-> 校验 size + sha256 通过后才写进 zip，条目名直接用 path
-> 按体积切包，每包写完回读一遍条目名
```

扫目录最大的风险就是“少文件也不报错”——这次 `CrossingVoid.version.json` 就是这么漏掉的。
按清单驱动时，缺任何一个都会在生成阶段失败，不用等玩家导入才发现。

## 2. 硬规则

| # | 规则 | 违反后果 |
| --- | --- | --- |
| 1 | 条目名 = 清单 `path`，用 `/` 分隔，不改大小写，不加 `./` 前缀 | 该文件被判“缺失”，导入不齐，装不了 |
| 2 | **压缩包内不要再套一层文件夹**（不要出现 `零境交错/CrossingVoid.exe`） | 全部条目对不上清单，等于空包 |
| 3 | 清单里每个文件都必须出现，包含根目录的 `CrossingVoid.version.json` | 状态停在“碎片还不齐”，主按钮永远不变“安装游戏” |
| 4 | 内容必须与清单 `sha256` 一致（大小一致只是必要条件） | 判“内容对不上”，`.part` 被删，不落盘 |
| 5 | 标准 zip，`deflate` 或 `store` 都行；**不能加密、不能分卷/多卷** | 这个包会被跳过并单独报告，包里没导进来的文件按缺失算 |
| 6 | 不能是 rar / 7z / tar，也不能改名冒充 zip | 会被当成散件，永远匹配不上 |
| 7 | 同一个 `path` 不要出现在两个包里 | 只取第一个，不报错但白占体积 |
| 8 | 空目录条目可留可删 | 无影响，导入时跳过 |
| 9 | 单包小于 4 GB（百度网盘非会员限制） | 上传/下载受限 |
| 10 | 不要打包 `Saved/`、`launcher.game.json`、旧 `CrossingVoid.manifest.json` | 清单里没有，导不进去，白占体积 |

包名随意，导入器不看包名，只认包内条目名。**当前约定的名字**是
`零境V{版本}PC基础碎片{三位序号}.zip`（例如 `零境V0.6PC基础碎片001.zip`）：带上完整
版本号和平台，避免玩家把两个版本的包、或者手机端的包混进同一个文件夹。

改名不影响导入。0.6.0 重发时外层名从 `零境V0.6基础碎片001~003.zip` 改成了
`零境V0.6PC基础碎片001~003.zip`，包里的条目名和字节都没动 —— 已经下载过旧名包的
玩家不用重下，启动器会按大小把它们认回来（见 6.1）。

坏包容错：任何一个 zip 打不开（下坏、没下完整）只会被跳过并写进结果，
其余包照常导入，包里的文件按缺失结算 —— 玩家重下那一个包再导一次即可，
已经对上的文件不会重拷。

## 3. `CrossingVoid.version.json` 必须存在

它不是游戏本体的产物，而是发布流程写进打包根目录的版本标记：

- 位置固定为压缩包根目录 `CrossingVoid.version.json`；
- 0.6.0 这一份是 **76 字节**，sha256
  `56b8ef6416c337f2d6cf7cd296cf4e3e69919559e5e122c65a625ce4bc1aa51d`；
- 内容形如 `{"version":"0.6.0","platform":"Windows","channel":"stable"}`；
- 缺它的后果是双重的：导入阶段计入 `missing`（导入被判不齐，状态停在 `paused`），
  安装阶段 `validate_install_state("ready")` 也要求版本标记文件存在
  （`src-tauri/src/lib.rs:4155`）。

生成碎片前先确认打包根有这个文件；没有就从清单的 `baseUrl` 取一份放进去再打：
`https://dl.crossingvoid.top/games/crossingvoid/0.6.0/CrossingVoid.version.json`

## 4. 拆分建议

- 按体积均衡切，单包 700–900 MB；三个包覆盖 2.5 GB 对网盘最省事。
- 每个包必须是**独立完整**的 zip，不能“必须按 001→002 顺序解压”。
- 不要把同一个文件按字节切到两个包里（那不是分卷，导入器不会拼接）。
- 当前已验证的分法（可沿用）：exe + Binaries + 全部影片 / pak 前半 / pak 后半。
- 压缩收益参考：影片包约省 14%，纯 pak 包只省 4%。已压缩的资源继续用 `deflate`
  收益有限但无害，不必刻意改成 `store`。

## 5. 生成后自检

把下面的脚本存成 `Test-GameChunks.ps1`，在碎片目录旁运行。默认逐文件算 sha256，
加 `-SkipHash` 只对名字和大小（几秒出结果）。

> 用 Windows PowerShell 5.1 跑时，脚本要存成 **UTF-8 with BOM**（否则中文提示会乱码）；
> 用 `pwsh`（PowerShell 7）跑没有这个限制。

```powershell
param(
  [string]$ChunkDir = '.',
  # 可以给 URL，也可以给本地清单文件
  [string]$Manifest = 'https://dl.crossingvoid.top/games/crossingvoid/manifests/0.6.0.json',
  [switch]$SkipHash
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($Manifest -match '^https?://') {
  $manifestData = Invoke-RestMethod -Uri $Manifest
} else {
  $manifestData = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
}
$expected = @{}
foreach ($f in $manifestData.files) { $expected[$f.path] = $f }

$zips = @(Get-ChildItem -LiteralPath $ChunkDir -Filter *.zip -File)
if ($zips.Count -eq 0) { throw "目录里没有 zip：$ChunkDir" }

$seen = @{}
$problems = @()
foreach ($zipFile in $zips) {
  Write-Host ("== {0}" -f $zipFile.Name)
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipFile.FullName)
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName.EndsWith('/')) { continue }
      $name = $entry.FullName
      if (-not $expected.ContainsKey($name)) { $problems += "多余条目：$name（$($zipFile.Name)）"; continue }
      if ($seen.ContainsKey($name)) { $problems += "重复条目：$name"; continue }
      $seen[$name] = $true
      $want = [int64]$expected[$name].sizeBytes
      if ($entry.Length -ne $want) { $problems += "大小不符：$name 期望 $want 实际 $($entry.Length)"; continue }
      if (-not $SkipHash) {
        $stream = $entry.Open()
        try {
          $sha = [System.Security.Cryptography.SHA256]::Create()
          try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
          finally { $sha.Dispose() }
        } finally { $stream.Dispose() }
        if ($hash -ne $expected[$name].sha256) { $problems += "内容不符：$name" }
      }
    }
  } finally { $zip.Dispose() }
}

foreach ($path in $expected.Keys) {
  if (-not $seen.ContainsKey($path)) { $problems += "缺失：$path（$($expected[$path].sizeBytes) 字节）" }
}

Write-Host ""
Write-Host ("清单 {0} 个文件，包内命中 {1} 个" -f $expected.Count, $seen.Count)
if ($problems.Count -eq 0) { Write-Host "通过：可以分发。" -ForegroundColor Green; exit 0 }
$problems | Sort-Object | ForEach-Object { Write-Host $_ -ForegroundColor Red }
Write-Host ("失败：{0} 个问题" -f $problems.Count) -ForegroundColor Red
exit 1
```

## 6. 碎片清单（`fragments.json`）

启动器的导入框靠这份文件才知道“这一版应该有哪几个包”：

- 位置由 `latest.json` 的 `fragmentsUrl` 给出（当前是
  `https://dl.crossingvoid.top/games/crossingvoid/fragments/0.6.0.json`）；
- `version` 必须与 `latest.json.version` 一致，不一致整份忽略 —— 宁可退化成
  “直接选文件、导入后判齐”，也不能把上一版的包名摆给玩家；
- `sizeBytes` 用文件实际字节数，`fileCount` 是包内非目录条目数；
- **重打、改名之后必须点「发布碎片清单」重发这份 JSON**，否则界面会按旧的包名/大小
  把新包判红；
- 重发是**原地更新同一个 URL**，启动器每次拉取都会带 `?t=<时间戳>`，不会被缓存住；
- 这份文件只是界面上的“齐没齐”；真正的内容校验仍然是导入时逐个文件的 sha256。

当前线上（2026-10-19 PC 0.6.0 重发后，`fragments/0.6.0.json`）：

```json
{
  "schemaVersion": 1,
  "version": "0.6.0",
  "totalBytes": 2660439628,
  "fragments": [
    { "fileName": "零境V0.6PC基础碎片001.zip", "sizeBytes": 862273823, "fileCount": 40 },
    { "fileName": "零境V0.6PC基础碎片002.zip", "sizeBytes": 846465935, "fileCount": 75 },
    { "fileName": "零境V0.6PC基础碎片003.zip", "sizeBytes": 951699870, "fileCount": 64 }
  ]
}
```

### 6.1 改名 / 重发时玩家侧会发生什么

0.6.0 这次只改了**外层文件名**（`零境V0.6基础碎片001~003.zip` →
`零境V0.6PC基础碎片001~003.zip`），压缩包里的条目名和字节都没变，
`sizeBytes` / `fileCount` / `totalBytes` 也一分不少地对得上。

- 启动器先按**文件名**认包；名字对不上时再按**大小唯一**认，状态显示
  “已识别（按大小）”。所以已经下过旧名包的玩家不用重下 2.5 GB，选中旧包照样能导 ——
  导入的裁判始终是包内条目名 + sha256，不是包名。
- 如果重生成导致**大小也变了**，旧包就会落到“不是这一版的包”，玩家得按新清单重下；
  所以重发前先用第 5 节的自检脚本对新包跑一遍，再核对 `fragments.json` 的 `sizeBytes`。
- 两个包大小撞车时启动器不会猜（`matchChunkSelection` 只在大小唯一时认改名的包），
  这种情况按新清单重新下载就行。

## 7. 启动器侧对应实现（排查时可对照）

| 行为 | 位置 |
| --- | --- |
| 读碎片清单（`latest.json` → `fragmentsUrl`，版本不一致判无效） | `src/App.vue` `loadGameChunkFragments` / `src/gameChunkFragments.ts` |
| 选中文件的轻量体检（只读 zip 中央目录，不解压） | `game_package.rs` `inspect_game_chunk_files` |
| 选中文件 ↔ 应有包的对照（绿/黄/红/灰） | `src/gameChunkFragments.ts` `matchChunkSelection` |
| 包名对不上时按大小唯一认（重发前的旧名包、玩家改过名） | `src/gameChunkFragments.ts` `matchChunkSelection`（`renamed` 分支） |
| 选文件与选文件夹的统一入口 | `game_package.rs` `import_package_files(sources: &[PathBuf])` |
| 递归扫描源目录，收集 `.zip` 与散件 | `game_package.rs` `import_collect_sources` |
| 打开每个 zip，把条目名归一后与清单 path 对应 | `game_package.rs` `import_index_archives` |
| 条目名归一（只去 `./`、统一 `/`，**不剥目录层**） | `game_package.rs` `normalize_archive_entry_name` |
| 散件才有的“多套一层目录”探测（深度 3） | `game_package.rs` `import_resolve_root` |
| 逐文件写 `.part` → 校验 sha256 → 原子改名 | `game_package.rs` `import_write_source` |
| 缺一个就判不齐，状态停 `paused` | `src/App.vue` `importGameChunks` |
| 安装前整包复核 | `src/App.vue` `verifyInstalledPackageFiles` |

注意：第 2 条“不要套目录”只对压缩包条目成立。散件（直接放在文件夹里的文件）
允许玩家多套一层，导入器会往下探三层；zip 里的条目不会。
