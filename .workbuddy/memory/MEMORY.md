# 项目长期记忆

## 游戏碎片分发（PC）

- 分发形态已从“散件 + 每部影片一个 zip”改为**整包 zip**：当前 `零境V0.6PC基础碎片001~003.zip`，179 个文件（含根目录 `CrossingVoid.version.json`），约 2.5GB；已全量校验通过。
- 2026-10-19 **PC 0.6.0 重发**：PC 页重新生成 + 点「发布碎片清单」原地重发 `fragments/0.6.0.json`，外层名从 `零境V0.6基础碎片001~003.zip` 改为 `零境V0.6PC基础碎片001~003.zip`。包内条目名和字节都没变（`sizeBytes` 862273823 / 846465935 / 951699870，`totalBytes` 2660439628 全部不变），所以旧名包照样按大小唯一识别（`renamed`），玩家不用重下；启动器里**没有写死任何包名**。
- 生成契约见 `Docs/GameChunkPackagingRules.md`（条目名必须等于清单 `path`、不能再套一层目录、必须包含根目录 `CrossingVoid.version.json`、标准 zip 不可加密/分卷）。
- 启动器导入入口是**多选 zip 文件**（不再选文件夹），按 `latest.json.fragmentsUrl` 拉的碎片清单渲染“应有哪几个包”并标绿；清单缺失/拉取失败时退化为选文件 + 导入后判齐。
- 清单指针：`https://dl.crossingvoid.top/games/crossingvoid/latest.json`；0.6.0 清单 179 文件，碎片清单 `fragments/0.6.0.json`（3 包 40/75/64，已按新名重发）。
- 生成方按**清单驱动**打包，不要扫目录：少文件不报错是主要风险。
