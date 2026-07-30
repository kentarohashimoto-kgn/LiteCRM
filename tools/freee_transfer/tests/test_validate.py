import unittest

from freee_transfer.records import Field, Record
from freee_transfer.validate import BLOCKER, partition, validate_dataset, validate_record


def make_record(record_id="R001", confidence="high", **overrides) -> Record:
    base = {
        "supplier_name": "株式会社カトルセ",
        "bank_name": "みずほ銀行",
        "bank_code": "0001",
        "branch_name": "渋谷支店",
        "branch_code": "123",
        "account_type": "普通",
        "account_number": "1234567",
        "account_holder_kana": "カブシキガイシャカトルセ",
    }
    base.update(overrides)
    record = Record(record_id=record_id, source_file="invoice.pdf")
    record.fields = {
        name: Field(value=value, source_file="invoice.pdf", source_page=1,
                    confidence=confidence)
        for name, value in base.items()
        if value is not None
    }
    record.match_status = "confirmed"
    record.freee_partner_name = "株式会社カトルセ"
    return record


def codes(issues):
    return {i.code for i in issues}


class TestValidateRecord(unittest.TestCase):
    def test_clean_record_has_no_issues(self):
        self.assertEqual(validate_record(make_record()), [])

    def test_missing_required_field(self):
        record = make_record(account_number=None)
        self.assertIn("missing_required", codes(validate_record(record)))

    def test_optional_code_may_be_empty(self):
        record = make_record(bank_code="", branch_code="")
        self.assertEqual(validate_record(record), [])

    def test_account_number_must_be_digits(self):
        record = make_record(account_number="123-4567")
        self.assertIn("account_number_not_digits", codes(validate_record(record)))

    def test_leading_zero_account_number_is_valid(self):
        record = make_record(account_number="0012345")
        self.assertEqual(validate_record(record), [])

    def test_bank_code_must_be_4_digits(self):
        self.assertIn("bank_code_format", codes(validate_record(make_record(bank_code="1"))))
        self.assertIn("bank_code_format", codes(validate_record(make_record(bank_code="00A1"))))

    def test_branch_code_must_be_3_digits(self):
        self.assertIn("branch_code_format", codes(validate_record(make_record(branch_code="12"))))

    def test_kana_too_long(self):
        record = make_record(account_holder_kana="ガ" * 16)
        self.assertIn("kana_too_long", codes(validate_record(record)))

    def test_kana_invalid_chars(self):
        record = make_record(account_holder_kana="山田太郎")
        self.assertIn("kana_invalid_chars", codes(validate_record(record)))

    def test_unverified_value_is_blocked(self):
        record = make_record(confidence="medium")
        issues = [i for i in validate_record(record) if i.code == "unverified_value"]
        self.assertTrue(issues)
        self.assertTrue(all(i.severity == BLOCKER for i in issues))

    def test_needs_review_match_is_blocked(self):
        record = make_record()
        record.match_status = "needs_review"
        record.match_candidates = ["株式会社カトルセ商事"]
        self.assertIn("match_needs_review", codes(validate_record(record)))

    def test_unknown_account_type_is_warning_only(self):
        record = make_record(account_type="総合")
        issues = [i for i in validate_record(record) if i.code == "account_type_unknown"]
        self.assertTrue(issues)
        self.assertNotEqual(issues[0].severity, BLOCKER)

    def test_issue_carries_source_reference(self):
        record = make_record(account_holder_kana="山田太郎")
        issue = next(i for i in validate_record(record) if i.code == "kana_invalid_chars")
        self.assertEqual(issue.source_ref, "invoice.pdf p.1")


class TestValidateDataset(unittest.TestCase):
    def test_duplicate_partner_detected(self):
        records = [make_record("R001"), make_record("R002")]
        self.assertIn("duplicate_partner", codes(validate_dataset(records)))

    def test_count_mismatch_detected(self):
        issues = validate_dataset([make_record()], expected_input_count=3)
        self.assertIn("count_mismatch", codes(issues))

    def test_count_match_is_silent(self):
        self.assertEqual(validate_dataset([make_record()], expected_input_count=1), [])


class TestPartition(unittest.TestCase):
    def test_clean_record_passes(self):
        ok, issues = partition([make_record()], expected_input_count=1)
        self.assertEqual([r.record_id for r in ok], ["R001"])
        self.assertFalse(issues.get("R001"))

    def test_blocked_record_is_excluded(self):
        bad = make_record("R002", account_number="abc")
        ok, issues = partition([make_record("R001"), bad], expected_input_count=2)
        self.assertEqual([r.record_id for r in ok], ["R001"])
        self.assertIn("account_number_not_digits", codes(issues["R002"]))

    def test_warning_only_record_still_passes(self):
        record = make_record(account_type="総合")
        ok, _ = partition([record], expected_input_count=1)
        self.assertEqual(len(ok), 1)

    def test_count_mismatch_blocks_nothing_but_is_reported(self):
        ok, issues = partition([make_record()], expected_input_count=5)
        self.assertEqual(len(ok), 1)
        self.assertIn("count_mismatch", codes(issues["-"]))


if __name__ == "__main__":
    unittest.main()
