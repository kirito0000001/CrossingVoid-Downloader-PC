<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import LauncherCheckbox from "./LauncherCheckbox.vue";
import {
  createFeedbackComment,
  createFeedbackIssue,
  fetchFeedbackComments,
  fetchFeedbackIssueDetail,
  fetchFeedbackIssues,
  FEEDBACK_CATEGORY_LABEL_KEYS,
  FEEDBACK_SUBMIT_CATEGORIES,
  formatFeedbackAge,
  normalizeFeedbackCategory,
  totalIssueCount,
  type CreatedFeedbackIssue,
  type FeedbackCategory,
  type FeedbackComment,
  type FeedbackEnvironment,
  type FeedbackIssue,
  type FeedbackIssueDetail,
  type FeedbackIssueList,
  type FeedbackSubmitCategory,
} from "../feedback";
import type { LauncherLanguage, TranslationKey } from "../i18n/launcherText";

/**
 * 玩家反馈面板：只读浏览 + 发表评论（不能改 issue 本身）。
 *
 * 设计文档 §6.3：列表只显示未关闭的；详情里能看正文和评论，也能发评论。
 * 「不能改 issue」不是偷懒——实测 `PATCH /issues/{n}` 系统性失效（文档 §9.1），
 * 所以界面上不要出现任何"编辑"入口。
 */
