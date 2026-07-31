"""口座明細1本に対して消し込む未決済取引の組合せを、freee の実データから復元する。

消込の作業計画(どの取引を、どの明細に当てるか)は `work/` に置かれるが、
`work/` は .gitignore 済みで実行環境の寿命と一緒に消える。
計画そのものは口座番号を含まない(取引ID・金額・取引先名だけ)ので、
**消えても freee から作り直せる** ようにしたのがこのスクリプト。

やること: 支払期日で絞った未決済取引の中から、合計が目標額にちょうど一致する
組合せを1つに特定する。

一致する組合せが複数あったら**確定しない**。
`extract.py` が confidence を high にしないのと同じ理由で、
「それらしい32件」を選ぶと、実際には別の取引が未払いのまま残る。

    python -m scripts_freee.rebuild_reconcile_plan \
        --due-date 2026-07-31 --deals-total 13182347 --txn-amount 13191419

入力(いずれも freee API のレスポンスをそのまま保存したもの):
    work/deals_unsettled.json  GET /api/1/deals?type=expense&status=unsettled
    work/partners.json         GET /api/1/partners  (offset を進めて全件マージ)

出力:
    work/reconcile_plan.json   消し込む取引の一覧
    work/reconcile_plan.md     freee の消込画面で突き合わせるための一覧
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "work"

#: 除外側の組合せを何件まで探すか。
#: 目標額との差が数件の取引で説明できるうちは、全探索より除外側のほうが速い。
MAX_EXCLUDE = 6


def load(name: str, key: str) -> list[dict]:
    path = WORK / name
    if not path.exists():
        sys.exit(f"入力がない: {path}\n  freee API のレスポンスを保存してから実行する")
    return json.loads(path.read_text(encoding="utf-8"))[key]


def find_exclusions(deals: list[dict], gap: int) -> list[tuple[dict, ...]]:
    """合計が gap ちょうどになる除外候補を、少ない件数から順に全部探す。"""
    found = []
    for size in range(1, MAX_EXCLUDE + 1):
        for combo in itertools.combinations(deals, size):
            if sum(d["due_amount"] for d in combo) == gap:
                found.append(combo)
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--due-date", required=True, help="支払期日 (yyyy-mm-dd)")
    ap.add_argument("--deals-total", type=int, required=True, help="消し込む取引の合計額")
    ap.add_argument("--txn-amount", type=int, required=True, help="口座明細の金額")
    ap.add_argument("--exclude", default="", help="消込から外す取引IDをカンマ区切りで指定。"
                                                 "組合せが一意に決まらない場合に人間が判断した結果を入れる")
    args = ap.parse_args()

    partners = {p["id"]: p for p in load("partners.json", "partners")}
    deals = load("deals_unsettled.json", "deals")

    pool = [d for d in deals if d.get("due_date") == args.due_date]
    pool_total = sum(d["due_amount"] for d in pool)
    gap = pool_total - args.deals_total

    print(f"支払期日 {args.due_date} の未決済取引: {len(pool)}件 / ¥{pool_total:,}")
    print(f"目標 ¥{args.deals_total:,} との差: ¥{gap:,}")

    if gap < 0:
        sys.exit(f"母集団が目標額に足りない。取引の取得漏れを疑う(差 ¥{gap:,})")

    manual = {int(x) for x in args.exclude.replace(" ", "").split(",") if x}
    if manual:
        # 人間が除外を指定した場合は探索しない。合計が合うかだけ検算する。
        unknown = manual - {d["id"] for d in pool}
        if unknown:
            sys.exit(f"--exclude に母集団外の取引IDがある: {sorted(unknown)}")
        excluded = [d for d in pool if d["id"] in manual]
        if sum(d["due_amount"] for d in excluded) != gap:
            sys.exit(f"--exclude の合計 ¥{sum(d['due_amount'] for d in excluded):,} が "
                     f"差額 ¥{gap:,} と一致しない")
    elif gap == 0:
        excluded = []
    else:
        cands = find_exclusions(pool, gap)
        if not cands:
            sys.exit(f"差 ¥{gap:,} を {MAX_EXCLUDE}件以内の除外で説明できない。"
                     "取引の取得条件か目標額を確認する")
        if len(cands) > 1:
            print(f"\n除外候補が {len(cands)}通り見つかった。特定できないので確定しない:",
                  file=sys.stderr)
            for c in cands:
                names = [partners.get(d.get("partner_id"), {}).get("name", "?") for d in c]
                print(f"  {len(c)}件 {list(zip((d['id'] for d in c), names))}", file=sys.stderr)
            sys.exit("どれを外すか人間が判断し、--exclude で明示して再実行すること")
        excluded = list(cands[0])

    ex_ids = {d["id"] for d in excluded}
    targets = [d for d in pool if d["id"] not in ex_ids]
    if excluded:
        print(f"\n除外 {len(excluded)}件 (合計 ¥{sum(d['due_amount'] for d in excluded):,}):")
        for d in excluded:
            name = partners.get(d.get("partner_id"), {}).get("name", "(取引先なし)")
            print(f"  {d['id']}  ¥{d['due_amount']:>10,}  {name}")

    total = sum(d["due_amount"] for d in targets)
    residual = args.txn_amount - total
    print(f"\n消込対象: {len(targets)}件 / ¥{total:,}")
    print(f"明細 ¥{args.txn_amount:,} との残差: ¥{residual:,}")

    rows = []
    for d in sorted(targets, key=lambda x: -x["due_amount"]):
        p = partners.get(d.get("partner_id"), {})
        rows.append({
            "deal_id": d["id"],
            "partner_id": d.get("partner_id"),
            "partner_name": p.get("name", "(取引先なし)"),
            "issue_date": d["issue_date"],
            "due_date": d.get("due_date"),
            "amount": d["due_amount"],
            # 口座が未登録の取引先は、次回の全銀ファイルでまた手入力になる
            "口座登録済み": bool(
                ((p.get("partner_bank_account_attributes") or {}).get("account_number") or "").strip()
            ),
        })

    plan = {
        "due_date": args.due_date,
        "wallet_txn_amount": args.txn_amount,
        "deals_total": total,
        "residual": residual,
        "deals": rows,
    }
    (WORK / "reconcile_plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        f"# 消込計画 {args.due_date}", "",
        f"口座明細 ¥{args.txn_amount:,} に対し、未決済取引 {len(rows)}件 "
        f"¥{total:,} を消し込む。残差 ¥{residual:,}。", "",
        "freee API に明細と取引を紐づけるエンドポイントはないため、"
        "消込操作は freee の画面で行う。", "",
        "| 取引ID | 取引先 | 発生日 | 金額 | 口座登録 |", "|---|---|---|---:|---|",
    ]
    for r in rows:
        lines.append(f"| {r['deal_id']} | {r['partner_name']} | {r['issue_date']} "
                     f"| {r['amount']:,} | {'済' if r['口座登録済み'] else '未'} |")
    lines += ["", f"**合計 {len(rows)}件 ¥{total:,}**", ""]
    (WORK / "reconcile_plan.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    unreg = sum(1 for r in rows if not r["口座登録済み"])
    print(f"  うち取引先の口座が未登録: {unreg}件")
    print(f"\n出力: {WORK/'reconcile_plan.json'}\n      {WORK/'reconcile_plan.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
