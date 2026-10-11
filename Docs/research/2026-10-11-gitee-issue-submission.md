# 玩家快捷提交 BUG 到 Gitee Issue：可行性调研

> 后续：本调研的结论已收敛为设计方案 `Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md`
> （走自建服务器中转 + GitHub 真源；Gitee 相关结论仍留在本文作为备选与出处）。

日期：2026-10-11
状态：**调研完成，未写任何实现代码**（用户要求「先做研究，不写」）
范围：只涉及 `D:\UnrealMap\CrossingVoidinitiator-PC` 的反馈入口设计；不改 Unreal 工程。

---

## 0. 结论摘要（2026-10-11 初版 → 2026-10-13 修订）

1. **Gitee 没有匿名提交 Issue 的能力。** 官方 API 没有 token 一定 401（已实测），网页 `/issues/new` 也是登录页。
   openEuler 官方博客把这件事当痛点写得很直白（原文见 §2.1）。
2. **玩家想「零门槛提交」只有一条被验证过的路：自建中转（机器人代提交）**，
   openEuler 的 QuickIssue 就是这么做的（§2.2、§2.6）。
3. **重大发现（2026-10-13，读 QuickIssue 源码后修订）**：QuickIssue 是**双分支**的 ——
   「有平台账号」的用户走的是**预填 URL 跳转**（`.../issues/new?title=…&body=…`），**完全不经过后端**；
   只有「没账号」的用户才走邮箱验证码 + 后端代提交。
   → 所以「预填跳转」不是我们发明的折中，而是**官方同款的一等分支**。
4. **该方法在 Gitee 上同样成立**（本次实测：带 `?title=&body=` 的参数会真正进入页面，不带的会被丢弃）。
   即：启动器可以做到「玩家只按一下提交」，无需任何后端与 token。
5. 但预填跳转的**硬前提仍是玩家得有一个 Gitee 账号**。要覆盖「连账号都没有」的玩家，只有第 2 条那条路，
   且必须挂在 `crossingvoid.top` 后端（启动器里不能放 token，§5）。
6. 启动器侧已经具备做反馈的全部素材（版本 / 状态 / 安装目录 / UA / 错误日志落盘），见 §3。

---

## 1. 阶段 1 候选清单

| 来源 | 一手/二手 | 标题 / 仓库 | 链接 | 为什么相关 | 可抓性 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| openEuler 官网博客 | 一手 | QuickIssue 服务前世今生 | https://www.openeuler.org/zh/blog/georgecao/QuickIssue.html | 唯一查到把「无账号提 Issue」完整讲清的一手文章 | ✅ 直抓 | 高 |
| openEuler 官网 | 一手 | 隐私声明（h 节 QuickIssue） | https://www.openeuler.org/zh/other/privacy | 提交收集哪些字段、Issue 里显示什么 | ✅ 直抓 | 高 |
| Gitee 官方 | 一手 | Open API v5 Swagger | https://gitee.com/api/v5/swagger_doc | `POST /v5/repos/{owner}/issues` 的完整参数表 | ✅ 直抓 JSON | 高 |
| Gitee 官方 | 一手 | Issues 公开读取接口 | https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues | 实测仓库与 issue 是否开启 | ✅ 直抓 | 高 |
| Gitee 官方页面 | 一手 | 新建 Issue 页 | https://gitee.com/xiaojie578/CrossingVoid/issues/new | 确认网页路径也要求登录 | ✅ 直抓 | 中 |
| openEuler 服务 | 一手 | QuickIssue 站点 | https://quickissue.openeuler.org/zh/ | SPA，正文抓不到（54 字空壳） | 🔶 JS 空壳 | 中 |
| 第三方 SDK | 二手 | gitee-php/gitee-sdk IssuesApi | https://github.com/gitee-php/gitee-sdk/blob/main/docs/Api/IssuesApi.md | 交叉验证 `POST /v5/repos/{owner}/issues` 存在 | ✅ 直抓 | 低 |
| 第三方 | 二手（存疑） | gitee-api：存储码云私钥，代理请求 | https://gitee.com/yilingyimeng/gitee-api | 「前端直连 Gitee 必须有个后端存 token」这一模式的旁证 | ✅ 直抓 | 低 |
| Gitee 反馈区 | 一手 | 「请问，你们设定的 API 访问频率是多少？」 | https://gitee.com/oschina/git-osc/issues/I7WWW | 想查频率限制，结果只拿到 2015 年的旧答复 | ✅ 直抓 | 低（无结论） |

