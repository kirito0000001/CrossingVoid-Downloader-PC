import { describe, expect, it } from "vitest";

import {
  FEEDBACK_CATEGORY_LABEL_KEYS,
  formatFeedbackAge,
  normalizeFeedbackCategory,
  normalizeFeedbackIssue,
  normalizeFeedbackIssueList,
  normalizeIssueCount,
} from "../src/feedback";
import { launcherStyleFilePaths, readSource } from "./helpers/launcherSources";

/**
 * 玩家反馈（GitHub Issue）读取侧的回归测试。
 *
 * 设计文档：`Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md`
 * 这里只覆盖纯函数与"样式归属"这两类容易静默坏掉的地方；网络部分在 Rust 侧有单测。
 */

describe("feedback category mapping", () => {
  it("accepts the four launcher categories plus uncategorized", () => {
    expect(normalizeFeedbackCategory("bug")).toBe("bug");
    expect(normalizeFeedbackCategory("enhancement")).toBe("enhancement");
    // 「优化」是后端的原样中文字面量（标签名就是中文），不能被当成未知值。
    expect(normalizeFeedbackCategory("优化")).toBe("优化");
    expect(normalizeFeedbackCategory("question")).toBe("question");
    expect(normalizeFeedbackCategory("uncategorized")).toBe("uncategorized");
  });

  it("falls back to uncategorized for unknown or missing values", () => {
    expect(normalizeFeedbackCategory(undefined)).toBe("uncategorized");
    expect(normalizeFeedbackCategory(null)).toBe("uncategorized");
    expect(normalizeFeedbackCategory("")).toBe("uncategorized");
    // 后端将来加类别而前端没更新时，宁可在界面上显示"未分类"，也不要留空白。
    expect(normalizeFeedbackCategory("documentation")).toBe("uncategorized");
  });

  it("has a translation key for every category", () => {
    for (const category of ["bug", "enhancement", "优化", "question", "uncategorized"] as const) {
      expect(FEEDBACK_CATEGORY_LABEL_KEYS[category]).toMatch(/^feedback\.category\./);
    }
  });
});

describe("feedback list normalization", () => {
  it("keeps counts and issues from a well-formed payload", () => {
    const list = normalizeFeedbackIssueList({
      bugCount: 2,
      suggestionCount: 1,
      fromCache: true,
      issues: [
        {
          number: 12,
          title: "[BUG] 进入战斗后闪退",
          category: "bug",
          labels: ["bug", "来源:启动器"],
          comments: 3,
          createdAt: "2026-10-11T08:00:00Z",
          updatedAt: "2026-10-11T09:00:00Z",
          htmlUrl: "https://github.com/kirito0000001/CrossingVoid/issues/12",
        },
      ],
    });

    expect(list.bugCount).toBe(2);
    expect(list.suggestionCount).toBe(1);
    expect(list.fromCache).toBe(true);
    expect(list.issues).toHaveLength(1);
    expect(list.issues[0].category).toBe("bug");
    expect(list.issues[0].comments).toBe(3);
  });

  it("never produces NaN or negative counts", () => {
    expect(normalizeIssueCount(undefined)).toBe(0);
    expect(normalizeIssueCount("abc")).toBe(0);
    expect(normalizeIssueCount(-5)).toBe(0);
    expect(normalizeIssueCount(2.7)).toBe(2);

    const list = normalizeFeedbackIssueList({ bugCount: "x", suggestionCount: null, issues: null });
    expect(list.bugCount).toBe(0);
    expect(list.suggestionCount).toBe(0);
    expect(list.issues).toEqual([]);
    expect(list.fromCache).toBe(false);
  });

  it("fills missing issue fields so the template never renders undefined", () => {
    const issue = normalizeFeedbackIssue({ number: "7" });
    expect(issue.number).toBe(7);
    expect(issue.title).toBe("");
    expect(issue.category).toBe("uncategorized");
    expect(issue.labels).toEqual([]);
    expect(issue.htmlUrl).toBe("");
  });
});

describe("feedback relative time", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("formats recent times as minutes and hours", () => {
    expect(formatFeedbackAge("2026-10-11T11:59:40Z", now)).toBe("just-now");
    expect(formatFeedbackAge("2026-10-11T11:45:00Z", now)).toBe("minutes:15");
    expect(formatFeedbackAge("2026-10-11T09:00:00Z", now)).toBe("hours:3");
  });

  it("switches to days, then to an absolute date past 30 days", () => {
    expect(formatFeedbackAge("2026-10-08T12:00:00Z", now)).toBe("days:3");
    expect(formatFeedbackAge("2026-06-01T12:00:00Z", now)).toBe("date:2026-06-01");
  });

  it("returns an empty string for unparsable or future times", () => {
    expect(formatFeedbackAge("", now)).toBe("");
    expect(formatFeedbackAge("not-a-date", now)).toBe("");
    // 客户端时钟比 GitHub 慢时会出现"未来时间"，不能显示成负数天前。
    expect(formatFeedbackAge("2026-10-12T12:00:00Z", now)).toBe("");
  });
});

