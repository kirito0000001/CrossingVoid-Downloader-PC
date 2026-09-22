# 游戏包下载改造方案（PC + Android 统一内核）

> **状态**：方案已定稿，等开工（2026-09-20 定）。
> **上游契约**：`D:\2026-09-20-game-upload-launcher-contract.md` —— 分发侧已实现并实测，那边不用再等。
> **适用仓库**：`D:\UnrealMap\CrossingVoidinitiator-PC`（先做，参考实现）、`D:\UnrealMap\CrossingVoidinitiator-Android`（照搬内核，只改落位）。
> **本文写什么**：我们这边怎么改、按什么顺序、怎么验收。字段含义与错误现象以契约为准，不在这里重复。
> **边界**：只动启动器仓库；不碰 `D:\UnrealMap\CrossingVoid` 里的虚幻工程。

---

## 零、已定决策（2026-09-20 用户拍板）

| # | 决策 | 含义 |
| --- | --- | --- |
| 1 | **切 v1-only** | 清单只认 `schemaVersion === 1`，来源改成 dl 的 `latest.json`；www 的 v2 链路**代码保留不删、不再调用**（回滚用） |
| 2 | ~~**GitHub 下载源本期不动**~~ → **2026-09-21 已双向打通** | 上传侧修好后，两个平台都接上了 GitHub 备用源，见 1.1 |
| 3 | **安卓本期一律重组 OBB** | 不做 `Saved/Paks` 快速路径；原因与代价见第六章，等真机验证优先级后再开 |

---

## 一、服务器实测事实（2026-09-20 实测）

开工前照着复核一遍即可，这些都是当前线上真实值：

| 项 | 实测值 |
| --- | --- |
| PC 最新版指针 | `https://dl.crossingvoid.top/games/crossingvoid/latest.json` → `{"schemaVersion":1,"productSegment":"crossingvoid","version":"0.5.14","manifestUrl":".../manifests/0.5.14.json","generatedAt":"2026-09-20T12:33:10Z"}` |
| 安卓最新版指针 | `https://dl.crossingvoid.top/games/crossingvoid-android/latest.json` → 同结构，`version=0.5.14`，`generatedAt=2026-09-20T13:05:55Z` |
| PC 清单 | `schema=1`、`productKey=crossingvoid-game`、`runtime=Windows`、`version=0.5.14`、`channel=stable`、**files=86**、`patches=[]`、合计 **2,711,651,084 B**、`baseUrl=.../games/crossingvoid/0.5.14/` |
| 安卓清单 | `schema=1`、`productKey=crossingvoid-android-game`、`runtime=Android`、`channel=stable`、**files=65**、`patches=[]`、合计 **2,214,925,108 B**、`baseUrl=.../games/crossingvoid-android/0.5.14/` |
| 安卓清单形态 | **已经是 chunk 化**：`CrossingVoid-Android-Shipping-arm64.apk`(73,185,276) + 63 个 OBB 条目（Movies/Paks/Engine）+ `CrossingVoid.version.json` + `CrossingVoid.obb.json`(3437) |
| OBB 旁车 | `obbFileName=main.1.com.TFAC.CorssingVoid.obb`（`1` 是 APK versionCode）；`entries` 64 条；另有 `version:0.5.14`、`productKey:crossingvoid-android-game` |
| 版本标记 | `CrossingVoid.version.json` = `{"version":"0.5.14","platform":"Android","channel":"stable"}` |
| 断点续传 | PC `pakchunk0-Windows.ucas`(961,189,680)、安卓 `pakchunk0-Android.ucas`(683,705,488)、安卓 apk 三个大文件都实测 **206 + `Accept-Ranges: bytes`** |
| 旧版 | `manifests/0.5.13.json` 已 **404**（树里只留最新版） |
| ⚠️ 还在跑老流程的入口 | www 的 `manifests/game/windows-latest.json` / `android-latest.json` **仍是 v2 / V0.5.12**（OSS zip + 切片）→ 启动器必须改读 dl 的 `latest.json`，不要再读它们 |

### 1.1 GitHub 备用源（2026-09-21 实测）

同一份产物在 GitHub Release 里也放了一份，命名规则是**路径里的 `/` 换成 `__`**（根目录文件保持原名）：

