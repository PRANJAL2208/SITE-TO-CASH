# Site-to-Cash Implementation Checklist

## Phase 1: Project Skeleton & Local Dev Verification
- [x] Inspect empty workspace and toolchain
- [x] Define minimal architecture, storage abstractions (`FileStore`, `CaseRepository`), and strict Pydantic domain models
- [x] Create FastAPI backend skeleton (`health`, `documents`, `cases` routes + service stubs)
- [x] Create React + TypeScript + Vite frontend skeleton with `/api` proxy
- [x] Add `.env.example`, `.gitignore`, `README.md`, `STATUS.md`, and `samples/README.md`
- [x] Install dependencies, run `pytest`, run `tsc --noEmit && vite build`, and verify live FastAPI + Vite dev proxy

## Phase 2: Document Ingestion & Labelled Demo Data
- [x] Add `pypdf`, `openpyxl`, and `python-multipart` to `backend/requirements.txt`
- [x] Implement contract PDF upload (`POST /api/documents/contract`) with page-level text extraction, scanned-PDF reporting, and verbatim page references
- [x] Implement BOQ Excel upload (`POST /api/documents/boq`) with sheet/row/rate/unit/quantity extraction, safe merged-cell/blank-row handling, and nullable missing values
- [x] Persist uploaded files via `FileStore` and extracted metadata/extractions via `CaseRepository` with per-project duplicate prevention
- [x] Add explicitly labelled **DEMO DATA** sample subcontract PDF and BOQ Excel workbook in `samples/`
- [x] Wire frontend Document Upload panel and Extraction Results inspector to live upload/list/detail endpoints

## Phase 3: Site Instruction Intake & Gemini Extraction
- [x] Add `google-genai` SDK to `backend/requirements.txt`
- [x] Implement `GeminiClient` reading `GEMINI_API_KEY`, `GEMINI_MODEL`, and `GEMINI_TIMEOUT_SECONDS` from environment config with structured JSON output, Pydantic validation, and typed timeout/rate-limit/malformed error handling
- [x] Implement `POST /api/cases/instructions` supporting mandatory instruction text plus optional image/audio attachments, preserving original input unchanged
- [x] Extract structured `ChangeEventFields` (instruction description, issuer/role, recipient, site/location, date, requested work, affected activity, quantities/units/materials, deadlines, scope-change indicators, missing/ambiguous items, and evidence references)
- [x] Implement `PATCH /api/cases/{case_id}/extraction` and `GET /api/cases/{case_id}` for QS/user edits and confirmation while preserving original input and AI suggestion unchanged
- [x] Wire frontend Site Instruction submission, AI suggestion display, and human edit/confirmation workflow (`InstructionTab.tsx`)

## Phase 4: Contract/BOQ Retrieval & Commercial Assessment
- [x] Retrieve relevant contract clauses and BOQ line items from uploaded project documents (`retrieval.py`, project-scoped)
- [x] Assess confirmed instruction into `existing_scope`, `potential_variation`, `approval_or_notice_missing`, `insufficient_evidence`, or `ambiguous` (`GeminiClient.assess_commercial_change`)
- [x] Enforce mandatory verbatim `SourceReference` objects, reject fabricated citations, and separate directly documented facts, AI interpretation, missing evidence, and QS review status
- [x] Persist assessments (`POST /api/cases/{case_id}/assessment`, `GET /api/cases/{case_id}/assessment`, `GET /api/assessments`) without overwriting original instruction or confirmed extraction
- [x] Display retrieved clauses, BOQ rows, source references, missing evidence, and follow-up in the frontend Contract Assessment view (`AssessmentTab.tsx`)

## Phase 5: Deterministic Calculations & QS Review Workbench
- [x] Implement `calculator.py` using pure-Python `Decimal` arithmetic (`HALF_UP`/`HALF_EVEN`, multiple categories, additions/deductions, explicit-only tax) preserving BOQ references separately from QS-proposed values
- [x] Keep missing rates, quantities, or amounts strictly `null` (`None`) with clear partial-estimate warnings and missing-input flags
- [x] Implement `reviews.py` routes (`GET/POST/PUT cost-estimate`, `PATCH /api/cases/{case_id}/review`, `GET review-history`) with project isolation and append-only audit trail
- [x] Build QS Review Workbench UI (`QsReviewTab.tsx`) clearly separating **AI Suggestion** from **QS Human Decision**, cost build-up, and review history

## Phase 6: Draft Variation Report & Variation Register
- [x] Implement `report_generator.py` (with `reportlab` + `pypdf` verification) and `POST /api/cases/{case_id}/report` producing a structured 17-section PDF evidence pack with `DRAFT — NOT SUBMITTED` / approval status labels and `DEMO DATA` markers
- [x] Include source citations adjacent to claims, missing items, notice requirements (contract evidence only), deterministic calculation table, and AI-vs-QS separation
- [x] Implement strict 9-state variation lifecycle (`detected` through `paid`), commercial tracking, append-only lifecycle history, authorized PDF downloads, and deterministic dashboard metrics (`lifecycle.py`, `reports.py`)
- [x] Complete Variation Register & Commercial Dashboard UI (`RegisterTab.tsx`) with project/status/date filtering, status badges, evidence pack generation/download, and lifecycle updates

## Phase 7: Verification & Commercial Guardrail Tests
- [x] Add unit and integration tests verifying zero invented rates/quantities/clauses/approvals (`grounding.py`, `test_phase7_guardrails_and_security.py`)
- [x] Add tests confirming deterministic `Decimal` calculation accuracy, null-handling, and proposed vs. approved/billed/paid separation (`test_reviews.py`, `test_reports_and_register.py`)
- [x] Add tests verifying AI-suggestion vs. QS-decision separation, `is_demo` labelling, AI reliability, prompt-injection fencing, upload bounds/signatures, secret redaction, project isolation, and 14-step synthetic E2E workflow (`test_phase7_e2e_workflow.py`)

## Phase 8: Google Cloud Deployment Readiness
- [ ] Implement `GCSFileStore` and `FirestoreCaseRepository` behind `backend/app/storage/base.py`
- [ ] Add Dockerfile / Cloud Run configuration for backend and static frontend hosting
- [ ] Document Secret Manager configuration for `GEMINI_API_KEY` and GCP IAM permissions
