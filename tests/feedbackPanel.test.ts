import { describe, expect, it } from "vitest";

import {
  categoryIssueCount,
  FEEDBACK_CATEGORY_LABEL_KEYS,
  FEEDBACK_SUBMIT_CATEGORIES,
  formatFeedbackAge,
  normalizeFeedbackCategory,
  normalizeFeedbackIssue,
  normalizeFeedbackIssueList,
  normalizeIssueCount,
  totalIssueCount,
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
      categoryCounts: { bug: 2, enhancement: 1, question: 3, uncategorized: 1 },
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

    expect(list.categoryCounts.bug).toBe(2);
    expect(list.categoryCounts.enhancement).toBe(1);
    expect(list.categoryCounts.question).toBe(3);
    expect(list.categoryCounts.uncategorized).toBe(1);
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

    const list = normalizeFeedbackIssueList({ categoryCounts: { bug: "x", enhancement: null }, issues: null });
    expect(list.categoryCounts.bug).toBe(0);
    expect(list.categoryCounts.enhancement ?? 0).toBe(0);
    expect(list.issues).toEqual([]);
    expect(list.fromCache).toBe(false);
  });

  it("drops unknown categories from counts and totals every known one", () => {
    // 后端将来加类别而前端没跟上时，多出来的键要丢掉，否则会渲染出一个没有文案的筛选按钮。
    const list = normalizeFeedbackIssueList({
      categoryCounts: { bug: 2, 优化: 1, somethingNew: 9 },
      issues: [],
    });
    expect(list.categoryCounts.bug).toBe(2);
    expect(list.categoryCounts["优化"]).toBe(1);
    expect(Object.keys(list.categoryCounts)).not.toContain("somethingNew");

    expect(totalIssueCount(list)).toBe(3);
    expect(categoryIssueCount(list, "bug")).toBe(2);
    expect(categoryIssueCount(list, "question")).toBe(0);
    expect(totalIssueCount(null)).toBe(0);
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
      "create_feedback_issue",
      "fetch_feedback_comments",
      "fetch_feedback_issue_detail",
      "fetch_feedback_issues",
    ]);
    for (const command of invoked) {
      expect(command.startsWith("fetch_feedback_") || command.startsWith("create_feedback_")).toBe(true);
    }
    // 不允许出现任何"改 issue"的命令名（PATCH 那条路走不通，见文档 §9.1）。
    expect(source).not.toMatch(/invoke<[^>]*>\("(update|patch|edit|delete)_feedback/);
  });

  it("renders the issue body and comments as plain text", () => {
    // GitHub 的 Markdown 直接当纯文本渲染：不引入 Markdown 库去渲染任意 HTML（文档 §6.3）。
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    expect(panelSource).toContain("<pre v-if=\"activeIssue.body\"");
    expect(panelSource).toContain("<pre class=\"feedback-comment-body\">");
    expect(panelSource).not.toContain("v-html");
    expect(panelSource).not.toContain("marked");
  });

  it("uses the four submittable categories and never lets the player pick uncategorized", () => {
    // 未分类是"网页直提"的归属，不是玩家能选的类别（文档 §3.4）。
    expect([...FEEDBACK_SUBMIT_CATEGORIES]).toEqual(["bug", "enhancement", "优化", "question"]);
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    expect(panelSource).toContain("v-for=\"category in FEEDBACK_SUBMIT_CATEGORIES\"");
  });

  it("remembers the nickname and previews the redacted install path", () => {
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    // 昵称要持久化：玩家不该每次反馈都想一遍上次叫什么（文档 §4）。
    expect(panelSource).toContain("crossing-void.launcher.feedback-nickname");
    expect(panelSource).toContain("readStoredNickname()");
    expect(panelSource).toContain("rememberNickname(");
    // 提交前要把脱敏后的路径显示给玩家看（真正脱敏在 Rust 侧，这里是预览）。
    expect(panelSource).toContain("previewInstallPath(");
    expect(panelSource).toContain("<用户>");
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

  it("waits for the counts before showing the auto tip", () => {
    // 两次真实的时序事故（2026-10-11）：
    //  1. 只安排一次、且要求 isGamePageActive 当场成立 —— 不成立就再也不弹；
    //  2. 先加 tip-visible 再拉计数 —— 首次运行没有缓存，加类时模板里那个框还没渲染，等于白弹。
    // 硬约束：模板只在 feedbackCounts 有值时才画那个框，所以加类前必须先有计数。
    const appSource = readSource("src/App.vue");

    // 模板里那个框的渲染条件包含 feedbackCounts。
    expect(appSource).toContain("item.key === QUICK_LINK_FEEDBACK_KEY && feedbackCounts");

    // 加类之前必须检查计数（顺序：先判 feedbackCounts，再判页面）。
    const guardIndex = appSource.indexOf("if (!feedbackCounts.value) {");
    const tipIndex = appSource.indexOf("feedbackAutoTip.value = true;");
    expect(guardIndex).toBeGreaterThan(0);
    expect(tipIndex).toBeGreaterThan(guardIndex);

    // 计数到位时必须有人来叫它（否则首次运行永远不会弹）。
    expect(appSource).toContain("watch([feedbackCounts, isGamePageActive], () => {");

    // 计数一直不来（首次运行 + 没网）时要有截止时间，不能无限等。
    expect(appSource).toContain("feedbackAutoTipDeadline");
  });

  it("keeps every header button on the same style and puts back next to close", () => {
    // 用户 2026-10-11 实测反馈：头部按钮不要主次样式区分；「返回列表」原来在内容区左上角、
    // 紧挨类别按钮，容易点错，挪到右上角「关闭」左边。
    const panelSource = readSource("src/components/FeedbackPanel.vue");
    const header = panelSource.slice(
      panelSource.indexOf('class="feedback-head-actions"'),
      panelSource.indexOf("</header>"),
    );
    expect(header.length).toBeGreaterThan(0);
    // 头部只允许 ghost 一种按钮样式（不含主按钮 .feedback-primary）。
    expect(header).not.toContain("feedback-primary");
    expect((header.match(/class="feedback-ghost"/g) ?? []).length).toBe(4);
    // 「返回列表」出现在头部，且不是列表视图专用的那两个按钮。
    expect(header).toContain('t("feedback.back")');
    // 详情/表单区里不该再有返回按钮。
    expect(panelSource).not.toContain('class="feedback-back"');
  });

  it("plays the same enter animation as the announcement dialog", () => {
    // 学公告弹窗（.confirm-pop-*）那套节奏；样式必须跟着组件走，所以断言它在 feedback-panel.css 里。
    const css = readSource("src/styles/feedback-panel.css");
    for (const rule of [
      ".feedback-layer-enter-active",
      ".feedback-layer-leave-active",
      ".feedback-layer-enter-from",
      ".feedback-layer-leave-to",
    ]) {
      expect(css).toContain(rule);
    }
    expect(css).toContain("transform: translateY(10px) scale(0.975)");
    // App.vue 必须用这个过渡名（写成 settings-layer 就不会有动画）。
    expect(readSource("src/App.vue")).toContain('<Transition name="feedback-layer">');
  });
});

