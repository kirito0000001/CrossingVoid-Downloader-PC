//! 玩家反馈（GitHub Issue）通道。
//!
//! 设计文档：`Docs/superpowers/specs/2026-10-11-player-feedback-issue-design.md`
//!
//! 为什么放在 Rust 而不是 Vue：
//! - 令牌不能进客户端渲染层，只能在原生侧读取环境变量；
//! - 磁盘缓存和限流退避属于原生能力（对齐 PCLauncherDevelopmentGuide §3.2）。
//!
//! 本轮实现**读取与评论**；建 issue（写入侧）按文档 §11.1 放到第二期。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 反馈仓库。与启动器自身仓库分开：玩家反馈进游戏仓库。
pub const FEEDBACK_REPOSITORY: &str = "kirito0000001/CrossingVoid";

/// 令牌环境变量名（按顺序取第一个非空值）。
///
/// 读取公开 issue 不需要令牌；**发表评论需要**。
/// 令牌只从环境变量读取，绝不写进仓库、日志或客户端配置。
const FEEDBACK_TOKEN_ENV: [&str; 2] = ["CROSSINGVOID_FEEDBACK_TOKEN", "GITHUB_TOKEN"];

/// 列表缓存有效期（文档 §7.2：5 分钟）。
const ISSUE_LIST_CACHE_TTL: Duration = Duration::from_secs(300);

/// 评论缓存有效期。评论更新频率高于列表，缓存短一些。
const ISSUE_COMMENT_CACHE_TTL: Duration = Duration::from_secs(300);

/// 详情缓存有效期。
const ISSUE_DETAIL_CACHE_TTL: Duration = Duration::from_secs(300);

/// 提到的 issue 数量上限：一次最多拉 100 条未关闭 issue。
///
/// 文档 §7 的额度账：单次请求即可拿到列表，不需要 Search API。
const ISSUE_PAGE_LIMIT: u32 = 100;

/// 评论正文长度上限，防止异常数据把界面撑坏。
const COMMENT_BODY_LIMIT: usize = 8 * 1024;

/// 一个类别的判定结果。
pub const CATEGORY_BUG: &str = "bug";
pub const CATEGORY_ENHANCEMENT: &str = "enhancement";
pub const CATEGORY_IMPROVEMENT: &str = "优化";
pub const CATEGORY_QUESTION: &str = "question";
/// 玩家直接去 GitHub 网页提交、四条类别都不沾的 issue（文档 §3.4）。
pub const CATEGORY_OTHER: &str = "uncategorized";

/// 能代表"这是哪一类反馈"的标签，按判定优先级排列。
///
/// 顺序即优先级：一条 issue 同时带多个时取第一个命中的。
pub const CATEGORY_LABELS: [&str; 4] = [
    CATEGORY_BUG,
    CATEGORY_ENHANCEMENT,
    CATEGORY_IMPROVEMENT,
    CATEGORY_QUESTION,
];

/// 从标签集合判定类别；四条类别都不沾时归入 `uncategorized`。
pub fn category_from_labels(labels: &[String]) -> &'static str {
    for candidate in CATEGORY_LABELS {
        if labels.iter().any(|label| label == candidate) {
            return match candidate {
                CATEGORY_BUG => CATEGORY_BUG,
                CATEGORY_ENHANCEMENT => CATEGORY_ENHANCEMENT,
                CATEGORY_IMPROVEMENT => CATEGORY_IMPROVEMENT,
                _ => CATEGORY_QUESTION,
            };
        }
    }
    CATEGORY_OTHER
}

/// 反馈列表里的一条 issue（只保留界面要用的字段）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackIssue {
    pub number: u64,
    pub title: String,
    /// 四类别之一，或 `uncategorized`。
    pub category: String,
    pub labels: Vec<String>,
    pub comments: u64,
    /// RFC 3339 原样透传，前端自己按语言格式化。
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

/// 详情 = 列表项 + 正文。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackIssueDetail {
    #[serde(flatten)]
    pub issue: FeedbackIssue,
    pub body: String,
}

/// 一条评论。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
}

/// 列表接口的返回：计数 + 条目。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackIssueList {
    /// 未关闭且带 `bug` 的数量（文档 §3.1 的统计口径）。
    pub bug_count: u32,
    /// 未关闭且带 `enhancement` 的数量。
    pub suggestion_count: u32,
    pub issues: Vec<FeedbackIssue>,
    /// 数据来自本地缓存时为 true（界面可以提示"稍后刷新"）。
    pub from_cache: bool,
}

