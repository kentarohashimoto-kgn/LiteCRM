"""freee 取引先マスタへ登録する口座情報を組み立てる。

出典は2つ:
  A. 今月の請求書から確定させた口座(取引先IDが判明済み・確度が高い)
  B. 過去1年の振込実績にしか出てこない口座(受取人名カナしか手掛かりがない)

Bは freee の取引先(漢字名)と受取人名(カナ)を突き合わせる必要があり、
機械的には確定できない。カタカナ主体の取引先名だけ照合して候補を出し、
確定は人間が行う。ここを自動で確定させると他社の口座を登録してしまう。

書き込みは行わない。登録用のデータと確認用の一覧を出すだけ。
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

WORK = BASE / "work"
OUT = BASE / "output"

#: freee の口座種別の表記(API実物より)
FREEE_ACCOUNT_TYPE = {"普通": "ordinary", "当座": "checking", "貯蓄": "savings"}


def from_bank_record(payee: str) -> str:
    """実績CSVの全角表記を半角カナへ。全角ハイフンは長音として扱う。"""
    return normalize_kana((payee or "").replace("－", "ー").replace("−", "ー")).normalized


def norm_key(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").upper()
    return re.sub(r"[\s　・\.,\-−ー()（）]", "", t)


def norm_bank(name: str) -> str:
    t = norm_key(name)
    if t.endswith("銀行"):
        t = t[:-2]
    return t.replace("信用金庫", "信金").replace("信用組合", "信組").replace("労働金庫", "労金")


def norm_branch(name: str) -> str:
    t = norm_key(name)
    return t[:-2] if t.endswith("支店") else t


def load_codes() -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    banks, branches = {}, {}
    with (BASE / "input/zengin_banks_20260630.csv").open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            banks[norm_bank(row["金融機関名"])] = row["金融機関コード"]
    with (BASE / "input/zengin_branches_20260630.csv").open(encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            branches[(row["金融機関コード"], norm_branch(row["支店名"]))] = row["支店コード"]
    return banks, branches


def main() -> int:
    banks, branches = load_codes()
    partners = json.loads((WORK / "partners_all.json").read_text(encoding="utf-8"))
    confirmed = json.loads((WORK / "extracted_accounts.json").read_text(encoding="utf-8"))

    # --- A. 今月確定した口座 ---------------------------------------------
    registrations = []
    for r in confirmed["records"]:
        if not (r.get("bank_code") and r.get("branch_code") and r.get("account_number")):
            continue
        kana = normalize_kana(r.get("holder_from_history") or r.get("holder_raw", ""))
        if not kana.is_clean:
            continue
        registrations.append({
            "partner_id": r["partner_id"],
            "partner_name": r["partner_name"],
            "bank_name": r["bank_name"], "bank_code": r["bank_code"],
            "branch_name": r["branch_name"], "branch_code": r["branch_code"],
            "account_type": FREEE_ACCOUNT_TYPE.get(r["account_type"], ""),
            "account_number": r["account_number"],
            "account_name": kana.normalized,
            "source": "今月の請求書・過去実績で確定",
            "confidence": "high",
        })
    known_ids = {x["partner_id"] for x in registrations}

    # --- B. 過去実績にしかない口座 ----------------------------------------
    rows = []
    with (BASE / "input/payment_history.csv").open(encoding="cp932", newline="") as fh:
        reader = csv.reader(fh)
        next(reader)
        for r in reader:
            if len(r) > 13 and r[10].strip():
                rows.append({"bank": r[7].strip(), "branch": r[8].strip(),
                             "type": r[9].strip(), "account": r[10].strip(),
                             "payee": r[11].strip(),
                             "date": f"{r[4]}-{r[5]}-{r[6]}"})

    by_account: dict[tuple, list[dict]] = defaultdict(list)
    for h in rows:
        by_account[(h["bank"], h["branch"], h["account"].lstrip("0"))].append(h)

    used = {(x["bank_code"], x["branch_code"], x["account_number"].lstrip("0"))
            for x in registrations}

    # 取引先名から法人格を外し、残りがカタカナ/英数字だけならカナ照合に使える。
    # (例: 株式会社ヒロクス → ヒロクス → ﾋﾛｸｽ  受取人 ｶ)ﾋﾛｸｽ の ｶ) を外した形と一致)
    # 漢字が残る名前(個人名など)は読みを作れないので照合対象にしない。
    LEGAL = ("株式会社", "有限会社", "合同会社", "合資会社", "一般社団法人",
             "一般財団法人", "特定非営利活動法人", "医療法人", "税理士法人",
             "(株)", "（株）", "㈱", "(有)", "（有）", "㈲")

    def stripped_kana(label: str) -> str:
        body = label or ""
        for token in LEGAL:
            body = body.replace(token, "")
        body = body.strip()
        if not body or re.search(r"[一-鿿]", body):
            return ""
        return normalize_kana(body).normalized

    kana_partners: dict[str, list[dict]] = defaultdict(list)
    for p in partners:
        for label in (p.get("name") or "", p.get("long_name") or ""):
            k = stripped_kana(label)
            if k and not any(p["id"] == q["id"] for q in kana_partners[k]):
                kana_partners[k].append(p)

    def payee_body(payee: str) -> str:
        """受取人名から法人格の略号を外す(ｶ)ﾋﾛｸｽ → ﾋﾛｸｽ、ﾔﾏﾄ(ｶ → ﾔﾏﾄ)。"""
        body = payee
        for prefix in ("ｶ)", "ﾕ)", "ﾄﾞ)", "ｼﾔ)"):
            if body.startswith(prefix):
                body = body[len(prefix):]
        for suffix in ("(ｶ", "(ﾕ", "(ﾄﾞ", "(ｼﾔ"):
            if body.endswith(suffix):
                body = body[: -len(suffix)]
        return body.strip()

    candidates = []
    for (bank, branch, acct), hs in sorted(by_account.items()):
        code = banks.get(norm_bank(bank), "")
        bcode = branches.get((code, norm_branch(branch)), "")
        if code and bcode and (code, bcode, acct) in used:
            continue  # 今月分で登録済み
        latest = max(hs, key=lambda h: h["date"])
        payee = from_bank_record(latest["payee"])
        hits = [p for p in kana_partners.get(payee_body(payee), [])
                if p["id"] not in known_ids]
        candidates.append({
            "bank_name": bank, "bank_code": code,
            "branch_name": branch, "branch_code": bcode,
            "account_type": FREEE_ACCOUNT_TYPE.get(latest["type"], ""),
            "account_number": latest["account"],
            "account_name": payee,
            "transfers": len(hs), "latest": latest["date"],
            "partner_candidates": [{"id": p["id"], "name": p["name"]} for p in hits],
        })

    payload = {
        "_note": "freee 取引先マスタへの登録候補。書き込みは未実行。",
        "registrations": registrations,
        "history_only": candidates,
    }
    (WORK / "partner_account_registrations.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    matched = [c for c in candidates if len(c["partner_candidates"]) == 1]
    unmatched = [c for c in candidates if not c["partner_candidates"]]

    # --- 確認用の一覧 -----------------------------------------------------
    lines = [
        "# freee 取引先マスタ 口座登録リスト", "",
        "**書き込みは未実行。** この一覧をご確認いただいてから登録します。", "",
        "---", "",
        f"## A. そのまま登録できる（{len(registrations)}件）", "",
        "今月の請求書と過去の振込実績で口座を確定させた取引先。取引先IDも判明している。", "",
        "| 取引先 | 金融機関 | 支店 | 種別 | 口座番号 | 受取人名 |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(registrations, key=lambda x: x["partner_name"]):
        lines.append(
            f"| {r['partner_name']} | {r['bank_name']}({r['bank_code']}) "
            f"| {r['branch_name']}({r['branch_code']}) | {r['account_type']} "
            f"| {r['account_number']} | {r['account_name']} |"
        )
    lines += [
        "", "---", "",
        f"## B. 過去実績にのみある口座で、取引先が推定できたもの（{len(matched)}件）", "",
        "**受取人名カナから取引先名を推定した候補。人間の確認が必要。**",
        "別の取引先に口座を紐付けると他社へ送金する事故になるため、自動では確定しない。", "",
        "| 推定した取引先 | 金融機関 | 支店 | 口座番号 | 受取人名 | 実績 | 最新 |",
        "|---|---|---|---|---|---:|---|",
    ]
    for c in sorted(matched, key=lambda x: -x["transfers"]):
        p = c["partner_candidates"][0]
        lines.append(
            f"| {p['name']} | {c['bank_name']}({c['bank_code']}) "
            f"| {c['branch_name']}({c['branch_code']}) | {c['account_number']} "
            f"| {c['account_name']} | {c['transfers']}件 | {c['latest']} |"
        )
    lines += [
        "", "---", "",
        f"## C. 取引先を特定できなかった口座（{len(unmatched)}件）", "",
        "受取人名がカナのみで、freee の取引先名（漢字）と機械的に照合できない。",
        "個人名が大半。登録するには人間が対応先を判断する必要がある。", "",
        "| 受取人名 | 金融機関 | 支店 | 口座番号 | 実績 | 最新 |",
        "|---|---|---|---|---:|---|",
    ]
    for c in sorted(unmatched, key=lambda x: -x["transfers"]):
        lines.append(
            f"| {c['account_name']} | {c['bank_name']}({c['bank_code']}) "
            f"| {c['branch_name']}({c['branch_code']}) | {c['account_number']} "
            f"| {c['transfers']}件 | {c['latest']} |"
        )
    (OUT / "freee口座登録リスト.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"A. 今月確定・そのまま登録できる : {len(registrations)}件")
    print(f"B. 過去実績にのみ存在する口座   : {len(candidates)}件")
    print(f"   うち取引先が一意に推定できた : {len(matched)}件(要確認)")
    print(f"   うち取引先を特定できない     : {len(unmatched)}件")
    print(f"   うちコード未解決             : "
          f"{len([c for c in candidates if not (c['bank_code'] and c['branch_code'])])}件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
