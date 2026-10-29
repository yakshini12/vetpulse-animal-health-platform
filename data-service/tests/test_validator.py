"""Unit tests for vetpulse_csv.validator.

All dates are relative to today's date so the suite never depends on the wall clock
for FUTURE_DATE tests.
"""

from __future__ import annotations

import datetime
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vetpulse_csv.validator import validate_rows  # noqa: E402

TODAY = datetime.date.today()
ISO = TODAY.isoformat()  # a date that is never "in the future"
YESTERDAY = (TODAY - datetime.timedelta(days=1)).isoformat()
YESTERYEAR = (TODAY - datetime.timedelta(days=800)).isoformat()

VALID_ROW = {
    "sample_code": "SP-2026-1001",
    "case_number": "CASE-2026-0001",
    "sample_type": "BLOOD",
    "collection_date": YESTERDAY,
    "status": "RECEIVED",
    "lab_location": "Zone-1 diagnostics lab",
    "received_date": YESTERDAY,
}


def row(**overrides):
    data = {column: "" for column in VALID_ROW}
    data.update(VALID_ROW)
    data.update(overrides)
    return data


def run_validator(rows):
    return validate_rows(list(enumerate(rows, start=2)), TODAY)


class ValidatorTests(unittest.TestCase):
    def test_valid_row_passes(self):
        report = run_validator([row()])
        self.assertEqual(report["summary"], {"totalRows": 1, "valid": 1, "rejected": 0, "duplicates": 0})
        self.assertEqual(report["rows"][0]["outcome"], "VALID")

    def test_missing_required_field_is_rejected(self):
        bad = row()
        bad["sample_code"] = ""
        report = run_validator([bad])
        row_report = report["rows"][0]
        self.assertEqual(row_report["outcome"], "REJECTED")
        codes = {error["code"] for error in row_report["errors"]}
        fields = {error["field"] for error in row_report["errors"]}
        self.assertIn("REQUIRED", codes)
        self.assertIn("sample_code", fields)

    def test_sample_code_format_enforced(self):
        report = run_validator([row(sample_code="sp-26-1")])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("FORMAT", codes)

    def test_unsupported_sample_type_is_rejected(self):
        report = run_validator([row(sample_type="SALIVA")])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("VALUE", codes)

    def test_future_collection_date_is_rejected(self):
        future = (TODAY + datetime.timedelta(days=3)).isoformat()
        report = run_validator([row(collection_date=future)])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("FUTURE_DATE", codes)

    def test_unparseable_date_is_rejected(self):
        report = run_validator([row(collection_date="15/10/2026")])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("DATE", codes)

    def test_completed_requires_completed_date(self):
        report = run_validator([row(status="COMPLETED", completed_date="")])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("RULE", codes)

    def test_rejection_requires_reason_and_date(self):
        report = run_validator([row(status="REJECTED")])
        codes = {(error["code"], error["field"]) for error in report["rows"][0]["errors"]}
        self.assertIn(("RULE", "rejected_date"), codes)
        self.assertIn(("REQUIRED", "rejection_reason"), codes)

    def test_chronology_violation_is_rejected(self):
        # completed_date earlier than processing start
        report = run_validator(
            [
                row(
                    status="COMPLETED",
                    processing_started_date=ISO,
                    completed_date=YESTERDAY,
                )
            ]
        )
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("CHRONOLOGY", codes)

    def test_completed_and_rejected_conflict(self):
        report = run_validator(
            [
                row(
                    status="REJECTED",
                    processing_started_date=YESTERYEAR,
                    completed_date=YESTERDAY,
                    rejected_date=ISO,
                    rejection_reason="damaged container",
                )
            ]
        )
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("CONFLICT", codes)

    def test_released_result_requires_completed_status_and_summary(self):
        report = run_validator([row(result_status="RELEASED")])
        errors = report["rows"][0]["errors"]
        codes = {error["code"] for error in errors}
        fields = {error["field"] for error in errors}
        self.assertIn("RULE", codes)
        self.assertIn("result_summary", fields)

    def test_pending_result_requires_review_state(self):
        report = run_validator([row(result_status="PENDING")])
        codes = {error["code"] for error in report["rows"][0]["errors"]}
        self.assertIn("RULE", codes)

    def test_duplicate_in_file(self):
        report = run_validator([row(), row()])
        self.assertEqual(report["summary"], {"totalRows": 2, "valid": 1, "rejected": 0, "duplicates": 1})
        self.assertEqual(report["rows"][0]["outcome"], "VALID")
        self.assertEqual(report["rows"][1]["outcome"], "DUPLICATE")
        self.assertEqual(report["rows"][1]["errors"][0]["code"], "DUPLICATE_IN_FILE")

    def test_row_numbers_reflect_file_position(self):
        report = run_validator([row(), row(sample_code="SP-2026-1002")])
        self.assertEqual([entry["row"] for entry in report["rows"]], [2, 3])


class CliTests(unittest.TestCase):
    FILE_NAME = None

    def run_cli(self, content: str):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="") as handle:
            handle.write(content)
            path = handle.name
        self.addCleanup(os.remove, path)
        env = dict(os.environ)
        result = subprocess.run(
            [sys.executable, "-m", "vetpulse_csv.cli", "--file", path],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            env=env,
        )
        return result

    def test_cli_reports_valid_file(self):
        data_row = ",".join(VALID_ROW.values())
        csv_text = f"{','.join(VALID_ROW)}\n{data_row}\n"
        result = self.run_cli(csv_text)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        import json

        payload = json.loads(result.stdout)
        self.assertEqual(payload["summary"]["valid"], 1)
        self.assertEqual(payload["rows"][0]["sampleCode"], VALID_ROW["sample_code"])

    def test_cli_rejects_unknown_column(self):
        data_row = ",".join(VALID_ROW.values()) + ",extra"
        header = ",".join(VALID_ROW) + ",spurious_column"
        result = self.run_cli(f"{header}\n{data_row}\n")
        self.assertEqual(result.returncode, 2)
        import json

        payload = json.loads(result.stdout)
        self.assertIn("unsupported columns", payload["error"])

    def test_cli_rejects_ragged_row(self):
        header = ",".join(VALID_ROW)
        short_row = ",".join(list(VALID_ROW.values())[:-1])
        result = self.run_cli(f"{header}\n{short_row}\n")
        self.assertEqual(result.returncode, 2)
        import json

        payload = json.loads(result.stdout)
        self.assertIn("columns", payload["error"])

    def test_cli_rejects_empty_file(self):
        result = self.run_cli("")
        self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