| 项 | 实测值 |
| --- | --- |
| 仓库 / 标签 | `kirito0000001/CrossingVoid`，标签 `PC-V<版本>`、`Android-V<版本>`（例：`PC-V0.5.14`） |
| 附件名 | `CrossingVoid/Binaries/Win64/CrossingVoid-Win64-Shipping.exe` → `CrossingVoid__Binaries__Win64__CrossingVoid-Win64-Shipping.exe` |
| 内容级比对 | 每个附件都带 `digest: sha256:…`，与清单里的 `files[].sha256` **完全一致** |
| 覆盖度实测 | PC 清单 86 条 → **86/86 都能对上**；安卓 65 条 → **65/65 都能对上**；sha256 不一致 0 条 |
| 额外附件 | 每个 Release 还多一个 `manifest.json`（就是那份 v1 清单本身），所以将来清单也能从 GitHub 读 |

启动器侧的实现：每个文件带**候选地址列表**（首选源在前，另一个源兜底），
首选源 404 或校验失败就自动换另一个源 —— 这就是"双源混用"。被远程渠道开关关掉的源不参与候选。

**清单本身也有兜底**（2026-09-21 补）：正常情况下读 dl 的 `latest.json → manifestUrl`；
下载站挂了或该渠道被关，就改成走 GitHub Releases API 挑出 `PC-V*` / `Android-V*` 里带
`manifest.json` 的那条，再从 Release 里读同一份清单（两边 sha256 完全一致）。
文件地址会跟着"清单实际来自哪条 release 的标签"走，不靠猜版本号。

---

## 二、统一内核（两端同一份逻辑）

### 2.1 放哪、怎么防漂移

一份纯 TS 文件 `gamePackage.ts`，**不碰任何平台 API**，两端各放一份、**逐字相同**：

- PC：`D:\UnrealMap\CrossingVoidinitiator-PC\src\gamePackage.ts`
- 安卓：`D:\UnrealMap\CrossingVoidinitiator-Android\src\services\gamePackage.ts`
- 两端各加一条测试：算出本文件内容 sha256，与写死在测试里的常量比对 → 任何一边被改动，两边测试同时红。

### 2.2 统一数据模型（字段名两端一致）

```ts
type LatestPointer = {
  schemaVersion: 1;
  productSegment: string;   // crossingvoid / crossingvoid-android / …
  version: string;          // 0.5.14
  manifestUrl: string;      // 指向下面的清单
  generatedAt: string;
};

type GameFileEntry = { path: string; sizeBytes: number; sha256: string };

type GameManifestV1 = {
  schemaVersion: 1;
  productKey: string;
  runtime: "Windows" | "Android";
  version: string;
  channel: "stable" | "test";
  baseUrl: string;          // 以 / 结尾，下载 URL = baseUrl + path
  generatedAt: string;
  files: GameFileEntry[];
  patches: unknown[];       // 本期恒为空，必须忽略而不是报错
};

// 本地状态文件：两端同一个格式，字段名与清单 files[] 同形
type LocalGameState = {
  schemaVersion: 1;
  productKey: string;
  version: string;
  files: GameFileEntry[];
};

type DownloadPlan = {
  download: GameFileEntry[];   // sha256 变了 / 本地缺
  prune: string[];             // 上次状态里有、这次清单没有、且在可删白名单内
  keep: string[];              // 本地有且 sha256 一致
  totalBytes: number;          // 本次要下的字节数（不是全量）
};

type DownloadProgress = {
  totalFiles: number; doneFiles: number;
  totalBytes: number; doneBytes: number;
  currentPath: string;
};
```

### 2.3 统一算法（两端照抄；只有第 6 步不同）

```text
1. 拉 <base>/games/<segment>/latest.json?t=<时间戳>（必须带时间戳，dl 没有 Cache-Control）
2. 拉 pointer.manifestUrl?t=<时间戳> → GameManifestV1 → 校验：
     schemaVersion == 1（否则报“清单格式不受支持”，不要当成“没有更新”）
     productKey 与当前端一致；runtime 与当前平台一致；channel 与当前通道一致
     path 必须是相对路径：无盘符、无开头斜杠、无 ".."；sha256 是 64 位小写 hex；sizeBytes > 0
3. 读本地状态：
     有状态文件 → 用它
     没有（老安装升级上来）→ 按清单逐条哈希本地文件，现场生成状态（bootstrap，进度条走这一遍）
4. 生成 DownloadPlan：sha256 相同 = 跳过；不同/缺失 = 下载；状态里有但清单没有 = 进 prune
5. 下载：并发 4（服务器每 IP 上限 6 条，第 7 条 503）；每个文件：
     <目标>.part 已存在且 < sizeBytes → Range: bytes=<已下>-
     否则 0 开始下；返回 200 时改从头下
     下完算 sha256；不符 → 删 .part 整个重下（最多 2 次）→ 仍不符则整次失败并报文件名
     相符 → 同目录原子改名成目标名（绝不直接写目标名）
6. 落位（唯一的平台差异，见第三、四章）
7. 处理 prune：逐个删，删不掉只记日志，不让整次更新失败
8. 把清单的 files[] 整体写回状态文件（含跳过的），version 记为清单 version
9. 安卓额外一步：确认 APK 已装、OBB 在位
```

