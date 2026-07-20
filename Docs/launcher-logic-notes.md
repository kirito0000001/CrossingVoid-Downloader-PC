# 启动器内部逻辑编写要点（历史记录）

> 本文档保留早期设计、界面比例与逐次修改记录，部分仓库地址、版本号和实现建议已经过期。新接手者必须先读 `Docs/PCLauncherDevelopmentGuide.md`；当本文与现行指南或源码冲突时，以现行指南和经过测试的源码为准。不要根据本文中的旧地址回退当前 PC/Android 仓库拆分。

本文档用于整理当前启动器原型的内部逻辑、已有实现，以及后续对照鸣潮启动器可继续推进的方向。

## 1. 当前状态

### 1.1 界面层

- 采用 Tauri + Vue 3 + TypeScript。
- 目前是固定布局，不再依赖整体缩放去“凑比例”。
- 左侧栏支持收起/展开。
- 右上角设置、最小化、关闭已接入实际窗口行为。
- 底部主操作区已实装为可点击状态机。

### 1.2 交互层

- 左侧新闻区使用标签切换。
- 右侧主按钮根据状态切换文案和图标。
- 设置弹窗已存在，当前以占位配置为主。
- 菜单按钮可展开工具菜单。

### 1.3 状态层

当前主要状态可以分成几类：

- 启动状态：`ready / downloading / paused / checking`
- 界面状态：左栏收起、设置弹窗、工具菜单
- 配置状态：安装路径、自动修复、高速下载
- 展示状态：进度值、新闻标签、资源占位数据

## 2. 逻辑拆分建议

后续实现尽量把逻辑拆成四层：

### 2.1 UI 展示层

只负责按钮、布局、动画、弹窗、列表渲染。

### 2.2 业务状态层

负责：

- 当前下载状态
- 当前账号信息
- 当前版本信息
- 当前公告/活动数据
- 当前设置项

### 2.3 平台能力层

负责调用 Tauri 能力，例如：

- 最小化
- 关闭
- 打开外部链接
- 选择目录
- 读写本地配置
- 启动游戏进程

### 2.4 数据来源层

负责接入：

- 本地配置文件
- 远端公告接口
- 版本信息接口
- 资源清单接口
- 账号数据接口

## 3. 对照鸣潮启动器的后续方向

下面这些方向适合按优先级逐步补齐。

### 3.1 第一阶段：把“看起来像”变成“能跑起来”

- 主按钮真正接入启动游戏进程。
- 下载状态改成真实任务，不再只是演示进度。
- 修复资源按钮接入校验流程。
- 安装目录可保存并下次自动读取。
- 最小化、关闭、菜单状态稳定可用。

### 3.2 第二阶段：补齐启动器核心数据

- 登录账号信息展示。
- 角色/联觉等级/资源数据改为真实读取。
- 服务器状态或区服信息展示。
- 版本号、补丁号、公告更新时间展示。
- 新闻/活动/公告从本地占位改为远端拉取。

### 3.3 第三阶段：补齐鸣潮式启动器体验

- 资源修复、完整性校验、分包下载。
- 断点续传与失败重试。
- 下载限速、后台静默下载，以及真实 CDN 下载源策略。
- 多入口跳转：官网、社区、客服、福利、活动页。
- 设置页扩展到更完整的启动器设置。

### 3.4 第四阶段：提高可维护性

- 把页面逻辑拆成组件。
- 把状态集中到独立 store。
- 把下载、校验、启动、配置读写分成独立模块。
- 把占位数据源和真实接口分层，方便替换。

## 4. 当前实现里最值得继续收口的地方

- 主按钮状态机现在是演示型，后面要换成真实任务流。
- 左侧资源数据现在是静态占位，后面要抽成数据源。
- 新闻列表现在是内置数组，后面要拆成接口或本地缓存。
- 设置项现在只做了表面，后面要落到本地配置文件。
- 弹窗和菜单交互目前足够用，但后面需要统一关闭策略。

## 5. 推荐实现顺序

1. 先把本地配置读写做完。
2. 再把主按钮接到真实启动流程。
3. 再补资源校验和下载任务。
4. 再接公告与账号数据。
5. 最后整理组件拆分和状态管理。

## 6. 备注

