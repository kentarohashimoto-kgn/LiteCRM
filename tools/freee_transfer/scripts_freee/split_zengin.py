"""承認限度額に収まるよう、全銀ファイルを複数に分割する。

使い方:
    python scripts_freee/split_zengin.py 5000000     # 1ファイル500万円以内に分割

分割は「金額の大きい順に、入る箱へ詰める」(first-fit decreasing)。
ファイル数が最小になり、かつ毎回同じ結果になる(実行のたびに中身が変わらない)。

分割後も合計金額と件数は元と一致する。ここがずれると払い漏れ・二重払いになるため
最後に必ず突合する。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / "scripts_freee"))
from build_outputs import build_zengin, classify  # noqa: E402

WORK = BASE / "work"
OUT = BASE / "output"


def pack(rows: list[dict], limit: int) -> list[list[dict]]:
    """金額の大きい順に、入る箱へ詰める。"""
    bins: list[list[dict]] = []
    totals: list[int] = []
    for row in sorted(rows, key=lambda r: -r["amount"]):
        for i, total in enumerate(totals):
            if total + row["amount"] <= limit:
                bins[i].append(row)
                totals[i] += row["amount"]
                break
        else:
            bins.append([row])
            totals.append(row["amount"])
    return bins


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].isdigit():
        print("使い方: split_zengin.py <1ファイルあたりの上限金額>", file=sys.stderr)
        return 1
    limit = int(sys.argv[1])

    data = json.loads((WORK / "extracted_accounts.json").read_text(encoding="utf-8"))
    rows = []
    for rec in data["records"]:
        if rec.get("excluded"):
            continue
        status, problems, kana = classify(rec)
        if status != "確定":
            continue
        rows.append({**rec, "kana": kana})

    over = [r for r in rows if r["amount"] > limit]
    if over:
        print(f"上限 {limit:,}円 を1件で超える振込があるため分割できません:", file=sys.stderr)
        for r in over:
            print(f"  {r['partner_name']} {r['amount']:,}円", file=sys.stderr)
        return 1

    bins = pack(rows, limit)
    total_all = sum(r["amount"] for r in rows)

    print(f"上限 {limit:,}円 → {len(bins)}ファイルに分割")
    print(f"元データ: {len(rows)}件 / {total_all:,}円\n")

    written_count = written_total = 0
    for i, group in enumerate(bins, start=1):
        group.sort(key=lambda r: -r["amount"])
        subtotal = sum(r["amount"] for r in group)
        dest = OUT / f"zengin_soufuri_20260731_{i}of{len(bins)}.txt"
        dest.write_bytes(build_zengin(group).encode("cp932"))
        written_count += len(group)
        written_total += subtotal
        print(f"[{i}/{len(bins)}] {dest.name}  {len(group)}件 / {subtotal:,}円")
        for r in group:
            print(f"        {r['partner_name'][:26]:<28}{r['amount']:>12,}")
        print()

    # 分割で1件も落ちていないか、金額がずれていないかを必ず確認する
    ok = written_count == len(rows) and written_total == total_all
    print(f"突合: {written_count}件 / {written_total:,}円 "
          f"(元 {len(rows)}件 / {total_all:,}円) … {'一致' if ok else '★不一致'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