---

## 2. 阶段 2/3 结论（逐条带出处与验证）

### 2.1 Gitee 官方立场：必须有账号

> 出处：openEuler 博客《QuickIssue服务前世今生》（2022-11-01）
> https://www.openeuler.org/zh/blog/georgecao/QuickIssue.html
> 原文：「gitee 平台要求 issue 提交人必须使用 gitee 账号登录才能提交，而部分社区使用者没有 gitee 平台账号信息，这样也会影响 issue 提交」

**我们的验证（2026-10-11）**：`POST https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues`（表单 `title=...&body=...`，无 token）
→ `HTTP 401`，响应体 `{"message":"登录失效，无权限访问该资源","code":40001}`。
网页 `GET /issues/new` → 200，但页面含「登录」「注册」入口（未登录不可提交）。

### 2.2 QuickIssue 的做法：邮箱 + 验证码 → 机器人代提交

> 出处：同上博客
> 原文：「解决了 issue 提交人没有代码托管平台账号的问题，可以直接使用邮件和验证码完成issue提交」
> 「如果是通过邮件方式提交，QuickIssue 会根据验证码确认邮箱有效性，通过验证后将通知机器人代替提交一条 issue，
> 且如果 issue 提交后在 issue 评论区有任何评论，QuickIssue 都会贴心的将每一条评论都通过邮件通知到提交人」
> 「如果需要查找通过邮件提交的 issue，可以在提交人一栏输入邮箱前半段筛选。出于保护提交人邮箱数据隐私的目的，
> 提交人一栏记录的是提交人邮箱的一部分信息」

> 出处：openEuler 隐私声明 h 节（最近更新 2026-03-05）
> https://www.openeuler.org/zh/other/privacy
> 原文：「如果您使用邮箱提交 Issue，我们会收集您的**邮箱**、**邮箱验证码**……当您的 Issue 成功创建后，
> 我们会在该 Issue 页面的描述信息以及 Issue 看板的提交者字段展示您的 AtomGit ID 或**匿名邮箱**」

**要点（可直接照搬的产品形态）**：
- 提交人身份 = 「邮箱 + 验证码」，不是账号；
- 真正建 Issue 的是社区机器人（拿的是平台 token）；
- Issue 里把提交人写成「匿名邮箱的一部分」，用于玩家自己检索；
- 评论要能回到玩家手里，否则玩家提完就断线（QuickIssue 用邮件回传）。

### 2.3 【2026-10-13 新增】QuickIssue 是双分支：有账号走「预填跳转」，无账号才走后端

**出处（一手源码）**：openEuler QuickIssue 前端 `src/views/submit-issue/SubmitIssue.vue`
GitHub 镜像：https://github.com/openeuler-mirror/quick-issue/blob/master/src/views/submit-issue/SubmitIssue.vue
Gitee 镜像：https://gitee.com/openeuler/quick-issue/raw/master/src/views/submit-issue/SubmitIssue.vue
（两份内容一致；本次用 `Invoke-WebRequest` + Latin1→UTF8 重编码读取，长度 23827 / 23833 字节）

**原文（`goAtomGit()` 函数，逐字）**：

```js
const url = `${atomgitUrl}/${issueData.repo}/issues/new?title=${issueData.title}&body=${encodeURIComponent(issueData.description)}`;
window.open(url);
```

配套常量（`src/config/index.ts`，同一仓库）：

```ts
export const defaultIssueRepo = 'openeuler/community-issue';
export const atomgitUrl = 'https://atomgit.com';
```

**要点**：
- 表单第一个字段是「是否为AtomGit用户」（Radio，默认 true）。选「是」→ 按钮变「前往AtomGit创建Issue」，
  只做上面这句 `window.open`，**不调用任何后端接口**；
- 只有选「否」（无账号）才展开邮箱 + 验证码 + 隐私勾选，走 §2.4 的后端代提交；
- 跳转 URL 里 `title` **不编码**、`body` 用 `encodeURIComponent` —— 照抄时注意这一点（中文标题也能工作，
  但更稳的写法是两者都编码，见 §2.5 的实测）。