- 现在的重点不是再调视觉，而是把数据、状态、任务三者对齐。
- 视觉层可以继续保持固定尺寸，后续所有新功能都尽量按这个框架塞进去。
- 主视觉标题当前为 `零境交错:空界幻境`；外层 `.right-launcher` 不动，标题区 `.hero-copy` 自身使用 `width: 430px` 并以 `right: 0` 作为右锚点，让加长标题向左扩展、在标题区内右对齐换行。最终回到纯 `--cv-accent-title` 标题色，不再叠双层渐变；双层覆盖在复杂背景上容易让笔画发花。
- 标题区当前无进度状态使用 `bottom: 94px`；显示下载进度时 `.hero-copy.raised` 使用 `translateY(-42px)`，时长 `180ms`，和进度区出现动效保持同一节奏。
- 标题下方说明行 `.collab-line` 使用 `11.5px`，约等于早期 `10px` 的 `1.15` 倍；这行字可以略大于普通状态字，但不要抢过主标题。
- 标题下方说明行当前结构为 `Crossing Void`、中间短线、`illusion Dreamland`；文字和短线统一使用设置页标题计算色 `--cv-accent-title` 的 `80%` 透明度，短线用 `currentColor` 继承，避免单独硬编码跑色。
- 数字型状态文本优先使用 `UnispaceCV`（来源：`public/launcher/unispace_bd.ttf`），例如下载体积、百分比、特征码等；中文标签继续使用默认 UI 字体或标题字体。
- 下载体积显示格式优先写成 `5.2/423.9 MB`：数字整体使用 `UnispaceCV`，单位 `MB` 单独作为子元素放在后面，用 CSS `gap` 控制一点间隙，不把单位重复写到每个数值后面。下载百分比颜色复用 `--cv-accent-title`，和主标题/设置页标题保持一致。
- 左侧资讯卡当前三项选择为 `角色 / 公告 / 视频`，默认选中 `角色`；选择区是靠左竖排按钮，不是图片下方横排 tab。当前 `.promo-panel` 未缩放高度为 `286px`，左侧整体有 `scale(0.75)`，视觉高度约 `214.5px`。竖向选择栏贯穿头图和列表整张卡，右侧上方是头图、下方是列表；`.tab-row` 使用 `repeat(3, 1fr)` 做竖向填充，三个按钮等高均匀分布，选中态用左侧竖线表达。注意间隙放在左侧按钮文字和右侧分割线之间：`.tab-row` 右内边距为 `10px`，不要用 `.promo-panel column-gap` 把整个右侧内容推开。该区域统一使用 `--cv-panel-accent` 系列颜色，尽量贴近当前确认过的浅金色。
- 角色板块头图使用 `public/launcher/character-banners/character-banner-01.png` 到 `character-banner-06.png` 六张本地资源，原图统一为 `2048 x 747`，CSS 使用 `aspect-ratio: 2048 / 747` 适配；轮播间隔为 `3000ms`，切换使用 `banner-fade` 做 `280ms` 淡入淡出。鼠标悬停在右侧角色内容区，也就是头图或角色介绍区域时停止轮播，离开后继续。
- `角色` 分类下方内容跟随当前轮播头图显示，数据来自 `characterProfiles` 六条内容。角色详情模板为：第一行角色名大标题、第二行作品名副标题、下面直接显示双列短标签，不再显示 `角色定位` 四个字。当前 `01` 为 `亚丝娜【SAO】 / 刀剑神域 / 物理副C、前排攻击、追击、低耗费`；`02-06` 仍是占位。`公告` 和 `视频` 分类仍使用普通列表。
- 制作期可用 `OnSet/Character` 动态覆盖角色数据：每个子文件夹代表一个角色，建议使用 `Char1`、`Char2` 这类纯英文/数字目录名；每个目录至少包含 `banner.png` 和 `character.json`，JSON 字段为 `name`、`work`、`tags`。开发服务器提供 `/__cv_onset_characters` 读取这些文件夹，前端仅在 `import.meta.env.DEV` 时请求；生产打包后不会读取 `OnSet`，会回退到内置静态角色数据，因此用户包不可通过改 `OnSet` 修改角色板块。
- 制作期公告板块可用 `OnSet/NoticeBoard` 动态覆盖：目录下放一张头图（支持 `png/jpg/jpeg/webp`）和 `notice.json`。`notice.json` 字段为 `title`、`subtitle`、`sections`，其中 `sections` 是三大板块列表，当前标题为 `新增内容`、`部分优化`、`问题修复`。开发服务器提供 `/__cv_onset_notice_board` 读取；前端只在开发环境请求，生产包回退内置公告数据。
- 制作期视频板块可用 `OnSet/Video` 动态覆盖：每个视频一份 JSON，字段为 `title`、`date`、`video`。`video` 可以写外部 B 站页面链接、外部直链，也可以写同目录本地视频文件名，例如 `demo.mp4`。B 站链接会提取 BV 号改用 `player.bilibili.com` iframe 播放；直链/本地文件用 `<video>` 静音自动播放。进入视频分类时默认选中第一条视频；点击标题才切换播放项，鼠标移开后保留当前视频不停止。悬停标题只做主题色 hover。
- 视频分类不拉高整张 `.promo-panel`，仍保持未缩放 `286px`；只把头图/视频区域改为 `16:9` 并固定 `height: 185px`，相当于占用下方视频选项空间。没有可播放视频时显示 `public/launcher/video-fallback.png`。视频列表在剩余区域内滚动，当前 `max-height: 101px`，栏位 `min-height: 38px`。
- `OnSet` 下的图片和视频不是 Vite 默认静态目录，所以开发服务器额外提供 `/OnSet/...` 资源服务；图片允许 `png/jpg/jpeg/webp`，视频允许 `mp4/webm/ogg`。如果修改了 `vite.config.ts` 或刚新增接口后资源未生效，需要重启 dev 服务让中间件生效。
- 公告分类右侧下方使用 `.notice-board` 可滚动内容区，当前固定高度为 `170px`，滚动条使用 `--cv-panel-accent-soft`；公告头图复用右侧头图区域。
- 公告区字号当前为：公告标题 `19px`、公告副标题/日期 `13px`、板块标题 `15px`、条目正文 `13px`。公告标题、板块标题、项目点、滚动条和视频列表 hover 都走 `--cv-panel-accent` 系列计算色。
- 角色详情当前字号和间隔：角色名 `.character-profile h3` 使用 `24px`，下方留 `7px`；作品名称 `.character-profile p` 使用 `18px`，下方留 `14px` 到标签区。作品名比标签明显大，但弱于角色名。
- 角色定位标签采用双列网格；当前标签高度在早期 `padding: 7px 6px` 基础上继续加高到 `padding: 8px 6px`，网格间隔为 `8px 10px`，用于尽量填满角色卡下方空间。
- 主界面外部下载进度条不要复用设置页标题色。它单独使用 `--cv-download-progress-start/end/border/glow` 派生变量，目标效果接近原本的亮黄到浅奶黄（约 `#ffd94d -> #fff0a6`）；这样仍然跟主题强调色联动，但不会被设置页标题色拉暗。
- 下载/安装/版本检测进行中进度条的滚动光效放在 `.progress-fill::after` 上实现，用斜切渐变条从左扫到右；`versionCheckPending`、`launcherState === "downloading"` 或 `"installing"` 时给 `.progress-fill.active` 启用动画，暂停、完成状态不显示动态扫光，避免状态误导。
- 版本检测复用右下状态区域，但属于纯状态提示：启动器打开后如果游戏已安装且未开启单机模式，会自动查询远程版本，右下主按钮显示“检测版本中”并禁用；检测到新版本时状态显示“发现新版本 Vx.x.x”，主按钮显示“下载更新”。检测中和发现新版本后都不显示下载 MB、百分比和进度条，下载、安装、完整性验证才显示进度条和百分比。
- 左下角“游戏版本号”显示只依赖本地 `CrossingVoid.version.json`，不应该依赖远程版本检测是否执行。启动器恢复下载/更新断点后，即使当前状态是 `paused`、`downloading` 或 `downloaded`，也要先读取一次本地版本文件；远程检测只负责判断是否有新版本。
- 版本检测和完整性验证通常很快，完成后需要保留一条短暂结果提示（约 5 秒），例如“版本检测完成：本地 Vx / 远程 Vy，版本已是最新”或“完整性验证完成：34/34，异常 0”，同时写入 console，便于确认流程确实执行过。
- 正方形工具菜单内的“单机模式游玩”是持久化开关，使用 `crossing-void.launcher.offline-mode`。开启后跳过启动时自动版本检测，也禁用手动“重新检测更新”；如果已经检测到新版本或正处于更新暂停/下载中，只要本地存在游戏版本文件，开启单机模式就用临时覆盖层把主按钮切到“启动游戏”，隐藏下载进度，但不清除真实断点。取消单机模式后恢复原来的继续下载/下载更新状态。
- “验证游戏完整性”后续接入时必须先执行版本检测：只有远程版本与本地版本一致，或用户显式开启单机模式，才进入当前版本的文件校验，避免明知有新版本还浪费时间验证旧包。
- “验证游戏完整性”当前实现为：先执行版本检测；如果发现新版本则停在更新提示，不验证旧版本；如果无需更新或开启了单机模式，先读取本地 `CrossingVoid.manifest.json` 并逐文件校验大小与 SHA256。所有文件都正确时不下载 ZIP，只安装/确认 VC++ 运行库后结束；如果发现缺失或 hash 不一致，先停在 `repairPending` 待补齐状态，不自动下载。此时右下状态显示“游戏文件缺失”、`当前文件数/清单文件数` 和缺失数量，进度条与主按钮使用红色警告样式，主按钮显示“补齐文件”。只有用户点击“补齐文件”后才进入 `repairing`，准备 `_download/CrossingVoid.zip`，必要时重新下载当前版本 ZIP，再从 ZIP 中补写坏文件。修复完成后安装 VC++ 运行库。
- 完整性验证只允许在本地游戏已安装、且没有未完成下载/更新/安装任务时点击。`paused + downloadedBytes > 0`、`downloading`、`downloaded`、`installing` 和 `updateDownloadPending` 都要禁用“验证游戏完整性”，避免一边下载 ZIP 一边校验旧目录。
- 验证完整性不能复用下载进度。Rust 侧通过 `game-repair-progress` 发独立检查进度，字段包括 `checkedFiles / totalFiles / repairedFiles / percent`；前端在 `launcherState === "checking"` 时显示检查进度和 `checked/total`，不显示下载包 MB。检查中主按钮和菜单禁用，右下按钮圆环旋转。
- 后续省流量方向先记录：当前仍是单大 ZIP 修复，所以“坏哪个文件”也需要拿到完整 ZIP 才能补。以后可以升级到文件级/分块级资源包：发布时按文件或 UE pak/chunk 生成独立对象和哈希，启动器只下载缺失/损坏文件或对应 chunk，减少更新与修复流量。
- 发布脚本应在打包时生成 `CrossingVoid.manifest.json`，用于后续严格完整性验证。清单记录每个包内文件的相对路径、大小和 SHA256；验证时优先用清单逐文件比对，缺失或 hash 不一致的文件再从 ZIP 或后续文件级资源包补齐。
- VC++ 运行库 `VC_redist.x64.exe` 放入 `src-tauri/resources` 并配置到 Tauri bundle resources。安装游戏最后、以及完整性验证补文件之后，都会调用静默安装：`/install /quiet /norestart`。优先使用启动器资源内置的运行库，找不到时兜底使用游戏目录里的 `Engine/Extras/Redist/en-us/vc_redist.x64.exe`。
- “浏览本地文件”直接打开当前 `installPath`，也就是游戏 exe 所在的安装目录。Windows 下不要依赖前端 opener 插件打开目录，改由 Rust 命令调用 `explorer.exe <installPath>`，避免目录打开无反应。
- 桌面快捷方式是游戏快捷方式，不是启动器快捷方式。安装完成并勾选“桌面快捷方式”时，快捷方式目标必须是 `<installPath>\CrossingVoid.exe`，工作目录是 `<installPath>`，图标也优先使用游戏 exe。
- 主按钮在 `ready` 或单机模式可玩时调用 Rust `launch_game` 启动 `<installPath>\CrossingVoid.exe`，工作目录设为 `installPath`。正方形菜单里的“使用DX11启动”使用 `crossing-void.launcher.use-dx11` 持久化；勾选后启动时追加 Unreal 常用参数 `-d3d11`，未勾选则不追加参数，走游戏默认渲染后端。默认勾选“退出游戏后不弹出启动器”时，启动成功后 Rust 直接退出启动器进程，不再只是隐藏窗口；如果关闭该选项，则仍保留隐藏窗口并监听 `game-process-exited`，游戏退出后 `show()` 并 `setFocus()` 把启动器带回前台。
- 启动游戏前会用 Rust `is_game_running` 检测 `CrossingVoid.exe` 是否已存在，避免重复拉起多个游戏进程；前端同时用 5 秒轮询刷新“游戏运行中”状态。启动时按钮进入 `gameLaunchPending`，显示“启动中”并禁用主按钮、菜单验证/检测更新/DX11 切换。Rust `launch_game` 拉起进程后等待 5 秒做健康检查，如果游戏秒退，会返回 `GAME_EXITED_EARLY:<code>`，前端留在启动器并提示“游戏启动后异常退出”，建议验证完整性、运行库或显卡驱动。DX11 模式目前追加 `-d3d11` 和 `-dx11` 两个常见 Unreal 启动参数。
- 如果本地游戏已安装并处于可启动状态，点击启动前会检查版本检测结果是否超过 10 分钟；过期时先快速调用一次版本检测，避免长时间打开启动器后仍以旧状态启动。单机模式会跳过这个检查，保留旧版本单机游玩的能力。
- 偏好设置里的“关闭启动器窗口”使用 `crossing-void.launcher.close-to-tray` 持久化。选择“退出启动器”时，右上角关闭按钮调用 Rust `exit_launcher` 直接退出进程；选择“最小化到系统托盘”时，关闭按钮只隐藏主窗口。Rust 启动时创建一个常驻托盘图标，左键单击或双击托盘图标会 `show()`、`unminimize()`、`set_focus()` 恢复启动器窗口。
- 左侧栏收起/展开箭头也复用下载进度条亮色：箭头本体使用 `--cv-download-progress-start`，hover 背景使用同色低透明混合，保持和外部进度条一致。
- `launcherState === "ready"` 时隐藏下载状态文字和进度条，只保留菜单按钮和主启动按钮；隐藏过程使用 `download-progress-fade` 做轻微淡出。
- 当前默认流程从 `paused + downloadedMb = 0` 开始，主按钮显示“下载游戏”，此时不显示进度状态和进度条；点击后进入安装确认弹窗，确认后先由 Tauri Rust 的下载命令把 ZIP/分片放入 `_download`，完成后进入 `downloaded` 并显示“安装游戏”；用户点击安装后再进入合并、校验、解压，完成后进入 `ready` 并隐藏进度区。
- 更新流程不能复用“首次下载”的路径确认入口。检测到新版本后点击“下载更新”必须直接使用当前 `installPath`，并在持久化状态中标记 `mode: "update"`；即使更新下载刚开始就失败或暂停、当前字节仍为 `0`，下一次点击也要继续下载更新，不允许弹出安装目录确认框。安装成功进入 `ready` 后再清掉更新上下文。
- 下载源解析规则：`official` 先请求后端 `/api/toolbox-updates/check` 获取 `objectKey/sizeBytes/sha256`，再请求 `/sign-download` 获取 10 分钟临时 OSS 签名链接；`github` 通过 GitHub Release API 读取 `update.json`，再从同一 Release 解析 ZIP 分片地址。旧的持久化 `gitee` 选择会自动迁移为 `github`。
- 下载页在下载源选择框下方显示后端 `/api/toolbox-updates/traffic-status` 返回的 OSS 下行流量包总量、剩余量和最近到期时间。多个生效中的下行流量包会合计总量与剩余量，最近到期时间取这些套餐中最早的到期时间。后端通过阿里云 BSS `QueryResourcePackageInstances` 查询并缓存 10 分钟，RAM 需要 `bss:DescribeInstances` 只读权限；查询失败时启动器必须放行下载并显示“暂时无法获取”，不能把未知状态当成 0GB。
- 流量卡片标题使用“服务器可用下载流量”，方便普通玩家理解用途。卡片上方平时提示用户可以在主界面顶部支持作者；当剩余总量低于 3GB 时，该行改为提示服务器流量不足，并说明可以切换 Github 源继续下载。
- 当后端明确返回零境交错源剩余额度低于 `3GB` 时，启动器右上角持续显示“服务器当前流量不足”。新的官方源下载和修复下载不能开始；正在进行的官方源下载要调用现有暂停命令保存断点。Github 源不受影响，用户切换后可以继续下载。启动器每 5 分钟刷新一次状态，服务端缓存用于避免每个客户端都直接请求阿里云。
- 启动器本体更新和游戏资源更新分开：游戏资源继续走自有后端和 `crossingvoid-game`；PC 启动器本体走 Tauri 官方 updater 插件和签名包，product key 预留为 `crossingvoid-launcher`。`tauri.conf.json` 的 updater endpoint 当前指向 `https://www.crossingvoid.top/api/toolbox-updates/tauri/crossingvoid-launcher/{{target}}/{{arch}}/{{current_version}}`，Windows 安装模式为 `passive`。签名公钥写入配置，私钥生成在 `src-tauri/private/updater.key` 并通过 `.gitignore` 忽略。发布辅助脚本 `Scripts/Build-LauncherUpdaterPackage.ps1` 会用 `TAURI_SIGNING_PRIVATE_KEY_PATH` 重新打包，复制安装包和 `.sig`，并生成 Tauri updater 需要的 `latest.json`。
- 下载限速设置使用 `crossing-void.launcher.download-limited` 和 `crossing-void.launcher.speed-limit` 持久化。前端把 `1-100 MB/s` 换算为 `speedLimitBytesPerSecond` 传给 Rust；不限制时传 `null`。Rust 侧用全局原子值保存当前限速，下载中修改设置会通过 `set_download_speed_limit` 立即更新；网络读取并写入 ZIP/分片后按总下载字节节流，长时间 sleep 会每 `100ms` 检查一次暂停标记。合并分片、校验、解压和安装不受限速影响。
- 下载和安装必须用两套进度事件，不能互相找补：`game-download-progress` 只包含 `downloadedBytes / totalBytes / percent`，只在 `launcherState === "downloading"` 时更新下载字节和 `x.x/y.y MB`；`game-install-progress` 只包含 `stage / percent / currentItems / totalItems`，只在 `launcherState === "installing"` 时更新安装进度。安装阶段不要再读取或写入下载字节，否则已有完整分片会把“合并安装包”错误显示成 `part001 / total` 的 80% 多。
- 当前已实现真实下载、暂停、断点续传、SHA256 校验和 ZIP 解压。下载中点击主按钮会调用 Rust 侧 `pause_game_download` 设置全局取消标记；下载循环、分片循环、校验和解压都会在块边界检查取消。暂停后保留 `_download` 里的未完成分片/ZIP，继续下载时优先读取已有大小并使用 HTTP `Range` 续传；如果服务端不返回 `206 Partial Content`，则从当前分片开头重下。安装中不允许暂停，主按钮和正方形菜单置灰，设置页“游戏”分类也不可选。
- HTTP 断点续传要处理服务端返回 `416 Range Not Satisfiable` 的情况：如果本地文件大小已经等于期望大小，就视作该文件完成；否则删除异常断点文件并从头重下。网络下载、分片下载都做最多 `3` 次重试，重试之间保留断点文件并短暂等待；用户主动暂停返回 `DOWNLOAD_CANCELLED` 时不重试。
- ZIP 解压和补齐文件都必须防 Zip Slip 路径穿越，Rust 侧只使用 `zip` entry 的 `enclosed_name()` 生成输出路径，跳过异常路径。写入正式游戏文件时先写 `.cvtmp` 临时文件，写完并 flush 后再替换正式文件；Windows 下使用 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH | MOVEFILE_COPY_ALLOWED)` 替换，避免“先删除正式文件再 rename 失败”的空窗期。下载状态 JSON 和合并后的完整 ZIP 也走同一套替换函数。
- 下载状态做双重持久化：前端 `localStorage` 的 `crossing-void.launcher.download-state` 用于启动瞬间快速恢复 UI；安装目录 `_download/download-state.json` 用于更可靠的断点状态备份。两者都保存安装路径、下载源、已下载字节、总字节和 `paused/ready` 状态。启动器重进时如果存在未完成进度，主按钮显示“继续下载”，点击后直接续传，不重新弹安装路径确认；删除游戏或无进度时清理两边状态。当前磁盘兜底恢复会读取默认安装目录 `D:\TFAC-hz64\CrossingVoid\_download\download-state.json`，非默认目录主要依赖 localStorage 中保存的路径。
- 启动时必须校验持久化状态和磁盘是否一致：`paused` 状态要求 `_download/download-state.json` 存在且 `_download` 下仍有 `CrossingVoid.zip` 或 `.zip.part*` 断点文件；`ready` 状态要求安装目录存在 `CrossingVoid.version.json`。如果用户从外部删除了游戏目录或下载临时文件，启动器会清理 localStorage 和磁盘状态，回到“下载游戏”，避免显示过期的“继续下载/启动游戏”。
- `_download/download-state.json` 写入时不要直接覆盖目标文件，先写入同目录临时文件再替换，减少崩溃、断电或进程被杀时留下半截 JSON 的概率。
- SHA256 校验是下载链路的最终可信依据：分片校验失败时删除对应 `.partxxx` 后自动重下一次；合并后的总 ZIP 校验失败时删除总包和所有分片后自动完整重下一次。重试后仍失败就报错停住，避免把坏包解压进游戏目录。
- 安装流程分为 `installStage: downloaded / merged / extracting`：`downloaded` 表示分片已下载完等待合并；`merged` 表示完整 `CrossingVoid.zip` 已合并并通过总 SHA256，分片已经可以删除；`extracting` 表示正在解压。安装中退出后，启动器保留该阶段，下次点击“安装游戏”会从已有 ZIP 重新校验/解压，不回到重新下载。
- 安装前必须先校验 `_download` 中的完整 ZIP 或全部分片是否真实存在且大小匹配；不能只相信 `download-state.json` 里的 `state: downloaded`。如果只有 `0KB CrossingVoid.zip` 或缺分片，要回到暂停/下载状态，不允许进入安装。
- 分片合并完整 ZIP 时必须写入临时文件（当前为 `CrossingVoid.zip.merging`），合并成功并校验大小后再替换正式 `CrossingVoid.zip`。不要直接 `File::create(CrossingVoid.zip)`，否则分片缺失或异常时会把已有总包截断成 0KB。
- 完整 ZIP 校验通过后立即删除 `.part001/.part002` 这类分片，避免安装阶段同时保留分片和完整 ZIP 占用双份磁盘空间。
- 安装成功后 Rust 侧会清理 `_download` 下的临时 ZIP/状态文件；前端仍可写入一个 `ready` 状态文件作为 UI 恢复辅助，但真正判断“游戏已安装”的依据是安装目录里的 `CrossingVoid.version.json`。
- 设置页“游戏”分类里的“删除游戏”当前是演示逻辑：点击偏红色按钮后先弹出确认框，左侧为“删除”、右侧为“取消”；确认后只把 `downloadedMb` 清零并把 `launcherState` 改回 `paused`，用于快速回到“下载游戏”状态测试流程，不删除真实磁盘文件。
- 删除游戏确认框使用 `public/launcher/practical/22TiShiKuang_Cropped.PNG` 作为背景素材；该图从 `22TiShiKuang.PNG` 自动裁掉黑边后得到，弹窗文字改深色以适配白底提示框。删除类按钮采用低饱和暗红/褐红，不使用高饱和鲜红。
- 删除确认框当前使用预先生成的 `22TiShiKuang_Cropped_120.PNG`，也就是把裁剪素材在文件层面放大到 `1.2` 倍后再作为背景图使用；不要用 CSS `transform: scale()` 或伪元素缩放背景，容易造成层级、阴影和视觉边界怪异。标题和正文约 `1.1` 倍，按钮使用固定列宽并只拉大左右间距。
- 删除确认框的位置当前通过 `.confirm-panel { transform: translate(-100px, -50px); }` 左移 `100px`、上移 `50px`；进出场动画也要保留同样的水平基准，并在垂直方向从 `-42px` 过渡到 `-50px`，否则打开动画会跳动。

### 6.1 主界面底部按钮比例

- 底部正方形菜单和主启动/下载按钮按固定像素写，不跟窗口比例自适应缩放。
- 当前菜单按钮为 `59 x 59`，主按钮为 `189 x 59`，相当于早期 `66 / 210` 基准的约 `0.9` 倍；两者间距为 `12px`，底边对齐，模仿鸣潮启动器菜单按钮贴近主按钮的关系。
- 工具菜单弹层锚在正方形菜单上方附近，不再锚在主按钮右侧。
- 工具菜单当前三项为：`浏览本地文件`、`验证游戏完整性`、`重新检测更新`。
- 图标同步使用 `38px`，主按钮文字为 `16px`，避免按钮缩小后图标和文字显得过满。主按钮图标按状态统一：启动游戏用 `Gamepad2`，下载游戏/继续下载用 `Download`，下载中用 `Pause`，下载更新用 `HardDriveDownload`，安装游戏用 `PackageOpen`，检测/安装/修复进行中用 `RefreshCw` 旋转，文件缺失待补齐用 `CircleAlert`。
- 工具菜单打开/关闭使用 Vue `<Transition name="tool-menu-pop">`，只做 `opacity + translateY(8px) + scale(0.96)`，不改弹层尺寸和锚点，避免影响已调好的底部布局。
- 工具菜单的悬停逻辑由菜单按钮和弹层共同维护：两边 `mouseenter` 都取消关闭计时，`mouseleave` 都启动约 `180ms` 延迟关闭。这样鼠标从正方形按钮移动到菜单选项时不会立刻消失，离开按钮和选项区域后会自动隐藏。

## 7. 设置页与窗口拖动实现记录

### 7.0 主题色派生规则

- 后续主题系统先只暴露两个用户可选颜色：`--cv-theme-accent` 强调色和 `--cv-theme-support` 辅助色。默认基准保存为 `--cv-theme-default-accent: #d2aa5c` 和 `--cv-theme-default-support: #0d1214`；当前可临时把实际主题变量改成其它颜色测试，例如蓝色强调色配深紫辅助色。
- 制作期主题色写在 `OnSet/Color.json`，字段为 `accent` 和 `support`，例如 `{ "accent": "#d2aa5c", "support": "#0d1214" }`。开发服务器提供 `/__cv_onset_colors`，前端仅在开发环境读取并覆盖 `--cv-theme-accent`、`--cv-theme-support`；生产包继续使用内置默认色。
- 其它背景色不要直接散落硬编码，优先从这两个颜色用 `color-mix()` 派生，例如 `--cv-bg-page`、`--cv-bg-deep`、`--cv-bg-surface`、`--cv-accent-soft`、`--cv-accent-glow`。
- 第一阶段先从背景层接入变量：主窗口底色、主遮罩、设置页遮罩、设置页面板、设置页侧栏、下拉菜单背景和选中项背景。按钮文字色、危险色、具体插画素材可以后面再分批接入。
- Vue scoped 组件不要在组件内部重新定义 `--cv-theme-accent / --cv-theme-support`，否则会挡住全局主题；组件只引用 `:root` 派生变量。
- 设置页左右两侧必须共享 `.settings-modal` 同一块背景，不要给 `.settings-sidebar` 再叠独立背景；侧栏只保留分割线。这样主背景渐变可以穿透分割线，视觉上才像一整块玻璃面板。
- 背景派生色要克制混白比例。当前 `--cv-bg-surface-soft` 只混入 `8%` 白色，避免设置页中间区域过亮。
- 设置页侧栏四个选项的 active 态也要走主题计算：文字、边框、右侧装饰微光来自强调色派生，背景尾部暗色来自辅助色派生。
- 设置页右侧大标题颜色走 `--cv-accent-title`，当前为强调色 `58%` 混浅金基准 `#ffe2a3` 的 `42%`，用于保持“偏好设置”这类标题接近当前确认过的浅金色。
- 设置页右侧视觉滚动条也复用 `--cv-accent-title`：轨道用标题色低透明混合，滑块从标题色渐变到标题色混辅助色的暗部，光晕同样从标题色派生，保证滚动条和大标题保持同一主题金色。
- 主界面右上普通图标按钮 hover 使用 `--cv-icon-hover-bg` 和 `--cv-icon-hover-color` 派生；图标色用主题色混白提亮，不要混固定黄色，否则切到蓝/紫等主题时会泛橙。关闭按钮的红色 hover 仍保持固定警示色，不跟主题计算。
- 右上角设置、最小化、关闭按钮不使用浏览器原生 `title` 提示，按钮内放 `.button-tooltip` 自绘提示。提示为黑底白字、小圆角、按钮下方居中淡入；提示框当前 `padding: 9px 14px`、`13px` 字号，并用 `::before` 做顶部小尖角。后续左侧按钮也可以复用这套结构。
- 左侧宣传区、新闻选中态、个人信息副标题、资源标题等主界面金色点缀统一复用下载进度条色系 `--cv-download-progress-start/end`，让它们和外部下载进度条保持同一亮黄风格。
- 工具菜单 hover 和设置页返回按钮 hover 复用右上普通图标按钮的 `--cv-icon-hover-bg/color`。
- 设置页路径输入框复用选择菜单描边/背景思路：`--cv-form-border` 来自 `--cv-accent-soft`，背景使用辅助色透明混合。
- 路径输入框聚焦时不要依赖浏览器/Tauri 原生 `outline`，它可能在固定滚动容器或父层裁切下只露出上下边，看起来像左侧被遮挡。当前 `.path-input:focus-visible` 使用 `outline: none`，改由内部 `border` 和 `box-shadow` 表示焦点。
- 复选框/单选框选中态使用 `--cv-check-accent / --cv-check-accent-dark / --cv-check-accent-glow`，贴近原本金色但改为主题派生。
- 设置页链接色使用 `--cv-accent-title`；开关开启态使用下载进度条亮色渐变。