/// GitHub 原始 issue（只声明用得到的字段；其余忽略）。
#[derive(Debug, Deserialize)]
pub(crate) struct RawIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    comments: u64,
    created_at: String,
    updated_at: String,
    html_url: String,
    #[serde(default)]
    labels: Vec<RawLabel>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawLabel {
    name: String,
}

/// GitHub 原始评论。
#[derive(Debug, Deserialize)]
struct RawComment {
    id: u64,
    #[serde(default)]
    body: Option<String>,
    created_at: String,
    user: RawUser,
}

#[derive(Debug, Deserialize)]
struct RawUser {
    login: String,
}

fn label_names(labels: &[RawLabel]) -> Vec<String> {
    labels.iter().map(|label| label.name.clone()).collect()
}

fn to_feedback_issue(raw: RawIssue) -> FeedbackIssue {
    let labels = label_names(&raw.labels);
    FeedbackIssue {
        number: raw.number,
        title: raw.title,
        category: category_from_labels(&labels).to_string(),
        labels,
        comments: raw.comments,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        html_url: raw.html_url,
    }
}

/// 从原始列表算出计数与条目。保持后端的"未关闭"顺序（GitHub 默认按创建时间倒序）。
pub fn build_issue_list(raw: Vec<RawIssue>, from_cache: bool) -> FeedbackIssueList {
    let issues: Vec<FeedbackIssue> = raw.into_iter().map(to_feedback_issue).collect();
    let bug_count = issues
        .iter()
        .filter(|issue| issue.labels.iter().any(|label| label == CATEGORY_BUG))
        .count() as u32;
    let suggestion_count = issues
        .iter()
        .filter(|issue| {
            issue
                .labels
                .iter()
                .any(|label| label == CATEGORY_ENHANCEMENT)
        })
        .count() as u32;
    FeedbackIssueList {
        bug_count,
        suggestion_count,
        issues,
        from_cache,
    }
}

/// 取令牌：只认环境变量，且不把值写进任何日志。
pub fn feedback_token() -> Option<String> {
    FEEDBACK_TOKEN_ENV.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

/// 评论正文截断，避免异常超长内容进界面。
pub fn truncate_comment(body: &str) -> String {
    if body.len() <= COMMENT_BODY_LIMIT {
        return body.to_string();
    }
    let mut end = COMMENT_BODY_LIMIT;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &body[..end])
}

/// 把 ureq 错误翻译成玩家能看懂的中文提示。
///
/// 关键判据（文档 §9.1）：
/// - 403 + `text/html` = GitHub 站点级限制（不是业务错误，**不要重试**）；
/// - 404 = 资源不可见或该端点不可用（GitHub 用它掩盖权限问题）；
/// - 401 = 令牌无效。
pub fn describe_feedback_error(context: &str, status: Option<u16>, content_type: &str, detail: &str) -> String {
    let is_html = content_type.to_ascii_lowercase().contains("text/html");
    match status {
        // GitHub 站点级限制返回的是 HTML 页面，不是 API 错误对象（文档 §9.1）。
        Some(403) if is_html => {
            format!("{}被 GitHub 临时限制（稍后再试，不要连续重试）", context)
        }
        Some(403) => format!("{}被拒绝（403）：{}", context, shorten(detail)),
        Some(404) => format!("{}不存在或不可访问（404）", context),
        Some(401) => format!("{}需要有效的 GitHub 令牌（401）", context),
        Some(code) => format!("{}失败（HTTP {}）：{}", context, code, shorten(detail)),
        None => format!("{}失败：{}", context, shorten(detail)),
    }
}

fn shorten(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 200 {
        return compact;
    }
    let truncated: String = compact.chars().take(200).collect();
    format!("{}…", truncated)
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

/// 缓存目录：`<app log dir>/feedback`。
fn feedback_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法定位启动器日志目录：{}", error))?;
    let dir = base.join("feedback");
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建反馈缓存目录 {}：{}", dir.display(), error))?;
    Ok(dir)
}

/// 读缓存：文件不存在或过期返回 None。
fn read_cache<T: for<'de> Deserialize<'de>>(path: &Path, ttl: Duration) -> Option<T> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age > ttl {
        return None;
    }
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 写缓存：失败不影响主流程（缓存是优化，不是事实来源）。
fn write_cache<T: Serialize>(path: &Path, value: &T) {
    if let Ok(text) = serde_json::to_string(value) {
        let _ = fs::write(path, text);
    }
}

