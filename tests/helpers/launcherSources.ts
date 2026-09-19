import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();

export function readSource(relativePath: string) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

export const appSource = readSource("src/App.vue");

/**
 * 按 App.vue 里 <style src> 的书写顺序取样式文件。
 *
 * 必须是这个顺序，不能按文件名排序：浏览器的层叠顺序就是标签顺序，
 * 顺序变了「先匹配到哪条规则」也会跟着变。
 */
const styleFilePaths = [...appSource.matchAll(/<style[^>]*\ssrc="([^"]+)"/g)].map(
  (match) => `src/${match[1].replace(/^\.\//, "")}`,
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

function collectTypeScriptSources(relativeDir: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(resolve(projectRoot, relativeDir), { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collected.push(...collectTypeScriptSources(relativePath));
    } else if (entry.name.endsWith(".ts")) {
      collected.push(readSource(relativePath));
    }
  }

  return collected;
}

/**
 * 整个启动器源码（App.vue + 拆出的样式 + src 下的 TS 模块）。
 *
 * 断言“某个契约存在”时用它；断言“某个东西不该出现在 App.vue 里”时仍用 appSource。
 */
export const launcherSource = [
  appSource,
  ...launcherStyleFilePaths.map((file) => readSource(file)),
  ...collectTypeScriptSources("src"),
].join("\n");
