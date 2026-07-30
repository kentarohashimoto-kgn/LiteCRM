"""全銀協の金融機関コードマスタを使って bank_code を補完する。

マスタにあるのは金融機関コードのみ。支店コードは含まれないため、
支店コードが欠けている行は補完できない(推測しない)。

照合は「銀行」「信用金庫」等の語尾と全角/半角の揺れを吸収したうえで
完全一致のみ採用する。部分一致・あいまい一致は採らない
(「中国」と「中国工商」のような誤マッチが起きるため)。
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
MASTER = Path(sys.argv[1]) if len(sys.argv) > 1 else None
TARGET = BASE / "work" / "extracted_accounts.json"

#: 金融機関の種別語尾。マスタ側は略称(信金/信組)、請求書側は正式名称のことが多い。
SUFFIX_MAP = (
    ("信用金庫", "信金"), ("信用組合", "信組"), ("労働金庫", "労金"),
    ("農業協同組合", "農協"), ("信用農業協同組合連合会", "信連"),
)


def norm_bank(name: str) -> str:
    """比較用キー。全角/半角、記号、語尾表記の揺れを吸収する。"""
    text = unicodedata.normalize("NFKC", name or "").upper()
    text = re.sub(r"[\s　・\.,]", "", text)
    for full, short in SUFFIX_MAP:
        text = text.replace(full, short)
    # 末尾の「銀行」は付いていたり付いていなかったりするので落とす
    if text.endswith("銀行"):
        text = text[:-2]
    return text


def load_master(path: Path) -> dict[str, list[tuple[str, str]]]:
    table: dict[str, list[tuple[str, str]]] = {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            code = (row.get("金融機関コード") or "").strip()
            name = (row.get("金融機関名") or "").strip()
            if not code or not name:
                continue
            table.setdefault(norm_bank(name), []).append((code, name))
    return table


def main() -> int:
    if MASTER is None or not MASTER.exists():
        print("使い方: apply_bank_master.py <金融機関コードCSV>", file=sys.stderr)
        return 1

    table = load_master(MASTER)
    data = json.loads(TARGET.read_text(encoding="utf-8"))

    filled, ambiguous, unmatched, already = [], [], [], []
    for rec in data["records"]:
        if rec.get("excluded") or not rec.get("bank_name"):
            continue
        if rec.get("bank_code"):
            already.append(rec)
            continue
        hits = table.get(norm_bank(rec["bank_name"]), [])
        if len(hits) == 1:
            code, master_name = hits[0]
            rec["bank_code"] = code
            rec["bank_code_source"] = f"全銀協マスタ「{master_name}」と完全一致"
            filled.append((rec, master_name, code))
        elif len(hits) > 1:
            ambiguous.append((rec, hits))
        else:
            unmatched.append(rec)

    print(f"■ 金融機関コードを補完: {len(filled)}件")
    for rec, master_name, code in filled:
        print(f"   {rec['partner_name'][:22]:<24} {rec['bank_name']:<18} → "
              f"{code} (マスタ:{master_name})")
    if ambiguous:
        print(f"\n■ 候補が複数で確定できず: {len(ambiguous)}件")
        for rec, hits in ambiguous:
            print(f"   {rec['partner_name']}: {rec['bank_name']} → "
                  + "、".join(f"{c}({n})" for c, n in hits))
    if unmatched:
        print(f"\n■ マスタに該当なし: {len(unmatched)}件")
        for rec in unmatched:
            print(f"   {rec['partner_name']}: {rec['bank_name']}")
    if already:
        print(f"\n■ 既にコードあり(変更せず): {len(already)}件")

    # 支店コードはマスタに含まれないため、依然として欠けている行を明示する
    still = [r for r in data["records"]
             if not r.get("excluded") and r.get("bank_code") and not r.get("branch_code")
             and r.get("bank_name")]
    print(f"\n■ 金融機関コードは埋まったが支店コードが未確定: {len(still)}件 "
          f"({sum(r['amount'] for r in still):,}円)")
    for r in still:
        print(f"   {r['partner_name'][:22]:<24} {r['bank_name']} {r['branch_name']}")

    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
