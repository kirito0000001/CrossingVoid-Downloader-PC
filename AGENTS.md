# 零境启动器 PC 开发约束

1. 只修改 `D:\UnrealMap\CrossingVoidinitiator-PC` 启动器项目。
2. 不要修改、编译、停止、清理或重新打包 `D:\UnrealMap\CrossingVoid` 虚幻项目。
3. 开始工作前先读 `Docs/PCLauncherDevelopmentGuide.md`，再读相关源码与测试。
4. `Docs/launcher-logic-notes.md` 是历史记录；与现行指南或源码冲突时，以现行指南和经过测试的源码为准。
5. 不提交 `src-tauri/private`、Token、AccessKey、邮箱凭据、日志、`Saved`、游戏包、安装包或构建缓存。
6. 保留 Vue/Tauri 共享架构。界面状态放在 Vue，Windows 文件系统、进程、下载、安装和校验能力放在 Rust。
7. 修改下载、更新、修复、发布或状态恢复逻辑时，必须补充或更新回归测试。
8. 完成前至少运行 `npm.cmd test`、`npm.cmd run build` 和 `cargo test --manifest-path src-tauri\Cargo.toml`。
