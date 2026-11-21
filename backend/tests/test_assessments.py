"""Phase 4 tests for contract/BOQ retrieval, commercial assessment, and guardrails."""

from decimal import Decimal
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models.schemas import (
    ChangeEventFields,
    ExtractedField,
    ExtractedQuantityMention,
    ExtractionFieldStatus,
)
from app.services.gemini_client import (
    GeminiClient,
    GeminiRateLimitError,
    GeminiTimeoutError,
    get_gemini_client,
)
from app.services.retrieval import retrieve_project_evidence
from app.storage.local import LocalCaseRepository


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _make_synthetic_pdf(pages_lines: list[list[str]]) -> bytes:
    """Create a minimal valid multi-page synthetic PDF fixture."""
    objects: dict[int, bytes] = {}
    page_ids: list[int] = []

    for idx, lines in enumerate(pages_lines):
        page_obj_id = 4 + 2 * idx
        content_obj_id = 5 + 2 * idx
        page_ids.append(page_obj_id)

        cmds = ["BT", "/F1 11 Tf", "50 750 Td", "14 TL"]
        for line_idx, line in enumerate(lines):
            escaped = _pdf_escape(line)
            cmds.append(f"({escaped}) Tj" if line_idx == 0 else f"T* ({escaped}) Tj")
        cmds.append("ET")
        stream_bytes = ("\n".join(cmds) + "\n").encode("latin-1")

        objects[content_obj_id] = (
            f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
            + stream_bytes
            + b"endstream"
        )
        objects[page_obj_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {content_obj_id} 0 R >>"
        ).encode("ascii")

    kids_str = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids_str}] /Count {len(page_ids)} >>".encode("ascii")
    objects[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    max_obj_id = max(objects)
    for obj_id in range(1, max_obj_id + 1):
        offsets[obj_id] = len(out)
        out.extend(f"{obj_id} 0 obj\n".encode("ascii"))
        out.extend(objects[obj_id])
        out.extend(b"\nendobj\n")

    xref_pos = len(out)
    out.extend(f"xref\n0 {max_obj_id + 1}\n".encode("ascii"))
    out.extend(b"0000000000 65535 f \n")
    for obj_id in range(1, max_obj_id + 1):
        out.extend(f"{offsets[obj_id]:010d} 00000 n \n".encode("ascii"))

    out.extend(
        f"trailer\n<< /Size {max_obj_id + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(out)


def _settings_for_test(tmp_path: Path, api_key: str = "dummy-test-key") -> Settings:
    return Settings(
        app_name="Site-to-Cash",
        app_version="0.1.0",
        app_env="test",
        cors_origins=["http://localhost:5173"],
        gemini_api_key=api_key,
        gemini_model="gemini-2.5-flash",
        gemini_timeout_seconds=15.0,
        storage_backend="local",
        local_data_dir=tmp_path,
    )


def _extraction_json_for_piping(
    *,
    requested_work: str = "Install additional 15 m of 100mm chilled water pipe",
    location: str = "Level 3 East Corridor",
    material: str = "100mm chilled water pipe",
    issuer_name: str = "Alex Chen",
    issuer_role: str = "Site PM",
) -> str:
    payload = {
        "instruction_description": {
            "value": f"{requested_work} in {location}.",
            "status": "extracted",
            "evidence_quote": requested_work,
        },
        "issuer_name": {
            "value": issuer_name,
            "status": "extracted",
            "evidence_quote": issuer_name,
        },
        "issuer_role": {
            "value": issuer_role,
            "status": "extracted",
            "evidence_quote": issuer_role,
        },
        "recipient": {
            "value": "MEP Subcontractor",
            "status": "extracted",
            "evidence_quote": "MEP Subcontractor",
        },
        "project_site_location": {
            "value": location,
            "status": "extracted",
            "evidence_quote": location,
        },
        "communication_date": {
            "value": "2026-11-19",
            "status": "extracted",
            "evidence_quote": "2026-11-19",
        },
        "requested_work": {
            "value": requested_work,
            "status": "extracted",
            "evidence_quote": requested_work,
        },
        "affected_activity": {
            "value": "Chilled water riser piping",
            "status": "extracted",
            "evidence_quote": "chilled water",
        },
        "mentioned_quantities": [
            {
                "item_or_material": material,
                "quantity": "15",
                "unit": "m",
                "status": "extracted",
                "evidence_quote": material,
            }
        ],
        "mentioned_materials": [
            {
                "value": material,
                "status": "extracted",
                "evidence_quote": material,
            }
        ],
        "mentioned_deadlines": [],
        "scope_change_indicators": [
            {
                "value": "Verbal instruction requesting extra chilled water pipe",
                "status": "extracted",
                "evidence_quote": requested_work,
            }
        ],
        "missing_or_ambiguous_information": [
            "Written Project Manager confirmation not attached."
        ],
    }
    return json.dumps(payload)


def _create_confirmed_case(
    client: TestClient,
    *,
    project_id: str,
    instruction_text: str,
    reviewer: str = "A. Patel (QS)",
    is_demo: bool = True,
) -> dict:
    created = client.post(
        "/api/cases/instructions",
        data={
            "project_id": project_id,
            "instruction_text": instruction_text,
            "is_demo": str(is_demo).lower(),
        },
    )
    assert created.status_code == 201, created.text
    case = created.json()
    fields = case["ai_extraction"]["fields"]
    confirmed = client.patch(
        f"/api/cases/{case['id']}/extraction",
        json={
            "fields": fields,
            "confirmed_by": reviewer,
            "reviewer_notes": "DEMO DATA confirmed for Phase 4 test.",
            "confirm": True,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()


def test_contract_retrieval_relevant_vs_irrelevant_and_clause_metadata(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    pdf_bytes = _make_synthetic_pdf(
        [
            [
                "DEMO DATA - SYNTHETIC CONTRACT FIXTURE",
                "Clause 1.1 Scope of Works: Subcontractor shall supply and install chilled water piping.",
                "Clause 15.1 Insurance: Subcontractor shall maintain public liability cover of $5M.",
            ],
            [
                "Clause 8.1 Variations: Extra work outside scope requires written instruction and BOQ valuation.",
                "Clause 19.2 Confidentiality: Parties shall keep commercial terms strictly confidential.",
                "Unnumbered safety housekeeping paragraph regarding site parking.",
            ],
        ]
    )
    upload = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-ret", "is_demo": "true"},
        files={"file": ("demo_contract.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 201
    doc_id = upload.json()["document"]["id"]

    repo = LocalCaseRepository(tmp_path)
    fields = ChangeEventFields(
        requested_work=ExtractedField(
            value="Install additional chilled water pipe",
            status=ExtractionFieldStatus.extracted,
        )
    )
    clauses, boq_items = retrieve_project_evidence(repo, "proj-ret", fields)

    assert boq_items == []
    clause_nums = [c.clause_number for c in clauses]
    assert "1.1" in clause_nums
    assert "8.1" in clause_nums
    assert "15.1" not in clause_nums
    assert "19.2" not in clause_nums

    c1 = next(c for c in clauses if c.clause_number == "1.1")
    assert c1.document_id == doc_id
    assert c1.page_number == 1
    assert c1.clause_title == "Scope of Works"
    assert "chilled water piping" in c1.verbatim_text
    assert c1.source_reference.location == "Page 1, Clause 1.1"

    # Unnumbered passage keeps clause_number=None (never fabricated)
    pdf_unnumbered = _make_synthetic_pdf(
        [["Chilled water riser piping modifications require formal sign-off."]]
    )
    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-unnum", "is_demo": "true"},
            files={"file": ("demo_unnumbered.pdf", pdf_unnumbered, "application/pdf")},
        ).status_code
        == 201
    )
    unnum_clauses, _ = retrieve_project_evidence(repo, "proj-unnum", fields)
    assert len(unnum_clauses) == 1
    assert unnum_clauses[0].clause_number is None
    assert unnum_clauses[0].clause_title is None
    assert unnum_clauses[0].source_reference.location == "Page 1"


def test_boq_retrieval_preserves_refs_and_null_values_without_overmatching(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    xlsx_path = samples_dir / "demo_boq_sample.xlsx"
    upload = client.post(
        "/api/documents/boq",
        data={"project_id": "proj-boq-ret", "is_demo": "true"},
        files={
            "file": (
                xlsx_path.name,
                xlsx_path.read_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert upload.status_code == 201
    doc_id = upload.json()["document"]["id"]

    repo = LocalCaseRepository(tmp_path)
    fields = ChangeEventFields(
        requested_work=ExtractedField(
            value="Supply additional flanged butterfly valve 100mm",
            status=ExtractionFieldStatus.extracted,
        ),
        mentioned_quantities=[
            ExtractedQuantityMention(
                item_or_material="flanged butterfly valve 100mm",
                quantity="2",
                unit="nr",
                status=ExtractionFieldStatus.extracted,
            )
        ],
    )
    _, boq_items = retrieve_project_evidence(repo, "proj-boq-ret", fields)

    assert len(boq_items) >= 1
    top = boq_items[0]
    assert top.document_id == doc_id
    assert top.workbook_name == "demo_boq_sample.xlsx"
    assert top.sheet_name == "MEP BOQ"
    assert top.row_number == 9
    assert top.item_code == "A4"
    assert top.unit == "nr"
    assert top.quantity is None
    assert top.rate == Decimal("440")
    assert top.amount is None
    assert top.source_reference.location == "Sheet 'MEP BOQ', Row 9"
    assert "does not by itself prove" in top.caution_note.lower()
    # Unrelated civil sheet row C1 (core drilling) must not be retrieved
    assert all(item.item_code != "C1" for item in boq_items)


def test_end_to_end_demo_contract_and_boq_potential_variation_and_existing_scope(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()
    xlsx_bytes = (samples_dir / "demo_boq_sample.xlsx").read_bytes()

    extraction_json = _extraction_json_for_piping()
    assessment_pv_json = json.dumps(
        {
            "assessment_category": "potential_variation",
            "requested_work_summary": "Install an additional 15 m of 100mm chilled water pipe in Level 3 East Corridor.",
            "documented_facts": [
                {
                    "statement": "Clause 1.1 covers chilled water piping shown on Drawings M-101 to M-104.",
                    "source_ref_ids": ["C1"],
                },
                {
                    "statement": "Clause 8.1 states works outside original Scope are valued using BOQ rates where applicable.",
                    "source_ref_ids": ["C3"],
                },
                {
                    "statement": "BOQ item A1 lists 100mm insulated chilled water pipe at rate 85.5 per m (qty 120).",
                    "source_ref_ids": ["B1"],
                },
            ],
            "scope_comparison": "Instruction requests additional 15 m routing; BOQ row A1 shows an existing rate for 100mm chilled water pipe, but drawing coverage on M-101 to M-104 cannot be verified from PDF text alone.",
            "ai_interpretation_summary": "Preliminary indicators point to a potential variation under Clause 8.1 if the 15 m run is outside Drawings M-101 to M-104.",
            "explicit_inclusions": [
                {
                    "statement": "Subcontract includes chilled water piping shown on Drawings M-101 to M-104.",
                    "source_ref_ids": ["C1"],
                }
            ],
            "explicit_exclusions": [],
            "potential_scope_overlap": [
                {
                    "statement": "BOQ Row 6 (A1) covers 120 m of 100mm insulated chilled water pipe; overlap depends on drawing boundaries.",
                    "source_ref_ids": ["B1"],
                }
            ],
            "written_approval_requirements": [
                {
                    "statement": "Clause 4.2 requires verbal instructions on site to be confirmed in writing by the PM within 5 business days.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "issuer_authority_requirements": [
                {
                    "statement": "Clause 4.2 specifies confirmation by the Project Manager.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "notice_requirements_and_deadlines": [
                {
                    "statement": "Clause 8.3 requires notification to the Main Contractor within 7 days of receiving a suspected Variation instruction.",
                    "source_ref_ids": ["C4"],
                }
            ],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [
                "Drawings M-101 to M-104 are not uploaded to verify whether Level 3 East Corridor was already in base scope.",
                "Written PM confirmation per Clause 4.2 is not attached.",
            ],
            "recommended_qs_followup": [
                "Check Drawings M-101 to M-104 for Level 3 East Corridor pipework.",
                "Obtain written PM confirmation under Clause 4.2 and issue Clause 8.3 notice within 7 days.",
            ],
        }
    )

    assessment_es_json = json.dumps(
        {
            "assessment_category": "existing_scope",
            "requested_work_summary": "Complete chilled water pipe installation shown on base Drawings M-101 to M-104.",
            "documented_facts": [
                {
                    "statement": "Clause 1.1 explicitly assigns chilled water piping on Drawings M-101 to M-104 to Subcontractor scope.",
                    "source_ref_ids": ["C1"],
                },
                {
                    "statement": "BOQ Row 6 (A1) already includes 120 m of 100mm insulated chilled water pipe.",
                    "source_ref_ids": ["B1"],
                },
            ],
            "scope_comparison": "Requested pipework aligns with existing scope under Clause 1.1 and BOQ item A1.",
            "ai_interpretation_summary": "Appears to fall within existing contractual scope unless drawings show a later revision.",
            "explicit_inclusions": [
                {
                    "statement": "Chilled water piping on Drawings M-101 to M-104 is included in Scope of Works.",
                    "source_ref_ids": ["C1"],
                }
            ],
            "explicit_exclusions": [],
            "potential_scope_overlap": [
                {
                    "statement": "Matches BOQ Row 6 item A1 description.",
                    "source_ref_ids": ["B1"],
                }
            ],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [
                "Drawing revision comparison not yet attached."
            ],
            "recommended_qs_followup": [
                "Confirm drawing revision status before closing as base scope."
            ],
        }
    )

    # Sequence of fake responses: call 1 extract, call 2 assess(PV), call 3 extract, call 4 assess(ES)
    responses = iter(
        [extraction_json, assessment_pv_json, extraction_json, assessment_es_json]
    )
    app = create_app()
    fake_gemini = GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    app.dependency_overrides[get_gemini_client] = lambda: fake_gemini
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "demo-proj", "is_demo": "true"},
            files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/documents/boq",
            data={"project_id": "demo-proj", "is_demo": "true"},
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

    # Scenario 1: potential_variation
    raw_instr_1 = "DEMO DATA: Alex Chen (Site PM) on 2026-11-19 asked MEP Subcontractor to install additional 15 m of 100mm chilled water pipe in Level 3 East Corridor."
    case_1 = _create_confirmed_case(
        client, project_id="demo-proj", instruction_text=raw_instr_1
    )
    assess_1_resp = client.post(f"/api/cases/{case_1['id']}/assessment")
    assert assess_1_resp.status_code == 201, assess_1_resp.text
    assess_1 = assess_1_resp.json()

    assert assess_1["case_id"] == case_1["id"]
    assert assess_1["project_id"] == "demo-proj"
    assert assess_1["is_demo"] is True
    assert assess_1["model_name"] == "gemini-2.5-flash"
    assert assess_1["human_review_status"] == "pending_review"
    assert assess_1["ai_assessment"]["origin"] == "ai_suggestion"
    assert assess_1["ai_assessment"]["assessment_category"] == "potential_variation"
    assert len(assess_1["retrieved_contract_clauses"]) >= 3
    assert any(
        b["sheet_name"] == "MEP BOQ" and b["row_number"] == 6
        for b in assess_1["retrieved_boq_items"]
    )
    # Hydrated source reference attached deterministically
    fact_refs = assess_1["ai_assessment"]["documented_facts"][0]["source_references"]
    assert len(fact_refs) == 1
    assert fact_refs[0]["document_name"] == "demo_subcontract_sample.pdf"
    assert fact_refs[0]["location"].startswith("Page ")

    # Retrieval via GET endpoints and immutability of original instruction & confirmed extraction
    fetched_assess = client.get(f"/api/cases/{case_1['id']}/assessment")
    assert fetched_assess.status_code == 200
    assert fetched_assess.json()["id"] == assess_1["id"]

    fetched_case = client.get(f"/api/cases/{case_1['id']}").json()
    assert fetched_case["latest_assessment_id"] == assess_1["id"]
    assert fetched_case["original_input"]["raw_text"] == raw_instr_1
    assert fetched_case["confirmed_extraction"] == case_1["confirmed_extraction"]
    assert fetched_case["ai_extraction"] == case_1["ai_extraction"]

    # Scenario 2: existing_scope
    case_2 = _create_confirmed_case(
        client,
        project_id="demo-proj",
        instruction_text="DEMO DATA: Install 100mm chilled water pipe per Drawing M-101.",
    )
    assess_2_resp = client.post(f"/api/cases/{case_2['id']}/assessment")
    assert assess_2_resp.status_code == 201
    assert assess_2_resp.json()["ai_assessment"]["assessment_category"] == "existing_scope"

    list_resp = client.get("/api/assessments", params={"project_id": "demo-proj"})
    assert list_resp.status_code == 201 or list_resp.status_code == 200
    assert len(list_resp.json()) == 2


def test_approval_or_notice_missing_scenario(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()

    assess_json = json.dumps(
        {
            "assessment_category": "approval_or_notice_missing",
            "requested_work_summary": "Verbal instruction to add chilled water piping without written PM confirmation.",
            "documented_facts": [
                {
                    "statement": "Clause 4.2 requires verbal instructions on site to be confirmed in writing by the Project Manager within 5 business days.",
                    "source_ref_ids": ["C2"],
                },
                {
                    "statement": "Clause 8.3 requires 7-day notice to the Main Contractor for suspected variations.",
                    "source_ref_ids": ["C3"],
                },
            ],
            "scope_comparison": "Work may be outside base scope, but contractual preconditions (written confirmation & variation notice) are missing.",
            "ai_interpretation_summary": "Preliminary evidence indicates missing written approval and notice compliance risk.",
            "explicit_inclusions": [],
            "explicit_exclusions": [],
            "potential_scope_overlap": [],
            "written_approval_requirements": [
                {
                    "statement": "Clause 4.2 mandates written confirmation by the Project Manager within 5 business days.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "issuer_authority_requirements": [
                {
                    "statement": "Confirmation must come from the Project Manager under Clause 4.2.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "notice_requirements_and_deadlines": [
                {
                    "statement": "Subcontractor must notify Main Contractor within 7 days under Clause 8.3.",
                    "source_ref_ids": ["C3"],
                }
            ],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [
                "No written PM confirmation exists on file.",
                "No Clause 8.3 notice record exists.",
            ],
            "recommended_qs_followup": [
                "Send written confirmation request to PM immediately."
            ],
        }
    )

    responses = iter([_extraction_json_for_piping(), assess_json])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-notice", "is_demo": "true"},
            files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 201
    )
    case = _create_confirmed_case(
        client,
        project_id="proj-notice",
        instruction_text="DEMO DATA: Verbal request for extra chilled water pipe.",
    )
    resp = client.post(f"/api/cases/{case['id']}/assessment")
    assert resp.status_code == 201
    body = resp.json()
    assert body["ai_assessment"]["assessment_category"] == "approval_or_notice_missing"
    assert len(body["ai_assessment"]["written_approval_requirements"]) == 1
    assert len(body["ai_assessment"]["notice_requirements_and_deadlines"]) == 1


def test_ambiguous_or_conflicting_contract_evidence(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    conflicting_pdf = _make_synthetic_pdf(
        [
            [
                "DEMO DATA - CONFLICTING CONTRACT FIXTURE",
                "Clause 2.1 Inclusions: Subcontractor scope includes chilled water pipe insulation and hangers.",
            ],
            [
                "Clause 9.4 Exclusions: Chilled water pipe hangers and supports are excluded and supplied by Main Contractor.",
            ],
        ]
    )
    assess_json = json.dumps(
        {
            "assessment_category": "ambiguous",
            "requested_work_summary": "Supply and install chilled water pipe hangers.",
            "documented_facts": [
                {
                    "statement": "Clause 2.1 includes chilled water pipe hangers in Subcontractor scope.",
                    "source_ref_ids": ["C1"],
                },
                {
                    "statement": "Clause 9.4 excludes chilled water pipe hangers and assigns supply to Main Contractor.",
                    "source_ref_ids": ["C2"],
                },
            ],
            "scope_comparison": "Contract clauses directly contradict each other regarding pipe hangers.",
            "ai_interpretation_summary": "Conflicting contract clauses prevent determining whether pipe hangers are included or excluded.",
            "explicit_inclusions": [
                {
                    "statement": "Clause 2.1 lists chilled water pipe hangers as included.",
                    "source_ref_ids": ["C1"],
                }
            ],
            "explicit_exclusions": [
                {
                    "statement": "Clause 9.4 excludes chilled water pipe hangers.",
                    "source_ref_ids": ["C2"],
                }
            ],
            "potential_scope_overlap": [],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [
                {
                    "statement": "Clause 2.1 (Page 1) and Clause 9.4 (Page 2) conflict on chilled water pipe hangers.",
                    "source_ref_ids": ["C1", "C2"],
                }
            ],
            "missing_evidence_and_information": [
                "Order of precedence schedule / contract clarifications needed to resolve Clause 2.1 vs Clause 9.4."
            ],
            "recommended_qs_followup": [
                "Review contract priority of documents with Project Director."
            ],
        }
    )

    responses = iter([_extraction_json_for_piping(), assess_json])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-conflict", "is_demo": "true"},
            files={"file": ("demo_conflict.pdf", conflicting_pdf, "application/pdf")},
        ).status_code
        == 201
    )
    case = _create_confirmed_case(
        client,
        project_id="proj-conflict",
        instruction_text="DEMO DATA: Install chilled water pipe hangers.",
    )
    resp = client.post(f"/api/cases/{case['id']}/assessment")
    assert resp.status_code == 201
    data = resp.json()["ai_assessment"]
    assert data["assessment_category"] == "ambiguous"
    assert len(data["conflicting_or_ambiguous_evidence"]) == 1
    assert data["conflicting_or_ambiguous_evidence"][0]["source_ref_ids"] == ["C1", "C2"]


def test_no_matching_clauses_or_boq_rows_enforces_insufficient_evidence(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    unrelated_pdf = _make_synthetic_pdf(
        [
            [
                "DEMO DATA - UNRELATED CLAUSES",
                "Clause 12.1 Confidentiality: Confidential information shall not be disclosed.",
                "Clause 14.1 Governing Law: Governed by local jurisdiction.",
            ]
        ]
    )
    helipad_extract = _extraction_json_for_piping(
        requested_work="Install helipad perimeter beacon lighting",
        location="Rooftop Helipad",
        material="LED helipad beacon",
    )
    # Even if Gemini attempts to classify as potential_variation with 0 retrieved sources,
    # the deterministic guardrail must clamp to insufficient_evidence!
    optimistic_assess = json.dumps(
        {
            "assessment_category": "potential_variation",
            "requested_work_summary": "Install helipad perimeter beacon lighting.",
            "documented_facts": [],
            "scope_comparison": "No matching clauses or BOQ rows found.",
            "ai_interpretation_summary": "No project evidence available.",
            "explicit_inclusions": [],
            "explicit_exclusions": [],
            "potential_scope_overlap": [],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [],
            "recommended_qs_followup": ["Upload relevant electrical specifications."],
        }
    )

    responses = iter([helipad_extract, optimistic_assess])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-nomatch", "is_demo": "true"},
            files={"file": ("demo_unrelated.pdf", unrelated_pdf, "application/pdf")},
        ).status_code
        == 201
    )
    case = _create_confirmed_case(
        client,
        project_id="proj-nomatch",
        instruction_text="DEMO DATA: Install helipad perimeter beacon lighting on Rooftop Helipad.",
    )
    resp = client.post(f"/api/cases/{case['id']}/assessment")
    assert resp.status_code == 201
    body = resp.json()
    assert body["retrieved_contract_clauses"] == []
    assert body["retrieved_boq_items"] == []
    assert body["retrieved_source_references"] == []
    assert body["ai_assessment"]["assessment_category"] == "insufficient_evidence"
    assert len(body["ai_assessment"]["missing_evidence_and_information"]) >= 1


def test_citation_integrity_rejects_fabricated_refs_and_uncited_documented_facts(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()

    fabricated_ref_assess = json.dumps(
        {
            "assessment_category": "potential_variation",
            "requested_work_summary": "Add chilled water pipe.",
            "documented_facts": [
                {
                    "statement": "Fabricated Clause 99.9 allows automatic variation approval.",
                    "source_ref_ids": ["C99"],
                }
            ],
            "scope_comparison": "Test",
            "ai_interpretation_summary": "Test",
            "explicit_inclusions": [],
            "explicit_exclusions": [],
            "potential_scope_overlap": [],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [],
            "recommended_qs_followup": [],
        }
    )

    uncited_fact_assess = json.dumps(
        {
            "assessment_category": "potential_variation",
            "requested_work_summary": "Add chilled water pipe.",
            "documented_facts": [
                {
                    "statement": "Documented fact with no source citation.",
                    "source_ref_ids": [],
                }
            ],
            "scope_comparison": "Test",
            "ai_interpretation_summary": "Test",
            "explicit_inclusions": [],
            "explicit_exclusions": [],
            "potential_scope_overlap": [],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": [],
            "recommended_qs_followup": [],
        }
    )

    responses = iter(
        [_extraction_json_for_piping(), fabricated_ref_assess, uncited_fact_assess]
    )
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-cite", "is_demo": "true"},
            files={"file": ("demo_subcontract_sample.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 201
    )
    case = _create_confirmed_case(
        client,
        project_id="proj-cite",
        instruction_text="DEMO DATA: Add chilled water pipe.",
    )

    bad_ref = client.post(f"/api/cases/{case['id']}/assessment")
    assert bad_ref.status_code == 502
    assert "C99" in bad_ref.json()["detail"]

    uncited = client.post(f"/api/cases/{case['id']}/assessment")
    assert uncited.status_code == 502

    assert client.get(f"/api/cases/{case['id']}/assessment").status_code == 404


def test_gemini_malformed_output_and_unavailable_api(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    responses = iter([_extraction_json_for_piping(), _extraction_json_for_piping()])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    unconfirmed_resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": "proj-err",
            "instruction_text": "DEMO DATA: Unconfirmed pipe change.",
            "is_demo": "true",
        },
    )
    assert unconfirmed_resp.status_code == 201
    assert (
        client.post(f"/api/cases/{unconfirmed_resp.json()['id']}/assessment").status_code
        == 400
    )

    confirmed_case = _create_confirmed_case(
        client,
        project_id="proj-err",
        instruction_text="DEMO DATA: Add chilled water pipe.",
    )

    # 1. Missing API key -> 503
    app.dependency_overrides.clear()
    unavail = client.post(f"/api/cases/{confirmed_case['id']}/assessment")
    assert unavail.status_code == 503

    # 2. Malformed non-JSON -> 502
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: "not json at all",
    )
    assert client.post(f"/api/cases/{confirmed_case['id']}/assessment").status_code == 502

    # 3. Invalid assessment_category -> 502
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: json.dumps(
            {
                "assessment_category": "legally_guaranteed_payable",
                "requested_work_summary": "x",
                "scope_comparison": "x",
                "ai_interpretation_summary": "x",
            }
        ),
    )
    assert client.post(f"/api/cases/{confirmed_case['id']}/assessment").status_code == 502

    # 4. Rate limit (429) and Timeout (504)
    def raise_rl(*_a, **_k):
        raise GeminiRateLimitError("429 quota exceeded")

    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path), raw_generator=raise_rl
    )
    assert client.post(f"/api/cases/{confirmed_case['id']}/assessment").status_code == 429

    def raise_to(*_a, **_k):
        raise GeminiTimeoutError("timed out")

    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path), raw_generator=raise_to
    )
    assert client.post(f"/api/cases/{confirmed_case['id']}/assessment").status_code == 504


def test_cross_project_data_isolation(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_bytes = (samples_dir / "demo_subcontract_sample.pdf").read_bytes()
    xlsx_bytes = (samples_dir / "demo_boq_sample.xlsx").read_bytes()

    assess_json = json.dumps(
        {
            "assessment_category": "insufficient_evidence",
            "requested_work_summary": "Install chilled water pipe.",
            "documented_facts": [],
            "scope_comparison": "No documents uploaded in proj-other.",
            "ai_interpretation_summary": "Insufficient project evidence.",
            "explicit_inclusions": [],
            "explicit_exclusions": [],
            "potential_scope_overlap": [],
            "written_approval_requirements": [],
            "issuer_authority_requirements": [],
            "notice_requirements_and_deadlines": [],
            "conflicting_or_ambiguous_evidence": [],
            "missing_evidence_and_information": ["No contract or BOQ in proj-other."],
            "recommended_qs_followup": ["Upload project contract PDF and BOQ Excel."],
        }
    )

    responses = iter([_extraction_json_for_piping(), assess_json])
    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _p, _b, _m: next(responses),
    )
    client = TestClient(app)

    # Upload sensitive contract & BOQ strictly to proj-secret
    assert (
        client.post(
            "/api/documents/contract",
            data={"project_id": "proj-secret", "is_demo": "true"},
            files={"file": ("secret_contract.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/documents/boq",
            data={"project_id": "proj-secret", "is_demo": "true"},
            files={
                "file": (
                    "secret_boq.xlsx",
                    xlsx_bytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        ).status_code
        == 201
    )

    # Create confirmed case in proj-other
    other_case = _create_confirmed_case(
        client,
        project_id="proj-other",
        instruction_text="DEMO DATA: Install 15 m of 100mm chilled water pipe.",
    )

    # Cross-project query param mismatch rejected (404)
    assert (
        client.post(
            f"/api/cases/{other_case['id']}/assessment",
            params={"project_id": "proj-secret"},
        ).status_code
        == 404
    )

    # Assessing proj-other must NEVER retrieve documents from proj-secret
    resp = client.post(
        f"/api/cases/{other_case['id']}/assessment",
        params={"project_id": "proj-other"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["retrieved_contract_clauses"] == []
    assert body["retrieved_boq_items"] == []
    assert body["ai_assessment"]["assessment_category"] == "insufficient_evidence"

    # Cross-project GET isolation
    assert (
        client.get(
            f"/api/cases/{other_case['id']}/assessment",
            params={"project_id": "proj-secret"},
        ).status_code
        == 404
    )
    assert client.get("/api/assessments", params={"project_id": "proj-secret"}).json() == []
