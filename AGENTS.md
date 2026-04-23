# Repository Guidelines

## Project Structure & Module Organization
- `app/` hosts the App Router surface; `page.tsx` hydrates dashboard data and `app/api/dashboard/route.ts` exposes the refresh endpoint.
- `components/` contains interactive widgets such as `dashboard-view.tsx`, `status-timeline.tsx`, and shared primitives inside `components/ui/`.
- `lib/` carries domain logic: `core/` for polling and state, `providers/` for OpenAI/Anthropic/Gemini adapters, `database/` plus `supabase/` for persistence helpers, `types/` for DTOs, and `utils/` for helpers like `cn`.
- Keep assets in `public/`, and store schema or seed changes exclusively in `supabase/migrations/` so Supabase stays reproducible.

## Build, Test, and Development Commands
- `pnpm install` syncs dependencies; re-run whenever `pnpm-lock.yaml` changes.
- `pnpm dev` launches the Next.js dev server configured via `.env`.
- `pnpm build` compiles the production bundle, while `pnpm start` serves that output for local smoke tests.
- `pnpm lint` runs the Next.js Core Web Vitals rule set (`eslint.config.mjs`); fix findings before pushing.

## Coding Style & Naming Conventions
Default to server components and add `"use client"` only when hooks or browser APIs are required. TypeScript files use two-space indentation, `const` bindings, and descriptive PascalCase component names (`DashboardView`). Sort imports Node → packages → `@/` aliases, avoiding long relative paths. Compose styling through Tailwind utility classes plus `clsx`/`tailwind-merge`, and move repeated variants into `components/ui/`.

## Testing Guidelines
Automated tests are not wired up yet, but new logic should ship with either Vitest/Jest specs named `*.spec.ts` or clearly documented manual steps. Target ≥80% coverage on `lib/core` and provider modules; explain any exception in the PR description. Until a runner is introduced, validate by running `pnpm dev`, exercising dashboard refreshes, and replaying Supabase migrations against a staging project before promoting to production.

## Commit & Pull Request Guidelines
History follows Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`). Keep each commit scoped to a single concern and include related SQL migrations or config edits together. Pull requests must describe the change, link issues, attach UI screenshots/GIFs when visuals move, list the commands executed (build/lint/test), and mention any Supabase migration IDs applied. Request review early for provider updates so credentials and rate limits get a second set of eyes.

## Security & Configuration Tips
Copy `.env.example`, fill in `SUPABASE_*` plus `CHECK_POLL_INTERVAL_SECONDS`, and never commit real keys. Provider credentials belong in the `check_configs` table—seed them with the SQL snippets in `.env.example` instead of plaintext env vars. Use the mock endpoint in `lib/providers/stream-check.ts` for latency tests and scrub client logs before sharing.
