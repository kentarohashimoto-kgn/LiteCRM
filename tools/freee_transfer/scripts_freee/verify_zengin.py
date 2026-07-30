"""生成した全銀ファイルを逆パースし、抽出データと突合する独立検証。

生成ロジックのバグで別の口座へ振り込む事故を防ぐため、
出力ファイル側から読み直して照合する(生成時の変数は一切参照しない)。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ZENGIN = BASE / "output" / "zengin_soufuri_20260731.txt"
SOURCE = BASE / "work" / "extracted_accounts.json"
TYPE_NAME = {"1": "普通", "2": "当座", "4": "貯蓄"}


def jlen(s: str) -> int:
    return len(s.encode("cp932"))


def main() -> int:
    raw = ZENGIN.read_bytes().decode("cp932")
    lines = raw.rstrip("\r\n").split("\r\n")
    records = json.loads(SOURCE.read_text(encoding="utf-8"))["records"]
    by_account = {
        (r["bank_code"], r["branch_code"], r["account_number"]): r
        for r in records if r["account_number"]
    }

    errors: list[str] = []
    for i, line in enumerate(lines):
        if jlen(line) != 120:
            errors.append(f"レコード{i}: 長さ{jlen(line)}桁(120でない)")

    if lines[0][0] != "1":
        errors.append("ヘッダーレコードがない")
    if lines[-1][0] != "9":
        errors.append("エンドレコードがない")

    data_lines = [l for l in lines if l[0] == "2"]
    trailer = next((l for l in lines if l[0] == "8"), None)
    if trailer is None:
        errors.append("トレーラレコードがない")
        print("\n".join(errors))
        return 1

    total = 0
    print(f"{'取引先':<26} {'金融/支店':<12} {'口座':<12} {'受取人名':<20} {'金額':>12}")
    print("-" * 92)
    for line in data_lines:
        bank, branch = line[1:5], line[20:23]
        atype, number = line[42], line[43:50]
        # 受取人名は Shift_JIS で30バイト。半角カナなので30文字ぶん。
        name = line[50:80].rstrip()
        amount = int(line[80:90])
        total += amount

        src = by_account.get((bank, branch, number))
        if src is None:
            errors.append(f"照合失敗: 金融{bank}/支店{branch}/口座{number} が抽出データにない")
            partner = "??"
        else:
            partner = src["partner_name"]
            if src["amount"] != amount:
                errors.append(f"{partner}: 金額不一致 file={amount} src={src['amount']}")
            if TYPE_NAME.get(atype) != src["account_type"]:
                errors.append(f"{partner}: 口座種別不一致 file={atype} src={src['account_type']}")
            if src["issues"]:
                errors.append(f"{partner}: 要確認事項があるのに全銀ファイルに含まれている")
        print(f"{partner:<26} {bank}/{branch:<8} {TYPE_NAME.get(atype,'?')} {number:<8} "
              f"{name:<20} {amount:>12,}")

    print("-" * 92)
    declared_count = int(trailer[1:7])
    declared_total = int(trailer[7:19])
    print(f"{'トレーラ':<26} 件数 {declared_count} / 合計 {declared_total:,}円")

    if declared_count != len(data_lines):
        errors.append(f"件数不一致: トレーラ{declared_count} 実データ{len(data_lines)}")
    if declared_total != total:
        errors.append(f"合計金額不一致: トレーラ{declared_total} 実データ{total}")

    # 委託者コードがスペースであること(PayPay銀行WEB総振の要件)
    if lines[0][4:14] != " " * 10:
        errors.append("委託者コードがスペース10桁になっていない")

    print()
    if errors:
        print(f"検証NG: {len(errors)}件")
        for e in errors:
            print(f"  ! {e}")
        return 1
    print("検証OK: 全レコード120桁 / 口座・金額・種別が抽出データと一致 / 委託者コードはスペース")
    return 0


if __name__ == "__main__":
    sys.exit(main())
