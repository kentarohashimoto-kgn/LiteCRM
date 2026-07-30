"""STEP 2: 請求書から振込先口座情報の「候補」を取り出す。

重要な設計方針:
    ここで得られる値は **候補にすぎない**。正規表現の一致は根拠として弱いため、
    このモジュールは confidence を `high` にしない(上限 `medium`)。
    `high` へ昇格できるのは、原本(テキストまたはPNG)を目視で確認した人間/エージェントだけ。
    バリデーション側は必須項目に `high` を要求するので、未確認の値がCSVへ漏れることはない。

テキストレイヤーが薄いページは PNG 化して `work/pages/` へ出力し、視覚的に読み取れるようにする。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .records import Field, Record

PDF_SUFFIXES = {".pdf"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}
SUPPORTED_SUFFIXES = PDF_SUFFIXES | IMAGE_SUFFIXES

#: このバイト数未満のテキストしか取れないページはスキャン扱いにして画像化する
TEXT_LAYER_MIN_CHARS = 40
RASTER_DPI = 200

_BANK_SUFFIX = r"(?:銀行|信用金庫|信用組合|信金|信組|労働金庫|農業協同組合|農協|ろうきん)"
_BRANCH_SUFFIX = r"(?:支店|出張所|営業部|本店|支所)"
# ラベル付きの記載を優先する。ラベル自体(「支店名」など)を値として拾わないよう、
# 名称部分は必ず1文字以上を要求する。
_BANK_LABELED = re.compile(rf"(?:金融機関名?|銀行名)\s*[:：]?\s*([^\s:：\d]{{1,12}}{_BANK_SUFFIX})")
_BANK = re.compile(rf"([^\s:：\d]{{1,12}}{_BANK_SUFFIX})")
_BRANCH_LABELED = re.compile(rf"支店名\s*[:：]?\s*([^\s:：\d]{{1,12}}{_BRANCH_SUFFIX})")
_BRANCH = re.compile(rf"([^\s:：\d]{{1,12}}{_BRANCH_SUFFIX})")
_BANK_CODE = re.compile(r"(?:銀行|金融機関)\s*(?:コード|CD|ｺｰﾄﾞ|番号)\s*[:：]?\s*(\d{4})")
_BRANCH_CODE = re.compile(r"(?:支店|店)\s*(?:コード|CD|ｺｰﾄﾞ|番号)\s*[:：]?\s*(\d{3})")
_ACCOUNT_TYPE = re.compile(r"(普通|当座|貯蓄)\s*(?:預金)?")
_ACCOUNT_NUMBER = re.compile(r"(?:口座\s*番号|口座№|口座No\.?|NO\.?)\s*[:：]?\s*(\d{5,10})")
_ACCOUNT_NUMBER_LOOSE = re.compile(r"(?:普通|当座|貯蓄)\s*(?:預金)?\s*[:：]?\s*(\d{5,10})")
_HOLDER_KANA = re.compile(
    r"(?:フリガナ|ﾌﾘｶﾞﾅ|カナ|ｶﾅ|口座名義\s*\(?\s*カナ\s*\)?|名義人?カナ)\s*[:：]?\s*"
    r"([ァ-ヴｦ-ﾟA-Za-zＡ-Ｚａ-ｚ0-9０-９ー\-（）()／/．.、,　 ]{2,60})"
)
_HOLDER_NAME = re.compile(r"(?:口座名義|名義人|受取人|口座名)\s*[:：]?\s*([^\n]{2,60})")
_FEE_BEARER = re.compile(r"振込\s*手数料[^\n]{0,40}")
_WITHHOLDING = re.compile(r"源泉(?:所得税|徴収)[^\n]{0,30}")


@dataclass
class PageText:
    page: int
    text: str
    image_path: Path | None = None

    @property
    def needs_visual_read(self) -> bool:
        return len(self.text.strip()) < TEXT_LAYER_MIN_CHARS


@dataclass
class ExtractedDocument:
    path: Path
    pages: list[PageText] = field(default_factory=list)
    error: str = ""

    @property
    def full_text(self) -> str:
        return "\n".join(p.text for p in self.pages)

    @property
    def scanned_pages(self) -> list[int]:
        return [p.page for p in self.pages if p.needs_visual_read]


def list_invoices(invoice_dir: Path) -> list[Path]:
    invoice_dir = Path(invoice_dir)
    if not invoice_dir.exists():
        return []
    return sorted(
        p for p in invoice_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES
    )


def read_pdf(path: Path, image_dir: Path | None = None) -> ExtractedDocument:
    """テキストレイヤーを優先して読む。薄いページは PNG 化する。"""
    doc = ExtractedDocument(path=path)
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - 環境依存
        doc.error = f"pdfplumber が未インストール: {exc}"
        return doc

    try:
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                doc.pages.append(PageText(page=i, text=page.extract_text() or ""))
    except Exception as exc:  # pragma: no cover - 壊れたPDF対策
        doc.error = f"PDFの読み取りに失敗: {exc}"
        return doc

    if image_dir is not None:
        targets = [p for p in doc.pages if p.needs_visual_read]
        if targets:
            rendered = render_pages(path, [p.page for p in targets], image_dir)
            for page_text in targets:
                page_text.image_path = rendered.get(page_text.page)
    return doc


def render_pages(path: Path, pages: list[int], image_dir: Path) -> dict[int, Path]:
    """指定ページを PNG 化する(スキャンPDFを視覚的に読み取るため)。"""
    try:
        import fitz  # PyMuPDF
    except ImportError:  # pragma: no cover - 環境依存
        return {}

    image_dir = Path(image_dir)
    image_dir.mkdir(parents=True, exist_ok=True)
    out: dict[int, Path] = {}
    zoom = RASTER_DPI / 72
    with fitz.open(path) as pdf:
        for page_no in pages:
            if page_no < 1 or page_no > pdf.page_count:
                continue
            pixmap = pdf[page_no - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            dest = image_dir / f"{path.stem}_p{page_no:02d}.png"
            pixmap.save(dest)
            out[page_no] = dest
    return out


def read_document(path: Path, image_dir: Path | None = None) -> ExtractedDocument:
    if path.suffix.lower() in PDF_SUFFIXES:
        return read_pdf(path, image_dir)
    # 画像はテキストレイヤーを持たないので、必ず視覚的な読み取りへ回す
    return ExtractedDocument(path=path, pages=[PageText(page=1, text="", image_path=path)])


def _find(pattern: re.Pattern[str], doc: ExtractedDocument, group: int = 1) -> tuple[str, int | None, int]:
    """最初に一致した値と、その出典ページ、および一致の総数を返す。"""
    values: list[tuple[str, int]] = []
    for page in doc.pages:
        for match in pattern.finditer(page.text):
            value = (match.group(group) or "").strip()
            if value:
                values.append((value, page.page))
    if not values:
        return "", None, 0
    distinct = {v for v, _ in values}
    return values[0][0], values[0][1], len(distinct)


def _candidate(
    doc: ExtractedDocument, pattern: re.Pattern[str], group: int = 1
) -> Field:
    value, page, distinct = _find(pattern, doc, group)
    if not value:
        return Field(source_file=doc.path.name, confidence="low")
    # 文書内に複数の異なる値がある場合は、どれが振込先か機械的に決められない
    confidence = "medium" if distinct == 1 else "low"
    note = "" if distinct == 1 else f"文書内に候補が{distinct}種類あり自動確定できない"
    return Field(
        value=value,
        source_file=doc.path.name,
        source_page=page,
        confidence=confidence,
        note=note,
    )


def _candidate_labeled_first(
    doc: ExtractedDocument, labeled: re.Pattern[str], fallback: re.Pattern[str]
) -> Field:
    """ラベル付きの記載を優先し、無ければラベルなしの一致を確度を下げて採用する。"""
    field_labeled = _candidate(doc, labeled)
    if not field_labeled.is_empty:
        return field_labeled
    loose = _candidate(doc, fallback)
    if not loose.is_empty:
        loose.confidence = "low"
        loose.note = " / ".join(filter(None, ["ラベルなしの一致。要目視確認", loose.note]))
    return loose


def build_candidate_record(doc: ExtractedDocument, record_id: str) -> Record:
    """自動抽出した候補からレコードを組み立てる(confidence は medium 止まり)。"""
    record = Record(record_id=record_id, source_file=doc.path.name)

    account_number = _candidate(doc, _ACCOUNT_NUMBER)
    if account_number.is_empty:
        account_number = _candidate(doc, _ACCOUNT_NUMBER_LOOSE)
        if not account_number.is_empty:
            account_number.confidence = "low"
            account_number.note = "ラベルなしで口座番号らしき数字を拾った。要目視確認"

    record.fields = {
        "supplier_name": Field(source_file=doc.path.name, confidence="low",
                               note="請求元名称はレイアウト依存のため自動抽出しない。要目視"),
        "bank_name": _candidate_labeled_first(doc, _BANK_LABELED, _BANK),
        "bank_code": _candidate(doc, _BANK_CODE),
        "branch_name": _candidate_labeled_first(doc, _BRANCH_LABELED, _BRANCH),
        "branch_code": _candidate(doc, _BRANCH_CODE),
        "account_type": _candidate(doc, _ACCOUNT_TYPE),
        "account_number": account_number,
        "account_holder_kana": _candidate(doc, _HOLDER_KANA),
        "account_holder_kanji": _candidate(doc, _HOLDER_NAME),
        "transfer_fee_bearer": _candidate(doc, _FEE_BEARER, group=0),
        "withholding_tax": _candidate(doc, _WITHHOLDING, group=0),
    }

    if doc.error:
        for f in record.fields.values():
            f.confidence = "low"
            f.note = (f.note + " / " if f.note else "") + doc.error
    return record


def extract_all(invoice_dir: Path, image_dir: Path) -> tuple[list[Record], list[ExtractedDocument]]:
    """`input/invoices/` 配下をすべて処理して候補レコードを返す。"""
    records: list[Record] = []
    docs: list[ExtractedDocument] = []
    for i, path in enumerate(list_invoices(invoice_dir), start=1):
        doc = read_document(path, image_dir)
        docs.append(doc)
        records.append(build_candidate_record(doc, record_id=f"R{i:03d}"))
    return records, docs
