# 零境启动器玩家反馈（Issue）设计

日期：2026-10-11
状态：设计方案，**未开始实现**
依赖调研：
- `Docs/research/2026-10-11-gitee-issue-submission.md`（Gitee 侧无匿名通道、openEuler QuickIssue 的做法与源码核实）
- `Docs/research/2026-10-11-github-intermittent-access.md`（`github.com` 间歇性阻断实测；`api.github.com` 稳定）

一句话：**玩家不注册任何账号，在启动器里选类别、填标题和描述，提交到我们自己的服务器，由服务器用 fine-grained token 在 GitHub 建 issue，启动器再通过服务器读回 issue 列表。**

---

## 1. 目标与边界

### 做

- 玩家在启动器内提交反馈，**不需要 Gitee / GitHub 账号，不需要梯子**。
- 玩家在启动器内**查看已有 issue 列表与详情**。
- 分类、标题前缀、正文模板由**启动器决定**（玩家只做一次单选），保证产出格式统一。

### 不做

- 不做双向同步（Gitee 与 GitHub 互相同步）。
- 不在客户端保存任何 token。
- 不用 GitHub 的 Issue Types（个人仓库不可用，见 §3.1）。

### 现状（2026-10-11 实测）

| 事实 | 值 |
| --- | --- |
| 启动器「BUG 提交」入口 | 打开 `https://gitee.com/xiaojie578/CrossingVoid/issues`（`src/launcherData.ts` 的 `bug-report`） |
| 游戏仓库（GitHub） | `kirito0000001/CrossingVoid`，`has_issues=True` |
| 现有 issue | 5 条，**全部由玩家提交**（`Drayzoak` / `mahoyoplayer` / `Magumin21` / `TypeDreamMoon`），**且一条 label 都没有** |
| 现有 label | 9 个 GitHub 默认 label + 本次新建 3 个（见 §3.2） |
| Gitee 侧 issue | `xiaojie578/CrossingVoid` 5 条，全部作者为仓库主本人 |

> 现有 issue 的分布已经说明玩家最常卡在哪：#1「提示系统不支持32位」、#2「不知道该把这个放在哪里」、#3「怎么解压 part001」——**全都是"安装/使用疑问"，不是游戏 BUG**。分类必须覆盖这一类。

---

## 2. 总体结构

```text
启动器 (Vue)               阿里云服务器                     GitHub
─────────────              ──────────────                  ──────────
填表(类别/标题/描述)
   │
   ├─ POST /feedback ───► 校验 + 限频 + 拼模板
   │                        │
   │                        └─ POST /repos/{o}/{r}/issues ──► Issue #N（带 label）
   │                      ◄── { number, html_url }
   ◄── { number, url } ───┘
   │
   ├─ GET /issues ──────►  缓存(5 min TTL)
   │                        └─ GET /repos/{o}/{r}/issues ──► 列表
   ◄── 列表(含 Gitee 镜像地址)
   │
   └─ GET /issues/{n} ──►  缓存
                            └─ GET .../issues/{n} + /comments
   ◄── 详情 + 评论
```

**唯一真源是 GitHub Issues。** Gitee 那份是给守旧玩家的镜像（可选，不阻塞本期）。

---

## 3. 分类规范（本次的核心）

### 3.1 前提：按"玩家怎么想"分，不按"代码怎么坏"分

GitHub 的 **Issue Types 是组织级功能，个人仓库用不了**（官方原文：「Organization owners can modify issue types」/「across your organization」），而且创建 issue 的 REST 请求体里**没有** `type` / `type_id` 字段（官方 spec 实测 `"type_id"` 出现 0 次）。

**所以分类只能落到 label 上**——而且这恰好更好：玩家在启动器里看到的措辞由我们决定，不必暴露"bug / enhancement"这种术语。

玩家看到的**四个类别**（2026-10-11 用户拍板：BUG / 建议 / 优化 / 提问）：

| 玩家看到的选项 | 副标题（引导文案） | 打的 label | 标题前缀 |
| --- | --- | --- | --- |
| **BUG** | 游戏能进去，但出了错（闪退、卡死、数值或剧情不对） | `bug` | `[BUG]` |
| **建议** | 希望加新功能、加新内容 | `enhancement` | `[建议]` |
| **优化** | 已有的东西希望改得更好（体验、手感、性能、数值平衡） | `优化` | `[优化]` |
| **提问** | 不知道怎么操作、不确定是不是正常现象 | `question` | `[提问]` |

**第五类：`未分类`**（用户 2026-10-11 补充）——**玩家不经过启动器、直接去 GitHub 网页提的 issue**，
四条类别一个都不沾。它们：

- 在 GitHub 侧：由**人工**打上 `未分类`（或事后改打成四类之一）；
- 在启动器侧：**照常出现在列表里**，类别显示为「未分类」；
- 计数：**不计入 BUG 数 / 建议数**，但见 §3.4（是否上提示由用户定）。