### 7.1 Tauri 窗口控制

- 当前项目使用 Tauri v2，窗口控制从 `@tauri-apps/api/window` 读取 `getCurrentWindow()`。
- 最小化使用 `appWindow.minimize()`。
- 关闭使用 `appWindow.close()`。
- 无边框窗口拖动使用 `appWindow.startDragging()`。
- `src-tauri/capabilities/default.json` 必须保留 `core:window:allow-start-dragging`，否则设置页和主界面的拖动都会被权限拦截。

### 7.2 拖动区域规则

- 根节点继续监听 `mousedown`，这样主界面和设置页都能共用同一套拖动逻辑。
- 不要把整个 `.modal-mask` 排除掉，否则设置页打开后所有区域都会失去拖动能力。
- 只排除真实交互元素：`button`、`input`、`select`、`textarea`、`a` 和带 `data-no-drag` 的滚动内容区。
- 设置页背景、标题区、侧栏空白区可以作为拖动区域；设置项列表和按钮保持可点击、可滚动。
- `data-tauri-drag-region` 不会自动让深层子元素都继承拖动能力；设置页这类大覆盖层需要同时给背景/标题/分隔线使用 `app-region: drag`，再给控件统一 `app-region: no-drag`。

### 7.3 设置页比例基准

- 启动器窗口固定为 `1200 x 675`，设置页也按这个尺寸写固定布局，不再依赖整体缩放。
- 设置页左侧栏接近窗口三分之一，右侧内容从分隔线右侧留出较大标题边距。
- 侧栏按钮保持固定宽高，文字、图标、选中背景在按钮内居中。
- 标题、分隔线、圆形装饰、右侧表单控件使用固定像素坐标，优先保证和真实 exe 截图一致。
- 设置页左上圆形装饰不能压到“游戏安装目录”输入框选中描边或文字区域；当前 `.settings-modal::before` 使用 `left: -360px`，比早期 `-98px` 向左移了 `262px`，只移动装饰层，不动输入框本身。

