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

/// 自建中转服务（方案 B，文档 §2）。
///
/// 读取优先走它：**未认证直连 GitHub 是按出口 IP 限 60 次/小时**，一群玩家共用出口会互相抢额度；
/// 服务器持令牌是 5000 次/小时，还能挂缓存。写入（建 issue / 发评论）**只能**走它 ——
/// 玩家机器上不该有任何 GitHub 令牌。
pub const FEEDBACK_SERVER_ROOT: &str = "https://www.crossingvoid.top/api/issue-feedback";

/// 中转服务要求的产品键，防止接口被其它产品误用。
const FEEDBACK_PRODUCT_KEY: &str = "crossingvoid-launcher-pc";

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

/// 启动器提交的 issue 会带上的两个标签（文档 §3.2）。
pub const LABEL_SOURCE: &str = "来源:启动器";
pub const LABEL_PENDING: &str = "待确认";

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
    /// 每个类别各有多少条（键就是 `category` 的取值，含 `uncategorized`）。
    ///
    /// 前端用它做两件事：面板顶部的分类筛选、以及悬停提示里的 BUG / 建议两个数。
    pub category_counts: std::collections::BTreeMap<String, u32>,
    pub issues: Vec<FeedbackIssue>,
    /// 数据来自本地缓存时为 true。
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
    let mut category_counts: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
    for issue in &issues {
        *category_counts.entry(issue.category.clone()).or_insert(0) += 1;
    }
    FeedbackIssueList {
        category_counts,
        issues,
        from_cache,
    }
}