> 现在未关闭 issue 里就有一条 `未分类`（联调测试 #8，清理后归零）——所以这条规则不是假想，是当下就会遇到的。

**两个数的统计口径**（`issue.tooltip.counts`）：

```text
BUG 数 = 未关闭 且 带 bug
建议数 = 未关闭 且 带 enhancement       ← 只数「建议」；「优化」不计入
```

`优化` / `提问` / `未分类` **只出现在列表里**，不计入这两个数（用户 2026-10-11 拍板）。

> 默认选中 **BUG**，因为它是大多数人的来意。

**两个数的统计口径**（`issue.tooltip.counts`）：

```text
BUG 数 = 未关闭 且 带 bug
建议数 = 未关闭 且 带 enhancement       ← 只数「建议」；「优化」不计入
```

`优化` / `question` **只出现在列表里**，不计入这两个数（用户 2026-10-11 拍板）。

> ⚠️ 不要拿"BUG 数 0"当故障：现有 3 条真实玩家 issue（#1/#2/#3）全是**安装与使用疑问**，已按 §3.3 补成 `question`，所以两个数本来就是 0。这是真实情况，不是统计错了。


### 3.2 机器自动追加的 label

| label | 颜色 | 何时打 |
| --- | --- | --- |
| `来源:启动器` | `1d76db` | **每一条启动器提交都打** |
| `待确认` | `cfd3d7` | **每一条启动器提交都打**（见 §8.3：你处理完就去掉） |

`来源:启动器` 是不可省的：**所有 issue 的作者都是 token 所有者（你自己）**，没有这个 label，你分不出"玩家提的"和"自己开的"。

### 3.3 label 现状与创建

已有（GitHub 默认，直接用，**不要重建**）：`bug` `documentation` `duplicate` `enhancement` `good first issue` `help wanted` `invalid` `question` `wontfix`。

本轮已新建（2026-10-11，仓库 `kirito0000001/CrossingVoid`）：

| 名称 | 颜色 | 描述 | 状态 |
| --- | --- | --- | --- |
| `来源:启动器` | `1d76db` | 玩家通过零境启动器提交的反馈 | ✅ 已建 |
| `安装与更新` | `d93f0b` | 安装、更新、启动前失败 | ✅ 已建 |
| `需补充信息` | `fbca04` | 缺少环境信息或描述不足以复现 | ✅ 已建 |
| `待确认` | `cfd3d7` | 启动器提交，仓库主尚未过目 | ✅ 已建（GitHub 在首次引用时自动创建，无需手动建） |
| `优化` | `a2eeef` | 现有功能的体验改进 | ✅ 已建（4 个类别之一，见 §3.1） |
| `未分类` | `ededed` | 不是从启动器提交、尚未归入四类 | ✅ 已建（见 §3.4） |

**老 issue 补标（2026-10-11 已执行，用户确认）**：

| issue | 补的 label | 理由 |
| --- | --- | --- |
| #1 安装提示系统不支持32位系统 | `question` + `安装与更新` | 安装类提问 |
| #2 不知道该把这个放在哪里 | `question` | 使用提问 |
| #3 怎么解压 part001 | `question` | 使用提问 |

> 补标用的是 `POST /issues/{n}/labels`（追加，**不是** PATCH、不会覆盖原有 label），实测 3/3 HTTP 200。
> **不要用 PATCH 补标签**——该端点在实测中系统性失效，见 §9.1。

### 3.4 `未分类`：网页直提的 issue 怎么归置

**成因**：GitHub 的 issue 页面是公开的，任何人（包括不愿意用启动器的玩家、外国玩家、搜索引擎来的路人）
都能直接开 issue，那种 issue 没有 `来源:启动器`，也没有四条类别里的任何一条。

**判定规则（服务端/启动器统一用这一条）**：

```text
类别 = labels ∩ {bug, enhancement, 优化, question} 中的第一个命中项
       一个都没命中 → 「未分类」
```

**GitHub 侧的处理**：人工。看到新的网页 issue 就按内容补一个类别标签，或补 `未分类` 留着以后处理。
这是**唯一**需要人工参与的分类动作（启动器提交的那部分由服务器自动打标，见 §3.2）。

**启动器侧的处理**：

| 项 | 行为 |
| --- | --- |
| 列表 | **照常显示**，类别列/徽标写「未分类」（不要因为它没有类别就把它藏起来——玩家可能关心的正是别人提过的问题） |
| 排序 | 与其它类别一视同仁，按 `updated_at` 倒序 |
| 计数 | 不计入 BUG / 建议数（见 §3.1） |

**建议后续加的服务端小任务**（不在第一期，先记着）：
定时（或每次刷新缓存时）列出 `state=open` 且四类都不沾的 issue，自动追加 `未分类`。
这样"漏分类"不会悄悄积压——不过 `POST /issues/{n}/labels` 是稳定端点，这个任务技术上没有障碍。



