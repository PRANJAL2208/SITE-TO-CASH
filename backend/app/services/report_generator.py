"""PDF variation evidence pack generator (Phase 6)."""

from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from typing import Any, Optional
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.schemas import (
    ChangeEventFields,
    CitedFinding,
    CommercialAssessmentRecord,
    DocumentMetadata,
    ExtractedField,
    LifecycleHistoryEntry,
    ReviewHistoryEntry,
    SourceReference,
    VariationCase,
    VariationLifecycleStatus,
)
from app.services.lifecycle import (
    APPROVED_OR_LATER_STATUSES,
    effective_variation_reference,
    resolve_proposed_amount,
)


def _esc(value: Optional[str], missing_label: str = "Not provided") -> str:
    if value is None:
        return f"<i>{escape(missing_label)}</i>"
    stripped = str(value).strip()
    if not stripped:
        return f"<i>{escape(missing_label)}</i>"
    return escape(stripped).replace("\n", "<br/>")


def _fmt_dt(value: Optional[datetime], missing_label: str = "Not recorded") -> str:
    if value is None:
        return missing_label
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _fmt_dec(
    value: Optional[Decimal],
    currency: Optional[str] = None,
    missing_label: str = "MISSING / NOT STATED",
) -> str:
    if value is None:
        return missing_label
    prefix = f"{currency.strip().upper()} " if currency and currency.strip() else ""
    return f"{prefix}{value}"


def _format_refs_inline(refs: list[SourceReference]) -> str:
    if not refs:
        return "<i>[No source reference linked]</i>"
    parts = [f"{r.document_name} ({r.location})" for r in refs]
    return escape("; ".join(parts))


def determine_report_status_classification(
    case: VariationCase,
) -> tuple[str, bool]:
    """Determine accurate non-misleading draft/approval label and is_draft flag."""
    status = case.lifecycle_status
    if status == VariationLifecycleStatus.rejected:
        return "DRAFT — NOT SUBMITTED (CASE REJECTED / CLOSED)", True
    if status in {
        VariationLifecycleStatus.detected,
        VariationLifecycleStatus.under_review,
        VariationLifecycleStatus.drafted,
    }:
        return "DRAFT — NOT SUBMITTED", True
    if status == VariationLifecycleStatus.submitted:
        return "SUBMITTED FOR REVIEW — NOT CLIENT APPROVED", False
    return f"CLIENT APPROVED ({status.value.upper()})", False


class _EvidencePackCanvas(canvas.Canvas):
    """Canvas adding repeating headers, draft/demo markers, and Page X of Y footers."""

    def __init__(
        self,
        *args: Any,
        var_ref: str,
        status_label: str,
        is_demo: bool,
        report_id: str,
        generated_at_str: str,
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict[str, Any]] = []
        self._var_ref = var_ref
        self._status_label = status_label
        self._is_demo = is_demo
        self._report_id = report_id
        self._generated_at_str = generated_at_str

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_chrome(total_pages)
            super().showPage()
        super().save()

    def _draw_chrome(self, total_pages: int) -> None:
        page_width, page_height = A4
        left_x = 16 * mm
        right_x = page_width - 16 * mm

        self.saveState()
        # Top commercial header bar
        self.setFont("Helvetica-Bold", 8.5)
        self.setFillColor(colors.HexColor("#1e293b"))
        self.drawString(
            left_x,
            page_height - 11 * mm,
            f"Site-to-Cash | Variation Evidence Pack — {self._var_ref}",
        )

        self.setFont("Helvetica-Bold", 8.5)
        if "DRAFT" in self._status_label:
            self.setFillColor(colors.HexColor("#b45309"))
        elif "NOT CLIENT APPROVED" in self._status_label:
            self.setFillColor(colors.HexColor("#1d4ed8"))
        else:
            self.setFillColor(colors.HexColor("#15803d"))
        self.drawRightString(right_x, page_height - 11 * mm, self._status_label)

        if self._is_demo:
            self.setFont("Helvetica-Bold", 7.5)
            self.setFillColor(colors.HexColor("#9a3412"))
            self.drawString(
                left_x,
                page_height - 15.2 * mm,
                "DEMO DATA — GENERATED FROM SYNTHETIC SAMPLE RECORDS",
            )

        self.setStrokeColor(colors.HexColor("#cbd5e1"))
        self.setLineWidth(0.6)
        self.line(left_x, page_height - 17 * mm, right_x, page_height - 17 * mm)

        # Bottom footer bar
        self.line(left_x, 14.5 * mm, right_x, 14.5 * mm)
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#475569"))
        self.drawString(
            left_x,
            10.2 * mm,
            f"Report ID: {self._report_id} | Generated: {self._generated_at_str}",
        )
        self.drawRightString(
            right_x,
            10.2 * mm,
            f"Page {self._pageNumber} of {total_pages}",
        )
        self.restoreState()


