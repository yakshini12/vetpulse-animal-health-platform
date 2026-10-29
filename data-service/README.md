# VetPulse data-service

The `vetpulse_csv` package is the **row-level CSV validator** used by the
VetPulse import workflow. It is deliberately database-free: it parses a CSV
file, validates every row against the documented schema, and prints a single
JSON report. The Node backend adds *database-level* checks (case references,
existing sample codes) and performs the transactional import.

## Responsibilities (contract)

| Concern                          | Owner            |
| -------------------------------- | ---------------- |
| CSV parsing, encoding, size      | Python           |
| Required fields and formats      | Python           |
| Enum values, date parsing        | Python           |
| Date chronology within a row     | Python           |
| Duplicate sample codes in a file | Python           |
| Case references exist            | Node (PostgreSQL)|
| Sample code already in DB        | Node (PostgreSQL)|
| Transactional insert + audit     | Node (PostgreSQL)|

## Invocation

```bash
python -m vetpulse_csv.cli --file path/to/file.csv [--max-rows 5000] [--chart report.png]
```

- exit code `0` → JSON `ValidationReport` on stdout
- exit code `2` → structured `{"error": "..."}` on stdout (unreadable file/schema)
- any other code → internal error, details on stderr

## CSV schema

Header row is required; the column names below are checked exactly and extra
or missing columns are rejected (exit code 2):

| Column                     | Required | Rules |
| -------------------------- | -------- | ----- |
| `sample_code`              | yes      | `SP-YYYY-NNNN` (exact format) |
| `case_number`              | yes      | `CASE-YYYY-NNNN` (existence is checked by the Node service) |
| `sample_type`              | yes      | one of BLOOD, SWAB, TISSUE, URINE, FECAL, MILK, OTHER |
| `collection_date`          | yes      | `YYYY-MM-DD`, not in the future |
| `status`                   | yes      | one of RECEIVED, IN_PROCESS, IN_REVIEW, COMPLETED, REJECTED |
| `lab_location`             | yes      | free text, 2–80 chars |
| `received_date`            | yes      | `YYYY-MM-DD`, not in the future |
| `processing_started_date`  | no       | ≥ received_date, not in the future |
| `completed_date`           | no       | required when status=COMPLETED; ≥ processing_started_date |
| `rejected_date`            | no       | required when status=REJECTED; ≥ processing_started_date |
| `rejection_reason`         | no       | required when status=REJECTED; forbidden when status=COMPLETED |
| `result_status`            | no       | NOT_AVAILABLE (default), PENDING, RELEASED |
| `result_summary`           | no       | required when result_status=RELEASED; forbidden when NOT_AVAILABLE |
| `notes`                    | no       | free text |

Row-level error codes reported per field: `REQUIRED`, `FORMAT`, `VALUE`,
`DATE`, `FUTURE_DATE`, `CHRONOLOGY`, `CONFLICT`, `RULE`.

Duplicate handling inside one file: the first row with a `sample_code` keeps
its earlier outcome; any further row with the same code becomes `DUPLICATE`.
Rows whose `sample_code` already exists in the database are marked
`DUPLICATE` by the Node layer (safe re-import: nothing is overwritten).

## Report format

```json
{
  "fileName": "import.csv",
  "summary": {"totalRows": 12, "valid": 9, "rejected": 2, "duplicates": 1},
  "rows": [
    {
      "row": 3,
      "sampleCode": "SP-2026-0003",
      "caseNumber": "CASE-2026-0001",
      "outcome": "REJECTED",
      "errors": [{"field": "result_status", "code": "RULE", "message": "RELEASED results require sample status COMPLETED."}],
      "data": {"sample_code": "SP-2026-0003", "...": "..."}
    }
  ]
}
```

## Optional report chart

`--chart out.png` renders a small Matplotlib bar chart (valid / rejected /
duplicate rows) that teams can attach to ticket updates. It is optional and
Matplotlib is only imported when the flag is present.

## Tests

```bash
python -m unittest discover -s tests -v
```