> 颜色格式：官方 spec 要求「6-character hex code, **without the leading `#`**」。
> ⚠️ **建 label 用 PowerShell 5.1 会把中文写成 `?`**（实测：请求体被按 ANSI 编码，标签变成 `??:???`，字符码 `63,63,58,63,63,63`）。
> 正确做法见文末附录的脚本（用 `HttpWebRequest` + `UTF8.GetBytes` 直接写字节流）。
> 另：给 issue 传一个**不存在的 label 名**时，GitHub 会自动创建该 label（本轮 `待确认` 就是这么来的）。

---

## 4. 表单字段规范

玩家只需要填 3 项（越少越好）：

| 字段 | 控件 | 校验 | 说明 |
| --- | --- | --- | --- |
| 类别 | 单选，默认 BUG | 必选 | §3.1 的四选一 |
| **昵称** | 单行文本 | 必填，**2–16 字** | 只用来在正文里署名（见 §5）。**必须持久化并预填**：玩家第二次提交时不用再想。存 `localStorage`（键 `crossing-void.launcher.feedback-nickname`），与现有偏好同一套路 |
| 标题 | 单行文本 | 必填，去空白后 **4–60 字** | 占位提示写"什么情况下出的问题"，例如"进入战斗后闪退" |
| 描述 | 多行文本 | 必填，**≥20 字** | 占位提示三句话：你做了什么 → 你期望什么 → 实际发生了什么 |

> **昵称为什么不做成 label**：GitHub label 名有长度与字符限制，而玩家昵称可能带空格、表情、超长；
> 而且每次新昵称都会**污染仓库的 label 列表**。所以昵称只写进正文（用户 2026-10-11 拍板："当成标签打进正文就行"）。
> 另外 token 也**没有建任意 label 的权限**（label 用 `issues:write` 建，实测个别场景会 404）。

机器自动附带（**可折叠、可取消勾选，提交前必须让玩家看到最终文本**）：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 启动器版本 + 游戏版本 | ✅ | 来自 `package.json` / 本地版本文件 |
| 游戏状态 + 下载源 | ✅ | 现成的 `launcherState` / `downloadSource` |
| 系统信息 | ✅ | `navigator.userAgent`（含 Windows 版本） |
| **安装目录** | ⚠️ **必须脱敏** | 形如 `C:\Users\<用户名>\...` 的片段替换为 `C:\Users\<用户>\...`，否则会泄漏玩家的 Windows 用户名 |
| 最近 3 条错误日志摘要 | ❌ | 玩家主动勾选才附加；日志全文不塞正文，需要时让玩家去日志目录取（`open_launcher_log_folder`） |

---

## 5. 输出格式（服务器拼装）

### 标题

```text
[类别前缀] 玩家填写的标题
```

例：`[BUG] 进入战斗后闪退`、`[提问] 安装提示系统不支持32位系统`。

前缀用**半角方括号 + 一个空格**，与现有 issue 的 `【BUG】` 风格一致但更适合 GitHub 搜索（`[BUG]` 在 GitHub 搜索里可当普通词用）。

### 正文模板

````markdown
## 问题描述
{玩家填写的描述}

## 提交者
{玩家昵称}

## 运行环境
- 启动器版本：{launcherVersion}
- 游戏版本：{gameVersion}
- 游戏状态：{launcherState}
- 下载源：{downloadSource}
- 安装目录：{redactedInstallPath}
- 系统信息：{userAgent}

<!-- 下面两节仅在玩家勾选"附带错误日志"时出现 -->
## 最近错误日志

```text
{最多 3 条摘要}
```
````

**关于"提交者"这一节**：所有 issue 的作者都会显示成 **token 所有者（你自己）**，GitHub 上没有"代提交"这个概念，
所以**玩家的名字只能写进正文**——这也是 §3.2 那个 `来源:启动器` 标签存在的原因（用来区分玩家反馈和你自己开的 issue）。
落款只写昵称，**不要**写邮箱、QQ 号这类可识别信息（对齐 openEuler 后期改用遮蔽邮箱的做法，见
`Docs/research/2026-10-11-gitee-issue-submission.md` §2.6）。


### 提交后

服务器回 `{ number, html_url }`，启动器：

1. 显示成功 + **可点击的 issue 链接**（走系统浏览器打开）；
2. 明确告知"回复会出现在 GitHub 上，可以用「来源:启动器」标签或那行邮箱片段筛出来"；
3. 失败时**显示真实原因**（GitHub 的 HTTP 状态 + message），不允许一句"提交失败"了事。

---

## 6. 服务端接口

沿用现有域名与前缀风格（`https://www.crossingvoid.top/api/toolbox-updates/...`）：

| 方法 | 路径 | 用途 | 认证 |
| --- | --- | --- | --- |
| `POST` | `/api/toolbox-updates/feedback` | 玩家提交 | 无（限频 + 校验） |
| `GET` | `/api/toolbox-updates/issues` | 列表（分页、按状态筛） | 无 |
| `GET` | `/api/toolbox-updates/issues/{number}` | 详情 + 评论 | 无 |

