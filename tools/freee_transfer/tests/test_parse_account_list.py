"""口座一覧の取込みで、取引先を1件に特定できない行を確定させないことを検証する。

口座を別の取引先へ紐付けると、他社の口座へ送金される。
表記ゆれ(全角/半角・空白)は吸収するが、名前が違うものは寄せない。
"""

import unittest

from scripts_freee.parse_account_list import normalize, parse_section_a, split_name_code

DOC = """# 見出し

## A. そのまま登録できる

| 取引先 | 金融機関 | 支店 | 種別 | 口座番号 | 受取人名 |
|---|---|---|---|---|---|
| 株式会社アルファ | みずほ銀行(0001) | 渋谷支店(162) | ordinary | 0012345 | ｶ)ｱﾙﾌｱ |
| 田中　太郎 | 三井住友銀行(0009) | 新宿支店(221) | ordinary | 7654321 | ﾀﾅｶ ﾀﾛｳ |

## B. 推定したもの

| 推定した取引先 | 金融機関 | 支店 | 口座番号 | 受取人名 | 実績 | 最新 |
|---|---|---|---|---|---:|---|
| 株式会社ベータ | 楽天銀行(0036) | 第一営業支店(251) | 1111111 | ｶ)ﾍﾞｰﾀ | 3件 | 2026-01-01 |
"""


class ParseSectionATest(unittest.TestCase):
    def test_Aの表だけを読みBは読まない(self):
        rows = parse_section_a(DOC)
        self.assertEqual([r["partner_name"] for r in rows],
                         ["株式会社アルファ", "田中　太郎"])

    def test_口座番号の先頭ゼロを文字列で保つ(self):
        rows = parse_section_a(DOC)
        self.assertEqual(rows[0]["account_number"], "0012345")
        self.assertIsInstance(rows[0]["account_number"], str)

    def test_金融機関名とコードを分ける(self):
        self.assertEqual(split_name_code("みずほ銀行(0001)"), ("みずほ銀行", "0001"))
        # 全角括弧の表記も同じ扱いにする
        self.assertEqual(split_name_code("三菱ＵＦＪ銀行（0005）"), ("三菱ＵＦＪ銀行", "0005"))


class NormalizeTest(unittest.TestCase):
    def test_全角半角と空白のゆれを吸収する(self):
        self.assertEqual(normalize("田中　太郎"), normalize("田中 太郎"))
        self.assertEqual(normalize("株式会社ＡＢＣ"), normalize("株式会社ABC"))

    def test_別の取引先名は一致させない(self):
        # 部分一致で寄せると他社の口座へ送金する
        self.assertNotEqual(normalize("株式会社アルファ"), normalize("株式会社アルファ商事"))
        self.assertNotEqual(normalize("田中太郎"), normalize("田中太郎商店"))

    def test_法人格を落とさない(self):
        # 「株式会社A」と「合同会社A」は別法人
        self.assertNotEqual(normalize("株式会社A"), normalize("合同会社A"))


if __name__ == "__main__":
    unittest.main()
