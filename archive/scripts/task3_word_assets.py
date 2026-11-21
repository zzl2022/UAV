from pathlib import Path
import json, math
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/task3/word-assets'
OUT.mkdir(parents=True,exist_ok=True)
report=json.loads((ROOT/'artifacts/task3/latest-report.json').read_text(encoding='utf-8'))
FONT='C:/Windows/Fonts/msyh.ttc'
BOLD='C:/Windows/Fonts/msyhbd.ttc'
def font(size,bold=False): return ImageFont.truetype(BOLD if bold else FONT,size)
def canvas(w,h): return Image.new('RGB',(w,h),'white'),ImageDraw.Draw(Image.new('RGB',(1,1)))
def centered(draw,box,text,size=30,bold=False,fill='black'):
    x0,y0,x1,y1=box
    f=font(size,bold)
    lines=text.split('\n')
    heights=[]
    for line in lines:
        b=draw.textbbox((0,0),line,font=f);heights.append(b[3]-b[1])
    y=y0+(y1-y0-sum(heights)-8*(len(lines)-1))/2
    for line,h in zip(lines,heights):
        b=draw.textbbox((0,0),line,font=f);draw.text((x0+(x1-x0-(b[2]-b[0]))/2,y),line,font=f,fill=fill);y+=h+8

def wrap(draw,text,width,size):
    f=font(size);lines=[];line=''
    for ch in text:
        if draw.textlength(line+ch,font=f)>width and line:
            lines.append(line);line=ch
        else: line+=ch
    if line:lines.append(line)
    return lines

def paragraph(draw,xy,text,width,size=26,fill='black',spacing=10):
    x,y=xy;f=font(size)
    for line in wrap(draw,text,width,size):
        draw.text((x,y),line,font=f,fill=fill);y+=size+spacing
    return y

def arrow(draw,start,end,width=4):
    draw.line([start,end],fill='black',width=width)
    ang=math.atan2(end[1]-start[1],end[0]-start[0]);L=16
    pts=[end,(end[0]-L*math.cos(ang-.55),end[1]-L*math.sin(ang-.55)),(end[0]-L*math.cos(ang+.55),end[1]-L*math.sin(ang+.55))]
    draw.polygon(pts,fill='black')

# 图1：代码执行链黑白原理图
im=Image.new('RGB',(1800,820),'white');d=ImageDraw.Draw(im)
centered(d,(0,25,1800,85),'任务三部署优化代码执行链',40,True)
steps=[('真实输入','城市几何 / 装备快照\nscope.js'),('覆盖矩阵','逐候选×采样×工况\npipeline.js'),('三方案优化','贪心→删除→再补选\noptimizer.js'),('EMC 处置','换频→局部移位\nemc.js'),('量化择优','归一化＋EMC回写\nmetrics.js'),('实测验证','盲区 / 威胁 / 航迹\nreport + run')]
boxes=[]
for i,(title,sub) in enumerate(steps):
    row=i//3;col=i%3;x=90+col*580;y=150+row*300;box=(x,y,x+450,y+170);boxes.append(box)
    d.rounded_rectangle(box,radius=16,outline='black',width=4)
    centered(d,(x+15,y+18,x+435,y+72),title,32,True)
    centered(d,(x+20,y+78,x+430,y+150),sub,25)
