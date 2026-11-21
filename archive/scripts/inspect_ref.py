import zipfile,re,sys
p=r'd:\微信\xwechat_files\wxid_ej0q00gna9cf22_fd49\msg\file\2026-11\子任务一报告_精简版.docx'
z=zipfile.ZipFile(p)
xml=z.read('word/styles.xml').decode('utf-8')
print('STYLE IDS:',re.findall(r'w:styleId="([^"]+)"',xml))
for name in ['BodyCN','CaptionCN','TableCN','aff1','Heading1','Heading2','Heading3']:
    m=re.search(r'<w:style [^>]*w:styleId="'+name+r'"[\s\S]*?</w:style>',xml)
    if m:
        print('\n=====',name,'=====')
        print(m.group(0))
# heading by outline
for m in re.finditer(r'<w:style [^>]*w:styleId="([a-zA-Z0-9]+)"[\s\S]*?<w:outlineLvl[\s\S]*?</w:style>',xml):
    print('\n=== outline style',m.group(1),'===')
    print(m.group(0)[:1200])
