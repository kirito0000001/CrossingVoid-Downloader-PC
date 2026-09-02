# 零境启动器 PC 制作、维护与发布指南

本文面向第一次接手项目的开发者或 AI。目标是只读取本文档、`README.md` 和仓库源码，就能理解启动器为什么这样设计、各层如何协作、如何验证与发布，以及哪些操作会导致用户重复下载、更新断链、OSS 流量失控或密钥泄露。

## 1. 项目边界

- PC 启动器源码：`D:\UnrealMap\CrossingVoidinitiator-PC`
- PC 源码 GitHub：`https://github.com/kirito0000001/CrossingVoid-Downloader-PC`
- PC 更新发布 Gitee：`https://gitee.com/xiaojie578/CrossingVoid-Downloader-PC`
- Android 启动器源码：`D:\UnrealMap\CrossingVoidinitiator-Android`
- Android 源码 GitHub：`https://github.com/kirito0000001/CrossingVoid-Downloader-Android`
- Android 更新发布 Gitee：`https://gitee.com/xiaojie578/CrossingVoid-Downloader-Android`
- 游戏资源 GitHub：`https://github.com/kirito0000001/CrossingVoid`
- 官网：`https://www.crossingvoid.top/`
- 更新 API：`https://www.crossingvoid.top/api/toolbox-updates`
- 线上更新服务器：`C:\Users\Administrator\Desktop\OSSAPI\ToolboxUpdateServer\app`

硬性规则：不要修改、编译、停止、清理或重新打包 `D:\UnrealMap\CrossingVoid` 虚幻项目。启动器可以读取用户指定的游戏打包目录，但不能为了启动器开发顺手改 Unreal 配置。

## 2. 产品职责

PC 启动器负责：

- 启动器自身更新，并且优先于游戏版本检查。
- 从 OSS 官方源或 GitHub 源查询、下载和安装 Windows 游戏。
- 记录下载来源、分片进度和安装阶段，支持暂停、继续、取消与进程重启恢复。
- 快速检查游戏文件、完整 SHA-256 校验以及缺失文件修复。
- 启动游戏、阻止重复启动、创建桌面快捷方式和安装 VC++ Runtime。
- 展示角色、公告、视频、下载状态、服务器可用流量和远程紧急公告。
- 在开发模式中构建/发布启动器，发布 Windows/Android 游戏包，并流式显示脚本阶段。

它不负责保存游戏制作数据，也不是 Unreal 工程管理器。构建缓存、安装包、游戏包和运行日志都不是源码。

## 3. 技术架构

技术栈：

```text
Vue 3 + TypeScript
Vite 6
Tauri 2
Rust
NSIS
Tauri updater
PowerShell 7 发布脚本
Vitest + Rust unit tests
```

### 3.1 Vue 层

关键文件：

```text
src/App.vue
src/components/LauncherSelect.vue
src/components/PlatformGameRail.vue
src/downloadStatePolicy.ts
src/downloadTimeEstimator.ts
src/githubRelease.ts
src/platform/gameCatalog.ts
src/platform/platformLauncher.ts
```

Vue 层负责界面、翻译、可见状态、操作编排和本地偏好。`App.vue` 目前较大，修改前应先用 `rg` 找到具体状态、计算属性和操作函数，避免凭界面文字直接改错分支。

平台导航的 seam 位于 `src/platform`：

- `gameCatalog.ts` 只保存稳定游戏 ID、顺序、名称、图标、启动品牌和背景资源路径。
- `platformLauncher.ts` 统一管理当前游戏、左侧详情折叠和 `localStorage` 恢复；调用方只使用 `selectGame / setDetailsCollapsed / toggleDetails`。
- `PlatformGameRail.vue` 只渲染目录并发出选择事件，不读取任何游戏业务状态。
- 零境是当前第一个已实现页面。其他游戏未接入前不得复制零境下载状态；第二个真实游戏接入后，再从实际差异提炼游戏下载、安装和更新 Adapter。

启动时必须先同步读取上次游戏 ID，使加载图标与首个页面一致。非零境页面只检查平台启动器自身更新，不得后台请求零境游戏版本、流量、代理或公告。

### 3.2 Rust 原生层

