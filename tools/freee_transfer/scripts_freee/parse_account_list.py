"""確認済みの口座一覧(Markdown)を読み、freee の取引先IDへ突き合わせる。

入力は人間が確認を終えた `work/account_list.md`。
見出し「## A.」の表だけを読む。B(推定)・C(特定できず)は確認が済んでいないので触らない。

取引先の特定は **正規化後の完全一致のみ**。`match.py` と同じ方針で、
部分一致や類似度では確定しない。別の取引先へ口座を紐付けると他社へ送金される。

出力:
    work/partner_account_registrations.json  取引先IDが確定した行
    work/account_list_unmatched.md           取引先を特定できなかった行
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
WORK = BASE / "work"

#: 「PayPay銀行(0033)」「三菱ＵＦＪ銀行(0005)」から名称とコードを分ける
NAME_CODE = re.compile(r"^(.*?)[(（]([0-9]{3,4})[)）]$")


def normalize(name: str) -> str:
    """全角/半角・空白・記号のゆれを吸収する(照合用のキーであって表示用ではない)。"""
    s = unicodedata.normalize("NFKC", name)
    s = re.sub(r"[\s　]+", "", s)
    # 株式会社/合同会社の表記位置は変えない。取り違えの元になるため除去もしない。
    return s.translate(str.maketrans("（）・", "()·"))


def split_name_code(cell: str) -> tuple[str, str]:
    m = NAME_CODE.match(cell.strip())
    if not m:
        return cell.strip(), ""
    return m.group(1).strip(), m.group(2).strip()


def parse_section_a(text: str) -> list[dict]:
    """「## A.」直後の表だけを読む。次の見出しに当たったら止める。"""
    lines = text.splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith("## A."))
    except StopIteration:
        sys.exit("見出し '## A.' が見つからない")

    rows = []
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 6:
            continue
        if cells[0] in ("取引先", "---") or set(cells[0]) <= {"-", ":"}:
            continue
        partner, bank, branch, acct_type, number, holder = cells
        bank_name, bank_code = split_name_code(bank)
        branch_name, branch_code = split_name_code(branch)
        rows.append({
            "partner_name": partner,
            "bank_name": bank_name, "bank_code": bank_code,
            "branch_name": branch_name, "branch_code": branch_code,
            "account_type": acct_type,
            # 口座番号は常に文字列。先頭ゼロが意味を持つ
            "account_number": number,
            "account_name": holder,
        })
    return rows


def main() -> int:
    src = WORK / "account_list.md"
    if not src.exists():
        sys.exit(f"入力がない: {src}")
    rows = parse_section_a(src.read_text(encoding="utf-8"))

    partners = json.loads((WORK / "partners.json").read_text(encoding="utf-8"))["partners"]
    by_name: dict[str, list[dict]] = {}
    for p in partners:
        by_name.setdefault(normalize(p["name"]), []).append(p)

    matched, unmatched = [], []
    for r in rows:
        cands = by_name.get(normalize(r["partner_name"]), [])
        if len(cands) == 1:
            matched.append({**r, "partner_id": cands[0]["id"]})
        else:
            reason = "該当なし" if not cands else f"同名が{len(cands)}件"
            unmatched.append({**r, "reason": reason,
                              "candidates": [(p["id"], p["name"]) for p in cands]})

    (WORK / "partner_account_registrations.json").write_text(
        json.dumps({"registrations": matched}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    lines = ["# 取引先を特定できなかった口座", ""]
    if not unmatched:
        lines.append("なし。A の全行で取引先IDが確定した。")
    else:
        lines += ["| 取引先(一覧の表記) | 理由 | 候補 |", "|---|---|---|"]
        for u in unmatched:
            cand = " / ".join(f"{i}:{n}" for i, n in u["candidates"]) or "-"
            lines.append(f"| {u['partner_name']} | {u['reason']} | {cand} |")
    (WORK / "account_list_unmatched.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"A の行数: {len(rows)}")
    print(f"  取引先ID確定: {len(matched)}件")
    print(f"  特定できず  : {len(unmatched)}件")
    for u in unmatched:
        print(f"    - {u['partner_name']} ({u['reason']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
