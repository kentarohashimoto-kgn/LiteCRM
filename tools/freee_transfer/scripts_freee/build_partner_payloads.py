"""freee 取引先マスタ更新用の PUT ボディを組み立てる(送信はしない)。

PUT /api/1/partners/{id} は name が必須で、指定しなかった項目が消える可能性がある。
メールアドレス・担当者・住所・インボイス登録番号などを消すと業務影響が出るため、
**既存の値をすべて引き継いだうえで口座情報だけ差し替える**。

実行時は念のため GET /api/1/partners/{id} で最新を取り直してからマージすること。
ここで作るのは確認用のボディ(と、どこが変わるかの差分)。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

WORK = BASE / "work"
OUT = BASE / "output"
COMPANY_ID = 2018395

#: freee の PUT が受け付ける口座種別(GETのレスポンス表記とは別物なので注意)
#: ordinary:普通 / checking:当座 / earmarked:納税準備預金 / savings:貯蓄 / other:その他
ACCOUNT_TYPE = {"普通": "ordinary", "当座": "checking", "貯蓄": "savings"}

#: 更新時に引き継ぐ既存項目(未指定だと消える恐れがあるもの)
CARRY_OVER = (
    "name", "available", "shortcut1", "shortcut2", "org_code", "country_code",
    "long_name", "name_kana", "default_title", "phone", "contact_name", "email",
    "payer_walletable_id", "transfer_fee_handling_side",
    "qualified_invoice_issuer", "invoice_registration_number",
)


def load_full_partners() -> dict[int, dict]:
    """取引先の全項目を保持した生レスポンスを読む。"""
    raw = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if raw is None or not raw.exists():
        return {}
    data = json.loads(raw.read_text(encoding="utf-8"))
    return {p["id"]: p for p in data["partners"]}


def main() -> int:
    regs = json.loads(
        (WORK / "partner_account_registrations.json").read_text(encoding="utf-8")
    )["registrations"]
    full = load_full_partners()

    payloads, notes = [], []
    for r in regs:
        cur = full.get(r["partner_id"], {})
        body = {"company_id": COMPANY_ID}
        for key in CARRY_OVER:
            if key in cur and cur[key] is not None:
                body[key] = cur[key]
        body.setdefault("name", r["partner_name"])

        # 住所・書類送付設定も既存があれば引き継ぐ
        for key in ("address_attributes", "partner_doc_setting_attributes"):
            if cur.get(key):
                body[key] = cur[key]

        body["partner_bank_account_attributes"] = {
            "bank_name": r["bank_name"],
            "bank_code": r["bank_code"],
            "branch_name": r["branch_name"],
            "branch_code": r["branch_code"],
            "account_type": r["account_type"],
            "account_number": r["account_number"],
            "account_name": r["account_name"],
        }

        before = (cur.get("partner_bank_account_attributes") or {})
        had = bool((before.get("account_number") or "").strip())
        notes.append({
            "partner_id": r["partner_id"], "partner_name": r["partner_name"],
            "既存口座": "あり" if had else "なし",
            "変更前": f"{before.get('bank_name','')} {before.get('branch_name','')} "
                      f"{before.get('account_number','')} {before.get('account_name','')}".strip(),
            "変更後": f"{r['bank_name']} {r['branch_name']} "
                      f"{r['account_number']} {r['account_name']}",
        })
        payloads.append({"partner_id": r["partner_id"],
                         "partner_name": r["partner_name"], "body": body})

    (WORK / "partner_put_payloads.json").write_text(
        json.dumps(payloads, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# freee 取引先マスタ 更新内容（A：30件）", "",
        "**未実行。** Freee MCP 接続が戻り次第、この内容で更新します。", "",
        "更新は `PUT /api/1/partners/{id}`。既存のメールアドレス・担当者・住所・"
        "インボイス登録番号などは引き継ぎ、口座情報のみ差し替えます。", "",
        "| 取引先 | 既存口座 | 変更後 |", "|---|---|---|",
    ]
    for n in sorted(notes, key=lambda x: x["partner_name"]):
        after = n["変更後"]
        before = n["変更前"] or "（未設定）"
        lines.append(f"| {n['partner_name']} | {before} | {after} |")
    lines += ["", f"新規に口座を設定: {sum(1 for n in notes if n['既存口座']=='なし')}件",
              f"既存の口座を上書き: {sum(1 for n in notes if n['既存口座']=='あり')}件", ""]
    (OUT / "freee更新内容_A30件.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"更新ボディを {len(payloads)} 件ぶん作成")
    print(f"  新規設定 {sum(1 for n in notes if n['既存口座']=='なし')}件 / "
          f"上書き {sum(1 for n in notes if n['既存口座']=='あり')}件")
    print(f"  既存項目を引き継げた取引先: {sum(1 for p in payloads if 'email' in p['body'] or 'phone' in p['body'])}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
