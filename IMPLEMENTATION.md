# ResumeXpress implementation and local operation

The existing Express backend and Next.js frontend remain separate applications.
Resume documents remain self-contained; Career Profile copying is explicit and does not rewrite old resumes.

## Implemented workflows

- Resume editor: controlled fields, autosave with serialized requests and retry, save status, undo/redo, section navigation, add/remove/hide/reorder, native drag-and-drop, duplicate entries and sections, six templates, typography and spacing.
- Career Profile: editable experiences, education, skills, projects, certifications, achievements, awards, publications, volunteering, languages and interests.
- Explicit profile import and sync include supporting sections as editable text snapshots.
- Resume history: prior-state snapshots, paginated history, comparison, restoration and private duplication.
- Documents: server-generated PDF downloads, A4/Letter, selectable text, contact links, optional embedded custom fonts, automatic pagination and saved-layout diagnostics.
- Jobs: saved descriptions, text-file input, validated AI extraction and saved structured requirements.
- ATS: persisted heuristic analysis, explicit formulas, matched/missing/partial skills, missing keywords, repetition, weak statements and missing-data handling.
- AI: approved summary and bullet edits, job optimization, skills analysis, persistent career coaching, LinkedIn drafts and 30/60/90-day planning.
- Cover letters: generation, storage, editing, copying and text downloads.
- Interviews: saved sessions, one question at a time, answer feedback and completion scoring.
- Applications: references to owned resumes and cover letters, status transitions, timeline, notes, interview dates, search and pagination.
- Public resumes: custom slugs, metadata, share links, QR codes, contact actions, PDF download and view counts.
- Dashboard: profile completeness, resource counts, quick actions, activity and resume search/sorting.
- Security: ownership on all new resources, reference ownership checks, validated AI outputs, explicit approval and stale-content checks, sanitized rich text, revoked-token checks for optional authentication, private public-view fields and dependency updates.

## Local startup

Use Node 24 for both applications.
The earlier dependency set failed under Node 26; integration tests also ran successfully under the installed Node 20 before the security dependency updates.

Backend:

```sh
cd ResumeXpress-Backend-
nvm use
npm ci
cp .env.example .env
# Set DB_URI, JWT_SECRET and service credentials in .env.
npm run migrate
npm start
```

Frontend, in a second terminal:

```sh
cd ResumeXpress-Frontend-
npm ci
# Create .env.local from .env.example and set the backend URL.
npm run build
npm start
```

Set `NEXT_PUBLIC_BACKEND_URL=http://localhost:5000/api/v1/` when using the backend's default port.
The URL must include a trailing slash.
Set `NEXT_PUBLIC_BASE_URL` and backend `FRONTEND_URL` to the frontend's actual origin.

## Environment

| Variable | Purpose |
| --- | --- |
| DB_URI | MongoDB connection string |
| JWT_SECRET | Random secret of at least 32 characters |
| JWT_EXPIRES_IN | Access-token lifetime |
| PORT | Backend listening port; defaults to 5000 |
| FRONTEND_URL | Reset links, QR links and default CORS origin |
| CORS_ORIGINS | Optional comma-separated allowlist |
| GOOGLE_AI_API_KEY | Server-only Gemini key |
| AI_MODEL | Configured Gemini model; default is gemini-2.5-flash |
| EMAIL_USER / EMAIL_APP_PASSWORD | SMTP credentials |
| SMTP_HOST / SMTP_PORT | SMTP transport configuration |
| PDF_FONT_PATH | Optional absolute path to a licensed font file for embedding |
| DEBUG_RESUMEXPRESS | Temporary method/status/duration diagnostics; set to 1 to enable |
| NEXT_PUBLIC_BACKEND_URL | Frontend API base URL |
| NEXT_PUBLIC_BASE_URL | Frontend public origin |

The Gemini model choice is configurable.
Google documents structured-output support for [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash).
No storage or analytics provider credentials are required: documents are generated on request and analytics are stored in MongoDB.
Do not expose API keys through `NEXT_PUBLIC_` variables.

## Database and migration

