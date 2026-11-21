"""Phase 5 tests for deterministic Decimal cost calculation, QS review, and audit trail."""

from decimal import Decimal
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.config import Settings
from app.main import create_app
from app.models.schemas import (
    CostCategory,
    CostLineItemInput,
    CostLineType,
    CostVerificationStatus,
    RoundingMode,
    SourceReference,
    DocumentType,
    ValueSource,
)
from app.services.calculator import CostValidationError, calculate_deterministic_estimate
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


def _extraction_json() -> str:
    return json.dumps(
        {
            "instruction_description": {
                "value": "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
                "status": "extracted",
                "evidence_quote": "additional 15 m of 100mm chilled water pipe",
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


def _assessment_json() -> str:
    return json.dumps(
        {
            "assessment_category": "potential_variation",
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
            "missing_evidence_and_information": ["Written PM confirmation missing."],
            "recommended_qs_followup": ["Verify Drawings M-101 to M-104 and obtain written confirmation."],
        }
    )


def _setup_assessed_case(tmp_path: Path, project_id: str = "proj-cost") -> tuple[TestClient, dict, dict]:
    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()
    xlsx_bytes = (samples_dir / "demo_boq_sample.xlsx").read_bytes()

    responses = iter([_extraction_json(), _assessment_json()])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": project_id, "is_demo": "true"},
            files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/documents/boq",
            data={"project_id": project_id, "is_demo": "true"},
            files={
                "file": (
                    "demo_boq_sample.xlsx",
                    xlsx_bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        ).status_code
        == 201
    )

    instr_resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": project_id,
            "instruction_text": "DEMO DATA: Alex Chen (Site PM) on 2026-11-19 asked MEP Subcontractor to install additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
            "is_demo": "true",
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

    assess_resp = client.post(f"/api/cases/{case['id']}/assessment")
    assert assess_resp.status_code == 201
    return client, conf_resp.json(), assess_resp.json()


def test_decimal_precision_avoids_binary_float_drift() -> None:
    estimate = calculate_deterministic_estimate(
        [
            CostLineItemInput(
                description="Precision test item 1",
                category=CostCategory.material,
                unit="m",
                quantity="0.1",
                rate="0.2",
                quantity_source=ValueSource.site_measurement,
                rate_source=ValueSource.qs_proposed,
                verification_status=CostVerificationStatus.verified,
            ),
            CostLineItemInput(
                description="Precision test item 2",
                category=CostCategory.labour,
                unit="hr",
                quantity="12.345",
                rate="19.99",
                quantity_source=ValueSource.site_measurement,
                rate_source=ValueSource.qs_proposed,
                verification_status=CostVerificationStatus.verified,
            ),
        ],
        currency="USD",
        decimal_places=4,
    )
    assert estimate.line_items[0].amount == Decimal("0.0200")
    assert estimate.line_items[1].amount == Decimal("246.7766")
    assert estimate.subtotal == Decimal("246.7966")

    # Binary floats must be explicitly rejected at schema input validation
    with pytest.raises(ValueError, match="binary floats"):
        CostLineItemInput(description="Float trap", quantity=0.1, rate="10")


def test_quantity_times_rate_and_multiple_categories() -> None:
    estimate = calculate_deterministic_estimate(
        [
            CostLineItemInput(
                description="Pipefitter gang",
                category=CostCategory.labour,
                unit="hr",
                quantity="16",
                rate="45.50",
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.contract_schedule,
                verification_status=CostVerificationStatus.verified,
            ),
            CostLineItemInput(
                description="100mm chilled water pipe",
                category=CostCategory.material,
                unit="m",
                quantity="15",
                rate="85.50",
                quantity_source=ValueSource.confirmed_instruction,
                rate_source=ValueSource.boq_reference,
                verification_status=CostVerificationStatus.verified,
            ),
            CostLineItemInput(
                description="Scissor lift hire",
                category=CostCategory.equipment,
                unit="day",
                quantity="2",
                rate="120.00",
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.subcontractor_quote,
                verification_status=CostVerificationStatus.verified,
            ),
            CostLineItemInput(
                description="Pressure testing allowance",
                category=CostCategory.other,
                unit="item",
                quantity="1",
                rate="150.00",
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.qs_proposed,
                verification_status=CostVerificationStatus.unverified,
            ),
        ],
        currency="GBP",
    )
    assert [line.amount for line in estimate.line_items] == [
        Decimal("728.00"),
        Decimal("1282.50"),
        Decimal("240.00"),
        Decimal("150.00"),
    ]
    assert estimate.additions_subtotal == Decimal("2400.50")
    assert estimate.deductions_subtotal == Decimal("0.00")
    assert estimate.subtotal == Decimal("2400.50")
    assert estimate.total_estimated_amount == Decimal("2400.50")
    assert estimate.has_unverified_inputs is True


def test_additions_and_deductions() -> None:
    estimate = calculate_deterministic_estimate(
        [
            CostLineItemInput(
                description="Add extra valve",
                category=CostCategory.material,
                line_type=CostLineType.addition,
                unit="nr",
                quantity="2",
                rate="440.00",
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.boq_reference,
            ),
            CostLineItemInput(
                description="Omit redundant straight pipe",
                category=CostCategory.material,
                line_type=CostLineType.deduction,
                unit="m",
                quantity="12",
                rate="85.50",
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.boq_reference,
            ),
        ],
        currency="USD",
    )
    assert estimate.line_items[0].amount == Decimal("880.00")
    assert estimate.line_items[1].amount == Decimal("-1026.00")
    assert estimate.additions_subtotal == Decimal("880.00")
    assert estimate.deductions_subtotal == Decimal("1026.00")
    assert estimate.subtotal == Decimal("-146.00")
    assert estimate.total_estimated_amount == Decimal("-146.00")


def test_missing_quantities_and_rates_never_zeroed() -> None:
    partial = calculate_deterministic_estimate(
        [
            CostLineItemInput(
                description="Confirmed piping",
                category=CostCategory.material,
                unit="m",
                quantity="10",
                rate="50.00",
                quantity_source=ValueSource.confirmed_instruction,
                rate_source=ValueSource.boq_reference,
            ),
            CostLineItemInput(
                description="Shutdown coordination (rate TBD)",
                category=CostCategory.other,
                unit="item",
                quantity="1",
                rate=None,
                quantity_source=ValueSource.qs_entered,
                rate_source=ValueSource.missing,
            ),
            CostLineItemInput(
                description="Flanged valve (quantity unmeasured)",
                category=CostCategory.material,
                unit="nr",
                quantity=None,
                rate="440.00",
                quantity_source=ValueSource.missing,
                rate_source=ValueSource.boq_reference,
            ),
        ],
        currency=None,
    )
    assert partial.line_items[0].amount == Decimal("500.00")
    assert partial.line_items[1].amount is None
    assert partial.line_items[1].verification_status == CostVerificationStatus.missing_data
    assert partial.line_items[2].amount is None
    assert partial.line_items[2].verification_status == CostVerificationStatus.missing_data
    assert partial.calculable_line_count == 1
    assert partial.incomplete_line_count == 2
    assert partial.is_partial_estimate is True
    assert partial.subtotal == Decimal("500.00")
    assert partial.currency is None
    assert len(partial.missing_inputs) >= 3

    all_missing = calculate_deterministic_estimate(
        [
            CostLineItemInput(
                description="Unpriced item",
                category=CostCategory.other,
                unit="item",
                quantity=None,
                rate=None,
            )
        ]
    )
    assert all_missing.subtotal is None
    assert all_missing.tax_amount is None
    assert all_missing.total_estimated_amount is None
    assert all_missing.calculable_line_count == 0
    assert all_missing.incomplete_line_count == 1


def test_explicit_rounding_modes_half_up_vs_half_even() -> None:
    items = [
        CostLineItemInput(
            description="Halfway odd cent",
            unit="ea",
            quantity="1",
            rate="0.025",
            quantity_source=ValueSource.qs_entered,
            rate_source=ValueSource.qs_proposed,
        ),
        CostLineItemInput(
            description="Halfway even cent",
            unit="ea",
            quantity="1",
            rate="0.015",
            quantity_source=ValueSource.qs_entered,
            rate_source=ValueSource.qs_proposed,
        ),
    ]
    half_up = calculate_deterministic_estimate(
        items, currency="USD", decimal_places=2, rounding_mode=RoundingMode.half_up
    )
    half_even = calculate_deterministic_estimate(
        items, currency="USD", decimal_places=2, rounding_mode=RoundingMode.half_even
    )
    assert [x.amount for x in half_up.line_items] == [Decimal("0.03"), Decimal("0.02")]
    assert [x.amount for x in half_even.line_items] == [Decimal("0.02"), Decimal("0.02")]


def test_tax_applied_only_when_explicitly_supplied() -> None:
    items = [
        CostLineItemInput(
            description="Pipework",
            unit="m",
            quantity="10",
            rate="100.00",
            quantity_source=ValueSource.confirmed_instruction,
            rate_source=ValueSource.boq_reference,
            verification_status=CostVerificationStatus.verified,
        )
    ]
    no_tax = calculate_deterministic_estimate(items, currency="AED")
    assert no_tax.tax_rate_percent is None
    assert no_tax.tax_amount is None
    assert no_tax.total_estimated_amount == Decimal("1000.00")

    with_tax = calculate_deterministic_estimate(
        items, currency="AED", tax_rate_percent=Decimal("5")
    )
    assert with_tax.tax_rate_percent == Decimal("5")
    assert with_tax.tax_amount == Decimal("50.00")
    assert with_tax.total_estimated_amount == Decimal("1050.00")


def test_invalid_cost_inputs_rejected(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client, case, _ = _setup_assessed_case(tmp_path, project_id="proj-invalid")

    invalid_payloads = [
        # Negative quantity
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": "-5", "rate": "10"}],
        },
        # Zero quantity
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": "0", "rate": "10"}],
        },
        # Negative rate
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": "5", "rate": "-10"}],
        },
        # Unsupported unit
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "Pipe", "unit": "bananas", "quantity": "5", "rate": "10"}],
        },
        # Invalid currency
        {
            "reviewer_name": "QS",
            "currency": "$$$",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": "5", "rate": "10"}],
        },
        # Tax > 100
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "tax_rate_percent": "120",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": "5", "rate": "10"}],
        },
        # Empty description
        {
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "   ", "unit": "m", "quantity": "5", "rate": "10"}],
        },
    ]
    for bad in invalid_payloads:
        resp = client.put(f"/api/cases/{case['id']}/cost-estimate", json=bad)
        assert resp.status_code in (400, 422), f"Expected 400/422 for {bad}, got {resp.status_code}"

    # Float in JSON payload rejected
    float_resp = client.put(
        f"/api/cases/{case['id']}/cost-estimate",
        json={
            "reviewer_name": "QS",
            "currency": "USD",
            "line_items": [{"description": "Pipe", "unit": "m", "quantity": 0.1, "rate": "10"}],
        },
    )
    assert float_resp.status_code == 422