### 2.4 【2026-10-13 新增】无账号分支的完整流程（QuickIssue 前端源码）

| 步骤 | 调用 | 说明 |
| --- | --- | --- |
| 1 | `GET /api-issues/verify/get` | 取图形验证码，返回 `{captcha_id, src}`；用户填图片里的 6 个字符 |
| 2 | `POST /api-issues/verify/check` `{captcha_id, challenge, email}` | **同一个请求**既校验图形码、又触发发送邮件验证码；前端只做 60 秒倒计时 |
| 3 | `POST /api-issues/new-issue/` `{title, issue_type_id, email, code, repo, description, privacy}` | 成功返回 `data.number`，随后跳 `/{repo}/issues/{number}` |

字段约束（`src/shared/index.ts`）：邮箱必填 + 正则 + ≤100 字符；验证码 **6 位纯数字** `/^\d{6}$/`；
标题 ≤191 字符；附件 ≤10 MB、正文内联图 ≤2 MB；隐私声明必须勾选。

**防滥用手段汇总**：图形验证码（前置必过）→ 邮件验证码 → 前端 60 秒重发倒计时（**换邮箱会重置倒计时**）→
标题/邮箱长度上限 → 隐私强制勾选。**没有查到**后端层面的 IP 限制、每小时配额或人工审核
（响应头无 `RateLimit-*`；issue 的 `created_at` 与 `updated_at` 相差 1–2 秒，说明没有排队审核）。

### 2.5 【2026-10-13 新增】预填跳转在 Gitee 上的实测

**验证（本机 pwsh，2026-10-11 16:30 之后补测）**：请求 `GET https://gitee.com/xiaojie578/CrossingVoid/issues/new` 的三个变体：

| 请求 | 结果 |
| --- | --- |
| `/issues/new`（无参数） | 200，最终跳到 `https://gitee.com/login`，页面里没有探针字样 |
| `/issues/new?title=PROBE_TITLE_123&body=PROBE_BODY_456` | 200，最终跳到 `https://gitee.com/login`，**返回内容里同时出现 `PROBE_TITLE_123` 与 `PROBE_BODY_456`** |
| `/issues/new?issue%5Btitle%5D=PROBE_TITLE_123` | 200，只出现 `PROBE_TITLE_123`（`title` 生效、`body` 未给） |

含义：**Gitee 的新建 issue 页确实接受 `?title=` / `?body=` 预填参数**（参数被真实带进页面，不是被丢弃）；
未登录时会先跳登录页，登录后应回到带预填内容的新建页。
> ⚠️ 未验证项：**登录后预填内容是否 100% 保留**（本次没有 Gitee 登录态，无法走完最后一跳）。
> 落地前应让一个有账号的真人点一次确认。

**这一条把「预填跳转」从折中方案提升为官方同款做法**：openEuler 对有账号用户就是这么做的（§2.3）。

### 2.6 【2026-10-13 新增】匿名 Issue 在托管平台上长什么样（统计验证）

调研者在 AtomGit 的 `openeuler/community-issue` 抓了 244 条 issue 做统计：

| 指标 | 值 |
| --- | --- |
| 作者是 `openeuler-ci-bot` | 43 条 |
| 其中正文带提交人 footer | 42 条 |
| 非 bot 作者却带 footer | 0 条 |
| bot 作者但无 footer | 1 条（bot 也用于其它自动化） |

**footer 格式 A（现行，2024-09-02 起）**，位于正文最后一行、整行反引号包裹：

```text
`-- submitted by 1***@qq.com`
`-- submitted by a***@163.com`
```

规则 = 首字符 + `***` + `@` + 完整域名。
样例：https://atomgit.com/openeuler/community-issue/issues/479

**footer 格式 B（历史，2022-10 ~ 2024-08，含拼写错误 `submited`）**：把邮箱前缀**完整暴露**
（`-- submited by 1522363921@***m`，实测大量是 QQ 号/手机号），**不要照抄这种写法**。

**除此之外平台上没有任何标记**：没有来源 label、标题没有前缀、issue 记录里没有自定义字段存邮箱
（dump 过 issue #479 的全部顶层字段，匿名邮箱**只出现在 `body`**，`user` 是 bot）。