关键文件：

```text
src-tauri/src/lib.rs
src-tauri/src/main.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
```

Rust 层负责：

- Windows 文件系统、磁盘空间、进程和快捷方式。
- HTTP 请求、Range 下载、限速、暂停和取消。
- ZIP 合并、SHA-256 校验、解压和原子替换。
- 游戏完整性检查与修复。
- 开发脚本进程、阶段事件、暂停和日志。

不要在 Vue 中用临时 JavaScript 逻辑替代这些原生能力。涉及路径、进程、下载和安装的行为应留在 Rust，再通过 `invoke` 和 Tauri 事件连接 UI。

### 3.3 Vite 内容装配层

`vite.config.ts` 会读取 `OnSet`，在开发服务器中提供本地接口，并在正式构建时生成：

```text
OnSet/onset-manifest.json
```

角色图、公告图和本地视频会作为构建资源复制进包。不要把正在制作的内容放进 `dist` 再手工维护，源文件始终以 `OnSet` 为准。

### 3.4 PowerShell 发布层

`Scripts` 内脚本完成版本构建、签名、清单生成、Gitee Release、OSS 兼容、更新服务器同步、游戏包分片、远程公告和流量邮件告警。

脚本必须使用 UTF-8 输出，并通过一行 JSON 阶段事件向开发页报告进度。不要把整个脚本包成“处理中”一句话。

## 4. 目录说明

```text
Docs/                         现行指南、历史记录与专项设计
OnSet/                        角色、公告、视频和颜色源数据
public/launcher/              启动器固定视觉资源与字体
Scripts/                      构建、发布、公告和流量脚本
src/                          Vue/TypeScript 前端
src-tauri/                    Rust、Tauri 配置、图标和运行资源
tests/                        Vitest 回归测试
Logs/                         开发日志，不提交
Saved/                        版本选择、临时游戏包、发布中间状态，不提交
dist*/                        构建和发布中间产物，不提交
src-tauri/target/             Rust/Tauri 构建缓存，不提交
src-tauri/private/            更新签名私钥，不提交
```

`src-tauri/resources/VC_redist.x64.exe` 是例外：它是 Tauri bundle 声明的必需运行资源，应保留在源码仓库。它不是发布输出。

## 5. 本地环境与启动

需要：

- Windows 10/11 与 WebView2。
- Node.js、npm。
- Rust stable、Cargo 和 Tauri 2 所需的 MSVC 构建环境。
- 发布时使用 PowerShell 7，命令为 `pwsh`。
- 发布到 Gitee 时需要环境变量 Token。
- 同步 OSS/服务器时需要已配置的 `ossutil` 与 `ssh crossing-server`。

`src-tauri/.cargo/config.toml` 是本机网络配置，已被 Git 忽略。当前电脑可按需要配置 `http.proxy = "http://127.0.0.1:7897"`；其他开发者应使用自己的代理地址或不创建该文件，不能把个人代理设置提交为项目默认值。

首次安装：

```powershell
cd D:\UnrealMap\CrossingVoidinitiator-PC
npm.cmd install
```

启动 Tauri 开发版：

```powershell
npm.cmd run tauri dev
```

只启动 Vite：

```powershell
npm.cmd run dev
```

Vite 浏览器模式只适合布局检查。`invoke`、更新器、文件校验、游戏启动、NSIS 和开发发布必须使用 Tauri 开发版验证。

不要在用户正在发布或游戏正在打包时擅自关闭启动器、杀构建进程或操作 Unreal。

## 6. 版本来源

版本有三个不同概念：

1. `package.json` 与 `src-tauri/tauri.conf.json` 中的版本是源码回退值。
2. 开发页“设置启动器版本”写入 `Saved/Launcher/developer-version.json`，不会反复改动受 Vite 监视的源码配置。
3. 构建脚本读取开发版本，通过 `CV_LAUNCHER_VERSION` 和临时 Tauri 配置构建对应版本。

因此，开发页显示的待发布版本可能高于仓库配置中的回退版本，这是设计行为，不是版本没有生效。`Saved` 不提交，换机器后需要重新设置待发布版本。

版本要求：

