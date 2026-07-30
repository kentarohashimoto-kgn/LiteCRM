"""STEP 1 → build までを、擬似的な freee エクスポートで通しで検証する。

ここで守りたいのは完了条件の2つ:
  - freee_import.csv のヘッダーがエクスポート実物と完全一致していること
  - 空欄・推測値がCSVに1件も混入しないこと
"""

import csv
import json
import tempfile
import unittest
from pathlib import Path

from freee_transfer import build as build_mod
from freee_transfer import freee_export, match, records, validate
from freee_transfer.records import Field, Record

# 実物を模したヘッダー。列名は freee 側の表記に合わせて「発明しない」ことの検証用に、
# あえて紛らわしい並びにしてある。
HEADER = [
    "取引先コード", "取引先名", "取引先名(カナ)", "敬称", "担当者名",
    "振込先 銀行名", "振込先 銀行コード", "振込先 支店名", "振込先 支店コード",
    "振込先 口座種別", "振込先 口座番号", "振込先 受取人名", "備考",
]

EXISTING_ROWS = [
    ["1001", "既存商事株式会社", "キゾンショウジ", "御中", "田中",
     "三井住友銀行", "0009", "新宿支店", "234",
     "普通", "0012345", "ｷｿﾞﾝｼﾖｳｼﾞ(ｶ", ""],
    ["1002", "口座未設定株式会社", "コウザミセッテイ", "御中", "",
     "", "", "", "", "", "", "", ""],
]


def write_export(path: Path, encoding: str = "cp932") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding=encoding, newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        writer.writerows(EXISTING_ROWS)


def make_record(record_id="R001", partner="既存商事株式会社") -> Record:
    record = Record(record_id=record_id, source_file="invoice_001.pdf")
    values = {
        "supplier_name": partner,
        "bank_name": "みずほ銀行",
        "bank_code": "0001",
        "branch_name": "渋谷支店",
        "branch_code": "123",
        "account_type": "普通",
        "account_number": "0012345",
        "account_holder_kana": "株式会社カトルセ",
    }
    record.fields = {
        k: Field(value=v, source_file="invoice_001.pdf", source_page=1, confidence="high")
        for k, v in values.items()
    }
    return record


