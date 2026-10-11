# GitHub「有时要梯子、有时不要」的原因：本机实测与机制定位

> 后续：本文结论已用于 `Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md`
> 的 §7（缓存/额度/降级）——服务器走 `api.github.com`（实测 20/20 稳定），
> 而 `github.com` 的间歇性阻断不影响 API 通道。

日期：2026-10-11（实测窗口 16:44–17:0x，全部命令可复现）
状态：**已完成实证定位**；本文只分析机制与对启动器的影响，不含实现改动。

---

## 0. 一句话结论

**不是 GitHub 挂了，也不是你网络时好时坏 —— 是 `github.com` 这一个域名在国内被按域名/按 IP 间歇性阻断，
而它的 DNS 每次给你的 IP 落在哪一段，决定了你这一次是"能开""能开但很慢"还是"完全打不开"。**

同一时刻本机实测（全部直连、绕过代理）：

| 目标 | 结果 | 含义 |
| --- | --- | --- |
| `github.com`（DNS 给 20.205.243.166） | **10/10 全部失败**，TCP 都建不起来（connect=0.000） | 当前被完全吞掉（黑洞） |
| `api.github.com`（20.205.243.168） | **20/20 全部 200**，0.28–0.7 s | 同一网段、同一提供商，却完全正常 |
| `codeload.github.com`（20.205.243.165） | 301，0.13 s connect | 正常 |
| `raw.githubusercontent.com`（185.199.x） | `Recv failure: Connection was reset` | 被 RST（比黑洞更"早"的一层） |
| `github.com` 强制走 140.82.112/113/114/121.4 | **HTTP 200 能连上，但下到 220–520 KB 就彻底停住**（read 超时） | 能连、能开始下、然后被限速掐死 |
| `github.com` 走本机代理 127.0.0.1:7897 | **10/10 成功**，1.1–5.1 s | 代理线路完全正常 |

---

## 1. 决定性实验（区分"IP 不可达"与"域名被针对"）

**方法**：`curl --connect-to` 可以把「SNI/域名」和「实际连的 IP」拆开。

```powershell
# A. 走 github.com 自己 DNS 解析到的 IP
curl.exe -sS -o NUL --noproxy '*' --max-time 8 -w "code=%{http_code} connect=%{time_connect}" https://github.com/
#   -> curl: (28) Connection timed out; code=000 connect=0.000000   （TCP 都没握上）

# B. 换成 api.github.com 的 IP，但 SNI/Host 仍然写 github.com
curl.exe -sS -o NUL --noproxy '*' --max-time 8 `
  --connect-to github.com:443:20.205.243.168:443 -w "code=%{http_code} connect=%{time_connect}" https://github.com/
#   -> code=400 connect=0.091854   （连着同一台 GitHub 边缘，TLS 0.2 s 完成，只是回了个 400）

