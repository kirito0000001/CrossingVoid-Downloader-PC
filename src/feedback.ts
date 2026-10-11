import { invoke } from "@tauri-apps/api/core";

/**
 * 玩家反馈（GitHub Issue）前端数据层。
 *
 * 设计文档：`Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md`
 *
 * 这里只做三件事：类型、invoke 封装、纯函数（类别文案与规范化）。
 * 网络、缓存、限流退避都在 Rust 侧（`src-tauri/src/feedback.rs`），前端不直连 GitHub——
 * 未认证调用是按出口 IP 限 60 次/小时的，同 IP 的玩家会互相抢额度（文档 §7.1）。
 */

/** 四个类别 + 网页直提的"未分类"（文档 §3.1 / §3.4）。 */
export type FeedbackCategory = "bug" | "enhancement" | "优化" | "question" | "uncategorized";

export type FeedbackIssue = {
  number: number;
  title: string;
  category: FeedbackCategory;
  labels: string[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
};

export type FeedbackIssueDetail = FeedbackIssue & {
  body: string;
};

export type FeedbackComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
};

export type FeedbackIssueList = {
  /** 每个类别各有多少条（键是 `category` 的取值，含 `uncategorized`）。 */
  categoryCounts: Partial<Record<FeedbackCategory, number>>;
  issues: FeedbackIssue[];
  fromCache: boolean;
};

/** 类别 → i18n key。`uncategorized` 也必须有文案，否则网页直提的 issue 会显示成空白。 */
export const FEEDBACK_CATEGORY_LABEL_KEYS = {
  bug: "feedback.category.bug",
  enhancement: "feedback.category.suggestion",
  "优化": "feedback.category.improvement",
  question: "feedback.category.question",
  uncategorized: "feedback.category.other",
} as const;

/**
 * 把后端返回的类别收敛成已知值。
 *
 * 后端给未知字符串时按「未分类」处理：宁可显示"未分类"，也不要让界面出现空标签。
 */
export function normalizeFeedbackCategory(value: unknown): FeedbackCategory {
  if (typeof value !== "string") return "uncategorized";
  return value in FEEDBACK_CATEGORY_LABEL_KEYS ? (value as FeedbackCategory) : "uncategorized";
}

/** 单条 issue 的规范化（后端字段缺失时兜底，避免模板里出现 undefined）。 */
export function normalizeFeedbackIssue(raw: unknown): FeedbackIssue {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    number: Number(source.number ?? 0),
    title: typeof source.title === "string" ? source.title : "",
    category: normalizeFeedbackCategory(source.category),
    labels: Array.isArray(source.labels) ? source.labels.filter((item): item is string => typeof item === "string") : [],
    comments: Number(source.comments ?? 0),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
    htmlUrl: typeof source.htmlUrl === "string" ? source.htmlUrl : "",
  };
}

/** 计数只认后端给的数字；越界或非数字一律归零（界面显示 0 比显示 NaN 好）。 */
export function normalizeIssueCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function normalizeFeedbackIssueList(raw: unknown): FeedbackIssueList {
  const source = (raw ?? {}) as Record<string, unknown>;
  const rawCounts = (source.categoryCounts ?? {}) as Record<string, unknown>;
  const categoryCounts: Partial<Record<FeedbackCategory, number>> = {};
  for (const [key, value] of Object.entries(rawCounts)) {
    // 未知类别（后端将来新增、前端还没跟上）直接丢掉：宁可少一个筛选按钮，也不要显示空白标签。
    if (value === undefined || value === null) continue;
    if (!(key in FEEDBACK_CATEGORY_LABEL_KEYS)) continue;
    categoryCounts[key as FeedbackCategory] = normalizeIssueCount(value);
  }
  return {
    categoryCounts,
    issues: Array.isArray(source.issues) ? source.issues.map(normalizeFeedbackIssue) : [],
    fromCache: source.fromCache === true,
  };
}

