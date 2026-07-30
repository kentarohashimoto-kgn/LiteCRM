import unittest

from freee_transfer.kana import MAX_KANA_LENGTH, is_allowed_char, normalize_kana


class TestLegalEntity(unittest.TestCase):
    def test_maezabu(self):
        # 指示書 §4 の例
        self.assertEqual(normalize_kana("株式会社カトルセ").normalized, "ｶ)ｶﾄﾙｾ")

    def test_atokabu(self):
        self.assertEqual(normalize_kana("カトルセ株式会社").normalized, "ｶﾄﾙｾ(ｶ")

    def test_kana_written_legal_entity(self):
        self.assertEqual(normalize_kana("カブシキガイシャカトルセ").normalized, "ｶ)ｶﾄﾙｾ")
        self.assertEqual(normalize_kana("カトルセカブシキガイシャ").normalized, "ｶﾄﾙｾ(ｶ")

    def test_symbol_forms(self):
        self.assertEqual(normalize_kana("（株）カトルセ").normalized, "ｶ)ｶﾄﾙｾ")
        self.assertEqual(normalize_kana("㈱カトルセ").normalized, "ｶ)ｶﾄﾙｾ")

    def test_yugen_godo_shadan(self):
        self.assertEqual(normalize_kana("有限会社ヤマダ").normalized, "ﾕ)ﾔﾏﾀﾞ")
        self.assertEqual(normalize_kana("合同会社ヤマダ").normalized, "ﾄﾞ)ﾔﾏﾀﾞ")
        self.assertEqual(normalize_kana("一般社団法人ヤマダ").normalized, "ｼﾔ)ﾔﾏﾀﾞ")
        self.assertEqual(normalize_kana("ヤマダ合同会社").normalized, "ﾔﾏﾀﾞ(ﾄﾞ")

    def test_already_abbreviated_is_untouched(self):
        self.assertEqual(normalize_kana("ｶ)ｶﾄﾙｾ").normalized, "ｶ)ｶﾄﾙｾ")
        self.assertEqual(normalize_kana("ｶﾄﾙｾ(ｶ").normalized, "ｶﾄﾙｾ(ｶ")

    def test_legal_entity_only_is_not_stripped(self):
        # 社名が空になる置換はしない
        self.assertEqual(normalize_kana("株式会社").normalized, "株式会社")


class TestCharacterConversion(unittest.TestCase):
    def test_fullwidth_katakana_to_halfwidth(self):
        self.assertEqual(normalize_kana("カトルセ").normalized, "ｶﾄﾙｾ")

    def test_dakuten_becomes_separate_char(self):
        result = normalize_kana("ガギグ")
        self.assertEqual(result.normalized, "ｶﾞｷﾞｸﾞ")
        # 濁点は独立した1文字として数える
        self.assertEqual(result.length, 6)

    def test_handakuten(self):
        self.assertEqual(normalize_kana("パピプペポ").normalized, "ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ")

    def test_vu(self):
        self.assertEqual(normalize_kana("ヴァイオリン").normalized, "ｳﾞｱｲｵﾘﾝ")

    def test_small_kana_becomes_large(self):
        self.assertEqual(normalize_kana("キヤノン").normalized, "ｷﾔﾉﾝ")
        self.assertEqual(normalize_kana("キャノン").normalized, "ｷﾔﾉﾝ")
        self.assertEqual(normalize_kana("ニッポン").normalized, "ﾆﾂﾎﾟﾝ")
        self.assertEqual(normalize_kana("ｷｬﾉﾝ").normalized, "ｷﾔﾉﾝ")

    def test_long_vowel_mark(self):
        self.assertEqual(normalize_kana("コーヒー").normalized, "ｺｰﾋｰ")

    def test_fullwidth_space_and_alnum(self):
        self.assertEqual(normalize_kana("ＡＢＣ　１２３").normalized, "ABC 123")

    def test_lowercase_becomes_uppercase(self):
        self.assertEqual(normalize_kana("abc").normalized, "ABC")

    def test_symbols(self):
        self.assertEqual(normalize_kana("（カ）／．，－").normalized, "(ｶ)/.,-")

    def test_hiragana_is_converted_with_a_note(self):
        result = normalize_kana("かとるせ")
        self.assertEqual(result.normalized, "ｶﾄﾙｾ")
        self.assertTrue(any("ひらがな" in n for n in result.notes))

    def test_consecutive_spaces_collapsed(self):
        self.assertEqual(normalize_kana("ヤマダ　　タロウ").normalized, "ﾔﾏﾀﾞ ﾀﾛｳ")

    def test_empty_input(self):
        result = normalize_kana(None)
        self.assertEqual(result.normalized, "")
        self.assertFalse(result.is_clean)


class TestInvalidCharacters(unittest.TestCase):
    def test_kanji_is_reported_not_dropped(self):
        result = normalize_kana("山田太郎")
        # 漢字からカナを生成しない。落とさずに残して要確認へ回す。
        self.assertEqual(result.normalized, "山田太郎")
        self.assertEqual(result.invalid_chars, ["太", "山", "田", "郎"])
        self.assertFalse(result.is_clean)

    def test_nakaguro_is_flagged(self):
        result = normalize_kana("ジョン・スミス")
        self.assertIn("・", result.invalid_chars)
        self.assertFalse(result.is_clean)

    def test_allowed_symbols(self):
        for ch in " .-()/,｢｣¥":
            self.assertTrue(is_allowed_char(ch), ch)
        for ch in "・。、*#&":
            self.assertFalse(is_allowed_char(ch), ch)

    def test_halfwidth_katakana_range_allowed(self):
        for ch in "ｦｱﾝｰﾞﾟ":
            self.assertTrue(is_allowed_char(ch), ch)


class TestLength(unittest.TestCase):
    def test_within_limit_is_clean(self):
        result = normalize_kana("カ" * 30)
        self.assertEqual(result.length, 30)
        self.assertTrue(result.is_clean)

    def test_over_limit_flagged(self):
        result = normalize_kana("カ" * 31)
        self.assertEqual(result.length, 31)
        self.assertFalse(result.is_clean)
        self.assertTrue(any("超過" in n for n in result.notes))

    def test_dakuten_counts_toward_limit(self):
        # ガ×16 = 32文字(濁点込み)で上限超過になる
        result = normalize_kana("ガ" * 16)
        self.assertEqual(result.length, 32)
        self.assertGreater(result.length, MAX_KANA_LENGTH)
        self.assertFalse(result.is_clean)


if __name__ == "__main__":
    unittest.main()