def test_server_side_recalculation_ignores_client_totals_and_preserves_boq_refs(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client, case, assessment = _setup_assessed_case(tmp_path, project_id="proj-recalc")

    boq_item = assessment["retrieved_boq_items"][0]
    save_resp = client.put(
        f"/api/cases/{case['id']}/cost-estimate",
        json={
            "reviewer_name": "A. Patel (QS)",
            "reason": "Initial BOQ-referenced + QS-proposed build-up",
            "currency": "USD",
            "tax_rate_percent": "5",
            "line_items": [
                {
                    "description": "Additional 100mm chilled water pipe (QS proposed rate based on BOQ A1)",
                    "category": "material",
                    "line_type": "addition",
                    "unit": "m",
                    "quantity": "15",
                    "rate": "90.00",
                    "quantity_source": "confirmed_instruction",
                    "rate_source": "qs_proposed",
                    "rate_basis_note": "BOQ A1 base rate 85.50 adjusted +4.50 for night access",
                    "verification_status": "unverified",
                    "boq_reference": boq_item["source_reference"],
                    "original_boq_item_code": boq_item["item_code"],
                    "original_boq_unit": boq_item["unit"],
                    "original_boq_quantity": boq_item["quantity"],
                    "original_boq_rate": boq_item["rate"],
                    # Extra bogus client total must be ignored by server
                    "amount": "999999.00",
                }
            ],
        },
    )
    assert save_resp.status_code == 200, save_resp.text
    est = save_resp.json()["deterministic_estimate"]
    assert est["line_items"][0]["amount"] == "1350.00"
    assert est["line_items"][0]["original_boq_rate"] == "85.5"
    assert est["line_items"][0]["rate"] == "90.00"
    assert est["subtotal"] == "1350.00"
    assert est["tax_amount"] == "67.50"
    assert est["total_estimated_amount"] == "1417.50"

    get_resp = client.get(f"/api/cases/{case['id']}/cost-estimate")
    assert get_resp.status_code == 200
    assert get_resp.json()["total_estimated_amount"] == "1417.50"


def test_qs_decisions_and_append_only_review_history_immutability(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client, case, assessment = _setup_assessed_case(tmp_path, project_id="proj-audit")

    original_raw_text = case["original_input"]["raw_text"]
    original_ai_extraction = case["ai_extraction"]
    original_confirmed_extraction = case["confirmed_extraction"]
    original_ai_assessment = assessment["ai_assessment"]

    # 1. Save draft decision (is_draft=True)
    draft_resp = client.patch(
        f"/api/cases/{case['id']}/review",
        json={
            "reviewer_name": "A. Patel (QS)",
            "decision_action": "request_additional_info",
            "reason": "Draft hold pending drawing M-102 check",
            "is_draft": True,
        },
    )
    assert draft_resp.status_code == 200
    assert draft_resp.json()["case"]["qs_decision"]["review_status"] == "pending_review"
    assert draft_resp.json()["case"]["qs_decision"]["is_draft"] is True

    # 2. Reject without reason -> 400
    bad_reject = client.patch(
        f"/api/cases/{case['id']}/review",
        json={
            "reviewer_name": "A. Patel (QS)",
            "decision_action": "reject_assessment",
            "reason": "   ",
            "is_draft": False,
        },
    )
    assert bad_reject.status_code == 400

    # 3. Request additional information (with reason)
    req_info = client.patch(
        f"/api/cases/{case['id']}/review",
        json={
            "reviewer_name": "A. Patel (QS)",
            "decision_action": "request_additional_info",
            "reason": "Awaiting written PM confirmation under Clause 4.2.",
            "is_draft": False,
        },
    )
    assert req_info.status_code == 200
    assert req_info.json()["case"]["qs_decision"]["review_status"] == "needs_more_info"

    # 4. Mark as existing scope (with reason)
    mark_es = client.patch(
        f"/api/cases/{case['id']}/review",
        json={
            "reviewer_name": "B. Singh (Senior QS)",
            "decision_action": "mark_existing_scope",
            "reason": "Drawing M-102 Rev B confirms pipework was shown at tender.",
            "is_draft": False,
        },
    )
    assert mark_es.status_code == 200
    assert mark_es.json()["case"]["qs_decision"]["confirmed_category"] == "existing_scope"

    # 5. Accept assessment
    accept_resp = client.patch(
        f"/api/cases/{case['id']}/review",
        json={
            "reviewer_name": "B. Singh (Senior QS)",
            "decision_action": "accept_assessment",
            "notes": "Updated after Drawing Rev C revision review.",
            "is_draft": False,
        },
    )
    assert accept_resp.status_code == 200
    assert accept_resp.json()["case"]["qs_decision"]["review_status"] == "confirmed"
    assert accept_resp.json()["case"]["qs_decision"]["confirmed_category"] == "potential_variation"

    # Append-only review history must retain ALL 4 entries chronologically
    history = client.get(f"/api/cases/{case['id']}/review-history").json()
    assert len(history) == 4
    assert [h["entry_type"] for h in history] == [
        "qs_decision_draft",
        "qs_decision_confirmed",
        "qs_decision_confirmed",
        "qs_decision_confirmed",
    ]
    assert history[2]["previous_snapshot"]["review_status"] == "needs_more_info"
    assert history[2]["updated_snapshot"]["confirmed_category"] == "existing_scope"
    assert history[3]["assessment_id"] == assessment["id"]

    # Historical AI suggestions and original input remain 100% immutable
    persisted_case = client.get(f"/api/cases/{case['id']}").json()
    persisted_assess = client.get(f"/api/cases/{case['id']}/assessment").json()
    assert persisted_case["original_input"]["raw_text"] == original_raw_text
    assert persisted_case["ai_extraction"] == original_ai_extraction
    assert persisted_case["confirmed_extraction"] == original_confirmed_extraction
    assert persisted_assess["ai_assessment"] == original_ai_assessment
    assert persisted_assess["human_review_status"] == "confirmed"


def test_project_isolation_on_cost_review_and_history(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client, case, _ = _setup_assessed_case(tmp_path, project_id="proj-alpha")

    assert (
        client.get(
            f"/api/cases/{case['id']}/cost-estimate", params={"project_id": "proj-beta"}
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"/api/cases/{case['id']}/cost-estimate",
            params={"project_id": "proj-beta"},
            json={"reviewer_name": "QS", "line_items": []},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/cases/{case['id']}/review",
            params={"project_id": "proj-beta"},
            json={
                "reviewer_name": "QS",
                "decision_action": "accept_assessment",
                "is_draft": False,
            },
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/cases/{case['id']}/review-history", params={"project_id": "proj-beta"}
        ).status_code
        == 404
    )


def test_full_synthetic_variation_scenario_end_to_end(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client, case, assessment = _setup_assessed_case(tmp_path, project_id="proj-e2e")
    boq_ref = assessment["retrieved_boq_items"][0]

    # Build cost estimate combining addition (BOQ rate), deduction, missing rate line, and 5% VAT
    cost_resp = client.put(
        f"/api/cases/{case['id']}/cost-estimate",
        params={"project_id": "proj-e2e"},
        json={
            "reviewer_name": "E2E Demo QS",
            "reason": "Initial Phase 5 commercial valuation",
            "currency": "USD",
            "rounding_mode": "HALF_UP",
            "decimal_places": 2,
            "tax_rate_percent": "5",
            "line_items": [
                {
                    "description": "Additional 100mm chilled water pipe",
                    "category": "material",
                    "line_type": "addition",
                    "unit": "m",
                    "quantity": "15",
                    "rate": boq_ref["rate"],
                    "quantity_source": "confirmed_instruction",
                    "rate_source": "boq_reference",
                    "rate_basis_note": "Referenced from MEP BOQ Row 6 (A1)",
                    "verification_status": "verified",
                    "boq_reference": boq_ref["source_reference"],
                    "original_boq_item_code": boq_ref["item_code"],
                    "original_boq_unit": boq_ref["unit"],
                    "original_boq_quantity": boq_ref["quantity"],
                    "original_boq_rate": boq_ref["rate"],
                },
                {
                    "description": "Credit for omitted 3 m straight run",
                    "category": "material",
                    "line_type": "deduction",
                    "unit": "m",
                    "quantity": "3",
                    "rate": "85.50",
                    "quantity_source": "qs_entered",
                    "rate_source": "boq_reference",
                    "verification_status": "verified",
                },
                {
                    "description": "Out-of-hours shutdown coordination (rate unverified)",
                    "category": "other",
                    "line_type": "addition",
                    "unit": "item",
                    "quantity": "1",
                    "rate": None,
                    "quantity_source": "qs_entered",
                    "rate_source": "missing",
                },
            ],
        },
    )
    assert cost_resp.status_code == 200
    est = cost_resp.json()["deterministic_estimate"]
    # 15 * 85.50 = 1282.50; -3 * 85.50 = -256.50; net = 1026.00; 5% tax = 51.30; total = 1077.30
    assert est["additions_subtotal"] == "1282.50"
    assert est["deductions_subtotal"] == "256.50"
    assert est["subtotal"] == "1026.00"
    assert est["tax_amount"] == "51.30"
    assert est["total_estimated_amount"] == "1077.30"
    assert est["is_partial_estimate"] is True
    assert est["incomplete_line_count"] == 1

    review_resp = client.patch(
        f"/api/cases/{case['id']}/review",
        params={"project_id": "proj-e2e"},
        json={
            "reviewer_name": "E2E Demo QS",
            "decision_action": "accept_assessment",
            "notes": "Proceed to request Clause 4.2 written confirmation; shutdown cost pending quote.",
            "is_draft": False,
        },
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["case"]["qs_decision"]["review_status"] == "confirmed"

    history = client.get(
        f"/api/cases/{case['id']}/review-history", params={"project_id": "proj-e2e"}
    ).json()
    assert len(history) == 2
    assert history[0]["entry_type"] == "cost_update"
    assert history[1]["entry_type"] == "qs_decision_confirmed"
    assert history[1]["cost_estimate_snapshot"]["total_estimated_amount"] == "1077.30"