const props = defineProps<{
  t: (key: TranslationKey, replacements?: Record<string, string | number>) => string;
  language: LauncherLanguage;
  /** 以下由 App.vue 传入，用于拼"运行环境"那一节（拿不到的留空，Rust 侧会整行跳过）。 */
  launcherVersion?: string;
  gameVersion?: string;
  launcherState?: string;
  downloadSource?: string;
  installPath?: string;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const list = ref<FeedbackIssueList | null>(null);
const listPending = ref(false);
const listError = ref("");

const activeIssue = ref<FeedbackIssueDetail | null>(null);
const detailPending = ref(false);
const detailError = ref("");

const comments = ref<FeedbackComment[]>([]);
const commentsPending = ref(false);
const commentsError = ref("");

const draft = ref("");
const commentPending = ref(false);
const commentError = ref("");

/** 三个视图：列表 / 详情 / 反馈表单。 */
const viewMode = ref<"list" | "detail" | "form">("list");

/** 表单状态。 */
const submitCategory = ref<FeedbackSubmitCategory>("bug");
const submitNickname = ref("");
const submitTitle = ref("");
const submitDescription = ref("");
const submitPending = ref(false);
const submitError = ref("");
const createdIssue = ref<CreatedFeedbackIssue | null>(null);
const nicknameStorageKey = "crossing-void.launcher.feedback-nickname";

const listScroll = ref<HTMLElement | null>(null);
const detailScroll = ref<HTMLElement | null>(null);

function readStoredNickname() {
  try {
    return window.localStorage.getItem(nicknameStorageKey) ?? "";
  } catch {
    return "";
  }
}

function rememberNickname(value: string) {
  try {
    window.localStorage.setItem(nicknameStorageKey, value);
  } catch {
    // 存不下不影响提交，只是下次要重新填。
  }
}

const categoryLabel = (category: string) =>
  props.t(FEEDBACK_CATEGORY_LABEL_KEYS[normalizeFeedbackCategory(category)]);

/** `just-now` / `minutes:3` / `date:2026-10-11` → 本地化文案。 */
function ageText(iso: string) {
  const token = formatFeedbackAge(iso);
  if (!token) return "";
  const [kind, value] = token.split(":");
  switch (kind) {
    case "just-now":
      return props.t("feedback.age.justNow");
    case "minutes":
      return props.t("feedback.age.minutes", { count: value });
    case "hours":
      return props.t("feedback.age.hours", { count: value });
    case "days":
      return props.t("feedback.age.days", { count: value });
    default:
      return value ?? "";
  }
}

async function loadList(forceRefresh = false) {
  if (listPending.value) return;
  listPending.value = true;
  listError.value = "";
  try {
    list.value = await fetchFeedbackIssues(forceRefresh);
  } catch (error) {
    listError.value = String(error);
  } finally {
    listPending.value = false;
  }
}

async function openIssue(issue: FeedbackIssue) {
  if (detailPending.value) return;
  activeIssue.value = null;
  viewMode.value = "detail";
  comments.value = [];
  commentsError.value = "";
  commentError.value = "";
  draft.value = "";
  detailError.value = "";
  detailPending.value = true;
  try {
    activeIssue.value = await fetchFeedbackIssueDetail(issue.number);
    await loadComments(issue.number);
  } catch (error) {
    detailError.value = String(error);
  } finally {
    detailPending.value = false;
  }
}

async function loadComments(number: number) {
  commentsPending.value = true;
  commentsError.value = "";
  try {
    comments.value = await fetchFeedbackComments(number);
  } catch (error) {
    commentsError.value = String(error);
  } finally {
    commentsPending.value = false;
  }
}

async function submitComment() {
  const issue = activeIssue.value;
  if (!issue || commentPending.value) return;
  const body = draft.value.trim();
  if (!body) return;
  commentPending.value = true;
  commentError.value = "";
  try {
    const comment = await createFeedbackComment(issue.number, body);
    comments.value = [...comments.value, comment];
    draft.value = "";
  } catch (error) {
    commentError.value = String(error);
  } finally {
    commentPending.value = false;
  }
}

function backToList() {
  activeIssue.value = null;
  comments.value = [];
  commentsError.value = "";
  commentError.value = "";
  draft.value = "";
  detailError.value = "";
  viewMode.value = "list";
}

async function openOnGitHub() {
  const url = activeIssue.value?.htmlUrl;
  if (!url) return;
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  // 表单里按 Esc 先退回列表，不要直接把面板关掉（填了一半的内容不该被误关）。
  if (viewMode.value === "form") {
    viewMode.value = "list";
    return;
  }
  if (activeIssue.value || detailError.value) {
    backToList();
    return;
  }
  emit("close");
}

const issues = computed(() => list.value?.issues ?? []);

/** 分类筛选：`all` 或五个类别之一（2026-10-11 用户要求用筛选替换顶部的两个计数徽标）。 */
const activeFilter = ref<FeedbackCategory | "all">("all");

const filterOptions = computed(() => {
  const counts = list.value?.categoryCounts ?? {};
  return [
    { key: "all" as const, labelKey: "feedback.filter.all" as TranslationKey, count: totalIssueCount(list.value) },
    // 顺序与反馈表单的四个类别一致，未分类放最后。
    ...(["bug", "enhancement", "优化", "question", "uncategorized"] as const).map((category) => ({
      key: category,
      labelKey: FEEDBACK_CATEGORY_LABEL_KEYS[category],
      count: counts[category] ?? 0,
    })),
  ];
});

const visibleIssues = computed(() => {
  if (activeFilter.value === "all") return issues.value;
  return issues.value.filter((issue) => normalizeFeedbackCategory(issue.category) === activeFilter.value);
});

function selectFilter(key: FeedbackCategory | "all") {
  activeFilter.value = key;
  if (listScroll.value) listScroll.value.scrollTop = 0;
}

// ── 反馈表单 ────────────────────────────────────────────

const environment = ref<FeedbackEnvironment>({
  launcherVersion: props.launcherVersion ?? "",
  gameVersion: props.gameVersion ?? "",
  launcherState: props.launcherState ?? "",
  downloadSource: props.downloadSource ?? "",
  installPath: props.installPath ?? "",
  userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  recentLogs: "",
});

// 面板开着的时候版本/安装目录可能变（比如玩家刚切了档），跟着刷新但不覆盖空值。
watch(
  () => [props.launcherVersion, props.gameVersion, props.launcherState, props.downloadSource, props.installPath],
  () => {
    environment.value = {
      ...environment.value,
      launcherVersion: props.launcherVersion ?? environment.value.launcherVersion,
      gameVersion: props.gameVersion ?? environment.value.gameVersion,
      launcherState: props.launcherState ?? environment.value.launcherState,
      downloadSource: props.downloadSource ?? environment.value.downloadSource,
      installPath: props.installPath ?? environment.value.installPath,
    };
  },
);
/** 环境信息默认整段带上；玩家可以取消勾选（提交前正文以服务端拼装为准）。 */
const includeEnvironment = ref(true);

const titleLength = computed(() => submitTitle.value.trim().length);
const descriptionLength = computed(() => submitDescription.value.trim().length);
const titleReady = computed(() => titleLength.value >= 4 && titleLength.value <= 60);
const descriptionReady = computed(() => descriptionLength.value >= 20);
const canSubmit = computed(() => titleReady.value && descriptionReady.value && !submitPending.value);

/** 脱敏预览：把 `C:\Users\<名>\` 换成 `<用户>`，让玩家看得见将要公开什么。 */
function previewInstallPath(path: string) {
  const trimmed = path.trim();
  const match = /^(.*?users[\\/])([^\\/]+)(.*)$/i.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}<用户>${match[3]}`;
}

function startSubmit() {
  createdIssue.value = null;
  submitError.value = "";
  if (!submitNickname.value) submitNickname.value = readStoredNickname();
  viewMode.value = "form";
}

function cancelSubmit() {
  viewMode.value = "list";
}

async function submitIssue() {
  if (!canSubmit.value) return;
  submitPending.value = true;
  submitError.value = "";
  createdIssue.value = null;
  try {
    const created = await createFeedbackIssue({
      category: submitCategory.value,
      nickname: submitNickname.value.trim(),
      title: submitTitle.value.trim(),
      description: submitDescription.value.trim(),
      environment: includeEnvironment.value
        ? environment.value
        : { ...environment.value, installPath: "", userAgent: "", recentLogs: "" },
    });
    createdIssue.value = created;
    rememberNickname(submitNickname.value.trim());
    // 建完就刷新列表：新 issue 会出现在最前面，玩家能立刻看到自己的那条。
    await loadList(true);
    submitTitle.value = "";
    submitDescription.value = "";
  } catch (error) {
    submitError.value = String(error);
  } finally {
    submitPending.value = false;
  }
}

async function openCreatedIssue() {
  const url = createdIssue.value?.htmlUrl;
  if (!url) return;
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// 切到详情时把滚动位置复位，避免列表滚到底后点进去看见的是中间。
watch(activeIssue, (value) => {
  if (value && detailScroll.value) detailScroll.value.scrollTop = 0;
});

onMounted(() => {
  void loadList();
});
onBeforeUnmount(() => {
  // 组件被关闭时不做额外清理：数据在 Rust 侧有缓存，重开很快。
});
</script>

<template>
  <div class="feedback-mask" data-no-drag @click.self="emit('close')">
    <section class="feedback-panel" role="dialog" aria-modal="true" :aria-label="t('feedback.title')" @keydown="handleKeydown">
      <header class="feedback-head">
        <div class="feedback-head-main">
          <strong class="feedback-title">{{ t("feedback.title") }}</strong>
        </div>
        <div class="feedback-head-actions">
          <button v-if="viewMode === 'list'" class="feedback-primary" type="button" @click="startSubmit">
            {{ t("feedback.submit.open") }}
          </button>
          <button
            v-if="viewMode === 'list'"
            class="feedback-ghost"
            type="button"
            :disabled="listPending"
            @click="loadList(true)"
          >
            {{ t("feedback.refresh") }}
          </button>
          <button class="feedback-ghost" type="button" @click="emit('close')">
            {{ t("feedback.close") }}
          </button>
        </div>
      </header>

      <!-- 分类筛选：替代了原来顶部的两个计数徽标（2026-10-11 用户要求） -->
      <nav v-if="viewMode === 'list'" class="feedback-filters" :aria-label="t('feedback.filter.label')">
        <button
          v-for="option in filterOptions"
          :key="option.key"
          class="feedback-filter"
          :class="{ active: activeFilter === option.key }"
          type="button"
          @click="selectFilter(option.key)"
        >
          <span>{{ t(option.labelKey) }}</span>
          <em>{{ option.count }}</em>
        </button>
      </nav>

      <!-- 列表：只显示未关闭的 issue（文档 §6.2） -->
      <div v-if="viewMode === 'list'" ref="listScroll" class="feedback-body">
        <p v-if="listPending && !issues.length" class="feedback-state">{{ t("feedback.loading") }}</p>
        <p v-else-if="listError" class="feedback-state error">{{ listError }}</p>
        <p v-else-if="!issues.length" class="feedback-state">{{ t("feedback.empty") }}</p>
        <p v-else-if="!visibleIssues.length" class="feedback-state">{{ t("feedback.filter.empty") }}</p>
        <ul v-else class="feedback-list">
          <li v-for="issue in visibleIssues" :key="issue.number">
            <button class="feedback-row" type="button" @click="openIssue(issue)">
              <span class="feedback-badge" :class="normalizeFeedbackCategory(issue.category)">
                {{ categoryLabel(issue.category) }}
              </span>
              <span class="feedback-row-title">{{ issue.title }}</span>
              <span class="feedback-row-meta">
                <span v-if="issue.comments" class="feedback-comment-count">
                  {{ t("feedback.comments", { count: issue.comments }) }}
                </span>
                <span class="feedback-age">{{ ageText(issue.createdAt) }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <!-- 反馈表单：类别 + 昵称 + 标题 + 描述 + 环境信息（文档 §4） -->
      <div v-else-if="viewMode === 'form'" class="feedback-body">
        <button class="feedback-back" type="button" @click="cancelSubmit">← {{ t("feedback.back") }}</button>

        <p class="feedback-form-label">{{ t("feedback.submit.category") }}</p>
        <div class="feedback-categories">
          <button
            v-for="category in FEEDBACK_SUBMIT_CATEGORIES"
            :key="category"
            class="feedback-category"
            :class="[normalizeFeedbackCategory(category), { active: submitCategory === category }]"
            type="button"
            @click="submitCategory = category"
          >
            {{ t(FEEDBACK_CATEGORY_LABEL_KEYS[category]) }}
          </button>
        </div>

        <div class="feedback-field-row">
          <label class="feedback-field">
            <span>{{ t("feedback.submit.nickname") }}</span>
            <input
              v-model="submitNickname"
              type="text"
              :maxlength="16"
              :placeholder="t('feedback.submit.nicknamePlaceholder')"
            />
          </label>
          <span class="feedback-field-hint">{{ t("feedback.submit.nicknameHint") }}</span>
        </div>

        <label class="feedback-field">
          <span>{{ t("feedback.submit.title") }}</span>
          <input
            v-model="submitTitle"
            type="text"
            :maxlength="80"
            :placeholder="t('feedback.submit.titlePlaceholder')"
          />
          <em class="feedback-field-count" :class="{ bad: submitTitle.length > 0 && !titleReady }">
            {{ t("feedback.submit.titleCount", { count: titleLength }) }}
          </em>
        </label>

        <label class="feedback-field">
          <span>{{ t("feedback.submit.description") }}</span>
          <textarea
            v-model="submitDescription"
            rows="7"
            :maxlength="4000"
            :placeholder="t('feedback.submit.descriptionPlaceholder')"
          ></textarea>
          <em class="feedback-field-count" :class="{ bad: submitDescription.length > 0 && !descriptionReady }">
            {{ t("feedback.submit.descriptionCount", { count: descriptionLength }) }}
          </em>
        </label>

        <!-- 勾选框必须用共享组件：项目禁止裸写 input[type=checkbox]（守卫见 tests/settingsBehavior.test.ts） -->
        <LauncherCheckbox v-model="includeEnvironment" :label="t('feedback.submit.includeEnvironment')" class="feedback-inline-check" />

        <!-- 让玩家在提交前看见自己要公开什么：路径这里已经脱敏显示 -->
        <ul v-if="includeEnvironment" class="feedback-environment">
          <li v-if="environment.launcherVersion">
            {{ t("feedback.submit.env.launcher") }}：{{ environment.launcherVersion }}
          </li>
          <li v-if="environment.gameVersion">{{ t("feedback.submit.env.game") }}：{{ environment.gameVersion }}</li>
          <li v-if="environment.installPath">
            {{ t("feedback.submit.env.path") }}：{{ previewInstallPath(environment.installPath) }}
          </li>
        </ul>

        <div class="feedback-submit-actions">
          <span v-if="submitError" class="feedback-compose-error">{{ submitError }}</span>
          <button class="feedback-primary" type="button" :disabled="!canSubmit" @click="submitIssue">
            {{ submitPending ? t("feedback.submit.sending") : t("feedback.submit.send") }}
          </button>
        </div>

        <div v-if="createdIssue" class="feedback-created">
          <p>{{ t("feedback.submit.created", { number: createdIssue.number }) }}</p>
          <button class="feedback-link" type="button" @click="openCreatedIssue">
            {{ t("feedback.openOnGithub") }}
          </button>
        </div>

        <p class="feedback-submit-note">{{ t("feedback.submit.note") }}</p>
      </div>

      <!-- 详情：正文 + 评论（可发表评论，但不能改 issue） -->
      <div v-else-if="viewMode === 'detail' && detailPending" class="feedback-body">
        <p class="feedback-state">{{ t("feedback.loading") }}</p>
      </div>
      <div v-else-if="viewMode === 'detail' && activeIssue" ref="detailScroll" class="feedback-body">
        <button class="feedback-back" type="button" @click="backToList">← {{ t("feedback.back") }}</button>
        <h3 class="feedback-detail-title">
          <span class="feedback-badge" :class="normalizeFeedbackCategory(activeIssue.category)">
            {{ categoryLabel(activeIssue.category) }}
          </span>
          <span>{{ activeIssue.title }}</span>
        </h3>
        <p class="feedback-detail-meta">
          <span>#{{ activeIssue.number }}</span>
          <span>{{ ageText(activeIssue.createdAt) }}</span>
          <button class="feedback-link" type="button" @click="openOnGitHub">{{ t("feedback.openOnGithub") }}</button>
        </p>
        <pre v-if="activeIssue.body" class="feedback-detail-body">{{ activeIssue.body }}</pre>

        <div class="feedback-comments">
          <strong class="feedback-comments-title">{{ t("feedback.comments.title") }}</strong>
          <p v-if="commentsPending" class="feedback-state">{{ t("feedback.loading") }}</p>
          <p v-else-if="commentsError" class="feedback-state error">{{ commentsError }}</p>
          <p v-else-if="!comments.length" class="feedback-state">{{ t("feedback.comments.empty") }}</p>
          <ul v-else class="feedback-comment-list">
            <li v-for="comment in comments" :key="comment.id" class="feedback-comment">
              <p class="feedback-comment-meta">
                <strong>{{ comment.author }}</strong>
                <span>{{ ageText(comment.createdAt) }}</span>
              </p>
              <pre class="feedback-comment-body">{{ comment.body }}</pre>
            </li>
          </ul>

          <div class="feedback-compose">
            <textarea
              v-model="draft"
              class="feedback-compose-input"
              :placeholder="t('feedback.compose.placeholder')"
              :maxlength="2000"
              rows="3"
            ></textarea>
            <div class="feedback-compose-actions">
              <span v-if="commentError" class="feedback-compose-error">{{ commentError }}</span>
              <button
                class="feedback-primary"
                type="button"
                :disabled="commentPending || !draft.trim()"
                @click="submitComment"
              >
                {{ commentPending ? t("feedback.compose.sending") : t("feedback.compose.send") }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="feedback-body">
        <p class="feedback-state error">{{ detailError || t("feedback.empty") }}</p>
        <button class="feedback-back" type="button" @click="backToList">← {{ t("feedback.back") }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped src="../styles/feedback-panel.css"></style>
