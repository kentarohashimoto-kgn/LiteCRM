"""支店コードマスタと過去1年の振込実績を突合する。

支店コード:
    (金融機関コード, 支店名) の完全一致のみ採用。支店名は「支店」の語尾と
    全角半角の揺れを吸収する。候補が複数出た場合は確定しない。

振込実績:
    過去に実際に振込が成立した記録なので、口座番号が一致すれば
    受取人名カナの確かな出典になる。漢字から読みを生成するのとは根拠の質が違う。
    照合キーは口座番号。金融機関名・支店名も一致することを必ず確認する。
"""

from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
from freee_transfer.kana import normalize_kana  # noqa: E402

TARGET = BASE / "work" / "extracted_accounts.json"
BRANCHES = BASE / "input" / "zengin_branches_20260630.csv"
HISTORY = BASE / "input" / "payment_history.csv"


def from_bank_record(payee: str) -> str:
    """銀行の実績CSVの受取人名を全銀の半角カナへ戻す。

    実績CSVは半角カナを全角で描画したもの。長音「ｰ」が全角ハイフン「－」として
    出力されているため、そのまま半角化するとハイフンになり別名義になってしまう。
    (例: 「エ－アイテツクワ－クス」= エーアイテックワークス)
    """
    text = (payee or "").replace("－", "ー").replace("−", "ー").replace("ｰ", "ー")
    return normalize_kana(text).normalized


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").upper()
    return re.sub(r"[\s　・\.,\-−ー]", "", t)


def norm_branch(name: str) -> str:
    t = norm(name)
    for suffix in ("支店", "支社"):
        if t.endswith(suffix):
            t = t[: -len(suffix)]
    return t


def norm_bank(name: str) -> str:
    t = norm(name)
    if t.endswith("銀行"):
        t = t[:-2]
    for full, short in (("信用金庫", "信金"), ("信用組合", "信組")):
        t = t.replace(full, short)
    return t


def load_branches() -> dict[tuple[str, str], list[tuple[str, str]]]:
    table: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    with BRANCHES.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            bank = (row["金融機関コード"] or "").strip()
            code = (row["支店コード"] or "").strip()
            name = (row["支店名"] or "").strip()
            if bank and code and name:
                table[(bank, norm_branch(name))].append((code, name))
    return table


def load_history() -> list[dict]:
    rows = []
    with HISTORY.open(encoding="cp932", newline="") as fh:
        reader = csv.reader(fh)
        next(reader)
        for r in reader:
            if len(r) < 15 or not r[10].strip():
                continue
            rows.append({
                "date": f"{r[4]}-{r[5]}-{r[6]}",
                "bank": r[7].strip(), "branch": r[8].strip(),
                "type": r[9].strip(), "account": r[10].strip().lstrip("0") or "0",
                "account_raw": r[10].strip(),
                "payee": r[11].strip(), "amount": int(r[13] or 0),
                "status": r[15].strip() if len(r) > 15 else "",
            })
    return rows


def main() -> int:
    branches = load_branches()
    history = load_history()
    by_account: dict[str, list[dict]] = defaultdict(list)
    for h in history:
        by_account[h["account"]].append(h)

    data = json.loads(TARGET.read_text(encoding="utf-8"))
    print(f"支店マスタ {sum(len(v) for v in branches.values()):,}件 / "
          f"振込実績 {len(history)}件({min(h['date'] for h in history)}〜"
          f"{max(h['date'] for h in history)})\n")

    filled_branch, ambiguous_branch, no_branch = [], [], []
    filled_kana, mismatch = [], []

    for rec in data["records"]:
        if rec.get("excluded"):
            continue

        # --- 支店コード ---------------------------------------------------
        if rec.get("bank_code") and rec.get("branch_name") and not rec.get("branch_code"):
            hits = branches.get((rec["bank_code"], norm_branch(rec["branch_name"])), [])
            if len(hits) == 1:
                rec["branch_code"] = hits[0][0]
                rec["branch_code_source"] = f"全銀協支店マスタ「{hits[0][1]}」と完全一致"
                filled_branch.append((rec, hits[0]))
            elif len(hits) > 1:
                ambiguous_branch.append((rec, hits))
            else:
                no_branch.append(rec)

        # --- 過去実績から受取人名カナ ---------------------------------------
        acct = (rec.get("account_number") or "").lstrip("0")
        if not acct:
            continue
        past = by_account.get(acct, [])
        if not past:
            continue
        same = [h for h in past
                if norm_bank(h["bank"]) == norm_bank(rec.get("bank_name", ""))
                and norm_branch(h["branch"]) == norm_branch(rec.get("branch_name", ""))]
        if not same:
            mismatch.append((rec, past))
            continue
        latest = max(same, key=lambda h: h["date"])
        payee = from_bank_record(latest["payee"])
        current = normalize_kana(rec.get("holder_raw", "")).normalized
        if not payee:
            continue
        # 過去に着金している名義を正とする。請求書の表記と食い違う場合は記録に残す。
        rec["holder_from_history"] = payee
        rec["holder_history_source"] = (
            f"過去振込実績{len(same)}件(最新 {latest['date']})の受取人名「{latest['payee']}」"
        )
        if current and current != payee:
            rec.setdefault("notes", []).append(
                f"受取人名が請求書「{current}」と過去実績「{payee}」で相違。実績側を採用"
            )
        filled_kana.append((rec, latest, len(same), current, payee))

    print(f"■ 支店コードを補完: {len(filled_branch)}件")
    for rec, hit in filled_branch:
        print(f"   {rec['partner_name'][:22]:<24} {rec['bank_name']} {rec['branch_name']} "
              f"→ {hit[0]} (マスタ:{hit[1]})")
    if ambiguous_branch:
        print(f"\n■ 支店の候補が複数: {len(ambiguous_branch)}件")
        for rec, hits in ambiguous_branch:
            print(f"   {rec['partner_name']}: {rec['branch_name']} → "
                  + "、".join(f"{c}({n})" for c, n in hits))
    if no_branch:
        print(f"\n■ 支店マスタに該当なし: {len(no_branch)}件")
        for rec in no_branch:
            print(f"   {rec['partner_name']}: {rec['bank_name']} {rec['branch_name']}")

    print(f"\n■ 過去実績から受取人名カナを取得: {len(filled_kana)}件")
    for rec, h, n, current, payee in filled_kana:
        note = "(請求書に記載なし)" if not current else f"(請求書:{current} と相違)"
        print(f"   {rec['partner_name'][:22]:<24} → 「{h['payee']}」 {note} "
              f"[{h['date']} 他{n-1}件]")
    if mismatch:
        print(f"\n■ 口座番号は一致するが金融機関/支店が違う: {len(mismatch)}件")
        for rec, past in mismatch:
            print(f"   {rec['partner_name']}: 請求書={rec['bank_name']}{rec['branch_name']} / "
                  f"実績={past[0]['bank']}{past[0]['branch']}")

    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
