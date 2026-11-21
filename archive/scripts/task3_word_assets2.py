from pathlib import Path
import json, math
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/task3/word-assets'
report=json.loads((ROOT/'artifacts/task3/latest-report.json').read_text(encoding='utf-8'))
FONT='C:/Windows/Fonts/msyh.ttc';BOLD='C:/Windows/Fonts/msyhbd.ttc'
def font(size,bold=False): return ImageFont.truetype(BOLD if bold else FONT,size)
def centered(draw,box,text,size=30,bold=False,fill='black'):
    x0,y0,x1,y1=box;f=font(size,bold);lines=text.split('\n');heights=[]
    for line in lines:
        b=draw.textbbox((0,0),line,font=f);heights.append(b[3]-b[1])
    y=y0+(y1-y0-sum(heights)-8*(len(lines)-1))/2
    for line,h in zip(lines,heights):
        b=draw.textbbox((0,0),line,font=f);draw.text((x0+(x1-x0-(b[2]-b[0]))/2,y),line,font=f,fill=fill);y+=h+8
def arrow(draw,start,end,width=4):
    draw.line([start,end],fill='black',width=width)
    ang=math.atan2(end[1]-start[1],end[0]-start[0]);L=16
    draw.polygon([end,(end[0]-L*math.cos(ang-.55),end[1]-L*math.sin(ang-.55)),(end[0]-L*math.cos(ang+.55),end[1]-L*math.sin(ang+.55))],fill='black')

# 图5：加权贪心集合覆盖原理
im=Image.new('RGB',(1800,900),'white');d=ImageDraw.Draw(im)
centered(d,(0,25,1800,85),'加权贪心集合覆盖：每一步如何选点',40,True)
# 左侧：样本与候选覆盖
d.rounded_rectangle((60,120,860,780),radius=16,outline='black',width=3);centered(d,(60,128,860,175),'候选与采样覆盖关系',30,True)
samples=[(225,300,1),(320,285,1),(415,320,3),(200,470,1),(450,430,1),(460,495,3),(620,320,1),(725,520,1),(640,600,3),(260,680,1),(345,675,1),(775,645,1)]
# 圆心、半径与标签框均收在左框 (60,120,860,780) 内，避免圆弧越界或压住图例。
cands=[(320,400,185,'C1 · 无线电\ncost 5.4',(230,355,410,445)),(620,455,215,'C2 · 雷达\ncost 12.4',(530,410,710,500)),(300,625,100,'C3 · 声学\ncost 2.2',(210,595,390,655))]
for (sx,sy,w) in samples:
    r=12+w*4;d.ellipse((sx-r,sy-r,sx+r,sy+r),fill='#dddddd' if w==1 else 'white',outline='black',width=2)
    d.text((sx-8,sy-10),str(w),font=font(18),fill='black')
for cx,cy,r,label,label_box in cands:
    d.ellipse((cx-r,cy-r,cx+r,cy+r),outline='black',width=3)
    centered(d,label_box,label,22,True)
d.text((90,745),'点=采样（数字=权重）  圆=候选覆盖范围',font=font(22),fill='black')
# 右侧：评分排序
d.rounded_rectangle((920,120,1740,780),radius=16,outline='black',width=3);centered(d,(920,128,1740,175),'score = 新增权重 / 成本',30,True)
scores=[('C1',69.1,True),('C2',23.2,False),('C3',15.0,False)]
for i,(name,score,best) in enumerate(scores):
    y=270+i*130;w=int(score/70*560)
    d.rectangle((1060,y,1060+w,y+70),fill='black' if best else 'white',outline='black',width=3)
    d.text((990,y+18),name,font=font(28,best),fill='black')
    d.text((1070+w+15,y+18),f'{score:.1f}',font=font(28,best),fill='black')
d.text((990,650),'选择 C1 → 标记其覆盖样本 → 重新计算剩余增益 → 重复',font=font(24),fill='black')
d.text((990,700),'饱和后反向删除完全冗余设备，释放预算再补选',font=font(24),fill='black')
d.text((60,830),'与优化器一致：optimizer.js chooseGreedy 按增益/成本迭代，约束为预算与设备数上限；轨迹写入 optimizationTrace。',font=font(24),fill='black')
im.save(OUT/'figure-5-greedy.png')

# 图6：四类盲区归因判定树
im=Image.new('RGB',(1800,1000),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'四类盲区归因判定树（blindspots.js）',40,True)
def node(box,t1,t2='',w=4):
    d.rounded_rectangle(box,radius=14,outline='black',width=w);centered(d,(box[0]+8,box[1]+8,box[2]-8,box[3]-8),t1+'\n'+t2 if t2 else t1,22,True)
