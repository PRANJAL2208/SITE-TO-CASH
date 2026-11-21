"""Phase 6 tests for PDF evidence packs, variation lifecycle, register filtering, and dashboard metrics."""

from io import BytesIO
import json
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.config import Settings
from app.main import create_app
from app.services.gemini_client import GeminiClient, get_gemini_client


def _settings_for_test(tmp_path: Path) -> Settings:
    return Settings(
        app_name="Site-to-Cash",
        app_version="0.1.0",
        app_env="test",
        cors_origins=["http://localhost:5173"],
        gemini_api_key="dummy-test-key",
        gemini_model="gemini-2.5-flash",
        gemini_timeout_seconds=15.0,
        storage_backend="local",
        local_data_dir=tmp_path,
    )


def _extraction_json(instruction_summary: str = "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.") -> str:
    return json.dumps(
        {
            "instruction_description": {
                "value": instruction_summary,
                "status": "extracted",
                "evidence_quote": instruction_summary[:60],
            },
            "issuer_name": {
                "value": "Alex Chen",
                "status": "extracted",
                "evidence_quote": "Alex Chen",
            },
            "issuer_role": {
                "value": "Site PM",
                "status": "extracted",
                "evidence_quote": "Site PM",
            },
            "recipient": {
                "value": "MEP Subcontractor",
                "status": "extracted",
                "evidence_quote": "MEP Subcontractor",
            },
            "project_site_location": {
                "value": "Level 3 East Corridor",
                "status": "extracted",
                "evidence_quote": "Level 3 East Corridor",
            },
            "communication_date": {
                "value": "2026-11-19",
                "status": "extracted",
                "evidence_quote": "2026-11-19",
            },
            "requested_work": {
                "value": "Install 100mm chilled water pipe",
                "status": "extracted",
                "evidence_quote": "100mm chilled water pipe",
            },
            "affected_activity": {
                "value": "Chilled water riser piping",
                "status": "extracted",
                "evidence_quote": "chilled water",
            },
            "mentioned_quantities": [
                {
                    "item_or_material": "100mm chilled water pipe",
                    "quantity": "15",
                    "unit": "m",
                    "status": "extracted",
                    "evidence_quote": "15 m of 100mm chilled water pipe",
                }
            ],
            "mentioned_materials": [
                {
                    "value": "100mm chilled water pipe",
                    "status": "extracted",
                    "evidence_quote": "100mm chilled water pipe",
                }
            ],
            "mentioned_deadlines": [],
            "scope_change_indicators": [
                {
                    "value": "Additional 15 m routing requested",
                    "status": "extracted",
                    "evidence_quote": "additional 15 m",
                }
            ],
            "missing_or_ambiguous_information": [
                "Written PM confirmation under Clause 4.2 not attached."
            ],
        }
    )


def _assessment_json(incomplete: bool = False) -> str:
    return json.dumps(
        {
            "assessment_category": "insufficient_evidence" if incomplete else "potential_variation",
            "requested_work_summary": "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
            "documented_facts": [
                {
                    "statement": "Clause 1.1 includes chilled water piping shown on Drawings M-101 to M-104.",
                    "source_ref_ids": ["C1"],
                },
                {
                    "statement": "BOQ Row 6 (A1) records 100mm insulated chilled water pipe at rate 85.5 per m.",
                    "source_ref_ids": ["B1"],
                },
            ],
            "scope_comparison": "Instruction adds 15 m pipework outside shown corridor run; BOQ A1 shows base rate 85.50/m.",
            "ai_interpretation_summary": "Preliminary potential variation pending drawing confirmation and Clause 4.2 written instruction.",
            "explicit_inclusions": [
                {
                    "statement": "Chilled water piping on Drawings M-101 to M-104 is in Subcontract scope.",
                    "source_ref_ids": ["C1"],
                }
            ],
            "explicit_exclusions": [],
            "potential_scope_overlap": [
                {
                    "statement": "BOQ Row 6 (A1) covers 100mm insulated chilled water pipe.",
                    "source_ref_ids": ["B1"],
                }
            ],
            "written_approval_requirements": [
                {
                    "statement": "Clause 4.2 requires written PM confirmation within 5 business days.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [
                {
                    "statement": "Clause 8.3 requires 7-day notice for suspected variations.",
                    "source_ref_ids": ["C4"],
                }
            ],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": (
                ["Written PM confirmation missing.", "Approved marked-up drawing missing."]
                if incomplete
                else []
            ),
            "recommended_qs_followup": ["Verify Drawings M-101 to M-104 and issue written notice."],
        }
    )


