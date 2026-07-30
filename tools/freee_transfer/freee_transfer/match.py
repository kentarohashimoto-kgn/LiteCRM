"""STEP 3: 請求書の請求元名称と freee 取引先マスタの名寄せ。

分類は3つだけ:
    confirmed    完全一致(正規化後)
    needs_review 類似候補あり → **人間が判断する。自動で確定へ昇格させない**
    new          freee に該当なし

「要確認」を勝手に「確定」にすると、別の取引先の口座へ送金する事故になる。
このモジュールは needs_review を出すだけで、確定は行わない。
"""

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from .freee_export import ExportSchema, detect_encoding
from .records import Record

#: 類似候補として提示する下限。これ未満は「該当なし(新規)」扱い。
SIMILARITY_THRESHOLD = 0.75

#: 一方が他方を完全に含む場合(「既存商事」と「既存商事ホールディングス」など)は
#: 類似度が低く出るが、取り違えが最も起きやすいパターンなので必ず候補に出す。
CONTAINMENT_MIN_LENGTH = 2

_LEGAL_TOKENS = (
    "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
    "一般社団法人", "公益社団法人", "一般財団法人", "公益財団法人",
    "特定非営利活動法人", "医療法人", "税理士法人", "司法書士法人",
    "(株)", "(有)", "(同)", "㈱", "㈲",
)


def normalize_partner_name(name: str) -> str:
    """比較用のキーを作る。表示には使わない。"""
    text = unicodedata.normalize("NFKC", name or "").upper()
    for token in _LEGAL_TOKENS:
        text = text.replace(unicodedata.normalize("NFKC", token), "")
    text = re.sub(r"[\s　・･,，.。\-ー―–—/／\\|｜'\"’”]", "", text)
    return text


@dataclass
class Candidate:
    partner_name: str
    similarity: float
    #: 正規化後に一方が他方を含んでいる(部分一致)
    containment: bool = False

    @property
    def reason(self) -> str:
        return "部分一致" if self.containment else f"類似度 {self.similarity:.2f}"


@dataclass
class MatchResult:
    record_id: str
    invoice_name: str
    status: str  # confirmed | needs_review | new
    partner_name: str = ""
    candidates: list[Candidate] | None = None


def load_partner_names(path: Path, schema: ExportSchema | None = None) -> list[str]:
    """freee エクスポートから取引先名の一覧を取る。"""
    path = Path(path)
    encoding = schema.encoding if schema else detect_encoding(path)
    column = None
    if schema:
        column = schema.column_map.get("partner_name")
    with path.open(encoding=encoding, newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        if column not in fieldnames:
            column = next(
                (c for c in fieldnames if "取引先名" in c or "事業所名" in c),
                fieldnames[0] if fieldnames else None,
            )
        if column is None:
            return []
        seen: list[str] = []
        for row in reader:
            value = (row.get(column) or "").strip()
            if value and value not in seen:
                seen.append(value)
    return seen


def match_one(invoice_name: str, partner_names: list[str], record_id: str = "") -> MatchResult:
    if not invoice_name:
        return MatchResult(record_id, invoice_name, "needs_review", candidates=[])

    key = normalize_partner_name(invoice_name)
    exact = [p for p in partner_names if normalize_partner_name(p) == key]
    if len(exact) == 1:
        return MatchResult(record_id, invoice_name, "confirmed", partner_name=exact[0])
    if len(exact) > 1:
        # 同名が複数 → どれか選べないので人間へ
        return MatchResult(
            record_id, invoice_name, "needs_review",
            candidates=[Candidate(p, 1.0) for p in exact],
        )

    near: list[Candidate] = []
    for partner in partner_names:
        other = normalize_partner_name(partner)
        if not other:
            continue
        similarity = SequenceMatcher(None, key, other).ratio()
        containment = (
            min(len(key), len(other)) >= CONTAINMENT_MIN_LENGTH
            and (key in other or other in key)
        )
        if similarity >= SIMILARITY_THRESHOLD or containment:
            near.append(Candidate(partner, similarity, containment))

    if near:
        near.sort(key=lambda c: (c.containment, c.similarity), reverse=True)
        return MatchResult(record_id, invoice_name, "needs_review", candidates=near[:5])
    return MatchResult(record_id, invoice_name, "new")


def match_records(records: list[Record], partner_names: list[str]) -> list[MatchResult]:
    results: list[MatchResult] = []
    for record in records:
        supplier = record.value("supplier_name")
        result = match_one(supplier, partner_names, record.record_id)
        if not supplier:
            # 名称が取れていないと名寄せ自体ができない。原本が分かる表示にしておく。
            result.invoice_name = f"(請求元名称が未確定: {record.source_file or record.record_id})"
        record.match_status = result.status
        record.match_candidates = [c.partner_name for c in (result.candidates or [])]
        # 確定は完全一致のときだけ。類似候補は絶対に紐付けない。
        record.freee_partner_name = result.partner_name if result.status == "confirmed" else ""
        results.append(result)
    return results


def write_matching_md(results: list[MatchResult], dest: Path) -> None:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    confirmed = [r for r in results if r.status == "confirmed"]
    review = [r for r in results if r.status == "needs_review"]
    new = [r for r in results if r.status == "new"]

    lines = [
        "# 名寄せ結果(STEP 3)",
        "",
        f"- [確定] {len(confirmed)}件 / [要確認] {len(review)}件 / [新規] {len(new)}件",
        "",
        "> [要確認] を人間の確認なしに [確定] へ昇格させないこと。",
        "> 別の取引先に口座を紐付けると、他社の口座へ送金される事故になる。",
        "",
        "```",
    ]
    for r in confirmed:
        lines.append(f"[確定]   {r.invoice_name} → {r.partner_name}(完全一致)")
    for r in review:
        cands = "、".join(
            f"{c.partner_name}({c.reason})" for c in (r.candidates or [])
        ) or "候補なし"
        lines.append(f"[要確認] {r.invoice_name} → {cands} ※人間の判断が必要")
    for r in new:
        lines.append(f"[新規]   {r.invoice_name}(freeeに該当なし)")
    lines += ["```", ""]
    dest.write_text("\n".join(lines) + "\n", encoding="utf-8")