- 使用 SemVer，例如 `1.0.13` 或允许的预发布格式。
- 新版本必须高于当前已发布版本。
- Tauri `latest.json` 的 `version`、安装包文件名、Release tag 和签名必须属于同一次构建。
- `pub_date` 与后端 `publishedAt` 必须是 RFC 3339/UTC 格式。

## 7. 启动顺序

正常启动应保持以下优先级：

```text
读取本地偏好与下载状态
-> 预加载关键图片和 OnSet 内容
-> 恢复磁盘下载状态
-> 检查启动器更新
-> 有启动器更新时停止游戏检查，先更新启动器
-> 无启动器更新时检查本地游戏
-> 查询远端游戏版本和服务器流量
-> 映射为下载、继续、安装、修复或启动状态
```

启动器更新必须优先。旧启动器可能不理解新的游戏清单，不能让游戏下载与启动器更新同时开始。

## 8. 主要状态机

Vue 的 `LauncherState`：

```text
ready
downloading
downloaded
installing
paused
checking
repairPending
repairing
```

修复子阶段：

```text
idle -> preparing -> downloading -> repairing -> verifying
```

启动器更新阶段：

```text
idle -> checking -> downloading -> installing -> restarting
                                             \-> failed
```

状态转换必须由实际文件和任务结果驱动，不能只根据按钮上次显示的文字推断。典型规则：

- 完整游戏不存在：显示“下载游戏”。
- 只有部分文件且有清单：显示“修复文件”。
- 下载完成但未安装：显示安装阶段。
- 游戏文件被用户在外部还原：窗口重新获得焦点时重新检查，并恢复为可启动。
- 游戏被外部删除：先快速检测，不要长时间等待进程启动超时。

## 9. 偏好与下载状态持久化

普通偏好使用 WebView `localStorage`，键名集中在 `App.vue`：

```text
crossing-void.launcher.language
crossing-void.launcher.download-state
crossing-void.launcher.download-source
crossing-void.launcher.offline-mode
crossing-void.launcher.download-limited
crossing-void.launcher.speed-limit
crossing-void.launcher.use-dx11
crossing-void.launcher.close-to-tray
crossing-void.launcher.auto-repair
crossing-void.launcher.hide-after-game-launch
```

下载任务同时写入：

```text
<游戏安装目录>\_download\download-state.json
```

磁盘状态采用临时文件加原子替换。双份状态的目的：WebView 数据丢失或安装目录变化后，仍可从游戏目录恢复任务。

恢复时不能让旧的“已安装”状态覆盖更重要的新任务。优先保留：

- 正在更新。
- 正在修复。
- 已有部分下载。
- 已下载但尚未安装。

下载来源单独持久化。没有活动任务时也必须记住用户选择的 OSS 或 GitHub 源。

## 10. 启动器热更新

Tauri 更新端点：

```text
https://www.crossingvoid.top/api/toolbox-updates/tauri/crossingvoid-launcher-pc/windows/x86_64/{{current_version}}
```

仓库职责必须分开：

- GitHub `CrossingVoid-Downloader-PC`：源码。
- `crossingvoid.top`：PC 启动器版本检查与 Tauri 更新清单。
- Gitee `CrossingVoid-Downloader-PC`：历史发布资产；客户端不得再读取其 Raw 文件。
- Gitee Android 仓库：Android 启动器，不得混回 PC 仓库。

更新流程：

```text
check()
-> 提示发现版本
-> Tauri 下载并报告 DownloadEvent
-> 校验 minisign/rsign 签名
-> NSIS passive 安装
-> relaunch()
```

`src-tauri/tauri.conf.json` 中的 updater `pubkey` 是公开验证材料，可以提交。`src-tauri/private/updater.key` 是签名私钥，永远不能提交、上传日志或粘贴到文档。

## 11. 游戏版本与下载来源

### 11.1 OSS 官方源

基础 API：

```text
https://www.crossingvoid.top/api/toolbox-updates
```

Windows 产品：

```text
productKey = crossingvoid-game
runtime = Windows
```

客户端从后端读取版本和分片，并为 OSS 对象请求短时签名 URL。客户端不能保存 OSS AccessKey。

### 11.2 GitHub 源