### 7.4 验证方式

- 不用浏览器预览判断最终效果，浏览器和 Tauri WebView 的窗口边界、缩放、拖动能力会有差异。
- 每次修改后至少运行 `npm run build` 验证类型和打包产物。
- 视觉与交互验证以真实 Tauri dev 窗口为准；需要比较时同时截取参考启动器窗口和零境启动器窗口。
- 设置页验收必须同时检查：右上关闭按钮可见且可点、右侧金色滚动条在窗口内、右侧内容没有被裁切、设置页背景/标题区仍可拖动。
- 如果截图里只看到左半或中间内容，不能判定通过；必须看到右侧边界、关闭控件和滚动条位置。

### 7.5 右侧裁切问题记录

- 本次设置页右侧不可见的根因不是按钮缺失，而是关闭按钮被布局计算到窗口外。
- 真实窗口截图尺寸为 `1202 x 677`，但可访问点击设置页关闭按钮时报出坐标 `x = 1371`，已经超过窗口右边界。
- 后续判断这类问题时不能只看 DOM 或可访问树里有没有元素，必须同时确认元素坐标落在真实窗口范围内。
- 右侧关闭按钮和金色滚动条目前放在 `.modal-mask` 直属层，并通过固定像素向左收回，避免再被设置面板内部 grid 宽度推出窗口。
- 已验证设置页关闭按钮可见且可点；设置页标题/背景拖动后窗口原点从 `(218, 88)` 变为 `(293, 126)`，说明拖动仍然生效。

