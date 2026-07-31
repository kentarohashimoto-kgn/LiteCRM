"""消込計画の復元で、組合せが一意に決まらないときに確定しないことを検証する。

「合計が合う32件」は1通りとは限らない。別の組合せを選ぶと、
消込は帳尻が合ったように見えて、実際には払っていない取引が消し込まれ、
払った取引が未払いのまま残る。金額の一致は正しさの証明にならない。
"""

import unittest

from scripts_freee.rebuild_reconcile_plan import find_exclusions


def deal(deal_id: int, amount: int) -> dict:
    return {"id": deal_id, "due_amount": amount}


class FindExclusionsTest(unittest.TestCase):
    def test_一意に決まる場合は1通りだけ返す(self):
        pool = [deal(1, 100), deal(2, 250), deal(3, 700)]
        found = find_exclusions(pool, 250)
        self.assertEqual(len(found), 1)
        self.assertEqual([d["id"] for d in found[0]], [2])

    def test_合計が同じ別組合せがあれば全部返す(self):
        # 250 の1件でも、100+150 の2件でも差額を説明できてしまう
        pool = [deal(1, 100), deal(2, 250), deal(3, 150), deal(4, 700)]
        found = find_exclusions(pool, 250)
        self.assertEqual(len(found), 2)
        self.assertEqual(
            sorted(sorted(d["id"] for d in c) for c in found), [[1, 3], [2]]
        )

    def test_説明できない差額では何も返さない(self):
        pool = [deal(1, 100), deal(2, 250)]
        self.assertEqual(find_exclusions(pool, 999), [])

    def test_件数の少ない組合せから順に見つかる(self):
        pool = [deal(1, 300), deal(2, 100), deal(3, 200)]
        found = find_exclusions(pool, 300)
        # 1件(300) が 2件(100+200) より先に来る
        self.assertEqual([d["id"] for d in found[0]], [1])
        self.assertEqual(sorted(d["id"] for d in found[1]), [2, 3])


if __name__ == "__main__":
    unittest.main()