### 2.4 统一口径（写进两端 UI 与日志）

| 项 | 统一规定 |
| --- | --- |
| 进度文案 | `3/86 个文件 · 1.2/2.7 GB`；不再出现"分片 / 合并 / 解压" |
| 并发 | 4（可配，硬上限 6） |
| 重试 | 单文件 sha256 不符最多重下 2 次；404 不重试（说明版本已下线） |
| 错误码 | `manifest-unsupported` / `product-mismatch` / `runtime-mismatch` / `channel-mismatch` / `version-retired`(404) / `hash-mismatch` / `disk-full` / `permission-denied` / `network-interrupted` |
| 删除白名单 | 只删"上次状态里记过、这次清单里没有"的文件；PC 的 `Saved\` 永不删，安卓私有数据永不删 |
| 可删的旧残留 | PC：`CrossingVoid.zip`、`*.碎片NNN`、`_download`；安卓：`Android/obb/<包名>/` 下其它 `main.*.obb` |

---

## 三、PC 改造清单（先做，作为参考实现）

| 文件 / 位置 | 现状 | 改成 |
| --- | --- | --- |
| `src/platform/gameCatalog.ts` | 只有游戏条目 + `implemented` | 每条补 `{ productSegment, productKey, runtime }`，清单地址由它推导；以后接幻杀/火影就是加一行 |
| `src/App.vue:367` | 写死 `.../manifests/game/windows-latest.json` | 读 `https://dl.crossingvoid.top/games/<segment>/latest.json` |
| `src/App.vue:1919-1939` | `schemaVersion !== 2` 就抛"版本不受支持" | 加 v1 分支（`=== 1`）；v2 分支保留、不再被调用 |
| `src/App.vue:1742` | 按 `runtime` 从 `latest.assets[]` 挑 | 直接用 `files[]` + `baseUrl` |
| `src/launcherTypes.ts:60` 附近 | v2 类型 | 新增 v1 类型（`GameManifestV1` / `GameFileEntry` / `LatestPointer`），v2 类型保留 |
| `src-tauri/src/lib.rs` | 切片下载 → 拼接 → 解压（`download_game_archive` / `import_game_chunks` / `install_downloaded_game_archive`） | 新增 `download_game_files`（并发 4 + Range + `.part` + sha256 + 进度事件）、`scan_local_game_files`（bootstrap 哈希）、`prune_game_files`（白名单删除）；老三条命令保留不调用 |
| 复用 | 已有 `calculate_file_sha256_with_progress`、`validate_install_state`、`read_game_version_file`、`ManifestVerifySummary` | 直接用，不重写 |
| 落位 | 安装目录 `D:\TFAC-hz64\CrossingVoid`（`src/gameInstallPath.ts`） | 不变；`files[].path` 直接拼；`CrossingVoid.version.json` 当普通文件落 |
| 状态文件 | 安装目录里的 `CrossingVoid.manifest.json`（现在就有，被读） | 改成 `LocalGameState`（`files[]` 同形 + `productKey`/`version`），本次由我们写 |
| UI | 下载阶段显示分片进度 | 改成文件数 + 字节；保留暂停/继续（`.part` 天然可续） |

---

## 四、Android 改造清单

内核与 PC 完全相同（同一份 `gamePackage.ts`、同一个 `LocalGameState` 格式），差异只在原生下载器和落位。

