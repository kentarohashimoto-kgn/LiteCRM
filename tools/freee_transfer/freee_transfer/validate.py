"""バリデーション(指示書 STEP 5)。

1件でも引っかかった行は **CSVに載せず要確認へ回す**。
「埋まっているが間違っている」より「空欄で要確認」の方が良い成果物、という原則に従う。
"""

from __future__ import annotations

from dataclasses import dataclass

from .kana import MAX_KANA_LENGTH, normalize_kana
from .records import FIELD_LABELS, REQUIRED_FIELDS, Record

BLOCKER = "blocker"  # CSVに載せてはいけない
WARNING = "warning"  # 載せてよいが人間の目視を推奨


@dataclass
class Issue:
    record_id: str
    field_name: str
    code: str
    severity: str
    message: str
    source_ref: str = ""

    @property
    def field_label(self) -> str:
        return FIELD_LABELS.get(self.field_name, self.field_name)


def _issue(record: Record, field_name: str, code: str, severity: str, message: str) -> Issue:
    return Issue(
        record_id=record.record_id,
        field_name=field_name,
        code=code,
        severity=severity,
        message=message,
        source_ref=record.get(field_name).source_ref if field_name else record.source_file,
    )


def validate_record(record: Record) -> list[Issue]:
    """1レコードを検証して、検出した論点を返す。"""
    issues: list[Issue] = []

    # --- 必須項目の欠損 ---------------------------------------------------
    for name in REQUIRED_FIELDS:
        if record.get(name).is_empty:
            issues.append(
                _issue(record, name, "missing_required", BLOCKER,
                       f"必須項目「{FIELD_LABELS[name]}」が空欄")
            )

    # --- 口座番号 ---------------------------------------------------------
    account_number = record.value("account_number")
    if account_number and not account_number.isdigit():
        issues.append(
            _issue(record, "account_number", "account_number_not_digits", BLOCKER,
                   f"口座番号に数字以外が含まれる: {account_number!r}")
        )

    # --- 口座種別 ---------------------------------------------------------
    account_type = record.value("account_type")
    if account_type and account_type not in ("普通", "当座", "貯蓄"):
        issues.append(
            _issue(record, "account_type", "account_type_unknown", WARNING,
                   f"口座種別が想定外の表記: {account_type!r}(freee側の記法へ要変換)")
        )

    # --- 口座名義カナ -----------------------------------------------------
    kana_field = record.get("account_holder_kana")
    if not kana_field.is_empty:
        result = normalize_kana(kana_field.value)
        if result.invalid_chars:
            issues.append(
                _issue(record, "account_holder_kana", "kana_invalid_chars", BLOCKER,
                       "全銀フォーマットで使用できない文字: "
                       + " ".join(repr(c) for c in result.invalid_chars))
            )
        if result.length > MAX_KANA_LENGTH:
            issues.append(
                _issue(record, "account_holder_kana", "kana_too_long", BLOCKER,
                       f"口座名義カナが{result.length}文字("
                       f"上限{MAX_KANA_LENGTH}文字)。PayPay銀行WEB総振へアップロード不可")
            )
        for note in result.notes:
            if note.startswith(("ひらがな", "連続する空白")):
                issues.append(
                    _issue(record, "account_holder_kana", "kana_normalized", WARNING, note)
                )

    # --- コード桁数(値がある場合のみ) -------------------------------------
    for name, digits in (("bank_code", 4), ("branch_code", 3)):
        value = record.value(name)
        if not value:
            continue
        if not value.isdigit() or len(value) != digits:
            issues.append(
                _issue(record, name, f"{name}_format", BLOCKER,
                       f"{FIELD_LABELS[name]}が{digits}桁の数字ではない: {value!r}")
            )

    # --- 目視確認していない値はCSVへ載せない -------------------------------
    # 自動抽出(正規表現)は confidence を high にしない。high は原本を目視した人間/
    # エージェントだけが付けられる。つまりここが「推測で埋めない」の最終防波堤。
    for name in REQUIRED_FIELDS:
        f = record.get(name)
        if not f.is_empty and f.confidence != "high":
            issues.append(
                _issue(record, name, "unverified_value", BLOCKER,
                       f"「{FIELD_LABELS[name]}」の確度が {f.confidence}。"
                       "原本の目視確認を経て high にすること")
            )

    # --- 名寄せ -----------------------------------------------------------
    if record.match_status == "needs_review":
        detail = (
            f"候補: {'、'.join(record.match_candidates)}"
            if record.match_candidates
            else "候補なし(請求元名称が読み取れていない可能性)"
        )
        issues.append(
            Issue(record.record_id, "", "match_needs_review", BLOCKER,
                  f"freee取引先との名寄せが未確定({detail})。"
                  "他社口座へ送金する事故に直結するため人間の判断が必要",
                  record.source_file)
        )
    elif record.match_status == "unmatched":
        issues.append(
            Issue(record.record_id, "", "match_unresolved", BLOCKER,
                  "名寄せ(STEP 3)が未実施", record.source_file)
        )

    return issues


def validate_dataset(
    records: list[Record], expected_input_count: int | None = None
) -> list[Issue]:
    """データセット全体の検証(重複・件数整合)。"""
    issues: list[Issue] = []

    seen: dict[str, str] = {}
    for record in records:
        key = record.freee_partner_name or record.value("supplier_name")
        if not key:
            continue
        if key in seen:
            issues.append(
                Issue(record.record_id, "supplier_name", "duplicate_partner", BLOCKER,
                      f"取引先「{key}」が重複している(先行: {seen[key]})",
                      record.source_file)
            )
        else:
            seen[key] = record.record_id

    if expected_input_count is not None and len(records) != expected_input_count:
        issues.append(
            Issue("-", "", "count_mismatch", BLOCKER,
                  f"抽出件数({len(records)}件)が入力ファイル数"
                  f"({expected_input_count}件)と一致しない",
                  "")
        )

    return issues


def partition(
    records: list[Record], expected_input_count: int | None = None
) -> tuple[list[Record], dict[str, list[Issue]]]:
    """CSVへ載せてよい行と、要確認行に振り分ける。

    Returns:
        (確定レコード, record_id → 論点一覧)
    """
    issues_by_record: dict[str, list[Issue]] = {}
    for issue in validate_dataset(records, expected_input_count):
        issues_by_record.setdefault(issue.record_id, []).append(issue)
    for record in records:
        found = validate_record(record)
        if found:
            issues_by_record.setdefault(record.record_id, []).extend(found)

    ok: list[Record] = []
    for record in records:
        found = issues_by_record.get(record.record_id, [])
        if any(i.severity == BLOCKER for i in found):
            continue
        ok.append(record)
    return ok, issues_by_record