游戏仓库：

```text
kirito0000001/CrossingVoid
```

PC Release 使用 `PC-` 标签前缀，优先读取 `CrossingVoid-PC-update.json`，兼容读取旧 `update.json`。资产下载使用 GitHub Releases Asset API，避免网页下载地址被网络环境拦截。

GitHub 源提示“需要魔法”。PC 游戏和 Android 游戏必须使用平台专属清单与文件名，不能再依赖含糊的通用包名。

## 12. 游戏下载与恢复

`download_game_archive` 支持：

- 单包和分片清单。
- HTTP Range 续传。
- 已完成分片复用。
- SHA-256 校验。
- 速度限制。
- 暂停和取消。
- 实时 `download-progress` 事件。

当前发布规则中，Windows 包使用大分片，Android 使用 100 MiB 分片。PC 客户端仍应按清单工作，不应把分片数量或固定大小写死。

暂停和取消不是同一个产品语义：

- 暂停保留已验证数据和状态，下次继续。
- 取消停止任务，并按用户意图清理当前任务状态。
- 校验、合并、解压不适合暂停；可以取消并从可恢复阶段重新进入。

下载栏要显示：操作阶段、来源、已下载/总大小、百分比、速率和预计时间。预计时间立即计算；超过 24 小时显示“网络不佳”。按钮图标本身不能随着任务加载动画一起旋转。

## 13. 安装、解压与原子替换

标准流程：

```text
下载分片
-> 校验每片
-> 合并归档
-> 校验完整归档
-> 解压到 staging
-> 验证关键文件和清单
-> 原子替换正式游戏目录
-> 写入 ready 状态
```

不要直接把 ZIP 解压覆盖正在使用的正式目录。中断时直接覆盖会留下“看起来安装过但文件不完整”的状态。临时文件写入后再替换，下载状态 JSON 也使用同样原则。

## 14. 完整性检查与修复

两种检查不能混为一谈：

- `check_game_manifest_files`：快速检查，用于启动前判断缺失/明显异常。
- `verify_game_manifest`：完整读取并计算 SHA-256，用于用户主动验证和修复完成后的确认。

用户点击“验证游戏完整性”时：

- 完全没有游戏：切换到“下载游戏”。
- 有部分游戏和有效清单：进入“修复文件”。
- 文件完整：恢复 `ready`，清除陈旧下载上下文。

`repair_game_from_archive` 只修复清单判定的缺失或无效文件。修复后必须再次完整验证，再写 `ready`。不能只因为修复函数返回成功就允许启动。

## 15. 游戏启动与本地管理

启动前顺序：

```text
确认游戏关键文件存在
-> 必要时刷新远端版本
-> 按设置执行自动快速修复检查
-> 检查游戏是否已运行
-> 使用普通或 DX11 参数启动
```

关键命令：

```text
validate_game_install_state
read_game_version_file
is_game_running
launch_game
create_game_desktop_shortcut_now
install_vc_redist
delete_installed_game
uninstall_launcher
```

游戏缺失时要尽快提示“检查完整性”，不能先等待一个注定失败的长启动流程。窗口重新获得焦点后应检查外部文件变化，例如用户手工还原或删除游戏。

## 16. 服务器流量保护

流量接口：

```text
GET https://www.crossingvoid.top/api/toolbox-updates/traffic-status
```

UI 展示“服务器可用下载流量”，按所有可用流量包汇总。低于 3 GB 时：

- OSS 官方源显示红色不足提示。
- 官方源下载暂停或禁止开始。
- 提示用户切换 GitHub 源。
- 选择 GitHub 源时隐藏 OSS 流量卡和外部不足提示。

真正的安全边界在服务器：低流量时不签发 OSS 下载地址。客户端限制只能改善体验，不能替代服务器拒签。

`TrafficQuotaAlert.ps1` 与 `Install-TrafficQuotaAlert.ps1` 在服务器上每 5 分钟检查一次状态，并复用 Watchdog 邮件配置发送不足/恢复邮件。凭据文件只在服务器，不进入本仓库。

## 17. OnSet 内容

目录：

