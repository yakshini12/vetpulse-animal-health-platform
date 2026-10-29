"""CLI entry point for the VetPulse CSV row validator."""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import sys
from typing import Dict, List, Tuple

from .validator import COLUMNS, REQUIRED_COLUMNS, validate_rows


def read_rows(path: str, max_rows: int) -> List[Tuple[int, Dict[str, str]]]:
    """Reads the CSV with an accurate 1-based row number (header is row 1)."""
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError("The CSV file is empty (no header row found).")
        header = [column.strip() for column in header]
        missing = [column for column in REQUIRED_COLUMNS if column not in header]
        if missing:
            raise ValueError(f"CSV header is missing required columns: {', '.join(missing)}")
        unknown = [column for column in header if column not in COLUMNS]
        if unknown:
            raise ValueError(f"CSV header contains unsupported columns: {', '.join(unknown)}. Expected columns: {', '.join(COLUMNS)}")

        rows: List[Tuple[int, Dict[str, str]]] = []
        for row_number, values in enumerate(reader, start=2):
            if len(rows) >= max_rows:
                break
            if all(value.strip() == "" for value in values):
                continue  # blank trailing lines are ignored entirely
            if len(values) != len(header):
                raise ValueError(f"Row {row_number} has {len(values)} values but the header has {len(header)} columns.")
            data = dict(zip(header, (value.strip() for value in values)))
            rows.append((row_number, data))
        if not rows:
            raise ValueError("The CSV file contains no data rows.")
        return rows


def build_chart(report: dict, output_path: str) -> None:
    """Optional Matplotlib summary chart. Imported only when requested."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    summary = report["summary"]
    labels = ["Valid", "Rejected", "Duplicate"]
    values = [summary["valid"], summary["rejected"], summary["duplicates"]]
    fig, axis = plt.subplots(figsize=(5, 3), dpi=150)
    axis.bar(labels, values, color=["#2e7d32", "#c62828", "#f9a825"])
    axis.set_title(f"CSV validation: {summary['totalRows']} rows")
    axis.set_ylabel("Rows")
    for index, value in enumerate(values):
        axis.text(index, value, str(value), ha="center", va="bottom", fontsize=9)
    fig.tight_layout()
    fig.savefig(output_path)


def main() -> int:
    parser = argparse.ArgumentParser(prog="vetpulse_csv", description="Row-level CSV validation for VetPulse imports.")
    parser.add_argument("--file", required=True, help="Path to the CSV file")
    parser.add_argument("--max-rows", type=int, default=5000, help="Maximum number of data rows")
    parser.add_argument("--chart", type=str, default=None, help="Optional output PNG path for a summary chart")
    args = parser.parse_args()

    try:
        rows = read_rows(args.file, args.max_rows)
    except (OSError, ValueError, UnicodeDecodeError, csv.Error) as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    today = datetime.date.today()
    report = validate_rows(rows, today)
    report["fileName"] = args.file.split("/")[-1].split("\\")[-1]

    if args.chart:
        try:
            build_chart(report, args.chart)
            report["chart"] = args.chart
        except OSError as exc:
            report["chartError"] = str(exc)

    json.dump(report, sys.stdout, indent=indent_for(sys.stdout.isatty()))
    print("")
    return 0


def indent_for(is_tty: bool) -> int | None:
    return 2 if is_tty else None


if __name__ == "__main__":
    raise SystemExit(main())
