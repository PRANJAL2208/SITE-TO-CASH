"""Phase 7 automated 14-step synthetic DEMO DATA end-to-end workflow test."""

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


def _extraction_payload() -> str:
    return json.dumps(
        {
            "instruction_description": {
                "value": "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
                "status": "extracted",
                "evidence_quote": "additional 15 m of 100mm chilled water pipe",
            },
            "issuer_name": {
                "value": "Alex",
                "status": "uncertain",
                "note": "Surname unstated in initial text.",
                "evidence_quote": "Alex",
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
                    "value": "Additional 15 m routing outside tender drawings",
                    "status": "extracted",
                    "evidence_quote": "additional 15 m",
                }
            ],
            "missing_or_ambiguous_information": [
                "Written PM confirmation under Clause 4.2 not attached."
            ],
        }
    )


def _assessment_payload() -> str:
    return json.dumps(
        {
            "assessment_category": "potential_variation",
            "requested_work_summary": "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
            "documented_facts": [
                {
                    "statement": "Clause 1.1 covers chilled water piping shown on Drawings M-101 to M-104.",
                    "source_ref_ids": ["C1"],
                },
                {
                    "statement": "BOQ Row 6 (A1) records 100mm insulated chilled water pipe at GBP 85.50 per m.",
                    "source_ref_ids": ["B1"],
                },
            ],
            "scope_comparison": "Instruction adds 15 m pipework outside tender drawings; BOQ A1 shows unit rate 85.50/m.",
            "ai_interpretation_summary": "Preliminary potential variation requiring QS verification and Clause 4.2 written confirmation.",
            "explicit_inclusions": [
                {
                    "statement": "Pipework on Drawings M-101 to M-104 is included in base scope.",
                    "source_ref_ids": ["C1"],
                }
            ],
            "explicit_exclusions": [],
            "potential_scope_overlap": [
                {
                    "statement": "BOQ Row 6 (A1) shares pipe size and specification.",
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
                    "statement": "Clause 8.3 requires 7-day written notice for suspected variations.",
                    "source_ref_ids": ["C4"],
                }
            ],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": ["Signed PM written confirmation missing."],
            "recommended_qs_followup": ["Verify Drawings M-101 to M-104 and obtain written PM order."],
        }
    )


