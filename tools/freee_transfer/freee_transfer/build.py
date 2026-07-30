"""STEP 6: 成果物(freee_import.csv / review.md / summary.md)を出力する。

CSVのヘッダーは `work/header.txt`(= STEP 1 でエクスポートした実物)からのみ取る。
このモジュールは列名を1つも生成しない。
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .kana import normalize_kana
from .records import FIELD_LABELS, Record
from .validate import BLOCKER, Issue, partition


@dataclass
class ColumnMap:
    column_map: dict[str, str]
    encoding: str = "utf-8-sig"
    confirmed: bool = False
    #: freee 側の記法へ変換する値マップ(例: 口座種別 普通→1)
    value_maps: dict[str, dict[str, str]] | None = None

    @classmethod
    def load(cls, path: Path) -> "ColumnMap":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            column_map=data.get("column_map") or {},
            encoding=data.get("encoding") or "utf-8-sig",
            confirmed=bool(data.get("confirmed")),
            value_maps=data.get("value_maps") or {},
        )

    def apply_value_map(self, logical: str, value: str) -> tuple[str, str | None]:
        """値をfreeeの記法へ変換する。変換できなければ理由を返す。"""
        table = (self.value_maps or {}).get(logical)
        if not table:
            return value, None
        if value in table:
            return table[value], None
        return value, (
            f"{FIELD_LABELS.get(logical, logical)}の値 {value!r} が "
            "column_map.json の value_maps に定義されていない"
        )


def build_row(
    record: Record, header: list[str], mapping: ColumnMap
) -> tuple[dict[str, str], list[str]]:
    """1レコードをCSVの1行へ変換する。空欄はそのまま空欄で出す(推測しない)。"""
    row = {column: "" for column in header}
    problems: list[str] = []

    def put(logical: str, value: str) -> None:
        column = mapping.column_map.get(logical)
        if not column:
            problems.append(f"{logical} に対応する freee の列が未確定")
            return
        if column not in row:
            problems.append(f"列 {column!r} がヘッダーに存在しない")
            return
        row[column] = value

    put("partner_name", record.freee_partner_name or record.value("supplier_name"))

    for logical in ("bank_name", "bank_code", "branch_name", "branch_code", "account_number"):
        value = record.value(logical)
        if value:
            put(logical, value)

    account_type, problem = mapping.apply_value_map("account_type", record.value("account_type"))
    if problem:
        problems.append(problem)
    if account_type:
        put("account_type", account_type)

    kana = normalize_kana(record.value("account_holder_kana"))
    if kana.normalized:
        if not kana.is_clean:
            problems.append("口座名義カナが全銀フォーマットを満たしていない")
        put("account_holder_kana", kana.normalized)

    return row, problems


def write_import_csv(
    records: list[Record], header: list[str], mapping: ColumnMap, dest: Path
) -> tuple[int, dict[str, list[str]]]:
    """インポート可能な行だけを書き出す。1つでも問題がある行は書かない。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, str]] = []
    rejected: dict[str, list[str]] = {}
    for record in records:
        row, problems = build_row(record, header, mapping)
        if problems:
            rejected[record.record_id] = problems
            continue
        rows.append(row)

    # 口座番号の先頭ゼロを守るため、数値型は一切経由せず文字列のまま書く
    with dest.open("w", encoding=mapping.encoding, newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows), rejected


def write_review_md(
    records: list[Record],
    issues_by_record: dict[str, list[Issue]],
    rejected: dict[str, list[str]],
    dest: Path,
) -> int:
    """要確認リスト。1件ごとに「何が問題か」「原本のどこを見ればよいか」を書く。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    by_id = {r.record_id: r for r in records}

    target_ids = [
        rid for rid in {**issues_by_record, **rejected}
        if any(i.severity == BLOCKER for i in issues_by_record.get(rid, []))
        or rid in rejected
        or issues_by_record.get(rid)
    ]
    target_ids.sort()

    lines = [
        "# 要確認リスト(review.md)",
        "",
        f"要確認: {len(target_ids)}件",
        "",
        "各項目は原本を目視で確認し、`work/extracted.json` の該当フィールドを修正のうえ",
        "`confidence` を `high` にしてから再実行すること。推測で埋めないこと。",
        "",
    ]
    for rid in target_ids:
        record = by_id.get(rid)
        title = record.display_name if record else rid
        lines += [f"## {rid} {title}", ""]
        if record and record.source_file:
            lines.append(f"- 原本: `{record.source_file}`")
        if record and record.match_status != "confirmed":
            status = {"needs_review": "要確認", "new": "新規", "unmatched": "未実施"}
            lines.append(
                f"- 名寄せ: {status.get(record.match_status, record.match_status)}"
                + (f"(候補: {'、'.join(record.match_candidates)})" if record.match_candidates else "")
            )
        lines.append("")
        for issue in issues_by_record.get(rid, []):
            ref = f" — 参照: `{issue.source_ref}`" if issue.source_ref else ""
            mark = "❌" if issue.severity == BLOCKER else "⚠️"
            label = f"[{issue.field_label}] " if issue.field_name else ""
            lines.append(f"- {mark} {label}{issue.message}{ref}")
        for problem in rejected.get(rid, []):
            lines.append(f"- ❌ {problem}")
        lines.append("")

    if not target_ids:
        lines.append("要確認の項目はありません。")
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(target_ids)


def write_summary_md(
    dest: Path,
    total: int,
    confirmed: int,
    review: int,
    input_files: int,
    notes: list[str],
) -> None:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# サマリ(summary.md)",
        "",
        "| 項目 | 件数 |",
        "|---|---|",
        f"| 入力請求書ファイル | {input_files} |",
        f"| 抽出レコード | {total} |",
        f"| 確定(CSVへ出力) | {confirmed} |",
        f"| 要確認(review.md) | {review} |",
        "",
        "## 検出した論点",
        "",
    ]
    lines += [f"- {n}" for n in notes] or ["- なし"]
    lines += [
        "",
        "## 次の作業",
        "",
        "1. `output/review.md` を上から潰す(原本を見て `work/extracted.json` を修正)",
        "2. `output/freee_import.csv` を目視レビュー",
        "3. freee の取引先マスタへインポート(人間が実施)",
        "",
    ]
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
