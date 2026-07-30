"""支払管理レポート(deals)と取引先マスタ(partners)を突合して支払対象一覧を作る。

freee API から取得した生JSONを入力に、
- 取引先ごとに支払額を集計
- freee 側の登録口座の有無を判定
して work/payment_targets.json を出力する。

口座情報は freee の値をそのまま持つ。ここでは一切加工・推測しない。
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "work"

BANK_FIELDS = (
    "bank_name", "bank_name_kana", "bank_code",
    "branch_name", "branch_kana", "branch_code",
    "account_type", "account_number", "account_name", "long_account_name",
)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    deals = load(WORK / "deals_0731.json")
    partners = {p["id"]: p for p in load(WORK / "partners_all.json")}

    by_partner: dict[int, dict] = defaultdict(
        lambda: {"deals": [], "total": 0}
    )
    for deal in deals:
        entry = by_partner[deal["partner_id"]]
        entry["deals"].append({
            "deal_id": deal["id"],
            "issue_date": deal["issue_date"],
            "amount": deal["amount"],
            "due_amount": deal["due_amount"],
            "ref_number": deal.get("ref_number") or "",
            "description": deal.get("description") or "",
        })
        entry["total"] += deal["due_amount"]

    targets = []
    for partner_id, entry in by_partner.items():
        partner = partners.get(partner_id, {})
        bank = partner.get("bank") or {}
        # 口座番号が空なら「未設定」。freee の値をそのまま判定に使う。
        has_account = bool((bank.get("account_number") or "").strip())
        targets.append({
            "partner_id": partner_id,
            "partner_name": partner.get("name") or f"(不明 id={partner_id})",
            "partner_long_name": partner.get("long_name") or "",
            "partner_name_kana": partner.get("name_kana") or "",
            "total_due": entry["total"],
            "deal_count": len(entry["deals"]),
            "deals": sorted(entry["deals"], key=lambda d: d["issue_date"]),
            "freee_bank_account": {k: (bank.get(k) or "") for k in BANK_FIELDS},
            "has_freee_account": has_account,
        })

    targets.sort(key=lambda t: (-t["total_due"], t["partner_name"]))
    out = WORK / "payment_targets.json"
    out.write_text(
        json.dumps(
            {
                "due_date": "2026-07-31",
                "deal_count": len(deals),
                "partner_count": len(targets),
                "total_due": sum(t["total_due"] for t in targets),
                "targets": targets,
            },
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    with_acct = [t for t in targets if t["has_freee_account"]]
    without = [t for t in targets if not t["has_freee_account"]]
    print(f"取引 {len(deals)}件 / 取引先 {len(targets)}社 / 合計 {sum(t['total_due'] for t in targets):,}円")
    print(f"freee に口座登録あり: {len(with_acct)}社 "
          f"({sum(t['total_due'] for t in with_acct):,}円)")
    print(f"freee に口座登録なし: {len(without)}社 "
          f"({sum(t['total_due'] for t in without):,}円)")
    print(f"\n出力: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
