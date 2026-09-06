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
Both applications provide an `.nvmrc`; the backend requires Node 24 because the current dependencies do not support Node 20.

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
| AI_MODEL | Configured Gemini model; default is gemini-3.6-flash |
| EMAIL_USER / EMAIL_APP_PASSWORD | SMTP credentials |
| SMTP_HOST / SMTP_PORT | SMTP transport configuration |
| PDF_FONT_PATH | Optional absolute path to a licensed font file for embedding |
| DEBUG_RESUMEXPRESS | Temporary method/status/duration diagnostics; set to 1 to enable |
| NEXT_PUBLIC_BACKEND_URL | Frontend API base URL |
| NEXT_PUBLIC_BASE_URL | Frontend public origin |

The Gemini model choice is configurable.
Live verification on September 6, 2026 confirmed structured generation with `gemini-3.6-flash`, which Google's API recommended after rejecting the older configured models.
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

AI kinds are resume, match, optimizer, bullets, summary, skills, coach, linkedin and gap.
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

Credentials were absent during initial implementation; live provider and SMTP authentication checks are recorded in the release continuation below.
No browser was opened, as requested; interactive UI behavior still needs human end-to-end review.
PDF samples were generated and visually inspected without browser automation.

ATS scores are transparent diagnostic heuristics, not proprietary ATS predictions or a guarantee of success.
The separate AI job-match tool estimates semantic seniority and responsibility alignment with explanations; those assessments also require human review.
AI factuality still requires the candidate to review the proposal: schema validation and evidence checks cannot prove every natural-language assertion.

Preview and PDF use separate renderers; layout hierarchy and saved settings are shared, but exact browser typography and rich-text decoration can differ.
Custom fonts are optional; built-in PDF fonts do not cover every writing system.
Projects, certifications, achievements, awards, publications, volunteering and languages now use validated structured entries for new imports and support structured sync back to the profile.
Existing text-only sections remain editable; old prose is never inferred into structured facts.
Job uploads accept PDF, DOCX, text and Markdown; cover-letter downloads support text and PDF on A4 or Letter.

Resume history stores prior states, with the current document remaining the authoritative latest state.
Snapshot persistence precedes the document save and does not use multi-document transactions; an interrupted save may leave an unused restore point, while preserving the prior content.
Autosave retries network failures while the page remains open and warns on unload; it is not an offline document store.
View counts are basic request counts, not deduplicated unique visitors.
AI in-flight deduplication is process-local; cached results are persisted per account.

Temporary DEBUG_RESUMEXPRESS instrumentation, including layout page counts, remains until the user confirms it may be removed.


## September 6 continuation

Dashboard health shows missing selected-section content separately from historical ATS scores, marks reviews stale when the resume has changed, and links to current saved AI suggestions.
Coach context includes the latest owned ATS review, recent conversation history and verified version transitions following approved AI edits.
Analysis pagination filters by tool on the server.

The layout optimizer measures up to nine font/spacing combinations and proposes a change only when it reduces the page count.
It preserves content and template choice, never reduces text below 10 pt unless the existing size was already smaller, and requires the user to apply the proposal.
The proposal endpoint does not save changes.
The PDF renderer measures entry headings and preserves the Modern column when starting a new page.

`POST /api/v1/career/jobs/import` accepts a PDF or DOCX filename and base64 file content, extracts text without saving a job or calling AI, and returns it for review.
Imports are authenticated, limited to 512 KB and 30,000 extracted characters, and run in disposable workers with a ten-second timeout and a two-worker limit per API process.
Scanned and encrypted PDFs require pasted text; PDF imports are limited to 20 pages.
`GET /api/v1/career/cover-letters/:id/pdf?paperSize=A4` downloads the owned saved letter; `Letter` is also supported.
`POST /api/v1/resume/:id/layout/optimize` returns measured layout settings without changing the resume.

New parser dependencies are `pdf-parse` and `mammoth`.
A `qs` override selects its patched compatible release.
Additional owner/resume/kind/date and owner/update-date indexes support coach and dashboard reads.
Run `npm run migrate` from the backend to apply them; optional structured section entries need no content rewrite.
After the user updated database access, the authorized migration connected successfully and ensured all declared indexes across the 11 application models.
A migration progress-log error was corrected before the successful rerun; no resume content was rewritten.

The initial credential blockers were resolved during the release continuation below.
The user confirmed that pushing both main branches triggers their existing Vercel deployments.

Verification after these changes: the Node 24 frontend production build, TypeScript and lint pass; backend syntax and 49 existing integration checks pass.
The dependency audit reports zero known backend vulnerabilities after the `qs` patch.
Twelve long resume PDFs (six templates on A4 and Letter) were generated; all text remained within the checked page bounds, and the A4 pages plus a cover letter were visually reviewed.
A measured Modern layout proposal reduced the sample from three pages to two without removing content.
The actual PDF import worker extracted the cover-letter sample, and the Word parser read bundled DOCX samples; their short content was correctly rejected by the minimum-length rule.
A full-length synthetic Word document was subsequently imported successfully through the actual parser worker.
Dedicated import regression cases remain pending explicit permission to add tests.
No new import test file was written after automatic approval review rejected that action.
Interactive UI, accessibility and load testing are still pending; these checks do not establish production readiness.


## Create-resume dialog correction