### 6.1 提交

请求（只收玩家填的，环境信息由服务器按需从请求里取，避免客户端伪造过多字段）：

```json
{
  "category": "bug | suggestion | improvement | question",
  "nickname": "玩家昵称",
  "title": "进入战斗后闪退",
  "description": "...",
  "environment": { "launcherVersion": "...", "gameVersion": "...", "launcherState": "...", "downloadSource": "...", "installPath": "...", "userAgent": "..." },
  "includeLogs": false,
  "deviceId": "stable-uuid"
}
```

响应：

```json
{ "ok": true, "number": 12, "url": "https://github.com/kirito0000001/CrossingVoid/issues/12" }
```

### 6.2 读取

- 列表字段只回必要的：`number / title / state / category / labels / created_at / updated_at / comments / html_url`。
- **不要**把 GitHub 原始响应整个透传（字段太多、且会暴露内部结构）。
- 分页参数 `page` / `per_page`（默认 20，上限 50）。
- **只返回 `state=open`**（用户 2026-10-11 拍板：只显示未完成的）。

### 6.3 评论（只读）

| 动作 | 端点 | 状态 |
| --- | --- | --- |
| 读评论 | `GET /repos/{o}/{r}/issues/{n}/comments` | ✅ 实测 200（issue #4 读到 1 条） |
| 评论数 | 列表/详情里的 `comments` 字段**直接就有** | ✅ 不用额外请求 |
| 发评论 | `POST …/comments` | ✅ 实测稳定（5/5 = 201；评论正文也是稳定端点） |

**启动器侧只读、不给玩家评论**（用户 2026-10-11 拍板："issue 提了就不用更改了"）。
理由不只是产品选择：**评论能用，但 issue 的修改（PATCH）在实测里系统性失效**（见 §9.1），
所以"只读评论 + 只允许新建"正好落在**已验证稳定**的那两个端点上。

实现建议：
- 列表接口**不要**顺带拉评论（N+1 请求）；详情接口返回 `comments` 计数，玩家真正展开评论时再拉 `GET …/comments`，并缓存 5 分钟；
- 评论里显示 `作者 / 时间 / 正文`；GitHub 的 Markdown 直接当纯文本或简单渲染（**不要**引入 Markdown 库去渲染任意 HTML）。


---

## 7. 缓存、额度与降级

### 7.1 额度账（2026-10-11 实测确认）

| 通道 | 额度 | 依据 |
| --- | --- | --- |
| 服务器带 fine-grained token | **5,000 次/小时** | 玩家实测 `/rate_limit` 返回 `"core": {"limit":5000,...}` |
| Search 接口（带 token） | **30 次/分钟** | 同上，`"search":{"limit":30}` |
| 不带的调用 | 60 次/小时**按出口 IP** | 本次调研期间被吃光过两次 |

**关键结论：玩家的出口 IP 不参与 GitHub 调用。** 只要启动器只跟我们的服务器说话，60 次那档永远碰不到——这也是**必须**走服务器中转、不能让启动器直连 GitHub 读列表的原因（同 IP 的玩家会互相抢额度）。

### 7.2 缓存

| 项 | 值 | 说明 |
| --- | --- | --- |
| 列表 TTL | 5 分钟 | 按 §7.1 的账，每小时最多 12 次上游调用 |
| 详情 TTL | 5 分钟 | |
| 条件请求 | `If-None-Match` + 存 `ETag` | 官方文档称 304 不计入额度，**本次未实测成功**（被次要限制挡住），实现时留开关 |
| 单飞（single-flight） | 必需 | 缓存过期瞬间的并发请求只能有**一个**去打 GitHub，其余等结果 |

### 7.3 退避与降级

- 上游返回 403 且 message 含 `rate limit` → 退避重试（指数退避，上限 5 分钟），期间**继续用过期缓存**，不要回错误给玩家。
- 上游不可达 → 列表接口降级读 **Gitee 公开 API**（`https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues`，免 token、国内稳定，实测 `connect 0.047s`）。
- 启动器侧再兜一层：服务器不可达 → 直接读 Gitee 公开接口（`Access-Control-Allow-Origin: *`，跨域无碍）。**永远不要回退到直连 GitHub。**
- 探针：`GET /rate_limit` **本身不消耗额度**（实测额度为 0 时仍返回 200），可作健康检查；剩余 < 20% 时把 TTL 拉长到 30 分钟。

---

## 8. 垃圾 issue 与审核（刻意做得很少）

### 8.1 先分清两件事

| | 是什么 | 我们的用法 |
| --- | --- | --- |
| **主要额度** | 5,000 **次请求** / 小时（滑动小时窗，见响应 `reset`） | 用来省着调 API 的，**和防垃圾无关** |
| **次要限制** | GitHub 自己的防滥用（并发、短时高频） | 由我们控制调用节奏避免，**不是给玩家的限制** |

