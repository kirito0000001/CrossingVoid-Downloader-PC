# Verification Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show current-file and byte-level progress during full game verification.

**Architecture:** Extend the existing Tauri `game-repair-progress` event with optional display details and byte counters. Keep current repair callers compatible, and emit throttled updates from the SHA-256 read loop during full verification.

**Tech Stack:** Vue 3, TypeScript, Tauri 2, Rust, Vitest

---

### Task 1: Lock the progress contract

**Files:**
- Modify: `tests/progressControls.test.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] Add failing assertions for current-file and byte fields.
- [ ] Add a Rust unit test proving byte totals take priority over file counts.
- [ ] Run `npx vitest run tests/progressControls.test.ts` and `cargo test repair_progress_percent_prefers_bytes_when_available` and confirm failure.

### Task 2: Emit detailed verification progress

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] Extend `RepairProgress` with current file and byte counters.
- [ ] Add throttled progress callbacks to SHA-256 reading.
- [ ] Emit start, incremental, per-file completion, and final events.

### Task 3: Present detailed progress

**Files:**
- Modify: `src/App.vue`

- [ ] Extend `RepairProgressEvent` and reactive verification state.
- [ ] Show a shortened current path and processed byte totals without changing the dock layout.
- [ ] Reset detail state at operation boundaries.

### Task 4: Verify

**Files:**
- Test: `tests/progressControls.test.ts`
- Test: `src-tauri/src/lib.rs`

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cargo test`.