/// 「全部」的计数 = 当前未关闭的 issue 总数。
pub fn total_count(list: &FeedbackIssueList) -> u32 {
    list.category_counts.values().sum()
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

/// 中转服务的返回值外壳。
#[derive(Debug, Deserialize)]
struct ServerIssuesPayload {
    #[serde(default)]
    issues: Vec<RawIssue>,
}

#[derive(Debug, Deserialize)]
struct ServerIssuePayload {
    issue: RawIssue,
}

#[derive(Debug, Deserialize)]
struct ServerCommentsPayload {
    #[serde(default)]
    comments: Vec<RawComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCreatedIssuePayload {
    number: u64,
    html_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCreatedCommentPayload {
    comment: ServerCreatedComment,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerCreatedComment {
    id: u64,
    author: String,
    #[serde(default)]
    body: String,
    created_at: String,
}

/// 走自建中转服务取 JSON（读取路径的首选）。
fn fetch_from_server(agent: &ureq::Agent, path: &str) -> Result<String, String> {
    let url = format!("{}{}", FEEDBACK_SERVER_ROOT, path);
    crate::feedback::call_feedback_request(
        agent
            .get(&url)
            .set("User-Agent", "CrossingVoidLauncher/0.1")
            .set("Accept", "application/json"),
    )
}

/// 走自建中转服务写 JSON（建 issue / 发评论）。
fn post_to_server(agent: &ureq::Agent, path: &str, payload: &serde_json::Value) -> Result<String, String> {
    let url = format!("{}{}", FEEDBACK_SERVER_ROOT, path);
    // 产品键放在请求体里（服务端校验），不是认证——真正的令牌只在服务器上。
    let mut body = payload.clone();
    if let Some(object) = body.as_object_mut() {
        object.insert(
            "productKey".to_string(),
            serde_json::Value::String(FEEDBACK_PRODUCT_KEY.to_string()),
        );
    }
    let text = body.to_string();
    let request = agent
        .post(&url)
        .set("User-Agent", "CrossingVoidLauncher/0.1")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json; charset=utf-8");

    match request.send_string(&text) {
        Ok(response) => response
            .into_string()
            .map_err(|error| format!("读取中转服务响应失败：{}", error)),
        Err(ureq::Error::Status(code, response)) => {
            let content_type = response
                .header("Content-Type")
                .unwrap_or_default()
                .to_string();
            let detail = response.into_string().unwrap_or_default();
            // 中转服务自己会用 {"success":false,"message":"..."} 说明原因，优先把它给玩家看。
            let message = serde_json::from_str::<serde_json::Value>(&detail)
                .ok()
                .and_then(|value| value.get("message").and_then(|item| item.as_str()).map(str::to_string))
                .unwrap_or_else(|| detail.clone());
            Err(describe_feedback_error("提交反馈", Some(code), &content_type, &message))
        }
        Err(error) => Err(describe_feedback_error("提交反馈", None, "", &error.to_string())),
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

        // 首选自建服务；它挂了/没部署时退回直连 GitHub 公开 API。
        // 回退路径**不要**带任何令牌（客户端没有，也不该有）。
        let server = fetch_from_server(&agent, "/issues");
        if let Ok(text) = server {
            if let Ok(payload) = serde_json::from_str::<ServerIssuesPayload>(&text) {
                return Ok::<FeedbackIssueList, String>(build_issue_list(payload.issues, false));
            }
        }

        let url = format!(
            "https://api.github.com/repos/{}/issues?state=open&per_page={}&sort=updated&direction=desc",
            FEEDBACK_REPOSITORY, ISSUE_PAGE_LIMIT
        );
        let text = call_feedback_request(feedback_request(&agent, &url, None, "application/vnd.github+json"))?;
        let raw: Vec<RawIssue> =
            serde_json::from_str(&text).map_err(|error| format!("解析 GitHub issue 列表失败：{}", error))?;
        Ok(build_issue_list(raw, false))
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

        let raw = match fetch_from_server(&agent, &format!("/issues/{}", number)) {
            Ok(text) => match serde_json::from_str::<ServerIssuePayload>(&text) {
                Ok(payload) => payload.issue,
                Err(_) => fetch_issue_direct(&agent, number)?,
            },
            Err(_) => fetch_issue_direct(&agent, number)?,
        };

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

/// 直连 GitHub 取单条 issue（中转不可用时的回退路径）。
fn fetch_issue_direct(agent: &ureq::Agent, number: u64) -> Result<RawIssue, String> {
    let url = format!(
        "https://api.github.com/repos/{}/issues/{}",
        FEEDBACK_REPOSITORY, number
    );
    let text = call_feedback_request(feedback_request(agent, &url, None, "application/vnd.github+json"))?;
    serde_json::from_str(&text).map_err(|error| format!("解析 GitHub issue 详情失败：{}", error))
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

        // 首选自建服务；不可用时退回直连 GitHub（公开读，无需令牌）。
        if let Ok(text) = fetch_from_server(&agent, &format!("/issues/{}/comments", number)) {
            if let Ok(payload) = serde_json::from_str::<ServerCommentsPayload>(&text) {
                return Ok::<Vec<FeedbackComment>, String>(payload
                    .comments
                    .into_iter()
                    .map(|comment| FeedbackComment {
                        id: comment.id,
                        author: comment.user.login,
                        body: truncate_comment(&comment.body.unwrap_or_default()),
                        created_at: comment.created_at,
                    })
                    .collect());
            }
        }

        let url = format!(
            "https://api.github.com/repos/{}/issues/{}/comments?per_page={}",
            FEEDBACK_REPOSITORY, number, ISSUE_PAGE_LIMIT
        );
        let body = call_feedback_request(feedback_request(&agent, &url, None, "application/vnd.github+json"))?;
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
/// 发表评论。
///
/// 走自建中转服务（方案 B）：玩家机器上**没有也不该有**任何 GitHub 令牌，
/// 真正的令牌只存在服务器上（文档 §2）。因此这里不再读环境变量。
#[tauri::command]
pub async fn create_feedback_comment(number: u64, body: String) -> Result<FeedbackComment, String> {
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
        let text = post_to_server(
            &agent,
            &format!("/issues/{}/comments", number),
            &serde_json::json!({ "body": body }),
        )?;
        let payload: ServerCreatedCommentPayload = serde_json::from_str(&text)
            .map_err(|error| format!("解析评论响应失败：{}", error))?;
        Ok(FeedbackComment {
            id: payload.comment.id,
            author: payload.comment.author,
            body: truncate_comment(&payload.comment.body),
            created_at: payload.comment.created_at,
        })
    })
    .await
    .map_err(|error| format!("评论任务失败：{}", error))?
}

// ── 写入侧：建 issue（文档 §4、§5） ─────────────────────────────

/// 建 issue 时允许的四个类别。与启动器表单的选项一一对应。
pub const SUBMIT_CATEGORIES: [&str; 4] = [
    CATEGORY_BUG,
    CATEGORY_ENHANCEMENT,
    CATEGORY_IMPROVEMENT,
    CATEGORY_QUESTION,
];

const TITLE_MIN_CHARS: usize = 4;
const TITLE_MAX_CHARS: usize = 80;
const DESCRIPTION_MAX_CHARS: usize = 4000;
const NICKNAME_MAX_CHARS: usize = 16;
const ENVIRONMENT_VALUE_MAX_CHARS: usize = 300;

/// 提交表单里的运行环境（全部可选：任何一项拿不到就整行不写）。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEnvironment {
    #[serde(default)]
    pub launcher_version: String,
    #[serde(default)]
    pub game_version: String,
    #[serde(default)]
    pub launcher_state: String,
    #[serde(default)]
    pub download_source: String,
    /// 形如 `C:\Users\liuyu\...`；**写入正文前必须脱敏**。
    #[serde(default)]
    pub install_path: String,
    #[serde(default)]
    pub user_agent: String,
    /// 玩家勾选"附带错误日志"时的摘要（本次由前端拼接；未勾选就是空串）。
    #[serde(default)]
    pub recent_logs: String,
}

/// 建 issue 的结果：前端拿它显示链接并刷新列表。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedFeedbackIssue {
    pub number: u64,
    pub html_url: String,
    pub labels: Vec<String>,
}

/// 单行输入的安全化：去掉控制字符与换行，trim。
///
/// 为什么必须做：这些值会进 issue 标题/正文，换行与省略号之类会破坏 Markdown 结构；
/// 昵称还可能被塞进 `## 提交者` 那一节，必须挡掉换行与 `#` 开头这类注入面。
pub fn sanitize_line(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

/// 按类别给出标题前缀与标签（文档 §3.1）。
///
/// 注意：**标签必须和建 issue 放在同一个请求里**——实测 `PATCH /issues/{n}` 系统性失效（§9.1）。
pub fn category_metadata(category: &str) -> Option<(&'static str, Vec<&'static str>)> {
    match category {
        CATEGORY_BUG => Some(("[BUG]", vec![CATEGORY_BUG])),
        CATEGORY_ENHANCEMENT => Some(("[建议]", vec![CATEGORY_ENHANCEMENT])),
        CATEGORY_IMPROVEMENT => Some(("[优化]", vec![CATEGORY_IMPROVEMENT])),
        CATEGORY_QUESTION => Some(("[提问]", vec![CATEGORY_QUESTION])),
        _ => None,
    }
}

/// 安装目录脱敏：把 `C:\Users\<某个用户名>\...` 里的用户名换成 `<用户>`。
///
/// 不脱敏会把玩家的 Windows 用户名带进公开 issue（文档 §4 明确要求）。
/// 只认 `Users\` / `Users/` 这一段，其余原样保留；识别不了就原样返回（宁可少脱一层，
/// 也不要因为解析出错把整条路径改写坏）。
pub fn redact_install_path(path: &str) -> String {
    let trimmed = sanitize_line(path);
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_lowercase();
    let Some(position) = lower.find("users\\").or_else(|| lower.find("users/")) else {
        return trimmed;
    };
    let name_start = position + 6;
    if name_start >= trimmed.len() {
        return trimmed;
    }
    let name_end = trimmed[name_start..]
        .find(['\\', '/'])
        .map(|offset| name_start + offset)
        .unwrap_or(trimmed.len());
    if name_end <= name_start {
        return trimmed;
    }
    // `trimmed[..name_start]` 已经包含 `Users` 与那个分隔符（如 `C:\Users\`）。
    format!("{}<用户>{}", &trimmed[..name_start], &trimmed[name_end..])
}

/// 拼 issue 正文（文档 §5 的模板）。
pub fn build_issue_body(
    description: &str,
    nickname: &str,
    environment: &FeedbackEnvironment,
) -> String {
    let mut body = String::new();
    body.push_str("## 问题描述\n");
    body.push_str(description.trim());
    body.push('\n');

    if !nickname.is_empty() {
        body.push_str("\n## 提交者\n");
        body.push_str(nickname);
        body.push('\n');
    }

    let mut environment_lines: Vec<String> = Vec::new();
    let mut push_env = |label: &str, value: &str| {
        let value = sanitize_line(value);
        if value.is_empty() || value.chars().count() > ENVIRONMENT_VALUE_MAX_CHARS {
            return;
        }
        environment_lines.push(format!("- {}：{}", label, value));
    };
    push_env("启动器版本", &environment.launcher_version);
    push_env("游戏版本", &environment.game_version);
    push_env("游戏状态", &environment.launcher_state);
    push_env("下载源", &environment.download_source);
    push_env("安装目录", &redact_install_path(&environment.install_path));
    push_env("系统信息", &environment.user_agent);

    if !environment_lines.is_empty() {
        body.push_str("\n## 运行环境\n");
        body.push_str(&environment_lines.join("\n"));
        body.push('\n');
    }

    let logs = environment.recent_logs.trim();
    if !logs.is_empty() {
        // 日志可能很长；截断到 4000 字符（文档 §8.2 的正文上限）。
        let truncated: String = logs.chars().take(DESCRIPTION_MAX_CHARS).collect();
        body.push_str("\n## 最近错误日志\n\n```text\n");
        body.push_str(&truncated);
        body.push_str("\n```\n");
    }

    body
}

/// 校验并规范化玩家提交。返回（标题、正文、标签、前缀），或一句人话错误。
pub fn prepare_issue_submission(
    category: &str,
    nickname: &str,
    title: &str,
    description: &str,
    environment: &FeedbackEnvironment,
) -> Result<(String, String, Vec<String>, &'static str), String> {
    let (prefix, labels) = category_metadata(category.trim())
        .ok_or_else(|| "请先选择反馈类别（BUG / 建议 / 优化 / 提问）".to_string())?;

    let title = sanitize_line(title);
    let title_chars = char_count(&title);
    if title_chars < TITLE_MIN_CHARS {
        return Err(format!("标题太短了，至少 {} 个字", TITLE_MIN_CHARS));
    }
    if title_chars > TITLE_MAX_CHARS {
        return Err(format!("标题太长了，最多 {} 个字", TITLE_MAX_CHARS));
    }

    let description = description.trim();
    let description_chars = char_count(description);
    // 正文只要求"不是空"：用户 2026-10-11 明确要求不做长度限制。
    // 太短的内容由"待确认"标签 + 人工过目兜底（文档 §8.3），不要拿校验拦玩家。
    if description_chars == 0 {
        return Err("请先写一点描述，哪怕一句话也行".to_string());
    }
    if description_chars > DESCRIPTION_MAX_CHARS {
        return Err(format!("描述太长了，最多 {} 个字", DESCRIPTION_MAX_CHARS));
    }

    let nickname = sanitize_line(nickname);
    if char_count(&nickname) > NICKNAME_MAX_CHARS {
        return Err(format!("昵称最多 {} 个字", NICKNAME_MAX_CHARS));
    }

    let body = build_issue_body(description, &nickname, environment);
    let full_title = format!("{} {}", prefix, title);

    // 标签顺序固定：类别在前，来源与待确认在后（便于人工扫列表）。
    let mut label_list: Vec<String> = labels.iter().map(|label| label.to_string()).collect();
    label_list.push(LABEL_SOURCE.to_string());
    label_list.push(LABEL_PENDING.to_string());

    Ok((full_title, body, label_list, prefix))
}

/// 真正发一次建单请求（同步，走自建中转服务）。
///
/// 抽成 public 同步函数是为了让测试能直接跑这条真实路径（联调用例见文末 `live_` 测试）。
/// 注意它**不需要令牌参数**：令牌只在服务器上（方案 B）。
pub fn submit_feedback_issue(
    agent: &ureq::Agent,
    full_title: &str,
    body: &str,
    labels: &[String],
) -> Result<CreatedFeedbackIssue, String> {
    let text = post_to_server(
        agent,
        "/issues",
        &serde_json::json!({
            "title": full_title,
            "body": body,
            "labels": labels,
        }),
    )?;
    let payload: ServerCreatedIssuePayload = serde_json::from_str(&text)
        .map_err(|error| format!("解析建单响应失败：{}", error))?;
    Ok(CreatedFeedbackIssue {
        number: payload.number,
        html_url: payload.html_url,
        // 服务端会把实际落上的标签一起带回来（GitHub 会自动创建不存在的标签）。
        labels: labels.to_vec(),
    })
}

/// 建 issue。**必须有令牌**：GitHub 不接受匿名写，而且这一步不能重试（§9.1 的站点限制）。
#[tauri::command]
pub async fn create_feedback_issue(
    category: String,
    nickname: String,
    title: String,
    description: String,
    environment: Option<FeedbackEnvironment>,
) -> Result<CreatedFeedbackIssue, String> {
    let environment = environment.unwrap_or_default();
    let (full_title, body, labels, _prefix) =
        prepare_issue_submission(&category, &nickname, &title, &description, &environment)?;

    let proxy_url = crate::feedback_proxy_url();
    tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::build_feedback_agent(proxy_url.as_deref());
        submit_feedback_issue(&agent, &full_title, &body, &labels)
    })
    .await
    .map_err(|error| format!("提交任务失败：{}", error))?
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
    fn issue_list_counts_every_category() {
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
                labels: vec![RawLabel {
                    name: "question".into(),
                }],
            },
            RawIssue {
                number: 5,
                title: "e".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-05T00:00:00Z".into(),
                updated_at: "2026-01-05T00:00:00Z".into(),
                html_url: "https://example.com/5".into(),
                // 网页直提的 issue：四类都不沾。
                labels: vec![],
            },
            RawIssue {
                number: 6,
                title: "f".into(),
                body: None,
                comments: 0,
                created_at: "2026-01-06T00:00:00Z".into(),
                updated_at: "2026-01-06T00:00:00Z".into(),
                html_url: "https://example.com/6".into(),
                labels: vec![RawLabel { name: "bug".into() }],
            },
        ];
        let list = build_issue_list(raw, false);
        assert_eq!(list.category_counts.get("bug"), Some(&2));
        assert_eq!(list.category_counts.get("enhancement"), Some(&1));
        assert_eq!(list.category_counts.get("优化"), Some(&1));
        assert_eq!(list.category_counts.get("question"), Some(&1));
        assert_eq!(list.category_counts.get(CATEGORY_OTHER), Some(&1));
        assert_eq!(list.issues.len(), 6);
        assert_eq!(total_count(&list), 6);
        assert!(!list.from_cache);
    }

    #[test]
    fn category_counts_are_empty_for_an_empty_list() {
        let list = build_issue_list(Vec::new(), true);
        assert!(list.category_counts.is_empty());
        assert_eq!(total_count(&list), 0);
        assert!(list.from_cache);
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

    // ── 写入侧 ────────────────────────────────────────────

    fn environment() -> FeedbackEnvironment {
        FeedbackEnvironment {
            launcher_version: "1.3.5".into(),
            game_version: "0.5.14".into(),
            launcher_state: "ready".into(),
            download_source: "official".into(),
            install_path: r"C:\Users\liuyu\CrossingVoid".into(),
            user_agent: "Windows 11 / WebView2".into(),
            recent_logs: String::new(),
        }
    }

    #[test]
    fn submit_builds_title_prefix_body_and_labels() {
        let (title, body, labels, prefix) = prepare_issue_submission(
            CATEGORY_BUG,
            "晓桀",
            "  进入战斗后闪退  ",
            "进入战斗后闪退，重开也一样。期望能正常打完这一关，实际直接回到桌面。",
            &environment(),
        )
        .expect("应当通过校验");

        assert_eq!(prefix, "[BUG]");
        assert_eq!(title, "[BUG] 进入战斗后闪退");
        assert!(body.contains("## 问题描述"));
        assert!(body.contains("## 提交者\n晓桀"));
        assert!(body.contains("- 启动器版本：1.3.5"));
        assert!(body.contains("- 游戏版本：0.5.14"));
        // 标签必须一次带齐，且含来源与待确认（PATCH 不可用，没有第二次机会）。
        assert_eq!(labels, vec!["bug", "来源:启动器", "待确认"]);
    }

    #[test]
    fn each_category_maps_to_its_own_prefix_and_label() {
        for (category, prefix, label) in [
            (CATEGORY_BUG, "[BUG]", "bug"),
            (CATEGORY_ENHANCEMENT, "[建议]", "enhancement"),
            (CATEGORY_IMPROVEMENT, "[优化]", "优化"),
            (CATEGORY_QUESTION, "[提问]", "question"),
        ] {
            let (title, _body, labels, _) = prepare_issue_submission(
                category,
                "",
                "一个合法的标题",
                "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。",
                &FeedbackEnvironment::default(),
            )
            .unwrap_or_else(|error| panic!("{} 应当通过校验：{}", category, error));
            assert!(title.starts_with(prefix), "{} -> {}", category, title);
            assert!(labels.contains(&label.to_string()), "{:?}", labels);
        }
    }

    #[test]
    fn submit_rejects_unknown_category_and_bad_lengths() {
        let ok_description = "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。";

        let error = prepare_issue_submission(
            "not-a-category",
            "",
            "合法标题",
            ok_description,
            &FeedbackEnvironment::default(),
        )
        .expect_err("未知类别必须被拒绝");
        assert!(error.contains("类别"), "{}", error);

        let too_short = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "短",
            ok_description,
            &FeedbackEnvironment::default(),
        )
        .expect_err("标题太短必须被拒绝");
        assert!(too_short.contains("标题"), "{}", too_short);

        // 正文不做长度限制（用户 2026-10-11 要求）：只有完全空白才拦。
        let empty_description = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "合法标题",
            "   ",
            &FeedbackEnvironment::default(),
        )
        .expect_err("空描述必须被拒绝");
        assert!(empty_description.contains("描述"), "{}", empty_description);

        assert!(
            prepare_issue_submission(
                CATEGORY_BUG,
                "",
                "合法标题",
                "就这样",
                &FeedbackEnvironment::default(),
            )
            .is_ok(),
            "很短的正文也应当允许提交"
        );

        let long_nickname = prepare_issue_submission(
            CATEGORY_BUG,
            "这个名字实在是太长了超过十六个字了",
            "合法标题",
            ok_description,
            &FeedbackEnvironment::default(),
        )
        .expect_err("昵称过长必须被拒绝");
        assert!(long_nickname.contains("昵称"), "{}", long_nickname);
    }

    #[test]
    fn submit_rejects_over_long_description() {
        let long = "很".repeat(DESCRIPTION_MAX_CHARS + 1);
        let error = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "合法标题",
            &long,
            &FeedbackEnvironment::default(),
        )
        .expect_err("超长描述必须被拒绝");
        assert!(error.contains("描述"), "{}", error);
    }

    #[test]
    fn nickname_cannot_inject_newlines_into_the_body() {
        let (_, body, _, _) = prepare_issue_submission(
            CATEGORY_QUESTION,
            "坏\n## 运行环境\n- 假的",
            "合法标题",
            "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。",
            &FeedbackEnvironment::default(),
        )
        .expect("应当通过校验");

        // 换行被去掉后，伪造的二级标题不再独占一行。
        assert!(!body.contains("\n## 运行环境\n- 假的"), "{}", body);
        assert!(body.contains("## 提交者\n坏## 运行环境- 假的"), "{}", body);
    }

    #[test]
    fn install_path_is_redacted_before_it_reaches_the_body() {
        assert_eq!(
            redact_install_path(r"C:\Users\liuyu\CrossingVoid"),
            r"C:\Users\<用户>\CrossingVoid"
        );
        assert_eq!(
            redact_install_path("D:/Users/Some Name/Games/CV"),
            "D:/Users/<用户>/Games/CV"
        );
        // 认不出来就原样返回，别把路径改坏。
        assert_eq!(
            redact_install_path(r"D:\Games\CrossingVoid"),
            r"D:\Games\CrossingVoid"
        );
        assert_eq!(redact_install_path(""), "");

        let (_, body, _, _) = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "合法标题",
            "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。",
            &environment(),
        )
        .expect("应当通过校验");
        assert!(body.contains(r"C:\Users\<用户>\CrossingVoid"), "{}", body);
        assert!(!body.contains("liuyu"), "{}", body);
    }

    #[test]
    fn body_omits_empty_environment_lines_and_includes_logs_when_asked() {
        let (_, body, _, _) = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "合法标题",
            "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。",
            &FeedbackEnvironment {
                launcher_version: "1.3.5".into(),
                ..Default::default()
            },
        )
        .expect("应当通过校验");
        assert!(body.contains("## 运行环境"));
        assert!(body.contains("- 启动器版本：1.3.5"));
        // 没给值的行不该出现（否则正文里全是"- 游戏版本："这种空壳）。
        assert!(!body.contains("- 游戏版本："));
        assert!(!body.contains("## 最近错误日志"));

        let (_, with_logs, _, _) = prepare_issue_submission(
            CATEGORY_BUG,
            "",
            "合法标题",
            "这是一段足够长的描述，用来通过二十个字的校验，说明期望与实际。",
            &FeedbackEnvironment {
                recent_logs: "Error: 文件校验失败".into(),
                ..Default::default()
            },
        )
        .expect("应当通过校验");
        assert!(with_logs.contains("## 最近错误日志"));
        assert!(with_logs.contains("Error: 文件校验失败"));
    }

    /// 真实建单联调（默认不跑：会真的在 GitHub 上开一条 issue）。
    ///
    /// 跑法：`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture live_create_issue`
    ///
    /// 走的是自建中转服务（方案 B），**本机不需要任何令牌**；
    /// 它验的是单测覆盖不到的那一层：网络、HTTP 头、服务端与 GitHub 是否接受 payload。
    #[test]
    #[ignore = "会真的在 GitHub 上建一条 issue，只在手工联调时运行"]
    fn live_create_issue_creates_a_real_issue() {
        let environment = FeedbackEnvironment {
            launcher_version: "1.3.5".into(),
            game_version: "0.5.14".into(),
            launcher_state: "ready".into(),
            download_source: "official".into(),
            install_path: r"C:\Users\liuyu\CrossingVoid".into(),
            user_agent: "Windows 11 / WebView2 联调".into(),
            recent_logs: String::new(),
        };
        let (title, body, labels, _) = prepare_issue_submission(
            CATEGORY_QUESTION,
            "联调机器人",
            "联调：验证启动器经服务器建单",
            "这是一条联调 issue，用来验证启动器经自建服务器建单的代码路径（校验、模板、标签、脱敏）。验证完会关闭，不影响其他反馈。",
            &environment,
        )
        .expect("应当通过校验");

        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(8))
            .timeout_read(Duration::from_secs(20))
            .build();
        let created =
            submit_feedback_issue(&agent, &title, &body, &labels).expect("建单应当成功");
        println!("建单成功：{} （标签 {:?}）", created.html_url, created.labels);
        assert!(created.number > 0);
    }
}