/// GitHub 请求的公共设置：UA + 版本头 + 可选令牌 + 代理策略。
pub fn feedback_request(
    agent: &ureq::Agent,
    url: &str,
    token: Option<&str>,
    accept: &str,
) -> ureq::Request {
    let request = agent
        .get(url)
        .set("User-Agent", "CrossingVoidLauncher/0.1")
        .set("Accept", accept)
        .set("X-GitHub-Api-Version", "2022-11-28");
    match token {
        Some(value) => request.set("Authorization", &format!("Bearer {}", value)),
        None => request,
    }
}

/// 把一次 GitHub 调用收成 `Result<String, String>`，并保留状态码/内容类型用于错误文案。
pub fn call_feedback_request(request: ureq::Request) -> Result<String, String> {
    match request.call() {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("读取 GitHub 响应失败：{}", error)),
        Err(ureq::Error::Status(code, response)) => {
            let content_type = response
                .header("Content-Type")
                .unwrap_or_default()
                .to_string();
            let detail = response.into_string().unwrap_or_default();
            Err(describe_feedback_error(
                "读取玩家反馈",
                Some(code),
                &content_type,
                &detail,
            ))
        }
        Err(error) => Err(describe_feedback_error(
            "读取玩家反馈",
            None,
            "",
            &error.to_string(),
        )),
    }
}

/// 未关闭 issue 列表 + 两个计数。缓存优先。
#[tauri::command]
pub async fn fetch_feedback_issues(
    app: AppHandle,
    force_refresh: Option<bool>,
) -> Result<FeedbackIssueList, String> {
    let cache_path = feedback_cache_dir(&app)?.join("issues.json");
    let force = force_refresh.unwrap_or(false);
    if !force {
        if let Some(cached) = read_cache::<FeedbackIssueList>(&cache_path, ISSUE_LIST_CACHE_TTL) {
            return Ok(FeedbackIssueList {
                from_cache: true,
                ..cached
            });
        }
    }

    let proxy_url = crate::feedback_proxy_url();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::build_feedback_agent(proxy_url.as_deref());
        let url = format!(
            "https://api.github.com/repos/{}/issues?state=open&per_page={}&sort=updated&direction=desc",
            FEEDBACK_REPOSITORY, ISSUE_PAGE_LIMIT
        );
        let token = feedback_token();
        let body = call_feedback_request(feedback_request(
            &agent,
            &url,
            token.as_deref(),
            "application/vnd.github+json",
        ))?;
        let raw: Vec<RawIssue> = serde_json::from_str(&body)
            .map_err(|error| format!("解析 GitHub issue 列表失败：{}", error))?;
        Ok::<FeedbackIssueList, String>(build_issue_list(raw, false))
    })
    .await
    .map_err(|error| format!("反馈列表任务失败：{}", error))?;

    match result {
        Ok(list) => {
            write_cache(&cache_path, &list);
            Ok(list)
        }
        Err(error) => {
            // 网络失败时退回过期缓存，别让界面空白。
            if let Some(stale) = read_cache::<FeedbackIssueList>(&cache_path, Duration::from_secs(u64::MAX)) {
                return Ok(FeedbackIssueList {
                    from_cache: true,
                    ..stale
                });
            }
            Err(error)
        }
    }
}

/// 单条 issue 详情（含正文）。
#[tauri::command]
pub async fn fetch_feedback_issue_detail(
    app: AppHandle,
    number: u64,
) -> Result<FeedbackIssueDetail, String> {
    let cache_path = feedback_cache_dir(&app)?.join(format!("issue-{}.json", number));
    if let Some(cached) = read_cache::<FeedbackIssueDetail>(&cache_path, ISSUE_DETAIL_CACHE_TTL) {
        return Ok(cached);
    }

    let proxy_url = crate::feedback_proxy_url();
    let detail = tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::build_feedback_agent(proxy_url.as_deref());
        let url = format!(
            "https://api.github.com/repos/{}/issues/{}",
            FEEDBACK_REPOSITORY, number
        );
        let token = feedback_token();
        let text = call_feedback_request(feedback_request(
            &agent,
            &url,
            token.as_deref(),
            "application/vnd.github+json",
        ))?;
        let raw: RawIssue = serde_json::from_str(&text)
            .map_err(|error| format!("解析 GitHub issue 详情失败：{}", error))?;
        // 一次请求同时拿到列表字段和正文，不要再为正文多发一次（额度账见文档 §7）。
        let body = raw.body.clone().unwrap_or_default();
        let issue = to_feedback_issue(raw);
        Ok::<FeedbackIssueDetail, String>(FeedbackIssueDetail { issue, body })
    })
    .await
    .map_err(|error| format!("反馈详情任务失败：{}", error))??;

    write_cache(&cache_path, &detail);
    Ok(detail)
}