| 文件 / 位置 | 现状 | 改成 |
| --- | --- | --- |
| `src/services/gameUpdate.ts:3,85` | 写死 www 地址 + 严格 v2 + 硬编码分片名（`CrossingVoid手机端.碎片001`…） | 地址改 dl 的 `latest.json`；解析改 v1 `files[]`；分片名校验删掉 |
| `src/services/downloadPlan.ts` | 由 chunks 生成计划 | 由 `files[]` 生成计划（调统一内核） |
| `src/services/downloadSource.ts` | 默认 `github` | 默认 `official`（本期只保证 official 可用，GitHub 分支用户自己修） |
| `ChunkDownloader.java` | 下一个 zip 分片，已具备 Range/UA | 保留 Range 机制，改成"按 `path` 下一个文件" |
| `GameDownloadService.java` | plan/state 是 chunk 语义 | 换成 file 语义；`DownloadStateStore` 落 `LocalGameState` |
| `AndroidLauncherPlugin.java` | `startDownload` / `importGameChunks` / `exportGameChunks` | `startDownload` 走新计划；导入/导出本期先保留旧实现（见第八章） |
| 落位 · apk | 已有 `PackageInstaller` + `ApkPackageValidator` | 私有目录下完 → sha256 校验 → 系统安装（顺序不变：先全下完再装） |
| 落位 · OBB 条目 | 旧流程：下一个大 obb 直接放 | **重组 OBB**（见第六章）：按旁车 `entries` 顺序写 STORED（不压缩）ZIP → `getObbDir()`（即 `Android/obb/com.TFAC.CorssingVoid/`）+ `obbFileName` |
| 落位 · 元数据 | 无 | `CrossingVoid.obb.json` / `CrossingVoid.version.json` 放应用私有目录，不进 OBB |
| 收尾 | 有 `removeStaleObbFiles` | 组装完清掉同目录其它 `main.*.obb`；装完 APK 后复核 OBB 在位（部分机型安装会清 OBB 目录） |
| 包名 | 启动器与游戏同包名 `com.TFAC.CorssingVoid`（`AndroidLauncherPlugin.java:49`、`capacitor.config.ts`） | 不变，`getObbDir()` 因此就是游戏 OBB 目录 |

---

## 五、两端对照表