node((700,110,1100,200),'盲点采样','coverageRow = 0')
node((120,330,620,450),'① 楼栋夹缝？','对向两楼夹角>120° 且缝宽≤60m 且楼高于点')
node((700,330,1100,450),'② 背面阴影？','可覆盖设备视线均被 ≤120m 建筑截断')
node((1280,330,1680,450),'③ 低空贴楼？','离地≤45m 且距立面≤20m')
node((120,620,620,720),'楼栋夹缝','缝宽/楼号写入 cause')
node((700,620,1100,720),'背面阴影区','遮挡距离写入 cause')
node((1280,620,1680,720),'低空贴楼区','贴楼距/离地写入 cause')
node((1280,840,1680,940),'④ 围墙边角 / 其他','距角部≤25m，否则记为其他')
arrow(d,(900,200),(370,330));arrow(d,(900,200),(900,330));arrow(d,(900,200),(1480,330))
arrow(d,(370,450),(370,620));arrow(d,(900,450),(900,620));arrow(d,(1480,450),(1480,620));arrow(d,(1480,720),(1480,840))
for t,xy in [('是',(610,240)),('否',(920,240)),('否',(1150,240))]:d.text(xy,t,font=font(24,True),fill='black')
d.text((700,960),'判定优先级：夹缝 > 阴影 > 贴楼 > 边角 > 其他；阈值初值为几何构造，经六轮仿真统计校订。',font=font(23),fill='black')
im.save(OUT/'figure-6-blindtree.png')

# 图7：EMC 五类规则
im=Image.new('RGB',(1800,950),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'电磁兼容五类冲突规则（emc.js）',40,True)
# 频段轴
d.line((150,300,1650,300),fill='black',width=4)
for f in [0.5,1,2,5,10,15]:
    x=150+(math.log10(f)-math.log10(0.5))/(math.log10(17)-math.log10(0.5))*1500
    d.line((x,290,x,310),fill='black',width=3);d.text((x-30,320),f'{f} GHz',font=font(22),fill='black')
def X(f): return 150+(math.log10(f)-math.log10(0.5))/(math.log10(17)-math.log10(0.5))*1500
for f,label,y in [(9.4,'02C 雷达 X 带发射',180),(15,'03D 雷达 Ku 带发射',180)]:
    d.ellipse((X(f)-9,y-9,X(f)+9,y+9),fill='black');d.text((X(f)+15,y-14),label,font=font(23),fill='black');d.line((X(f),y+9,X(f),290),fill='#999999',width=2)
d.rectangle((X(0.1),400,X(6),440),fill='#bbbbbb',outline='black');d.text((X(0.1)+10,445),'无线电 0.1–6 GHz 连续接收（无源）',font=font(22),fill='black')
for f in [0.9,1.2,2.4,5.2,5.8]:d.ellipse((X(f)-6,494,X(f)+6,506),fill='black')
d.text((X(0.9)-40,515),'X1C 离散接收频点',font=font(22),fill='black')
d.text((150,600),'① 同频：双方发射，Δf<0.1 GHz 且 d<600 m → fail，penalty=6×(1−d/600) dB',font=font(26),fill='black')
d.text((150,650),'② 邻频：Δf<0.5 GHz 且 d<300 m → warning',font=font(26),fill='black')
d.text((150,700),'③ 发射→接收耦合：发射落入接收频段 ±0.02 GHz 且 d<600 m → fail',font=font(26),fill='black')
d.text((150,750),'④ 前端阻塞：发射功率≥1000 W 且距无源接收机<50 m → warning',font=font(26),fill='black')
d.text((150,800),'⑤ 共址过密：至少一方发射且 d<10 m → warning；规避策略：换频优先，其次真实候选点局部移位',font=font(26),fill='black')
d.text((150,870),'频段事实来自装备参数.doc；雷达 9.4/15 GHz 高于无线电 6 GHz 上限，跨类耦合天然不成立，同带雷达间才需同频/邻频规则。',font=font(23),fill='black')
im.save(OUT/'figure-7-emc.png')