```text
OnSet/Character/Char*/character.json + 图片
OnSet/NoticeBoard/notice.json + 图片
OnSet/Video/*.json + 可选本地视频
OnSet/Color.json（存在时）
```

开发模式通过 Vite 中间件即时读取；正式构建由 `onsetBundlePlugin` 复制资源并生成清单。编辑规则：

- JSON 使用 UTF-8。
- 图片、视频和 JSON 都保存在项目中，不能引用只有本机才存在的临时路径。
- 角色目录按自然顺序读取。
- 远程内容失败时保留内置回退，不能让首页变空。

## 18. 设置页与交互约束

设置页顺序：偏好设置、下载设置、游戏设置、关于启动器；开发页只在 `import.meta.env.DEV` 时出现。

必须保留的交互规则：

- 无边框窗口的拖动只从明确拖动区开始。
- 右键菜单在次级页面和弹窗内仍应正常弹出，不能把右键当成统一返回键。
- 页面切换使用轻量动效，不要在切换时重新创建昂贵媒体资源。
- 设置页使用内部滚动，底部留出可滚动空间，不能靠扩大布局把内容戳出窗口。
- 下载进度悬浮栏只在需要进度时出现，并跨页面持续显示。
- 熟悉操作使用 Lucide 图标和 tooltip，固定控件尺寸，避免状态文本使布局跳动。

## 19. 开发模式

开发页功能：

- 设置下一次启动器版本。
- 构建启动器安装包。
- 发布启动器到 Gitee，并同步 OSS/服务器兼容清单。
- 上传 Windows/Android 正式服游戏包。
- 上传 Windows/Android 测试服游戏包。
- 暂停可暂停的上传脚本。
- 发布或关闭远程公告。
- 打开项目目录与日志目录。

原生层只在 debug 构建开放这些命令。Release 中调用应返回“开发工具仅在调试模式可用”。

脚本通过标准输出发送：

```json
{"stage":"upload","percent":75,"message":"上传安装包到 Gitee"}
```

Rust 逐行读取 stdout/stderr，解析阶段后发出 `dev-script-progress`，结束时发出 `dev-script-finished`。原始输出同时写入日志。乱码通常来自 Windows PowerShell 编码，因此发布脚本必须设置 UTF-8 和 PlainText 输出；优先运行 `pwsh`。

## 20. 启动器构建与发布

### 20.1 仅构建

```powershell
pwsh -NoProfile -File .\Scripts\Build-LauncherUpdaterPackage.ps1
```

职责：

1. 读取 `Saved/Launcher/developer-version.json`。
2. 检查版本与私钥。
3. 设置临时 Tauri 版本和签名环境。
4. 构建 NSIS 安装包。
5. 收集或补签 `.sig`。
6. 生成 Tauri `latest.json` 和后端 `update.json`。
7. 输出到 `D:\启动器新包`，中间产物位于 `dist-launcher-update`。

`bundle.createUpdaterArtifacts` 必须保持为 `true`。否则只有安装包，没有 Tauri 更新签名。

### 20.2 发布到 Gitee

```powershell
pwsh -NoProfile -File .\Scripts\Publish-LauncherGiteePackage.ps1
```

Token 只从参数或以下环境变量读取：

```text
FANTASYTOOLS_GITEE_TOKEN
GITEE_TOKEN
GITEE_ACCESS_TOKEN
```

职责：创建/更新 `launcher-v<版本>` Release、上传安装包、写入仓库 `launcher/latest.json`，然后调用 OSS/服务器兼容发布。

支持：

```text
-SkipBuild
-InstallerPath
-ManifestPath
-DryRun
```

发布前必须校正 RFC 3339 时间。Gitee 返回 HTTP 错误时要输出响应正文，不能只显示“上传失败”。

### 20.3 OSS 与服务器兼容

`Publish-LauncherUpdaterPackage.ps1` 负责：

- 将 PC 安装包上传到 OSS 的 PC 前缀。
- 同步 `crossingvoid-launcher` 与 `crossingvoid-launcher-pc` 服务器清单。
- 保持旧 PC 客户端所需的兼容索引。
- 新版激活后删除旧启动器安装对象，避免持续占用储存。
- 不写入或覆盖 Android 产品清单。

