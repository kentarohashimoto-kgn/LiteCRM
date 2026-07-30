"""支払対象の重複登録を検出する。

金額と取引先が同じでも重複とは限らない(同一商品を別の案件で複数回購入するなど)。
逆に金額が違っても同じ請求書の可能性がある。そこで3つの角度から見る:

  1. 証憑ファイルの内容ハッシュ … 同一ファイルが2回添付されていれば重複の確度が高い
  2. 請求書番号 … 同じ番号が複数の取引に紐づいていれば重複
  3. 取引先+金額 … 上記に当たらないが目視すべき候補として提示する

判定は「重複の疑い」までとし、確定は人間が行う。
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "work"

#: 請求書番号らしき記載を拾うパターン(表記揺れが大きいので複数用意)
INVOICE_NO = [
    re.compile(r"請求書?番号\s*[:：]?\s*([A-Za-z0-9\-]{2,20})"),
    re.compile(r"請求\s*No\.?\s*[:：]?\s*([A-Za-z0-9\-]{2,20})", re.I),
    re.compile(r"請求書No\s*[:：]?\s*([A-Za-z0-9\-]{2,20})"),
]


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def find_invoice_no(text: str) -> str:
    for pat in INVOICE_NO:
        m = pat.search(text)
        if m:
            return m.group(1).strip()
    return ""


def main() -> int:
    deals = json.loads((WORK / "deals_0731.json").read_text(encoding="utf-8"))
    deal_receipts = json.loads((WORK / "deal_receipts.json").read_text(encoding="utf-8"))
    partners = {t["partner_id"]: t["partner_name"]
                for t in json.loads((WORK / "payment_targets.json").read_text(encoding="utf-8"))["targets"]}
    receipt_map = {str(r["receipt_id"]): r for r in
                   json.loads((WORK / "receipt_map.json").read_text(encoding="utf-8"))}
    texts = json.loads((WORK / "invoice_text.json").read_text(encoding="utf-8"))

    # deal_id -> 紐づく証憑
    deal_to_receipts = {d["deal_id"]: [r["id"] for r in d["receipts"]] for d in deal_receipts}
    deal_partner = {d["deal_id"]: d["partner_id"] for d in deal_receipts}

    findings: list[str] = []

    # --- 1. 同一ファイル ---------------------------------------------------
    by_hash: dict[str, list[str]] = defaultdict(list)
    for rid, info in receipt_map.items():
        path = BASE / info["file"]
        if path.exists():
            by_hash[file_hash(path)].append(rid)
    dup_files = {h: v for h, v in by_hash.items() if len(v) > 1}

    print("=" * 78)
    print("1. 証憑ファイルの内容が完全に同一")
    print("=" * 78)
    if not dup_files:
        print("  なし")
    for h, rids in dup_files.items():
        names = {receipt_map[r]["partner"] for r in rids}
        print(f"  ★ 同一内容の証憑 {len(rids)}件: {'、'.join(names)}  証憑ID {', '.join(rids)}")
        findings.append(f"同一ファイル: {'、'.join(names)} (証憑 {', '.join(rids)})")

    # --- 2. 請求書番号 -----------------------------------------------------
    print("\n" + "=" * 78)
    print("2. 同一取引先で請求書番号が重複")
    print("=" * 78)
    by_partner_no: dict[tuple[str, str], list[str]] = defaultdict(list)
    for rid, info in texts.items():
        no = find_invoice_no("\n".join(info["pages"]))
        if no:
            by_partner_no[(info["partner"], no)].append(rid)
    dup_no = {k: v for k, v in by_partner_no.items() if len(v) > 1}
    if not dup_no:
        print("  なし")
    for (partner, no), rids in dup_no.items():
        print(f"  ★ {partner}: 請求書番号「{no}」が {len(rids)}件  証憑ID {', '.join(rids)}")
        findings.append(f"請求書番号重複: {partner} 番号{no} (証憑 {', '.join(rids)})")

    # --- 3. 同一取引先・同一金額 --------------------------------------------
    print("\n" + "=" * 78)
    print("3. 同一取引先・同一金額の取引(重複とは限らないため要目視)")
    print("=" * 78)
    by_pair: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for d in deals:
        by_pair[(d["partner_id"], d["due_amount"])].append(d)
    pairs = {k: v for k, v in by_pair.items() if len(v) > 1}
    if not pairs:
        print("  なし")
    for (pid, amount), ds in sorted(pairs.items(), key=lambda x: -x[0][1]):
        name = partners.get(pid, str(pid))
        print(f"\n  ● {name} … {amount:,}円 × {len(ds)}件")
        for d in ds:
            rids = deal_to_receipts.get(d["id"], [])
            print(f"      取引{d['id']} 発生日{d['issue_date']} 証憑{rids}")
            for rid in rids:
                t = texts.get(str(rid))
                if not t:
                    continue
                body = "\n".join(t["pages"])
                no = find_invoice_no(body) or "(番号なし)"
                head = next((l.strip() for l in body.splitlines()
                             if l.strip() and "請求" not in l), "")[:38]
                print(f"        証憑{rid}: 請求書番号={no}  {head}")

    print("\n" + "=" * 78)
    print(f"重複の疑い: {len(findings)}件")
    for f in findings:
        print(f"  - {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