def _make_client(
    monkeypatch,
    tmp_path: Path,
    *,
    incomplete_assessment: bool = False,
) -> TestClient:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda prompt, _b, _m: (
            _assessment_json(incomplete=incomplete_assessment)
            if "Retrieved Contract Clauses:" in prompt
            else _extraction_json()
        ),
    )
    return TestClient(app)


def _upload_demo_docs(client: TestClient, project_id: str, is_demo: bool = True) -> list[str]:
    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()
    xlsx_bytes = (samples_dir / "demo_boq_sample.xlsx").read_bytes()

    doc_resp = client.post(
        "/api/documents/contract",
        data={"project_id": project_id, "is_demo": str(is_demo).lower()},
        files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
    )
    assert doc_resp.status_code == 201
    boq_resp = client.post(
        "/api/documents/boq",
        data={"project_id": project_id, "is_demo": str(is_demo).lower()},
        files={
            "file": (
                "demo_boq_sample.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert boq_resp.status_code == 201
    return [doc_resp.json()["document"]["id"], boq_resp.json()["document"]["id"]]


def _create_case_with_assessment_cost_and_qs(
    client: TestClient,
    project_id: str,
    *,
    is_demo: bool = True,
    currency: str = "GBP",
    quantity: str = "15",
    rate: str = "85.50",
    confirm_qs: bool = True,
) -> dict:
    instr_resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": project_id,
            "instruction_text": "DEMO DATA: Alex Chen (Site PM) on 2026-11-19 asked MEP Subcontractor to install additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
            "is_demo": str(is_demo).lower(),
        },
    )
    assert instr_resp.status_code == 201
    case = instr_resp.json()

    conf_resp = client.patch(
        f"/api/cases/{case['id']}/extraction",
        json={
            "fields": case["ai_extraction"]["fields"],
            "confirmed_by": "A. Patel (QS)",
            "confirm": True,
        },
    )
    assert conf_resp.status_code == 200

    assess_resp = client.post(
        f"/api/cases/{case['id']}/assessment",
        params={"project_id": project_id},
    )
    assert assess_resp.status_code == 201
    assessment = assess_resp.json()
    boq_ref = assessment["retrieved_boq_items"][0]["source_reference"]

    cost_resp = client.put(
        f"/api/cases/{case['id']}/cost-estimate",
        params={"project_id": project_id},
        json={
            "reviewer_name": "A. Patel (QS)",
            "reason": "Build up using BOQ reference rate",
            "currency": currency,
            "decimal_places": 2,
            "rounding_mode": "HALF_UP",
            "line_items": [
                {
                    "description": "100mm insulated chilled water pipe addition",
                    "category": "material",
                    "line_type": "addition",
                    "unit": "m",
                    "quantity": quantity,
                    "rate": rate,
                    "quantity_source": "confirmed_instruction",
                    "rate_source": "boq_reference",
                    "verification_status": "verified",
                    "boq_reference": boq_ref,
                    "original_boq_item_code": "A1",
                    "original_boq_unit": "m",
                    "original_boq_quantity": "120",
                    "original_boq_rate": "85.50",
                }
            ],
        },
    )
    assert cost_resp.status_code == 200

    if confirm_qs:
        qs_resp = client.patch(
            f"/api/cases/{case['id']}/review",
            params={"project_id": project_id},
            json={
                "reviewer_name": "A. Patel (QS)",
                "decision_action": "accept_assessment",
                "confirmed_category": "potential_variation",
                "reason": "QS reviewed preliminary assessment and documented quantities.",
                "notes": "Confirmed variation subject to written PM instruction.",
                "is_draft": False,
            },
        )
        assert qs_resp.status_code == 200
        return qs_resp.json()["case"]

    detail_resp = client.get(f"/api/cases/{case['id']}", params={"project_id": project_id})
    assert detail_resp.status_code == 200
    return detail_resp.json()


def test_pdf_evidence_pack_generation_content_and_source_refs(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    project_id = "proj-pdf"
    doc_ids = _upload_demo_docs(client, project_id, is_demo=True)
    case = _create_case_with_assessment_cost_and_qs(client, project_id, is_demo=True)
    case_id = case["id"]

    assert case["variation_reference"] == "VAR-001"
    assert case["lifecycle_status"] == "detected"

    # Move explicitly into under_review -> drafted
    t1 = client.patch(
        f"/api/cases/{case_id}/lifecycle",
        params={"project_id": project_id},
        json={
            "target_status": "under_review",
            "responsible_person": "A. Patel (QS)",
            "supporting_document_ids": doc_ids,
        },
    )
    assert t1.status_code == 200
    t2 = client.patch(
        f"/api/cases/{case_id}/lifecycle",
        params={"project_id": project_id},
        json={
            "target_status": "drafted",
            "responsible_person": "A. Patel (QS)",
        },
    )
    assert t2.status_code == 200

    report_resp = client.post(
        f"/api/cases/{case_id}/report",
        params={"project_id": project_id},
        json={
            "prepared_by": "A. Patel (QS)",
            "project_name": "Marina Tower MEP Package (DEMO)",
            "subcontractor_name": "Apex Mechanical Ltd (DEMO)",
        },
    )
    assert report_resp.status_code == 201
    report = report_resp.json()
    assert report["is_draft"] is True
    assert report["status_label"] == "DRAFT — NOT SUBMITTED"
    assert report["is_demo"] is True
    assert report["page_count"] >= 1

    # Generating report must NEVER auto-advance lifecycle to submitted/approved
    after_case = client.get(f"/api/cases/{case_id}").json()
    assert after_case["lifecycle_status"] == "drafted"

    dl_resp = client.get(
        f"/api/cases/{case_id}/reports/{report['id']}/download",
        params={"project_id": project_id},
    )
    assert dl_resp.status_code == 200
    assert dl_resp.headers["content-type"].startswith("application/pdf")
    assert dl_resp.content.startswith(b"%PDF-")

    reader = PdfReader(BytesIO(dl_resp.content))
    assert len(reader.pages) == report["page_count"]
    full_text = "\n".join((page.extract_text() or "") for page in reader.pages)

    assert "&amp;" not in full_text
    assert f"Page 1 of {len(reader.pages)}" in full_text
    assert "DRAFT — NOT SUBMITTED" in full_text
    assert "DEMO DATA" in full_text
    assert "UNAPPROVED VARIATION" in full_text
    assert "NOT APPROVED" in full_text
    assert "VAR-001" in full_text
    assert "Marina Tower MEP Package (DEMO)" in full_text
    assert "Apex Mechanical Ltd (DEMO)" in full_text
    assert "1. Project & Subcontractor Details" in full_text
    assert "6. Retrieved Contract Clauses & Exact Page References" in full_text
    assert "7. Relevant BOQ Rows with Sheet & Row References" in full_text
    assert "9. Preliminary AI Assessment" in full_text
    assert "10. Human-Confirmed QS Decision" in full_text
    assert "12. Deterministic Cost Calculation" in full_text
    assert "15. Notice Requirements & Relevant Dates" in full_text
    assert "17. Document Generation Timestamp & Audit History" in full_text
    assert "AI SUGGESTION" in full_text
    assert "HUMAN QS DECISION" in full_text
    assert "Page " in full_text
    assert "GBP 1282.50" in full_text
    assert "A. Patel (QS)" in full_text
    assert report["id"] in full_text


def test_pdf_missing_data_handling_never_fabricates(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    project_id = "proj-minimal"

    # Submit instruction WITHOUT uploading contract/BOQ or confirming extraction/assessment
    instr_resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": project_id,
            "instruction_text": "Alex Chen asked for extra ductwork bracket supports.",
            "is_demo": "false",
        },
    )
    assert instr_resp.status_code == 201
    case_id = instr_resp.json()["id"]

    # Add partial cost estimate with a missing rate (None)
    cost_resp = client.put(
        f"/api/cases/{case_id}/cost-estimate",
        params={"project_id": project_id},
        json={
            "reviewer_name": "J. Doe (QS)",
            "currency": "USD",
            "line_items": [
                {
                    "description": "Extra ductwork bracket supports",
                    "category": "material",
                    "line_type": "addition",
                    "unit": "nr",
                    "quantity": "10",
                    "rate": None,
                    "quantity_source": "qs_entered",
                    "rate_source": "missing",
                    "verification_status": "missing_data",
                }
            ],
        },
    )
    assert cost_resp.status_code == 200

    report_resp = client.post(
        f"/api/cases/{case_id}/report",
        params={"project_id": project_id},
        json={"prepared_by": "J. Doe (QS)"},
    )
    assert report_resp.status_code == 201
    report = report_resp.json()
    assert report["is_draft"] is True
    assert report["is_demo"] is False

    dl_resp = client.get(
        f"/api/cases/{case_id}/reports/{report['id']}/download",
        params={"project_id": project_id},
    )
    assert dl_resp.status_code == 200
    full_text = "\n".join(
        (p.extract_text() or "") for p in PdfReader(BytesIO(dl_resp.content)).pages
    )
    normalized_text = " ".join(full_text.split())

    assert "DRAFT — NOT SUBMITTED" in normalized_text
    assert "Not supplied (missing metadata)" in normalized_text
    assert "AI Suggestion Only (Unconfirmed by Human)" in normalized_text
    assert "MISSING" in normalized_text
    assert "NOT APPROVED" in normalized_text
    assert "No contractual notice periods or time-bar clauses were retrieved" in normalized_text
    assert "No contract/BOQ assessment recorded yet" in normalized_text


def test_lifecycle_valid_transitions_and_append_only_history(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    project_id = "proj-lifecycle"
    _upload_demo_docs(client, project_id, is_demo=False)
    case = _create_case_with_assessment_cost_and_qs(client, project_id, is_demo=False)
    case_id = case["id"]

    # Snapshot immutable AI & instruction fields before lifecycle changes
    orig_input = case["original_input"]
    ai_ext = case["ai_extraction"]
    conf_ext = case["confirmed_extraction"]
    assess_before = client.get(f"/api/cases/{case_id}/assessment").json()

    transitions = [
        {"target_status": "under_review", "responsible_person": "QS Lee"},
        {"target_status": "drafted", "responsible_person": "QS Lee"},
        {
            "target_status": "submitted",
            "responsible_person": "PM Rivera",
            "submission_reference": "VO-SUB-014",
            "submission_date": "2026-11-20",
            "recipient": "Main Contractor QS",
            "claimed_amount": "1282.50",
        },
        {
            "target_status": "approved",
            "responsible_person": "PM Rivera",
            "approved_amount": "1150.00",
        },
        {
            "target_status": "executed",
            "responsible_person": "Site Sup Sam",
            "execution_status": "Installed & inspected on Level 3",
        },
        {
            "target_status": "billed",
            "responsible_person": "Finance Kim",
            "invoice_reference": "INV-2026-089",
            "billed_amount": "1150.00",
        },
        {
            "target_status": "paid",
            "responsible_person": "Finance Kim",
            "payment_status": "Settled",
            "payment_date": "2026-12-05",
            "paid_amount": "1150.00",
        },
    ]
    for step in transitions:
        resp = client.patch(
            f"/api/cases/{case_id}/lifecycle",
            params={"project_id": project_id},
            json=step,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["case"]["lifecycle_status"] == step["target_status"]

    hist_resp = client.get(
        f"/api/cases/{case_id}/lifecycle-history",
        params={"project_id": project_id},
    )
    assert hist_resp.status_code == 200
    history = hist_resp.json()
    assert [h["to_status"] for h in history] == [
        "detected",
        "under_review",
        "drafted",
        "submitted",
        "approved",
        "executed",
        "billed",
        "paid",
    ]
    assert history[0]["from_status"] is None
    assert history[4]["tracking_snapshot"]["approved_amount"] == "1150.00"

    # Verify upstream immutable evidence never mutated
    final_case = client.get(f"/api/cases/{case_id}").json()
    assert final_case["original_input"] == orig_input
    assert final_case["ai_extraction"] == ai_ext
    assert final_case["confirmed_extraction"] == conf_ext
    assert client.get(f"/api/cases/{case_id}/assessment").json()["ai_assessment"] == assess_before["ai_assessment"]

    # Second case testing rejected -> under_review reopen -> approved -> billed -> paid
    case2 = _create_case_with_assessment_cost_and_qs(client, project_id, is_demo=False)
    cid2 = case2["id"]
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "rejected", "responsible_person": "QS Lee", "reason": "Withdrawn pending site check"},
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "under_review", "responsible_person": "QS Lee", "reason": "Reopened after check"},
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "drafted", "responsible_person": "QS Lee"},
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={
            "target_status": "submitted",
            "responsible_person": "QS Lee",
            "submission_reference": "VO-SUB-015",
            "submission_date": "2026-11-21",
        },
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "approved", "responsible_person": "QS Lee", "approved_amount": "900.00"},
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "billed", "responsible_person": "Finance Kim", "invoice_reference": "INV-90"},
    ).status_code == 200
    assert client.patch(
        f"/api/cases/{cid2}/lifecycle",
        json={"target_status": "paid", "responsible_person": "Finance Kim", "payment_date": "2026-12-10"},
    ).status_code == 200


