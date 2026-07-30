"""抽出レコードのデータ構造と入出力(work/extracted.json)。

指示書 STEP 2 の要求どおり、各値に `source_file` / `source_page` / `confidence` を
必ず持たせる。値だけの生データは扱わない(検算のとき原本へ戻れなくなるため)。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

Confidence = str  # "high" | "medium" | "low"
CONFIDENCE_LEVELS = ("high", "medium", "low")

#: 論理項目名 → 日本語ラベル(指示書 STEP 2 の表と対応)
FIELD_LABELS: dict[str, str] = {
    "supplier_name": "請求元名称",
    "bank_name": "金融機関名",
    "bank_code": "金融機関コード",
    "branch_name": "支店名",
    "branch_code": "支店コード",
    "account_type": "口座種別",
    "account_number": "口座番号",
    "account_holder_kana": "口座名義(カナ)",
    "account_holder_kanji": "口座名義(漢字)",
    "transfer_fee_bearer": "振込手数料の負担",
    "withholding_tax": "源泉徴収の有無",
}

#: 欠けていたらCSVに載せてはいけない項目(指示書 STEP 5)
REQUIRED_FIELDS: tuple[str, ...] = (
    "supplier_name",
    "bank_name",
    "branch_name",
    "account_type",
    "account_number",
    "account_holder_kana",
)


@dataclass
class Field:
    """1項目の値と、その根拠。"""

    value: str = ""
    source_file: str = ""
    source_page: int | None = None
    confidence: Confidence = "low"
    note: str = ""

    @property
    def is_empty(self) -> bool:
        return not self.value.strip()

    @property
    def source_ref(self) -> str:
        """review.md に載せる原本参照(ファイル名・ページ)。"""
        if not self.source_file:
            return "(出典不明)"
        if self.source_page is None:
            return self.source_file
        return f"{self.source_file} p.{self.source_page}"

    def to_dict(self) -> dict:
        return {
            "value": self.value,
            "source_file": self.source_file,
            "source_page": self.source_page,
            "confidence": self.confidence,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, data: dict | str | None) -> "Field":
        if data is None:
            return cls()
        if isinstance(data, str):
            # 値だけ書かれていた場合も落とさず読む(根拠なしとして扱う)
            return cls(value=data, confidence="low", note="根拠情報なしで入力された")
        page = data.get("source_page")
        return cls(
            value=str(data.get("value") or ""),
            source_file=str(data.get("source_file") or ""),
            source_page=int(page) if isinstance(page, (int, str)) and str(page).isdigit() else None,
            confidence=str(data.get("confidence") or "low"),
            note=str(data.get("note") or ""),
        )


@dataclass
class Record:
    """請求書1件から抽出した振込先口座情報。"""

    record_id: str
    source_file: str = ""
    fields: dict[str, Field] = field(default_factory=dict)
    #: STEP 3 の名寄せ結果: "confirmed" | "needs_review" | "new" | "unmatched"
    match_status: str = "unmatched"
    #: 紐付け先の freee 取引先名(confirmed のときのみ確定値)
    freee_partner_name: str = ""
    match_candidates: list[str] = field(default_factory=list)

    def get(self, name: str) -> Field:
        return self.fields.get(name, Field())

    def value(self, name: str) -> str:
        return self.get(name).value.strip()

    @property
    def display_name(self) -> str:
        return self.value("supplier_name") or self.source_file or self.record_id

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "source_file": self.source_file,
            "match_status": self.match_status,
            "freee_partner_name": self.freee_partner_name,
            "match_candidates": list(self.match_candidates),
            "fields": {k: v.to_dict() for k, v in self.fields.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Record":
        return cls(
            record_id=str(data.get("record_id") or ""),
            source_file=str(data.get("source_file") or ""),
            match_status=str(data.get("match_status") or "unmatched"),
            freee_partner_name=str(data.get("freee_partner_name") or ""),
            match_candidates=list(data.get("match_candidates") or []),
            fields={
                k: Field.from_dict(v) for k, v in (data.get("fields") or {}).items()
            },
        )


def load_records(path: Path) -> list[Record]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = payload["records"] if isinstance(payload, dict) else payload
    return [Record.from_dict(row) for row in rows]


def save_records(path: Path, records: list[Record], meta: dict | None = None) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": meta or {},
        "records": [r.to_dict() for r in records],
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
