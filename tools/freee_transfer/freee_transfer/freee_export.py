"""STEP 1: freee の取引先エクスポートCSVから、インポートCSVの仕様を確定する。

このモジュールは **列名を一切発明しない**。すべてエクスポート実物のヘッダー行から取る。
口座情報の列がどれかは keyword で候補を出すが、確定は人間が `column_map.json` を
確認してから行う。
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from pathlib import Path

from .records import FIELD_LABELS

#: freee は Shift_JIS(cp932)で出力することがある。上から順に試す。
ENCODING_CANDIDATES = ("utf-8-sig", "cp932", "utf-8")

#: 論理項目 → freee 側の列名に含まれそうなキーワード(優先度順)
COLUMN_KEYWORDS: dict[str, tuple[str, ...]] = {
    "bank_name": ("銀行名", "金融機関名", "金融機関"),
    "bank_code": ("銀行コード", "金融機関コード", "銀行番号"),
    "branch_name": ("支店名", "支社名"),
    "branch_code": ("支店コード", "支店番号"),
    "account_type": ("口座種別", "預金種別", "種別"),
    "account_number": ("口座番号"),
    "account_holder_kana": ("受取人名", "口座名義", "名義"),
    "partner_name": ("取引先名", "事業所名", "名称"),
    "partner_code": ("取引先コード", "コード"),
}


class ExportReadError(RuntimeError):
    pass


def detect_encoding(path: Path) -> str:
    """freee CSV の文字コードを判定する(推測ではなく実際にデコードして確認)。"""
    raw = Path(path).read_bytes()
    for encoding in ENCODING_CANDIDATES:
        try:
            raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        return encoding
    raise ExportReadError(
        f"{path} の文字コードを判定できない({'/'.join(ENCODING_CANDIDATES)} で失敗)"
    )


@dataclass
class ExportSchema:
    """エクスポート実物から読み取った仕様。"""

    path: Path
    encoding: str
    header: list[str]
    row_count: int = 0
    #: 論理項目 → 候補列名(先頭が最有力)
    column_candidates: dict[str, list[str]] = field(default_factory=dict)
    #: 口座登録済みの行から観測した記法サンプル
    observed_values: dict[str, list[str]] = field(default_factory=dict)
    filled_account_rows: int = 0

    @property
    def column_map(self) -> dict[str, str]:
        return {k: v[0] for k, v in self.column_candidates.items() if v}

    @property
    def ambiguous(self) -> list[str]:
        """候補が複数あり、人間の確認が必要な論理項目。"""
        return sorted(k for k, v in self.column_candidates.items() if len(v) > 1)

    @property
    def missing(self) -> list[str]:
        """エクスポートに該当列が見つからなかった論理項目。"""
        return sorted(k for k, v in self.column_candidates.items() if not v)


def _match_columns(header: list[str]) -> dict[str, list[str]]:
    candidates: dict[str, list[str]] = {}
    for logical, keywords in COLUMN_KEYWORDS.items():
        keys = (keywords,) if isinstance(keywords, str) else keywords
        hits: list[str] = []
        for keyword in keys:
            for column in header:
                if keyword in column and column not in hits:
                    hits.append(column)
        candidates[logical] = hits
    return candidates


def read_export(path: Path) -> ExportSchema:
    """エクスポートCSVを読み、ヘッダーと記法サンプルを取得する。"""
    path = Path(path)
    if not path.exists():
        raise ExportReadError(f"{path} が存在しない")
    encoding = detect_encoding(path)

    with path.open(encoding=encoding, newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise ExportReadError(f"{path} が空") from exc
        rows = [row for row in reader if any(cell.strip() for cell in row)]

    schema = ExportSchema(
        path=path,
        encoding=encoding,
        header=header,
        row_count=len(rows),
        column_candidates=_match_columns(header),
    )

    # 口座が登録済みの行から、freee 実物の記法をサンプルとして採取する
    account_columns = {
        logical: cols[0]
        for logical, cols in schema.column_candidates.items()
        if cols and logical.startswith(("bank", "branch", "account"))
    }
    index = {name: header.index(name) for name in account_columns.values()}
    observed: dict[str, list[str]] = {k: [] for k in account_columns}
    for row in rows:
        values = {
            logical: (row[index[col]].strip() if index[col] < len(row) else "")
            for logical, col in account_columns.items()
        }
        if not values.get("account_number"):
            continue
        schema.filled_account_rows += 1
        for logical, value in values.items():
            if value and value not in observed[logical] and len(observed[logical]) < 10:
                observed[logical].append(value)
    schema.observed_values = observed
    return schema


def write_header_txt(schema: ExportSchema, dest: Path) -> None:
    """ヘッダー行をそのまま保存する(STEP 1-2)。CSVの唯一の正解。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8", newline="") as fh:
        csv.writer(fh).writerow(schema.header)


