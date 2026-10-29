"""Row-level CSV validation for VetPulse imports. Database-free by design."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

SAMPLE_CODE_RE = re.compile(r"^SP-\d{4}-\d{4}$")
CASE_NUMBER_RE = re.compile(r"^CASE-\d{4}-\d{4}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

REQUIRED_COLUMNS = (
    "sample_code",
    "case_number",
    "sample_type",
    "collection_date",
    "status",
    "lab_location",
    "received_date",
)
OPTIONAL_COLUMNS = (
    "processing_started_date",
    "completed_date",
    "rejected_date",
    "rejection_reason",
    "result_status",
    "result_summary",
    "notes",
)
COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS

SAMPLE_TYPES = {"BLOOD", "SWAB", "TISSUE", "URINE", "FECAL", "MILK", "OTHER"}
SAMPLE_STATUSES = {"RECEIVED", "IN_PROCESS", "IN_REVIEW", "COMPLETED", "REJECTED"}
RESULT_STATUSES = {"NOT_AVAILABLE", "PENDING", "RELEASED"}


def _parse_date(value: str) -> str | None:
    """Returns a normalised YYYY-MM-DD string, or None when not a valid date."""
    if not value:
        return None
    if not DATE_RE.match(value):
        return None
    import datetime

    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _validate_cell(name: str, raw: str, today) -> List[Dict[str, str]]:
    """Field-level validation for one column. Returns a list of errors."""
    errors: List[Dict[str, str]] = []

    def err(code: str, message: str) -> None:
        errors.append({"field": name, "code": code, "message": message})

    if name in REQUIRED_COLUMNS and raw.strip() == "":
        err("REQUIRED", f"{name} is required.")
        return errors
    if raw.strip() == "":
        return errors

    value = raw.strip()
    if name == "sample_code" and not SAMPLE_CODE_RE.match(value):
        err("FORMAT", "sample_code must match SP-YYYY-NNNN, e.g. SP-2026-0007.")
    elif name == "case_number" and not CASE_NUMBER_RE.match(value):
        err("FORMAT", "case_number must match CASE-YYYY-NNNN, e.g. CASE-2026-0012.")
    elif name == "sample_type" and value not in SAMPLE_TYPES:
        err("VALUE", f"sample_type must be one of {', '.join(sorted(SAMPLE_TYPES))}.")
    elif name == "status" and value not in SAMPLE_STATUSES:
        err("VALUE", f"status must be one of {', '.join(sorted(SAMPLE_STATUSES))}.")
    elif name == "result_status" and value not in RESULT_STATUSES:
        err("VALUE", f"result_status must be one of {', '.join(sorted(RESULT_STATUSES))}.")
    elif name.endswith("_date"):
        if _parse_date(value) is None:
            err("DATE", f"{name} must be a calendar date in YYYY-MM-DD format.")
        elif _parse_date(value) > today.isoformat():
            err("FUTURE_DATE", f"{name} must not be in the future.")

    if name == "lab_location" and not 2 <= len(value) <= 80:
        err("FORMAT", "lab_location must be 2-80 characters.")
    return errors


def validate_rows(rows: List[Tuple[int, Dict[str, str]]], today) -> Dict[str, Any]:
    """Validates (row_number, data) pairs and returns the JSON report dict."""
    validated: List[Dict[str, Any]] = []
    seen_codes: Dict[str, int] = {}

    for row_number, data in rows:
        errors: List[Dict[str, str]] = []
        for column in COLUMNS:
            errors.extend(_validate_cell(column, data.get(column, ""), today))

        sample_code = data.get("sample_code", "").strip()
        status = data.get("status", "").strip()
        if sample_code and SAMPLE_CODE_RE.match(sample_code) and sample_code in seen_codes:
            validated.append(
                {
                    "row": row_number,
                    "sampleCode": sample_code,
                    "caseNumber": data.get("case_number", ""),
                    "outcome": "DUPLICATE",
                    "errors": [
                        {
                            "field": "sample_code",
                            "code": "DUPLICATE_IN_FILE",
                            "message": f"Row {seen_codes[sample_code]} already used \"{sample_code}\" in this file. Only the first row would be imported; this row is skipped.",
                        }
                    ],
                    "data": data,
                }
            )
            continue
        if sample_code:
            seen_codes[sample_code] = row_number

        received = _parse_date(data.get("received_date", ""))
        processing = _parse_date(data.get("processing_started_date", ""))
        completed = _parse_date(data.get("completed_date", ""))
        rejected = _parse_date(data.get("rejected_date", ""))
        result_status = (data.get("result_status", "") or "NOT_AVAILABLE").strip()

        def chrono(field: str, before: str | None, after: str | None) -> None:
            if before and after and after < before:
                errors.append(
                    {
                        "field": field,
                        "code": "CHRONOLOGY",
                        "message": f"{field} ({after}) must not be earlier than the previous milestone ({before}).",
                    }
                )

        chrono("processing_started_date", received, processing)
        chrono("completed_date", processing, completed)
        chrono("completed_date", received, completed)
        chrono("rejected_date", processing, rejected)
        chrono("rejected_date", received, rejected)

        if completed and rejected:
            errors.append(
                {
                    "field": "completed_date",
                    "code": "CONFLICT",
                    "message": "A sample cannot have both a completed_date and a rejected_date.",
                }
            )
        if status == "COMPLETED" and not completed:
            errors.append({"field": "completed_date", "code": "RULE", "message": "status COMPLETED requires a completed_date."})
        if status == "REJECTED":
            if not rejected:
                errors.append({"field": "rejected_date", "code": "RULE", "message": "status REJECTED requires a rejected_date."})
            if not data.get("rejection_reason", "").strip():
                errors.append({"field": "rejection_reason", "code": "REQUIRED", "message": "status REJECTED requires a rejection_reason."})
        if completed and status != "COMPLETED":
            errors.append({"field": "status", "code": "RULE", "message": "A row with completed_date must have status COMPLETED."})
        if rejected and status != "REJECTED":
            errors.append({"field": "status", "code": "RULE", "message": "A row with rejected_date must have status REJECTED."})
        if processing and not received:
            pass  # received_date is required; the missing-field error already exists.

        if result_status not in RESULT_STATUSES and result_status != "":
            errors.append({"field": "result_status", "code": "VALUE", "message": f"result_status must be one of {', '.join(sorted(RESULT_STATUSES))}."})
        if result_status == "RELEASED" and status != "COMPLETED":
            errors.append({"field": "result_status", "code": "RULE", "message": "RELEASED results require sample status COMPLETED."})
        if result_status == "RELEASED" and not data.get("result_summary", "").strip():
            errors.append({"field": "result_summary", "code": "REQUIRED", "message": "RELEASED results require a result_summary."})
        if result_status == "NOT_AVAILABLE" and data.get("result_summary", "").strip():
            errors.append({"field": "result_summary", "code": "CONFLICT", "message": "result_summary cannot be set while result_status is NOT_AVAILABLE."})
        if result_status == "PENDING" and status not in ("IN_REVIEW", "COMPLETED"):
            errors.append({"field": "result_status", "code": "RULE", "message": "PENDING results require sample status IN_REVIEW or COMPLETED."})

        validated.append(
            {
                "row": row_number,
                "sampleCode": sample_code,
                "caseNumber": data.get("case_number", ""),
                "outcome": "REJECTED" if errors else "VALID",
                "errors": errors,
                "data": data,
            }
        )

    summary = {
        "totalRows": len(validated),
        "valid": sum(1 for row in validated if row["outcome"] == "VALID"),
        "rejected": sum(1 for row in validated if row["outcome"] == "REJECTED"),
        "duplicates": sum(1 for row in validated if row["outcome"] == "DUPLICATE"),
    }
    return {"fileName": "", "summary": summary, "rows": validated}