### 7.6 设置页视觉基准

这部分记录当前已经人工调到可接受状态的固定布局参数。后续做其他游戏启动器时，可以先复制这套基准，再按目标启动器截图微调。

#### 7.6.1 左侧设置栏

- 设置页整体使用两列 grid，当前左侧栏宽度为 `220px`：`grid-template-columns: 220px minmax(0, 1fr)`。
- 左侧栏内边距为 `44px 28px 38px 28px`，用于让四个 tab 按钮整体上移，并在缩窄后的侧栏中居中。
- tab 按钮当前尺寸为 `165 x 42`，间距为 `13px`，内部布局为 `21px 1fr`，图标和文字间距为 `11px`。
- tab 文本字号为 `14px`，选中态保留金色文字、浅色描边和右侧装饰纹理。
- 选中态装饰尺寸为 `51 x 30`，位置为 `right: 6px; top: 5px`。
- 调整经验：先定左列宽度，再移动侧栏 padding，最后缩放 tab 按钮。不要只移动按钮，否则按钮与右侧分隔线的关系会继续显得偏。

#### 7.6.2 标题区与分割线

- 右侧内容区左边距为 `42px`，用于让标题和正文更靠近侧栏。
- 标题区 grid 行高为 `100px 24px 1fr`，其中第一行控制标题与分割线之间的竖向关系。
- 标题顶部 padding 为 `38px`，这是当前标题和右上返回箭头较接近居中对齐的值。
- 大标题字号为 `23px`，约等于早期 `29px` 的 0.8 倍。
- 标题下方分割线高度为 `2px`，透明白色为 `rgba(255, 255, 255, 0.34)`。
- 分割线使用 `margin-left: -42px` 拉回侧栏边界，保证线条从侧栏右侧边界开始连接，而不是从正文缩进处开始。
- 右上返回按钮使用 `ArrowLeft`，图标尺寸 `37`，按钮位置 `right: 250px; top: 24px`；它仍然负责关闭设置页并返回主界面。

#### 7.6.3 正文缩放

- 设置页正文 `.settings-page` 当前使用 `zoom: 0.96`。
- 这个值来自“先把正文缩小到可控，再重新放大”的迭代结果。它不是响应式缩放，而是固定启动器窗口内的视觉比例。
- 如果后续增加更多设置项，优先保持正文比例不变，通过滚动条处理溢出；不要为了临时塞内容反复改全局 zoom。

### 7.7 设置页滚动条实现记录

设置页右侧金色滚动条不是浏览器原生滚动条，而是启动器内部视觉条。原生滚动仍由 `.settings-scroll` 负责，金色条只负责提示当前位置。

当前基准参数集中在 `SETTINGS_SCROLLBAR`：

```ts
const SETTINGS_SCROLLBAR = {
  viewportBottomInset: 90,
  extraScrollSpace: 90,
  railTop: 154,
  railBottom: 160,
  thumbVisibleRatio: 0.72,
} as const;
```

- `viewportBottomInset: 90`：把设置面板底部向上收 `90px` 作为固定可视安全线。当前偏好设置页按这个值会触发滚动条。
- `extraScrollSpace: 90`：当内容超过安全线时，在 `.settings-scroll` 底部追加透明 spacer，给原生滚动补足真实可滚动空间。
- `railTop: 154`：金色轨道距离设置面板顶部的距离。
- `railBottom: 160`：金色轨道距离设置面板底部的距离。这个值用于避免轨道底部贴边或被窗口裁切。
- `thumbVisibleRatio: 0.72`：滑块占轨道高度的比例。滑块可移动距离由轨道高度自动计算，不再写死像素。

溢出判断不要只依赖 `scrollHeight > clientHeight`，因为固定窗口、`zoom`、遮罩层和视觉安全线会让浏览器的自然滚动高度不等于肉眼看到的裁切边界。当前逻辑用当前设置页最后一个实际内容元素的底部，和 `modal.bottom - viewportBottomInset` 比较。

滚动过程中要把 `scrollTop` 加回到内容底部坐标里：

```ts
const unscrolledContentBottom = lastContentRect.bottom + scrollEl.scrollTop;
```

这样滚动时不会因为元素视觉 bottom 变小而误判“不溢出”，导致 spacer 被清零、页面突然滚不动。

实现经验：

- 先用固定安全线决定是否需要滚动条。
- 再用 `overflowAmount + extraScrollSpace` 撑出真实滚动空间。
- 最后用 `scrollTop / maxScroll` 驱动金色滑块位移。
- 如果一个页面内容能完整放下，就不要显示金色滚动条。
- 如果滑到底内容仍不完整，优先调 `extraScrollSpace`。
- 如果轨道本身被裁，优先调 `railTop` / `railBottom`。
- 如果滑块移动幅度不自然，优先调 `thumbVisibleRatio`，不要回到写死移动距离。

### 7.8 表单控件实现记录