Added collections: ResumeVersion, Job, AIAnalysis, CoverLetter, InterviewSession, Application, AnalyticsEvent and CoachMessage.
Job analysis is stored on Job; ATS and generated analyses share AIAnalysis with a kind discriminator.
Resume gained optional layout, section, status, target and public-slug fields.
CareerProfile gained optional section snapshots.
Existing resumes default to the original preview layout.

Run `npm run migrate` to create the declared indexes, including the unique sparse public-slug index and compound version index.
This migration is idempotent and does not rewrite resume content or drop indexes.
A database backup is appropriate before applying any schema deployment.

## API additions

Existing unversioned routes are preserved alongside `/api/v1`.
All paths below are relative to `/api/v1`.

| Resource | Routes |
| --- | --- |
| Versions | GET resume/:id/versions; GET resume/:id/versions/:versionId; POST resume/:id/versions/:versionId/restore |
| Duplicate | POST resume/:id/duplicate |
| Documents | GET resume/:id/pdf; GET resume/:id/layout |
| Public sharing | PATCH resume/:id/slug; GET resume/:id/qr; GET resume/public/:slug; POST resume/public/:slug/view |
| Dashboard | GET career/overview |
| Jobs | GET/POST career/jobs; GET/DELETE career/jobs/:id; POST career/jobs/:id/analyze |
| ATS | POST career/ats |
| AI tools | POST career/generate/:kind |
| Approval | POST career/analyses/:id/apply with confirmed=true |
| Analyses | GET career/analyses; GET/DELETE career/analyses/:id |
| Cover letters | GET/POST career/cover-letters; GET/PUT/DELETE career/cover-letters/:id |
| Interviews | GET/POST career/interviews; GET/DELETE career/interviews/:id; POST career/interviews/:id/answer |
| Applications | GET/POST career/applications; GET/PUT/DELETE career/applications/:id |
| Coach history | GET career/coach/:resumeId |

AI kinds are match, optimizer, bullets, summary, skills, coach, linkedin and gap.
Generation uses stored candidate context, schema validation, per-user input hashes, bounded output, request limits and in-flight deduplication.
Model output does not directly mutate resume fields; applying a suggestion checks ownership and that its before-value still matches.

## Verification commands

```sh
# Backend
npm run check
npm test

# Frontend
npm run typecheck
npm run lint
npm run build
```

The integration suite uses temporary MongoDB and synthetic test accounts.
It never writes to the configured development or production database.
Provider-unavailable tests intentionally disable the AI key and verify a real configuration error.
They do not substitute fake production AI responses.

## Remaining verification and limitations

Verification resumed on September 6, 2026 using Node 20.20.2: frontend production build, typecheck and lint passed; backend syntax checks and all 47 existing tests passed.
Inter and its OFL license are bundled in the frontend, removing the Google Fonts network dependency during builds.
The Next.js build updated TypeScript configuration for the installed framework version.

Live AI generation and SMTP delivery require local credentials that were absent during implementation.
No browser was opened, as requested; interactive UI behavior still needs human end-to-end review.
PDF samples were generated and visually inspected without browser automation.

ATS scores are transparent diagnostic heuristics, not proprietary ATS predictions or a guarantee of success.
The separate AI job-match tool estimates semantic seniority and responsibility alignment with explanations; those assessments also require human review.
AI factuality still requires the candidate to review the proposal: schema validation and evidence checks cannot prove every natural-language assertion.

Preview and PDF use separate renderers; layout hierarchy and saved settings are shared, but exact browser typography and rich-text decoration can differ.
Custom fonts are optional; built-in PDF fonts do not cover every writing system.
Supporting sections use text snapshots rather than inferred reconstruction into structured profile fields.
Job uploads currently accept text/Markdown, and cover-letter downloads are text files.

Resume history stores prior states, with the current document remaining the authoritative latest state.
Snapshot persistence precedes the document save and does not use multi-document transactions; an interrupted save may leave an unused restore point, while preserving the prior content.
Autosave retries network failures while the page remains open and warns on unload; it is not an offline document store.
View counts are basic request counts, not deduplicated unique visitors.
AI in-flight deduplication is process-local; cached results are persisted per account.

Temporary DEBUG_RESUMEXPRESS instrumentation remains until the user confirms it may be removed.
