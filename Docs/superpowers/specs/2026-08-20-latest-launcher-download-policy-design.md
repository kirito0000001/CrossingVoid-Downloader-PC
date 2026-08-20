# 最新启动器游戏下载许可设计

## 目标

PC 与 Android 只有当前最新版启动器可以通过 OSS 或 Github 下载、续传或修复游戏文件。启动器版本无法确认时默认禁止网络下载。本地导入游戏碎片不受该限制。

## 新协议

- Gitee 游戏清单只接受 `schemaVersion: 2`。
- Github Release 的真实标签保存为必填字段 `downloadReleaseTag`，删除旧字段 `releaseTag`。
- PC 与 Android 在每次开始网络下载前重新读取各自的 Gitee 启动器更新清单，并比较本机版本。
- PC 向 OSS `/sign-download` 请求提交 `launcherVersion`；Android 保留现有字段。
- OSS 服务端根据产品和运行平台读取对应的 Gitee 启动器清单，只有与线上最新版完全相同的版本才签发临时地址。
- 服务端无法读取最新版时失败关闭，不签发 OSS 地址。
- Github 是公开文件，无法阻止手工访问；通过不兼容的 v2 清单与下载前校验阻止旧启动器自动下载。

## 导入碎片

导入入口不读取 `launcherAccessLocked`。导入仍需读取当前 v2 游戏清单，用文件名、大小和 SHA-256 校验本地碎片，但不会请求 OSS 签名或 Github 下载地址。

## 发布契约

游戏发布脚本同时为 Windows 和 Android 生成 v2 清单，并写入 `downloadReleaseTag`。不再生成或兼容 v1 游戏清单。启动器发布后无需手工修改服务端最低版本，服务端从 Gitee 启动器清单动态读取。

## 失败处理

- 启动器清单不可达、格式错误或版本落后：提示必须更新启动器，禁止网络下载。
- OSS 版本不符：返回 HTTP 426。
- 游戏清单不是 v2 或缺少 `downloadReleaseTag`：拒绝下载和导入，明确提示清单格式错误。
- 本地碎片导入失败：保留原有中文错误日志，不回退到网络下载。
