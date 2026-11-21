"""Phase 3 tests for Gemini-powered site instruction extraction and QS confirmation."""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from app.config import Settings
from app.main import create_app
from app.models.schemas import ExtractedField, ExtractionFieldStatus
from app.services import gemini_client as gemini_module
from app.services.gemini_client import (
    GeminiClient,
    GeminiRateLimitError,
    GeminiTimeoutError,
    GeminiUpstreamError,
    get_gemini_client,
)


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


def _make_client_with_raw_json(tmp_path: Path, raw_json: str) -> TestClient:
    app = create_app()
    fake_gemini = GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=lambda _prompt, _bytes, _mime: raw_json,
    )
    app.dependency_overrides[get_gemini_client] = lambda: fake_gemini
    return TestClient(app)


def test_valid_text_instruction_extraction_and_retrieval(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    raw_instruction = (
        "Email from John Miller (Senior PM, BuildCorp) to MEP Team on 2026-11-18: "
        "Please install an extra 15 m of 100mm chilled water pipe along Level 3 East "
        "Corridor by 2026-11-28 due to riser relocation."
    )

    payload = {
        "instruction_description": {
            "value": "Install an extra 15 m of 100mm chilled water pipe along Level 3 East Corridor.",
            "status": "extracted",
            "evidence_quote": "install an extra 15 m of 100mm chilled water pipe along Level 3 East Corridor",
        },
        "issuer_name": {
            "value": "John Miller",
            "status": "extracted",
            "evidence_quote": "John Miller",
        },
        "issuer_role": {
            "value": "Senior PM, BuildCorp",
            "status": "extracted",
            "evidence_quote": "Senior PM, BuildCorp",
        },
        "recipient": {
            "value": "MEP Team",
            "status": "extracted",
            "evidence_quote": "to MEP Team",
        },
        "project_site_location": {
            "value": "Level 3 East Corridor",
            "status": "extracted",
            "evidence_quote": "Level 3 East Corridor",
        },
        "communication_date": {
            "value": "2026-11-18",
            "status": "extracted",
            "evidence_quote": "on 2026-11-18",
        },
        "requested_work": {
            "value": "Install 100mm chilled water pipe",
            "status": "extracted",
            "evidence_quote": "install an extra 15 m of 100mm chilled water pipe",
        },
        "affected_activity": {
            "value": "Riser relocation / chilled water piping",
            "status": "extracted",
            "evidence_quote": "riser relocation",
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
        "mentioned_deadlines": [
            {
                "value": "2026-11-28",
                "status": "extracted",
                "evidence_quote": "by 2026-11-28",
            }
        ],
        "scope_change_indicators": [
            {
                "value": "Additional work due to riser relocation ('extra 15 m')",
                "status": "extracted",
                "evidence_quote": "extra 15 m",
            }
        ],
        "missing_or_ambiguous_information": [
            "Formal signed Variation Order / written contract instruction reference not provided."
        ],
    }

    client = _make_client_with_raw_json(tmp_path, json.dumps(payload))
    resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": "proj-mep",
            "instruction_text": raw_instruction,
            "is_demo": "true",
        },
    )

    assert resp.status_code == 201
    case = resp.json()
    assert case["project_id"] == "proj-mep"
    assert case["is_demo"] is True
    assert case["instruction_text"] == raw_instruction
    assert case["original_input"]["raw_text"] == raw_instruction
    assert case["original_input"]["source_type"] == "text"
    assert case["ai_suggestion"] is None
    assert case["deterministic_estimate"] is None
    assert case["confirmed_extraction"] is None

    ai_ext = case["ai_extraction"]
    assert ai_ext["origin"] == "ai_suggestion"
    assert ai_ext["fields"]["issuer_name"]["value"] == "John Miller"
    assert ai_ext["fields"]["issuer_name"]["status"] == "extracted"
    assert ai_ext["fields"]["mentioned_quantities"][0]["quantity"] == "15"
    assert ai_ext["fields"]["mentioned_quantities"][0]["unit"] == "m"
    assert any(
        ref["location"] == "Original Instruction Text (verbatim match)"
        for ref in ai_ext["evidence_references"]
    )

    list_resp = client.get("/api/cases", params={"project_id": "proj-mep"})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    detail_resp = client.get(f"/api/cases/{case['id']}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["id"] == case["id"]


def test_missing_fields_explicitly_marked_missing(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    # Test validator invariant directly: value=None forces status=missing, status=missing forces value=None
    forced_missing = ExtractedField(value=None, status=ExtractionFieldStatus.extracted)
    assert forced_missing.status == ExtractionFieldStatus.missing
    forced_null = ExtractedField(value="should be cleared", status=ExtractionFieldStatus.missing)
    assert forced_null.value is None

    sparse_payload = {
        "instruction_description": {
            "value": "Move the cable tray to the north corridor.",
            "status": "extracted",
            "evidence_quote": "Move the cable tray to the north corridor",
        },
        "issuer_name": {"value": None, "status": "extracted"},
        "issuer_role": {"value": None, "status": "missing"},
        "recipient": {"value": None, "status": "missing"},
        "project_site_location": {
            "value": "north corridor",
            "status": "extracted",
            "evidence_quote": "north corridor",
        },
        "communication_date": {"value": None, "status": "missing"},
        "requested_work": {
            "value": "Relocate cable tray",
            "status": "extracted",
            "evidence_quote": "Move the cable tray",
        },
        "affected_activity": {"value": None, "status": "missing"},
        "mentioned_quantities": [],
        "mentioned_materials": [
            {
                "value": "cable tray",
                "status": "extracted",
                "evidence_quote": "cable tray",
            }
        ],
        "mentioned_deadlines": [],
        "scope_change_indicators": [],
        "missing_or_ambiguous_information": [
            "Issuer name and role are missing.",
            "Communication date and deadline are not stated.",
            "Quantities and dimensions are missing.",
        ],
    }

    client = _make_client_with_raw_json(tmp_path, json.dumps(sparse_payload))
    resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": "proj-sparse",
            "instruction_text": "Move the cable tray to the north corridor.",
        },
    )

    assert resp.status_code == 201
    fields = resp.json()["ai_extraction"]["fields"]
    assert fields["issuer_name"] == {
        "value": None,
        "status": "missing",
        "note": None,
        "evidence_quote": None,
    }
    assert fields["communication_date"]["status"] == "missing"
    assert fields["communication_date"]["value"] is None
    assert fields["mentioned_quantities"] == []
    assert len(fields["missing_or_ambiguous_information"]) == 3