| 环节 | PC | Android |
| --- | --- | --- |
| 指针 / 清单 / 校验 / 计划 | `gamePackage.ts`（同一份） | `gamePackage.ts`（同一份） |
| 状态文件 | `<安装目录>\CrossingVoid.manifest.json` | 私有目录 `game-manifest.json`（**同格式**） |
| 下载执行 | Rust `download_game_files` | Java `ChunkDownloader` 改造 |
| 进度 | 文件数 + 字节 | 文件数 + 字节 |
| 落位 | 直接写安装目录 | 组装 OBB + 装 APK |
| 删除白名单 | 状态里记过 + 清单外；`Saved\` 永不删 | 旧 `main.*.obb`、本次临时产物 |

---

## 六、安卓为什么要"重组 OBB"（白话版）

先解释两个名词：

**OBB 是什么**：安卓上体积大的游戏数据不能塞进 apk，得另放一个文件叫 OBB。零境的这个 OBB 其实就是一个**不压缩的 ZIP**，里面装的是游戏自己的 pak（旁车 `CrossingVoid.obb.json` 把里面装了哪 64 个文件列出来了）。

于是"更新"有两条路：

| | A. 重组 OBB（本期选这个） | B. 快速路径（以后再说） |
| --- | --- | --- |
| 做法 | 把变化的那几个文件换掉，本地重新写一个 OBB 文件放回 `Android/obb/com.TFAC.CorssingVoid/` | 把变化的 pak 直接丢到 `Android/data/com.TFAC.CorssingVoid/files/UnrealGame/CrossingVoid/Saved/Paks/`，引擎启动时会扫这个目录，不重建 OBB |
| 下载量 | **只下变化的文件**（和 B 一样） | 只下变化的文件 |
| 额外代价 | 本地重新写一次 OBB（2 GB 的写盘，手机上几十秒） | 几乎没有，秒级落位 |
| 风险 | 无歧义：整个 OBB 被换掉，游戏读到的必然是新的 | 有一个**没验证过**的前提：`Saved/Paks` 里那份 pak 和 OBB 里那份同名 pak，引擎先读哪个？如果引擎先读 OBB，玩家就会拿着旧数据进游戏 —— 这类 bug 极难查 |

B 的官方写法是用 `_P.pak` 命名（引擎会给 patch pak 提优先级），但零境现在是同名 pak，所以**必须先真机验一次**才能确定。

**本期决定**：走 A。理由是"下载量一样、代价只是本地几十秒，换来的是没有歧义"。B 留到真机验证之后再做，那时它是纯优化，不改任何接口。

### 6.1 组装 OBB 的一条硬约束（实现时必须遵守）

更新时只下 sha256 变了的条目，**没变的条目本地并没有散文件**——它们只在已安装的 OBB 里。
所以组装新 OBB 时：

| 该条目 | 字节从哪里来 |
| --- | --- |
| 这次下载了 | 下载目录里的那份 |
| 没下载 | 从**现有 OBB** 里按同名条目搬 |
| 两边都没有 | 报错并点名条目（宁可失败，也不要组装出缺文件的 OBB） |

不遵守这条，每次更新都得先把 2 GB 的旧条目重新下一遍。PC 端不存在这个问题（文件本来就在安装目录里）。

### 6.2 安卓实现进度（2026-09-20）

| 步骤 | 状态 |
| --- | --- |
| 共用内核 `src/services/gamePackage.ts`（与 PC 逐字相同，LF sha256 `141469941f0c…`） | ✅ 已落地，两边各有哈希守卫测试 |
| v1 服务层 `src/services/gamePackageUpdate.ts`：latest → 清单 → OBB 旁车 → 差异计划（含 `needsObbRebuild` 判定） | ✅ 已落地（9 项单测） |
| 原生计划模型 `GamePackagePlan.java`（路径/sha256/大小/URL/旁车条目校验） | ✅ 已落地（6 项单测） |
| 原生 OBB 组装 `ObbAssembler.java`（STORED + 复用旧 OBB 条目，见 6.1） | ✅ 已落地（5 项单测） |
| `GameDownloadService` 按文件下载（Range + sha256 + 落位）+ `ObbAssembler` 组装 + 复用原有 APK 安装 | ✅ 已落地 |
| App.vue / `androidLauncher.ts` 桥接切到新计划；默认下载源改成 official | ✅ 已落地 |
| 导入/导出（按 files 走目录） | ⏳ 暂缓：入口保留，点击提示"正在适配新的文件级清单" |
| 真机验收（首次安装能起、改一个 pak 只下那一个、OBB 能被引擎读到） | ⏳ 需要设备 |

> 原生实现要点：插件按计划形状路由（带 `files[]` → 新的 `ACTION_START_PACKAGE`，带 `chunks[]` → 老的切片流程），
> 所以过渡期两条都能跑；安装成功后状态里会写回 `packageFiles`（清单全量的 path/size/sha256），
> 下次更新就用它算差异。切换下载源到 GitHub 会明确报"未适配新清单"，不会静默拿 dl 的文件冒充。

> **本机跑 Java 单测**：`JAVA_HOME` 要指到 JDK 21（PATH 里的 java 是 21，但 `JAVA_HOME` 是 17，
> 用 17 会报 `无效的源发行版：21`）：
> `$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'; cd android; .\gradlew.bat :app:testDebugUnitTest`

### 6.3 安卓接收 PC 开发页的公告与渠道开关（2026-09-21）

目标：**公告板和下载渠道开关只从 PC 开发页发布一次**，安卓端只负责接收与展示，
两边读同一份线上文档，玩家看到的开关状态因此完全一致。安卓不做自己的发布入口。

| 项 | 做法 |
| --- | --- |
| 发布位置 | `https://www.crossingvoid.top/launcher-notice.json`、`…/launcher-download-channels.json`（PC 开发页写） |
| 共用文件 | `src/remoteLauncherInfo.ts`，与 PC 的 `src/remoteLauncherInfo.ts` **逐字相同**（LF sha256 `f617fd8ca540…`），两边各有哈希守卫测试 |
| 共用内容 | URL 常量、公告/渠道文档的类型、`parseRemoteLauncherNotice`、`parseRemoteDownloadChannels`、`resolveDownloadChannelStates`、渠道是否可用/自动换源/说明文案 |
| 安卓接收层 | `src/services/remoteLauncherInfoClient.ts`：只负责用 `CapacitorHttp` 拉取，解析全部交给共用内核 |
| 公告落位 | 公告页（原先是硬编码文案）显示标题/时间/正文 + 手动刷新；启动时另有一个可关闭的弹窗，和 PC 同形 |
| 渠道落位 | 设置页的两个下载源按钮：被关的置灰并显示「已关闭」；当前渠道被关时首页提示「当前渠道已关闭，请更换」，并自动切到还开着的那个 |
| 真正生效的地方 | 开关不只是画个灰按钮：清单请求（`fetchAndroidGamePackage`）与下载计划（`buildAndroidGameDownloadPlan`）都会拿到 `officialEnabled` / `githubEnabled`，被关的源连"试一下"都不做 |
| 容错 | 公告拉不到／格式不对 → 按"没有公告"；渠道文档 404（线上现在就是）或格式不对 → 按"全部开放"，不把玩家挡在门外 |