# C. 对照：api.github.com 走它自己的 IP
curl.exe -sS -o NUL --noproxy '*' --max-time 8 -w "code=%{http_code}" https://api.github.com/
#   -> code=200
```

**读法**：B 证明「到 GitHub 边缘的网络路径是通的」；A 证明「`github.com` 自己的那个 IP 被单独吞了」。
同一个 `/24` 里，`.166` 黑洞、`.165`/`.168` 正常 → **不是整段被封，是按 IP/按域名挑着拦。**

### 1.1 另一个方向的信号：阻断形态不止一种

- `github.com` 第一轮测量时：**TCP 连上（0.107 s）、TLS 握手完成（0.215 s）、然后 0 字节、挂到超时**
  （`curl: (28) timed out with 0 bytes received`）→ 典型的 SNI 之后丢包；
- 10 分钟后再测：**连 TCP 都建不起来**（connect=0.000）→ 变成直接黑洞；
- 而 `raw.githubusercontent.com` 是**立刻 RST**。

三种形态（RST / 握手后丢弃 / 完全黑洞）在同一台机器、半小时内都出现过 —— 这就是"时好时坏"的本体。

---

## 2. 为什么"有时候不需要梯子也能用"

实测把可用的 IP 分成三类：

| 类型 | 实测表现 | 玩家感受 |
| --- | --- | --- |
| 可用 | 140.82.112.4 / 113.4 / 121.4 / 114.4：200 且能下，但几百 KB 后停住 | "能打开，但下载老是断" |
| 半通 | 20.205.243.165 / .168：能连、能握手，但对 `github.com` 的 Host 回 400 | "网页转圈，GitHub 好像抽风" |
| 黑洞 | 20.205.243.166：TCP 都建不起来 | "必须挂梯子" |

**关键在 DNS 每次给你哪一个**：本机解析器给 `github.com` 的是 `.166`（黑洞），所以"直连 = 打不开"；
而换一台机器/换一次解析拿到 140.82.x，就会"直连居然能用，只是慢"。
**同一个域名，同一个时刻，不同 IP 的天差地别 —— 这就是"有时要梯子有时不要"的直接答案。**

> 出处（一手维基源码，本次用 pwsh 取 `action=raw` 后按 UTF-8 解码）：
> https://zh.wikipedia.org/w/index.php?title=对GitHub的审查和封锁&action=raw
> 原文：「自2021年2月末起（中国两会期间），"防火长城"升级对GitHub的屏蔽措施，开始检测 `*.github.com`，
> 以及 `raw.githubusercontent.com` 域名的 SNI，并对上述域名所对应的 IP 地址的 443 端口（HTTPS 协议）
> 间歇性执行 TCP 重置攻击，或者直接封锁指定端口（强制丢包），从而出现连接重置、连接超时等错误，
> **每次封锁至少持续 3 分钟后才能正常进入网站**。这导致了 GitHub 在中国大陆的访问被严重干扰，
> **非常不稳定，时断时续**，相关干扰一直持续至今未完全解除。」
>
> 我们的验证（2026-10-11，本机真实流量）：文中的三个特征全部复现 ——
> ① 检测 SNI（§1 实验 B：换 IP 仍带 `github.com` 的 SNI，路径立刻可用）；
> ② "重置或强制丢包"两种形态都抓到了（`Recv failure: Connection was reset` 与握手后 0 字节超时）；
> ③ "时断时续"（间隔约 10 分钟，同一域名从"能连但 0 字节"变成"TCP 都建不起来"）。

---

## 3. 这个项目里还有一个放大器：启动器的代理探测

`src-tauri/src/lib.rs` 的 `system_proxy_url()` 顺序是：

```rust
["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]   // 1. 先读环境变量
    ...
    .or_else(windows_internet_proxy_url)                      // 2. 都读不到才查注册表 ProxyEnable/ProxyServer
```

本机现状（实测）：

```text
HTTPS_PROXY = http://127.0.0.1:7897     <- 存在，所以第 1 步就返回，注册表不再看
ProxyEnable = 1 ; ProxyServer = 127.0.0.1:7897
127.0.0.1:7897 listening = True
```

**推论（未做实机复现，属待验证项）**：如果某台机器上**代理软件已经关掉、但环境变量还留着**
（很多机场客户端退出时不清理环境变量），启动器会认为"代理可用"，于是每个 GitHub 请求都去撞
一个没人监听的 127.0.0.1:7897，全部走 `timeout_connect` 失败 —— 表现出来也是"时好时坏"，
而且和真实网络状况无关。
> 反向的情形更常见：玩家把开关关掉（`GITHUB_USE_SYSTEM_PROXY=false`）走直连，
> 而当天 `github.com` 恰好是黑洞 IP —— 于是"关掉代理 = 打不开"，玩家只能理解为"必须挂梯子"。

启动器现有的超时（`build_http_agent`）：

| 调用点 | connect timeout | read timeout |
| --- | --- | --- |
| GitHub 版本检查 / 下载 URL 解析 | 8 s | 8–15 s |
| 游戏包下载相关 | 12 s | 30 s |

对黑洞型阻断来说，8 s 的 connect timeout 意味着**每次失败都要白等 8 秒**；
这也是"检测很久然后失败"那类体感的来源（指南 §25 已记过同类故障）。

---

## 4. 对「反馈入口」这个决策的直接含义

| 事实（本次实测） | 结论 |
| --- | --- |
| `gitee.com` 直连：首页 200（connect 0.047 s / TLS 0.109 s）、API 200（0.043 s） | Gitee 侧**玩家不需要任何梯子**，稳定 |
| `www.crossingvoid.top` 直连 200（connect 0.254 s） | 我们自己的后端也不需要梯子 |
| `github.com` 直连：10/10 失败；走代理 10/10 成功 | 让玩家去 GitHub 提 BUG = **让玩家先学会配代理**，反馈量会被砍掉一大截 |

→ **反馈入口继续放 Gitee 是对的**（现有 `bug-report` 指向 `gitee.com/xiaojie578/CrossingVoid/issues`，
本次实测该仓库 `has_issues=True`、issue 列表可读）。
→ 而**下载源保留 GitHub 分支**也是对的（大文件走代理实测 0.81 MB/s，直连为 0），
但客户端必须把「直连失败 → 自动回退代理」做成自动的，而不是让玩家自己去猜开关。

---

## 5. 给启动器的可执行结论（供后续排期，不在本次改动内）

1. **GitHub 直连不要只用 DNS 给的第一个 IP**：实测 140.82.112/113/114/121.4 都能连上并回 200
   （只是被限速），而默认那个 `.166` 完全不可达 —— 多 IP 候选能把"打不开"变成"能下，慢"。
   注意 `ureq` 默认走系统解析、不暴露候选列表，要做需要自己解析后按 IP 直连（并保持 SNI/Host）。
2. **失败即自动回退代理**，不要让玩家理解 `settings.githubUseSystemProxy` 这个开关的含义；
   开关只作为"强制直连/强制代理"的偏好，默认行为应是自动。
3. **黑洞场景要短超时**：connect timeout 8 s → 对黑洞型阻断每次白等 8 秒；
   建议直连探测用 3–4 s，失败立刻换路径（这条与 §12.2「主按钮不允许静默咽掉点击」同源）。
4. **代理可用性要实测**（连不上就当成"没有代理"），不能只看环境变量/注册表是否存在；
   顺便解决"代理关掉了但环境变量还在"的假可用。
5. **设置页的网络检测要分别报域名**：现在只测一个目标，玩家看不出是 `github.com` 被拦还是代理有问题。

---

## 6. 复现命令（本次全部实测）

```powershell
# 1) 同一个域名，钉住不同 IP 直连（对比"能连/黑洞/限速"）
curl.exe -sS -o NUL --noproxy '*' --max-time 6 `
  --connect-to github.com:443:140.82.121.4:443 -w "code=%{http_code} connect=%{time_connect}`n" https://github.com/
#   换 20.205.243.166 / .165 / .168 / 140.82.112.4 / 113.4 / 114.4 重复

# 2) 拆分 SNI 与 IP（最干净的一组对照）
curl.exe -sS -o NUL --noproxy '*' --max-time 8 -w "code=%{http_code} connect=%{time_connect}`n" https://github.com/
curl.exe -sS -o NUL --noproxy '*' --max-time 8 --connect-to github.com:443:20.205.243.168:443 `
  -w "code=%{http_code} connect=%{time_connect}`n" https://github.com/
curl.exe -sS -o NUL --noproxy '*' --max-time 8 -w "code=%{http_code}`n" https://api.github.com/

# 3) 连续成功率（判断"成片失败"还是"偶发"）
1..20 | ForEach-Object {
  (curl.exe -sS -o NUL --noproxy '*' --ssl-no-revoke --max-time 6 -w "%{http_code}" https://api.github.com 2>&1) -join ''
}

# 4) 走代理对照
curl.exe -sS -o NUL -x http://127.0.0.1:7897 --max-time 20 -w "code=%{http_code}`n" https://github.com/

# 5) 国内对照（Gitee / 自家后端）
curl.exe -sS -o NUL --noproxy '*' --max-time 10 -w "code=%{http_code} connect=%{time_connect}`n" https://gitee.com/api/v5/repos/xiaojie578/CrossingVoid
curl.exe -sS -o NUL --noproxy '*' --max-time 10 -w "code=%{http_code} connect=%{time_connect}`n" https://www.crossingvoid.top/
```

> 备注：`%{http_code}=000` 在 curl 里代表"没拿到 HTTP 响应"，**必须结合 `%{time_connect}` 看**：
> `connect=0` = 连都没连上（黑洞）；`connect>0 && 0 bytes` = 连上了但被挂住（SNI 后丢包）。
> 只看 000 会把两种完全不同的故障混为一谈。

---

## 7. 未验证 / 待补

1. **"环境变量还在、代理已关"**这一条是代码推论，本机没有复现（本机代理确实在跑）。要验证：
   临时把 `HTTPS_PROXY` 指向一个没人监听的端口（如 7898）再点启动器的网络检测，看它是否报"代理可用"。
2. 20.205.243.x（新加坡）与 140.82.x（美国）在国际带宽上的差异没有测（本次只测了可达性与限速现象）。
3. 阻断的时间规律（维基说"每次至少 3 分钟"）本次只观察到一个 ~10 分钟窗口，
   没有做长时间采样，**不足以给出"多久恢复一次"的结论**。