发布脚本中的旧包删除是明确产品策略：只保留可下载的当前版本；测试版本使用独立通道，不用正式服旧版本承担测试。

## 21. 游戏包发布

入口：

```powershell
pwsh -NoProfile -File .\Scripts\Publish-GamePackage.ps1 `
  -Platform Windows `
  -Channel Stable `
  -GameDirectory 'D:\DabaoV\Client\Windows' `
  -ReleaseVersion 'V0.5.12' `
  -ReleaseTitle '零境交错：空界幻境更新包'
```

支持平台 `Windows`/`Android`，通道 `Stable`/`Test`。正式服与测试服使用独立 productKey、Release 和服务器清单。

Windows 输入目录应是最终可运行的打包目录。发布脚本负责排除 debug 和不需要的文件、生成版本文件与逐文件 SHA-256 清单、压缩、分片，并上传 OSS 与 GitHub。它只能读取打包产物，不应调用或修改 Unreal。

同一通道发布新版本后，旧包应立即不可下载并删除，避免储存持续增长。测试服允许额外保留一份独立版本用于验证发布流程。

## 22. 远程公告

远程公告地址：

```text
https://www.crossingvoid.top/launcher-notice.json
```

字段：`schemaVersion`、`id`、`enabled`、`level`、`title`、`content`、`publishedAt`。`level` 只能是 `info`、`warning`、`error`。

`Publish-LauncherRemoteNotice.ps1` 使用 SCP 上传临时文件，再用 `ssh crossing-server` 和 EncodedCommand 原子替换 IIS 文件。修改远程文件前保留 `.bak`。普通操作提示不属于远程公告；远程公告用于启动器更新故障、服务器中断等无法依赖新客户端发布来通知玩家的情况。

## 23. 安全与 Git 边界

绝不能提交：

```text
src-tauri/private/
任何 updater 私钥
Gitee/GitHub Token
OSS AccessKey
SMTP 密码或凭据文件
.env*
Logs/
Saved/
dist*/
src-tauri/target/
安装包、签名、ZIP、游戏包
```

可以提交：

```text
src-tauri/tauri.conf.json 中的 updater 公钥
src-tauri/resources/VC_redist.x64.exe
OnSet 中实际随启动器发布的内容
源码、测试、脚本和文档
```

提交前检查：

```powershell
git status --short
git diff --cached --check
git ls-files | rg 'private|Saved|Logs|target|dist-launcher|\.sig$'
git ls-files | ForEach-Object { Get-Item -LiteralPath $_ } |
  Sort-Object Length -Descending |
  Select-Object -First 20 FullName,Length
```

不要把环境变量值打印进日志。检查凭据时只显示变量是否存在，不显示内容。

## 24. 测试与完成标准

每次交付前至少运行：

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri\Cargo.toml
```

高风险修改还应做对应实测：

- 更新器：从旧安装版检测、下载、签名校验、安装、重启。
- 下载：暂停、恢复、切源、断网、重启应用和已完成分片复用。
- 完整性：完整游戏、缺少一个文件、完全没有游戏、外部还原游戏。
- 发布：`-DryRun`、正式发布、清单 URL、Release 资产和旧包删除。
- UI：1200x675 窗口，设置页滚动、弹窗、右键菜单和进度悬浮栏。

“代码编译”不等于“更新链路可用”。发布任务必须额外验证远端 `latest.json` 可访问、日期可解析、URL 能下载、签名与安装包匹配。

## 25. 常见故障

### 更新能检测但安装失败

检查：`latest.json` URL、`windows-x86_64` 键、签名、安装包是否属于同一构建、`pub_date` 是否 RFC 3339、NSIS 是否仍在 Release 中。

### Gitee 检测很久后静默失败

不要依赖网页 Release 下载页。启动器自身用固定 raw 清单；游戏 GitHub 资产用 Releases Asset API。捕获并显示实际 HTTP 状态和响应正文。

### 已有游戏却显示下载

检查安装路径、本地 `CrossingVoid.version.json`、`_download/download-state.json`、窗口焦点恢复检查，以及旧下载状态是否错误覆盖完整安装。

### 删除游戏后启动按钮卡很久