describe("feedback panel viewport rules", () => {
  it("anchors the feedback mask to the viewport, not the design canvas", () => {    // 与「背景图被裁得比设计多」（指南 §25）和 §10.5 记的规律同源：
    // 窗口的 CSS 视口可能小于 1200×675 的设计坐标（本机 150% 缩放下约 1012×571）。
    // 遮罩若用 absolute，包含块是 1200 宽的画布，居中会把面板右缘推到视口外裁掉。
    const css = readSource("src/styles/feedback-panel.css");
    // 取"规则块"而不是"第一次出现"：注释里也会提到这两个类名。
    const blockOf = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, `${selector} 规则块应存在`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("\n}", start));
    };

    const maskBlock = blockOf(".feedback-mask");
    expect(maskBlock).toContain("position: fixed");
    expect(maskBlock).not.toContain("position: absolute");

    // 面板尺寸要能随包含块收敛，避免小窗口（显示缩放后视口更窄）下面板边缘跑出屏幕。
    const panelBlock = blockOf(".feedback-panel");
    expect(panelBlock).toContain("min(900px, calc(100% - 64px))");
    expect(panelBlock).toContain("min(540px, calc(100% - 64px))");
    // 用百分比而不是 100vw/100vh：包含块就是遮罩（视口），和远程公告的写法保持一致。
    // 只检查**声明**——注释里会解释为什么不这么写。
    expect(panelBlock).not.toMatch(/(^|\n)\s*(width|height):[^;]*100v[wh]/);
  });
});