def write_column_map(schema: ExportSchema, dest: Path) -> None:
    """論理項目 → freee 列名の対応表を出力する。人間が確認して confirmed を true にする。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "_comment": (
            "logical→freee列名の対応。候補が複数ある項目は必ず人間が確認すること。"
            "確認したら confirmed を true にする。"
        ),
        "source_csv": str(schema.path),
        "encoding": schema.encoding,
        "confirmed": False,
        "column_map": schema.column_map,
        "alternatives": {k: v[1:] for k, v in schema.column_candidates.items() if len(v) > 1},
        "unmatched_logical_fields": schema.missing,
    }
    dest.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def write_schema_notes(schema: ExportSchema, dest: Path) -> None:
    """特定した列と記法を記録する(STEP 1-5)。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = [
        "# freee 取引先CSV スキーマメモ(STEP 1)",
        "",
        f"- 出典: `{schema.path}`",
        f"- 文字コード: `{schema.encoding}`(インポートCSVもこれに合わせる)",
        f"- 列数: {len(schema.header)}",
        f"- データ行数: {schema.row_count}",
        f"- うち口座番号が入っている行: {schema.filled_account_rows}",
        "",
        "## ヘッダー行(実物)",
        "",
        "```",
        ",".join(schema.header),
        "```",
        "",
        "## 口座情報に該当する列の候補",
        "",
        "| 論理項目 | 採用した列名 | 他の候補 |",
        "|---|---|---|",
    ]
    for logical, cols in schema.column_candidates.items():
        label = FIELD_LABELS.get(logical, logical)
        chosen = f"`{cols[0]}`" if cols else "**該当なし**"
        others = "、".join(f"`{c}`" for c in cols[1:]) or "-"
        lines.append(f"| {label}(`{logical}`) | {chosen} | {others} |")

    lines += ["", "## 既存行から観測した記法サンプル", ""]
    if schema.filled_account_rows == 0:
        lines.append(
            "口座が登録済みの行が0件のため、記法サンプルを採取できなかった。"
            "**freee の取引先画面で1件だけ手入力し、再エクスポートして本STEPをやり直すこと。**"
            "(口座種別が「普通」なのか「1」なのか、カナが半角か全角かを実物で確認する必要がある)"
        )
    else:
        for logical, values in schema.observed_values.items():
            if not values:
                continue
            label = FIELD_LABELS.get(logical, logical)
            sample = "、".join(f"`{v}`" for v in values)
            lines.append(f"- **{label}**: {sample}")

    if schema.ambiguous or schema.missing:
        lines += ["", "## 人間の確認が必要な点", ""]
        for logical in schema.ambiguous:
            lines.append(
                f"- `{logical}` は候補が複数あり自動確定できない: "
                + "、".join(f"`{c}`" for c in schema.column_candidates[logical])
            )
        for logical in schema.missing:
            lines.append(
                f"- `{logical}` に対応する列がエクスポートに見つからない。"
                "freee側の項目名を確認すること"
            )

    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_header(path: Path) -> list[str]:
    """work/header.txt を読み戻す。CSV生成時のヘッダーはここからのみ取る。"""
    with Path(path).open(encoding="utf-8", newline="") as fh:
        return next(csv.reader(fh))
