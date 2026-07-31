"""指定した取引先だけの全銀ファイルを作る(追加振込・単発振込用)。

使い方:
    python scripts_freee/build_extra_zengin.py 真崎志乃 -o zengin_masaki_20260731.txt

既に承認済みの一括データとは別ファイルにする。既存データへ足すのではなく
独立した振込依頼として出すことで、二重振込の余地をなくす。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / "scripts_freee"))
from build_outputs import build_zengin, classify  # noqa: E402

WORK = BASE / "work"
OUT = BASE / "output"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("partners", nargs="+", help="取引先名(完全一致)")
    ap.add_argument("-o", "--output", required=True, help="出力ファイル名")
    args = ap.parse_args()

    data = json.loads((WORK / "extracted_accounts.json").read_text(encoding="utf-8"))
    by_name = {r["partner_name"]: r for r in data["records"]}

    rows = []
    for name in args.partners:
        rec = by_name.get(name)
        if rec is None:
            print(f"取引先が見つかりません: {name}", file=sys.stderr)
            return 1
        status, problems, kana = classify(rec)
        if status != "確定":
            print(f"{name}: 情報が揃っていないため出力できません", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            return 1
        rows.append({**rec, "kana": kana})

    dest = OUT / args.output
    dest.write_bytes(build_zengin(rows).encode("cp932"))
    total = sum(r["amount"] for r in rows)

    print(f"{len(rows)}件 / {total:,}円 → {dest}")
    for r in rows:
        print(f"  {r['partner_name']}  {r['bank_name']}({r['bank_code']}) "
              f"{r['branch_name']}({r['branch_code']}) {r['account_type']} "
              f"{r['account_number']}  {r['kana']}  {r['amount']:,}円")
    return 0


if __name__ == "__main__":
    sys.exit(main())