def test_lifecycle_rejects_invalid_transitions_and_missing_fields(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    project_id = "proj-invalid"
    _upload_demo_docs(client, project_id)
    case = _create_case_with_assessment_cost_and_qs(client, project_id)
    case_id = case["id"]

    # Skipping states rejected
    for bad_target in ("submitted", "approved", "executed", "billed", "paid", "drafted", "detected"):
        resp = client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": bad_target, "responsible_person": "QS"},
        )
        assert resp.status_code == 400

    # Rejected requires reason
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "rejected", "responsible_person": "QS"},
        ).status_code
        == 400
    )

    # Move detected -> under_review -> drafted
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "under_review", "responsible_person": "QS"},
        ).status_code
        == 200
    )
    # Reject approved_amount while transitioning to pre-approval state
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={
                "target_status": "drafted",
                "responsible_person": "QS",
                "approved_amount": "1000.00",
            },
        ).status_code
        == 400
    )
    # Reject binary float money field
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={
                "target_status": "drafted",
                "responsible_person": "QS",
                "claimed_amount": 1000.5,
            },
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "drafted", "responsible_person": "QS"},
        ).status_code
        == 200
    )

    # Submitted requires submission_reference & submission_date
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "submitted", "responsible_person": "QS"},
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={
                "target_status": "submitted",
                "responsible_person": "QS",
                "submission_reference": "VO-1",
                "submission_date": "2026-11-20",
            },
        ).status_code
        == 200
    )

    # Tracking-only update cannot set approved_amount on submitted variation
    assert (
        client.patch(
            f"/api/cases/{case_id}/tracking",
            json={"updated_by": "QS", "approved_amount": "1200.00"},
        ).status_code
        == 400
    )
    # Tracking-only note update works cleanly
    tr_ok = client.patch(
        f"/api/cases/{case_id}/tracking",
        json={"updated_by": "QS", "notes": "Sent copy via portal"},
    )
    assert tr_ok.status_code == 200
    assert tr_ok.json()["lifecycle_status"] == "submitted"
    assert tr_ok.json()["commercial_tracking"]["notes"] == "Sent copy via portal"

    # Approve -> bill (missing invoice fails) -> bill -> paid (missing payment_date fails)
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "approved", "responsible_person": "QS"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "billed", "responsible_person": "Fin"},
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={
                "target_status": "billed",
                "responsible_person": "Fin",
                "invoice_reference": "INV-1",
            },
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "paid", "responsible_person": "Fin"},
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={
                "target_status": "paid",
                "responsible_person": "Fin",
                "payment_date": "2026-12-01",
            },
        ).status_code
        == 200
    )
    # Paid is terminal
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            json={"target_status": "under_review", "responsible_person": "QS"},
        ).status_code
        == 400
    )