for i in [0,1,3,4]: arrow(d,(boxes[i][2]+12,(boxes[i][1]+boxes[i][3])//2),(boxes[i+1][0]-12,(boxes[i+1][1]+boxes[i+1][3])//2))
arrow(d,((boxes[2][0]+boxes[2][2])//2,boxes[2][3]+15),((boxes[5][0]+boxes[5][2])//2,boxes[5][1]-15))
d.text((95,735),'数据约束：每次选择必须满足预算和设备上限；EMC 处置后按真实频率/位置重算覆盖，不用示意图替代模型输出。',font=font(25),fill='black')
im.save(OUT/'figure-1-pipeline.png')

# 图2：三方案真实增益成本轨迹
im=Image.new('RGB',(1800,850),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'三套方案实际选点增益 / 成本轨迹（优化过程记录）',38,True)
for idx,plan in enumerate(report['plans']):
    x0=100+idx*570;y0=145;w=500;h=520
    d.rectangle((x0,y0,x0+w,y0+h),outline='black',width=3)
    centered(d,(x0,y0-65,x0+w,y0-10),plan['name'],27,True)
    events=[e for e in plan['optimizationTrace']['events'] if e['type']=='select']
    xs=[e['step'] for e in events];ys=[e['gainPerCost'] for e in events];xmin,xmax=min(xs),max(xs);ymax=max(ys)*1.08
    for k in range(6):
        yy=y0+h-k*h/5;d.line((x0,yy,x0+w,yy),fill='#c8c8c8',width=1)
        d.text((x0-72,yy-12),f'{ymax*k/5:.1f}',font=font(20),fill='black')
    for k in range(6):
        xx=x0+k*w/5;d.line((xx,y0,xx,y0+h),fill='#e2e2e2',width=1)
        d.text((xx-12,y0+h+12),f'{round(xmin+(xmax-xmin)*k/5)}',font=font(20),fill='black')
    pts=[]
    for e in events:
        x=x0+(e['step']-xmin)/max(1,xmax-xmin)*w;y=y0+h-e['gainPerCost']/ymax*h;pts.append((x,y))
    d.line(pts,fill='black',width=4)
    for x,y in pts:d.ellipse((x-5,y-5,x+5,y+5),fill='white',outline='black',width=3)
    for e in plan['optimizationTrace']['events']:
        if e['type']=='delete':
            x=x0+(e['step']-xmin)/max(1,xmax-xmin)*w;d.line((x,y0,x,y0+h),fill='#777777',width=2)
    d.text((x0+125,y0+h+55),'实际事件步号',font=font(23),fill='black')
    d.text((x0+20,y0+h+95),f"选点 {len(events)} 次；最终成本 {plan['cost']:.2f}；设备 {len(plan['devices'])} 台",font=font(23),fill='black')
d.text((105,790),'注：灰虚线位置对应反向冗余删除事件；曲线仅使用实际选点事件，不补造中间过程。',font=font(24),fill='black')
im.save(OUT/'figure-2-traces.png')

# 图3：推荐方案点位黑白原理图
plan=next(p for p in report['plans'] if p['id']==report['recommendedId']);bounds=report['sampling']['bounds']
im=Image.new('RGB',(1600,1050),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1600,80),f"推荐方案全量点位：{plan['name']}（{len(plan['devices'])} 台）",38,True)
L,T,R,B=130,130,1470,900
X=lambda x:L+(x-bounds['west'])/(bounds['east']-bounds['west'])*(R-L)
Y=lambda z:B-(z-bounds['south'])/(bounds['north']-bounds['south'])*(B-T)
d.rectangle((L,T,R,B),outline='black',width=3)
cx,cy=X(bounds['core'][0]),Y(bounds['core'][2])
rx=report['settings']['coreRadius']/(bounds['east']-bounds['west'])*(R-L)
ry=report['settings']['coreRadius']/(bounds['north']-bounds['south'])*(B-T)
# 核心圈按东西/南北各自比例画成椭圆，并对方框逐段裁剪，保证弧线不越界。
def clip_segment(p,q):
    x0,y0=p;x1,y1=q;dx=x1-x0;dy=y1-y0;t0,t1=0.0,1.0
    for pp,qq in [(-dx,x0-L),(dx,R-x0),(-dy,y0-T),(dy,B-y0)]:
        if pp==0:
            if qq<0:return None
        else:
            t=qq/pp
            if pp<0:
                if t>t1:return None
                t0=max(t0,t)
            else:
                if t<t0:return None
                t1=min(t1,t)
    return ((x0+t0*dx,y0+t0*dy),(x0+t1*dx,y0+t1*dy))
ring=[(cx+rx*math.cos(a*math.pi/180),cy+ry*math.sin(a*math.pi/180)) for a in range(361)]
for i in range(360):
    seg=clip_segment(ring[i],ring[i+1])
    if seg:d.line([seg[0],seg[1]],fill='black',width=3)
groups={}
for i,dev in enumerate(plan['devices']):groups.setdefault(tuple(dev['position']),[]).append(i)
markers=[list(dev['position']) for dev in plan['devices']];label_slots={};placed=[]
for indices in groups.values():
    if len(indices)>1:
        radius=65 if len(indices)==2 else 65/math.sin(math.pi/len(indices))
        for slot,index in enumerate(indices):
            angle=slot/len(indices)*math.pi*2;label_slots[index]=(slot,len(indices))
            markers[index][0]+=math.cos(angle)*radius;markers[index][2]+=math.sin(angle)*radius
for i,dev in enumerate(plan['devices'],1):
    actual=(X(dev['position'][0]),Y(dev['position'][2]));x,y=X(markers[i-1][0]),Y(markers[i-1][2])
    # 同点设备错位展开后仍钳制在方框内，编号随之调整方向，避免标记或数字越界。
    x=min(max(x,L+18),R-18);y=min(max(y,T+18),B-18)
    if math.hypot(x-actual[0],y-actual[1])>1:d.line((actual[0],actual[1],x,y),fill='#999999',width=2)
    typ=dev['type'];s=11
    if typ=='radar':d.rectangle((x-s,y-s,x+s,y+s),fill='black')
    elif typ=='radio':d.ellipse((x-s,y-s,x+s,y+s),fill='#777777',outline='black',width=2)
    elif typ=='optical':d.polygon([(x,y-s),(x-s,y+s),(x+s,y+s)],fill='white',outline='black')
    else:d.polygon([(x,y-s),(x-s,y),(x,y+s),(x+s,y)],fill='#bbbbbb',outline='black')
    slot=label_slots.get(i-1,(0,1))[0]
    # 编号在框内择优落位：先按同点槽位定上下，再避开已放置编号，防止相邻设备数字重叠。
    below=[(x+13,y+18),(x-43,y+18),(x+13,y-30),(x-43,y-30)]
    above=[(x+13,y-30),(x-43,y-30),(x+13,y+18),(x-43,y+18)]
    candidates=(below+above if slot%2 else above+below)+[(x+13,y-52),(x-43,y+40)]
    lw=14*len(str(i))+6;lh=24
    for lx,ly in candidates:
        if lx<L+4 or lx+lw>R-4 or ly<T+4 or ly+lh>B-4:continue
        if any(not(lx+lw+4<b[0] or lx-4>b[2] or ly+lh+4<b[1] or ly-4>b[3]) for b in placed):continue
        break
    else:
        lx=min(max(x+13,L+4),R-4-lw);ly=min(max(y-30,T+4),B-4-lh)
    placed.append((lx,ly,lx+lw,ly+lh))
    d.text((lx,ly),str(i),font=font(20),fill='black')
d.line((1390,205,1390,150),fill='black',width=4);arrow(d,(1390,205),(1390,150));d.text((1377,215),'北',font=font(25),fill='black')
legend=[('■','雷达'),('●','无线电'),('△','光电'),('◆','声学')]
for i,(symbol,label) in enumerate(legend):d.text((220+i*300,940),f'{symbol}  {label}',font=font(28),fill='black')
d.text((180,995),'黄圈在彩色平台中对应核心权重区；本图统一黑白表达，编号与设备明细表一致。',font=font(23),fill='black')
im.save(OUT/'figure-3-deployment.png')

# 图4：量化布设规则黑白原理示意
im=Image.new('RGB',(1800,1120),'white');d=ImageDraw.Draw(im)
centered(d,(0,20,1800,80),'多轮仿真提炼的四类布设规则',40,True)
# R1
for box,title in [((55,110,855,525),'R1 楼栋夹缝补盲'),((945,110,1745,525),'R2 低空层补盲'),((55,605,855,1015),'R3 声学制高点'),((945,605,1745,1015),'R4 静默工况冗余')]:d.rounded_rectangle(box,radius=15,outline='black',width=3);centered(d,(box[0]+10,box[1]+12,box[2]-10,box[1]+58),title,30,True)
# buildings and gap
d.rectangle((135,245,300,440),outline='black',width=4);d.rectangle((500,175,665,440),outline='black',width=4)
arrow(d,(315,390),(485,390));d.text((325,350),'缝宽 <45 m',font=font(26),fill='black');d.text((300,205),'高差 >13 m',font=font(26),fill='black')
d.line((205,240,205,190),fill='black',width=4);d.ellipse((188,160,222,194),fill='black');d.text((110,455),'较低楼顶增设补盲节点',font=font(25),fill='black')
# low layer
d.line((1020,450,1670,450),fill='black',width=4);d.rectangle((1450,280,1610,450),outline='black',width=4);d.line((1110,450,1110,330),fill='black',width=5);d.ellipse((1095,315,1125,345),fill='black')
d.arc((1040,300,1470,540),190,345,fill='black',width=3);d.text((1030,180),'30 m 层盲区率 = 60 m 层的 5.5 倍',font=font(25),fill='black');d.text((1050,475),'距最近雷达 559 m 以外配套光电/声学',font=font(24),fill='black')
# acoustic height
d.rectangle((130,840,330,930),outline='black',width=4);d.rectangle((510,760,710,930),outline='black',width=4);d.line((230,840,230,795),fill='black',width=4);d.line((610,760,610,715),fill='black',width=4)
# 弧顶控制在 R3 框标题之下（框 55,605,855,1015），不再越过框顶。
d.arc((480,690,830,860),190,280,fill='black',width=3);d.arc((100,700,420,880),190,280,fill='black',width=3);d.text((105,950),'高度上 1/3 候选平均覆盖 = 下 1/3 的 1.2 倍',font=font(24),fill='black')
# silent redundancy
d.polygon([(1070,760),(1110,745),(1150,760),(1110,775)],outline='black');d.line((1060,720,1160,800),fill='black',width=4);d.text((1020,680),'静默目标',font=font(26),fill='black')
for x in [1320,1530]:d.line((x,900,x,760),fill='black',width=5);d.ellipse((x-14,740,x+14,768),fill='black')
d.arc((1230,690,1450,850),190,280,fill='black',width=3);d.text((1030,935),'静默覆盖下降 5.6 个百分点',font=font(26),fill='black');d.text((1190,975),'雷达 / 光电主动冗余补位',font=font(25),fill='black')
im.save(OUT/'figure-4-rules.png')
print(json.dumps({'assets':[str(p) for p in sorted(OUT.glob('figure-*.png'))]},ensure_ascii=False,indent=2))