另外：**建一条带 label 的 issue 只算 1 次请求**（`labels` 是同一请求体里的字段）。
按 §7 的缓存账，一天的实际消耗在几十次量级，**5,000 那档根本不是约束**。

### 8.2 本期只做 3 件事

| 项 | 规则 | 定位 |
| --- | --- | --- |
| 内容校验 | 标题 4–80 字、描述 ≥20 字、正文 ≤4000 字 | **产品体验**（拦住"111"这类没法处理的提交），不是防滥用 |
| 完全重复去重 | 同 `deviceId` + 同标题同正文 → **直接返回已建的那条 issue**，不重复建 | 玩家会连点两下；变成两条重复 issue 才是真麻烦 |
| 隐私提示 | 表单里一句"请勿粘贴账号密码、Token 或完整本机路径" | 只提示、不扫描——扫描误报会拦掉合法提交（真实先例：有人会把 token 一起贴出来） |

**明确不做**（过度设计，且会拦到合法玩家）：

- ❌ IP 限频——**同一宿舍/同一宽带出口的玩家共享 IP**，一个人多提几条别人就被拦，这种"别人犯错你受罚"比垃圾 issue 更伤体验；
- ❌ 设备每日条数上限、同标题时间窗、URL 数量检查；
- ❌ 邮箱验证码（QuickIssue 那种两步验证，见 `Docs/research/2026-10-11-gitee-issue-submission.md` §2.4）——只有垃圾量真的上来才加。

> 这些限制全部在服务端，**调整不需要发新版启动器**——所以"先不做，需要时再加"是安全的。

### 8.3 兜底：`待确认` 标签（替代服务器限频）

服务器建 issue 时自动多打一个 `待确认` 标签：

- 你扫一眼是正常反馈 → 去掉 `待确认`；
- 是垃圾 → 直接关掉/删掉，不用回玩家。

比在服务器上堆限频代码划算得多：零逻辑、零误拦、一眼可筛。

### 8.4 可选：入站暂存（只在被刷时才上）

如果哪天真的被刷，再加一层"垃圾缓冲池"：

```text
提交 → 服务器检查（长度/重复/关键词）
        ├─ 正常 → 直接建 GitHub issue（带 来源:启动器）
        └─ 可疑 → 存服务器（SQLite/JSONL），**不建 issue**
                    └─ 你事后过一眼 → 放行（建 issue）或丢弃
```

代价是**你得记得去清队列**——这也是它默认不做的原因：在没有垃圾的情况下，它只是给你增加一件要惦记的事。


---

## 9. Token 与密钥

| 项 | 做法 |
| --- | --- |
| 类型 | **fine-grained PAT**，不是 classic（classic 能访问你名下**全部仓库**） |
| 权限 | `Issues: Read and write`（**唯一需要的一项**；`Metadata: Read-only` 自动附带） |
| 仓库范围 | 只勾 `kirito0000001/CrossingVoid` |
| 有效期 | 90 天，到期前轮换 |
| 存放 | **只在服务器环境变量**（例如 `CROSSINGVOID_GITHUB_TOKEN`），不进仓库、不进日志、不进客户端 |
| 用途说明 | 建 label 用同一个 token 即可（本机实测 HTTP 201 成功） |

⚠️ 已知限制（官方）：fine-grained token **不能**用于"你不是成员/不是 owner 的公开仓库"。本期仓库是自己的，没问题；**将来复用给别的项目时这条会挡路**，届时改用那个仓库 owner 的 token 或 GitHub App。

---

## 9.1 GitHub API 实测踩坑（2026-10-11 联调，**实现时必须处理**）

本轮用真实 token 跑通了建单链路（issue #6），过程中撞到三个坑，都会影响服务端代码：

### ① `PATCH /issues/{n}` 在实测里**系统性失效**（最关键的结论）

**最终观测（2026-10-11 17:4x，同一 token、同一时段）**：

| 操作 | 结果 |
| --- | --- |
| `GET /issues/{n}`（读列表/详情/评论） | ✅ 全程 **200** |
| `POST /issues`（建 issue） | ✅ **201**（空标题得 422，说明认证与端点都正常） |
| `POST /issues/{n}/comments`（发评论） | ✅ **8/8 = 201**，另测 5/5 = 201 |
| `POST /issues/{n}/labels`（追加标签） | ✅ 3/3 = **200**（老 issue 补标就是用它） |
| **`PATCH /issues/{n}`**（改标题/正文/状态） | ❌ **#6 #7 #3 #8 全部 404**；对 #8 连打 8 次 **0 成功** |

**结论：`PATCH /issues/{n}` 不能用。** 而"能用的那些端点"正好覆盖本方案的全部需求。

> 中间确实观察到过一次 `PATCH` 返回 200（17:35 左右），但随后同样的请求连续 404 —— 所以它是**不可依赖**的，
> 不能拿"偶尔能成"去设计功能。官方响应头 `x-accepted-github-permissions` 说这个端点需要 `issues=write; pull_requests=write`
> （这两项 token 都有），所以 404 不是明面上的权限不足，更像是被后台保护机制挡掉。**未查明根因**（见 §11）。