启动进程前先检查关键 exe 和清单。缺失时立即标记为下载/修复，不要等待 Windows 进程错误超时。

### 下载闪回或重新开始

检查磁盘状态是否原子写入、分片哈希是否复用、来源切换是否只换 URL，以及取消标志是否在新任务开始前重置。

### 发布页乱码

使用 PowerShell 7，设置 `$OutputEncoding`、`[Console]::OutputEncoding` 为 UTF-8，并设置 `$PSStyle.OutputRendering = 'PlainText'`。Rust 按行读取原始字节后再解析 JSON 进度。

### Vite 开发版被构建产物影响

`vite.config.ts` 已忽略 `src-tauri`、`dist*`、`Logs` 和 `Saved`。不要删除这些忽略项，否则打包时文件锁可能触发 HMR 重载，让窗口停在旧页面。

## 26. 制作心得与设计原则

1. **状态必须来自文件事实。** “上一次显示可启动”不能证明游戏还存在；“上一次显示下载”也不能覆盖用户刚还原的完整文件。
2. **大任务要可恢复。** 下载昂贵且耗时，状态和已校验分片必须落盘。暂停、崩溃、断网和重启都不应从零开始。
3. **清单比猜目录可靠。** 发布时生成逐文件哈希；运行时按清单检查。不要靠文件数量或几个固定名称推断整个游戏完整。
4. **更新链路必须分层。** 启动器 Gitee 更新、游戏 OSS/GitHub 下载、服务器产品清单各有职责。混用仓库会让 PC/Android 相互覆盖。
5. **客户端限制不是安全边界。** 3 GB 提示可以被旧客户端绕过，必须由服务器拒绝签名下载 URL。
6. **发布脚本也是产品功能。** 阶段、百分比、当前分片、错误正文和可暂停状态都要传给 UI，发布者不应盯着一句“处理中”。
7. **密钥与源码完全分离。** 私钥丢失会断更，泄漏会失去发布信任；只保存在本机受控位置和环境变量中。
8. **原子写入优先。** 清单、下载状态和安装目录都先写临时位置，再替换正式文件，避免半成品被识别成成功。
9. **昂贵检查分级。** 启动前使用快速检查，用户主动验证或修复完成后使用完整 SHA-256，兼顾手感和可靠性。
10. **UI 动效不能改变行为。** 加载动画、页面过渡和按钮旋转只负责表现，不能改变按钮点击区域、状态判断或暂停/取消语义。
11. **开发缓存不是制作数据。** `Saved` 和 `dist*` 可以重建；`OnSet`、源码、脚本和文档才是项目事实。
12. **先复现再修复。** 对下载、更新、安装问题先记录来源、版本、阶段、URL 类型和本地状态，再修改最小责任层。

## 27. 新接手检查表

1. 阅读根目录 `AGENTS.md` 和本文。
2. 确认只操作 PC 启动器目录，不操作 Unreal。
3. 运行 `git status -sb`，保留用户已有改动。
4. 查看 `src/App.vue` 的状态和目标操作函数。
5. 查看 `src-tauri/src/lib.rs` 对应 Tauri command，不要只改 UI。
6. 查看相关 `tests/*.test.ts` 与 Rust 单元测试。
7. 若涉及发布，先确认 PC Gitee 仓库、产品键、版本和通道。
8. 若涉及下载，测试 OSS/GitHub、暂停恢复和切源。
9. 若涉及文件状态，测试完整、部分缺失、完全删除和外部还原。
10. 完成后运行三组基础验证，并记录实际输出。
11. 提交前检查敏感信息、大文件和忽略目录。
12. 发布后从远端重新读取清单并验证真实下载 URL。

## 28. 当前基线提示

编写本文时：

- 游戏默认发布版本为 `V0.5.12`。
- 本机开发版本文件为 `1.0.13`，但该文件位于 `Saved`，不属于源码基线。
- 源码配置中的回退版本仍可能较低，正式包版本由构建脚本注入。
- PC/Android 的 Gitee 发布仓库已经拆分，禁止重新合并。

这些值会随发布变化。接手时应以本机开发版本、Gitee 最新清单、服务器产品清单和实际 Release 为准，不要仅凭本文中的快照决定发布版本。
