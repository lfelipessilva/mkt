# HeroUI & Clean Light Mode Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Migrate the frontend from custom dark-mode CSS to **HeroUI 3.x** and **Tailwind CSS v4** with a crisp, modern, professional **Clean Light Mode** design system (eliminating the generic dark AI look and providing superior, accessible, human-crafted UI components).

---

## Architecture & Visual System

- **Design Philosophy**: Clean Light Mode — crisp white cards (`#ffffff`), subtle cool slate canvas (`#f8fafc`), whisper borders (`#e2e8f0`), sharp typography (`#0f172a`), subtle elevations and focused royal blue accents (`#2563eb`).
- **UI Toolkit**: `@heroui/react` (v3), `@tailwindcss/vite` (v4), `lucide-react` for clean iconography, and `framer-motion`.
- **Integrity Guarantee**: All API contracts in `api.ts`, account context logic in `context.tsx`, and existing tests in `src/**/*.test.ts` must remain fully preserved and passing.

---

## File Structure Overview

### Files to Install & Configure
- `frontend/package.json`: Add `@heroui/react`, `framer-motion`, `lucide-react`, `@tailwindcss/vite`, `tailwindcss`.
- `frontend/vite.config.ts`: Register `@tailwindcss/vite` plugin.
- `frontend/src/index.css`: Replaced with Tailwind v4 `@import "tailwindcss";` and `@heroui/styles`, with clean light color variables.
- `frontend/src/main.tsx`: Clean root mount with Tailwind v4 and HeroUI styling.

### Layout & Shell
- `frontend/src/App.tsx`: Refactored to clean light shell with modern header, tab navigation, and active account badge.
- `frontend/src/components/Sidebar.tsx`: Modern light sidebar with brand badge, account switcher, and organized navigation items with Lucide icons.

### Shared & Interactive Components
- `frontend/src/components/LoginGate.tsx`: Sleek modern login card with Clean Light card, icon badges, and loading states.
- `frontend/src/components/RunCard.tsx`: Rich Clean Light `Card` with `Chip` badges, progress indicators, action buttons, and slide thumbnail previews.
- `frontend/src/components/ManualTikTokModal.tsx`: Clean light modal with structured metric inputs and validation.

### Workflow & Settings Tabs
- `frontend/src/tabs/PerformancePage.tsx`: Modern KPI metric cards, performance table with sorting, and clean action buttons.
- `frontend/src/tabs/GalleryPage.tsx`: Filter toolbar (search with Lucide icon, status tabs) and grid of `RunCard`s.
- `frontend/src/tabs/GeneratePage.tsx`: Clean checklist for batch carousel generation with real-time job progress bar.
- `frontend/src/tabs/settings/AccountsPage.tsx`: Clean data table of accounts with role badges and active toggle.
- `frontend/src/tabs/settings/TextsPage.tsx`: Clean tabs for archetypes & baits with inline editing and scope badges.
- `frontend/src/tabs/settings/MediaPage.tsx`: Modern media asset manager with scope pills, upload dropzone, and asset gallery.
- `frontend/src/tabs/IntegrationsPage.tsx`: Clean settings cards for Telegram, TikTok sync, and dispatch tests.

---

## Tasks

### Task 1: Setup HeroUI, Tailwind CSS, Lucide Icons, and Clean Light Theme Provider

**Deliverable**: HeroUI and Tailwind v4 installed, Vite configured, and clean light global styles established.

- [x] **Step 1.1**: Install dependencies in `frontend`: `@heroui/react`, `framer-motion`, `lucide-react`, `tailwindcss`, `@tailwindcss/vite`.
- [x] **Step 1.2**: Update `frontend/vite.config.ts` to include `@tailwindcss/vite`.
- [x] **Step 1.3**: Update `frontend/src/index.css` to import `@heroui/styles`, Tailwind v4, and define clean light theme base tokens.
- [x] **Step 1.4**: Update `frontend/src/main.tsx` to mount with modern styles.
- [x] **Step 1.5**: Run `npm --prefix frontend build` and `npm --prefix frontend test` to verify build pipeline and tests pass.
- [x] **Step 1.6**: Commit: `chore(frontend): setup HeroUI, Tailwind v4, and Clean Light theme tokens`.

