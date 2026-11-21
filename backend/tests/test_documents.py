"""Phase 2 tests for Contract PDF and BOQ Excel ingestion, integrity, and refs."""

import io
from pathlib import Path

from fastapi.testclient import TestClient
import openpyxl

from app.main import create_app


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _make_synthetic_pdf(pages_lines: list[list[str]]) -> bytes:
    """Create a minimal valid multi-page PDF; empty line list produces an empty/scanned page."""
    objects: dict[int, bytes] = {}
    page_ids: list[int] = []

    for idx, lines in enumerate(pages_lines):
        page_obj_id = 4 + 2 * idx
        content_obj_id = 5 + 2 * idx
        page_ids.append(page_obj_id)

        if lines:
            cmds = ["BT", "/F1 11 Tf", "50 750 Td", "14 TL"]
            for line_idx, line in enumerate(lines):
                escaped = _pdf_escape(line)
                cmds.append(f"({escaped}) Tj" if line_idx == 0 else f"T* ({escaped}) Tj")
            cmds.append("ET")
            stream_bytes = ("\n".join(cmds) + "\n").encode("latin-1")
        else:
            stream_bytes = b""

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


def _make_synthetic_boq_xlsx() -> bytes:
    """Create a 2-sheet synthetic BOQ workbook testing merges, blank rows, and nulls."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Civil BOQ"
    # Row 1: merged banner
    ws["A1"] = "SYNTHETIC BOQ FIXTURE"
    ws.merge_cells("A1:F1")
    # Row 2: blank
    ws.append([])
    # Row 3: headers
    ws.append(["Item No", "Description", "Unit", "Qty", "Rate", "Amount"])
    # Row 4: merged section header
    ws.append(["Section 1: Earthworks"])
    ws.merge_cells("A4:F4")
    # Row 5: blank
    ws.append([])
    # Row 6: normal priced row
    ws.append(["1.1", "Trench excavation up to 1.5m", "m3", 40, 25.50, 1020.00])
    # Row 7: missing quantity & amount (rate only)
    ws.append(["1.2", "Imported granular backfill (Rate Only)", "m3", None, 48.00, None])
    # Row 8 & 9: vertical text merge on description, vertical numeric merge on rate (must not duplicate!)
    ws.append(["1.3", "Concrete encasement Grade C30", "m3", 10, 140.00, None])
    ws.append(["1.4", None, "m3", 5, None, None])
    ws.merge_cells("B8:B9")
    ws.merge_cells("E8:E9")
    # Row 10: explicit TBD rate
    ws.append(["1.5", "Night-shift traffic control", "item", 1, "TBD", None])

    ws2 = wb.create_sheet("Summary")
    ws2.append(["Item", "Description", "Unit", "Quantity", "Unit Rate", "Total"])
    ws2.append(["S1", "Site mobilization allowance", "ls", 1, 1500, 1500])

    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()


def _stored_file_path(tmp_path: Path, storage_uri: str) -> Path:
    assert storage_uri.startswith("local://files/")
    rel = storage_uri.removeprefix("local://files/")
    return tmp_path / "files" / rel


def test_contract_pdf_upload_extracts_pages_and_preserves_original_and_refs(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    pdf_bytes = _make_synthetic_pdf(
        [
            ["Clause 1.1: Scope of Works", "Install chilled water risers."],
            ["Clause 8.1: Variations", "Notice within 7 days."],
        ]
    )
    resp = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-alpha", "is_demo": "true"},
        files={"file": ("subcontract_sample.pdf", pdf_bytes, "application/pdf")},
    )

    assert resp.status_code == 201
    body = resp.json()
    doc = body["document"]
    assert doc["filename"] == "subcontract_sample.pdf"
    assert doc["document_type"] == "contract_pdf"
    assert doc["project_id"] == "proj-alpha"
    assert doc["is_demo"] is True
    assert doc["processing_status"] == "extracted"
    assert doc["page_count"] == 2
    assert doc["readable_page_count"] == 2

    extraction = body["contract_extraction"]
    assert extraction["page_count"] == 2
    assert extraction["readable_page_count"] == 2
    assert extraction["unreadable_pages"] == []
    assert extraction["pages"][0]["page_number"] == 1
    assert "Clause 1.1: Scope of Works" in extraction["pages"][0]["text"]
    assert extraction["pages"][0]["source_reference"]["location"] == "Page 1"
    assert extraction["pages"][1]["page_number"] == 2
    assert "Clause 8.1: Variations" in extraction["pages"][1]["text"]
    assert extraction["pages"][1]["source_reference"]["location"] == "Page 2"

    saved_path = _stored_file_path(tmp_path, doc["storage_uri"])
    assert saved_path.read_bytes() == pdf_bytes

    list_resp = client.get("/api/documents", params={"project_id": "proj-alpha"})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    detail_resp = client.get(f"/api/documents/{doc['id']}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["contract_extraction"]["pages"][1]["page_number"] == 2


def test_scanned_unreadable_pdf_reported_clearly(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    scanned_pdf = _make_synthetic_pdf([[], []])
    resp = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-scan", "is_demo": "false"},
        files={"file": ("scanned_contract.pdf", scanned_pdf, "application/pdf")},
    )

    assert resp.status_code == 201
    body = resp.json()
    doc = body["document"]
    assert doc["processing_status"] == "unreadable"
    assert doc["page_count"] == 2
    assert doc["readable_page_count"] == 0
    assert "scanned or image-only" in doc["status_message"].lower()

    ext = body["contract_extraction"]
    assert ext["unreadable_pages"] == [1, 2]
    assert len(ext["warnings"]) == 1
    assert ext["pages"][0]["is_readable"] is False
    assert _stored_file_path(tmp_path, doc["storage_uri"]).read_bytes() == scanned_pdf


def test_partial_unreadable_pdf_reports_missing_pages(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    partial_pdf = _make_synthetic_pdf([["Page 1 readable text"], []])
    resp = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-partial"},
        files={"file": ("partial.pdf", partial_pdf, "application/pdf")},
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["document"]["processing_status"] == "partial"
    assert body["document"]["readable_page_count"] == 1
    assert body["contract_extraction"]["unreadable_pages"] == [2]
    assert "Page(s) 2" in body["document"]["status_message"]


def test_boq_excel_extraction_preserves_refs_merged_cells_blank_rows_and_nulls(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    xlsx_bytes = _make_synthetic_boq_xlsx()
    resp = client.post(
        "/api/documents/boq",
        data={"project_id": "proj-boq", "is_demo": "true"},
        files={
            "file": (
                "boq_fixture.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    doc = body["document"]
    assert doc["processing_status"] == "extracted"
    assert doc["sheet_count"] == 2
    assert doc["row_count"] == 7
    assert _stored_file_path(tmp_path, doc["storage_uri"]).read_bytes() == xlsx_bytes

    boq = body["boq_extraction"]
    civil = boq["sheets"][0]
    assert civil["sheet_name"] == "Civil BOQ"
    assert civil["header_row_number"] == 3
    assert "A1:F1" in civil["merged_ranges"]
    assert "A4:F4" in civil["merged_ranges"]
    assert civil["blank_rows_skipped"] == 1  # Row 5 between header and last data row

    rows_by_num = {row["row_number"]: row for row in civil["rows"]}
    # Row 4 merged section banner keeps text in first col only, never leaks into unit/qty/rate
    assert rows_by_num[4]["item_code"] == "Section 1: Earthworks"
    assert rows_by_num[4]["description"] is None
    assert rows_by_num[4]["quantity"] is None
    assert rows_by_num[4]["rate"] is None

    # Row 6 normal item
    row6 = rows_by_num[6]
    assert row6["source_reference"]["location"] == "Sheet 'Civil BOQ', Row 6"
    assert row6["unit"] == "m3"
    assert row6["quantity"] == "40"
    assert row6["rate"] == "25.5"
    assert row6["amount"] == "1020"

    # Row 7 missing quantity & amount remain None (never invented or computed)
    row7 = rows_by_num[7]
    assert row7["source_reference"]["location"] == "Sheet 'Civil BOQ', Row 7"
    assert row7["quantity"] is None
    assert row7["rate"] == "48"
    assert row7["amount"] is None

    # Row 9 vertical merge: text description carried safely, numeric rate NOT duplicated
    row9 = rows_by_num[9]
    assert row9["description"] == "Concrete encasement Grade C30"
    assert row9["quantity"] == "5"
    assert row9["rate"] is None
    assert any("E8:E9" in w for w in civil["warnings"])

    # Row 10 TBD rate stays None
    row10 = rows_by_num[10]
    assert row10["quantity"] == "1"
    assert row10["rate"] is None
    assert row10["amount"] is None

    # Second sheet exact source reference
    summary = boq["sheets"][1]
    assert summary["sheet_name"] == "Summary"
    assert summary["rows"][0]["source_reference"]["location"] == "Sheet 'Summary', Row 2"


def test_duplicate_uploads_prevented_per_project(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    pdf_bytes = _make_synthetic_pdf([["Contract Clause 1"]])
    first = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-1"},
        files={"file": ("contract_a.pdf", pdf_bytes, "application/pdf")},
    )
    assert first.status_code == 201

    # Same content with different filename in same project -> 409 Conflict
    dup_bytes = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-1"},
        files={"file": ("contract_renamed.pdf", pdf_bytes, "application/pdf")},
    )
    assert dup_bytes.status_code == 409

    # Different content with same filename in same project -> 409 Conflict
    other_pdf = _make_synthetic_pdf([["Contract Clause 2"]])
    dup_name = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-1"},
        files={"file": ("contract_a.pdf", other_pdf, "application/pdf")},
    )
    assert dup_name.status_code == 409

    # Same file uploaded to a DIFFERENT project succeeds
    diff_proj = client.post(
        "/api/documents/contract",
        data={"project_id": "proj-2"},
        files={"file": ("contract_a.pdf", pdf_bytes, "application/pdf")},
    )
    assert diff_proj.status_code == 201
    assert len(client.get("/api/documents", params={"project_id": "proj-1"}).json()) == 1

    # Duplicate prevention for BOQ Excel as well
    xlsx_bytes = _make_synthetic_boq_xlsx()
    assert (
        client.post(
            "/api/documents/boq",
            data={"project_id": "proj-1"},
            files={"file": ("boq.xlsx", xlsx_bytes, "application/octet-stream")},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/documents/boq",
            data={"project_id": "proj-1"},
            files={"file": ("boq_copy.xlsx", xlsx_bytes, "application/octet-stream")},
        ).status_code
        == 409
    )


def test_invalid_files_rejected(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    assert (
        client.post(
            "/api/documents/contract",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/documents/contract",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/documents/contract",
            files={"file": ("corrupt.pdf", b"not-a-pdf", "application/pdf")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/documents/boq",
            files={"file": ("legacy.xls", b"dummy", "application/vnd.ms-excel")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/documents/boq",
            files={"file": ("corrupt.xlsx", b"not-a-zip", "application/octet-stream")},
        ).status_code
        == 400
    )
    assert client.get("/api/documents").json() == []


def test_demo_sample_files_parse_cleanly(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    client = TestClient(create_app())

    samples_dir = Path(__file__).resolve().parents[2] / "samples"
    pdf_path = samples_dir / "demo_subcontract_sample.pdf"
    xlsx_path = samples_dir / "demo_boq_sample.xlsx"

    pdf_resp = client.post(
        "/api/documents/contract",
        data={"project_id": "demo-project", "is_demo": "true"},
        files={"file": (pdf_path.name, pdf_path.read_bytes(), "application/pdf")},
    )
    assert pdf_resp.status_code == 201
    assert pdf_resp.json()["document"]["is_demo"] is True
    assert pdf_resp.json()["document"]["processing_status"] == "extracted"

    boq_resp = client.post(
        "/api/documents/boq",
        data={"project_id": "demo-project", "is_demo": "true"},
        files={
            "file": (
                xlsx_path.name,
                xlsx_path.read_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert boq_resp.status_code == 201
    assert boq_resp.json()["document"]["is_demo"] is True
    assert boq_resp.json()["document"]["processing_status"] == "extracted"