- 设置页里的语言选择不再使用原生 `select`，改为启动器内部自绘下拉菜单。
- 原因是 Tauri WebView 里的原生 `select/option` 弹层会被系统控件样式接管，容易出现白底、粗边框、字体尺寸不一致，和启动器整体视觉不匹配。
- 自绘下拉已抽成 `src/components/LauncherSelect.vue`，外部只传 `v-model` 和 `options`；后续新增语言、下载源、服务器线路等选择类控件时优先复用该组件。
- 推荐设置项结构是：`setting-title` 标题、可选 `setting-hint` 灰色说明、`LauncherSelect` 选择菜单。这样说明文字位于标题和菜单中间，和鸣潮式设置页更接近。
- 下拉菜单展开/收起使用 Vue `<Transition>`，只通过 CSS 控制 `opacity`、`translateY`、`scaleY` 和 `max-height`，避免写 JS 定时器。
- 当前动画时长约 `150ms - 170ms`，适合启动器设置面板这种轻量交互；后续新增类似菜单时优先复用这组过渡 class。
- 下载页的“下载源”同样使用自绘下拉，当前包含 `零境交错源 / Github源`。说明文字放在标题和选择菜单之间，并随选中源切换；真实下载时用该状态决定官方 OSS 后端或 Github 源。
- 自绘下拉的每个 `.launcher-select__option` 之间保留 `4px` 间隔，最后一项不加底部间距；这样 active/hover 背景不会连成一整块。
- 设置页矩形操作按钮最终采用干净浅色底，不再叠六边形、斜线或其它装饰纹理。之前尝试过 `linear-gradient` 斜线拼接和内联 SVG 六边形 `mask-image`，实际效果要么像三角网格，要么在小按钮里显得噪，因此该类操作按钮优先保持简洁。
- 设置页矩形操作按钮默认白色不参与主题计算，删除按钮红褐色也不参与主题计算；只有普通按钮 hover 态走主题计算。hover 不要做成整块亮黄，也不要额外叠圆点、斜线、蜂窝等背景装饰；只用辅助色生成深底，用强调色生成文字、内描边和轻微外发光，接近鸣潮设置侧栏那种深底金边状态。

### 7.8.1 启动器语言实现记录

- 语言选择不要把“简体中文 / English”这类显示文字当作业务状态，内部使用稳定 key：`zh-Hans / zh-Hant / en / ja`。
- 当前语言写入 `localStorage` 的 `crossing-void.launcher.language`，启动时读取并同步到 `document.documentElement.lang`。
- `LauncherSelect` 仍然只接收字符串数组，所以语言选择用 computed 做桥接：界面显示本地化名称，写入时再映射回语言 key。
- 下载源也使用稳定 key：`official / github`。切换语言时只改变显示名称和说明文字，不改变真实选择项；旧 `gitee` key 会在读取本地下载状态时转换为 `github`。

- 启动器自更新的实际安装包和签名发布到 `xiaojie578/CrossingVoid-Downloader` 的 Gitee Release；`launcher/latest.json` 提交到仓库 `master` 分支，Tauri 更新器直接读取该固定文件。开发页的“发布新版本包”调用 `Publish-LauncherGiteePackage.ps1`，只从运行时参数或 `GITEE_ACCESS_TOKEN` 环境变量读取 Gitee 访问令牌，令牌不得写入项目、脚本或清单。
- 已安装旧版启动器的 Tauri 更新端点仍指向服务器，因此首次升级到 Gitee 版本需要保留一次旧端点过渡，或让玩家手动下载安装新版；升级后的启动器不再通过服务器获取更新包。
- 当前翻译范围是启动器壳层 UI：窗口按钮、主按钮、下载状态、安装确认弹窗、设置页、工具菜单、侧栏分类和占位账户信息。`OnSet` 里的角色、公告、视频内容保持原始 JSON 文案，不在启动器语言切换里自动翻译。
- 后续新增页面时优先新增 `TranslationKey`，再在四个语言表里补齐文案；不要在模板里直接写固定 UI 文案。

### 7.9 次级页面动效记录

- 设置页打开/关闭使用 Vue `<Transition name="settings-layer">` 包住整个遮罩层。
- 打开时遮罩淡入，背景高斯从浅到深；设置面板、返回按钮和右侧金色滚动条同步 `opacity + translateY(8px) + scale(0.98)` 过渡到正常状态。
- 当前整体动效时长约 `190ms - 220ms`，曲线使用偏干净的 `cubic-bezier(0.2, 0.86, 0.22, 1)`，避免弹窗感太重。
- 设置页内部 tab 切换使用 `<Transition name="settings-page-slide">`，只作用于右侧 `.settings-page` 正文；不要使用 `mode="out-in"`，否则新页面 DOM 会等旧页面离场后才挂载，无法在切换瞬间立即测量溢出。
- tab 切换时新正文从右侧 `translateX(12px)` 淡入，旧正文向左 `translateX(-8px)` 淡出；设置标题使用同样的轻横移淡入，侧栏和分割线不参与横移动效，保持启动器界面稳定。
- 每次正文进入完成后触发 `updateSettingsScrollbar`，避免切换页后金色滚动条沿用旧页面高度。
- 发现快速切换 tab 时，金色滚动条如果跟随 keyed 正文容器重建，容易出现测量失败；如果放进 `.settings-content` 内部，又会被该层 `overflow: hidden` 裁掉。最终方案是：`.settings-scroll` 保持稳定负责真实滚动和测量，`.settings-scrollbar-rail` 放回 `.settings-modal` 直属层，避免裁切。
- tab 切换开始时先清空 `settingsScrollSpacer / settingsScrollbarThumbTop / settingsContentOverflowing`，再在 `nextTick` 立即测量新页面，并用 `requestAnimationFrame`、短延迟和 `@after-enter` 补测。视觉滚动条本身不跟随 keyed 容器销毁。
- 视觉滚动条节点常驻，不使用 `v-if`，也不再用 `v-show + Transition`。快速切换时 `v-show` 会改 `display`，容易让淡入/淡出看起来瞬间完成。
- 视觉滚动条显示/隐藏通过 `.settings-scrollbar-rail.visible` 切换 `opacity`，轨道本身保留 `transition: opacity 160ms ease`，这样状态变化一定走 CSS 渐隐，且不改变轨道坐标和层级。
- 滚动条“是否显示”不能写死到某个 tab。当前做法是稳定滚动容器负责测量 `settingsContentOverflowing`，然后把结果传给 modal 层里的金色轨道使用。测量用当前页整体高度与可视高度比较，原生 `scrollHeight` 只作兜底。

### 7.10 顶部快捷入口与提示框

- 顶部快捷入口数据集中在 `quickLinks`，每项使用 `label / tip / iconSrc / url / qr` 描述，不再把展示文字、跳转链接和二维码提示分散写在模板里。
- 有 `url` 的入口点击时通过 Tauri `@tauri-apps/plugin-opener` 的 `openUrl` 打开系统默认浏览器；失败时才回退到 `window.open`。
- 当前固定顺序是：团队官网、游戏官网、微信、B站、QQ、爱发电。同一套结构也适合后续扩展抖音、客服、TapTap 等入口。
- 平台图标使用 `public/launcher/icons` 下的本地 SVG，通过 `iconSrc` 引用，避免混用通用图标和文字占位。微信、B站、QQ、爱发电优先使用品牌 SVG 图标，不再手绘近似图标。
- 微信、B站、QQ 的品牌图标视觉面积偏大，按钮仍保持 `40px` 圆形，图标本体用 `.platform-icon.compact` 缩到 `18.4px`，约等于基础 `23px` 的 0.8 倍。
- 纯文字提示和二维码提示复用 `.button-tooltip`。二维码型提示额外使用 `.qr-tooltip`，内部包含二维码图片和一行说明文字。
- 提示框参考鸣潮启动器：深色小矩形、顶部居中小尖角、淡入和轻微下移动效。不要使用原生 `title`，否则会和自绘提示框叠在一起。
- 微信二维码直接使用外部给定素材；B站和 QQ 二维码使用后续给定的纯二维码图，放到 `public/launcher`。更换二维码时优先换新文件名并同步改 `quickLinks` 的 `qr` 路径，避免 WebView 或 Vite 缓存继续显示旧图。

### 7.11 用户信息卡

- 用户信息卡目前仍是占位数据，正式接口接入前保持静态显示。
- 用户名当前显示为 `晓桀`。
- 头部只显示 `特征码`，不再显示 `TFAC等级` 或其它等级文案。
- 活跃项说明使用 `每周活跃`，不要写 `今日活跃`。
- 资源格保持两列布局；图标列和数字组分开，数字和 `/上限` 之间只保留小间距，避免看起来像两组散开的信息。
- 资源说明文字统一放在数字组下方，使用 `white-space: nowrap`，避免短标签在小卡片里换行造成视觉抖动。

