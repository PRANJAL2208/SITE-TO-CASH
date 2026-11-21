# Site-to-Cash Project Status

**Current Phase:** Phase 7 Complete (Commercial Guardrails, Reliability, Security & End-to-End Verification)  
**Last Verified:** 2026-11-21

## What Works Today

- **Phases 1–6 End-to-End Pipeline (Preserved & Hardened)**:
  - Document ingestion (`documents.py`, `document_parser.py`), site instruction intake & human confirmation (`cases.py`), project-scoped retrieval & preliminary commercial assessment (`assessments.py`, `retrieval.py`), deterministic `Decimal` cost workbench & QS decisions (`reviews.py`, `calculator.py`), 17-section PDF variation evidence packs (`report_generator.py`), 9-state variation lifecycle tracking, authorized PDF downloads, and pure-`Decimal` dashboard (`reports.py`, `lifecycle.py`).
- **Phase 7 Independent Source-Grounding & Guardrail Engine (`backend/app/services/grounding.py`)**:
  - `validate_source_reference` and `validate_assessment_grounding` independently verify cited PDF page numbers, BOQ sheet/row locations, verbatim excerpts, document identity, and project ownership (`502` on fabricated/ungrounded citations in `assessments.py`, `400` on invalid `boq_reference` in `reviews.py`).
  - `validate_instruction_evidence_references` detects non-verbatim instruction quotes or forged source IDs.
  - `detect_unsupported_commercial_claims` deterministically flags forbidden AI overreach claims (`contractually approved`, `legally payable`, `guaranteed recoverable`, etc.) in `guardrail_warnings` and `Alert` UI banners without auto-advancing QS decisions or lifecycle states.
  - Unsupported optional AI findings are explicitly tagged `grounding_status="unsupported"` in API payloads, React UI (`AssessmentTab.tsx`), and generated PDFs (`report_generator.py`).
- **Phase 7 Security, Prompt-Injection & Reliability Hardening (`backend/app/services/security.py`, `gemini_client.py`, `main.py`)**:
  - Scrubbed real/non-empty key value from `.env.example` (now `GEMINI_API_KEY=`).
  - Enforced bounded uploads (`MAX_DOCUMENT_UPLOAD_BYTES`, `MAX_ATTACHMENT_UPLOAD_BYTES`), binary magic-byte file signature verification (`validate_file_signature`), strict `project_id` validation (`validate_project_id`), path-traversal filename sanitization (`sanitize_filename`), parser row/col/page caps (`MAX_PDF_PAGES=500`, `MAX_BOQ_SCAN_ROWS=5000`, `MAX_BOQ_SCAN_COLS=100`), and `instruction_text` length cap.
  - Added `<untrusted_*>` XML delimiter fencing with closing-tag neutralization (`sanitize_untrusted_delimiter`) against prompt injection in uploaded contracts, BOQs, and site instructions.
  - Added secret redaction (`redact_secrets`) on upstream Gemini errors and a safe global unhandled `500` handler returning `{"detail": "Internal server error."}`.

## Verification Results

- **Backend tests (`backend\.venv\Scripts\python.exe -m pytest -c backend\pytest.ini backend\tests -v`):** **53 passed, 0 failed** in `60.57s` (`9` in `test_assessments.py`, `7` in `test_documents.py`, `3` in `test_health.py`, `8` in `test_instructions.py`, `1` in `test_phase7_e2e_workflow.py`, `6` in `test_phase7_guardrails_and_security.py`, `8` in `test_reports_and_register.py`, `11` in `test_reviews.py`).
- **Frontend typecheck & production build (`cd frontend; npm run build`):** `tsc --noEmit && vite build` passed (`32 modules transformed`, built in `1.24s`).

## Genuinely Live vs. Mocked Integrations

- **Live / Deterministic (Verified):** Local file/JSON storage, PDF & Excel parsing (`pypdf` / `openpyxl`), retrieval, source-grounding verification, commercial overreach guardrails, upload signature/size checks, `Decimal` financial calculations, ReportLab PDF generation & `pypdf` validation, 9-state lifecycle state machine, dashboard aggregation, and React + TypeScript production build.
- **Mocked in Automated Tests:** Gemini API extraction (`extract_change_event`) and assessment (`assess_commercial_change`) calls inside automated pytest suites use mocked `GeminiClient` responses via `app.dependency_overrides[get_gemini_client]` because `GEMINI_API_KEY` is not set in local `.env`.
- **Unperformed:** Live Chrome interactive browser walkthrough (browser automation unavailable in this environment).

## Known Security & Prototype Limitations

- **No Authentication / RBAC (Critical Prototype Limitation):** Multi-user login, JWT/session authentication, and role-based access control are NOT implemented. Project isolation currently keys off caller-supplied `project_id` parameters; therefore **this prototype is not production-ready for multi-customer confidential data**.
- **Deferred to Phase 8:** Google Cloud Storage (`GCSFileStore`), Firestore (`FirestoreCaseRepository`), Cloud Run Docker packaging, and Secret Manager IAM configuration.

## What Remains

See [CHECKLIST.md](./CHECKLIST.md) for Phase 8.
