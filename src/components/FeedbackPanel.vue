<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  createFeedbackComment,
  fetchFeedbackComments,
  fetchFeedbackIssueDetail,
  fetchFeedbackIssues,
  FEEDBACK_CATEGORY_LABEL_KEYS,
  formatFeedbackAge,
  normalizeFeedbackCategory,
  type FeedbackComment,
  type FeedbackIssue,
  type FeedbackIssueDetail,
  type FeedbackIssueList,
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

const listScroll = ref<HTMLElement | null>(null);
const detailScroll = ref<HTMLElement | null>(null);

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
  if (activeIssue.value || detailError.value) {
    backToList();
    return;
  }
  emit("close");
}

const bugCount = computed(() => list.value?.bugCount ?? 0);
const suggestionCount = computed(() => list.value?.suggestionCount ?? 0);
const issues = computed(() => list.value?.issues ?? []);

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
          <div class="feedback-counts">
            <span class="feedback-count bug">{{ t("feedback.count.bug", { count: bugCount }) }}</span>
            <span class="feedback-count suggestion">{{ t("feedback.count.suggestion", { count: suggestionCount }) }}</span>
          </div>
        </div>
        <div class="feedback-head-actions">
          <button class="feedback-ghost" type="button" :disabled="listPending" @click="loadList(true)">
            {{ t("feedback.refresh") }}
          </button>
          <button class="feedback-ghost" type="button" @click="emit('close')">
            {{ t("feedback.close") }}
          </button>
        </div>
      </header>

      <!-- 列表：只显示未关闭的 issue（文档 §6.2） -->
      <div v-if="!activeIssue && !detailPending" ref="listScroll" class="feedback-body">
        <p v-if="listPending && !issues.length" class="feedback-state">{{ t("feedback.loading") }}</p>
        <p v-else-if="listError" class="feedback-state error">{{ listError }}</p>
        <p v-else-if="!issues.length" class="feedback-state">{{ t("feedback.empty") }}</p>
        <ul v-else class="feedback-list">
          <li v-for="issue in issues" :key="issue.number">
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

      <!-- 详情：正文 + 评论（可发表评论，但不能改 issue） -->
      <div v-else-if="detailPending" class="feedback-body">
        <p class="feedback-state">{{ t("feedback.loading") }}</p>
      </div>
      <div v-else-if="activeIssue" ref="detailScroll" class="feedback-body">
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