**由此确定的两条设计红线**：

1. **一次性写全**：建 issue 时把 `title` / `body` / `labels` 全部带上，**永不回头补**。
   本方案就是这么设计的，所以 PATCH 失效对功能**没有影响**。
2. **任何"以后要改状态"的功能都要重新设计**：例如"审核后放行""自动关闭""换标签"，
   不能靠 PATCH，只能用**再打一个标签**（`POST /issues/{n}/labels` 是好的）或纯人工在网页上操作。

> 附带修正一个曾经的错误推测：早期看到的"建单后立刻 PATCH → 404、过一会儿 → 200"曾被我解释成**复制延迟**。
> 现在有了更多样本，更可能的解释是**该端点整体不可靠**（延迟只是其中一个表现）。两条路线的服务端做法是一样的：
> **不要依赖 PATCH**。


### ② 短时间大量写操作会触发 GitHub 的站点级限制，返回 **HTML 而不是 JSON**

本轮连续做「建 2 条 issue + 评论 + 改标题 + 删 label + 关单」后，后续 DELETE/PATCH 返回 **HTTP 403**，
响应体是 **HTML**（`<!DOCTYPE html>... Access to this site has been restricted.`），**不是** API 的 JSON 错误。
同一时刻 `GET` 仍然 200 —— 被限制的只是写。

**恢复时间**（本次唯一一次完整观测，2026-10-11）：约 **16:45 撞上 → 17:35 恢复 = 约 50 分钟**。
⚠️ 这只是**上界**：中间 45 分钟我没有探测，真实窗口可能更短。GitHub **不提供**任何恢复时间信息
（无 `Retry-After`、响应头里也没有额度提示）。要精确测量需要"主动触发 + 从触发那刻起持续探测"，本轮未做。

服务端要求：
- **判断"是不是 GitHub 拦的"**：`Content-Type` 是 `text/html` 就说明是站点级限制，不是业务错误；
- 这种情况**不要重试**（越重试越久），把该次提交**存进暂存池**（§8.4）稍后再建，并给玩家一句"网络繁忙，稍后自动重试"；
- 玩家侧的正常使用（偶尔提一条）不会触发它——**只有批量写才会**（例如你自己一次补 20 条 issue）。
  **批量补 issue 时每次写之间留几秒间隔**，别连着打。

### ③ `x-accepted-github-permissions` 响应头可以直接告诉你缺什么权限

排查权限时不要猜，看响应头：

```text
GET   /repos/{o}/{r}/issues/{n}        ->  x-accepted-github-permissions: issues=read
PATCH /repos/{o}/{r}/issues/{n}        ->  x-accepted-github-permissions: issues=write; pull_requests=write
POST  /repos/{o}/{r}/issues/{n}/comments ->  x-accepted-github-permissions: issues=write; pull_requests=write
```

`Issues: Read and write` 这一个权限就覆盖了本方案要用的**全部能用的**端点（建单、读列表、读详情、发评论、追加标签）。
注意：头里说 `issues=write` 就够，但 `PATCH` 实际仍返回 404 —— **头只能用来排除"是不是少权限"，不能用来断言"这个端点一定可用"**。

### 本轮已验证通过的完整能力清单

| 能力 | 端点 | 实测 |
| --- | --- | --- |
| 建 issue（含 label / 中文标题正文） | `POST /repos/{o}/{r}/issues` | ✅ 201（issue #6） |
| 读列表 / 详情 | `GET /repos/{o}/{r}/issues`、`/issues/{n}` | ✅ 200 |
| 读评论 | `GET /repos/{o}/{r}/issues/{n}/comments` | ✅ 200 |
| 发评论 | `POST /repos/{o}/{r}/issues/{n}/comments` | ✅ 13/13 全部 201 |
| 追加 label（老 issue 补标） | `POST /repos/{o}/{r}/issues/{n}/labels` | ✅ 3/3 = 200 |
| 建 label | `POST /repos/{o}/{r}/labels` | ✅ 201（`优化`） |
| **改 issue（标题/正文/状态）** | `PATCH /repos/{o}/{r}/issues/{n}` | ❌ **系统性 404** |

> 建 issue 的实测样例：`{ title: "[BUG] …", body: "<§5 模板>", labels: ["bug","来源:启动器","待确认"] }`
> → 三条 label 全部正确落上（含当时尚不存在的 `待确认`，GitHub 自动创建）。


---

## 10. 启动器侧改动点（实现时看这一节）

