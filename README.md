# 零境启动器 PC

零境交错 PC 启动器源码。项目使用 Vue 3、TypeScript、Vite、Tauri 2 与 Rust，负责启动器自更新、Windows 游戏下载与修复、下载恢复、游戏启动、服务器流量保护、远程公告和开发发布工具。

## 接手前先读

- [PC 启动器制作、维护与发布指南](Docs/PCLauncherDevelopmentGuide.md)：现行架构、数据流、发布流程、制作心得和接手检查表。
- [启动器内部逻辑编写要点](Docs/launcher-logic-notes.md)：历史设计与界面调试记录，仅用于追溯，不作为现行规范。
- [AGENTS.md](AGENTS.md)：任何开发者或 AI 都必须遵守的项目边界。

最重要的规则：本仓库只维护启动器。不要修改、编译、停止、清理或重新打包 `D:\UnrealMap\CrossingVoid` 虚幻项目。

## 本地开发

环境要求：Windows、Node.js、npm、Rust/Cargo、WebView2。首次拉取后运行：

```powershell
cd D:\UnrealMap\CrossingVoidinitiator-PC
npm.cmd install
npm.cmd run tauri dev
```

前端浏览器模式仅适合检查布局；下载、安装、完整性验证、游戏启动和开发发布功能必须在 Tauri 开发版中验证。

## 验证

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri\Cargo.toml
```

## 发布边界

- GitHub 保存源码：`https://github.com/kirito0000001/CrossingVoid-Downloader-PC`
- Gitee 保存 PC 启动器更新清单与 Release：`https://gitee.com/xiaojie578/CrossingVoid-Downloader-PC`
- 游戏本体使用 OSS 官方源与 GitHub 游戏仓库，不上传到本源码仓库。
- 更新签名私钥、访问令牌、OSS 凭据、构建产物、游戏包和日志不得提交。

完整命令、清单格式和故障排查见 [Docs/PCLauncherDevelopmentGuide.md](Docs/PCLauncherDevelopmentGuide.md)。
