"""請求書 → freee 取引先マスタ「振込先口座」インポートCSV 生成パイプライン。

指示書(freee取引先インポート仕様書)の STEP 1〜6 に対応するモジュール群。
中心にあるのは1つの原則: **推測で埋めない**。
"""

__all__ = [
    "build",
    "cli",
    "extract",
    "freee_export",
    "kana",
    "match",
    "records",
    "validate",
]
