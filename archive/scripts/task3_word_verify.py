from pathlib import Path
import json
import fitz
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
PDF=ROOT/'artifacts/task3/word-assets/report.pdf'
OUT=ROOT/'artifacts/task3/word-assets/pages'
OUT.mkdir(parents=True,exist_ok=True)
doc=fitz.open(PDF)
assert len(doc)>=13,f'页数不足：{len(doc)}'
required=['经济型方案：推演轨迹','均衡型方案：推演轨迹','冗余增强型方案：推演轨迹','最优部署全量技术明细','可复用的标准化布设规则','方案局限性与可落地改进路径','感知模型的具体公式','模型选型与 SOTA 参考']
text='\n'.join(page.get_text() for page in doc)
for item in required: assert item in text,f'缺少核心内容：{item}'
assert '[object Object]' not in text
pages=[]
for index,page in enumerate(doc):
    content=page.get_text().strip()
    assert len(content)>40,f'第 {index+1} 页疑似空白'
    pix=page.get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False)
    target=OUT/f'page-{index+1:02d}.png';pix.save(target)
    im=Image.open(target).convert('RGB');im.thumbnail((480,680))
    pages.append((index+1,im.copy(),len(content)))
contacts=[]
for start in range(0,len(pages),4):
    sheet=Image.new('RGB',(1040,1500),'#d9d9d9');draw=ImageDraw.Draw(sheet)
    for slot,(number,im,chars) in enumerate(pages[start:start+4]):
        x=25+(slot%2)*510;y=30+(slot//2)*730
        sheet.paste(im,(x,y+28));draw.text((x,y),f'Page {number} | text chars {chars}',fill='black')
    path=OUT/f'contact-{start//4+1}.png';sheet.save(path);contacts.append(str(path))
print(json.dumps({'pdf':str(PDF),'pages':len(doc),'contacts':contacts,'textChars':len(text),'pageTextChars':[item[2] for item in pages]},ensure_ascii=False,indent=2))
