"""抽出候補(STEP 2)の検証。

ここでの合格基準は「よく当たること」ではなく、
**当たっていない値を high として通さないこと**。
"""

import unittest
from pathlib import Path

from freee_transfer.extract import ExtractedDocument, PageText, build_candidate_record

INVOICE_TEXT = """請求書
株式会社カトルセ 御中
請求元: 株式会社サンプル商会
お振込先
金融機関名: みずほ銀行
銀行コード: 0001
支店名: 渋谷支店
支店コード: 123
普通預金
口座番号: 0123456
フリガナ: カブシキガイシャサンプルシヨウカイ
口座名義: 株式会社サンプル商会
振込手数料は御社にてご負担ください
"""


def make_doc(text: str, name: str = "invoice_001.pdf") -> ExtractedDocument:
    return ExtractedDocument(path=Path(name), pages=[PageText(page=1, text=text)])


class TestCandidateExtraction(unittest.TestCase):
    def setUp(self):
        self.record = build_candidate_record(make_doc(INVOICE_TEXT), "R001")

    def test_bank_name(self):
        self.assertEqual(self.record.value("bank_name"), "みずほ銀行")

    def test_branch_name_is_not_the_label(self):
        # 「支店名」というラベル自体を値として拾わないこと
        self.assertEqual(self.record.value("branch_name"), "渋谷支店")

    def test_codes(self):
        self.assertEqual(self.record.value("bank_code"), "0001")
        self.assertEqual(self.record.value("branch_code"), "123")

    def test_account_type_and_number(self):
        self.assertEqual(self.record.value("account_type"), "普通")
        self.assertEqual(self.record.value("account_number"), "0123456")

    def test_kana(self):
        self.assertEqual(
            self.record.value("account_holder_kana"), "カブシキガイシャサンプルシヨウカイ"
        )

    def test_fee_bearer_captured(self):
        self.assertIn("振込手数料", self.record.value("transfer_fee_bearer"))

    def test_never_emits_high_confidence(self):
        # 自動抽出だけで high は付かない。high は目視確認した人間/エージェントのみ。
        for name, field in self.record.fields.items():
            self.assertNotEqual(field.confidence, "high", name)

    def test_supplier_name_is_left_empty(self):
        # 請求元名称はレイアウト依存。推測で埋めるより空欄にして要確認へ回す。
        self.assertEqual(self.record.value("supplier_name"), "")

    def test_provenance_is_recorded(self):
        field = self.record.get("account_number")
        self.assertEqual(field.source_file, "invoice_001.pdf")
        self.assertEqual(field.source_page, 1)


class TestAmbiguousDocuments(unittest.TestCase):
    def test_multiple_banks_lowers_confidence(self):
        text = "みずほ銀行 渋谷支店\n三菱UFJ銀行 新宿支店\n口座番号: 1234567"
        record = build_candidate_record(make_doc(text), "R001")
        field = record.get("bank_name")
        self.assertEqual(field.confidence, "low")
        self.assertIn("候補が", field.note)

    def test_unlabeled_account_number_is_low_confidence(self):
        text = "みずほ銀行 渋谷支店\n普通 1234567"
        record = build_candidate_record(make_doc(text), "R001")
        field = record.get("account_number")
        self.assertEqual(field.value, "1234567")
        self.assertEqual(field.confidence, "low")

    def test_empty_document_yields_empty_fields(self):
        record = build_candidate_record(make_doc(""), "R001")
        for name, field in record.fields.items():
            self.assertTrue(field.is_empty, name)

    def test_read_error_forces_low_confidence(self):
        doc = make_doc(INVOICE_TEXT)
        doc.error = "PDFの読み取りに失敗"
        record = build_candidate_record(doc, "R001")
        for name, field in record.fields.items():
            self.assertEqual(field.confidence, "low", name)


class TestScannedPages(unittest.TestCase):
    def test_thin_text_layer_is_flagged(self):
        self.assertTrue(PageText(page=1, text="").needs_visual_read)
        self.assertTrue(PageText(page=1, text="請求書").needs_visual_read)
        self.assertFalse(PageText(page=1, text=INVOICE_TEXT).needs_visual_read)

    def test_scanned_pages_listed(self):
        doc = ExtractedDocument(
            path=Path("a.pdf"),
            pages=[PageText(1, INVOICE_TEXT), PageText(2, ""), PageText(3, "  ")],
        )
        self.assertEqual(doc.scanned_pages, [2, 3])


if __name__ == "__main__":
    unittest.main()
