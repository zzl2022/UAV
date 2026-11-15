# 任务三章节版报告完整校验：结构 / 代号 / 版式 / 图表编号 / 图片灰度 / Word 渲染页数
from pathlib import Path
import re, sys, zipfile, shutil
from io import BytesIO

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DOCX = ROOT / '任务三多方案优化与最优部署技术方案报告.docx'
PDF = ROOT / 'artifacts/task3/word-assets/chapter-report.pdf'
PAGES_DIR = ROOT / 'artifacts/task3/word-assets/chapter-pages'

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ALLOWED_COLORS = {None, '000000', '404040', '464646'}
BANNED = [r'task3-\d+-', r'site-\d+', r'greedy', r'refill', r'redundancy', r'optimizationTrace', r'子窗口']

failures = []
def check(name, fn):
    try:
        info = fn()
        print(f'[PASS] {name}' + (f' | {info}' if info else ''))
    except Exception as exc:
        failures.append((name, str(exc)))
        print(f'[FAIL] {name} | {exc}')

def iter_paragraphs(parent):
    """递归产出 body / 表格单元格内的全部段落"""
    if isinstance(parent, docx.document.Document):
        containers = [parent.element.body]
    elif isinstance(parent, _Cell):
        containers = [parent._tc]
    else:
        containers = [parent._element]
    for container in containers:
        for child in container.iterchildren():
            if child.tag == W + 'p':
                yield Paragraph(child, parent)
            elif child.tag == W + 'tbl':
                for row in Table(child, parent).rows:
                    for cell in row.cells:
                        yield from iter_paragraphs(cell)

doc = docx.Document(DOCX)
body_paras = doc.paragraphs                      # 仅文档主体顶层段落
all_paras = list(iter_paragraphs(doc))           # 含表格内段落
all_text = '\n'.join(p.text for p in all_paras)

# ---------- 1. 文本结构 ----------
def t_title():
    assert any('第三章 最优装备全域无死角覆盖快速优化' in p.text for p in body_paras), '缺少总标题'
check('总标题含「第三章 最优装备全域无死角覆盖快速优化」', t_title)

def t_subheads():
    assert any(p.text.strip().startswith('3.1.1') for p in body_paras), '缺少 3.1.1 标题'
    assert any(p.text.strip().startswith('3.1.2') for p in body_paras), '缺少 3.1.2 标题'
check('存在 3.1.1 / 3.1.2 标题', t_subheads)

def t_311_len():
    i1 = next(i for i, p in enumerate(body_paras) if p.text.strip().startswith('3.1.1'))
    i2 = next(i for i, p in enumerate(body_paras) if p.text.strip().startswith('3.1.2'))
    text = ''.join(p.text for p in body_paras[i1 + 1:i2])
    n = len(re.sub(r'\s', '', text))
    assert 350 <= n <= 500, f'3.1.1 正文字数 {n} 不在 350–500'
    return f'字数={n}'
check('3.1.1 正文字数 350–500（含标点不含空格）', t_311_len)

def t_no_summary():
    bad = [p.text.strip() for p in all_paras
           if ('小结' in p.text or '总结' in p.text)
           and (p.style.name.startswith('Heading') or len(re.sub(r'\s', '', p.text)) < 30)]
    assert not bad, f'存在小结/总结类标题：{bad}'
check('文末无「小结」「总结」章节标题', t_no_summary)

def t_no_numbering():
    hits = [p.text[:40] for p in all_paras if p._p.find(f'{W}pPr/{W}numPr') is not None]
    xml = zipfile.ZipFile(DOCX).read('word/document.xml').decode('utf-8')
    assert '<w:numPr>' not in xml and not hits, f'存在项目符号段落：{hits[:5]}'
check('无项目符号段落（numbering）', t_no_numbering)

# ---------- 2. 代号扫描 ----------
def t_codenames():
    hits = []
    for pat in BANNED:
        for m in re.finditer(pat, all_text, re.IGNORECASE):
            s = max(0, m.start() - 20)
            hits.append(f'{pat} -> ...{all_text[s:m.end() + 20]}...')
    assert not hits, '命中内部代号：\n' + '\n'.join(hits[:10])
check('全文及表格无 task3-N-/site-N/greedy/refill/redundancy/optimizationTrace/子窗口', t_codenames)

# ---------- 3. 版式 ----------
def ppr(p):
    return p._p.find(f'{W}pPr')