| 位置 | 改动 |
| --- | --- |
| `src/launcherData.ts` | `bug-report` 快捷入口的语义从"打开 Gitee issues"改为"打开反馈面板"；`tests/quickLinks.test.ts` 里那条 URL 断言需要同步更新 |
| 新增组件 | 反馈面板（类别单选 + 标题 + 描述 + 环境信息折叠区 + 提交结果），沿用现有弹窗样式（注意：**样式必须由渲染该 DOM 的组件自己 scoped 引入**，见指南 §25 那次"设置页弹窗点了没反应"的教训） |
| 新增 `src/feedback.ts` | 拼标题前缀、拼正文模板、安装目录脱敏、`deviceId` 生成与持久化 |
| issue 列表 | 复用 `GET /issues`，分页 + 本地缓存；**不直连 GitHub** |
| i18n | 四类别的文案要进 `src/i18n/launcherText.ts`（现有 4 种语言：简中/繁中/EN/JP） |
| 回归测试 | 至少覆盖：类别→label/前缀映射、脱敏函数、正文模板、限频参数、失败时错误可见 |

---

## 11. 分期与待验证

### 11.1 分期（2026-10-11 用户拍板：**先做读取侧**）

**第一期 · 读取 —— ✅ 已实现（2026-10-11）**

| # | 内容 | 落地位置 |
| --- | --- | --- |
| 1 | Rust 只读通道：未关闭列表 + 两个计数 + 详情 + 评论读取/发表 + 磁盘缓存 | `src-tauri/src/feedback.rs`（提交 `7d338c7`） |
| 2 | 前端数据层：类型、invoke 封装、类别/计数/时间规范化 | `src/feedback.ts` |
| 3 | 悬停提示三行（引导语 + BUG 数 + 建议数） | `src/App.vue` + `src/styles/titlebar.css` |
| 4 | 进零境页面自动弹出提示一次、停 8 秒 | `src/App.vue` 的 `showFeedbackAutoTipOnce()` |
| 5 | 反馈面板：可滚动列表、只显示未关闭、点进详情看正文与评论、可发表评论、**不可修改** | `src/components/FeedbackPanel.vue` + `src/styles/feedback-panel.css`（提交 `1ed021e`） |
| 6 | 4 种语言 × 22 条文案；`t()` 支持 `{count}` 占位符 | `src/i18n/launcherText.ts` |
| 7 | 回归测试 | `tests/feedbackPanel.test.ts`、`tests/launcherTextModule.test.ts`、`feedback.rs` 单测 |

**验证记录**：`npm.cmd test` 234 通过、`npm.cmd run build` 通过、`cargo test` 52 通过。

**第二期 · 写入 —— ✅ 已实现（2026-10-11，方案 B：走自建服务器）**

| # | 内容 | 落地位置 |
| --- | --- | --- |
| 8 | 反馈表单：类别单选 + 昵称（`localStorage` 持久化）+ 标题 + 描述 + 环境信息 | `src/components/FeedbackPanel.vue`（提交 `9115c08`） |
| 9 | 建 issue：校验 + 模板 + 标签一次带齐 | `src-tauri/src/feedback.rs` 的 `prepare_issue_submission` / `submit_feedback_issue`（提交 `9744abb`、`78c1699`） |
| 10 | 服务器中转端点 | `Scripts/Server/IssueFeedbackServer.ps1` + `Install-IssueFeedbackServer.ps1`（提交 `8bb8303`） |
| 11 | 客户端改走服务器，令牌彻底移出玩家机器 | `feedback.rs`（提交 `fef8f25`） |

### 服务器中转（方案 B）的实际部署

**架构沿用服务器既有约定**：一条功能 = 一个本机监听端口 + 一条 IIS URL Rewrite 反代规则
（同 `LauncherDiagnostics` :51988、`MinecraftPerformanceReceiver` :51989）。

```text
IIS (www.crossingvoid.top:80/443)
  └─ /api/issue-feedback/*  →  http://127.0.0.1:51990/api/issue-feedback/{R:1}
                                 └─ PowerShell HttpListener（计划任务 CrossingVoidIssueFeedback，SYSTEM / 开机启动）
                                      └─ GitHub API（令牌只在服务器上）
```

| 项 | 值 |
| --- | --- |
| 服务目录 | `C:\Users\Administrator\Desktop\OSSAPI\IssueFeedback\IssueFeedbackServer.ps1` |
| 令牌文件 | `C:\ProgramData\CrossingVoidIssueFeedback\github-token.txt`（ACL 只给 SYSTEM + Administrators） |
| 监听 | `http://127.0.0.1:51990/` |
| 计划任务 | `CrossingVoidIssueFeedback`（SYSTEM、开机 + 每 6 小时重启、崩溃重试 3 次） |
| 日志 | `C:\ProgramData\CrossingVoidIssueFeedback\service.log`、`attempts-<日期>.jsonl` |

**接口**：`GET /health`、`GET /issues`、`GET /issues/{n}`、`GET /issues/{n}/comments`、
`POST /issues`、`POST /issues/{n}/comments`；写请求需带 `productKey: crossingvoid-launcher-pc`。

**为什么令牌必须留在服务器**：GitHub 不接受匿名建 issue，而令牌一旦放进玩家机器就等于公开
（classic token 能访问名下**全部仓库**）。服务器侧用 fine-grained PAT，只勾 `CrossingVoid` 一个仓库 + `Issues: Read and write`。

