"""コマンドラインインターフェース。

    python -m freee_transfer preflight   入力3点が揃っているか確認(足りなければ報告して停止)
    python -m freee_transfer step1       freee CSV仕様の確定 → work/header.txt, schema_notes.md
    python -m freee_transfer step2       請求書から候補抽出 → work/extracted.json, work/pages/
    python -m freee_transfer step3       名寄せ → work/matching.md
    python -m freee_transfer build       検証と成果物出力 → output/
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import build as build_mod
from . import extract as extract_mod
from . import freee_export, match, records, validate

EXPORT_CSV = Path("input/freee_torihikisaki_export.csv")
INVOICE_DIR = Path("input/invoices")
PAYMENT_LIST = Path("input/payment_list.csv")

WORK = Path("work")
OUTPUT = Path("output")
HEADER_TXT = WORK / "header.txt"
COLUMN_MAP = WORK / "column_map.json"
SCHEMA_NOTES = WORK / "schema_notes.md"
EXTRACTED = WORK / "extracted.json"
MATCHING = WORK / "matching.md"
PAGES = WORK / "pages"


def _resolve(base: Path, path: Path) -> Path:
    return path if path.is_absolute() else base / path


def cmd_preflight(args: argparse.Namespace) -> int:
    base = Path(args.base)
    missing: list[str] = []

    export = _resolve(base, EXPORT_CSV)
    if not export.exists():
        missing.append(f"freee からエクスポートした既存の取引先CSV: `{EXPORT_CSV}`")

    invoices = _resolve(base, INVOICE_DIR)
    found = extract_mod.list_invoices(invoices)
    if not invoices.exists():
        missing.append(f"請求書ファイル一式(PDF/画像): `{INVOICE_DIR}/`")
    elif not found:
        missing.append(f"請求書ファイル一式(PDF/画像): `{INVOICE_DIR}/` は空")

    payment_list = _resolve(base, PAYMENT_LIST)
    if not payment_list.exists():
        missing.append(f"支払対象一覧(freee 支払管理レポート): `{PAYMENT_LIST}`")

    if missing:
        print("作業を開始できません。以下が不足しています:\n")
        for item in missing:
            print(f"  - {item}")
        print("\n上記を配置してから再実行してください。")
        return 1

    print("入力3点が揃っています。")
    print(f"  - 取引先エクスポート: {export}")
    print(f"  - 請求書: {len(found)} ファイル")
    print(f"  - 支払対象一覧: {payment_list}")
    return 0


def cmd_step1(args: argparse.Namespace) -> int:
    base = Path(args.base)
    export = _resolve(base, EXPORT_CSV)
    try:
        schema = freee_export.read_export(export)
    except freee_export.ExportReadError as exc:
        print(f"STEP 1 失敗: {exc}", file=sys.stderr)
        return 1

    freee_export.write_header_txt(schema, _resolve(base, HEADER_TXT))
    freee_export.write_column_map(schema, _resolve(base, COLUMN_MAP))
    freee_export.write_schema_notes(schema, _resolve(base, SCHEMA_NOTES))

    print(f"文字コード: {schema.encoding} / 列数: {len(schema.header)} / 行数: {schema.row_count}")
    print(f"口座登録済みの行: {schema.filled_account_rows}")
    if schema.filled_account_rows == 0:
        print("警告: 口座登録済みの行が0件。記法サンプルが採れないため、"
              "freee で1件だけ手入力し再エクスポートすること。")
    if schema.ambiguous:
        print("要確認(列の候補が複数): " + "、".join(schema.ambiguous))
    if schema.missing:
        print("要確認(該当列なし): " + "、".join(schema.missing))
    print(f"出力: {HEADER_TXT}, {COLUMN_MAP}, {SCHEMA_NOTES}")
    return 0


def cmd_step2(args: argparse.Namespace) -> int:
    base = Path(args.base)
    invoices = _resolve(base, INVOICE_DIR)
    found = extract_mod.list_invoices(invoices)
    if not found:
        print(f"{INVOICE_DIR}/ に請求書がありません。", file=sys.stderr)
        return 1

    recs, docs = extract_mod.extract_all(invoices, _resolve(base, PAGES))
    dest = _resolve(base, EXTRACTED)
    if dest.exists() and not args.force:
        print(f"{EXTRACTED} が既にあります。上書きするには --force を付けてください。"
              "(目視確認済みの内容を消さないための保護)", file=sys.stderr)
        return 1

    records.save_records(dest, recs, meta={"input_file_count": len(found)})

    scanned = {d.path.name: d.scanned_pages for d in docs if d.scanned_pages}
    errors = [(d.path.name, d.error) for d in docs if d.error]
    print(f"{len(found)} ファイルから {len(recs)} 件の候補を抽出しました → {EXTRACTED}")
    if scanned:
        print(f"テキストレイヤーが薄いページを PNG 化しました → {PAGES}/")
        for name, pages in scanned.items():
            print(f"  - {name}: p.{', p.'.join(str(p) for p in pages)}")
    for name, err in errors:
        print(f"  ! {name}: {err}")
    print("\nすべての値は confidence=medium 以下です。原本を目視して確認し、"
          "確定した項目のみ high に更新してください。")
    return 0


def cmd_step3(args: argparse.Namespace) -> int:
    base = Path(args.base)
    extracted = _resolve(base, EXTRACTED)
    if not extracted.exists():
        print(f"{EXTRACTED} がありません。先に step2 を実行してください。", file=sys.stderr)
        return 1

    schema = None
    export = _resolve(base, EXPORT_CSV)
    if export.exists():
        schema = freee_export.read_export(export)
    partner_names = match.load_partner_names(export, schema)

    recs = records.load_records(extracted)
    results = match.match_records(recs, partner_names)
    records.save_records(extracted, recs, meta={"partner_count": len(partner_names)})
    match.write_matching_md(results, _resolve(base, MATCHING))

    counts = {"confirmed": 0, "needs_review": 0, "new": 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(f"[確定] {counts['confirmed']}件 / [要確認] {counts['needs_review']}件 "
          f"/ [新規] {counts['new']}件 → {MATCHING}")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    base = Path(args.base)
    header_path = _resolve(base, HEADER_TXT)
    map_path = _resolve(base, COLUMN_MAP)
    extracted = _resolve(base, EXTRACTED)

    for path, hint in (
        (header_path, "step1"),
        (map_path, "step1"),
        (extracted, "step2"),
    ):
        if not path.exists():
            print(f"{path} がありません。先に {hint} を実行してください。", file=sys.stderr)
            return 1

    header = freee_export.load_header(header_path)
    mapping = build_mod.ColumnMap.load(map_path)
    if not mapping.confirmed and not args.allow_unconfirmed:
        print(f"{COLUMN_MAP} の confirmed が false です。"
              "列の対応を人間が確認し true にしてください(暫定実行は --allow-unconfirmed)。",
              file=sys.stderr)
        return 1

    recs = records.load_records(extracted)
    input_count = len(extract_mod.list_invoices(_resolve(base, INVOICE_DIR))) or None
    ok, issues_by_record = validate.partition(recs, input_count)

    written, rejected = build_mod.write_import_csv(
        ok, header, mapping, _resolve(base, OUTPUT / "freee_import.csv")
    )
    review_count = build_mod.write_review_md(
        recs, issues_by_record, rejected, _resolve(base, OUTPUT / "review.md")
    )
    notes: list[str] = []
    if rejected:
        notes.append(f"列マッピングまたは書式の問題でCSVから除外した行が {len(rejected)} 件")
    if input_count and len(recs) != input_count:
        notes.append(f"抽出件数 {len(recs)} 件が入力ファイル数 {input_count} 件と不一致")
    notes.append(
        "freee の振込依頼人コード(委託者コード)は PayPay銀行 WEB総振では不要。"
        "全銀ファイル出力後に該当箇所をスペースへ置換する後処理が別途必要"
    )
    build_mod.write_summary_md(
        _resolve(base, OUTPUT / "summary.md"),
        total=len(recs),
        confirmed=written,
        review=review_count,
        input_files=input_count or 0,
        notes=notes,
    )

    print(f"確定 {written}件 / 要確認 {review_count}件")
    print(f"出力: {OUTPUT}/freee_import.csv, {OUTPUT}/review.md, {OUTPUT}/summary.md")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="freee_transfer", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--base", default=".", help="input/ work/ output/ の親ディレクトリ")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("preflight", help="入力3点の存在確認").set_defaults(func=cmd_preflight)
    sub.add_parser("step1", help="freee CSV仕様の確定").set_defaults(func=cmd_step1)

    p2 = sub.add_parser("step2", help="請求書から候補抽出")
    p2.add_argument("--force", action="store_true", help="既存の extracted.json を上書きする")
    p2.set_defaults(func=cmd_step2)

    sub.add_parser("step3", help="freee 取引先との名寄せ").set_defaults(func=cmd_step3)

    pb = sub.add_parser("build", help="検証と成果物出力")
    pb.add_argument("--allow-unconfirmed", action="store_true",
                    help="column_map.json が未確認でも実行する(暫定確認用)")
    pb.set_defaults(func=cmd_build)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
