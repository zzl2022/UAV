"""按独立地图汇总真实求解记录；不把采样点、设备或帧充当独立地图样本。"""
from __future__ import annotations
import gzip
import hashlib
import json
import math
import warnings
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/cross-map-study'
DOCS = ROOT / 'docs/cross-map-study'
RNG = np.random.default_rng(20261127)

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')

def avg(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    return float(np.mean(values)) if values else None

def bootstrap(values):
    a = np.asarray([v for v in values if v is not None and math.isfinite(v)], dtype=float)
    if len(a) < 3:
        return None
    means = np.mean(RNG.choice(a, size=(2000, len(a)), replace=True), axis=1)
    return [float(v) for v in np.quantile(means, [.025, .975])]

def get(obj, dotted):
    for key in dotted.split('.'):
        obj = obj.get(key) if isinstance(obj, dict) else None
    return obj

def fmt(value, digits=2):
    return '—' if value is None else f'{value:.{digits}f}'

manifest = read(OUT / 'manifest.json')
plan = read(OUT / 'analysis-plan.json')
status = read(OUT / 'execution-status.json')
expected = manifest['plannedRuns']
if status['done'] != expected or status['failures']:
    raise RuntimeError(f'优化尚未完整结束：{status["done"]}/{expected}；拒绝生成完整成果')
maps = {m['id']: m for m in manifest['maps']}
cases = {c['id']: c for c in manifest['configurations']}
for source in manifest['engineFiles'] + manifest['sourceFiles']:
    if hashlib.sha256((ROOT / source['path']).read_bytes()).hexdigest() != source['sha256']:
        raise RuntimeError('计算后输入或引擎文件发生变化：' + source['path'])

rows, runs, seen, validations, height_candidate_stats = [], [], set(), [], []
for path in sorted((OUT / 'runs').glob('*/*.json.gz')):
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        record = json.load(handle)
    key = (record['mapId'], record['summary']['caseId'])
    if key in seen or key[0] not in maps or key[1] not in cases:
        raise RuntimeError(f'重复或设计以外的运行记录：{key}')
    seen.add(key)
    allowed_versions = {r['hash'] for r in manifest.get('engineRevisions', []) if r['calculationHash'] == manifest.get('calculationFingerprint')}
    allowed_versions.add(manifest['engineFingerprint'])
    if record['engineFingerprint'] not in allowed_versions:
        raise RuntimeError(f'引擎指纹不一致：{key}')
    report = record['report']
    run = record['summary']
    run['recordFile'] = path.relative_to(ROOT).as_posix()
    runs.append(run)
    for model in report['plans']:
        validation = record['finalValidation'][model['id']]
        if not validation['passed']:
            raise RuntimeError(f'最终约束校验不通过：{key}/{model["id"]}')
        validations.append({'mapId': key[0], 'caseId': key[1], 'planId': model['id'], **validation})
        audit = record['audits'][model['id']]
        nominal = next(m for m in audit['metrics'] if m['condition'] == 'nominal')
        threat = report['threatsByPlan'][model['id']]
        rows.append({
            'mapId': key[0], 'mapName': maps[key[0]]['name'], 'caseId': key[1], 'label': run['label'],
            'group': run['group'], 'runId': run['runId'], 'inputDigest': record['inputDigest'],
            'recordFile': run['recordFile'], 'planId': model['id'], 'recommended': model['id'] == report['recommendedId'],
            'deviceCount': len(model['devices']), 'typeCounts': validation['actualTypeCounts'],
            'cost': model['cost'], 'budgetLimit': model['budget'], 'deviceLimit': model['maxDevices'],
            'scopeClipped': report['scope']['clipped'], 'emcFail': report['emc'][model['id']]['counts']['fail'],
            'emcWarning': report['emc'][model['id']]['counts']['warning'], 'trainCoverage': model['metrics'][0]['coverageRate'],
            'auditCoverage': nominal['coverageRate'], 'auditWorstCoverage': audit['robustCoverage'],
            'auditLowCoverage': nominal['lowCoverageRate'], 'auditWorstCoreCoverage': audit['worstCoreCoverage'],
            'auditRedundancy': nominal['redundancyRate'], 'auditMetrics': audit['metrics'],
            'trainMetrics': model['metrics'], 'threats': {k: v['summary'] for k, v in threat.items()},
            'configuration': record['configuration'], 'devices': model['devices'],
            'blockedBuildings': report['settings'].get('buildingExclusions', {}).get('buildingIds', []),
            'validationPointCount': len(record['audits'][model['id']]['coverage'][0]),
        })
    if key[1] == 'B00':
        candidates = record['run']['rulesInput']['candidateStats']
        for typ in ['radar', 'radio', 'optical', 'acoustic']:
            high = [c['coverCount'] for c in candidates if c['type'] == typ and c['heightRank'] >= 2/3]
            low = [c['coverCount'] for c in candidates if c['type'] == typ and c['heightRank'] <= 1/3]
            height_candidate_stats.append({'mapId': key[0], 'type': typ, 'highMeanSamples': avg(high), 'lowMeanSamples': avg(low), 'highN': len(high), 'lowN': len(low)})
    del record
if len(seen) != expected or any(sum(k[0] == m for k in seen) < 10 for m in maps):
    raise RuntimeError('没有满足每图至少十组完整运行记录')

index = {(r['mapId'], r['caseId'], r['planId']): r for r in rows}
effects = []
for case_id, definition in cases.items():
    if case_id == 'B00':
        continue
    per_map = []
    for map_id in maps:
        a, b = index[(map_id, 'B00', 'balanced')], index[(map_id, case_id, 'balanced')]
        per_map.append({'mapId': map_id, 'auditCoverageDeltaPP': 100*(b['auditCoverage']-a['auditCoverage']),
                        'worstCoverageDeltaPP': 100*(b['auditWorstCoverage']-a['auditWorstCoverage']),
                        'lowCoverageDeltaPP': 100*(b['auditLowCoverage']-a['auditLowCoverage']),
                        'deviceDelta': b['deviceCount']-a['deviceCount'], 'costDelta': b['cost']-a['cost'],
                        'baseRunId': a['runId'], 'variantRunId': b['runId']})
    differences = [p['worstCoverageDeltaPP'] for p in per_map]
    effects.append({'caseId': case_id, 'label': definition['label'], 'group': definition['group'], 'unit': 'percentage points',
                    'meanWorstDeltaPP': avg(differences), 'ci95MapBootstrap': bootstrap(differences),
                    'meanNominalDeltaPP': avg([p['auditCoverageDeltaPP'] for p in per_map]),
                    'positiveMaps': sum(v > 1e-8 for v in differences), 'negativeMaps': sum(v < -1e-8 for v in differences),
                    'unchangedMaps': sum(abs(v) <= 1e-8 for v in differences), 'mapCount': len(per_map), 'perMap': per_map})

correlations = []
balanced = [r for r in rows if r['planId'] == 'balanced']
dimensions = [
    'settings.spacing', 'settings.installationHeightM', 'settings.maxDevices', 'settings.budget',
    'settings.scopeWidthM', 'settings.coreWeight', 'environment.emNoiseDb', 'environment.trafficDb',
    'environment.visibilityKm', 'target.rcs', 'target.size', 'target.sourceDb', 'target.frequencyGHz',
]
for dim in dimensions:
    pairs = []
    for map_id in maps:
        group = [r for r in balanced if r['mapId'] == map_id]
        x = np.asarray([get(r['configuration'], dim) for r in group], dtype=float)
        y = np.asarray([r['auditWorstCoverage'] for r in group], dtype=float)
        pairs.extend((map_id, float(a), float(b)) for a, b in zip(x-x.mean(), y-y.mean()))
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        rho, naive_p = spearmanr([p[1] for p in pairs], [p[2] for p in pairs])
        values = []
        ids = list(maps)
        for _ in range(2000):
            sample = [p for map_id in RNG.choice(ids, size=len(ids), replace=True) for p in pairs if p[0] == map_id]
            r, _ = spearmanr([p[1] for p in sample], [p[2] for p in sample])
            if math.isfinite(r): values.append(r)
    correlations.append({'dimension': dim, 'outcome': 'auditWorstCoverage', 'rhoMapCentered': float(rho) if math.isfinite(rho) else None,
                         'clusterBootstrapCI95': [float(v) for v in np.quantile(values, [.025, .975])] if values else None,
                         'naivePNotInferential': float(naive_p) if math.isfinite(naive_p) else None,
                         'independentMapCount': len(maps), 'rows': len(pairs),
                         'meaning': '探索性地图内去均值秩相关；组合因素仍可能混杂，行数不是独立样本量；不据此建立规则'})

mapdata = {m: read(OUT / f'map-{m}.json') for m in maps}
morphology = []
for feature in ['densityBuildingsKm2', 'heightP90M', 'heightSpreadP90P10M', 'nearestCentroidP50M', 'terrainReliefM']:
    pairs = [(m, mapdata[m]['geography'].get(feature), index[(m, 'B00', 'balanced')]['auditLowCoverage']) for m in maps]
    pairs = [(m, x, y) for m, x, y in pairs if x is not None and y is not None]
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        rho, p = spearmanr([v[1] for v in pairs], [v[2] for v in pairs])
    morphology.append({'feature': feature, 'outcome': 'baselineAuditLowCoverage', 'rho': float(rho) if math.isfinite(rho) else None,
                       'pValue': float(p) if math.isfinite(p) else None, 'mapCount': len(pairs), 'perMap': [{'mapId': m, 'x': x, 'y': y} for m,x,y in pairs]})
# 仅九个独立地图的形态检验具有独立样本解释；多配置行的 naiveP 不进入显著性判断。
valid = [(i, r['pValue']) for i,r in enumerate(morphology) if r['pValue'] is not None]
qprev = 1.0
for rank, (i,p) in reversed(list(enumerate(sorted(valid, key=lambda v:v[1]), start=1))):
    qprev = min(qprev, p*len(valid)/rank)
    morphology[i]['bhQValue'] = qprev

probes = {m: read(OUT / f'probes-{m}.json') for m in maps}
for m, probe in probes.items():
    if probe['inputDigest'] != index[(m, 'B00', 'balanced')]['inputDigest']:
        raise RuntimeError('配对链路试验没有关联当前有效基线：' + m)
capacity = {m['mapId']: m for m in read(OUT / 'capacity-validation.json')['results']}
rules = []
def add_rule(rule_id, condition, conclusion, mechanism, evidence, limitations):
    eligible = [e for e in evidence if e['eligible']]
    supporters = [e['mapId'] for e in eligible if e['pass']]
    contradictors = [e['mapId'] for e in eligible if not e['pass']]
    holdout = [m for m in plan['holdoutMaps'] if m in supporters]
    accepted = len(supporters) >= plan['minimumMapsPerAcceptedRule'] and not contradictors and len(holdout) == len(plan['holdoutMaps'])
    triggers = {
        'R01':{'field':'target.emitting','operator':'equals','value':False},
        'R02':{'field':'target.rcs','operator':'paired-change','from':.01,'to':.001,'unit':'m2','holdOtherFactorsConstant':True},
        'R03':{'field':'environment.emNoiseDb','operator':'paired-change','from':0,'to':15,'unit':'dB','holdOtherFactorsConstant':True},
        'R04':{'field':'environment.trafficDb','operator':'paired-change','from':35,'to':70,'unit':'dB SPL'},
        'R05':{'all':[{'field':'target.frequencyGHz','operator':'equals','value':4.9},{'field':'device.presetId','operator':'equals','value':'radio-x1c'}]},
        'R06':{'field':'node.visibleConcurrentTargets','operator':'equals','value':42,'requires':'valid RF link for each target'},
        'R07':{'field':'settings.buildingExclusions.buildingIds','operator':'nonempty'},
        'R08':{'fields':['settings.maxDevices','settings.typeLimits','settings.budget'],'operator':'configured upper bounds'},
        'R09':{'configuration':'C01','referenceConfiguration':'B00','environment':{'rainMmH':45,'visibilityKm':.5,'illuminanceLux':.05,'trafficDb':70,'emNoiseDb':15},'target':{'rcs':.001,'size':.2,'sourceDb':85},'resourceChanges':{'maxDevices':[24,32],'budget':[360,500],'installationHeightM':[2,8]}},
    }
    rules.append({'id':rule_id,'status':'accepted' if accepted else 'not-generalized','condition':condition,'conclusion':conclusion,'trigger':triggers[rule_id],
                  'evidenceClass':'exploratory-cross-map-comparison' if rule_id=='R09' else 'model-consistency-and-map-check',
                  'blindExternalValidation':False,
                  'statement':f'当{condition}时，{conclusion}','mechanism':mechanism,'validatedMapCount':len(supporters),
                  'supportingMaps':supporters,'counterexampleMaps':contradictors,'holdoutPassed':holdout,
                  'perMapEvidence':evidence,'limitations':limitations,
                  'scope':'本次九张地图、现有感知物理代理与既定参数范围内的跨图模型验证；不等同现场工程认证'})

for factor, rule_id, condition, conclusion, mechanism in [
    ('emitting','R01','待侦查目标无线电静默','无线电节点对该目标的有效探测按零计，必须另用不依赖目标发射的感知链路覆盖，再核验其实际盲区','无源无线电设备以飞控或图传发射为观测对象；静默不是靠增加接收半径就能补偿的链路损耗'),
    ('rcs','R02','目标雷达截面积从0.01降至0.001平方米且其他条件相同','雷达链路需额外预留10 dB裕量，并按小目标重算覆盖，不沿用大目标的覆盖结论','现有能量方程中接收信噪比与RCS成正比，十倍RCS下降对应10 dB信噪比下降'),
    ('emNoiseDb','R03','电磁底噪从基线抬升15 dB且其他条件相同','按减少15 dB后的雷达及无线电链路裕量重新验收；原有3 dB预留量不能替代该干扰校核','底噪附加损耗直接进入现有雷达与无线电链路预算；仿真对同一位置和几何作成对复算'),
    ('trafficDb','R04','交通背景声由35升至70 dB SPL','声学节点必须按叠加背景声后的实际裕量核验，只承担仍可检出的局部补盲，不把500米标称上限当作噪声环境中的有效半径','声级按功率叠加而非算术平均；交通、施工、人群、风雨及参考噪声共同决定声学信噪比'),
    ('frequencyGHz','R05','目标信号为4.9 GHz而拟采用X1C既有离散频点配置','该配置不得计为有效覆盖；应改选包含该频段的接收型号，并再次校核链路裕量与建筑遮挡','原始设备参数给出的X1C接收点为0.9/1.2/2.4/5.2/5.8 GHz；本模型接收半带宽20 MHz为建模假设'),
]:
    evidence=[]
    for m in maps:
        items=[p for p in probes[m]['sensitivity'] if p['factor']==factor and (factor!='frequencyGHz' or p['presetId']=='radio-x1c')]
        base=sum(p['baseCovered'] for p in items); changed=sum(p['variantCovered'] for p in items)
        margins=[p['variantMeanMarginDb']-p['baseMeanMarginDb'] for p in items if p['baseMeanMarginDb'] is not None and p['variantMeanMarginDb'] is not None]
        delta=avg(margins); total=sum(p['total'] for p in items)
        if factor in ['emitting','frequencyGHz']: eligible=base>0; passed=changed==0
        elif factor=='rcs':eligible=bool(margins);passed=all(abs(v+10)<1e-6 for v in margins)
        elif factor=='emNoiseDb':eligible=bool(margins);passed=all(abs(v+15)<1e-6 for v in margins)
        else:eligible=bool(margins);passed=all(v< -1e-6 for v in margins) and changed<=base
        evidence.append({'mapId':m,'eligible':eligible,'pass':passed,'pairedLinks':total,'baseCovered':base,'variantCovered':changed,'meanMarginDeltaDb':delta,'source':f'artifacts/cross-map-study/probes-{m}.json','optimizationRunId':index[(m,'B00','balanced')]['runId']})
    add_rule(rule_id,condition,conclusion,mechanism,evidence,['同地图同位置的控制变量链路复算；统计单位仍为地图。','数值结论仅对所列参数变化与当前传播模型成立；厂家未给出的传播量尚需标定。'])

evidence=[]
for m in maps:
    items=capacity[m]['records']; passed=all(r['maximumDetected']==r['capacity'] and r['overflowPerFrame']==42-r['capacity'] for r in items)
    evidence.append({'mapId':m,'eligible':len(items)==3,'pass':passed,'capacityByPreset':{r['presetId']:r['capacity'] for r in items},'overflowPerFrame':{r['presetId']:r['overflowPerFrame'] for r in items},'source':'artifacts/cross-map-study/capacity-validation.json','optimizationRunId':index[(m,'B00','balanced')]['runId']})
add_rule('R06','单个无线电节点同时面对42个具备有效链路的目标','按并发容量分别对TDOA-X1B、OA-X1Bmini、X1C核算至少7、12、27个单帧超额目标；应增加独立承载或其他感知链路并重跑网络级推演','原始资料的＞35、＞30、＞15按35、30、15作保守实现；单节点容量与名义探测距离为两个不同约束',evidence,['单节点42个同位置目标压力复核，不是现实蜂群轨迹。','多节点融合可能已由其他节点覆盖，单节点超额不等于全网同数漏探；以主试验真实动态结果为准。'])

evidence=[]
for m in maps:
    group=[r for r in rows if r['mapId']==m and r['caseId']=='X01']
    evidence.append({'mapId':m,'eligible':all(r['blockedBuildings'] for r in group),'pass':all(v['passed'] for v in validations if v['mapId']==m and v['caseId']=='X01'),'plans':len(group),'blockedBuildingCount':max(len(r['blockedBuildings']) for r in group),'source':index[(m,'X01','balanced')]['recordFile'],'optimizationRunId':index[(m,'X01','balanced')]['runId']})
add_rule('R07','建筑被明确列入禁部署清单','将设备落点排除作为硬约束，并在候选生成、补点、移位及最终坐标验收中保持该约束；该建筑仍参与遮挡计算和周边空域覆盖评估','连通单元约束贯穿求解及最终验收；禁落设备不意味着从地理模型删除建筑',evidence,['核心建筑禁部署仅为统一研究约束，不是对实际场地许可或法定红线的认定。'])

evidence=[]
for m in maps:
    group=[v for v in validations if v['mapId']==m]
    evidence.append({'mapId':m,'eligible':bool(group),'pass':all(v['passed'] for v in group),'validatedPlans':len(group),'source':f'artifacts/cross-map-study/runs/{m}/','optimizationRunId':index[(m,'N01','balanced')]['runId']})
add_rule('R08','总设备数量、分类数量或相对预算设定上限','把这些上限作为硬约束；按最终实际数量、成本和独立验证覆盖率验收，不将数量上限当作必须凑足的配置量','贪心选择、反向删除、冗余补选及电磁移位后逐项复核；存在未覆盖区域时保留失败或不足结论',evidence,['相对成本不等于人民币报价。','本研究为有限候选集上的确定性贪心与后处理，不宣称全局最优或提高预算必然单调改善。'])

evidence=[]
for m in maps:
    base=index[(m,'B00','balanced')];stress=index[(m,'C01','balanced')]
    delta=100*(stress['auditWorstCoverage']-base['auditWorstCoverage'])
    evidence.append({'mapId':m,'eligible':True,'pass':delta< -1e-8,'baseWorstCoverage':base['auditWorstCoverage'],'stressWorstCoverage':stress['auditWorstCoverage'],'deltaPP':delta,'baseActualDevices':base['deviceCount'],'stressActualDevices':stress['deviceCount'],'baseRunId':base['runId'],'optimizationRunId':stress['runId'],'source':stress['recordFile']})
add_rule('R09','同时进入45毫米每小时降雨、0.5公里能见度、0.05勒克斯照度、70 dB交通声、15 dB电磁底噪及小弱目标的C01组合条件','不得把增加设备、预算或架设高度视为恢复基线覆盖的充分条件；应重新选择感知组合、识别失效链路并以最弱工况独立验收','本轮即使把设备上限24放宽到32、相对预算360增至500、支架2米增至8米，九图均衡型最弱工况覆盖仍均低于各自基线；单纯增加资源无法替代环境与目标适配',evidence,['这是完整组合条件下的净结果，不分配为雨、噪声、目标或高度任一单因素的独立因果效应。','本轮平均下降及区间可作该参数组的风险参考，不能当作其他城市或其他参数的固定下降比例。'])

height_evidence=[]
for m in maps:
    for preset in ['radar-03d','acoustic-cry']:
        values=[r for r in probes[m]['heightPairs'] if r['presetId']==preset and r['total']>0]
        height_evidence.append({'mapId':m,'presetId':preset,'lowCovered':sum(v['lowCovered'] for v in values),'highCovered':sum(v['highCovered'] for v in values),'pairedLinks':sum(v['total'] for v in values)})
rejected=[
 {'hypothesis':'两栋建筑净距小于X且高度差大于Y即可确定低楼屋顶补盲','status':'不发布统一X/Y阈值','reason':'现有城市形态统计为质心间距，不能替代外墙净距；没有对建筑净距、高差及补盲动作实施受控干预。不同传感器和俯仰角也不应共用一个拍定阈值。'},
 {'hypothesis':'雷达架设高度每降低Z米，低空盲区半径固定增加W米','status':'不发布统一Z-W斜率','reason':'本轮有0.5/2/8米架设对照，但输出为真实离散空域覆盖，未测连续盲区半径；遮挡、俯仰与脉冲近距盲区共同作用，不能将覆盖百分点换成半径。','evidence':height_evidence},
 {'hypothesis':'声学节点一律优先制高点即可获得最优覆盖','status':'不能列为无条件通用规则','reason':'高低候选覆盖分组仍混有平面位置、指向和周边建筑因素；不能把相关关系解释为高度本身的净效应，也不能声称已有完整声波建筑反射求解。','evidence':[s for s in height_candidate_stats if s['type']=='acoustic']},
]

accepted=[r for r in rules if r['status']=='accepted']
rulebook={'schema':'cross-map-deployment-rules/1','createdAt':status['finishedAt'],'engineFingerprint':manifest['engineFingerprint'],
          'calculationFingerprint':manifest.get('calculationFingerprint'),'sourceRevisions':[{'hash':r['hash'],'calculationHash':r['calculationHash']} for r in manifest.get('engineRevisions',[])],
          'optimizationRuns':len(runs),'independentMaps':len(maps),'configurationCountPerMap':len(cases),'planCount':len(rows),
          'validationPolicy':plan,'acceptedRules':accepted,'notGeneralizedRules':[r for r in rules if r['status']!='accepted'],'rejectedHypotheses':rejected,
          'sourceManifest':'artifacts/cross-map-study/manifest.json','rawRecords':'artifacts/cross-map-study/runs/',
          'sourceDocuments':manifest['sourceFiles']}
save(OUT/'rules.json',rulebook)
save(OUT/'analysis.json',{'pairedEffects':effects,'parameterCorrelations':correlations,'morphologyCorrelations':morphology,'heightCandidateStats':height_candidate_stats,'heightPairs':height_evidence})
save(OUT/'all-plan-results.json',rows)
save(OUT/'run-index.json',runs)
failed_attempts=[]
for path in sorted((OUT/'runs').glob('*/*.error.json')):
    attempt=read(path)
    resolved=(attempt['mapId'],attempt['caseId']) in seen
    if not resolved:raise RuntimeError('尚有未解决的失败配置：'+str(path))
    failed_attempts.append({'mapId':attempt['mapId'],'caseId':attempt['caseId'],'errorFile':path.relative_to(ROOT).as_posix(),'resolved':resolved,'reason':'原始核心为示意标记；已显式映射到实际建筑并重新完整求解'})
save(OUT/'validation-report.json',{'passed':True,'runs':len(runs),'plans':len(rows),'independentMaps':len(maps),'runsPerMap':dict(Counter(r['mapId'] for r in runs)),'finalConstraints':validations,'ruleGate':all(r['validatedMapCount']>=3 and len(r['holdoutPassed'])==3 for r in accepted),'notGeneralizedRules':len(rulebook['notGeneralizedRules']),'resolvedFailureAttempts':failed_attempts})
save(ROOT/'public/data/cross-map-deployment-rules.json',rulebook)
with (OUT/'all-plan-results.jsonl').open('w',encoding='utf-8') as handle:
    for row in rows:handle.write(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n')

DOCS.mkdir(parents=True,exist_ok=True)
lines=['# 跨地图优化部署与标准化布设规则','',f'本次完成{len(maps)}张独立地图、每图{len(cases)}组配置，共{len(runs)}轮完整优化和{len(rows)}套经济型、均衡型、增强型方案。全部输入、真实设备位置、四工况覆盖、三类威胁逐帧数据、电磁处置过程及最终约束校验均已保存。所有成果仅在本地生成，本轮不推送远程分支。','',
       '## 一、研究范围与参数依据','',
       '原始设备参数表提供了两款雷达、三款无线电设备、一款双光谱光电和一款声学设备的基础指标。城区模型使用平台现有九张地图的真实建筑轮廓；河南博物院使用随数据提供的DEM，其余八图沿用平台的平面地表代理。后八图不能据此解释真实地形起伏、道路可达性或工程许可。','',
       '深圳核心元数据是示意定位包络，未对应一栋真实建筑。其禁部署实验将该包络与实际建筑外包框相交的单元作保守排除，记录映射前后标识及依据，不增加虚构建筑、不认定实际用途或许可。首次拒绝无效标识的失败记录保持原样；修正编排后只重算受影响或未完成的配置。原先成功结果在计算模块、地图与完整参数逐项一致后复用，保留各自原始代码指纹；manifest中并列记载两个编排版本，未混淆为同一次代码版本。','',
       '模型将TDOA-X1B、OA-X1Bmini、X1C的城市半径分别保守取4、1.25、3.5公里，并发上限保守取35、30、15；两款雷达距离上限取8公里。NVT-951的1920×1080与640×512图像尺寸、35厘米识别目标等来自原始资料。光电最大识别距离、瞬时视场、最低照度，以及雷达峰值射频功率、脉冲参数、传播损耗和各类相对成本等未由原始资料完整给出，保留为显式假设。输入功耗不当作峰值射频发射功率；云台360度转动行程不当作瞬时全向视场。','',
       '5G-A和静电目录条目缺少本轮原始资料对应的完整部署内核，不混入四类装备求解；其字段仍列入完整参数字典，并明确标记未参加本轮部署。','',
       '## 二、三个模块的可调参数','',
       '第一模块：地图与核心定位、范围宽深、气象、光照、电磁噪声、交通/施工/人群/风雨噪声、风速、温度、TDOA站数与几何系数，以及目标RCS、尺寸、频率、EIRP、声源强度、热对比度、速度和分布。建筑几何和来源坐标保持不变；视角、底图与颜色仅影响显示，不作为性能变量。','',
       '第二模块：逐型号定义距离/盲区、方位/俯仰范围、接收频段、容量、更新率、测量精度、发射与接收增益、噪声系数、脉宽、积累、检测门限、光电视场/像素/通道、声学阵列/频带/阈值和传播损耗。完整字段的单位、范围、默认值、来源与未提供项见参数字典，实际参与求解的有效参数保存在各轮设备记录。','',
       '第三模块：覆盖网格150～1000米、高度层10～500米、候选点间距300～1500米、候选点与设备总上限、各类型数量上限、相对预算与成本、核心半径与需求权重、链路裕量、表面上方0.5～20米架设高度、雷达-60～0度机械俯仰候选、光电/声学方位偏置、禁部署建筑、多方案评分权重，以及动态威胁的数量、来向、高度和物理速度。数量是上限而非强配数量。播放倍速不改变物理速度。','',
       '主实验固定最大32个候选站点，以控制完整批量推演的规模；这一候选截断也是规则的适用边界，不能将所得解宣称为无穷候选空间的全局最优。警车移动补盲是独立派生功能，未混入本轮屋顶优化对照，避免把没有道路依据的地表候选视作可落地停车点。','',
       '## 三、实验设计与可比性','',
       f'每图{len(cases)}组设计包含基线、网格、架设高度、俯仰、方位、噪声、能见度、目标属性、型号、数量与预算、范围、核心权重、低空目标、禁部署建筑及组合压力场景。每轮均完整执行候选生成、覆盖矩阵、三方案选择、电磁处置、最终覆盖重算与三类动态威胁验证；保留所有失败工况与容量溢出。','',
       '主效应比较固定使用同一地图的均衡型方案，以免推荐方案身份切换混入效果。各轮最终设备在该图相同的2400×2400米范围、300米间距、0.37格偏移、20/45/90米离地高度的独立网格上再次实判；无地形和建筑内部点剔除。该固定网格用于跨配置比较，不能把4公里范围配置的核心验证指标误称为4公里全域覆盖。每轮自己的训练范围覆盖同时单独保留。低空高度配置也保留自己的训练分层结果。','',
       '每轮静态优化同时评估发射、静默、雨雾噪声、电磁干扰四工况；后两项存在明确的场景固定覆盖值，以各轮actualConditions为准，不把被工况覆盖的输入误称为独立生效变量。静态覆盖针对单目标链路，并发容量另由动态验证和单节点压力复核度量。','',
       '六张地图用于归纳，深圳、杭州、昌江三图预先作为保留验证。每条发布规则须至少三图有效，且三张保留图逐张通过、没有有效地图反例。额外链路反事实与42目标单站压力试验不冒充新增优化轮次。','',
       '## 四、各地图结果总览','',
       '| 地图 | 完整轮次 | 基线推荐方案/设备数 | 基线独立验证覆盖 | 基线最弱工况覆盖 | 基线相对成本 |','|---|---:|---|---:|---:|---:|']
for m in maps:
    r=next(r for r in runs if r['mapId']==m and r['caseId']=='B00')
    lines.append(f'| {maps[m]["name"]} | {sum(x[0]==m for x in seen)} | {r["planId"]}/{r["deviceCount"]}台 | {100*r["auditCoverage"]:.2f}% | {100*r["auditWorstCoverage"]:.2f}% | {r["cost"]:.2f} |')
lines += ['', '这里展示基线推荐结果，不能把其他配置中事后最高的一项包装成独立验证结果。不同地图的有效验证点数量、地表模型和建筑形态不同，跨地图绝对覆盖率不作等难度排名。','', '## 五、单参数与组合对照结果','',
          '| 配置 | 均衡型最弱工况平均变化/百分点 | 地图整块自助法95%区间 | 改善/下降/不变地图数 |','|---|---:|---|---|']
for e in effects:
    ci=e['ci95MapBootstrap']
    lines.append(f'| {e["caseId"]} {e["label"]} | {e["meanWorstDeltaPP"]:+.2f} | [{ci[0]:+.2f}, {ci[1]:+.2f}] | {e["positiveMaps"]}/{e["negativeMaps"]}/{e["unchangedMaps"]} |')
lines += ['', '区间按九张地图整块重采样2000次，固定种子20261127。它描述当前有限地图集合中的变化不确定性，不证明对所有城市成立。组合场景不拆解为单因素因果效应。探索性参数相关先在地图内去均值并使用地图整块区间；形态关联仅使用每图一个基线，原始p值作BH校正。所有相关结果保存在analysis.json，不凭相关显著性单独建立部署规则。','', '## 六、通过跨图验证的条件—结论规则','']
for rule in accepted:
    lines += [f'### {rule["id"]} {rule["condition"]}','',f'**规则：** {rule["statement"]}','',f'**技术依据：** {rule["mechanism"]}','','**验证：** '+f'{rule["validatedMapCount"]}张有效地图通过；深圳、杭州、昌江三张保留图逐张通过。对应逐地图数值、运行ID和原始结果路径保存在rules.json中。','', '**边界：** '+'；'.join(rule['limitations']),'']
lines += ['## 七、不发布的统一阈值及原因','']
for item in rejected:lines += [f'### {item["hypothesis"]}','',item['status']+'。'+item['reason'],'']
if rulebook['notGeneralizedRules']:
    lines += ['其他候选未满足三张保留图及无反例门槛，留存在notGeneralizedRules中，不列为可复用通用规则。','']
lines += ['## 八、工程适用边界与验收口径','',
          '本研究发布的是现有仿真内核与所列数据条件下的标准化检查规则。覆盖率是离散有效空域采样的检出覆盖，不是连续空间无死角证明、现场探测概率、识别概率或拦截概率。电磁兼容规则仍为工程代理；没有测得真实频谱合规、建筑材料、室内外噪声、屋顶承载、供电通信、道路与权限条件。更换设备参数、补充DEM、改变范围/约束或提高网格精度后，须复算并形成新版本证据。','',
          '## 九、留存文件与复现方法','',
          '- 机器规则库：public/data/cross-map-deployment-rules.json；本轮归档副本：artifacts/cross-map-study/rules.json。',
          '- 完整过程：artifacts/cross-map-study/runs/<mapId>/<caseId>.json.gz，含全部参数快照、实际工况、设备参数与坐标、优化事件、逐设备解释、逐帧威胁、电磁处置和独立验证矩阵。',
          '- 完整参数字典：artifacts/cross-map-study/parameter-dictionary.json；运行索引：run-index.json；逐方案结果：all-plan-results.json与jsonl。',
          '- 规则证据：probes-<mapId>.json、capacity-validation.json、analysis.json、validation-report.json；数据与源代码哈希：manifest.json。',
          '- 本地分析页：artifacts/cross-map-study/跨地图部署分析.html；可筛选地图、配置、方案，查阅参数、结果、规则及地图验证记录。',
          '- 运行：node scripts/cross-map-study/run.js --workers=3；同指纹可断点续算。随后运行node scripts/cross-map-study/capacity-check.js，再运行python -X utf8 scripts/cross-map-study/analyze.py和node scripts/cross-map-study/render.js。',
          '', '## 十、原始资料及取值说明','',
          '原始设备参数表和区域数据说明经本机Word只读提取，原始PDF按页提取并检查。下列源文件的SHA-256同时保存在manifest中；原始文件保持不变。','']
for s in manifest['sourceFiles']:lines += [f'- {s["path"]}；SHA-256：{s["sha256"]}。']
lines += ['', '原始资料未给出的价格、传播附加量、真实空域许可和部分光电性能不补写为厂商事实。既有一图一轮的规则保留为历史产物，本轮跨地图规则另设版本和证据链，后续调用应优先读取带cross-map-deployment-rules/1模式标记的机器规则库。','']
(DOCS/'标准化布设规则.md').write_text('\n'.join(lines),encoding='utf-8')
(OUT/'标准化布设规则.md').write_text('\n'.join(lines),encoding='utf-8')
save(OUT/'dashboard-data.json',{'summary':{'maps':len(maps),'runs':len(runs),'plans':len(rows),'rules':len(accepted),'configurationCount':len(cases)},
                             'maps':[{'id':m,'name':maps[m]['name'],'geography':mapdata[m]['geography']} for m in maps],
                             'cases':list(cases.values()),'runs':runs,'plans':rows,'effects':effects,'rules':rulebook,'correlations':correlations,'morphology':morphology})
print(json.dumps({'result':'PASS','maps':len(maps),'runs':len(runs),'plans':len(rows),'acceptedRules':len(accepted),'notGeneralized':len(rulebook['notGeneralizedRules'])},ensure_ascii=False))
