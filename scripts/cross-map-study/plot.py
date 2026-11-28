from pathlib import Path
import json
import os
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/cross-map-study'
os.environ.setdefault('MPLCONFIGDIR',str(OUT/'mpl-cache'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
font=Path('C:/Windows/Fonts/msyh.ttc')
if font.exists():
    font_manager.fontManager.addfont(str(font))
    plt.rcParams['font.family']=font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams.update({'axes.unicode_minus':False,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'path','font.size':10})
data=json.loads((OUT/'dashboard-data.json').read_text(encoding='utf-8'))
figdir=OUT/'figures';figdir.mkdir(exist_ok=True)
base=[next(r for r in data['plans'] if r['mapId']==m['id'] and r['caseId']=='B00' and r['planId']=='balanced') for m in data['maps']]
fig,ax=plt.subplots(figsize=(10,5.4))
positions=list(range(len(base)))
ax.barh([p-.18 for p in positions],[r['auditCoverage']*100 for r in base],height=.32,color='#9cabb6',label='发射基线')
ax.barh([p+.18 for p in positions],[r['auditWorstCoverage']*100 for r in base],height=.32,color='#156b73',label='四工况最弱值')
ax.set_yticks(positions,[r['mapName'] for r in base]);ax.invert_yaxis();ax.set_xlim(0,105)
ax.set_xlabel('有效空域采样点覆盖率（%）');ax.set_ylabel('独立地图');ax.legend(frameon=False,loc='lower left')
ax.set_title('标准基线B00：固定均衡型方案的独立验证覆盖率',loc='left',pad=15)
fig.text(.02,.01,'来源：2026-11-27本地完整推演；300米验证网格，20/45/90米AGL。不同地图不作等难度排名。',fontsize=8,color='#586b79')
fig.tight_layout(rect=[0,.035,1,1]);fig.savefig(figdir/'baseline-coverage.png',dpi=190);fig.savefig(figdir/'baseline-coverage.svg');plt.close(fig)
effects=data['effects'];fig,ax=plt.subplots(figsize=(10,11))
for i,e in enumerate(effects):
    lo,hi=e['ci95MapBootstrap'];mu=e['meanWorstDeltaPP']
    ax.plot([lo,hi],[i,i],color='#156b73',linewidth=1.5);ax.plot(mu,i,'o',color='#156b73',markersize=4)
ax.axvline(0,color='#7c8a95',linewidth=.8,linestyle='--');ax.set_yticks(range(len(effects)),[e['caseId']+' '+e['label'] for e in effects]);ax.invert_yaxis()
ax.set_xlabel('相对同地图B00的最弱工况覆盖变化（百分点）');ax.set_ylabel('配置变化（固定均衡型）');ax.set_title('跨地图参数效应与地图整块自助法95%区间',loc='left',pad=15)
fig.text(.02,.01,'来源：9张独立地图×28配置；自助法2000次，种子20261127。组合场景不能拆作单因素因果结论。',fontsize=8,color='#586b79')
fig.tight_layout(rect=[0,.035,1,1]);fig.savefig(figdir/'parameter-effects.png',dpi=190);fig.savefig(figdir/'parameter-effects.svg');plt.close(fig)
print('2 figures exported as PNG and SVG')
