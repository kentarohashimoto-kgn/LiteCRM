"""振込先を1件ずつ画面へ手入力する場合の作業シートを出力する。

WEB一括振込は振込先のCSV一括登録ができず、1件ずつ登録する必要がある。
28件を画面に打ち込む作業は取り違えが起きやすいので、
入力順にそのまま並べ、消し込みができる形にしておく。
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
from freee_transfer.kana import normalize_kana  # noqa: E402

WORK = BASE / "work"
OUT = BASE / "output"


def main() -> int:
    data = json.loads((WORK / "extracted_accounts.json").read_text(encoding="utf-8"))
    rows = []
    for r in data["records"]:
        if r.get("excluded") or r.get("issues"):
            continue
        kana = normalize_kana(r.get("holder_from_history") or r.get("holder_raw", ""))
        rows.append({
            "partner": r["partner_name"],
            "bank": f"{r['bank_name']}({r['bank_code']})",
            "branch": f"{r['branch_name']}({r['branch_code']})",
            "type": r["account_type"],
            "number": r["account_number"],
            "kana": kana.normalized,
            "amount": r["amount"],
        })
    rows.sort(key=lambda x: -x["amount"])
    total = sum(x["amount"] for x in rows)

    # --- 画面入力用のテキスト(1件ずつ・消し込みできる形) --------------------
    lines = [
        "PayPay銀行 手入力用 振込先リスト（2026-07-31 支払分）",
        "=" * 62,
        f"全 {len(rows)} 件 / 合計 {total:,} 円",
        "",
        "※ 入力後、末尾の合計と件数で必ず検算すること",
        "",
    ]
    for i, x in enumerate(rows, 1):
        lines += [
            f"[ ] {i:>2}. {x['partner']}",
            f"       金融機関 : {x['bank']}",
            f"       支店     : {x['branch']}",
            f"       科目     : {x['type']}",
            f"       口座番号 : {x['number']}",
            f"       受取人名 : {x['kana']}",
            f"       金額     : {x['amount']:,} 円",
            "",
        ]
    lines += ["=" * 62, f"合計 {len(rows)} 件 / {total:,} 円", ""]
    (OUT / "手入力用リスト_20260731.txt").write_text("\n".join(lines), encoding="utf-8")

    # --- 表計算で開く用 -----------------------------------------------------
    dest = OUT / "手入力用リスト_20260731.csv"
    with dest.open("w", encoding="cp932", newline="", errors="replace") as fh:
        w = csv.writer(fh, quoting=csv.QUOTE_ALL)
        w.writerow(["No", "入力済", "取引先名", "金融機関", "金融機関コード",
                    "支店", "支店コード", "科目", "口座番号", "受取人名(半角カナ)", "金額"])
        for i, r in enumerate(rows, 1):
            rec = next(x for x in data["records"] if x["partner_name"] == r["partner"])
            w.writerow([i, "", r["partner"], rec["bank_name"], rec["bank_code"],
                        rec["branch_name"], rec["branch_code"], r["type"],
                        r["number"], r["kana"], r["amount"]])
        w.writerow(["", "", f"合計 {len(rows)}件", "", "", "", "", "", "", "", total])

    print(f"{len(rows)}件 / {total:,}円")
    print(f"出力: {OUT/'手入力用リスト_20260731.txt'}")
    print(f"      {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
