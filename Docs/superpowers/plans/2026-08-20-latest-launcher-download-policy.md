# Latest Launcher Download Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the latest PC or Android launcher can perform network game downloads while local chunk import remains available.

**Architecture:** Both clients fail closed by rechecking their Gitee launcher manifest at every network-download boundary. Game metadata moves to schema v2 with a required `downloadReleaseTag`, and the OSS signing server independently compares the submitted launcher version with the current Gitee launcher manifest.

**Tech Stack:** Vue 3, TypeScript, Vitest, Tauri/Rust, Capacitor Android/Java, PowerShell 7, ASP.NET Core 8.

---

### Task 1: PC launcher guard

**Files:**
- Modify: `src/App.vue`
- Test: `tests/launcherUpdateGate.test.ts`
- Test: `tests/gameUpdateMetadataSource.test.ts`

- [ ] Add failing assertions that downloads and repairs call a fresh latest-version guard, OSS signing submits `launcherVersion`, local import ignores the update lock, and Github uses `downloadReleaseTag`.
- [ ] Run `npm.cmd test -- --run tests/launcherUpdateGate.test.ts tests/gameUpdateMetadataSource.test.ts tests/gameChunkImport.test.ts` and confirm failure.
- [ ] Implement the smallest client changes that satisfy those assertions.
- [ ] Re-run the focused tests and confirm success.

### Task 2: Android launcher guard

**Files:**
- Modify: `src/App.vue`
- Modify: `src/services/gameUpdate.ts`
- Modify: `src/services/downloadPlan.ts`
- Test: `tests/launcherUpdateIntegration.test.ts`
- Test: `tests/gameUpdate.test.ts`
- Test: `tests/downloadPlan.test.ts`

- [ ] Add failing tests for a fresh download guard, unlocked local import, schema v2 parsing, and required `downloadReleaseTag` use.
- [ ] Run the focused Vitest files and confirm failure.
- [ ] Implement the guard and clean v2-only parser.
- [ ] Re-run the focused tests and confirm success.

### Task 3: Game publishing contract

**Files:**
- Modify: `Scripts/Publish-GamePackageCore.ps1`
- Modify: `Scripts/Publish-GameMetadataGitee.ps1`
- Test: `tests/gamePublishing.test.ts`
- Test: `tests/gameUpdateMetadataSource.test.ts`

- [ ] Add failing assertions for `schemaVersion=2`, `downloadReleaseTag`, and absence of the legacy `releaseTag` field.
- [ ] Run the focused tests and confirm failure.
- [ ] Generate the v2 manifest before Github, OSS, and Gitee publication.
- [ ] Re-run focused publication tests and a `-DryRun` package test.

### Task 4: OSS signing enforcement

**Files:**
- Create: `Services/LauncherVersionPolicyService.cs`
- Create: `Options/LauncherVersionPolicyOptions.cs`
- Modify: `Program.cs`
- Modify: `appsettings.json`
- Modify: `ToolboxUpdateServer.csproj`
- Test: `ToolboxUpdateServer.Tests/LauncherVersionPolicyServiceTests.cs`

- [ ] Add tests proving PC/Android latest versions pass, older/missing versions fail, and an unavailable manifest fails closed.
- [ ] Run `dotnet test` and confirm failure before implementation.
- [ ] Implement cached Gitee manifest lookup and HTTP 426 enforcement before OSS signing.
- [ ] Run `dotnet test` and `dotnet build -c Release`.

### Task 5: Full verification

- [ ] Run PC `npm.cmd test`, `npm.cmd run build`, and cached MSVC `cargo test`.
- [ ] Run Android `npm.cmd test`, `npm.cmd run build`, and Gradle unit tests.
- [ ] Run server tests and Release build.
- [ ] Run `git diff --check` in each checkout and report that deployment/publication was not performed.
