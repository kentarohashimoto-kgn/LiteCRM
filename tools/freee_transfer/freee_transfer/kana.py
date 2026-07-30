"""口座名義カナの正規化(全銀フォーマット準拠)。

指示書 §4 のルールをそのまま実装する。
ここで行うのは **表記の変換だけ** であり、読み方の生成(漢字→カナ)は一切行わない。
変換できない文字・判断が割れる文字は落とさずに残し、`invalid_chars` として報告する。
呼び出し側はそれを要確認(review.md)へ回すこと。
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: PayPay銀行 WEB総振の上限。濁点・半濁点は独立した1文字として数える。
MAX_KANA_LENGTH = 30

# --- 全角カタカナ → 半角カタカナ ------------------------------------------------
# 小書き文字(ァィゥェォャュョッ)は §4 のルールにより大文字へ置換する。
_KATAKANA: dict[str, str] = {
    "ア": "ｱ", "イ": "ｲ", "ウ": "ｳ", "エ": "ｴ", "オ": "ｵ",
    "カ": "ｶ", "キ": "ｷ", "ク": "ｸ", "ケ": "ｹ", "コ": "ｺ",
    "サ": "ｻ", "シ": "ｼ", "ス": "ｽ", "セ": "ｾ", "ソ": "ｿ",
    "タ": "ﾀ", "チ": "ﾁ", "ツ": "ﾂ", "テ": "ﾃ", "ト": "ﾄ",
    "ナ": "ﾅ", "ニ": "ﾆ", "ヌ": "ﾇ", "ネ": "ﾈ", "ノ": "ﾉ",
    "ハ": "ﾊ", "ヒ": "ﾋ", "フ": "ﾌ", "ヘ": "ﾍ", "ホ": "ﾎ",
    "マ": "ﾏ", "ミ": "ﾐ", "ム": "ﾑ", "メ": "ﾒ", "モ": "ﾓ",
    "ヤ": "ﾔ", "ユ": "ﾕ", "ヨ": "ﾖ",
    "ラ": "ﾗ", "リ": "ﾘ", "ル": "ﾙ", "レ": "ﾚ", "ロ": "ﾛ",
    "ワ": "ﾜ", "ヲ": "ｦ", "ン": "ﾝ",
    "ガ": "ｶﾞ", "ギ": "ｷﾞ", "グ": "ｸﾞ", "ゲ": "ｹﾞ", "ゴ": "ｺﾞ",
    "ザ": "ｻﾞ", "ジ": "ｼﾞ", "ズ": "ｽﾞ", "ゼ": "ｾﾞ", "ゾ": "ｿﾞ",
    "ダ": "ﾀﾞ", "ヂ": "ﾁﾞ", "ヅ": "ﾂﾞ", "デ": "ﾃﾞ", "ド": "ﾄﾞ",
    "バ": "ﾊﾞ", "ビ": "ﾋﾞ", "ブ": "ﾌﾞ", "ベ": "ﾍﾞ", "ボ": "ﾎﾞ",
    "パ": "ﾊﾟ", "ピ": "ﾋﾟ", "プ": "ﾌﾟ", "ペ": "ﾍﾟ", "ポ": "ﾎﾟ",
    "ヴ": "ｳﾞ",
    # 小書き → 大文字
    "ァ": "ｱ", "ィ": "ｲ", "ゥ": "ｳ", "ェ": "ｴ", "ォ": "ｵ",
    "ャ": "ﾔ", "ュ": "ﾕ", "ョ": "ﾖ", "ッ": "ﾂ",
    "ヮ": "ﾜ", "ヵ": "ｶ", "ヶ": "ｹ",
    # 長音
    "ー": "ｰ",
}

#: 既に半角で入力されている小書き文字も大文字へ寄せる。
_HALFWIDTH_SMALL: dict[str, str] = {
    "ｧ": "ｱ", "ｨ": "ｲ", "ｩ": "ｳ", "ｪ": "ｴ", "ｫ": "ｵ",
    "ｬ": "ﾔ", "ｭ": "ﾕ", "ｮ": "ﾖ", "ｯ": "ﾂ",
}

#: 全角記号 → 全銀で使える半角記号。
_SYMBOLS: dict[str, str] = {
    "　": " ",   # 全角スペース
    "（": "(", "）": ")",
    "．": ".", "、": ",", "，": ",",
    "／": "/", "＼": "/",
    "－": "-", "−": "-", "‐": "-", "–": "-", "—": "-", "―": "-",
    "「": "｢", "」": "｣",
    "￥": "¥",
}

#: 全銀フォーマットで使用できる記号(§4)。
ALLOWED_SYMBOLS = frozenset(" .-()/,｢｣¥")


def _is_halfwidth_katakana(ch: str) -> bool:
    # ｦ(FF66)〜ﾟ(FF9F)。長音 ｰ(FF70)、濁点 ﾞ(FF9E)、半濁点 ﾟ(FF9F) を含む。
    return "ｦ" <= ch <= "ﾟ"


def is_allowed_char(ch: str) -> bool:
    """全銀フォーマットで使用可能な1文字か。"""
    if _is_halfwidth_katakana(ch):
        return True
    if "A" <= ch <= "Z" or "0" <= ch <= "9":
        return True
    return ch in ALLOWED_SYMBOLS


#: 法人格の略号(§4)。(漢字/記号表記, カナ表記の候補, 前株, 後株)
_LEGAL_ENTITIES: tuple[tuple[str, tuple[str, ...], str, str], ...] = (
    ("株式会社", ("株式会社", "(株)", "㈱", "ｶﾌﾞｼｷｶﾞｲｼﾔ", "ｶﾌﾞｼｷｶｲｼﾔ"), "ｶ)", "(ｶ"),
    ("有限会社", ("有限会社", "(有)", "㈲", "ﾕｳｹﾞﾝｶﾞｲｼﾔ", "ﾕｳｹﾞﾝｶｲｼﾔ"), "ﾕ)", "(ﾕ"),
    ("合同会社", ("合同会社", "ｺﾞｳﾄﾞｳｶﾞｲｼﾔ", "ｺﾞｳﾄﾞｳｶｲｼﾔ"), "ﾄﾞ)", "(ﾄﾞ"),
    ("一般社団法人", ("一般社団法人", "ｲﾂﾊﾟﾝｼﾔﾀﾞﾝﾎｳｼﾞﾝ"), "ｼﾔ)", "(ｼﾔ"),
)

#: 既に略号化されている表記(再変換しないための判定用)。
_ABBREVIATED_PREFIXES = tuple(pre for _, _, pre, _ in _LEGAL_ENTITIES)
_ABBREVIATED_SUFFIXES = tuple(suf for _, _, _, suf in _LEGAL_ENTITIES)


@dataclass
class KanaResult:
    """正規化の結果。変換前後の両方を保持する(指示書 STEP 4)。"""

    original: str
    normalized: str
    notes: list[str] = field(default_factory=list)
    invalid_chars: list[str] = field(default_factory=list)

    @property
    def length(self) -> int:
        """全銀の文字数。濁点・半濁点も1文字として数える。"""
        return len(self.normalized)

    @property
    def is_clean(self) -> bool:
        """CSVへそのまま載せてよいか。"""
        return (
            bool(self.normalized)
            and not self.invalid_chars
            and self.length <= MAX_KANA_LENGTH
        )

    def to_dict(self) -> dict:
        return {
            "original": self.original,
            "normalized": self.normalized,
            "length": self.length,
            "notes": list(self.notes),
            "invalid_chars": list(self.invalid_chars),
            "is_clean": self.is_clean,
        }


def _convert_chars(text: str, notes: list[str]) -> str:
    out: list[str] = []
    converted_hiragana = False
    for ch in text:
        if ch in _SYMBOLS:
            out.append(_SYMBOLS[ch])
            continue
        if ch in _KATAKANA:
            out.append(_KATAKANA[ch])
            continue
        if ch in _HALFWIDTH_SMALL:
            out.append(_HALFWIDTH_SMALL[ch])
            continue
        # ひらがな → カタカナ(1対1の字種変換。読みの生成ではない)
        if "ぁ" <= ch <= "ゖ":
            katakana = chr(ord(ch) + 0x60)
            out.append(_KATAKANA.get(katakana, katakana))
            converted_hiragana = True
            continue
        # 全角英数字・全角記号 → 半角
        if "！" <= ch <= "～":
            out.append(chr(ord(ch) - 0xFEE0))
            continue
        out.append(ch)
    if converted_hiragana:
        notes.append("ひらがなを半角カタカナへ変換した(原本の表記を要確認)")
    return "".join(out).upper()


def _abbreviate_legal_entity(text: str, notes: list[str]) -> str:
    if text.startswith(_ABBREVIATED_PREFIXES) or text.endswith(_ABBREVIATED_SUFFIXES):
        return text
    for label, tokens, prefix, suffix in _LEGAL_ENTITIES:
        for token in tokens:
            if text.startswith(token) and len(text) > len(token):
                notes.append(f"前株として {label} を {prefix} に略号化した")
                return prefix + text[len(token):].lstrip()
            if text.endswith(token) and len(text) > len(token):
                notes.append(f"後株として {label} を {suffix} に略号化した")
                return text[: -len(token)].rstrip() + suffix
    return text


def normalize_kana(raw: str | None) -> KanaResult:
    """口座名義カナを全銀フォーマットへ正規化する。

    変換できない文字は **削除せずに残し**、`invalid_chars` へ列挙する。
    黙って落とすと誤った名義がCSVに載るため、必ず要確認へ回すこと。
    """
    original = raw or ""
    notes: list[str] = []

    text = _convert_chars(original, notes)
    text = _abbreviate_legal_entity(text, notes)

    collapsed = " ".join(text.split())
    if collapsed != text.strip():
        notes.append("連続する空白を1つに詰めた")
    text = collapsed

    invalid = sorted({ch for ch in text if not is_allowed_char(ch)})
    result = KanaResult(
        original=original, normalized=text, notes=notes, invalid_chars=invalid
    )
    if invalid:
        result.notes.append(
            "全銀フォーマットで使用できない文字が残っている: "
            + " ".join(repr(ch) for ch in invalid)
        )
    if result.length > MAX_KANA_LENGTH:
        result.notes.append(
            f"{MAX_KANA_LENGTH}文字を超過している({result.length}文字)。"
            "短縮は人間の判断が必要"
        )
    return result