def t_body_format():
    body_ps = [p for p in body_paras if p.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY and p.text.strip()]
    assert body_ps, '未找到任何正文段落'
    for p in body_ps:
        pr = ppr(p)
        ind = pr.find(f'{W}ind') if pr is not None else None
        first = ind.get(f'{W}firstLine') if ind is not None else None
        assert first == '420', f'首行缩进 {first}≠420：{p.text[:30]}'
        sp = pr.find(f'{W}spacing') if pr is not None else None
        line = sp.get(f'{W}line') if sp is not None else None
        assert line == '360', f'行距 {line}≠360：{p.text[:30]}'
        for r in p.runs:
            assert r.font.size == Pt(10.5), f'正文字号 {r.font.size}≠10.5pt：{r.text[:20]}'
    return f'正文段落数={len(body_ps)}'
check('正文 10.5pt / 首行缩进 420twips / 行距 360', t_body_format)

def t_caption_format():
    caps = [p for p in body_paras if p.alignment == WD_ALIGN_PARAGRAPH.CENTER
            and re.match(r'^\s*(图3\.|表3\.)', p.text)]
    assert caps, '未找到题注段落'
    for p in caps:
        for r in p.runs:
            assert r.font.size == Pt(9), f'题注字号 {r.font.size}≠9pt：{r.text[:20]}'
            rgb = r.font.color.rgb if r.font.color and r.font.color.type is not None else None
            assert str(rgb).upper() == '404040' if rgb else False, f'题注颜色 {rgb}≠404040：{r.text[:20]}'
    return f'题注数={len(caps)}'
check('题注（图3./表3. 居中）9pt / 颜色 404040', t_caption_format)

def t_run_colors():
    bad = []
    def scan(paras, where):
        for p in paras:
            for r in p.runs:
                rgb = None
                try:
                    if r.font.color is not None and r.font.color.type is not None:
                        rgb = str(r.font.color.rgb).upper()
                except Exception:
                    rgb = 'UNKNOWN'
                if rgb not in ALLOWED_COLORS:
                    bad.append(f'{where}:{rgb}:{r.text[:20]}')
    scan(all_paras, 'body/table')
    for sec in doc.sections:
        scan(list(iter_paragraphs(sec.header)), 'header')
        scan(list(iter_paragraphs(sec.footer)), 'footer')
    assert not bad, '存在非黑白灰 run：\n' + '\n'.join(bad[:10])
check('所有 run 颜色 ∈ {None,000000,404040,464646}', t_run_colors)

def t_shading():
    zf = zipfile.ZipFile(DOCX)
    bad = []
    for name in zf.namelist():
        if name.startswith('word/') and name.endswith('.xml'):
            xml = zf.read(name).decode('utf-8')
            for m in re.finditer(r'<w:shd[^>]*?w:fill="([^"]+)"', xml):
                if m.group(1).lower() not in ('auto', 'ffffff'):
                    bad.append(f'{name}: fill={m.group(1)}')
    assert not bad, '存在非白底纹：\n' + '\n'.join(bad[:10])
check('无 shading 非白填充', t_shading)

# ---------- 4. 图表与公式编号 ----------
def t_fig_table_eq():
    caps = [p.text.strip() for p in body_paras if p.alignment == WD_ALIGN_PARAGRAPH.CENTER]
    figs = sorted({int(m.group(1)) for c in caps for m in [re.match(r'^图3\.(\d+)', c)] if m})
    tbls = sorted({int(m.group(1)) for c in caps for m in [re.match(r'^表3\.(\d+)', c)] if m})
    eqs = sorted({int(m.group(1)) for m in re.finditer(r'（3-(\d+)）', all_text)})
    assert figs == list(range(1, 15)), f'图编号不连续：{figs}'
    assert tbls == list(range(1, 13)), f'表编号不连续：{tbls}'
    assert eqs == list(range(1, 13)), f'公式编号不连续：{eqs}'
    return f'图 {len(figs)} 张 / 表 {len(tbls)} 张 / 公式 {len(eqs)} 条'
check('图3.1–3.14、表3.1–3.12、公式（3-1）–（3-12）连续', t_fig_table_eq)

# ---------- 5. 嵌入图片灰度 ----------
def t_gray_images():
    zf = zipfile.ZipFile(DOCX)
    media = [n for n in zf.namelist() if n.startswith('word/media/')]
    assert media, 'word/media 为空'
    for name in media:
        im = Image.open(BytesIO(zf.read(name))).convert('RGB')
        a = np.asarray(im, dtype=np.int16)
        diff = np.abs(a[..., 0] - a[..., 1]) + np.abs(a[..., 1] - a[..., 2])
        assert int(diff.max()) == 0, f'{name} 存在非灰度像素（最大色差 {int(diff.max())}）'
    return f'图片数={len(media)}'
check('全部嵌入图片逐像素 R=G=B', t_gray_images)

