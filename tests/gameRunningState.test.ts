import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.vue"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("game running state", () => {
  it("只在安装目录里认游戏进程，不再按进程名全机器匹配", () => {
    expect(rustSource).toContain("fn game_processes_for_install_with(");
    expect(rustSource).toContain("fn path_is_under(");
    expect(rustSource).toContain("QueryFullProcessImageNameW");
    expect(rustSource).toContain('"CrossingVoid-Win64-Shipping.exe"');
    // 进程名清单现在按档位从 GameIdentity 传进来，缺省仍是零境那两个名字。
    expect(rustSource).toContain("fn is_game_running(install_path: String, game: Option<GameIdentity>) -> bool");
    expect(rustSource).toContain("fn game_processes_for_install_with(");
  });

  it("运行中不再锁死主按钮，并给玩家一条强制重启的出路", () => {
    const disabledBlock = appSource.slice(
      appSource.indexOf("const primaryActionDisabled = computed("),
      appSource.indexOf("const menuActionDisabled"),
    );
    expect(disabledBlock).not.toContain("gameRunning.value");
    expect(appSource).toContain('"list_game_processes"');
    expect(appSource).toContain('"stop_game_processes"');
    expect(appSource).toContain("强制结束并启动");
  });

  it("进程查询失败不会永久停留在运行中", () => {
    expect(appSource).toContain("gameRunningCheckFailures");
    expect(appSource).toContain(
      'invoke<boolean>("is_game_running", { installPath: installPath.value, game: gameIdentityPayload() })',
    );
  });
});