> PC 侧的改动是把原来散在 `App.vue` 里的公告解析和 `downloadChannels.ts` 一起并进这个共用文件，
> 所以这次不是"再抄一遍"，而是**两端只剩一份解析逻辑**。

---

## 七、验收（做完拿这几条自检）

### 7.1 本地假下载站（不碰线上）

起一个静态服务器，手写一份 v1 清单（`baseUrl` 指向 `http://127.0.0.1:8000/`），先跑通"逐文件下载 → 校验 → `.part` → 改名 → 写状态"。

### 7.2 三条硬指标

1. **首次安装**：空目录 → 下完 → 逐文件 sha256 与清单一致 → 游戏能起；
2. **改一个文件**：把假清单里某个文件的 sha256 改掉 → 再跑一次，**日志里只有那一个文件被下**，其余全是跳过；
3. **断点续传**：下到一半断网 → 恢复后继续，最终 sha256 一致；再补一条：**中途杀进程** → 重开后 `.part` 能续传或安全重下，**不能留下半包的目标文件**。

### 7.3 真数据

PC 用 `0.5.14`（86 条 / 2.53 GB）；安卓用 `0.5.14`（65 条 / 2.06 GB，其中 apk 73 MB + OBB 条目 2.0 GB）。断网、限速、并发这三个场景在真数据上再验一遍。

---

## 八、明确不做（本期）

| 项 | 说明 |
| --- | --- |
| UE patch pak（`_P.pak`） | 暂缓；`patches[]` 字段保留不用 |
| 边下边装 / 省空间 | 等文件级跑通、有真实更新数据再谈 |
| 安卓 `Saved/Paks` 快速路径 | 见第六章，等真机验证优先级 |
| 游戏内分片下载器 | 另一条线，本期不碰 |
| 安卓"导入/导出碎片"功能 | 现在是 zip 分片语义；本期先保持原样（不阻塞主流程），下一轮改成"按 files 导入目录" |
| 幻杀 / 火影接入 | ~~本期只做零境~~ → **火影已于 2026-09-22 接入**（`gameCatalog` 的 `runtime` 档位参数 + Rust `GameIdentity`），做法见 `PCLauncherDevelopmentGuide.md` 第 29 章；幻杀、白恋仍是占位页 |
| 前端下载源开关的 GitHub 分支 | 用户自己后续修，本次不动 |

---

## 九、开工顺序（下次对话从第 1 步开始）

| 步 | 做什么 | 完成标志 |
| --- | --- | --- |
| 1 | 只读 + 解析层：`gameCatalog` 配置、`latest.json` 读取、v1 类型与校验、单测（拿真清单当 fixture，不下载） | 单测绿：v1 能被解析、v2 被判"不受支持"、非法 path/sha256 被拒 |
| 2 | Rust `download_game_files` + `.part` + Range + sha256 + 进度事件 | 假下载站：下载 → 校验 → 改名成功；断网续传成功 |
| 3 | `scan_local_game_files`（bootstrap）+ `prune_game_files` + 写状态文件 | 空状态能起；改一个文件的 sha256 只下那一个；清单外文件按白名单被删 |
| 4 | 前端接上：进度文案、暂停/继续、错误码提示 | 界面上是"n/86 个文件 · x/y GB" |
| 5 | PC 真数据端到端（0.5.14 / 86 条） | 三条验收全过 |
| 6 | Android 移植（内核 → 原生下载器 → OBB 重组 → 装 APK） | 真机：首次安装能起、改一个 pak 只下那一个 |

**提交习惯**：改完一组就交给用户在 Rider 里提交，不代提交、不代推送。

**开工前提醒**：本仓库当前还有三处未提交改动（版本号显示、公告按钮悬停、单实例），先把它们提交掉再开新活，避免和本次改造混在一个 diff 里。