/// 评论列表（只读展示；发表见 `create_feedback_comment`）。
#[tauri::command]
pub async fn fetch_feedback_comments(
    app: AppHandle,
    number: u64,
) -> Result<Vec<FeedbackComment>, String> {
    let cache_path = feedback_cache_dir(&app)?.join(format!("comments-{}.json", number));
    if let Some(cached) = read_cache::<Vec<FeedbackComment>>(&cache_path, ISSUE_COMMENT_CACHE_TTL) {
        return Ok(cached);
    }

    let proxy_url = crate::feedback_proxy_url();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::build_feedback_agent(proxy_url.as_deref());
        let url = format!(
            "https://api.github.com/repos/{}/issues/{}/comments?per_page={}",
            FEEDBACK_REPOSITORY, number, ISSUE_PAGE_LIMIT
        );
        let token = feedback_token();
        let body = call_feedback_request(feedback_request(
            &agent,
            &url,
            token.as_deref(),
            "application/vnd.github+json",
        ))?;
        let raw: Vec<RawComment> = serde_json::from_str(&body)
            .map_err(|error| format!("解析 GitHub 评论失败：{}", error))?;
        Ok::<Vec<FeedbackComment>, String>(
            raw.into_iter()
                .map(|comment| FeedbackComment {
                    id: comment.id,
                    author: comment.user.login,
                    body: truncate_comment(&comment.body.unwrap_or_default()),
                    created_at: comment.created_at,
                })
                .collect(),
        )
    })
    .await
    .map_err(|error| format!("评论列表任务失败：{}", error))?;

    match result {
        Ok(comments) => {
            write_cache(&cache_path, &comments);
            Ok(comments)
        }
        Err(error) => {
            if let Some(stale) =
                read_cache::<Vec<FeedbackComment>>(&cache_path, Duration::from_secs(u64::MAX))
            {
                return Ok(stale);
            }
            Err(error)
        }
    }
}