def test_ambiguous_instruction_marks_uncertain_fields(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    ambiguous_payload = {
        "instruction_description": {
            "value": "Possible addition of extra valves next week mentioned verbally.",
            "status": "uncertain",
            "note": "Tentative wording ('maybe mentioned').",
            "evidence_quote": "PM maybe mentioned adding around a few extra valves next week",
        },
        "issuer_name": {"value": None, "status": "missing"},
        "issuer_role": {
            "value": "PM",
            "status": "uncertain",
            "note": "Only abbreviated role mentioned without full name or organization.",
            "evidence_quote": "PM",
        },
        "recipient": {"value": None, "status": "missing"},
        "project_site_location": {"value": None, "status": "missing"},
        "communication_date": {"value": None, "status": "missing"},
        "requested_work": {
            "value": "Add extra valves",
            "status": "uncertain",
            "note": "Not confirmed as a formal instruction.",
            "evidence_quote": "adding around a few extra valves",
        },
        "affected_activity": {"value": None, "status": "missing"},
        "mentioned_quantities": [
            {
                "item_or_material": "valves",
                "quantity": None,
                "unit": None,
                "status": "uncertain",
                "note": "Vague phrase 'around a few' — exact count not stated.",
                "evidence_quote": "around a few extra valves",
            }
        ],
        "mentioned_materials": [],
        "mentioned_deadlines": [
            {
                "value": "next week",
                "status": "uncertain",
                "note": "Relative timeframe without anchor communication date.",
                "evidence_quote": "next week",
            }
        ],
        "scope_change_indicators": [
            {
                "value": "Mentions 'extra valves', unverified whether outside base scope.",
                "status": "uncertain",
                "evidence_quote": "extra valves",
            }
        ],
        "missing_or_ambiguous_information": [
            "Exact valve size, type, and numerical quantity are unspecified ('around a few').",
            "Location and confirmation of formal instruction are missing.",
        ],
    }

    client = _make_client_with_raw_json(tmp_path, json.dumps(ambiguous_payload))
    resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": "proj-ambig",
            "instruction_text": "PM maybe mentioned adding around a few extra valves next week.",
        },
    )

    assert resp.status_code == 201
    fields = resp.json()["ai_extraction"]["fields"]
    assert fields["instruction_description"]["status"] == "uncertain"
    assert fields["issuer_role"]["status"] == "uncertain"
    assert fields["mentioned_quantities"][0]["quantity"] is None
    assert fields["mentioned_quantities"][0]["status"] == "uncertain"
    assert len(fields["missing_or_ambiguous_information"]) == 2


