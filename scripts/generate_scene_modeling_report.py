# -*- coding: utf-8 -*-
"""Generate the concise competition technical report for scene modeling."""
from pathlib import Path
from textwrap import dedent

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'artifacts' / 'report_assets'
OUT = ROOT / 'artifacts' / '场景设定模块三维环境建模技术方案报告.docx'

DARK = RGBColor(0x1F, 0x38, 0x64)
MID = RGBColor(0x1F, 0x4E, 0x79)
GRAY = RGBColor(0x59, 0x59, 0x59)
LIGHT = 'F3F6FA'
HEADER_FILL = '1F3864'


def set_font(run, name='宋体', size=None, bold=None, color=None, mono=False):
    run.font.name = 'Consolas' if mono else 'Times New Roman'
    run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = color


def make_style(doc, name, *, base='Normal', east='宋体', size=12, bold=False,
               color=None, first=None, left=0, before=0, after=4,
               line=1.5, align=None):
    style = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    style.base_style = doc.styles[base]
    style.font.name = 'Times New Roman'
    style.font.size = Pt(size)
    style.font.bold = bold
    if color is not None:
        style.font.color.rgb = color
    style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), east)
    pf = style.paragraph_format
    pf.line_spacing = line
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    if first is not None:
        pf.first_line_indent = Pt(first)
    pf.left_indent = Pt(left)
    if align is not None:
        pf.alignment = align
    return style


def add_p(doc, text='', style='BodyCN', **kwargs):
    p = doc.add_paragraph(style=style)
    run = p.add_run(text)
    if kwargs:
        set_font(run, **kwargs)
    return p


def add_bullet(doc, text):
    p = doc.add_paragraph(style='BodyCN')
    p.paragraph_format.first_line_indent = Pt(-12)
    p.paragraph_format.left_indent = Pt(24)
    set_font(p.add_run('• ' + text))


def add_number_item(doc, number, text):
    p = doc.add_paragraph(style='BodyCN')
    p.paragraph_format.first_line_indent = Pt(-18)
    p.paragraph_format.left_indent = Pt(18)
    run = p.add_run(f'{number}. ')
    run.bold = True
    set_font(run)
    set_font(p.add_run(text))


def shade_paragraph(p, fill):
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    pPr.append(shd)