# ---------- 6. Word 打印渲染 ----------
def _save_dialog_watcher(target_path, stop):
    """本机 Microsoft Print to PDF 驱动会弹「将打印输出另存为」对话框，自动填路径并回车"""
    import ctypes, time
    from ctypes import wintypes
    u = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    titles = ('将打印输出另存为', 'Save Print Output As')
    while not stop.is_set():
        dlgs = []
        def cb(hwnd, _):
            if u.IsWindowVisible(hwnd):
                cls = ctypes.create_unicode_buffer(64)
                u.GetClassNameW(hwnd, cls, 64)
                if cls.value == '#32770':
                    txt = ctypes.create_unicode_buffer(256)
                    u.GetWindowTextW(hwnd, txt, 256)
                    if txt.value in titles:
                        dlgs.append(hwnd)
            return True
        u.EnumWindows(WNDENUMPROC(cb), 0)
        for dlg in dlgs:
            edits = []
            def ccb(ch, _):
                cls = ctypes.create_unicode_buffer(64)
                u.GetClassNameW(ch, cls, 64)
                if cls.value == 'Edit':
                    # 沿父链排除地址栏编辑框（其祖先含 Address Band Root / ComboBoxEx32）
                    cur, is_addr = ch, False
                    for _ in range(8):
                        cur = u.GetParent(cur)
                        if not cur or cur == dlg:
                            break
                        ac = ctypes.create_unicode_buffer(64)
                        u.GetClassNameW(cur, ac, 64)
                        if ac.value in ('Address Band Root', 'ComboBoxEx32'):
                            is_addr = True
                            break
                    if not is_addr:
                        edits.append(ch)
                return True
            u.EnumChildWindows(dlg, WNDENUMPROC(ccb), 0)
            if edits:
                u.ShowWindow(dlg, 5)
                u.SetForegroundWindow(dlg)
                time.sleep(0.3)
                u.SetFocus(edits[0])
                time.sleep(0.2)
                u.SendMessageW(edits[0], 0x00B1, 0, -1)      # EM_SETSEL 全选
                u.SendMessageW(edits[0], 0x00C2, 1, str(target_path))  # EM_REPLACESEL
                time.sleep(0.3)
                u.PostMessageW(dlg, 0x0100, 0x0D, 0)         # WM_KEYDOWN VK_RETURN
                u.PostMessageW(dlg, 0x0101, 0x0D, 0)         # WM_KEYUP
        time.sleep(0.5)

def t_render():
    import tempfile, threading
    import win32com.client
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    if PDF.exists():
        PDF.unlink()
    for old in PAGES_DIR.glob('page-*.png'):
        old.unlink()
    tmp_dir = Path(tempfile.gettempdir())
    tmp_docx = tmp_dir / 'task3-chapter-verify.docx'
    tmp_pdf = tmp_dir / 'task3-chapter-verify.pdf'
    shutil.copy(DOCX, tmp_docx)      # 避开 ~$ 锁文件与中文路径
    if tmp_pdf.exists():
        tmp_pdf.unlink()
    stop = threading.Event()
    watcher = threading.Thread(target=_save_dialog_watcher, args=(tmp_pdf, stop), daemon=True)
    watcher.start()
    word = win32com.client.DispatchEx('Word.Application')
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        wdoc = word.Documents.Open(str(tmp_docx), ReadOnly=True)
        try:
            word.ActivePrinter = 'Microsoft Print to PDF'
            wdoc.PrintOut(Background=False, PrintToFile=True, OutputFileName=str(tmp_pdf),
                          Item=0, Copies=1, Pages='', PageType=0)
        finally:
            wdoc.Close(False)
    finally:
        word.Quit()
        stop.set()
    assert tmp_pdf.exists() and tmp_pdf.stat().st_size > 0, 'PDF 未生成'
    shutil.copy(tmp_pdf, PDF)
    import fitz
    pdf = fitz.open(PDF)
    assert len(pdf) >= 15, f'渲染页数 {len(pdf)} < 15'
    counts = []
    for i, page in enumerate(pdf):
        text = page.get_text().strip()
        assert len(text) > 40, f'第 {i + 1} 页疑似空白（字符数 {len(text)}）'
        counts.append(len(text))
        pix = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
        pix.save(PAGES_DIR / f'page-{i + 1:02d}.png')
    pdf.close()
    return f'总页数={len(counts)}，各页字符数={counts}'
check('Word 打印 PDF ≥15 页且无空白页', t_render)

print('=' * 60)
if failures:
    print(f'共 {len(failures)} 项失败：')
    for name, msg in failures:
        print(f'  - {name}: {msg.splitlines()[0]}')
    sys.exit(1)
print('全部校验通过')