def test_proposed_vs_approved_amount_separation(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    project_id = "proj-sep"
    _upload_demo_docs(client, project_id, is_demo=False)
    case = _create_case_with_assessment_cost_and_qs(
        client, project_id, is_demo=False, currency="GBP", quantity="10", rate="100.00"
    )
    cid = case["id"]

    for payload in [
        {"target_status": "under_review", "responsible_person": "QS"},
        {"target_status": "drafted", "responsible_person": "QS"},
        {
            "target_status": "submitted",
            "responsible_person": "QS",
            "submission_reference": "SUB-10",
            "submission_date": "2026-11-20",
            "claimed_amount": "1200.00",
        },
        # Approve WITHOUT setting approved_amount -> must stay None (never copy 1200.00)
        {"target_status": "approved", "responsible_person": "QS"},
    ]:
        assert client.patch(f"/api/cases/{cid}/lifecycle", json=payload).status_code == 200

    approved_no_amt = client.get(f"/api/cases/{cid}").json()
    assert approved_no_amt["commercial_tracking"]["claimed_amount"] == "1200.00"
    assert approved_no_amt["commercial_tracking"]["approved_amount"] is None

    # Record lower negotiated approved amount
    upd = client.patch(
        f"/api/cases/{cid}/tracking",
        json={"updated_by": "QS", "approved_amount": "850.00"},
    )
    assert upd.status_code == 200
    assert upd.json()["commercial_tracking"]["claimed_amount"] == "1200.00"
    assert upd.json()["commercial_tracking"]["approved_amount"] == "850.00"

    metrics = client.get("/api/dashboard/metrics", params={"project_id": project_id}).json()
    gbp = metrics["amounts_by_currency"][0]
    assert gbp["proposed_total"] == "1200.00"
    assert gbp["approved_total"] == "850.00"
    assert gbp["approved_unbilled_total"] == "850.00"
    assert gbp["billed_total"] == "0.00"
    assert gbp["paid_total"] == "0.00"
    assert "total_revenue" not in gbp


def test_dashboard_metrics_exact_decimal_separation_and_demo_labelling(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path, incomplete_assessment=True)
    proj = "proj-dash"
    _upload_demo_docs(client, proj, is_demo=True)

    # 1. Demo case in `detected` (10 * 100 = 1000.00 GBP) -> awaiting review + incomplete evidence
    c1 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=True, currency="GBP", quantity="10", rate="100.00", confirm_qs=False
    )
    assert c1["lifecycle_status"] == "detected"

    # 2. Live case in `drafted` (20 * 50 = 1000.00 GBP)
    c2 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="GBP", quantity="20", rate="50.00"
    )
    client.patch(f"/api/cases/{c2['id']}/lifecycle", json={"target_status": "under_review", "responsible_person": "QS"})
    client.patch(f"/api/cases/{c2['id']}/lifecycle", json={"target_status": "drafted", "responsible_person": "QS"})

    # 3. Live case in `submitted` (claimed 500.25 GBP)
    c3 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="GBP", quantity="5", rate="100.05"
    )
    client.patch(f"/api/cases/{c3['id']}/lifecycle", json={"target_status": "under_review", "responsible_person": "QS"})
    client.patch(f"/api/cases/{c3['id']}/lifecycle", json={"target_status": "drafted", "responsible_person": "QS"})
    client.patch(
        f"/api/cases/{c3['id']}/lifecycle",
        json={
            "target_status": "submitted",
            "responsible_person": "QS",
            "submission_reference": "S-3",
            "submission_date": "2026-11-18",
        },
    )

    # 4. Live case in `approved` (proposed 2000.00 GBP, approved 1600.00 GBP -> approved not billed)
    c4 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="GBP", quantity="20", rate="100.00"
    )
    for step in [
        {"target_status": "under_review", "responsible_person": "QS"},
        {"target_status": "drafted", "responsible_person": "QS"},
        {"target_status": "submitted", "responsible_person": "QS", "submission_reference": "S-4", "submission_date": "2026-11-18"},
        {"target_status": "approved", "responsible_person": "QS", "approved_amount": "1600.00"},
    ]:
        client.patch(f"/api/cases/{c4['id']}/lifecycle", json=step)

    # 5. Live case in `billed` (proposed 300.00 GBP, approved 250.00 GBP, billed 250.00 GBP)
    c5 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="GBP", quantity="3", rate="100.00"
    )
    for step in [
        {"target_status": "under_review", "responsible_person": "QS"},
        {"target_status": "drafted", "responsible_person": "QS"},
        {"target_status": "submitted", "responsible_person": "QS", "submission_reference": "S-5", "submission_date": "2026-11-18"},
        {"target_status": "approved", "responsible_person": "QS", "approved_amount": "250.00"},
        {"target_status": "billed", "responsible_person": "Fin", "invoice_reference": "INV-5"},
    ]:
        client.patch(f"/api/cases/{c5['id']}/lifecycle", json=step)

    # 6. Live case in `paid` in USD (proposed 400.00 USD, approved 350.00 USD, billed 350.00 USD, paid 350.00 USD)
    c6 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="USD", quantity="4", rate="100.00"
    )
    for step in [
        {"target_status": "under_review", "responsible_person": "QS"},
        {"target_status": "drafted", "responsible_person": "QS"},
        {"target_status": "submitted", "responsible_person": "QS", "submission_reference": "S-6", "submission_date": "2026-11-18"},
        {"target_status": "approved", "responsible_person": "QS", "approved_amount": "350.00"},
        {"target_status": "billed", "responsible_person": "Fin", "invoice_reference": "INV-6"},
        {"target_status": "paid", "responsible_person": "Fin", "payment_date": "2026-11-20", "paid_amount": "350.00"},
    ]:
        client.patch(f"/api/cases/{c6['id']}/lifecycle", json=step)

    # 7. Rejected case (must NOT inflate proposed/potential totals or incomplete evidence)
    c7 = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=False, currency="GBP", quantity="99", rate="100.00"
    )
    client.patch(
        f"/api/cases/{c7['id']}/lifecycle",
        json={"target_status": "rejected", "responsible_person": "QS", "reason": "Base scope"},
    )

    resp = client.get("/api/dashboard/metrics", params={"project_id": proj})
    assert resp.status_code == 200
    m = resp.json()

    assert m["total_cases"] == 7
    assert m["demo_case_count"] == 1
    assert m["live_case_count"] == 6
    assert m["contains_demo_data"] is True
    assert "DEMO DATA" in m["demo_label"]
    assert m["awaiting_qs_review_count"] == 1
    assert m["drafted_not_submitted_count"] == 1
    assert m["submitted_awaiting_response_count"] == 1
    assert m["approved_not_billed_count"] == 1
    assert m["billed_unpaid_count"] == 1
    assert m["incomplete_evidence_count"] == 6  # c1..c6 have incomplete_assessment=True; c7 rejected excluded

    by_curr = {row["currency"]: row for row in m["amounts_by_currency"]}
    assert set(by_curr.keys()) == {"GBP", "USD"}
    gbp = by_curr["GBP"]
    assert gbp["potential_variation_value"] == "2500.25"  # c1(1000) + c2(1000) + c3(500.25)
    assert gbp["proposed_total"] == "4800.25"  # c1..c5 (excludes rejected c7)
    assert gbp["approved_total"] == "1850.00"  # c4(1600) + c5(250)
    assert gbp["approved_unbilled_total"] == "1600.00"  # c4 only
    assert gbp["billed_total"] == "250.00"  # c5
    assert gbp["billed_unpaid_total"] == "250.00"  # c5
    assert gbp["paid_total"] == "0.00"

    usd = by_curr["USD"]
    assert usd["potential_variation_value"] == "0.00"
    assert usd["proposed_total"] == "400.00"
    assert usd["approved_total"] == "350.00"
    assert usd["approved_unbilled_total"] == "0.00"
    assert usd["billed_total"] == "350.00"
    assert usd["billed_unpaid_total"] == "0.00"
    assert usd["paid_total"] == "350.00"


