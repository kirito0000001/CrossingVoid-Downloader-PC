import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PLATFORM_GAMES, getGamePackageConfig } from "../src/platform/gameCatalog";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

/**
 * 多档游戏的"一个条目必须自洽"守卫。
 *
 * 这一层最容易出的错是**半接入**：勾了 `implemented` 却没填运行参数（页面能开、下载/启动按零境走），
 * 或者填了下载站产品键却没填安装目录。这里把两边的必填项钉住。
 */
describe("game runtime profile", () => {
  it("每一档接入的游戏都有完整的下载契约与本机运行参数", () => {
    const implemented = PLATFORM_GAMES.filter((game) => game.implemented);
    expect(implemented.map((game) => game.id)).toEqual(["crossing-void", "naruto-bp"]);

    for (const game of implemented) {
      const config = getGamePackageConfig(game.id);
      expect(config, `${game.id} 缺 gamePackage`).not.toBeNull();
      expect(config!.productSegment).not.toBe("");
      expect(config!.productKey).not.toBe("");
      expect(config!.versionMarker).not.toBe("");

      const runtime = game.runtime;
      expect(runtime, `${game.id} 缺 runtime`).not.toBeNull();
      expect(runtime!.installDirectoryName).not.toBe("");
      expect(runtime!.executable.endsWith(".exe"), `${game.id} 的主程序应是 .exe`).toBe(true);
      expect(runtime!.projectName).not.toBe("");
      expect(runtime!.processNames.length).toBeGreaterThan(0);
      // 主程序本身必须是进程名之一，否则"游戏运行中"永远判不出来。
      expect(runtime!.processNames[0]).toBe(runtime!.executable);
    }
  });

  it("没接入的档位不配运行参数，仍然走占位页", () => {
    for (const game of PLATFORM_GAMES.filter((item) => !item.implemented)) {
      expect(game.gamePackage, `${game.id} 没接入却有下载契约`).toBeNull();
      expect(game.runtime, `${game.id} 没接入却有运行参数`).toBeNull();
    }
  });

  it("火影这一档按下载站约定命名", () => {
    const naruto = PLATFORM_GAMES.find((game) => game.id === "naruto-bp");
    expect(naruto?.gamePackage).toEqual({
      productSegment: "naruto-bp",
      productKey: "naruto-bp-game",
      runtime: "Windows",
      versionMarker: "NarutoBP.version.json",
    });
    expect(naruto?.runtime?.installDirectoryName).toBe("NarutoBP");
  });

  it("前端把运行参数传给 Rust，Rust 侧全部字段可缺省（缺省即零境）", () => {
    expect(appSource).toContain("function gameIdentityPayload()");
    for (const field of [
      "installDirectoryName",
      "executable",
      "projectName",
      "versionMarker",
      "processNames",
    ]) {
      expect(appSource).toContain(field);
    }
    expect(rustSource).toContain("pub struct GameIdentity");
    expect(rustSource).toContain("fn executable(&self) -> String");
    expect(rustSource).toContain('const DEFAULT_GAME_EXECUTABLE: &str = "CrossingVoid.exe";');
    expect(rustSource).toContain('const DEFAULT_GAME_VERSION_MARKER: &str = "CrossingVoid.version.json";');
  });

  it("本地状态文件改名只影响新档位，零境老安装继续认老名字", () => {
    const packageSource = readFileSync(
      resolve(process.cwd(), "src-tauri/src/game_package.rs"),
      "utf8",
    );
    expect(packageSource).toContain('const STATE_FILE_NAME: &str = "launcher.game.json";');
    expect(packageSource).toContain('const LEGACY_STATE_FILE_NAME: &str = "CrossingVoid.manifest.json";');
    expect(packageSource).toContain("if legacy.is_file() {");
  });
});