> 对我们的意义：如果将来做后端代提交，**「谁提交的」只能写进正文**，
> 而且要用格式 A（遮蔽前缀）而不是格式 B。要想让人一眼看出这是玩家反馈，得自己加 label 或标题前缀。

### 2.7 Gitee 创建 Issue 的接口契约（一手）

> 出处：Gitee Open API v5 swagger（`GET https://gitee.com/api/v5/swagger_doc`，返回 336 KB JSON，version 5.4.93）
> 路径 `POST /v5/repos/{owner}/issues`，响应码 201

| 参数 | 位置 | 必填（文档标注） | 说明（官方原文） |
| --- | --- | --- | --- |
| `access_token` | formData | 否 | 用户授权码 —— **实际必填，缺了就是 401** |
| `owner` | path | **是** | 仓库所属空间地址（个人/组织/企业 path） |
| `repo` | formData | 否 | 仓库路径（path） |
| `title` | formData | **是** | Issue 标题 |
| `body` | formData | 否 | Issue 描述 |
| `labels` | formData | 否 | 逗号分隔标签，名称长度 2–20 且非特殊字符，如 `bug,performance` |
| `assignee` / `collaborators` / `milestone` | formData | 否 | 指派 / 协助者 / 里程碑 |
| `security_hole` | formData | 否 | 是否私有 issue |

### 2.8 跨域不是障碍（实测）

`OPTIONS https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues`，带 `Origin: https://www.crossingvoid.top`
→ `200`，响应头：

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: content-type
Access-Control-Max-Age: 1728000
```

含义：**Gitee API 允许任意源的浏览器直连**，所以「自建网页反馈页 → 直连 Gitee」在跨域上可行；
真正的门槛只有 token（放在网页里同样等于公开，仍需后端）。

未带 token 的调用有频率头 `X-RateLimit-Limit: 60`；**带 token 的确切频率上限本次没查到**
（Gitee 反馈区那篇 I7WWW 只有 2015 年「还没开放 API」的答复，不构成结论）。

### 2.9 目标仓库现状（实测）

```text
GET https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid
-> 200；has_issues=True、public=True、default_branch=main

GET https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues?state=all&per_page=50
-> 200；total_count=5，现有 issue：
   IKKV03 / IKKUZ6 / IKKUY6 / IKKUXW(【风险BUG】数据传输超出字符上限) / IGUHN(【BUG】后处理渲染问题)
   全部由 xiaojie578 本人创建
```

注意：启动器「BUG 提交」按钮当前指向的就是这个仓库（`src/launcherData.ts` 的 `bug-report`，见 §3）。
另外 `https://gitee.com/xiaojie578/CrossingVoid-Downloader-PC` 在 Gitee 上 **404**（PC 源码在 GitHub，
Gitee 只有历史发布资产），所以反馈只能落到游戏仓库 `CrossingVoid`，或新建一个专门的反馈仓库。

---

## 3. 启动器现状（本仓库，已核实）

| 事实 | 位置 |
| --- | --- |
| 「BUG 提交」快捷入口 = 打开 `https://gitee.com/xiaojie578/CrossingVoid/issues` | `src/launcherData.ts`（`quickLinks` 的 `bug-report`） |
| 入口点击行为：外链打开浏览器 | `src/App.vue` 的 `openQuickLink` |
| 守卫测试：断言这个 URL 必须是该 Gitee issues 页 | `tests/quickLinks.test.ts` |
| 已有错误日志落盘命令（含版本 / 游戏状态 / 下载源 / 安装目录 / UA） | `src-tauri/src/lib.rs` `write_launcher_error_log` + `MAX_ERROR_LOG_DETAIL_BYTES = 256 KB` |
| 已有「打开启动器日志 / 打开游戏日志目录」 | `src-tauri/src/lib.rs` `open_launcher_log_folder` / `open_game_log_folder` |
| 守卫测试 | `tests/errorLogging.test.ts` |

**判断**：做「带环境信息的反馈」不需要新造采集能力，现成的日志上下文基本够用；
但 `安装目录` / `页面地址` / UA 属于本机信息，提交前必须让玩家看到并能删改（隐私）。

---

## 4. 方案对比（尚未拍板）