/** 「全部」的条数 = 各类别之和。 */
export function totalIssueCount(list: FeedbackIssueList | null): number {
  if (!list) return 0;
  return Object.values(list.categoryCounts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/** 某个类别的条数。 */
export function categoryIssueCount(list: FeedbackIssueList | null, category: FeedbackCategory): number {
  return list?.categoryCounts[category] ?? 0;
}

/** 拉取未关闭 issue 列表与两个计数。`forceRefresh` 跳过缓存（玩家手动刷新时用）。 */
export async function fetchFeedbackIssues(forceRefresh = false): Promise<FeedbackIssueList> {
  const raw = await invoke<unknown>("fetch_feedback_issues", { forceRefresh });
  return normalizeFeedbackIssueList(raw);
}

/** 拉取单条 issue 详情（含正文）。 */
export async function fetchFeedbackIssueDetail(number: number): Promise<FeedbackIssueDetail> {
  const raw = await invoke<unknown>("fetch_feedback_issue_detail", { number });
  const issue = normalizeFeedbackIssue(raw);
  const body = (raw as { body?: unknown } | null)?.body;
  return { ...issue, body: typeof body === "string" ? body : "" };
}

/** 拉取评论列表。 */
export async function fetchFeedbackComments(number: number): Promise<FeedbackComment[]> {
  const raw = await invoke<unknown>("fetch_feedback_comments", { number });
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const source = (item ?? {}) as Record<string, unknown>;
    return {
      id: Number(source.id ?? 0),
      author: typeof source.author === "string" ? source.author : "",
      body: typeof source.body === "string" ? source.body : "",
      createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
    };
  });
}

/** 发表评论。缺少令牌时 Rust 侧会给出可读的中文错误。 */
export async function createFeedbackComment(number: number, body: string): Promise<FeedbackComment> {
  const raw = await invoke<unknown>("create_feedback_comment", { number, body });
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    id: Number(source.id ?? 0),
    author: typeof source.author === "string" ? source.author : "",
    body: typeof source.body === "string" ? source.body : "",
    createdAt: typeof source.createdAt === "string" ? source.createdAt : "",
  };
}

/** 提交表单里允许的四个类别（不含 `uncategorized`——那是网页直提的归属，不是玩家能选的）。 */
export type FeedbackSubmitCategory = "bug" | "enhancement" | "优化" | "question";

export const FEEDBACK_SUBMIT_CATEGORIES: readonly FeedbackSubmitCategory[] = [
  "bug",
  "enhancement",
  "优化",
  "question",
];

export type FeedbackEnvironment = {
  launcherVersion: string;
  gameVersion: string;
  launcherState: string;
  downloadSource: string;
  /** 形如 `C:\Users\<用户名>\...`；Rust 侧写入正文前会脱敏。 */
  installPath: string;
  userAgent: string;
  /** 玩家勾选"附带错误日志"时才有内容。 */
  recentLogs: string;
};

export type CreatedFeedbackIssue = {
  number: number;
  htmlUrl: string;
  labels: string[];
};

/**
 * 建 issue。
 *
 * 校验、模板拼装、路径脱敏都在 Rust 侧（`src-tauri/src/feedback.rs`）：
 * 那是唯一的写入路径，前端不做二次加工，避免两边规则漂移。
 */
export async function createFeedbackIssue(payload: {
  category: FeedbackSubmitCategory;
  nickname: string;
  title: string;
  description: string;
  environment: FeedbackEnvironment;
}): Promise<CreatedFeedbackIssue> {
  const raw = await invoke<unknown>("create_feedback_issue", {
    category: payload.category,
    nickname: payload.nickname,
    title: payload.title,
    description: payload.description,
    environment: payload.environment,
  });
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    number: Number(source.number ?? 0),
    htmlUrl: typeof source.htmlUrl === "string" ? source.htmlUrl : "",
    labels: Array.isArray(source.labels) ? source.labels.filter((item): item is string => typeof item === "string") : [],
  };
}

/**
 * 相对时间文案。
 *
 * 只做"多久以前"，不做日期格式化：反馈列表里玩家关心的是"这条是新的还是旧的"。
 * 超过 30 天直接给日期，避免出现"97 天前"这种没信息量的说法。
 */export function formatFeedbackAge(iso: string, now: Date = new Date()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diffMs = now.getTime() - time;
  if (diffMs < 0) return "";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just-now";
  if (minutes < 60) return `minutes:${minutes}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hours:${hours}`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `days:${days}`;
  const date = new Date(time);
  return `date:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