### 7.12 游戏安装目录与下载入口

- 默认启动器根目录是 `D:\TFAC-hz64`，默认游戏安装目录是 `D:\TFAC-hz64\CrossingVoid`，由 `DEFAULT_LAUNCHER_ROOT` 和 `GAME_DIRECTORY_NAME` 拼出。
- 当用户首次点击主按钮开始下载，且当前下载进度为 `0` 时，先显示启动器内部的安装确认弹窗，不要先弹系统目录选择窗口。这样默认路径用户可以直接确认继续。
- 安装确认弹窗预览最终会生成的目录：默认显示 `D:\TFAC-hz64\CrossingVoid`；如果用户点击 `更改` 并选择启动器根目录或其它上级目录，则自动拼出 `...\CrossingVoid`；如果选中的目录本身已经是 `CrossingVoid`，则不重复追加。
- 安装确认弹窗显示远程 ZIP 体积的两倍作为 `所需空间`、当前路径所在盘的可用空间、`桌面快捷方式` 勾选项和 `继续安装` 按钮；不提供开机启动选项。
- 可用空间通过 Tauri 命令按当前最终路径所在盘查询。低于所需空间时只把可用空间提示标红，不禁用 `继续安装`。
- 用户点击 `继续安装` 后，把最终路径写回 `installPath` 并开始下载；如果关闭确认弹窗，就保持 `等待下载` 状态，不启动下载进度。
- 设置页“重新定位游戏”不能复用首次下载的目录选择函数。首次下载选择的是“上级下载位置”，会自动拼出 `...\CrossingVoid`；重新定位选择的是“已经存在的游戏目录”，必须直接把用户选中的目录作为 `installPath`，并用 `CrossingVoid.version.json` 校验这是一个可用安装目录。
- 重新定位成功后清理旧下载/更新上下文，刷新本地版本号，把主状态切回 `ready`；如果未开启单机模式，再自动发起一次版本检测。重新定位失败只显示短提示，不修改当前路径。
- 目录选择依赖 Tauri `@tauri-apps/plugin-dialog` 和 Rust 侧 `tauri-plugin-dialog`，新增或修改该插件后需要重启 Tauri dev/exe 才会生效，单纯热更新前端不够。

### 7.13 勾选与单选控件

- `check-box` 和 `radio-dot` 都使用主题计算色，不再写死白色边框或固定黄色。
- 未选中状态使用 `--cv-theme-support` 混合出的深底和 `--cv-check-accent` 的弱边框。
- 选中状态使用 `--cv-check-accent / --cv-check-accent-dark / --cv-check-accent-glow` 生成背景、边框和发光。
- checkbox 勾号使用 `opacity + scale + rotate` 进入；radio 内点使用 `opacity + scale` 进入。
- 安装确认弹窗的“桌面快捷方式”和设置页的“开机时自动运行启动器 / 退出游戏后不弹出启动器”等 checkbox 共用同一套基础样式。

### 7.14 游戏发布包与分片下载清单

- 零境游戏发布脚本不再要求手动选择 ZIP。正常流程选择打包后的游戏目录，脚本自动生成 `Saved/ReleasePackages/<Platform>/CrossingVoid.zip`。
- ZIP 内会写入 `CrossingVoid.version.json`，用于启动器以后在本地安装目录读取当前游戏版本。远端 `update.json` 仍放在 ZIP 外，因为启动器必须先读取它，才能判断版本、体积、下载地址和校验信息。
- 发布脚本会跳过 `.pdb`、`Saved/Logs`、`Saved/Crashes`、`_download` 和 `.git`，避免把调试文件、临时下载和仓库内容打进正式游戏包。
- 发布脚本保留完整 ZIP 的 `sha256` 和 `sizeBytes` 作为最终安装校验依据，但上传资产会拆成 `CrossingVoid.zip.part001`、`CrossingVoid.zip.part002` 这类分片。单片大小当前控制在约 `1900MB`，避开 GitHub Release 单文件 2GB 附近的边界。
- `update.json` 中每个 asset 继续描述完整包，同时新增 `chunks` 数组。每个 chunk 记录 `index / count / fileName / objectKey / sha256 / sizeBytes / contentType`。
- 启动器下载逻辑后续应优先判断 `asset.chunks`：如果存在，就按顺序下载所有分片，边下载边累加进度，合并为 `CrossingVoid.zip` 后再校验完整 ZIP 的 `sha256`，最后解压安装；如果不存在，才走旧的单 ZIP 下载逻辑。
- “继续上传”不重新压缩目录，而是复用上次保存的完整 ZIP、分片文件和 ossutil checkpoint。GitHub Release 阶段会检查同名附件大小，已存在且大小一致就跳过；OSS 阶段继续使用 checkpoint。只有正常发布 Windows/Android 游戏目录时才重新生成 ZIP 和分片。
- 现在的分片是启动器层的 ZIP 分片，目标是让 GitHub Release 和 OSS 都能承载超过 2GB 的游戏包；国内 Git 镜像源不再作为游戏包源。以后如果要真正节省更新流量和磁盘空间，应再升级到 UE 内容层分块：重点关注 `CrossingVoid/Content/Paks` 下的 `.pak/.ucas/.utoc`，尤其是 `pakchunk*` 文件，因为这些通常承载主要 cooked 内容，变动也最值得单独处理。

### 7.15 启动器自更新流程

- 启动器本体更新走 Tauri 官方 updater，不要自己用 PowerShell 覆盖正在运行的 exe。前端只负责 `check()`、`downloadAndInstall()`、进度展示和 `relaunch()`；安装包下载、签名校验和安装器调用交给 Tauri 插件。
- 启动器更新必须是独立状态源，不复用游戏下载、游戏安装或文件修复状态。当前状态为 `launcherUpdateStage: idle / checking / downloading / installing / restarting / failed`，并有独立的版本号、已下载字节和总字节。
- 当设置页“检查版本”发现新启动器版本时，关闭设置页回到主界面，主按钮显示 `更新启动器中`，菜单、主按钮、游戏设置页入口全部禁用，防止玩家同时触发游戏下载、安装、修复或启动游戏。
- 主进度条按统一展示模型优先显示启动器更新：检查阶段显示 100% 扫光，下载阶段使用 Tauri `Started / Progress / Finished` 回调累计字节，安装阶段固定推进到接近完成，重启阶段显示 100%。
- 游戏下载/安装/修复仍保持原状态逻辑。以后如果进度条文字或百分比串状态，先检查 `launcherUpdateActive` 是否优先于 `launcherState`、`versionCheckPending` 和 `repairPending`。
- 打包启动器更新包时，`Build-LauncherUpdaterPackage.ps1` 生成安装包、`.sig` 和后端 `update.json`，并在打包结束后把最终需要人工处理的内容整理到 `D:\启动器新包`。`Publish-LauncherUpdaterPackage.ps1` 复用同一套整理目录，然后再执行 OSS 上传。
- `D:\启动器新包\上传到OSS` 只放需要上传 OSS 的启动器安装包 `.exe`。Tauri 的 `.sig` 签名内容已经写入后端 `update.json`，不需要手动上传。
- `D:\启动器新包\覆盖到服务器` 会生成 `ToolboxUpdateServer\app\Data\products\crossingvoid-launcher\update.json`。覆盖时直接拿里面的 `ToolboxUpdateServer` 主文件夹覆盖服务器同名文件夹，不再需要手动找内部路径，也不再直接改本机后端目录。
- 项目目录 `dist-launcher-update` 里的 `.sig`、`latest.json`、`update.json` 属于脚本中间产物和排查用文件，正式发布时只看 `D:\启动器新包`。
- NSIS 的 `installerIcon` 会影响安装器界面图标，但资源管理器里显示的安装包文件图标还需要 `Icon` 指令。当前安装包使用专门的 `src-tauri/icons/installer.ico`，内含 `16/32/48/256` 多尺寸图层；构建脚本会在 Tauri 生成 NSIS 脚本后写入或替换 `Icon/UninstallIcon`，重新运行 `makensis`，再重新生成 updater 签名，确保安装包文件图标在资源管理器小图标和大图标下都清晰。
- 中文产品名下重写 `installer.nsi` 时必须保留可被 `makensis` 识别的编码。脚本后处理会用带 BOM 的 UTF-8 写回，让 `makensis` 显示 `(UTF8)` 并正确读取 `零境启动器`；不要用无 BOM UTF-8，否则 `makensis` 可能按 ACP 读取并报 `Bad text encoding`。
- 开发页如果选择了 `D:\` 这类磁盘根目录，前端和脚本都会自动转成 `D:\启动器新包`，并拒绝删除磁盘根目录，避免清理输出目录时误删或报错。
- 设置页游戏管理拆成两个动作：`删除游戏` 只删除当前 `CrossingVoid` 游戏目录并重置下载状态，Rust 层会拒绝删除非 `CrossingVoid` 目录、启动器 exe 目录和资源目录；`卸载启动器` 会先执行同样的游戏目录删除，再打开 Windows 注册表记录的启动器卸载程序。
- Tauri updater 打包必须在 `tauri.conf.json` 的 `bundle` 下启用 `createUpdaterArtifacts: true`，否则只会生成安装包，不会生成 `.sig`。当前私钥是空密码的 minisign/rsign key，打包脚本需要同时设置 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PATH` 和空的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，否则 Tauri CLI 会提示“找到了公钥但没有私钥”。
- 启动器安装后的 Windows 显示名和卸载项名称使用 `零境启动器`，由 `tauri.conf.json` 的 `productName` 控制；因此 Tauri 生成的安装包文件名也会改成中文，例如 `零境启动器_1.0.0_x64-setup.exe`。构建脚本生成 updater 清单时会对中文文件名做 URL path segment 编码，避免后端下载地址因为中文路径不稳定。卸载逻辑同时兼容旧名 `CrossingVoidinitiator-PC`，方便旧包过渡。
- 启动器发布包只生成 NSIS 安装包，不再生成 MSI。原因是当前实际自更新链路只使用 NSIS，且 WiX/MSI 在中文产品名下失败时会让后续脚本误用旧 NSIS 产物。`Build-LauncherUpdaterPackage.ps1` 必须检查 `npm run tauri -- build` 的退出码，失败就立刻停止；收集安装包时只从 `src-tauri/target/release/bundle/nsis` 取 `setup.exe`。
- `www.crossingvoid.top` 的 IIS 443 站点已经配置 Let’s Encrypt 证书，IIS 也已通过 URL Rewrite + ARR 把 `/api/toolbox-updates/*` 反向代理到本机 `http://127.0.0.1:51987/api/toolbox-updates/*`。启动器的游戏更新 API、Tauri updater endpoint 和打包脚本默认 `EndpointBaseUrl` 已统一切到 `https://www.crossingvoid.top/api/toolbox-updates`；旧的公网 `:51987` HTTP 入口暂时保留作回退，等零境启动器和幻杀工具箱都验证后再考虑关闭公网访问。