| 方案 | 玩家要 Gitee 账号吗 | token 放哪 | 需要后端吗 | 风险 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| **B. 预填 + 跳转**：启动器拼好正文 → `open("/issues/new?title=…&body=…")`，玩家登录后按「创建」 | 要（登录） | 不存在 | 不要 | 无（唯一的坑是预填内容可能被截断，见 §5.7） | **小（当天）** |
| **A. 中转提交（QuickIssue 模式）**：启动器填表 → `crossingvoid.top` 新接口 → 服务器用专用账号 token 建 Issue | 不要 | 服务器环境变量 | 要（IIS 加端点） | 滥用（垃圾 issue）、隐私（收邮箱）、token 泄露面 | 中～大 |
| **C. 启动器内置 token 直接调 Gitee API** | 不要 | **客户端 = 公开** | 不要 | ❌ 违反 §23「密钥与源码完全分离」，token 泄露 = 账号下全部仓库被操作 | — |
| **D. Gitee OAuth 让玩家自己授权** | 要（注册 + 授权） | 玩家自己的 token | 要（换 token + 回调） | 桌面端回调（deep-link / 本地端口）复杂；玩家仍要注册，没解决核心痛点 | 中～大 |
| **E. 干脆不用 Gitee**：站内反馈表单 / QQ 群 / 邮箱 | 不要 | 不存在 | 要（表单落库或邮件） | 反馈散落，不进 issue 流水线 | 中 |

**倾向（2026-10-13 修订，待用户拍板）**：

- **短期做 B，而且它不是"折中就一下"**：openEuler 对有账号用户用的就是这条路（§2.3），
  Gitee 侧参数也已实测可用（§2.5）。B 的产出是「玩家按下按钮 → 浏览器里已经是写好的标题+正文 → 登录 → 创建」。
- **B 与 A 不互斥**：B 是 A 的第一个分支。将来加 A，等于给「没有账号」的玩家补第二条分支，
  界面形态可以照搬 QuickIssue 那张 Radio（是/否有账号）。
- 若确认要做 A，必须先定下：专用 bot 账号、验证码或限频、Issue 模板与标签、隐私告知文案（§5）。


---

## 5. 方案 A 落地前必须解决的具体问题

1. **后端位置**：线上更新服务器 `C:\Users\Administrator\Desktop\OSSAPI\ToolboxUpdateServer\app`
   （`crossingvoid.top/api/toolbox-updates/...`，实测只挂了 `traffic-status` 等路由，`/api/toolbox-updates` 裸路径 404）。
   新端点建议 `POST /api/toolbox-updates/feedback`，由它去调 Gitee。
2. **用哪个账号的 token**：**不要用个人主账号 token**（个人 token 泄漏 = 名下全部仓库可被读写）。
   建议单独注册一个 bot 账号并只把它加成 `CrossingVoid` 仓库成员；token 只存服务器环境变量。
3. **防滥用**：QuickIssue 用邮箱验证码，本项目也可以更轻（设备指纹 + IP 限频 + 单机每日上限 + 标题/正文长度上限 +
   自动加 label）。**没有验证码就必须限频**，否则一旦被人抓到端点就是无限灌垃圾 issue。
4. **玩家怎么拿回结果**：中转提交后启动器应显示 Issue 链接（Gitee 返回的 `html_url`）并让玩家自己收藏；
   若要回传评论，得再做轮询或邮件（QuickIssue 选了邮件）。
5. **隐私与合规**：若收集邮箱，页面/启动器需要一句告知（参照 openEuler 隐私声明那句）；
   日志正文里的本机路径、Windows 用户名要在提交前脱敏或让玩家可编辑。
6. **状态可见性**：中转失败（Gitee 401/403/内容被拦/限频）必须把**真实 HTTP 状态与响应正文**回给玩家
   （对齐 §25「Gitee 检测很久后静默失败」那条教训）。
7. **【B 方案专属】预填正文会被塞进 URL 查询串**：
   - 正文要设长度上限（建议 ≤2 KB），超长内容用「复制到剪贴板」兜底；
   - 正文里不要放整份日志（日志走路径/让维护者来要），并让玩家能删改本机路径与 Windows 用户名；
   - 截图没法预填，只能玩家在 Gitee 页面自己传；
   - URL 预填**不能带 label**，所以「一眼看出是玩家反馈」只能靠**标题前缀**约定
     （沿用现有 issue 的 `【BUG】` / `【风险BUG】` 风格）。