def test_optional_image_attachment_preserved(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    minimal_valid = {
        "instruction_description": {
            "value": "Photo note: add firestopping collar at riser.",
            "status": "extracted",
            "evidence_quote": "add firestopping collar at riser",
        },
        "issuer_name": {"value": None, "status": "missing"},
        "issuer_role": {"value": None, "status": "missing"},
        "recipient": {"value": None, "status": "missing"},
        "project_site_location": {
            "value": "riser",
            "status": "uncertain",
            "note": "Specific floor/riser shaft not identified.",
            "evidence_quote": "at riser",
        },
        "communication_date": {"value": None, "status": "missing"},
        "requested_work": {
            "value": "Add firestopping collar",
            "status": "extracted",
            "evidence_quote": "add firestopping collar",
        },
        "affected_activity": {"value": None, "status": "missing"},
        "mentioned_quantities": [],
        "mentioned_materials": [],
        "mentioned_deadlines": [],
        "scope_change_indicators": [],
        "missing_or_ambiguous_information": ["Floor and riser shaft ID missing."],
    }

    fake_png = b"\x89PNG\r\n\x1a\nfake-site-photo"
    client = _make_client_with_raw_json(tmp_path, json.dumps(minimal_valid))
    resp = client.post(
        "/api/cases/instructions",
        data={
            "project_id": "proj-img",
            "instruction_text": "Add firestopping collar at riser per markup.",
        },
        files={"attachment": ("site_markup.png", fake_png, "image/png")},
    )

    assert resp.status_code == 201
    case = resp.json()
    assert case["original_input"]["source_type"] == "text_and_image"
    assert case["original_input"]["attachment_filename"] == "site_markup.png"
    assert len(case["attachment_ids"]) == 1
    uri = case["original_input"]["attachment_storage_uri"]
    saved_path = tmp_path / "files" / uri.removeprefix("local://files/")
    assert saved_path.read_bytes() == fake_png

    docs = client.get("/api/documents", params={"project_id": "proj-img"}).json()
    assert len(docs) == 1
    assert docs[0]["document_type"] == "site_photo"


def test_invalid_gemini_output_returns_502_without_saving(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    # 1. Non-JSON response
    client_bad_json = _make_client_with_raw_json(tmp_path, "Sorry, I cannot extract that.")
    resp1 = client_bad_json.post(
        "/api/cases/instructions",
        data={"project_id": "proj-err", "instruction_text": "Add 2 doors."},
    )
    assert resp1.status_code == 502

    # 2. Schema-invalid JSON response
    client_bad_schema = _make_client_with_raw_json(
        tmp_path, json.dumps({"instruction_description": "wrong-type-not-object"})
    )
    resp2 = client_bad_schema.post(
        "/api/cases/instructions",
        data={"project_id": "proj-err", "instruction_text": "Add 2 doors."},
    )
    assert resp2.status_code == 502
    assert client_bad_schema.get("/api/cases").json() == []


def test_gemini_missing_api_key_timeout_rate_limit_and_secret_safety(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("GEMINI_API_KEY", "")

    # 1. Unconfigured API key -> 503 Service Unavailable
    client = TestClient(create_app())
    unconfigured_resp = client.post(
        "/api/cases/instructions",
        data={"project_id": "proj-nokey", "instruction_text": "Relocate fan coil unit."},
    )
    assert unconfigured_resp.status_code == 503
    assert "GEMINI_API_KEY" in unconfigured_resp.json()["detail"]
    assert client.get("/api/cases").json() == []

    # 2. Rate limit mapping (429) and Timeout mapping (504)
    def raise_rate_limit(*_args, **_kwargs):
        raise GeminiRateLimitError("Rate limit exceeded.")

    app = create_app()
    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=raise_rate_limit,
    )
    assert (
        TestClient(app)
        .post(
            "/api/cases/instructions",
            data={"project_id": "p", "instruction_text": "Test instruction."},
        )
        .status_code
        == 429
    )

    def raise_timeout(*_args, **_kwargs):
        raise GeminiTimeoutError("Timed out.")

    app.dependency_overrides[get_gemini_client] = lambda: GeminiClient(
        settings=_settings_for_test(tmp_path),
        raw_generator=raise_timeout,
    )
    assert (
        TestClient(app)
        .post(
            "/api/cases/instructions",
            data={"project_id": "p", "instruction_text": "Test instruction."},
        )
        .status_code
        == 504
    )

    # 3. Verify real _invoke_gemini maps SDK APIError without leaking secret key
    secret_sentinel = "AIza-fake-secret-sentinel-do-not-leak"

    class FakeModels:
        def __init__(self, exc: Exception) -> None:
            self._exc = exc

        def generate_content(self, **_kwargs):
            raise self._exc

    class FakeGenaiClient:
        def __init__(self, exc: Exception) -> None:
            self.models = FakeModels(exc)

    rate_exc = genai_errors.APIError(
        429, {"error": {"status": "RESOURCE_EXHAUSTED", "message": "quota"}}
    )
    monkeypatch.setattr(
        gemini_module.genai, "Client", lambda **_kwargs: FakeGenaiClient(rate_exc)
    )
    real_client = GeminiClient(settings=_settings_for_test(tmp_path, api_key=secret_sentinel))
    try:
        real_client.extract_change_event(
            case_id="c1", project_id="p1", instruction_text="Install damper."
        )
        assert False, "Expected GeminiRateLimitError"
    except GeminiRateLimitError as exc:
        assert secret_sentinel not in str(exc)

    auth_exc = genai_errors.APIError(
        403, {"error": {"status": "PERMISSION_DENIED", "message": secret_sentinel}}
    )
    monkeypatch.setattr(
        gemini_module.genai, "Client", lambda **_kwargs: FakeGenaiClient(auth_exc)
    )
    try:
        real_client.extract_change_event(
            case_id="c2", project_id="p1", instruction_text="Install damper."
        )
        assert False, "Expected GeminiUpstreamError"
    except GeminiUpstreamError as exc:
        assert secret_sentinel not in str(exc)

    monkeypatch.setattr(
        gemini_module.genai,
        "Client",
        lambda **_kwargs: FakeGenaiClient(TimeoutError("socket timed out")),
    )
    try:
        real_client.extract_change_event(
            case_id="c3", project_id="p1", instruction_text="Install damper."
        )
        assert False, "Expected GeminiTimeoutError"
    except GeminiTimeoutError:
        pass


def test_original_input_and_ai_extraction_preserved_after_user_edits_and_confirmation(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")

    raw_text = "Site walk 19 Nov: Dave asked to reroute 8m of copper pipe in Basement B1."
    initial_payload = {
        "instruction_description": {
            "value": "Reroute 8m of copper pipe in Basement B1.",
            "status": "extracted",
            "evidence_quote": "reroute 8m of copper pipe in Basement B1",
        },
        "issuer_name": {
            "value": "Dave",
            "status": "uncertain",
            "note": "First name only; surname and company missing.",
            "evidence_quote": "Dave",
        },
        "issuer_role": {"value": None, "status": "missing"},
        "recipient": {"value": None, "status": "missing"},
        "project_site_location": {
            "value": "Basement B1",
            "status": "extracted",
            "evidence_quote": "Basement B1",
        },
        "communication_date": {
            "value": "19 Nov",
            "status": "uncertain",
            "note": "Year not stated in text.",
            "evidence_quote": "19 Nov",
        },
        "requested_work": {
            "value": "Reroute copper pipe",
            "status": "extracted",
            "evidence_quote": "reroute 8m of copper pipe",
        },
        "affected_activity": {"value": None, "status": "missing"},
        "mentioned_quantities": [
            {
                "item_or_material": "copper pipe",
                "quantity": "8",
                "unit": "m",
                "status": "extracted",
                "evidence_quote": "8m of copper pipe",
            }
        ],
        "mentioned_materials": [
            {"value": "copper pipe", "status": "extracted", "evidence_quote": "copper pipe"}
        ],
        "mentioned_deadlines": [],
        "scope_change_indicators": [
            {"value": "Rerouting existing line", "status": "extracted", "evidence_quote": "reroute"}
        ],
        "missing_or_ambiguous_information": [
            "Full name, role, and authority of 'Dave' are missing.",
            "Year for '19 Nov' is unspecified.",
        ],
    }

    client = _make_client_with_raw_json(tmp_path, json.dumps(initial_payload))
    created = client.post(
        "/api/cases/instructions",
        data={"project_id": "proj-confirm", "instruction_text": raw_text},
    ).json()
    case_id = created["id"]
    original_ai_snapshot = created["ai_extraction"]

    # Confirm without reviewer name -> 400
    edited_fields = dict(original_ai_snapshot["fields"])
    edited_fields["issuer_name"] = {
        "value": "Dave Richards",
        "status": "extracted",
        "note": "Verified from site diary.",
        "evidence_quote": "Dave",
    }
    edited_fields["issuer_role"] = {
        "value": "Site Superintendent",
        "status": "extracted",
        "note": "Verified by QS.",
        "evidence_quote": None,
    }

    missing_reviewer = client.patch(
        f"/api/cases/{case_id}/extraction",
        json={"fields": edited_fields, "confirmed_by": "  ", "confirm": True},
    )
    assert missing_reviewer.status_code == 400

    confirmed_resp = client.patch(
        f"/api/cases/{case_id}/extraction",
        json={
            "fields": edited_fields,
            "confirmed_by": "A. Patel (QS)",
            "reviewer_notes": "Confirmed against site walk log #14.",
            "confirm": True,
        },
    )
    assert confirmed_resp.status_code == 200

    saved = client.get(f"/api/cases/{case_id}").json()
    # Original input and AI suggestion must remain untouched
    assert saved["instruction_text"] == raw_text
    assert saved["original_input"]["raw_text"] == raw_text
    assert saved["ai_extraction"] == original_ai_snapshot

    # Human confirmation reflects edits cleanly
    confirmed = saved["confirmed_extraction"]
    assert confirmed["origin"] == "human_confirmed"
    assert confirmed["confirmation_status"] == "confirmed"
    assert confirmed["confirmed_by"] == "A. Patel (QS)"
    assert confirmed["confirmed_at"] is not None
    assert confirmed["fields"]["issuer_name"]["value"] == "Dave Richards"
    assert confirmed["fields"]["issuer_role"]["value"] == "Site Superintendent"


def test_invalid_instruction_requests_rejected(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = _make_client_with_raw_json(tmp_path, "{}")

    assert (
        client.post(
            "/api/cases/instructions",
            data={"project_id": "proj-1", "instruction_text": "   "},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/cases/instructions",
            data={"project_id": "   ", "instruction_text": "Valid instruction."},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/cases/instructions",
            data={"project_id": "proj-1", "instruction_text": "See file."},
            files={"attachment": ("malware.exe", b"MZ", "application/octet-stream")},
        ).status_code
        == 400
    )
