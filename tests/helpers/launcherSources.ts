import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const projectRoot = process.cwd();

export function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

export const appSource = readSource("src/App.vue");

function collectSourceFiles(relativeDir: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(resolve(projectRoot, relativeDir), { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(relativePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".vue")) {
      collected.push(relativePath);
    }
  }

  return collected;
}

/**
 * 所有组件的 <style src> 引用，按「App.vue 在前、其余组件按路径排序」的顺序收集。
 *
 * 顺序不能按文件名排：浏览器的层叠顺序就是标签顺序，
 * 顺序变了「先匹配到哪条规则」也会跟着变。
 */
export const launcherVueFilePaths = [
  "src/App.vue",
  ...collectSourceFiles("src")
    .filter((file) => file.endsWith(".vue") && file !== "src/App.vue")
    .sort(),
];

const styleFilePaths = launcherVueFilePaths.flatMap((vueFile) =>
  [...readSource(vueFile).matchAll(/<style[^>]*\ssrc="([^"]+)"/g)].map((match) =>
    relative(projectRoot, resolve(projectRoot, dirname(vueFile), match[1]))
      .split("\\")
      .join("/"),
  ),
);

/**
 * App.vue 再加上拆分出来的样式文件。
 *
 * 样式断言统一用这个来源：某条规则从 App.vue 搬到 src/styles 下时，
 * 测试不会因为文件位置变化而失效，只需要断言规则本身还在。
 */
export const launcherStyleSource = [
  appSource,
  ...styleFilePaths.map((file) => readSource(file)),
].join("\n");

export const launcherStyleFilePaths = styleFilePaths;

/**
 * 整个启动器源码（App.vue + 拆出的样式 + src 下的 TS 模块与组件）。
 *
 * 断言“某个契约存在”时用它；断言“某个东西不该出现在 App.vue 里”时仍用 appSource。
 */
export const launcherSource = [
  appSource,
  ...launcherStyleFilePaths.map((file) => readSource(file)),
  ...collectSourceFiles("src").map((file) => readSource(file)),
].join("\n");