# 图8：四指标评分构成
im=Image.new('RGB',(1800,850),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'四指标归一化与 EMC 回写（metrics.js）',40,True)
weights=[('覆盖完整性',0.4,'min(四工况覆盖率)+0.15×核心二重'),('盲区占比',0.25,'四工况盲区率均值（反向）'),('相对成本',0.2,'非人民币，反向'),('施工可行性',0.15,'重量/体积/架设/高度代理')]
for i,(name,wgt,desc) in enumerate(weights):
    x=90+i*430;box=(x,140,x+390,420);d.rounded_rectangle(box,radius=14,outline='black',width=3)
    centered(d,(x+10,150,x+380,210),name,27,True)
    centered(d,(x+10,215,x+380,300),f'权重 {wgt:.2f}',34,True)
    centered(d,(x+15,310,x+375,405),desc,20)
    arrow(d,((box[0]+box[2])//2,430),((box[0]+box[2])//2,500))
d.rounded_rectangle((300,500,1500,600),radius=14,outline='black',width=3)
centered(d,(310,505,1490,595),'跨方案 min-max 归一化 → score = 0.4·覆盖 + 0.25·盲区 + 0.2·成本 + 0.15·施工',25,True)
arrow(d,(900,600),(900,660))
d.rounded_rectangle((420,660,1380,760),radius=14,outline='black',width=3)
centered(d,(430,665,1370,755),'EMC 回写：fail 每例 ×0.85（下限0.7）；仅 warning ×0.97；无 fail 优先排序',24,True)
d.text((300,800),'推荐 = 当前模型/约束/权重下综合得分最高且无未解决 fail 的方案；不是设备最多或成本最低。',font=font(24),fill='black')
im.save(OUT/'figure-8-scoring.png')

# 图9：三类威胁场景径向航路
im=Image.new('RGB',(1800,800),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'三类威胁场景：径向航路与容量校验',40,True)
scenes=[('单机单点入侵','8 方位 × 1 架 · 15 m/s','无溢出'),('多方向同步入侵','4 方向同时 × 1 架','溢出 11 架次'),('蜂群饱和攻击','3 方向 × 14 架 = 42 架','溢出 397 架次')]
for idx,(name,sub,result) in enumerate(scenes):
    cx=300+idx*600;cy=430;R=210
    d.ellipse((cx-R,cy-R,cx+R,cy+R),outline='black',width=3)
    d.ellipse((cx-40,cy-40,cx+40,cy+40),outline='black',width=3);centered(d,(cx-40,cy-40,cx+40,cy+40),'核心',18,True)
    n=[8,4,3][idx]
    for k in range(n):
        ang=k/n*2*math.pi+ (0 if idx==0 else math.pi/8)
        x2=cx+R*math.cos(ang);y2=cy+R*math.sin(ang)
        arrow(d,(x2,y2),(cx+45*math.cos(ang),cy+45*math.sin(ang)),3)
        if idx==2:
            for off in [-0.06,0.06]:
                arrow(d,(cx+R*math.cos(ang+off),cy+R*math.sin(ang+off)),(cx+45*math.cos(ang+off),cy+45*math.sin(ang+off)),2)
    centered(d,(cx-260,120,cx+260,175),name,28,True)
    centered(d,(cx-260,660,cx+260,755),sub+'\n'+result,23)
d.text((200,755),'方位角以核心目标正北为 0° 顺时针；航路在局部 ENU 内生成，逐帧复用感知模型实判，设备容量按帧截取。',font=font(23),fill='black')
im.save(OUT/'figure-9-threats.png')

# 图10：移动补盲搜索流程
im=Image.new('RGB',(1800,850),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'警车移动补盲：粗圆环 + 细网格候选搜索',40,True)
cx,cy=520,480
for r in [130,195,260]:d.ellipse((cx-r,cy-r,cx+r,cy+r),outline='black',width=2)
d.ellipse((cx-12,cy-12,cx+12,cy+12),fill='black');d.text((cx+18,cy-16),'盲点锚点',font=font(24),fill='black')
for a in range(12):
    ang=a/12*2*math.pi;x=cx+260*math.cos(ang);y=cy+260*math.sin(ang)
    d.ellipse((x-8,y-8,x+8,y+8),outline='black',width=2)
d.text((150,760),'粗圆环：500/750/1000 m × 12 方向；surface=ground 才接受开阔地表',font=font(24),fill='black')
d.rounded_rectangle((1050,180,1650,700),radius=14,outline='black',width=3);centered(d,(1060,190,1640,240),'细网格精搜',28,True)
for gx in range(9):
    for gy in range(9):
        x=1120+gx*55;y=280+gy*45
        if math.hypot(gx-4,gy-4)<=4.2:
            d.ellipse((x-7,y-7,x+7,y+7),outline='black',width=2)
d.ellipse((1120+4*55-12,280+4*45-12,1120+4*55+12,280+4*45+12),fill='black')
d.text((1080,650),'750 m 半径 × 25 m 网格，命中后复算对其他盲点的贡献',font=font(23),fill='black')
arrow(d,(800,480),(1050,480))
d.text((820,430),'粗搜无候选时',font=font(24),fill='black')
d.text((100,810),'部署门槛：真实覆盖实判 + 全部合法频道均不新增 fail 级 EMC；随后全设备×全采样×全工况重算覆盖与盲区。',font=font(24),fill='black')
im.save(OUT/'figure-10-mobile.png')
print('6 new figures written to',OUT)