def test_complete_14_step_synthetic_demo_workflow_with_reload(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    # 1. Create project & app instance
    project_id = "proj-phase7-demo"
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda prompt, _b, _m: (
            _assessment_payload()
            if "Retrieved Contract Clauses:" in prompt
            else _extraction_payload()
        ),
    )
    client = TestClient(app)

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()
    xlsx_bytes = (samples_dir / "demo_boq_sample.xlsx").read_bytes()

    # 2. Upload synthetic contract PDF (DEMO DATA)
    contract_resp = client.post(
        "/api/documents/contract",
        data={"project_id": project_id, "is_demo": "true"},
        files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
    )
    assert contract_resp.status_code == 201
    contract_doc = contract_resp.json()["document"]
    assert contract_doc["is_demo"] is True

    # 3. Upload synthetic BOQ workbook (DEMO DATA)
    boq_resp = client.post(
        "/api/documents/boq",
        data={"project_id": project_id, "is_demo": "true"},
        files={
            "file": (
                "demo_boq_sample.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert boq_resp.status_code == 201
    boq_doc = boq_resp.json()["document"]
    assert boq_doc["is_demo"] is True

    # 4 & 5. Submit site instruction & verify Gemini extraction
    raw_instruction = (
        "DEMO DATA: Site email from Alex (Site PM) to MEP Subcontractor on 2026-11-19: "
        "Please install additional 15 m of 100mm chilled water pipe in Level 3 East Corridor."
    )
    instr_resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": project_id,
            "instruction_text": raw_instruction,
            "is_demo": "true",
        },
    )
    assert instr_resp.status_code == 201
    created_case = instr_resp.json()
    case_id = created_case["id"]
    assert created_case["variation_reference"] == "VAR-001"
    assert created_case["lifecycle_status"] == "detected"
    assert created_case["original_input"]["raw_text"] == raw_instruction
    original_ai_snapshot = created_case["ai_extraction"]

    # 6. Confirm human-edited extraction (verify original AI extraction preserved)
    edited_fields = json.loads(json.dumps(original_ai_snapshot["fields"]))
    edited_fields["issuer_name"] = {
        "value": "Alex Chen",
        "status": "extracted",
        "note": "Confirmed full name from project directory.",
        "evidence_quote": "Alex",
    }
    conf_resp = client.patch(
        f"/api/cases/{case_id}/extraction",
        params={"project_id": project_id},
        json={
            "fields": edited_fields,
            "confirmed_by": "A. Patel (QS)",
            "reviewer_notes": "Confirmed site walk measurement.",
            "confirm": True,
        },
    )
    assert conf_resp.status_code == 200
    assert conf_resp.json()["ai_extraction"] == original_ai_snapshot

    # 7 & 8. Retrieve contract/BOQ evidence & generate preliminary assessment
    assess_resp = client.post(
        f"/api/cases/{case_id}/assessment",
        params={"project_id": project_id},
    )
    assert assess_resp.status_code == 201
    assessment = assess_resp.json()
    assert len(assessment["retrieved_contract_clauses"]) >= 2
    assert len(assessment["retrieved_boq_items"]) >= 1
    assert assessment["grounding_validation"]["is_valid"] is True
    assert assessment["ai_assessment"]["guardrail_warnings"] == []
    boq_ref = assessment["retrieved_boq_items"][0]["source_reference"]

    # 9. Record confirmed QS decision (explicit human decision separated from AI)
    qs_resp = client.patch(
        f"/api/cases/{case_id}/review",
        params={"project_id": project_id},
        json={
            "reviewer_name": "A. Patel (QS)",
            "decision_action": "accept_assessment",
            "confirmed_category": "potential_variation",
            "notes": "Variation build-up approved for draft claim subject to written PM order.",
            "is_draft": False,
            "assessment_id": assessment["id"],
        },
    )
    assert qs_resp.status_code == 200
    assert qs_resp.json()["case"]["qs_decision"]["review_status"] == "confirmed"

    # 10 & 11. Enter cost line items & verify exact Decimal server-side calculation
    cost_payload = {
        "reviewer_name": "A. Patel (QS)",
        "reason": "BOQ A1 rate plus verified site labour hours and explicit 5% VAT",
        "currency": "GBP",
        "decimal_places": 2,
        "rounding_mode": "HALF_UP",
        "tax_rate_percent": "5",
        "line_items": [
            {
                "description": "100mm insulated chilled water pipe addition",
                "category": "material",
                "line_type": "addition",
                "unit": "m",
                "quantity": "15",
                "rate": "85.50",
                "quantity_source": "confirmed_instruction",
                "rate_source": "boq_reference",
                "verification_status": "verified",
                "boq_reference": boq_ref,
                "original_boq_item_code": "A1",
                "original_boq_unit": "m",
                "original_boq_quantity": "120",
                "original_boq_rate": "85.50",
            },
            {
                "description": "Pipefitter crew overtime installation",
                "category": "labour",
                "line_type": "addition",
                "unit": "hr",
                "quantity": "8",
                "rate": "45.00",
                "quantity_source": "qs_entered",
                "rate_source": "contract_schedule",
                "verification_status": "verified",
            },
        ],
    }
    cost_resp = client.put(
        f"/api/cases/{case_id}/cost-estimate",
        params={"project_id": project_id},
        json=cost_payload,
    )
    assert cost_resp.status_code == 200
    est = cost_resp.json()["deterministic_estimate"]
    # 15*85.50 = 1282.50, 8*45.00 = 360.00 -> subtotal = 1642.50 -> 5% tax = 82.125 -> 82.13 HALF_UP -> total = 1724.63
    assert est["subtotal"] == "1642.50"
    assert est["tax_amount"] == "82.13"
    assert est["total_estimated_amount"] == "1724.63"

    # Move detected -> under_review -> drafted before issuing draft pack
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            params={"project_id": project_id},
            json={
                "target_status": "under_review",
                "responsible_person": "A. Patel (QS)",
                "supporting_document_ids": [contract_doc["id"], boq_doc["id"]],
            },
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/cases/{case_id}/lifecycle",
            params={"project_id": project_id},
            json={"target_status": "drafted", "responsible_person": "A. Patel (QS)"},
        ).status_code
        == 200
    )

    # 12. Generate & download draft evidence PDF
    rep_resp = client.post(
        f"/api/cases/{case_id}/report",
        params={"project_id": project_id},
        json={
            "prepared_by": "A. Patel (QS)",
            "project_name": "DEMO Phase 7 Tower Package",
            "subcontractor_name": "DEMO Skyline MEP Ltd",
        },
    )
    assert rep_resp.status_code == 201
    report = rep_resp.json()
    assert report["is_draft"] is True
    assert report["status_label"] == "DRAFT — NOT SUBMITTED"

    dl_resp = client.get(
        f"/api/cases/{case_id}/reports/{report['id']}/download",
        params={"project_id": project_id},
    )
    assert dl_resp.status_code == 200
    pdf_text = " ".join(
        " ".join((p.extract_text() or "").split())
        for p in PdfReader(BytesIO(dl_resp.content)).pages
    )
    assert "DRAFT — NOT SUBMITTED" in pdf_text
    assert "DEMO DATA" in pdf_text
    assert "VAR-001" in pdf_text
    assert "GBP 1724.63" in pdf_text
    assert "NOT APPROVED" in pdf_text

    # 13. Update variation lifecycle through payment settlement
    for step in [
        {
            "target_status": "submitted",
            "responsible_person": "A. Patel (QS)",
            "submission_reference": "VO-P7-001",
            "submission_date": "2026-11-21",
            "recipient": "Main Contractor PM",
            "claimed_amount": "1724.63",
        },
        {
            "target_status": "approved",
            "responsible_person": "A. Patel (QS)",
            "approved_amount": "1600.00",
        },
        {
            "target_status": "executed",
            "responsible_person": "Site Sup Sam",
            "execution_status": "Installed and pressure-tested",
        },
        {
            "target_status": "billed",
            "responsible_person": "Accounts C. Ng",
            "invoice_reference": "INV-P7-101",
            "billed_amount": "1600.00",
        },
        {
            "target_status": "paid",
            "responsible_person": "Accounts C. Ng",
            "payment_status": "Paid in full",
            "payment_date": "2026-12-20",
            "paid_amount": "1600.00",
        },
    ]:
        assert (
            client.patch(
                f"/api/cases/{case_id}/lifecycle",
                params={"project_id": project_id},
                json=step,
            ).status_code
            == 200
        )

    # 14. Fresh TestClient (simulating backend restart) verifies persistence & metrics
    fresh_client = TestClient(create_app())
    reloaded_case = fresh_client.get(
        f"/api/cases/{case_id}", params={"project_id": project_id}
    ).json()
    assert reloaded_case["lifecycle_status"] == "paid"
    assert reloaded_case["original_input"]["raw_text"] == raw_instruction
    assert reloaded_case["ai_extraction"] == original_ai_snapshot
    assert reloaded_case["confirmed_extraction"]["fields"]["issuer_name"]["value"] == "Alex Chen"

    review_hist = fresh_client.get(
        f"/api/cases/{case_id}/review-history", params={"project_id": project_id}
    ).json()
    lifecycle_hist = fresh_client.get(
        f"/api/cases/{case_id}/lifecycle-history", params={"project_id": project_id}
    ).json()
    assert len(review_hist) == 2
    assert len(lifecycle_hist) == 8

    metrics = fresh_client.get(
        "/api/dashboard/metrics", params={"project_id": project_id}
    ).json()
    assert metrics["total_cases"] == 1
    assert metrics["demo_case_count"] == 1
    assert metrics["contains_demo_data"] is True
    gbp = metrics["amounts_by_currency"][0]
    assert gbp["currency"] == "GBP"
    assert gbp["proposed_total"] == "1724.63"
    assert gbp["approved_total"] == "1600.00"
    assert gbp["billed_total"] == "1600.00"
    assert gbp["paid_total"] == "1600.00"