/// 发表评论。
///
/// **必须**有令牌（`CROSSINGVOID_FEEDBACK_TOKEN`）：GitHub 不接受匿名写。
#[tauri::command]
pub async fn create_feedback_comment(number: u64, body: String) -> Result<FeedbackComment, String> {
    let token = feedback_token().ok_or_else(|| {
        "缺少 GitHub 反馈令牌：请设置环境变量 CROSSINGVOID_FEEDBACK_TOKEN 后重启启动器".to_string()
    })?;
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("评论内容不能为空".to_string());
    }
    if body.chars().count() > 2000 {
        return Err("评论内容过长（最多 2000 字）".to_string());
    }

    let proxy_url = crate::feedback_proxy_url();
    tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::build_feedback_agent(proxy_url.as_deref());
        let url = format!(
            "https://api.github.com/repos/{}/issues/{}/comments",
            FEEDBACK_REPOSITORY, number
        );
        let payload = serde_json::json!({ "body": body }).to_string();
        let request = agent
            .post(&url)
            .set("User-Agent", "CrossingVoidLauncher/0.1")
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("Content-Type", "application/json; charset=utf-8")
            .set("Authorization", &format!("Bearer {}", token));

        match request.send_string(&payload) {
            Ok(response) => {
                let text = response
                    .into_string()
                    .map_err(|error| format!("读取评论响应失败：{}", error))?;
                let raw: RawComment = serde_json::from_str(&text)
                    .map_err(|error| format!("解析评论响应失败：{}", error))?;
                Ok(FeedbackComment {
                    id: raw.id,
                    author: raw.user.login,
                    body: truncate_comment(&raw.body.unwrap_or_default()),
                    created_at: raw.created_at,
                })
            }
            Err(ureq::Error::Status(code, response)) => {
                let content_type = response
                    .header("Content-Type")
                    .unwrap_or_default()
                    .to_string();
                let detail = response.into_string().unwrap_or_default();
                Err(describe_feedback_error(
                    "发表评论",
                    Some(code),
                    &content_type,
                    &detail,
                ))
            }
            Err(error) => Err(describe_feedback_error(
                "发表评论",
                None,
                "",
                &error.to_string(),
            )),
        }
    })
    .await
    .map_err(|error| format!("评论任务失败：{}", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn category_mapping_follows_the_four_launcher_categories() {
        assert_eq!(category_from_labels(&labels(&["bug"])), CATEGORY_BUG);
        assert_eq!(
            category_from_labels(&labels(&["enhancement"])),
            CATEGORY_ENHANCEMENT
        );
        assert_eq!(
            category_from_labels(&labels(&["优化"])),
            CATEGORY_IMPROVEMENT
        );
        assert_eq!(
            category_from_labels(&labels(&["question"])),
            CATEGORY_QUESTION
        );
    }

    #[test]
    fn category_mapping_ignores_unrelated_labels_and_falls_back_to_uncategorized() {
        assert_eq!(
            category_from_labels(&labels(&["来源:启动器", "待确认"])),
            CATEGORY_OTHER
        );
        assert_eq!(category_from_labels(&[]), CATEGORY_OTHER);
        // 多类别同时存在时按优先级取第一个：bug 优先于 enhancement。
        assert_eq!(
            category_from_labels(&labels(&["enhancement", "bug"])),
            CATEGORY_BUG
        );
    }

    #[test]
    fn issue_list_counts_only_bug_and_enhancement() {
        let raw = vec![
            RawIssue {
                number: 1,
                title: "a".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                html_url: "https://example.com/1".into(),
                labels: vec![RawLabel { name: "bug".into() }],
            },
            RawIssue {
                number: 2,
                title: "b".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-02T00:00:00Z".into(),
                updated_at: "2026-01-02T00:00:00Z".into(),
                html_url: "https://example.com/2".into(),
                labels: vec![RawLabel {
                    name: "enhancement".into(),
                }],
            },
            RawIssue {
                number: 3,
                title: "c".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-03T00:00:00Z".into(),
                updated_at: "2026-01-03T00:00:00Z".into(),
                html_url: "https://example.com/3".into(),
                // 优化 / 提问 / 未分类 都不计入两个数（文档 §3.1）。
                labels: vec![RawLabel { name: "优化".into() }],
            },
            RawIssue {
                number: 4,
                title: "d".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-04T00:00:00Z".into(),
                updated_at: "2026-01-04T00:00:00Z".into(),
                html_url: "https://example.com/4".into(),
                labels: vec![],
            },
        ];
        let list = build_issue_list(raw, false);
        assert_eq!(list.bug_count, 1);
        assert_eq!(list.suggestion_count, 1);
        assert_eq!(list.issues.len(), 4);
        assert_eq!(list.issues[3].category, CATEGORY_OTHER);
        assert!(!list.from_cache);
    }

    #[test]
    fn html_403_is_reported_as_site_restriction_not_business_error() {
        let message = describe_feedback_error(
            "读取玩家反馈",
            Some(403),
            "text/html; charset=utf-8",
            "<!DOCTYPE html><html><title>Forbidden</title>",
        );
        assert!(message.contains("被 GitHub 临时限制"), "{}", message);
    }

    #[test]
    fn json_404_and_401_have_their_own_wording() {
        let not_found = describe_feedback_error("读取玩家反馈", Some(404), "application/json", "");
        assert!(not_found.contains("404"), "{}", not_found);

        let unauthorized = describe_feedback_error("发表评论", Some(401), "application/json", "");
        assert!(unauthorized.contains("令牌"), "{}", unauthorized);
    }

    #[test]
    fn comment_body_is_truncated_on_char_boundary() {
        let short = "正常评论";
        assert_eq!(truncate_comment(short), short);

        let long = "测".repeat(COMMENT_BODY_LIMIT / 3 + 10);
        let truncated = truncate_comment(&long);
        assert!(truncated.ends_with('…'));
        assert!(truncated.len() <= COMMENT_BODY_LIMIT + 3);
    }

    #[test]
    fn read_cache_returns_none_for_expired_entries() {
        let dir = std::env::temp_dir().join(format!("cv-feedback-cache-{}", now_seconds()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join("issues.json");
        write_cache(&path, &vec![1, 2, 3]);

        let cached: Option<Vec<i32>> = read_cache(&path, Duration::from_secs(60));
        assert_eq!(cached, Some(vec![1, 2, 3]));

        // TTL 为 0 时视为过期。
        let expired: Option<Vec<i32>> = read_cache(&path, Duration::from_secs(0));
        assert!(expired.is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