The create-resume dialog now keeps its description as plain text and places the labeled title input outside that paragraph, removing the reported nested-paragraph hydration error.
TypeScript, lint and the production build pass.
The temporary development-only `[DEBUG-RESUMEXPRESS-DIALOG]` log reports whether the input is inside a paragraph and whether it has a label; it never prints the title.
Human verification of opening the dialog remains pending, and the log stays until the user explicitly authorizes removal.


## AI editor workflow

The dashboard and main navigation now prominently link to `/dashboard/ai`, which provides all AI tools and a direct route into the resume editor.
The editor starts with an AI assistant that accepts rough notes, an existing PDF/DOCX/text resume, or the saved Career Profile.
Users can generate a full resume draft, write a summary, or improve experience bullets without leaving the editor.
Summary and experience sections also have contextual AI buttons.

`GET /api/v1/career/ai/status` reports whether the server provider is configured without exposing credentials.
`POST /api/v1/career/generate/resume` returns a validated draft, exact source-evidence quotes and missing-information questions.
Unsupported draft fields are removed when their evidence cannot be found in candidate context.
`POST /api/v1/career/analyses/:id/apply-draft` requires `confirmed: true` and a selected field list; ownership and unchanged source content are checked before saving an AI-tagged version.
`POST /api/v1/career/documents/import` reuses the bounded document importer for resume text.
Drafts use the existing AIAnalysis output storage and ResumeVersion collections, so no additional database migration is required.

Users review the before/after content and select fields to apply; generation never silently changes resume data.
Applying an AI draft pauses autosave and locks editor controls until the saved resume has refreshed.
Drafts become inapplicable when the local resume has changed since generation.
Partial experience dates remain editable without inventing a month or day.
Temporary development diagnostics use `[DEBUG-RESUMEXPRESS-AI]` and log only the action and item counts, never career facts.

The local key is configured in the backend `.env`; the unused frontend `NEXT_PUBLIC_GOOGLE_AI_API_KEY` entry was removed.
Live structured summary and skills generation succeeded with synthetic candidate facts on September 6, 2026.
The authenticated resume-generation endpoint also returned a draft successfully; applying the selected fields and reloading the saved resume passed using a temporary database that was removed afterward.
Restart the backend after changing credentials or the model, then refresh the AI page.


## Guided AI workspace and release continuation

The frontend now uses a dark interface with teal accents, consistent design tokens, active sidebar navigation, responsive navigation, reduced-motion support and a skip link.
The landing page explains the workflow through reusable career facts, job-specific analysis, approved changes, version history and PDF export; the illustration is explicitly labeled as an example.
The dashboard uses live resource counts, resume previews, next-step links and current suggestions instead of decorative activity statistics.
The AI studio groups tools by writing, matching and preparation and supports one-click creation of a new draft.
The editor offers separate writing and preview views on mobile, a sticky preview on desktop and collapsed document settings.
Resume documents retain their white paper appearance for preview and export.
Authentication screens share the interface styling, password visibility controls are keyboard-accessible buttons, and signup leads to the AI studio.

Resume settings now expose industry, status and a saved target job with paginated job selection.
The optional `Resume.targetJob` string reference is validated for ownership on every content save, included in versions, and excluded from public resume responses.
AI context defaults to the saved target job when a request does not supply another job.
The optional reference and optional AIAnalysis usage metadata need no data backfill or index change, so no new migration is required.
The existing `npm run migrate` command remains sufficient for declared indexes.

Full AI drafts include per-field reasons and supporting evidence and can be edited before approval.
The apply endpoint validates edited fields, rejects edits outside the selected proposal, checks ownership and rejects stale content.
The copilot keeps selected resume/job context while switching between chat, writing, analysis, letters and interview workflows.
Its approved-change context covers all supported draft fields.
Undo/redo keyboard shortcuts operate outside text inputs so native text undo remains available.

Saved ATS and match analyses support score sorting.
The resume list supports status and latest-ATS-score sorting, with unreviewed resumes last and historical scores marked when the resume has changed.
Provider-reported input, output, cached and total token counts are stored when available, including reported validation-retry usage.
Cached results reuse the original analysis record; token counts are not presented as billing estimates.
Rate limits, authorization failures and unavailable models now produce specific sanitized provider errors.
Temporary diagnostics remain until removal is explicitly authorized.

GitHub CLI authentication and write access were verified for `shivanshthakur4u` and both existing repositories.
SMTP connection and authentication succeeded with local credentials; no verification email was sent.
Live synthetic checks passed job parsing, ATS analysis, job matching, optimizer generation/application, summaries, bullets, skills, LinkedIn, career-gap plans and contextual coaching.
The initial later provider failures were transient; the subsequent full-draft and cover-letter requests succeeded.
The full draft returned field explanations, accepted user edits before approval and persisted the approved content.
The cover-letter flow generated, edited, saved and downloaded a PDF, and an application progressed through Saved, Applied, Interview and Offer.
Score ordering, target-job ownership, unselected-edit rejection and stale-draft protection were checked in temporary databases.
All synthetic databases were removed after their checks.
No new regression test files were added.

Browser-based visual review remains pending because the user prohibits browser access.
Local environment files are excluded from Git; Vercel must have matching production AI, SMTP, database and application URL settings configured separately.

Interview question generation and two live answer evaluations succeeded; completing that live session was blocked by a provider HTTP 429 quota/rate-limit response.
The temporary interview database was removed, and the remaining live completion check was not marked as passed.
The redesigned frontend passed type checking, lint, production build, and HTTP checks for the landing and login pages.