---

## 6. 需要继续验证的空白项

1. **【B 方案唯一的拦路石】登录后预填内容是否 100% 保留**：本次只能证明参数进了页面（§2.5），
   没有 Gitee 登录态，走不完最后一跳。**落地前必须让一个有 Gitee 账号的真人点一次确认**；
   若发现长正文被截断，退路是「同时把正文写进剪贴板，提示玩家粘贴」。
2. 用**真实 token** 跑一次 `POST /v5/repos/{owner}/issues`，确认：201 之后的返回体、`html_url` 字段、
   新注册 bot 账号能否立刻建 issue（是否需要绑定手机/实名）。
3. 新建的 Gitee 小号提交 Issue 是否有「新账号限流」；带 token 的 `X-RateLimit-Limit` 是多少。
4. Gitee Issue 的**附件上传**接口本次未查；若要把启动器日志/截图作为附件上传需要它
   （QuickIssue 走的是自己的 `POST /api-issues/image/`，不是平台附件接口）。
5. 后端服务器上是否已有可复用的通用 POST 端点（需要在服务器上 `ls` 站点目录后确认）。
6. ~~QuickIssue 后端是否开源可复用~~ → **已查明：后端未开源**（服务代号 `ipb`，AtomGit/Gitee/GitHub 穷尽检索无仓库）。
   前端开源（CC-BY-SA-4.0，注意 ShareAlike 传染性），但决定「匿名提交」能否成立的后端必须自建。

---

## 7. 复现命令（本次验证）

```powershell
# 1) 仓库与 issue 现状（公开读取，无需 token）
Invoke-WebRequest -Uri 'https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid' -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0'}
Invoke-WebRequest -Uri 'https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues?state=all&per_page=50' -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0'}

# 2) 无 token 创建 issue 必然失败（预期 401）
Invoke-WebRequest -Uri 'https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues' -Method Post `
  -Body @{title='probe';body='probe'} -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0'}

# 3) CORS 头（预期 Access-Control-Allow-Origin: *）
Invoke-WebRequest -Uri 'https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid/issues' -Method Options `
  -Headers @{'Origin'='https://www.crossingvoid.top';'Access-Control-Request-Method'='POST'} -UseBasicParsing

# 4) 官方参数表
$doc = (Invoke-WebRequest -Uri 'https://gitee.com/api/v5/swagger_doc' -UseBasicParsing).Content | ConvertFrom-Json
$doc.paths.'/v5/repos/{owner}/issues'.post.parameters

# 5) 预填跳转探测（2026-10-13 补测）：未登录会被弹到 /login，
#    但返回内容里能搜到探针字样 => 参数确实被页面接受
foreach($u in @(
  'https://gitee.com/xiaojie578/CrossingVoid/issues/new',
  'https://gitee.com/xiaojie578/CrossingVoid/issues/new?title=PROBE_TITLE_123&body=PROBE_BODY_456'
)){
  $r = Invoke-WebRequest -Uri $u -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0'} -MaximumRedirection 5
  '{0} -> final={1}  title={2}  body={3}' -f $r.StatusCode,
    $r.BaseResponse.ResponseUri.AbsoluteUri,
    ($r.Content -match 'PROBE_TITLE_123'),
    ($r.Content -match 'PROBE_BODY_456')
}

# 6) QuickIssue 源码里那段预填跳转（镜像仓，raw 直取）
Invoke-WebRequest -Uri 'https://gitee.com/openeuler/quick-issue/raw/master/src/views/submit-issue/SubmitIssue.vue' `
  -UseBasicParsing -Headers @{'User-Agent'='Mozilla/5.0'} | Select-Object -ExpandProperty Content |
  Select-String -Pattern 'issues/new\?title='
```

> 注：第 4 条在 Windows PowerShell 5.1 下中文会乱码，需按 Latin1→UTF8 重编码后 `ConvertFrom-Json`；
> 本次调研已用该方式取到中文原文（见 §2.7 表）。第 6 条同理（`[Text.Encoding]::UTF8.GetString()` 处理原始流）。

