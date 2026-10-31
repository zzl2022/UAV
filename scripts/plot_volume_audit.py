"""Plot actual sampled values, with hard failures and missing data kept distinct."""
from pathlib import Path
import sys, json, warnings
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
from matplotlib.patches import Patch
sys.path.insert(0, 'C:/Users/a/.codex/skills/scipilot-figure-skill/scripts')
from visual_qa import audit_layout

ROOT=Path('artifacts/volume-audit')
summary=json.loads((ROOT/'summary.json').read_text(encoding='utf8'))
plt.rcParams.update({'font.family':'Microsoft YaHei','axes.unicode_minus':False,'font.size':10,'savefig.dpi':180})
fields={name:json.loads((ROOT/f'{name}.json').read_text(encoding='utf8')) for name in ['radar','radio']}
g=summary['grid'];nx,ny,nz=g['dimensions'];origin=np.array(g['origin']);step=np.array(g['step']);source=np.array(summary['scenario']['devices'][0]['position'])
xs=origin[0]+np.arange(nx)*step[0]-source[0]
ys=origin[1]+np.arange(ny)*step[1]-source[1]
zs=-(origin[2]+np.arange(nz)*step[2]-source[2])
yi=int(np.argmin(abs(ys-300)));zi=int(np.argmin(abs(zs)))
fig,axs=plt.subplots(2,2,figsize=(12.4,8.8),layout='constrained')
norm=Normalize(-50,60);cmap=plt.get_cmap('cividis');image=None
for col,(name,title) in enumerate([('radar','02C 雷达'),('radio','TDOA-X1B 无线电')]):
 data=np.asarray(fields[name]['values']).reshape(nz,ny,nx,4)
 for row in range(2):
  ax=axs[row,col]
  if row==0:
   layer=data[:,yi,:,:];extent=[xs[0]-50,xs[-1]+50,zs[-1]-50,zs[0]+50];layer=layer[::-1];aspect='equal'
   subtitle=f'水平剖面：高于设备 {ys[yi]:.1f} m';xlabel='相对设备的东向距离 / m';ylabel='相对设备的北向距离 / m'
  else:
   layer=data[zi,:,:,:];extent=[xs[0]-50,xs[-1]+50,ys[0]-step[1]/2,ys[-1]+step[1]/2];aspect='auto'
   subtitle='穿过设备的东西垂直剖面';xlabel='相对设备的东向距离 / m';ylabel='高于设备的高度 / m'
  mask=layer[...,3];base=np.ones((*mask.shape,4));base[mask==0]=[.84,.86,.88,1];base[mask==2]=[.37,.39,.42,1];base[mask==3]=[.13,.14,.16,1]
  ax.imshow(base,extent=extent,origin='lower',aspect=aspect,interpolation='nearest')
  image=ax.imshow(np.ma.masked_where(mask!=1,layer[...,0]),extent=extent,origin='lower',aspect=aspect,interpolation='nearest',cmap=cmap,norm=norm)
  if (mask==1).any() and (layer[...,0][mask==1]<0).any():
   x=np.linspace(extent[0]+50,extent[1]-50,layer.shape[1]);yy=np.linspace(extent[2]+(50 if row==0 else step[1]/2),extent[3]-(50 if row==0 else step[1]/2),layer.shape[0])
   ax.contour(x,yy,np.ma.masked_where(mask!=1,layer[...,0]),levels=[0],colors=['#dc6144'],linewidths=1)
  ax.scatter([0],[0],marker='+',s=70,color='#ed6b44',linewidths=1.8,zorder=5)
  ax.set(title=f'{title} · {subtitle}',xlabel=xlabel,ylabel=ylabel)
  ax.tick_params(labelsize=9)
fig.colorbar(image,ax=axs.ravel().tolist(),label='探测裕量 / dB（色带范围 −50 至 +60；超限仅显示饱和）',shrink=.78,pad=.025)
fig.legend(handles=[Patch(color='#5e636b',label='硬条件失效'),Patch(color='#d6dbe0',label='DEM / 路径数据不足'),Patch(color='#212429',label='建筑或地面内部'),Patch(color='white',edgecolor='#aaa',label='超过分析高度'),Patch(color='#dc6144',label='无线电 0 dB 门限线')],loc='outside lower center',ncol=3,fontsize=9)
fig.suptitle('实际模型数据剖面：无线电中心有数值，雷达中心确有盲区',fontsize=14)
issues=audit_layout(fig)
(ROOT/'figure-qa.json').write_text(json.dumps(issues,ensure_ascii=False,indent=2),encoding='utf8')
with warnings.catch_warnings(record=True) as caught:
 warnings.simplefilter('always');fig.savefig(ROOT/'sections.png',dpi=180)
 missing=[str(w.message) for w in caught if 'Glyph' in str(w.message)]
 if missing:raise RuntimeError('\n'.join(missing))
fig.savefig(ROOT/'sections.svg')
print('Figure audit:',issues)
print('Saved',ROOT/'sections.png')