---

### Task 2: Redesign App Shell, Navigation & Sidebar

**Deliverable**: App shell with clean light aesthetic, modern header with account context pill, and polished sidebar navigation with Lucide icons.

- [x] **Step 2.1**: Refactor `frontend/src/components/Sidebar.tsx`: brand header, quick account switcher, and navigation items with Lucide icons.
- [x] **Step 2.2**: Refactor `frontend/src/App.tsx`: clean light shell layout, white header with bottom border, and pinned context pill.
- [x] **Step 2.3**: Verify shell layout with `npm --prefix frontend build`.
- [x] **Step 2.4**: Commit: `feat(frontend): implement Clean Light App Shell and Sidebar with Lucide icons`.

---

### Task 3: Redesign Shared Components (LoginGate, RunCard, ManualTikTokModal)

**Deliverable**: Modernized core interactive components with Clean Light styling and Lucide icons.

- [x] **Step 3.1**: Refactor `frontend/src/components/LoginGate.tsx` with centered clean white card, badge, and input styling.
- [x] **Step 3.2**: Refactor `frontend/src/components/RunCard.tsx` with status pills, slide thumbnails, and dispatch action buttons.
- [x] **Step 3.3**: Refactor `frontend/src/components/ManualTikTokModal.tsx` with clean backdrop, close button, and structured metric inputs.
- [x] **Step 3.4**: Run `npm --prefix frontend test` and build check.
- [x] **Step 3.5**: Commit: `feat(frontend): refactor LoginGate, RunCard, and ManualTikTokModal to Clean Light UI`.

---

### Task 4: Modernize Core Operational Pages (Performance, Gallery, Generate)

**Deliverable**: Beautiful clean light views for Performance metrics, Gallery runs, and Generation workflow.

- [x] **Step 4.1**: Refactor `frontend/src/tabs/PerformancePage.tsx`: top KPI cards with icons, clean data table with sorting.
- [x] **Step 4.2**: Refactor `frontend/src/tabs/GalleryPage.tsx`: clean status filter tabs, search bar with icon, and responsive grid.
- [x] **Step 4.3**: Refactor `frontend/src/tabs/GeneratePage.tsx`: account checkbox checklist, action buttons, and progress tracker.
- [x] **Step 4.4**: Run `npm --prefix frontend test` and build check.
- [x] **Step 4.5**: Commit: `feat(frontend): modernize Performance, Gallery, and Generate pages with Clean Light UI`.

---

### Task 5: Modernize Settings & Admin Pages (Accounts, Texts, Media, Integrations)

**Deliverable**: Polished, professional admin interfaces for managing accounts, content assets, media scopes, and integration settings.

- [x] **Step 5.1**: Refactor `frontend/src/tabs/settings/AccountsPage.tsx` with clean data table, role badges, and toggle switches.
- [x] **Step 5.2**: Refactor `frontend/src/tabs/settings/TextsPage.tsx` with clean scope tabs, inline item lists, and action buttons.
- [x] **Step 5.3**: Refactor `frontend/src/tabs/settings/MediaPage.tsx` with scope pills, upload dropzone with icon, and thumbnail grid.
- [x] **Step 5.4**: Refactor `frontend/src/tabs/IntegrationsPage.tsx` with sectioned clean light cards and action feedback.
- [x] **Step 5.5**: Run `npm --prefix frontend test` and build check.
- [x] **Step 5.6**: Commit: `feat(frontend): modernize Accounts, Media, and Integrations pages with Clean Light UI`.

---

### Task 6: Visual Polish, Type Checking, and Full Test Suite Verification

**Deliverable**: Verified clean build, zero TypeScript errors, all 60 tests passing, and visually unified Clean Light interface.

- [x] **Step 6.1**: Run `npm --prefix frontend run build` to verify full TypeScript compilation and Vite bundle generation.
- [x] **Step 6.2**: Run `npm --prefix frontend test` to guarantee all 60 tests pass.
- [x] **Step 6.3**: Clean up unused legacy CSS from `frontend/src/index.css`.
- [x] **Step 6.4**: Commit final plan update.