def shade_cell(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    tcPr.append(shd)


def set_cell_margins(table, top=60, bottom=60, left=90, right=90):
    tblPr = table._tbl.tblPr
    mar = OxmlElement('w:tblCellMar')
    for side, value in (('top', top), ('left', left), ('bottom', bottom), ('right', right)):
        node = OxmlElement(f'w:{side}')
        node.set(qn('w:w'), str(value))
        node.set(qn('w:type'), 'dxa')
        mar.append(node)
    tblPr.append(mar)


def remove_table_borders(table):
    tblPr = table._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        node = OxmlElement(f'w:{edge}')
        node.set(qn('w:val'), 'nil')
        borders.append(node)
    tblPr.append(borders)


def add_caption(doc, text, before=8, after=4, size=10.5):
    p = doc.add_paragraph(style='CaptionCN')
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    set_font(p.add_run(text), '宋体', size, False, GRAY)
    return p


def add_table(doc, headers, rows, widths, caption=None, font_size=9.2,
              header_fill=HEADER_FILL, zebra=True, first_col_bold=False):
    if caption:
        add_caption(doc, caption)
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    tblPr = table._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    set_cell_margins(table)

    header = table.rows[0]
    trPr = header._tr.get_or_add_trPr()
    tblHeader = OxmlElement('w:tblHeader')
    tblHeader.set(qn('w:val'), 'true')
    trPr.append(tblHeader)
    cant = OxmlElement('w:cantSplit')
    cant.set(qn('w:val'), 'true')
    trPr.append(cant)
    for index, text in enumerate(headers):
        cell = header.cells[index]
        cell.width = Cm(widths[index])
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        shade_cell(cell, header_fill)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.1
        set_font(p.add_run(text), '黑体', font_size, True, RGBColor(0xFF, 0xFF, 0xFF))

    for r_index, row in enumerate(rows):
        table_row = table.add_row()
        trPr = table_row._tr.get_or_add_trPr()
        cant = OxmlElement('w:cantSplit')
        cant.set(qn('w:val'), 'true')
        trPr.append(cant)
        for c_index, text in enumerate(row):
            cell = table_row.cells[c_index]
            cell.width = Cm(widths[c_index])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if zebra and r_index % 2 == 1:
                shade_cell(cell, LIGHT)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.12
            lines = str(text).split('\n')
            for l_index, line in enumerate(lines):
                run = p.add_run(line)
                set_font(run, '宋体', font_size, first_col_bold and c_index == 0)
                if l_index < len(lines) - 1:
                    run.add_break()
    for index, width in enumerate(widths):
        table.columns[index].width = Cm(width)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_code(doc, code, caption=None):
    if caption:
        add_caption(doc, caption, before=6, after=3, size=9.5)
    for line in dedent(code).strip('\n').split('\n'):
        p = doc.add_paragraph(style='CodeCN')
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        p.paragraph_format.keep_together = True
        shade_paragraph(p, 'F4F6F8')
        run = p.add_run(line if line else ' ')
        set_font(run, '宋体', 8.4, False, mono=True)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_picture_cell(cell, image, caption, width_cm=7.2):
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(str(image), width=Cm(width_cm))
    cap = cell.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_before = Pt(2)
    cap.paragraph_format.space_after = Pt(8)
    set_font(cap.add_run(caption), '宋体', 9, False, GRAY)


def add_page_field(paragraph):
    run = paragraph.add_run()
    begin = OxmlElement('w:fldChar')
    begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = ' PAGE '
    end = OxmlElement('w:fldChar')
    end.set(qn('w:fldCharType'), 'end')
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def add_total_field(paragraph):
    run = paragraph.add_run()
    begin = OxmlElement('w:fldChar')
    begin.set(qn('w:fldCharType'), 'begin')
    instr = OxmlElement('w:instrText')
    instr.set(qn('xml:space'), 'preserve')
    instr.text = ' NUMPAGES '
    end = OxmlElement('w:fldChar')
    end.set(qn('w:fldCharType'), 'end')
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def build_document():
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.4)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)
    section.header_distance = Cm(1.2)
    section.footer_distance = Cm(1.2)
    section.different_first_page_header_footer = True

    normal = doc.styles['Normal']
    normal.font.name = 'Times New Roman'
    normal.font.size = Pt(12)
    normal._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), '宋体')

    make_style(doc, 'BodyCN', east='宋体', size=12, first=24, after=4, line=1.5)
    make_style(doc, 'CaptionCN', east='宋体', size=10.5, after=10, line=1.2,
               align=WD_ALIGN_PARAGRAPH.CENTER)
    make_style(doc, 'CodeCN', east='宋体', size=8.4, after=0, line=1.0,
               align=WD_ALIGN_PARAGRAPH.LEFT)

    for level, size, color, before, after in (
        (1, 16, DARK, 18, 8),
        (2, 13.5, MID, 13, 5),
        (3, 12, RGBColor(0x33, 0x33, 0x33), 10, 4),
    ):
        style = doc.styles[f'Heading {level}']
        style.font.name = 'Times New Roman'
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), '黑体')
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.line_spacing = 1.25

    header_p = section.header.paragraphs[0]
    header_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_font(header_p.add_run('场景设定模块 · 三维环境建模技术方案报告'), '宋体', 9, False, GRAY)
    footer_p = section.footer.paragraphs[0]
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(footer_p.add_run('第 '), '宋体', 9, False, GRAY)
    add_page_field(footer_p)
    set_font(footer_p.add_run(' 页 / 共 '), '宋体', 9, False, GRAY)
    add_total_field(footer_p)
    set_font(footer_p.add_run(' 页'), '宋体', 9, False, GRAY)

    # ---------------- Cover ----------------
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(72)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run('反无装备优化部署与仿真推演平台'), '宋体', 15, False, RGBColor(0x44, 0x55, 0x66))

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(26)
    shade_paragraph(p, '1F3864')
    p.paragraph_format.space_after = Pt(0)
    set_font(p.add_run('  场 景 设 定 模 块  '), '黑体', 25, True, RGBColor(0xFF, 0xFF, 0xFF))

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    shade_paragraph(p, '2E5E8C')
    p.paragraph_format.space_after = Pt(0)
    set_font(p.add_run('  三维环境建模技术方案报告  '), '黑体', 21, True, RGBColor(0xFF, 0xFF, 0xFF))

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(14)
    set_font(p.add_run('（参赛版）'), '宋体', 13, False, GRAY)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(58)
    p.paragraph_format.space_after = Pt(26)
    pPr = p._p.get_or_add_pPr()
    borders = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '4')
    bottom.set(qn('w:color'), '1F3864')
    borders.append(bottom)
    pPr.append(borders)

    for label in ('参赛赛事', '参赛团队', '指导教师', '编制日期'):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(6)
        set_font(p.add_run(f'{label}：'), '黑体', 12, False)
        value = '2026 年 11 月' if label == '编制日期' else '________________________________'
        set_font(p.add_run(value), '宋体', 12, False)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(40)
    set_font(p.add_run('本报告仅覆盖场景设定模块的三维环境建模与模型展示'), '宋体', 10.5, False, GRAY)
    doc.add_page_break()

    # ---------------- 1 ----------------
    doc.add_heading('一、建模概述与评分对应', level=1)
    doc.add_heading('1.1 建模对象与目标', level=2)
    add_p(doc, '本报告只介绍场景设定模块中的三维地理环境建模与模型展示，包括郑州河南博物院片区的重建场景，以及故宫、大兴机场、房山核设施、北京—通州铁路四个北京 GBA 站点场景。反无设备参数、感知评估、部署优化和推演回放不在本报告范围内。')
    add_p(doc, '建模目标是在现有数据条件下做到“位置准、尺度准、拓扑清、边界明、可追溯”：建筑、地形、影像和视角共享同一米制局部坐标系；建筑高度直接来自源字段；地形空值区不生成三角面；模型层级与数据条件匹配；五场景共用同一套几何内核和元数据格式。')
    doc.add_heading('1.2 与“三维环境建模质量”评分标准的对应', level=2)
    add_p(doc, '评分标准中的“几何模型精度”和“建模合理性”在本报告中分别落到可复核指标和可解释设计上。表 1 给出逐项对应关系。')
    rows = [
        ('平面位置与尺度', '源 SHP 由 EPSG:3857 转 WGS84，再经 ECEF 转局部 ENU；Three.js 使用 [东, 上, -北]，单位米；复用源 tileset 正交旋转。', 'metadata.origin、ecefTransform、coordinateSystem；运行时无二次平移。', 'prepare_data.py；city.json'),
        ('高度与竖向构造', '建筑高度取 DBF.high（3–136 m）；屋顶起算面取轮廓顶点最高 DEM 值，基础底面取最低值。', 'minHeight、maxHeight、foundationDepth、report.json。', 'prepare_data.py；model.js'),
        ('轮廓与拓扑', '保留外环和内环；无效面使用 Shapely make_valid；本数据集修复 0 个、排除 0 个。', 'repairedFeatures、excludedFeatures、buildingParts。', 'prepare_data.py；city.json'),
        ('地形与影像配准', 'DEM 407 列 × 188 行，有效高程 64–139 m；NoData 不生成面；影像 UV 与 DEM 使用同一 WGS84 范围。', 'terrain.rows/cols/min/max、terrainNodataCells、terrain.imagery.bounds。', 'prepare_data.py；terrain.json'),
        ('网格与三角化', '建筑按轮廓拉伸并三角化，外环/内环参与顶底三角化，墙面逐段生成；平面法线保持边缘清晰；合并为单网格。', 'buildingTriangles=424,084；单 BufferGeometry；face ranges 支持拾取。', 'model.js；浏览器诊断'),
        ('多场景一致性', '四张北京站点复用同一 buildCityGeometry 内核和米制约定；GBA 经站点中心局部横轴墨卡托转本地坐标；核心建筑元数据统一。', '四个 -meta.json 的 localBounds、buildingCount、coreBuilding。', 'prepare_beijing_gba_model.py；export_gba_site_model.js'),
        ('合理性与可验证性', '在无立面、材质、树木和道路数据的条件下选择 LoD1；来源、许可、假设与限制写入元数据；生成脚本、哈希和自动化测试可复现。', 'limitations 字段；sources 哈希；public/gba-sites.md；tests。', 'city.json；gba-sites.md；scripts/tests'),
    ]
    add_table(doc, ['评分关注点', '本系统做法', '可核验证据', '代码/数据落点'], rows,
              [2.8, 5.5, 3.7, 4.0], caption='表 1　“三维环境建模质量”评分关注点与实现证据', font_size=8.6)

    doc.add_heading('1.3 技术路线', level=2)
    add_number_item(doc, 1, '数据质检与坐标统一：读取 SHP/DBF/PRJ/CPG、DEM、影像和 tileset；检查几何、高度和 DEM 覆盖；统一转换到局部 ENU。')
    add_number_item(doc, 2, '几何与地表生成：轮廓拉伸为 LoD1 体块；DEM 有效像元生成地形三角网；影像按同一地理范围计算 UV。')
    add_number_item(doc, 3, '多场景组织：郑州输出 city.json / terrain.json；北京站点输出 GBA JSON / GLB / -meta.json / 影像。')
    add_number_item(doc, 4, '验证与展示：输出建筑数、三角面数、地形顶点、包围盒和哈希；用自动化测试与浏览器截图复核。')

    # ---------------- 2 ----------------
    doc.add_heading('二、运行环境', level=1)
    env_rows = [
        ('操作系统', 'Windows 11 Home China 10.0.26200', '开发、预处理与浏览器验证'),
        ('Node.js / npm', 'Node.js 24.18.1 / npm 11.16.0', '构建与脚本运行'),
        ('构建工具', 'Vite 8.3.4', '开发服务器与生产构建'),
        ('三维渲染', 'Three.js 0.186.1', 'WebGL2 场景、几何与材质'),
        ('空间加速', 'three-mesh-bvh 0.9.16', '模型网格空间查询（平台其他模块使用）'),
        ('Python', 'Python 3.13.9', 'SHP/DEM 预处理'),
        ('几何与投影', 'pyshp 3.0.3；pyproj 3.7.2；Shapely 2.1.2', '读取、投影、几何修复'),
        ('栅格与影像', 'rasterio 1.4.4；NumPy 2.5.4；Pillow 13.0.0', 'DEM 采样、影像重采样'),
        ('浏览器', 'Microsoft Edge（Chromium 内核）', 'WebGL2、ES Modules、Web Worker'),
        ('自动化验证', 'playwright-core 1.61.1', '无头浏览器冒烟与截图'),
    ]
    add_table(doc, ['类别', '版本 / 配置', '用途'], env_rows, [3.2, 7.2, 5.6],
              caption='表 2　运行环境与依赖版本', font_size=9.2)
    add_p(doc, '建模数据在离线阶段生成，浏览器端只加载静态文件，不依赖 Python 服务或在线地图 Token（北京站点影像已本地化）。普通四核 CPU、8 GB 内存、支持 WebGL2 的显卡即可完成浏览；生产构建可作为静态站点部署。')

    # ---------------- 3 ----------------
    doc.add_heading('三、数据基础与预处理', level=1)
    doc.add_heading('3.1 数据来源', level=2)
    data_rows = [
        ('building/zheng_apart.shp 及 .dbf/.prj/.cpg', '15,889 个建筑轮廓；原始坐标系 EPSG:3857；DBF.high 为高度字段', '建筑轮廓、高度'),
        ('dem/dem.tif', '407（列）× 188（行）像元；EPSG:4326；有效高程 64–139 m', '地面高程、地形三角网'),
        ('影像/raster.tif', '5259 × 2416 像元；WGS84 RGB 航拍影像', '地形底图'),
        ('白模/zhengzhou1/tileset.json', '原始 Tileset 变换；地理原点与 ENU 旋转', 'ENU 原点、ECEF 变换、尺度基准'),
        ('白模/zhengzhou1/NoLod_*.glb', '原始三维白模', '仅作对照层'),
    ]
    add_table(doc, ['数据', '规格', '建模用途'], data_rows, [5.6, 6.4, 4.0],
              caption='表 3　郑州重建场景的数据源', font_size=9.0)

    doc.add_heading('3.2 郑州预处理流程', level=2)
    add_number_item(doc, 1, '读取与校验：读取 DBF 的 high、NAME/ID 字段，按 PRJ 建立投影，按 CPG 指定编码；高度必须为有限正数，否则报错。')
    add_number_item(doc, 2, '几何有效性：构造 Shapely 几何；无效面用 make_valid 修复并计数；MultiPolygon 逐部分处理；无法形成面的要素进入 excludedFeatures。')
    add_number_item(doc, 3, '高程采样：轮廓顶点转到 WGS84 后按所在像元取 DEM 高程；NoData 在 100 m 内搜索最近有效像元并记录距离，超阈值或超范围直接报错。')
    add_number_item(doc, 4, '竖向构造：取轮廓顶点最高地面值为 base、最低值为 foundation，base−foundation 为基础深度；屋顶高程为 base+height，屋顶为平面（LoD1）。')
    add_number_item(doc, 5, '坐标与地形：WGS84→ECEF→局部 ENU；DEM 有效像元中心为顶点，2×2 邻域生成两个三角形，NoData 跳过；影像 UV 使用同一 WGS84 范围。')

    doc.add_heading('3.3 质量控制与统计', level=2)
    for text in (
        '不随机生成高度：所有建筑高度来自 DBF.high，本数据集为 3–136 m。',
        '不默认层高：缺失或非法高度直接报错，不静默填充。',
        '不无限外推地形：仅允许 100 m 内最近有效像元，并记录次数与最远距离。',
        '不伪造几何：不添加源数据没有的围墙、树木、道路中心线或材质；建筑空隙来自真实轮廓。',
        '保留拓扑：外环、内环和孔洞均保留，轮廓顶点不抽稀；源文件逐项计算 SHA-256。',
    ):
        add_bullet(doc, text)
    add_p(doc, '本次数据：源要素 15,889 个，进入模型 15,889 个；几何修复 0 个，排除 0 个；建筑顶点落在 DEM NoData 中 23 次，均在 100 m 阈值内找到最近有效像元，最远约 40.02 m；DEM 共 27,378 个 NoData 像元，不生成地形面。')

    doc.add_heading('3.4 北京 GBA 站点预处理', level=2)
    add_p(doc, '北京四个场景使用 GlobalBuildingAtlas LoD1 数据：按 (source, ogc_fid) 去重，过滤高度小于 3 m 或大于 300 m、面积小于 20 m² 的要素；以片区中心为原点，WGS84→站点中心局部横轴墨卡托转本地米制坐标；地面为平面基底，叠加同 BBox 的天地图影像。核心建筑按目标点或片区中心在给定半径内按“最大面积”或“最高”选择，记录名称、高度、中心、轮廓和选择依据。GBA 许可为 CC BY-NC 4.0，署名 TUM、3D-GloBFP、© OpenStreetMap contributors。')
    site_rows = [
        ('核心区域——北京故宫', '74,083', '3–158.36', '5 km', '太和殿'),
        ('机场区域——大兴机场', '14,286', '3–81.43', '10 km', '大兴机场航站楼'),
        ('核电设施——房山核设施', '20,780', '3–45.6', '5 km', '房山核设施'),
        ('铁路沿线——北京站到通州站', '114,564', '3–158.36', '5 km 走廊', '北京站'),
    ]
    add_table(doc, ['场景', '建筑数', '高度范围 / m', '范围', '核心建筑'], site_rows,
              [3.8, 2.2, 2.8, 2.2, 5.0], caption='表 4　四个北京 GBA 站点场景规模', font_size=9.0)

    # ---------------- 4 ----------------
    doc.add_heading('四、三维地理环境建模方法', level=1)
    doc.add_heading('4.1 坐标系统一与尺度控制', level=2)
    add_p(doc, '统一坐标是几何精度的前提。系统不直接把经纬度当平面坐标，也不在浏览器中做经验缩放，而是使用完整的 WGS84→ECEF→局部 ENU 变换。设源 tileset 原点为 T、旋转矩阵为 R，则：')
    p = doc.add_paragraph(style='BodyCN')
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run('ECEF = ECEF(lon, lat, h)，ENU = Rᵀ · (ECEF − T)'), '宋体', 11, True)
    add_p(doc, 'ENU 分量为东、北、上；Three.js 映射为 [E, U, −N]，即 [east, up, -north]，单位米。预处理阶段校验 RᵀR≈I，否则拒绝使用该 tileset。郑州原点为 (113.66216852354067°, 34.78889922570899°, −3.507549920119345 m)，原点与 ECEF 变换写入 city.json。几何、地形、影像和相机共享这一原点，运行时不再投影或平移。')

    doc.add_heading('4.2 建筑几何生成', level=2)
    add_p(doc, '建筑采用 LoD1 体块：以轮廓多边形为底面，按源高度拉伸，生成屋顶、底面和墙体。选择 LoD1 是因为源数据只提供轮廓和高程，没有可靠的立面、屋顶结构、材质、树木和道路信息；这是与数据条件匹配的层级，而不是用贴图伪装细节。')
    add_number_item(doc, 1, '读取轮廓环：rings[0] 为外环，后续为内环；所有顶点已是局部 [x, y, z] 米制坐标。同一栋建筑共用地面基面值 base，符合平面屋顶假设。')
    add_number_item(doc, 2, '确定竖向范围：base 取轮廓顶点 DEM 采样的最大值，foundation 为最小值；bottom = base − foundationDepth，top = base + height。')
    add_number_item(doc, 3, '顶底三角化：外环和内环投影到 xz 平面，调用 THREE.ShapeUtils.triangulateShape(外环, 内环)，内环作为孔洞。')
    add_number_item(doc, 4, '墙体生成：每个环的相邻顶点生成两个三角形，形成封闭侧墙；外环和内环墙都保留，带天井/凹口的建筑不会漏面。')
    add_number_item(doc, 5, '法线与合并：转 non-indexed 后重算平面法线，保持屋顶边缘和墙面转折清晰；所有建筑合并为单个 BufferGeometry，并记录三角面到建筑的 ranges。')
    add_p(doc, '该算法与轮廓顶点数和三角面数线性相关；郑州 15,889 栋建筑生成 424,084 个三角面，可一次绘制完成。北京站点复用同一函数，仅移除顶点颜色并改用浅灰材质，从源头保证两套场景的几何口径一致。')

    doc.add_heading('4.3 地形与影像配准', level=2)
    add_p(doc, '地形由 DEM 有效像元中心构成三角网：对每个 2×2 邻域，若四个顶点都存在，则按 [a,c,b] 和 [b,c,d] 生成两个三角形，保证法线朝上；NoData 像元不生成顶点和跨越空洞的三角形，保留真实覆盖边界。影像 UV 使用同一 WGS84 范围：u=(lon−west)/(east−west)，v=(lat−south)/(north−south)；纹理经双线性重采样，源掩膜写入 alpha，作为可开关的地形底图。')
    add_p(doc, '需要明确：影像不是建筑立面纹理，也不是测绘正射影像；它只提供地表颜色，不新增几何、不改变 DEM 高程。用户看到的地形起伏来自 DEM 三角网。')

    doc.add_heading('4.4 北京 GBA 站点建模', level=2)
    add_p(doc, '四个北京站点复用郑州的建筑几何内核：GBA 逐栋轮廓和估计高度经站点中心局部横轴墨卡托转本地坐标后，写入与郑州相同的 rings / height / ground / foundationDepth 结构，再调用 buildCityGeometry 生成 BufferGeometry 并导出 GLB。因此两套场景的三角化、法线、墙面和顶面规则一致。站点地面为“平面基底 + 天地图影像”，不含北京 DEM，绝对高程没有测绘意义。')
    add_p(doc, '核心建筑由 coreBuilding 元数据记录，页面用黄色轮廓高亮并提供快速定位；选择依据（面积、高度、搜索半径）写入元数据。站点 GLB 按需加载，避免首屏同时加载数千万级三角面；铁路走廊保留示意折线，但明确不是精确线路中心线。')

    doc.add_heading('4.5 场景装配与显示', level=2)
    add_p(doc, 'createModel(city, terrain) 将建筑和地形装配为 Three.js Group：ground 为 DEM 地形网格，buildings 为合并后的建筑网格，group.userData 保存原点、坐标系、单位和来源。地形初始为深色标准材质；影像存在时替换为带 map 的 MeshBasicMaterial，并设置 SRGB 色彩空间和各向异性过滤。场景设定提供模型切换、建筑/地形/影像地图开关、全域视角、俯视平面和核心建筑定位；切换只改变 Group 可见性、相机和材质，不重建几何。')

    # ---------------- 5 ----------------
    doc.add_heading('五、核心算法代码', level=1)
    add_p(doc, '以下摘录建模链路的关键代码，保留项目函数名和结构，长行做了换行排版。完整实现见对应源文件。')
    doc.add_heading('5.1 坐标变换与正交校验', level=2)
    add_code(doc, r'''
def local(lon, lat, height):
    # WGS84 -> ECEF
    ecef = np.array(to_ecef.transform(lon, lat, height))
    # ECEF -> 局部 ENU；rotation 来自源 tileset
    enu = rotation.T @ (ecef - translation)
    # Three.js: [east, up, -north]，保留 3 位小数（毫米级）
    return [round(float(enu[0]), 3),
            round(float(enu[2]), 3),
            round(float(-enu[1]), 3)]

if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-7):
    raise ValueError('Tileset transform must be orthonormal ENU.')
''', caption='代码 1　局部 ENU 坐标变换（scripts/prepare_data.py，节选）')

    doc.add_heading('5.2 建筑轮廓拉伸与三角化', level=2)
    add_code(doc, r'''
export function buildCityGeometry(buildings) {
  const positions = [], colors = [], indices = [], ranges = [];
  for (const building of buildings) {
    const rings = building.rings.map(r =>
      r.slice(0, -1).map(p => new THREE.Vector2(p[0], p[2])));
    const flat = rings.flat();
    const base = building.rings[0][0][1];
    const bottom = base - building.foundationDepth;
    const top = base + building.height;
    const offset = positions.length / 3;

    const color = new THREE.Color().setHSL(
      0.52 + Math.min(building.height / 136, 1) * 0.12, 0.35, 0.62);
    for (const y of [bottom, top]) for (const p of flat) {
      positions.push(p.x, y, p.y);
      colors.push(color.r, color.g, color.b);
    }

    const firstTriangle = indices.length / 3;
    for (const [a, b, c] of
         THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      indices.push(offset + a + flat.length,
                   offset + c + flat.length,
                   offset + b + flat.length);
      indices.push(offset + a, offset + b, offset + c);
    }

    let start = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = offset + start + i;
        const b = offset + start + (i + 1) % ring.length;
        indices.push(a, b, b + flat.length,
                     a, b + flat.length, a + flat.length);
      }
      start += ring.length;
    }
    ranges.push({ start: firstTriangle, end: indices.length / 3, building });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',
    new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color',
    new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const flatGeometry = geometry.toNonIndexed();
  geometry.dispose();
  flatGeometry.computeVertexNormals();
  flatGeometry.computeBoundingBox();
  return { geometry: flatGeometry, ranges };
}
''', caption='代码 2　LoD1 拉伸、三角化与批量合并（src/model.js）')

    doc.add_heading('5.3 DEM 采样与地形三角网', level=2)
    add_code(doc, r'''
def sample(lon, lat):
    x, y = to_dem.transform(lon, lat)
    row, col = raster.index(x, y)
    if not (0 <= row < raster.height and 0 <= col < raster.width):
        raise ValueError(f'Building lies outside DEM: {lon}, {lat}')
    if mask[row, col]:
        # 仅允许 100 m 内最近有效像元，避免无限外推
        dx = abs(raster.res[0]) * 111320 * math.cos(lat * math.pi / 180)
        dy = abs(raster.res[1]) * 111320
        distances = ((valid_rows - row) * dy) ** 2 + \
                    ((valid_cols - col) * dx) ** 2
        nearest = int(np.argmin(distances))
        distance = float(math.sqrt(distances[nearest]))
        if distance > 100:
            raise ValueError(f'DEM gap exceeds 100 m at {lon}, {lat}')
        return float(heights[valid_rows[nearest], valid_cols[nearest]])
    return float(heights[row, col])

for row in range(raster.height - 1):
    for col in range(raster.width - 1):
        a = row * raster.width + col
        b = a + 1; c = a + raster.width; d = c + 1
        if all(i in vertex_ids for i in [a, b, c, d]):
            indices.extend(vertex_ids[i] for i in [a, c, b, b, c, d])
''', caption='代码 3　DEM 采样与地形三角化（scripts/prepare_data.py，节选）')

    doc.add_heading('5.4 场景装配与站点导出', level=2)
    add_code(doc, r'''
model = createModel(city, terrain);
scene.add(model.group);

imageryTexture = await new THREE.TextureLoader()
  .loadAsync(`./data/${terrain.imagery.texture}`);
imageryTexture.colorSpace = THREE.SRGBColorSpace;
imageryTexture.anisotropy =
  Math.min(8, renderer.capabilities.getMaxAnisotropy());
model.ground.material = new THREE.MeshBasicMaterial({
  map: imageryTexture, side: THREE.DoubleSide
});

// 站点导出：复用同一几何函数，写入 GLB 与 -meta.json
const payload = JSON.parse(await readFile(input, 'utf8'));
const { geometry } = buildCityGeometry(payload.buildings);
geometry.deleteAttribute('color');
const group = new THREE.Group();
group.userData = { ...payload.metadata, units: 'meters' };
group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
  color: 0xdde6ea, roughness: 0.95, metalness: 0, side: THREE.DoubleSide
})));
const binary = await new GLTFExporter().parseAsync(group, {
  binary: true, onlyVisible: false
});
''', caption='代码 4　场景装配与站点 GLB 导出（src/main.js / scripts/export_gba_site_model.js，节选）')

    # ---------------- 6 ----------------
    doc.add_page_break()
    doc.add_heading('六、模型展示', level=1)
    add_p(doc, '图 1–图 6 展示五个场景与场景设定控制界面。郑州场景可见 DEM 地形起伏、建筑体块与航拍影像；四个北京站点为 GBA LoD1 建筑体块加平面影像地面；场景设定界面展示模型切换、建筑/地形/影像地图开关和核心建筑定位。')
    grid = doc.add_table(rows=3, cols=2)
    grid.alignment = WD_TABLE_ALIGNMENT.CENTER
    grid.autofit = False
    tblPr = grid._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    remove_table_borders(grid)
    set_cell_margins(grid, top=40, bottom=40, left=60, right=60)
    for row in grid.rows:
        for cell in row.cells:
            cell.width = Cm(7.7)
    images = [
        ('fig2-zhengzhou.jpg', '图 1　郑州重建：建筑、DEM 地形与影像'),
        ('fig4-beijing.jpg', '图 2　北京故宫：GBA LoD1 与核心建筑'),
        ('fig3-daxing.jpg', '图 3　大兴机场：10 km GBA LoD1 与影像'),
        ('fig5-nuclear.jpg', '图 4　房山核设施：GBA LoD1 与影像'),
        ('fig6-railway.jpg', '图 5　北京—通州铁路走廊'),
        ('fig1-scene-settings.jpg', '图 6　场景设定与图层控制'),
    ]
    for index, (name, caption) in enumerate(images):
        add_picture_cell(grid.rows[index // 2].cells[index % 2], ASSETS / name, caption, width_cm=7.1)
    add_p(doc, '五个场景均支持建筑、地形、影像地图切换，以及全域视角、俯视平面和核心建筑定位。郑州场景使用真实 DEM 地形；北京站点为平面基底 + 天地图影像，不含 DEM，绝对高程无测绘意义。北京站点的地面影像、GBA 高度和核心建筑选择依据均写入 -meta.json，便于复核。')

    # ---------------- 7 ----------------
    doc.add_page_break()
    doc.add_heading('七、几何精度与建模合理性评估', level=1)
    doc.add_heading('7.1 评估方法', level=2)
    for text in (
        '数据核验：检查源坐标系、字段合法性、几何有效性、DEM 覆盖与影像范围。',
        '数值统计：从 city.json / terrain.json 读取建筑数、三角面数、地形顶点、高程范围和 NoData 统计。',
        '自动化测试：校验高度范围、唯一 ID、轮廓闭合、GLB 头、核心建筑元数据和影像 BBox。',
        '可视化复核：检查建筑轮廓、地形边界、影像贴合、场景切换和核心建筑定位，并保存截图。',
    ):
        add_bullet(doc, text)

    doc.add_heading('7.2 几何精度量化结果', level=2)
    geom_rows = [
        ('建筑源要素 / 进入模型', '15,889 / 15,889 栋', '全部进入模型，无排除'),
        ('建筑三角面', '424,084 个', '单网格批量绘制'),
        ('地形网格', '407（列）× 188（行）；49,138 顶点；97,082 三角面', 'DEM 有效像元中心采样'),
        ('地形高程', '64–139 m', '源 DEM 有效值范围'),
        ('建筑高度', '3–136 m', 'DBF.high 字段'),
        ('几何修复 / 排除', '0 / 0', 'Shapely make_valid 计数'),
        ('DEM NoData 像元', '27,378 个', '不生成地形面'),
        ('NoData 顶点最近邻', '23 次；最远 40.02 m', '阈值 100 m'),
        ('影像纹理', '4096 × 1892；源 5259 × 2416', '双线性重采样，alpha 掩膜'),
    ]
    add_table(doc, ['指标', '结果', '说明'], geom_rows, [4.6, 6.4, 5.0],
              caption='表 5　郑州重建场景几何精度与规模统计', font_size=9.2)

    doc.add_heading('7.3 精度分析', level=2)
    add_p(doc, '平面位置：建筑轮廓经 EPSG:3857→WGS84→ECEF→ENU 严格转换，局部坐标保留 3 位小数；tileset 旋转矩阵通过 RᵀR≈I 校验，保证轴正交。源 SHP 的绝对平面精度未在数据说明中给出，本报告只保证转换链正确、尺度一致，不宣称测绘级绝对坐标精度。')
    add_p(doc, '竖向构造：高度直接取 DBF.high，不随机、不按层数估算；屋顶以轮廓顶点最高地面值为起算面，基础以最低值为底面，基础深度为二者之差。坡地上建筑不会悬空或埋入地形，屋顶保持水平。源 DEM 垂直基准未注明，系统按源高程直接使用，不做似大地水准面改正。')
    add_p(doc, '轮廓与网格：15,889 个源要素全部进入模型，修复和排除均为 0；外环、内环均保留并参与三角化，孔洞不填平，轮廓不抽稀。三角化后转为 non-indexed 并重算法线，屋顶边缘和墙体转折清晰；合并为单网格后仍通过 ranges 保留单栋建筑的三角面区间。')
    add_p(doc, '地形与影像：49,138 个有效 DEM 顶点生成 97,082 个三角面，NoData 不生成面；23 次建筑顶点落在 NoData 中，均使用 100 m 内最近有效像元，最远 40.02 m。影像与 DEM 使用同一 WGS84 范围计算 UV，纹理 4096×1892，双线性重采样；影像只作为地面颜色，不改变地形高程。')

    doc.add_heading('7.4 建模合理性分析', level=2)
    for text in (
        'LoD 层级与数据条件匹配：源数据只有轮廓和高度，没有可靠的立面、材质、树木和道路；选择 LoD1，明确不表现未提供的信息。',
        '来源、许可与署名可追溯：郑州使用赛题提供的 SHP/DEM/影像/白模；北京站点使用 GBA LoD1（CC BY-NC 4.0），保留 TUM、3D-GloBFP、OpenStreetMap 署名；源文件计算 SHA-256。',
        '假设与限制透明：DEM 垂直基准未注明、NoData 最近邻阈值 100 m、北京站点为平面基底、GBA 高度为估计值、影像不是测绘正射、铁路走向为示意线。',
        '五场景统一几何内核：郑州与北京共用 buildCityGeometry、米制约定和元数据格式；新增场景可复用同一验证流程。',
    ):
        add_bullet(doc, text)

    doc.add_heading('7.5 误差来源与处置', level=2)
    error_rows = [
        ('源 SHP 绝对平面精度未说明', '只保证转换链正确与尺度一致', '不宣称测绘级绝对坐标精度'),
        ('DBF 高度可能为层数换算或估计', '直接使用源字段，不二次推断', '标注高度来源，不当作实测'),
        ('DEM 垂直基准未注明', '按源高程直接使用，不做大地水准面改正', '限制写入 metadata 与报告'),
        ('DEM NoData / 覆盖缺口', '不生成面；100 m 内最近有效像元并计数', '27,378 个 NoData；23 次最近邻，最远 40.02 m'),
        ('GBA 高度为估计值', '保留数据原值，不做“校准”', '文档与元数据注明估计性质'),
        ('北京站点无 DEM / 影像时相差异', '平面基底 + 影像地面；亮度均衡 + 双线性重采样', '明确绝对高程无意义，残余色差保留'),
    ]
    add_table(doc, ['误差来源', '处置方式', '说明'], error_rows, [4.8, 5.8, 5.4],
              caption='表 6　主要误差来源、处置方式与披露', font_size=9.0)

    doc.add_heading('7.6 评分符合性结论', level=2)
    add_p(doc, '对应“几何模型精度”：系统给出可复核的坐标链、高度来源、轮廓拓扑、地形边界、影像配准和网格统计；15,889 栋建筑、424,084 个建筑三角面、49,138 个地形顶点、97,082 个地形三角面等指标均可从数据文件和诊断接口复现。对无法证明的绝对精度，报告明确不宣称。对应“建模合理性”：系统选择与数据条件匹配的 LoD1，公开来源与许可，记录假设和限制，五场景共用几何内核，生成过程有脚本、哈希和自动化验证。')

    # ---------------- 8 ----------------
    doc.add_heading('八、性能、验证与复现', level=1)
    add_p(doc, '生产构建（Vite 8.3.4）转换 119 个模块，耗时约 1.0 s；主脚本约 610 kB（gzip 约 170 kB），样式约 52 kB（gzip 约 11 kB）。郑州建筑合并为单网格，424,084 个三角面一次绘制；地形 97,082 个三角面独立绘制；站点 GLB 按需加载，避免首屏同时加载数千万级三角面。浏览器像素比上限为 2，场景切换只改变 Group 可见性、相机和材质。')
    add_p(doc, '验证包括：数据测试校验建筑唯一 ID、轮廓闭合、高度范围、GLB 头、核心建筑元数据和影像 BBox；npm run build 通过；workspace / site / browser 等无头浏览器脚本验证场景窗口、模型切换、图层开关、视角、核心建筑和移动端布局；人工截图复核建筑与地形贴合、影像覆盖和站点核心建筑高亮。')
    add_p(doc, '从空环境复现建模结果的命令如下（Windows；POSIX 将 .venv\\Scripts 替换为 .venv/bin）：')
    add_code(doc, r'''
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci

# 生成郑州数据；按需生成北京站点
.venv\Scripts\python.exe scripts/prepare_data.py
npm run prepare:sites:win

# 启动与验证
npm run dev
npm run build
npm test
''', caption='代码 5　建模数据生成、运行与验证命令')

    # ---------------- 9 ----------------
    doc.add_heading('九、结论', level=1)
    add_p(doc, '本报告围绕场景设定模块的三维地理环境建模与模型展示，给出从源数据到可交互三维环境的完整方案。系统以真实 SHP、DEM、影像和 GBA LoD1 数据为基础，通过统一的 ENU 坐标、轮廓拉伸三角化、DEM 地形网格、影像 UV 配准和单网格批量组织，构建了郑州河南博物院片区与四个北京站点场景。')
    add_p(doc, '在几何精度上，系统做到坐标链严格、尺度统一、高度有源、轮廓保真、地形边界真实、影像配准同源、关键统计可复核；在建模合理性上，系统做到 LoD 层级与数据条件匹配、来源与许可可追溯、假设与限制透明、五场景共用几何内核、生成过程可复现。对源数据未提供的绝对精度、未注明的垂直基准、GBA 高度估计和北京平面基底等边界，报告均明确披露。')

    doc.add_heading('参考资料', level=1)
    for text in (
        '[1] Three.js Documentation. https://threejs.org/docs/',
        '[2] GlobalBuildingAtlas (TUM), 3D-GloBFP, © OpenStreetMap contributors. CC BY-NC 4.0.',
        '[3] pyproj、rasterio、Shapely、pyshp 官方文档。',
        '[4] 本项目 README.md、public/gba-sites.md 及 scripts/ 下的数据生成脚本。',
    ):
        p = doc.add_paragraph(style='BodyCN')
        p.paragraph_format.first_line_indent = Pt(0)
        set_font(p.add_run(text), '宋体', 10.5)

    doc.save(OUT)
    print(OUT)


if __name__ == '__main__':
    build_document()