def test_register_filters_project_isolation_and_report_download_authorization(
    monkeypatch, tmp_path: Path
) -> None:
    client = _make_client(monkeypatch, tmp_path)
    doc_a = _upload_demo_docs(client, "proj-A")[0]
    _upload_demo_docs(client, "proj-B")

    c_a1 = _create_case_with_assessment_cost_and_qs(client, "proj-A")
    c_a2 = _create_case_with_assessment_cost_and_qs(client, "proj-A")
    c_b1 = _create_case_with_assessment_cost_and_qs(client, "proj-B")

    assert c_a1["variation_reference"] == "VAR-001"
    assert c_a2["variation_reference"] == "VAR-002"
    assert c_b1["variation_reference"] == "VAR-001"  # Per-project numbering

    client.patch(
        f"/api/cases/{c_a1['id']}/lifecycle",
        params={"project_id": "proj-A"},
        json={"target_status": "under_review", "responsible_person": "QS"},
    )

    # Filter by project & status
    filtered = client.get(
        "/api/cases",
        params={"project_id": "proj-A", "status": "under_review"},
    )
    assert filtered.status_code == 200
    assert [c["id"] for c in filtered.json()] == [c_a1["id"]]

    # Date filter
    today_str = c_a1["created_at"][:10]
    date_filtered = client.get(
        "/api/cases",
        params={"project_id": "proj-A", "date_from": today_str, "date_to": today_str},
    )
    assert date_filtered.status_code == 200
    assert len(date_filtered.json()) == 2
    assert (
        client.get("/api/cases", params={"date_from": "2099-01-01"}).json() == []
    )
    assert (
        client.get("/api/cases", params={"date_from": "bad-date"}).status_code == 400
    )

    # Cross-project 404 isolation
    assert client.get(f"/api/cases/{c_a1['id']}", params={"project_id": "proj-B"}).status_code == 404
    assert (
        client.patch(
            f"/api/cases/{c_a1['id']}/lifecycle",
            params={"project_id": "proj-B"},
            json={"target_status": "drafted", "responsible_person": "QS"},
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/cases/{c_a1['id']}/lifecycle-history",
            params={"project_id": "proj-B"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/cases/{c_a1['id']}/report",
            params={"project_id": "proj-B"},
            json={"prepared_by": "QS"},
        ).status_code
        == 404
    )
    # Foreign supporting document rejected on proj-B case
    assert (
        client.patch(
            f"/api/cases/{c_b1['id']}/lifecycle",
            params={"project_id": "proj-B"},
            json={
                "target_status": "under_review",
                "responsible_person": "QS",
                "supporting_document_ids": [doc_a],
            },
        ).status_code
        == 400
    )

    # Generate PDFs on c_a1 and c_a2 (same project)
    rep_a1 = client.post(
        f"/api/cases/{c_a1['id']}/report",
        params={"project_id": "proj-A"},
        json={"prepared_by": "QS"},
    ).json()
    rep_a2 = client.post(
        f"/api/cases/{c_a2['id']}/report",
        params={"project_id": "proj-A"},
        json={"prepared_by": "QS"},
    ).json()

    # Download authorization checks
    # 1. Missing project_id -> 422
    assert (
        client.get(
            f"/api/cases/{c_a1['id']}/reports/{rep_a1['id']}/download"
        ).status_code
        == 422
    )
    # 2. Wrong project_id -> 403
    assert (
        client.get(
            f"/api/cases/{c_a1['id']}/reports/{rep_a1['id']}/download",
            params={"project_id": "proj-B"},
        ).status_code
        == 403
    )
    # 3. Same project_id, wrong case_id / report_id pairing -> 403
    assert (
        client.get(
            f"/api/cases/{c_a1['id']}/reports/{rep_a2['id']}/download",
            params={"project_id": "proj-A"},
        ).status_code
        == 403
    )
    # 4. Authorized case_id + report_id + project_id -> 200 PDF
    ok_dl = client.get(
        f"/api/cases/{c_a1['id']}/reports/{rep_a1['id']}/download",
        params={"project_id": "proj-A"},
    )
    assert ok_dl.status_code == 200
    assert ok_dl.content.startswith(b"%PDF-")


def test_complete_synthetic_variation_workflow_end_to_end(
    monkeypatch, tmp_path: Path
) -> None:
    """Verify full Phases 2 -> 6 synthetic workflow end-to-end."""
    client = _make_client(monkeypatch, tmp_path, incomplete_assessment=False)
    proj = "proj-e2e-demo"

    # Phase 2: Ingest labelled demo contract & BOQ
    doc_ids = _upload_demo_docs(client, proj, is_demo=True)

    # Phase 3: Submit synthetic instruction & confirm extraction
    # Phase 4: Contract/BOQ retrieval & preliminary assessment
    # Phase 5: Deterministic Decimal cost build-up & QS review confirmation
    case = _create_case_with_assessment_cost_and_qs(
        client, proj, is_demo=True, currency="GBP", quantity="15", rate="85.50"
    )
    cid = case["id"]
    assert case["qs_decision"]["review_status"] == "confirmed"
    assert case["deterministic_estimate"]["total_estimated_amount"] == "1282.50"

    # Phase 6: Transition detected -> under_review -> drafted
    assert (
        client.patch(
            f"/api/cases/{cid}/lifecycle",
            params={"project_id": proj},
            json={
                "target_status": "under_review",
                "responsible_person": "A. Patel (QS)",
                "supporting_document_ids": doc_ids,
            },
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/cases/{cid}/lifecycle",
            params={"project_id": proj},
            json={"target_status": "drafted", "responsible_person": "A. Patel (QS)"},
        ).status_code
        == 200
    )

    # Generate & validate draft evidence pack PDF
    draft_rep = client.post(
        f"/api/cases/{cid}/report",
        params={"project_id": proj},
        json={
            "prepared_by": "A. Patel (QS)",
            "project_name": "DEMO Skyline Commercial Hub",
            "subcontractor_name": "DEMO CoolFlow MEP Contractors",
        },
    ).json()
    assert draft_rep["is_draft"] is True
    assert draft_rep["status_label"] == "DRAFT — NOT SUBMITTED"

    draft_dl = client.get(
        f"/api/cases/{cid}/reports/{draft_rep['id']}/download",
        params={"project_id": proj},
    )
    assert draft_dl.status_code == 200
    draft_pdf_text = "\n".join(
        (p.extract_text() or "") for p in PdfReader(BytesIO(draft_dl.content)).pages
    )
    assert "DRAFT — NOT SUBMITTED" in draft_pdf_text
    assert "DEMO DATA" in draft_pdf_text
    assert "1282.50" in draft_pdf_text

    # Explicit human commercial progression: submitted -> approved -> executed -> billed -> paid
    for step in [
        {
            "target_status": "submitted",
            "responsible_person": "A. Patel (QS)",
            "submission_reference": "VO-E2E-001",
            "submission_date": "2026-11-21",
            "recipient": "Main Contractor Commercial Lead",
            "claimed_amount": "1282.50",
        },
        {
            "target_status": "approved",
            "responsible_person": "A. Patel (QS)",
            "approved_amount": "1200.00",
        },
        {
            "target_status": "executed",
            "responsible_person": "Site Lead B. Singh",
            "execution_status": "Installed and pressure-tested",
        },
        {
            "target_status": "billed",
            "responsible_person": "Accounts C. Ng",
            "invoice_reference": "RB-2026-11",
            "billed_amount": "1200.00",
        },
        {
            "target_status": "paid",
            "responsible_person": "Accounts C. Ng",
            "payment_status": "Paid in full",
            "payment_date": "2026-12-15",
            "paid_amount": "1200.00",
        },
    ]:
        resp = client.patch(
            f"/api/cases/{cid}/lifecycle",
            params={"project_id": proj},
            json=step,
        )
        assert resp.status_code == 200

    # Post-paid evidence pack must reflect settled approval status (NOT draft/unsubmitted)
    final_rep = client.post(
        f"/api/cases/{cid}/report",
        params={"project_id": proj},
        json={"prepared_by": "A. Patel (QS)"},
    ).json()
    assert final_rep["is_draft"] is False
    assert final_rep["status_label"] == "CLIENT APPROVED (PAID)"

    final_metrics = client.get(
        "/api/dashboard/metrics", params={"project_id": proj}
    ).json()
    assert final_metrics["total_cases"] == 1
    assert final_metrics["contains_demo_data"] is True
    assert final_metrics["incomplete_evidence_count"] == 0
    gbp = final_metrics["amounts_by_currency"][0]
    assert gbp["proposed_total"] == "1282.50"
    assert gbp["approved_total"] == "1200.00"
    assert gbp["billed_total"] == "1200.00"
    assert gbp["paid_total"] == "1200.00"
    assert len(client.get(f"/api/cases/{cid}/lifecycle-history").json()) == 8