describe("feedback panel style ownership", () => {
  it("keeps the feedback stylesheet in the component that renders it", () => {
    // 与「设置页弹窗点了没反应」同一条教训（指南 §25）：样式必须由渲染那段 DOM 的组件
    // 自己 scoped 引入；App.vue 再引一份只会让 data-v 哈希对不上。
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    const importedByPanel = [...panelSource.matchAll(/<style[^>]*\ssrc="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(importedByPanel.some((path) => path.includes("feedback-panel.css"))).toBe(true);

    const importedByApp = [...readSource("src/App.vue").matchAll(/<style[^>]*\ssrc="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(importedByApp.some((path) => path.includes("feedback-panel.css"))).toBe(false);

    // 面板根节点的类名必须与样式文件里的选择器一致，否则整份样式静默失效。
    expect(panelSource).toContain('class="feedback-mask"');
    expect(panelSource).toContain('class="feedback-panel"');
    expect(readSource("src/styles/feedback-panel.css")).toContain(".feedback-mask");
    expect(readSource("src/styles/feedback-panel.css")).toContain(".feedback-panel");
    expect(launcherStyleFilePaths).toContain("src/styles/feedback-panel.css");
  });

  it("only ever calls the four read/comment commands", () => {
    // 实测 PATCH /issues/{n} 系统性失效（文档 §9.1），所以前端不允许出现"改 issue"的命令调用。
    // 断言放在命令名上（而不是搜 "edit" 这种子串——它会撞上 dispatchEvent）。
    const source = readSource("src/feedback.ts");
    const invoked = [...source.matchAll(/invoke<[^>]*>\("([a-z_]+)"/g)].map((match) => match[1]);
    expect(invoked.sort()).toEqual([
      "create_feedback_comment",
      "fetch_feedback_comments",
      "fetch_feedback_issue_detail",
      "fetch_feedback_issues",
    ]);
    for (const command of invoked) {
      expect(command.startsWith("fetch_feedback_") || command === "create_feedback_comment").toBe(true);
    }
  });

  it("renders the issue body and comments as plain text", () => {
    // GitHub 的 Markdown 直接当纯文本渲染：不引入 Markdown 库去渲染任意 HTML（文档 §6.3）。
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    expect(panelSource).toContain("<pre v-if=\"activeIssue.body\"");
    expect(panelSource).toContain("<pre class=\"feedback-comment-body\">");
    expect(panelSource).not.toContain("v-html");
    expect(panelSource).not.toContain("marked");
  });
});

describe("feedback quick-link tooltip", () => {
  it("reuses the single quick-link tooltip instead of stacking another one", () => {
    // 2026-10-11 现场：首版额外渲染了一个自动弹出的 tooltip，玩家看到两个提示重叠。
    // 现在三行内容画在同一个 .button-tooltip 里，靠 tip-visible 控制自动弹出。
    // 注意：窗口按钮（设置/最小化/关闭）上也各有自己的 .button-tooltip，所以只数快捷入口那一处。
    const appSource = readSource("src/App.vue");
    const quickTooltips = [...appSource.matchAll(/class="button-tooltip quick-tooltip[^"]*"/g)].map(
      (match) => match[0],
    );
    expect(quickTooltips).toHaveLength(1);

    expect(quickTooltips[0]).toContain("class=\"button-tooltip quick-tooltip\"");
    expect(appSource).toContain("'feedback-tooltip': item.key === QUICK_LINK_FEEDBACK_KEY");
    expect(appSource).toContain("'tip-visible': item.key === QUICK_LINK_FEEDBACK_KEY && feedbackAutoTip");

    // 自动弹出必须由样式类驱动：早先写成 `.feedback-tooltip:not(.tip-visible) { display: none }`
    // 会把"悬停显示"一起关掉，所以那条规则不允许回来。
    // 注意：本文件里的反引号会提前闭合模板字符串，注释里不要用它们包裹选择器。
    const titlebar = readSource("src/styles/titlebar.css");
    expect(titlebar).toContain(".button-tooltip.tip-visible");
    expect(titlebar).not.toContain("feedback-tooltip:not(.tip-visible)");
  });
});