class TestStep1(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.export = self.base / "input/freee_torihikisaki_export.csv"
        write_export(self.export)

    def tearDown(self):
        self._tmp.cleanup()

    def test_detects_shift_jis(self):
        schema = freee_export.read_export(self.export)
        self.assertEqual(schema.encoding, "cp932")

    def test_header_is_read_verbatim(self):
        schema = freee_export.read_export(self.export)
        self.assertEqual(schema.header, HEADER)

    def test_account_columns_are_identified(self):
        schema = freee_export.read_export(self.export)
        self.assertEqual(schema.column_map["bank_name"], "振込先 銀行名")
        self.assertEqual(schema.column_map["bank_code"], "振込先 銀行コード")
        self.assertEqual(schema.column_map["branch_name"], "振込先 支店名")
        self.assertEqual(schema.column_map["branch_code"], "振込先 支店コード")
        self.assertEqual(schema.column_map["account_type"], "振込先 口座種別")
        self.assertEqual(schema.column_map["account_number"], "振込先 口座番号")
        self.assertEqual(schema.column_map["account_holder_kana"], "振込先 受取人名")

    def test_observes_existing_notation(self):
        schema = freee_export.read_export(self.export)
        self.assertEqual(schema.filled_account_rows, 1)
        # 口座種別が「普通」表記であることを実物から学ぶ(1/2 ではない)
        self.assertEqual(schema.observed_values["account_type"], ["普通"])
        self.assertEqual(schema.observed_values["account_number"], ["0012345"])

    def test_header_txt_roundtrip(self):
        schema = freee_export.read_export(self.export)
        dest = self.base / "work/header.txt"
        freee_export.write_header_txt(schema, dest)
        self.assertEqual(freee_export.load_header(dest), HEADER)

    def test_schema_notes_written(self):
        schema = freee_export.read_export(self.export)
        dest = self.base / "work/schema_notes.md"
        freee_export.write_schema_notes(schema, dest)
        text = dest.read_text(encoding="utf-8")
        self.assertIn("振込先 口座番号", text)
        self.assertIn("cp932", text)


class TestMatching(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.export = self.base / "input/freee_torihikisaki_export.csv"
        write_export(self.export)
        self.schema = freee_export.read_export(self.export)
        self.partners = match.load_partner_names(self.export, self.schema)

    def tearDown(self):
        self._tmp.cleanup()

    def test_partner_names_loaded(self):
        self.assertEqual(self.partners, ["既存商事株式会社", "口座未設定株式会社"])

    def test_exact_match_is_confirmed(self):
        result = match.match_one("既存商事株式会社", self.partners)
        self.assertEqual(result.status, "confirmed")
        self.assertEqual(result.partner_name, "既存商事株式会社")

    def test_notation_variant_is_confirmed(self):
        # (株)/株式会社 やスペースの揺れは正規化後に完全一致する
        result = match.match_one("（株）既存商事", self.partners)
        self.assertEqual(result.status, "confirmed")

    def test_similar_name_is_never_auto_confirmed(self):
        result = match.match_one("既存商事ホールディングス株式会社", self.partners)
        self.assertEqual(result.status, "needs_review")
        self.assertTrue(result.candidates)

    def test_unknown_name_is_new(self):
        self.assertEqual(match.match_one("全然違う会社", self.partners).status, "new")

    def test_match_records_does_not_link_on_review(self):
        record = make_record(partner="既存商事ホールディングス株式会社")
        match.match_records([record], self.partners)
        self.assertEqual(record.match_status, "needs_review")
        self.assertEqual(record.freee_partner_name, "")


class TestBuild(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.export = self.base / "input/freee_torihikisaki_export.csv"
        write_export(self.export)
        self.schema = freee_export.read_export(self.export)
        self.header_path = self.base / "work/header.txt"
        freee_export.write_header_txt(self.schema, self.header_path)
        self.map_path = self.base / "work/column_map.json"
        freee_export.write_column_map(self.schema, self.map_path)

    def tearDown(self):
        self._tmp.cleanup()

    def _confirmed_map(self) -> build_mod.ColumnMap:
        data = json.loads(self.map_path.read_text(encoding="utf-8"))
        data["confirmed"] = True
        self.map_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return build_mod.ColumnMap.load(self.map_path)

    def test_column_map_defaults_to_unconfirmed(self):
        self.assertFalse(build_mod.ColumnMap.load(self.map_path).confirmed)

    def test_csv_header_matches_export_exactly(self):
        mapping = self._confirmed_map()
        record = make_record()
        record.match_status = "confirmed"
        record.freee_partner_name = "既存商事株式会社"
        dest = self.base / "output/freee_import.csv"
        build_mod.write_import_csv([record], self.schema.header, mapping, dest)

        with dest.open(encoding=mapping.encoding, newline="") as fh:
            rows = list(csv.reader(fh))
        self.assertEqual(rows[0], HEADER)

    def test_csv_is_written_in_export_encoding(self):
        mapping = self._confirmed_map()
        self.assertEqual(mapping.encoding, "cp932")
        record = make_record()
        record.match_status = "confirmed"
        record.freee_partner_name = "既存商事株式会社"
        dest = self.base / "output/freee_import.csv"
        build_mod.write_import_csv([record], self.schema.header, mapping, dest)
        # utf-8 では読めない = 確かに cp932 で書かれている
        with self.assertRaises(UnicodeDecodeError):
            dest.read_bytes().decode("utf-8")

    def test_row_values_and_kana_normalization(self):
        mapping = self._confirmed_map()
        record = make_record()
        record.match_status = "confirmed"
        record.freee_partner_name = "既存商事株式会社"
        row, problems = build_mod.build_row(record, self.schema.header, mapping)
        self.assertEqual(problems, [])
        self.assertEqual(row["取引先名"], "既存商事株式会社")
        self.assertEqual(row["振込先 口座番号"], "0012345")  # 先頭ゼロが残る
        self.assertEqual(row["振込先 受取人名"], "ｶ)ｶﾄﾙｾ")
        self.assertEqual(row["振込先 口座種別"], "普通")
        # マッピングのない列は空欄のまま(勝手に埋めない)
        self.assertEqual(row["備考"], "")
        self.assertEqual(row["敬称"], "")

    def test_leading_zero_survives_csv_roundtrip(self):
        mapping = self._confirmed_map()
        record = make_record()
        record.match_status = "confirmed"
        record.freee_partner_name = "既存商事株式会社"
        dest = self.base / "output/freee_import.csv"
        build_mod.write_import_csv([record], self.schema.header, mapping, dest)
        with dest.open(encoding=mapping.encoding, newline="") as fh:
            row = list(csv.DictReader(fh))[0]
        self.assertEqual(row["振込先 口座番号"], "0012345")

    def test_unverified_record_never_reaches_csv(self):
        mapping = self._confirmed_map()
        record = make_record()
        record.match_status = "confirmed"
        record.freee_partner_name = "既存商事株式会社"
        record.fields["account_number"].confidence = "medium"

        ok, issues = validate.partition([record], expected_input_count=1)
        self.assertEqual(ok, [])
        dest = self.base / "output/freee_import.csv"
        written, _ = build_mod.write_import_csv(ok, self.schema.header, mapping, dest)
        self.assertEqual(written, 0)
        with dest.open(encoding=mapping.encoding, newline="") as fh:
            self.assertEqual(len(list(csv.reader(fh))), 1)  # ヘッダーのみ

        review = self.base / "output/review.md"
        build_mod.write_review_md([record], issues, {}, review)
        text = review.read_text(encoding="utf-8")
        self.assertIn("invoice_001.pdf", text)  # 原本の参照先が載っている
        self.assertIn("口座番号", text)

    def test_summary_reports_counts(self):
        dest = self.base / "output/summary.md"
        build_mod.write_summary_md(dest, total=30, confirmed=24, review=6,
                                   input_files=30, notes=["テスト"])
        text = dest.read_text(encoding="utf-8")
        self.assertIn("| 確定(CSVへ出力) | 24 |", text)
        self.assertIn("| 要確認(review.md) | 6 |", text)


class TestRecordsIO(unittest.TestCase):
    def test_roundtrip_preserves_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "extracted.json"
            record = make_record()
            records.save_records(path, [record], meta={"input_file_count": 1})
            loaded = records.load_records(path)[0]
        self.assertEqual(loaded.record_id, "R001")
        field = loaded.get("account_number")
        self.assertEqual(field.value, "0012345")
        self.assertEqual(field.source_file, "invoice_001.pdf")
        self.assertEqual(field.source_page, 1)
        self.assertEqual(field.confidence, "high")

    def test_bare_string_value_is_treated_as_unverified(self):
        field = records.Field.from_dict("1234567")
        self.assertEqual(field.value, "1234567")
        self.assertEqual(field.confidence, "low")


if __name__ == "__main__":
    unittest.main()