def generate_draft_report(case: VariationCase) -> str:
    """Backward-compatible helper summary for lightweight callers."""
    ref = effective_variation_reference(case)
    label, _ = determine_report_status_classification(case)
    return f"{ref}: {case.title} [{label}]"


def generate_evidence_pack_pdf(
    case: VariationCase,
    assessment: Optional[CommercialAssessmentRecord],
    supporting_documents: list[DocumentMetadata],
    review_history: list[ReviewHistoryEntry],
    lifecycle_history: list[LifecycleHistoryEntry],
    *,
    report_id: str,
    prepared_by: str,
    generated_at: datetime,
    project_name: Optional[str] = None,
    subcontractor_name: Optional[str] = None,
    variation_reference: Optional[str] = None,
) -> tuple[bytes, int, str, bool]:
    """Generate a structured 17-section PDF evidence pack and verify readability via pypdf."""
    var_ref = (
        variation_reference.strip()
        if variation_reference and variation_reference.strip()
        else effective_variation_reference(case)
    )
    status_label, is_draft = determine_report_status_classification(case)
    eff_project_name = (
        project_name.strip()
        if project_name and project_name.strip()
        else case.commercial_tracking.project_name
    )
    eff_subcontractor = (
        subcontractor_name.strip()
        if subcontractor_name and subcontractor_name.strip()
        else case.commercial_tracking.subcontractor_name
    )
    generated_at_str = _fmt_dt(generated_at)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "PackTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "PackSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475569"),
        spaceAfter=6,
    )
    section_style = ParagraphStyle(
        "PackSection",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=14,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
    )
    body_style = ParagraphStyle(
        "PackBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=3,
    )
    small_style = ParagraphStyle(
        "PackSmall",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.8,
        leading=10.2,
        textColor=colors.HexColor("#334155"),
    )
    th_style = ParagraphStyle(
        "PackTableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.8,
        leading=10,
        textColor=colors.white,
    )
    banner_warn_style = ParagraphStyle(
        "PackWarnBanner",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor("#7c2d12"),
    )
    ai_banner_style = ParagraphStyle(
        "PackAiBanner",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.3,
        leading=11,
        textColor=colors.HexColor("#1e40af"),
    )
    qs_banner_style = ParagraphStyle(
        "PackQsBanner",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.3,
        leading=11,
        textColor=colors.HexColor("#14532d"),
    )

    def _p(text: str, st: ParagraphStyle = body_style) -> Paragraph:
        return Paragraph(text, st)

    def _kv_table(
        rows: list[tuple[str, str]], col_widths: tuple[float, float] = (50 * mm, 128 * mm)
    ) -> Table:
        data = [[_p(f"<b>{escape(k)}</b>", small_style), _p(v, small_style)] for k, v in rows]
        tbl = Table(data, colWidths=list(col_widths), repeatRows=0)
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                    ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return tbl

    def _grid_table(
        headers: list[str],
        rows: list[list[str]],
        col_widths: list[float],
    ) -> Table:
        table_data = [[_p(escape(h), th_style) for h in headers]]
        for row in rows:
            table_data.append([_p(cell, small_style) for cell in row])
        tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
                    ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        return tbl

    def _callout(text_html: str, bg_hex: str, border_hex: str, style_obj: ParagraphStyle) -> Table:
        tbl = Table([[_p(text_html, style_obj)]], colWidths=[178 * mm])
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_hex)),
                    ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor(border_hex)),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        return tbl

    story: list[Any] = []

    # Title block
    story.append(_p(f"VARIATION EVIDENCE PACK — {escape(var_ref)}", title_style))
    story.append(_p(escape(case.title), subtitle_style))

    if case.is_demo:
        story.append(
            _callout(
                "DEMO DATA: This evidence pack includes synthetic sample contract, BOQ, or site instruction records labelled is_demo=True.",
                "#ffedd5",
                "#ea580c",
                banner_warn_style,
            )
        )
        story.append(Spacer(1, 4))

    story.append(
        _callout(
            f"COMMERCIAL STATUS: {escape(status_label)} | Lifecycle State: {escape(case.lifecycle_status.value)} | "
            + (
                "UNAPPROVED VARIATION — Must NOT be represented as client-approved or recoverable revenue."
                if case.lifecycle_status not in APPROVED_OR_LATER_STATUSES
                else "Client approval recorded in lifecycle register."
            ),
            "#fef3c7" if is_draft else ("#dbeafe" if case.lifecycle_status == VariationLifecycleStatus.submitted else "#dcfce7"),
            "#d97706" if is_draft else ("#2563eb" if case.lifecycle_status == VariationLifecycleStatus.submitted else "#16a34a"),
            banner_warn_style if is_draft else (ai_banner_style if case.lifecycle_status == VariationLifecycleStatus.submitted else qs_banner_style),
        )
    )
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#94a3b8")))

    # Effective fields: track source explicitly (Human-Confirmed vs AI Unconfirmed vs Missing)
    confirmed_fields: Optional[ChangeEventFields] = (
        case.confirmed_extraction.fields if case.confirmed_extraction else None
    )
    ai_fields: Optional[ChangeEventFields] = (
        case.ai_extraction.fields if case.ai_extraction else None
    )
    extraction_origin_note = (
        "Human-Confirmed Extraction"
        if case.confirmed_extraction and case.confirmed_extraction.confirmation_status == "confirmed"
        else ("Draft Human Edits (Unconfirmed)" if case.confirmed_extraction else "AI Suggestion Only (Unconfirmed by Human)")
    )
    active_fields = confirmed_fields or ai_fields

    def _field_row(label: str, field_getter: Any) -> list[str]:
        ef: Optional[ExtractedField] = field_getter(active_fields) if active_fields else None
        if ef is None or ef.value is None:
            status_txt = f"MISSING ({extraction_origin_note})" if active_fields else "MISSING"
            val_txt = "<i>Not present in instruction / not yet confirmed</i>"
            ev_txt = "<i>No evidence quote</i>"
        else:
            status_txt = f"{ef.status.value} [{extraction_origin_note}]"
            val_txt = _esc(ef.value)
            ev_txt = _esc(ef.evidence_quote, "No verbatim quote recorded")
        return [escape(label), val_txt, escape(status_txt), ev_txt]

    # 1. Project and subcontractor details
    story.append(_p("1. Project &amp; Subcontractor Details", section_style))
    story.append(
        _kv_table(
            [
                ("Project ID", escape(case.project_id)),
                ("Project Name", _esc(eff_project_name, "Not supplied (missing metadata)")),
                ("Subcontractor Name", _esc(eff_subcontractor, "Not supplied (missing metadata)")),
                ("Case ID", escape(case.id)),
                ("Dataset Classification", "DEMO DATA (Synthetic Sample)" if case.is_demo else "Live Project Record"),
            ]
        )
    )

    # 2. Variation reference and title
    story.append(_p("2. Variation Reference, Title &amp; Commercial Classification", section_style))
    story.append(
        _kv_table(
            [
                ("Variation Reference", escape(var_ref)),
                ("Variation Title", _esc(case.title)),
                ("Report Classification", escape(status_label)),
                ("Lifecycle Status", escape(case.lifecycle_status.value)),
                (
                    "Client Approval State",
                    "APPROVED"
                    if case.lifecycle_status in APPROVED_OR_LATER_STATUSES
                    else "UNAPPROVED (Not approved by client)",
                ),
            ]
        )
    )

    # 3. Original site instruction
    story.append(_p("3. Original Site Instruction (Immutable Record)", section_style))
    orig = case.original_input
    raw_instr_text = orig.raw_text if orig and orig.raw_text else case.instruction_text
    story.append(
        _kv_table(
            [
                ("Original Instruction Text", _esc(raw_instr_text, "No text submitted (check attachment reference)")),
                ("Input Channel", escape(orig.source_type.value) if orig else "<i>Not recorded</i>"),
                ("Submission Timestamp", escape(_fmt_dt(orig.submitted_at if orig else case.created_at))),
            ]
        )
    )

    # 4. Instruction date, issuer and source information
    story.append(_p("4. Instruction Date, Issuer &amp; Source Information", section_style))
    story.append(
        _grid_table(
            ["Attribute", "Extracted Value", "Verification / Source", "Verbatim Instruction Quote"],
            [
                _field_row("Instruction Date", lambda f: f.communication_date),
                _field_row("Issuer Name", lambda f: f.issuer_name),
                _field_row("Issuer Role", lambda f: f.issuer_role),
                _field_row("Recipient", lambda f: f.recipient),
                _field_row("Site / Location", lambda f: f.project_site_location),
            ],
            [32 * mm, 46 * mm, 44 * mm, 56 * mm],
        )
    )

    # 5. Description of requested additional or changed work
    story.append(_p("5. Description of Requested Additional or Changed Work", section_style))
    story.append(
        _grid_table(
            ["Element", "Details", "Verification / Source", "Verbatim Instruction Quote"],
            [
                _field_row("Instruction Summary", lambda f: f.instruction_description),
                _field_row("Requested Work", lambda f: f.requested_work),
                _field_row("Affected Activity", lambda f: f.affected_activity),
            ],
            [32 * mm, 52 * mm, 42 * mm, 52 * mm],
        )
    )
    if active_fields and active_fields.mentioned_quantities:
        story.append(Spacer(1, 3))
        qty_rows = [
            [
                _esc(m.item_or_material, "Unspecified item"),
                _esc(m.quantity, "Missing"),
                _esc(m.unit, "Missing"),
                escape(m.status.value),
                _esc(m.evidence_quote, "No quote"),
            ]
            for m in active_fields.mentioned_quantities
        ]
        story.append(
            _grid_table(
                ["Mentioned Item / Material", "Qty (Instruction)", "Unit", "Status", "Evidence Quote"],
                qty_rows,
                [44 * mm, 24 * mm, 20 * mm, 24 * mm, 66 * mm],
            )
        )
    elif not active_fields or not active_fields.mentioned_quantities:
        story.append(_p("<i>No explicit quantities extracted from site instruction.</i>", small_style))

    # 6. Contract clauses and exact page references
    story.append(_p("6. Retrieved Contract Clauses &amp; Exact Page References", section_style))
    if assessment and assessment.retrieved_contract_clauses:
        clause_rows = []
        for c in assessment.retrieved_contract_clauses:
            clause_heading = " — ".join(
                part for part in [c.clause_number, c.clause_title] if part
            ) or "Clause / Passage"
            clause_rows.append(
                [
                    escape(c.ref_id),
                    f"<b>{escape(c.document_name)}</b><br/>Page {c.page_number} ({escape(clause_heading)})<br/><i>{escape(c.source_reference.location)}</i>",
                    _esc(c.verbatim_text),
                    _esc(c.relevance_reason),
                ]
            )
        story.append(
            _grid_table(
                ["Ref", "Contract Document & Page Ref", "Verbatim Clause Text", "Relevance Reason"],
                clause_rows,
                [14 * mm, 46 * mm, 76 * mm, 42 * mm],
            )
        )
    else:
        story.append(
            _p(
                "<i>No contract clauses retrieved or linked. Verify uploaded contract PDFs before relying on contractual entitlement.</i>",
                body_style,
            )
        )

    # 7. Relevant BOQ rows with sheet and row references
    story.append(_p("7. Relevant BOQ Rows with Sheet &amp; Row References", section_style))
    if assessment and assessment.retrieved_boq_items:
        boq_rows = []
        for b in assessment.retrieved_boq_items:
            boq_rows.append(
                [
                    escape(b.ref_id),
                    f"<b>{escape(b.workbook_name)}</b><br/>Sheet: {escape(b.sheet_name)}, Row {b.row_number}<br/><i>{escape(b.source_reference.location)}</i>",
                    f"{escape(b.item_code or '—')} | {_esc(b.description, 'No description')}<br/><i>{escape(b.caution_note)}</i>",
                    _esc(b.unit, "—"),
                    f"Qty: {_fmt_dec(b.quantity, missing_label='—')}<br/>Rate: {_fmt_dec(b.rate, missing_label='—')}<br/>Amt: {_fmt_dec(b.amount, missing_label='—')}",
                ]
            )
        story.append(
            _grid_table(
                ["Ref", "Workbook, Sheet & Row Ref", "Item & Base-Scope Note", "Unit", "Original BOQ Values"],
                boq_rows,
                [14 * mm, 46 * mm, 64 * mm, 16 * mm, 38 * mm],
            )
        )
    else:
        story.append(
            _p(
                "<i>No relevant BOQ rows retrieved or linked.</i>",
                body_style,
            )
        )

    # 8. Comparison against documented scope
    story.append(_p("8. Comparison Against Documented Scope (Source-Attributed)", section_style))
    if assessment:
        ai_assess = assessment.ai_assessment
        story.append(
            _kv_table(
                [
                    ("Scope Comparison", _esc(ai_assess.scope_comparison)),
                    ("Requested Work Summary (AI)", _esc(ai_assess.requested_work_summary)),
                ]
            )
        )

        def _append_findings_block(heading: str, findings: list[CitedFinding]) -> None:
            if not findings:
                return
            story.append(Spacer(1, 3))
            rows = []
            for f in findings:
                claim_html = _esc(f.statement)
                if f.grounding_status != "verified":
                    note_txt = f" ({escape(f.grounding_note)})" if f.grounding_note else ""
                    claim_html += f"<br/><b>[UNVERIFIED / UNSUPPORTED AI CLAIM]{note_txt}</b>"
                rows.append([claim_html, _format_refs_inline(f.source_references)])
            story.append(_p(f"<b>{escape(heading)}</b>", small_style))
            story.append(
                _grid_table(
                    ["Claim / Finding", "Mandatory Source Reference"],
                    rows,
                    [104 * mm, 74 * mm],
                )
            )

        _append_findings_block("Directly Documented Facts", ai_assess.documented_facts)
        _append_findings_block("Explicit Inclusions", ai_assess.explicit_inclusions)
        _append_findings_block("Explicit Exclusions", ai_assess.explicit_exclusions)
        _append_findings_block("Potential Scope Overlap", ai_assess.potential_scope_overlap)
        _append_findings_block(
            "Conflicting or Ambiguous Evidence", ai_assess.conflicting_or_ambiguous_evidence
        )
    else:
        story.append(
            _p(
                "<i>Contract/BOQ scope comparison has not been executed yet for this case.</i>",
                body_style,
            )
        )

    # 9. Preliminary AI assessment, clearly labelled
    story.append(_p("9. Preliminary AI Assessment (AI Suggestion — Not Confirmed)", section_style))
    if assessment:
        story.append(
            _callout(
                f"AI SUGGESTION ({escape(assessment.model_name)} at {escape(_fmt_dt(assessment.assessed_at))}): "
                f"{escape(assessment.ai_assessment.disclaimer)}",
                "#eff6ff",
                "#2563eb",
                ai_banner_style,
            )
        )
        story.append(Spacer(1, 3))
        followup_html = (
            "<br/>".join(f"- {escape(item)}" for item in assessment.ai_assessment.recommended_qs_followup)
            if assessment.ai_assessment.recommended_qs_followup
            else "<i>None recorded</i>"
        )
        story.append(
            _kv_table(
                [
                    ("Assessment Record ID", escape(assessment.id)),
                    ("AI Suggested Category", escape(assessment.ai_assessment.assessment_category.value)),
                    ("AI Interpretation Summary", _esc(assessment.ai_assessment.ai_interpretation_summary)),
                    (
                        "Commercial Guardrail Warnings",
                        "<br/>".join(f"- {escape(w)}" for w in assessment.ai_assessment.guardrail_warnings)
                        if assessment.ai_assessment.guardrail_warnings
                        else "<i>None</i>",
                    ),
                    ("Recommended QS Follow-Up", followup_html),
                ]
            )
        )
    else:
        story.append(
            _p("<i>No preliminary AI commercial assessment has been generated for this case.</i>", body_style)
        )

    # 10. Human-confirmed QS decision
    story.append(_p("10. Human-Confirmed QS Decision", section_style))
    qs = case.qs_decision
    qs_is_confirmed = qs.review_status.value in {"confirmed", "rejected"} and not qs.is_draft
    story.append(
        _callout(
            f"HUMAN QS DECISION — Review Status: {escape(qs.review_status.value.upper())} "
            + ("(Confirmed Human Decision)" if qs_is_confirmed else "(Draft / Pending Human Confirmation)"),
            "#f0fdf4" if qs_is_confirmed else "#fefce8",
            "#16a34a" if qs_is_confirmed else "#ca8a04",
            qs_banner_style if qs_is_confirmed else banner_warn_style,
        )
    )
    story.append(Spacer(1, 3))
    story.append(
        _kv_table(
            [
                ("QS Review Status", escape(qs.review_status.value)),
                ("QS Action", escape(qs.decision_action.value) if qs.decision_action else "<i>Pending</i>"),
                ("Confirmed Category", escape(qs.confirmed_category.value) if qs.confirmed_category else "<i>Not confirmed</i>"),
                ("Confirmed Outcome", escape(qs.confirmed_assessment.value) if qs.confirmed_assessment else "<i>Not confirmed</i>"),
                ("QS Reviewer", _esc(qs.reviewer_name, "Pending QS assignment")),
                ("Reviewed Timestamp", _fmt_dt(qs.reviewed_at, "Pending review")),
                ("QS Written Reason", _esc(qs.reason, "No written reason recorded")),
                ("QS Commercial Notes", _esc(qs.notes, "No commercial notes recorded")),
                ("Human Draft Flag", "Draft" if qs.is_draft else "Finalized QS Decision"),
            ]
        )
    )

    # 11. Quantity and rate build-up
    story.append(_p("11. Quantity &amp; Rate Build-Up (BOQ Reference vs. Variation Inputs)", section_style))
    est = case.deterministic_estimate
    currency = est.currency if est else None
    if est and est.line_items:
        line_rows = []
        for idx, item in enumerate(est.line_items, start=1):
            boq_ref_loc = (
                f"{item.boq_reference.document_name} ({item.boq_reference.location})"
                if item.boq_reference
                else "No BOQ row linked"
            )
            orig_boq = (
                f"Code: {escape(item.original_boq_item_code or '—')}<br/>"
                f"Qty: {_fmt_dec(item.original_boq_quantity, missing_label='—')} {escape(item.original_boq_unit or '')}<br/>"
                f"Rate: {_fmt_dec(item.original_boq_rate, currency, '—')}"
            )
            var_vals = (
                f"<b>{escape(item.line_type.value.upper())}</b> ({escape(item.category.value)})<br/>"
                f"Qty: {_fmt_dec(item.quantity, missing_label='MISSING')} {escape(item.unit or '—')} [{escape(item.quantity_source.value)}]<br/>"
                f"Rate: {_fmt_dec(item.rate, currency, 'MISSING')} [{escape(item.rate_source.value)}]"
            )
            line_rows.append(
                [
                    str(idx),
                    f"<b>{_esc(item.description)}</b><br/><i>{_esc(item.note, 'No line note')}</i>",
                    escape(boq_ref_loc) + "<br/>" + orig_boq,
                    var_vals,
                    f"<b>{_fmt_dec(item.amount, currency, 'MISSING')}</b><br/>Status: {escape(item.verification_status.value)}",
                ]
            )
        story.append(
            _grid_table(
                ["#", "Description", "Original BOQ Reference", "Variation Qty & Rate", "Line Amount & Status"],
                line_rows,
                [9 * mm, 46 * mm, 44 * mm, 47 * mm, 32 * mm],
            )
        )
    else:
        story.append(
            _p(
                "<i>No cost build-up line items entered yet. Missing quantities and rates are not fabricated.</i>",
                body_style,
            )
        )

    # 12. Deterministic cost calculation
    story.append(_p("12. Deterministic Cost Calculation (Proposed vs. Approved Separation)", section_style))
    proposed_amt = resolve_proposed_amount(case)
    approved_amt = (
        case.commercial_tracking.approved_amount
        if case.lifecycle_status in APPROVED_OR_LATER_STATUSES
        else None
    )
    if est:
        calc_notes = (
            "<br/>".join(f"- {escape(n)}" for n in est.calculation_notes)
            if est.calculation_notes
            else "<i>None</i>"
        )
        story.append(
            _kv_table(
                [
                    ("Currency & Rounding", f"{escape(est.currency or 'UNSPECIFIED')} | {est.decimal_places} dp ({escape(est.rounding_mode.value)})"),
                    ("Additions Subtotal", _fmt_dec(est.additions_subtotal, est.currency, "MISSING (incomplete lines)")),
                    ("Deductions Subtotal", _fmt_dec(est.deductions_subtotal, est.currency, "0 (no deductions)" if est.calculable_line_count else "MISSING")),
                    ("Net Subtotal (Excl. Tax)", _fmt_dec(est.subtotal, est.currency, "MISSING / INCOMPLETE")),
                    (
                        "Tax (Explicit Only)",
                        f"{_fmt_dec(est.tax_amount, est.currency, 'Not applicable / missing')} (Rate: {est.tax_rate_percent}%)"
                        if est.tax_rate_percent is not None
                        else "<i>Not applied (no explicit tax rate supplied)</i>",
                    ),
                    ("Deterministic Estimated Total", f"<b>{_fmt_dec(est.total_estimated_amount, est.currency, 'MISSING / CANNOT COMPUTE')}</b>"),
                    ("Estimate Completeness", f"Calculable lines: {est.calculable_line_count}, Incomplete lines: {est.incomplete_line_count}, Partial: {est.is_partial_estimate}, Unverified inputs: {est.has_unverified_inputs}"),
                    ("Proposed / Claimed Value (Unapproved unless noted)", _fmt_dec(proposed_amt, est.currency, "NOT STATED")),
                    (
                        "Client-Approved Value (Separate Commercial Record)",
                        _fmt_dec(approved_amt, est.currency)
                        if approved_amt is not None
                        else "<b>NOT APPROVED</b> (Client approval not confirmed)",
                    ),
                    ("Calculation Notes & Disclaimer", f"{calc_notes}<br/><i>{escape(est.disclaimer)}</i>"),
                ]
            )
        )
    else:
        story.append(
            _kv_table(
                [
                    ("Deterministic Estimated Total", "<i>Not calculated — no verified cost build-up saved</i>"),
                    ("Proposed / Claimed Value", _fmt_dec(proposed_amt, None, "NOT STATED")),
                    (
                        "Client-Approved Value",
                        _fmt_dec(approved_amt)
                        if approved_amt is not None
                        else "<b>NOT APPROVED</b> (Client approval not confirmed)",
                    ),
                ]
            )
        )

    # 13. Supporting evidence and attachment references
    story.append(_p("13. Supporting Evidence &amp; Attachment References", section_style))
    evidence_rows: list[list[str]] = []
    if orig and orig.attachment_filename:
        evidence_rows.append(
            [
                escape(orig.attachment_id or "instruction-attachment"),
                "Instruction Attachment",
                escape(orig.attachment_filename),
                escape(orig.attachment_storage_uri or "Stored in project repository"),
            ]
        )
    for doc in supporting_documents:
        evidence_rows.append(
            [
                escape(doc.id),
                escape(doc.document_type.value),
                escape(doc.filename) + (" [DEMO DATA]" if doc.is_demo else ""),
                escape(doc.storage_uri),
            ]
        )
    if assessment and assessment.retrieved_source_references:
        for ref in assessment.retrieved_source_references:
            evidence_rows.append(
                [
                    escape(ref.document_id),
                    escape(ref.document_type.value),
                    f"{escape(ref.document_name)} ({escape(ref.location)})",
                    escape(ref.excerpt[:180] + ("..." if len(ref.excerpt) > 180 else "")),
                ]
            )
    if evidence_rows:
        story.append(
            _grid_table(
                ["Document ID", "Evidence Type", "Document & Location", "Storage URI / Excerpt"],
                evidence_rows,
                [28 * mm, 30 * mm, 52 * mm, 68 * mm],
            )
        )
    else:
        story.append(
            _p("<i>No attachments or external project documents linked to this case.</i>", body_style)
        )

    # 14. Missing information and outstanding approvals
    story.append(_p("14. Missing Information &amp; Outstanding Approvals", section_style))
    missing_items: list[tuple[str, str]] = []
    if not eff_project_name:
        missing_items.append(("Project Name", "Not supplied in commercial tracking or report metadata."))
    if not eff_subcontractor:
        missing_items.append(("Subcontractor Name", "Not supplied in commercial tracking or report metadata."))
    if active_fields and active_fields.missing_or_ambiguous_information:
        missing_items.append(
            (
                "Instruction Extraction Gaps",
                "<br/>".join(f"- {escape(m)}" for m in active_fields.missing_or_ambiguous_information),
            )
        )
    if not case.confirmed_extraction or case.confirmed_extraction.confirmation_status != "confirmed":
        missing_items.append(("Extraction Confirmation", "Site instruction extraction has not been human-confirmed yet."))
    if assessment:
        if assessment.ai_assessment.missing_evidence_and_information:
            missing_items.append(
                (
                    "Commercial Assessment Missing Evidence",
                    "<br/>".join(f"- {escape(m)}" for m in assessment.ai_assessment.missing_evidence_and_information),
                )
            )
        if assessment.ai_assessment.written_approval_requirements:
            missing_items.append(
                (
                    "Written Approval Requirements (Contract Evidence)",
                    "<br/>".join(
                        f"- {escape(f.statement)} [{_format_refs_inline(f.source_references)}]"
                        for f in assessment.ai_assessment.written_approval_requirements
                    ),
                )
            )
        if assessment.ai_assessment.issuer_authority_requirements:
            missing_items.append(
                (
                    "Issuer Authority Requirements (Contract Evidence)",
                    "<br/>".join(
                        f"- {escape(f.statement)} [{_format_refs_inline(f.source_references)}]"
                        for f in assessment.ai_assessment.issuer_authority_requirements
                    ),
                )
            )
    else:
        missing_items.append(("Contract & BOQ Assessment", "No contract/BOQ assessment recorded yet."))
    if est and est.missing_inputs:
        missing_items.append(
            ("Cost Build-Up Missing Inputs", "<br/>".join(f"- {escape(m)}" for m in est.missing_inputs))
        )
    elif est is None:
        missing_items.append(("Cost Build-Up", "Deterministic cost estimate has not been saved."))
    if not qs_is_confirmed:
        missing_items.append(("QS Sign-Off", f"QS review is currently '{qs.review_status.value}' (is_draft={qs.is_draft})."))
    if case.lifecycle_status not in APPROVED_OR_LATER_STATUSES:
        missing_items.append(("Client Variation Approval", f"Lifecycle status is '{case.lifecycle_status.value}'; client variation approval is outstanding."))

    if missing_items:
        story.append(_kv_table(missing_items))
    else:
        story.append(_p("No unresolved evidence gaps or pending approvals recorded.", body_style))

    # 15. Notice requirements and relevant dates (only when supported by contract evidence)
    story.append(_p("15. Notice Requirements &amp; Relevant Dates (Contract Evidence Only)", section_style))
    notice_rows: list[tuple[str, str]] = [
        (
            "Recorded Instruction Date",
            _esc(
                active_fields.communication_date.value if active_fields else None,
                "Not recorded",
            ),
        ),
        ("Formal Submission Date", _esc(case.commercial_tracking.submission_date, "Not submitted")),
        ("Recorded Payment Date", _esc(case.commercial_tracking.payment_date, "Not paid")),
    ]
    if assessment and assessment.ai_assessment.notice_requirements_and_deadlines:
        notice_html = "<br/>".join(
            f"- {escape(f.statement)}<br/><i>Source: {_format_refs_inline(f.source_references)}</i>"
            for f in assessment.ai_assessment.notice_requirements_and_deadlines
        )
        notice_rows.append(("Contract Notice Clauses", notice_html))
    else:
        notice_rows.append(
            (
                "Contract Notice Clauses",
                "<i>No contractual notice periods or time-bar clauses were retrieved from uploaded contract evidence. "
                "Verify the full executed contract before assuming notice deadlines.</i>",
            )
        )
    story.append(_kv_table(notice_rows))

    # 16. Prepared-by and review details + Commercial Lifecycle Tracking
    story.append(_p("16. Prepared-By, Review &amp; Commercial Tracking Details", section_style))
    tr = case.commercial_tracking
    story.append(
        _kv_table(
            [
                ("Report Prepared By", escape(prepared_by)),
                ("QS Reviewer", _esc(qs.reviewer_name, "Pending QS review")),
                ("Responsible Commercial Person", _esc(tr.responsible_person, "Not assigned")),
                ("Submission Reference / Recipient", f"{_esc(tr.submission_reference, 'Not submitted')} | Recipient: {_esc(tr.recipient, 'Not specified')}"),
                ("Execution Status", _esc(tr.execution_status, "Not recorded")),
                ("Invoice / Running-Bill Ref", _esc(tr.invoice_reference, "Not billed")),
                ("Billed / Paid Amounts", f"Billed: {_fmt_dec(tr.billed_amount, currency, 'Not billed')} | Paid: {_fmt_dec(tr.paid_amount, currency, 'Not paid')} ({_esc(tr.payment_status, 'Unpaid')})"),
                ("Commercial Tracking Notes", _esc(tr.notes, "None")),
            ]
        )
    )

    # 17. Document generation timestamp and audit history
    story.append(_p("17. Document Generation Timestamp &amp; Audit History", section_style))
    story.append(
        _kv_table(
            [
                ("Report ID", escape(report_id)),
                ("Generated Timestamp (UTC)", escape(generated_at_str)),
                ("Case Created / Last Updated", f"{_fmt_dt(case.created_at)} / {_fmt_dt(case.updated_at)}"),
                ("Audit Separation Guarantee", "Original instruction text, AI extraction, AI assessment, QS review edits, and lifecycle state transitions are preserved independently."),
            ]
        )
    )
    if lifecycle_history or review_history:
        story.append(Spacer(1, 3))
        audit_rows: list[list[str]] = []
        for entry in lifecycle_history:
            from_lbl = entry.from_status.value if entry.from_status else "initial"
            audit_rows.append(
                [
                    _fmt_dt(entry.changed_at),
                    "Lifecycle",
                    escape(f"{from_lbl} -> {entry.to_status.value}"),
                    escape(entry.changed_by),
                    _esc(entry.reason, "—"),
                ]
            )
        for rentry in review_history:
            audit_rows.append(
                [
                    _fmt_dt(rentry.timestamp),
                    escape(rentry.entry_type),
                    escape(rentry.review_status.value),
                    escape(rentry.reviewer_name),
                    _esc(rentry.reason, "—"),
                ]
            )
        story.append(
            _grid_table(
                ["Timestamp (UTC)", "Audit Stream", "Status / Transition", "Actor", "Reason / Summary"],
                audit_rows,
                [36 * mm, 26 * mm, 36 * mm, 28 * mm, 52 * mm],
            )
        )

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=21 * mm,
        bottomMargin=19 * mm,
        title=f"Variation Evidence Pack {var_ref}",
        author=prepared_by,
        subject=case.title,
    )
    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _EvidencePackCanvas(
            *args,
            var_ref=var_ref,
            status_label=status_label,
            is_demo=case.is_demo,
            report_id=report_id,
            generated_at_str=generated_at_str,
            **kwargs,
        ),
    )

    pdf_bytes = buffer.getvalue()
    reader = PdfReader(BytesIO(pdf_bytes))
    if len(reader.pages) < 1:
        raise ValueError("Generated PDF contains zero pages.")
    return pdf_bytes, len(reader.pages), status_label, is_draft