### 7.16 开发模式工具页

- 设置页第五个板块 `开发` 只在 Vite/Tauri dev 模式显示，正式用户版不渲染该 tab。前端通过 `import.meta.env.DEV` 控制入口，这是第一层保险。
- Rust 侧开发命令也做了 `debug_assertions` 限制：正式 release 包即使被前端误调用，也只会返回“开发工具仅在调试模式可用”，不会写版本号、跑 PowerShell 或打开工程目录，这是第二层保险。
- 当前开发页包含：`设置版本号`、`打包启动器`、`发布新版本包`、`打开项目文件夹`。
- `设置版本号` 会写入 `Saved/Launcher/developer-version.json`，并立即更新当前开发界面。不能直接改动正在被 `tauri dev` 监听的 `src-tauri/tauri.conf.json` 或根目录 `package.json`，否则写入成功后开发进程会自动重启，看起来像启动器闪退。版本号格式限制为 `x.y.z` 或 `x.y.z-prerelease`，并且必须严格高于当前版本。
- 打包脚本优先读取 `Saved/Launcher/developer-version.json`，通过 `CV_LAUNCHER_VERSION` 注入前端版本号，并通过 Tauri `--config` 覆盖把同一个版本写入最终程序、安装包和更新清单；开发版本文件不存在时才回退读取 `src-tauri/tauri.conf.json`。
- 打包前会检查 `npm`、`cargo`、版本号、输出目录和签名环境，并使用 Tauri `--ci` 防止后台任务等待交互输入。Cargo 自身继续复用 `target/release` 增量产物，不主动清理缓存；这样重复打包能复用已编译依赖，同时避免为了提速制造另一套易失真的缓存判断。
- 打包进度不只依赖 PowerShell 的大阶段。底层会解析 Vite、Cargo、Tauri 和 NSIS 的真实输出，但界面只显示短中文，例如“准备界面”“编译程序 542/553”“生成安装包”“生成更新签名”，不得暴露模块名、技术命令或磁盘路径。Cargo 使用回车刷新同一行时必须取最后一条状态，避免把多条输出拼接到界面。发布任务中的内嵌打包进度映射到前 70%，随后显示更新信息、上传安装包和同步服务器，进度不得倒退。
- Vite 开发监视必须排除 `src-tauri`、`dist*`、`dist-launcher-update*`、`Logs` 和 `Saved`。安装包生成期间 EXE 可能被 NSIS 或签名程序占用，如果 Vite 尝试监视该文件，Windows 会返回 `EBUSY` 并终止开发服务器，留下仍在运行但只能显示旧缓存页面的 Tauri 窗口。
- 角色展示从 `OnSet/Character/<角色文件夹>` 读取。`character.json` 可以通过 `banner` 或 `image` 指定图片；未指定时优先查找 `banner.*`、`cover.*`、`character.*`，再选择其他受支持图片。单个 JSON 或图片损坏不得拖垮其他角色，图片 URL 必须带文件修改时间与大小作为缓存标识，运行时加载失败则只对当前角色使用内置备用图。
- `打包启动器` 会弹出类似安装路径确认的内部弹窗，选择输出目录后调用 `Scripts/Build-LauncherUpdaterPackage.ps1`。
- `发布新版本包` 会先检查输入版本号必须大于当前启动器版本，再调用 `Scripts/Publish-LauncherUpdaterPackage.ps1`，用于生成并上传 Tauri updater 安装包。
- `打开项目文件夹` 打开启动器工程根目录，方便制作期直接改 `OnSet`、`public/launcher` 和其它 JSON/素材数据。
- 开发脚本进度复用主界面进度条。PowerShell 输出 `::progress{...}` 标记，Rust 侧解析后通过 `dev-script-progress` 事件发给前端；前端用 `developerTaskKind / developerTaskPercent / developerTaskMessage` 独立控制，不混用游戏下载或启动器自更新状态。
- 启动器日志入口放在“关于启动器”页。`打开日志目录` 调用 Rust 的 `open_launcher_log_folder`，目录不存在就先创建。开发打包/发布脚本每次运行都会把完整 stdout/stderr 写入 `dev-script-build-latest.log` 或 `dev-script-publish-latest.log`，方便界面错误被截断时直接定位完整报错。

### 7.17 启动加载页

- 启动器启动时先由 `index.html` 提供极轻的深色背景和 `logo_white.png` 静态 Logo，覆盖 WebView 还未加载 Vue 的第一帧，避免正式安装包冷启动时出现空白界面。
- Vue 挂载后会给 `body` 添加 `launcher-app-mounted`，让静态 Logo 淡出，再由 `App.vue` 的 `bootSplashVisible / bootSplashStatus` 显示正式启动加载层。
- 正式加载层参考鸣潮启动器的启动等待页：居中显示现有白色 Logo、主题色扫光细进度线，右下角显示 `Now Loading...`。它只承担启动遮罩，不混用游戏下载、安装、修复或启动器更新进度。
- 首屏初始化现在只等待本地状态恢复、本地游戏版本读取、一次 `nextTick`、最短约 900ms 的视觉停留，以及最多约 1200ms 的字体准备。远程版本检测改为加载层淡出后后台执行，避免网络请求拖慢首屏。
- 标题字体和英文字体都使用 `font-display: swap`，字体文件尚未准备好时先显示系统字体，避免文字长时间不可见。
- 排查正式包启动时的 PowerShell 弹窗要先看父进程。一次 30 秒进程监听显示频繁出现的 `powershell.exe` 父进程是 Codex 桌面应用，不是 `tauri-vue-launcher.exe`，因此不要为了这个现象在启动器里盲目隐藏所有 PowerShell 子进程。
- 启动器需要查询游戏是否正在运行。旧实现通过 `tasklist.exe` 外部命令固定轮询 `CrossingVoid.exe`，GUI 启动器在 Windows 上可能因此反复闪出控制台窗口；现在改为 Rust 侧使用 Windows ToolHelp 进程快照 API 直接枚举进程，不再启动外部 `tasklist/cmd/PowerShell`。
- 前端也不再常驻固定轮询。启动器挂载时只查一次游戏进程；之后只有 `gameRunning` 或 `gameLaunchPending` 为真，也就是游戏可能正在运行或刚启动时，才每 5 秒轮询一次。轮询检测到游戏已关闭且没有启动中状态后，会自动停止。