**部署踩过的两个坑（都会重犯，记下来）**：
1. **远端 PowerShell 5.1 按 ANSI 读脚本** → 含中文的 `.ps1` 语法报错。部署后必须转 UTF-8 **with BOM**，并用
   `[Parser]::ParseFile()` 自检语法。
2. **`Add-WebConfigurationProperty -Value @{...}` 建 IIS 规则不可靠**：规则建出来了但 `match.url` 为空，
   IIS 匹配不到任何请求 → 公网 500（而本机直连 51990 正常）。可靠做法是用 XML 片段建规则并**回读校验** `match.url`；
   见 `Install-IssueFeedbackServer.ps1`。

**实测（2026-10-11，本机无任何令牌）**：`live_create_issue` 经服务器真实建单成功 →
`issues/11`，标签 `["question","来源:启动器","待确认"]`。

### 仍未解决

- **issue 的修改/删除仍然只能人工**：`PATCH`/`DELETE` 在实测里持续 403（§9.1 的站点级限制，
  只卡写不卡读）。所以「关掉联调 issue」这类收尾动作得在网页上点。
- **服务器侧还没有缓存**：现在每次读都直连 GitHub（5000/小时够用，但玩家多了值得加 5 分钟缓存）。



### 11.2 待验证 / 未决

1. ~~fine-grained token 能否建 issue~~ → ✅ **已验证**（2026-10-11 建了 #6，labels 一并落上）。
2. **`PATCH /issues/{n}` 为什么系统性 404** —— 未查明根因。下一步可试：给 token 加一项 `Contents: Read and write` 后重测（社区有"`issues:write` 有时要配 `contents:write`"的说法）。**但即使修好，设计也不依赖它**（§9.1 红线 1）。
3. **304 不计额度**：官方文档有这条，本次被限制挡住没验成。
4. **阿里云到 `api.github.com` 的稳定性**：本机实测 20/20 成功，但**服务器侧未测**；实现时把"首次探测 + 失败降级"写进去。
5. **评论回传**：玩家提交后有人回复，启动器如何提醒？本期不做（玩家可在详情里自己看评论）。
6. ~~老 issue 补标~~ → ✅ **已执行**（#1 `question`+`安装与更新`、#2/#3 `question`）。
7. **测试残留**：issue #7（标题被我探针改成 `probe`）与 #8（含 16 条探针评论）是联调产物，**待清理**。清理需用 `DELETE`（受 §9.1 限制影响，可能要等一会儿或手动在网页删）。


---

## 附：可复现的建 label 命令（PowerShell 5.1 必须这样写）

```powershell
$env:GH='<你的 fine-grained token>'
function Invoke-GhJson {
  param([string]$Method,[string]$Url,[string]$Json)
  $req=[System.Net.HttpWebRequest]::Create($Url)
  $req.Method=$Method; $req.UserAgent='crossingvoid'; $req.Accept='application/vnd.github+json'
  $req.Headers.Add('Authorization',"Bearer $env:GH")
  $req.ContentType='application/json; charset=utf-8'
  if($Json){
    $bytes=[System.Text.Encoding]::UTF8.GetBytes($Json)   # 关键：直接写字节，不能用 Invoke-WebRequest -Body
    $req.ContentLength=$bytes.Length
    $s=$req.GetRequestStream(); $s.Write($bytes,0,$bytes.Length); $s.Close()
  }
  try{
    $resp=$req.GetResponse(); $sr=New-Object System.IO.StreamReader($resp.GetResponseStream(),[System.Text.Encoding]::UTF8)
    $body=$sr.ReadToEnd(); $sr.Close(); $resp.Close(); return @{ok=$true;code=[int]$resp.StatusCode;body=$body}
  } catch [System.Net.WebException] {
    $resp=$_.Exception.Response
    if($resp){ $sr=New-Object System.IO.StreamReader($resp.GetResponseStream(),[System.Text.Encoding]::UTF8); $body=$sr.ReadToEnd(); $sr.Close(); return @{ok=$false;code=[int]$resp.StatusCode;body=$body} }
    return @{ok=$false;code=0;body=$_.Exception.Message}
  }
}

$labels=@(
 @{ name='来源:启动器'; color='1d76db'; description='玩家通过零境启动器提交的反馈' },
 @{ name='安装与更新'; color='d93f0b'; description='安装、更新、启动前失败' },
 @{ name='需补充信息'; color='fbca04'; description='缺少环境信息或描述不足以复现' }
)
foreach($l in $labels){
  $r=Invoke-GhJson -Method Post -Url 'https://api.github.com/repos/kirito0000001/CrossingVoid/labels' -Json ($l | ConvertTo-Json -Compress)
  '{0} -> HTTP {1}' -f $l.name,$r.code
}
```

> 用 `Invoke-WebRequest` 传中文 Body 会静默变成 `?`（本次实测踩到并清理过），**建标签、建 issue 一律用上面这个函数**。
