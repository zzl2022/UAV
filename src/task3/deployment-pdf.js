// 部署方案 PDF 导出：围绕“部署方案设计、覆盖效果推演、多维度方案择优、
// 多威胁场景鲁棒性验证、电磁兼容性校核”五大核心维度组织报告。
// 支持单方案与已生成方案（经济型/均衡型/增强型中选定的一套或多套）两种导出范围，数据全部来自当前 report/run。
import pdfMake from 'pdfmake/build/pdfmake';
import {createDeploymentDocument,createDeploymentDocumentAll} from './deployment-doc.js';
import {BLIND_CATEGORIES} from './constants.js';
import {createDeviceExplanation} from './device-explanation.js';
import {buildDeviceExplanationDocument} from './device-explanation-pdf.js';
import {pairedCoverageSvg} from './coverage-figure.js';

const FONT = 'NotoSansSC';
const FONT_FILE = 'NotoSansSC-Regular.otf';
const VERDICT = {pass: '通过', degraded: '降额', fail: '不通过'};
const EMC_KIND = {'co-channel': '同频干扰', 'adjacent-channel': '邻频提示', 'receiver-overlap': '发射信号落入接收频段', 'frontend-block': '前端阻塞', 'co-site': '同点过密'};
const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#0f766e';
const GOLD = '#b45309';
const LINE = '#d1d5db';

const isNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const percent = value => `${(Number(value) * 100).toFixed(2)}%`;
const pct = value => isNumber(value) ? percent(value) : '未提供';
const num = (value, digits = 1) => isNumber(value) ? Number(value).toFixed(digits) : '未提供';
const verdict = value => VERDICT[value] ?? '未提供';

let fontPromise = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

// 思源黑体只下载了 Regular 一个字重，bold/italics 复用同一文件（标题用字号与颜色区分层级）。
function ensureFont() {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    const url = new URL(`fonts/${FONT_FILE}`, new URL('./', location.href));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`中文字体加载失败：HTTP ${response.status}`);
    const base64 = arrayBufferToBase64(await response.arrayBuffer());
    pdfMake.sharedVirtualfs.writeFileSync(FONT_FILE, base64, 'base64');
    pdfMake.fonts = {
      [FONT]: {normal: FONT_FILE, bold: FONT_FILE, italics: FONT_FILE, bolditalics: FONT_FILE},
    };
    return true;
  })().catch(error=>{fontPromise=null;throw error;});
  return fontPromise;
}

const sectionTitle = (index, text) => ({text: `${index}、${text}`, bold: true, fontSize: 14, color: INK, margin: [0, 18, 0, 8]});
const subTitle = text => ({text, bold: true, fontSize: 11, color: ACCENT, margin: [0, 10, 0, 4]});
const muted = (text, margin = [0, 0, 0, 0]) => ({text, fontSize: 8.5, color: MUTED, margin});
const cell = (text, extra = {}) => ({text, fontSize: 8.5, ...extra});

function simpleTable(headers, rows, widths, {fontSize = 8.5} = {}) {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: widths.length ? widths : Array(headers.length).fill('*'),
      body: [headers.map(text => ({text, bold: true, fontSize, color: INK})), ...rows.map(row => row.map(value => typeof value === 'string' || typeof value === 'number' ? {text: String(value), fontSize} : value))],
    },
    layout: {
      hLineWidth: i => (i === 0 || i === 1 ? 0.6 : 0.3),
      hLineColor: () => LINE,
      vLineWidth: () => 0,
      fillColor: i => (i === 0 ? '#f3f4f6' : null),
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  };
}

function typeSummary(devices) {
  const counts = new Map();
  for (const device of devices) counts.set(device.typeName, (counts.get(device.typeName) ?? 0) + 1);
  return counts.size ? [...counts].map(([name, count]) => `${name} ${count} 台`).join('；') : '未提供';
}

function deviceName(model, id) {
  return model.devices.find(device => device.id === id)?.displayName ?? id;
}

// 内容完整性校验：缺方案、缺设备、缺指标、缺 EMC 或出现非法数值时直接给出中文错误，避免生成半成品 PDF。
export function validateDeploymentDocument(input) {
  const models = Array.isArray(input) ? input : [input];
  if (!models.length) throw new Error('PDF 文档缺少可导出的方案');
  for (const model of models) {
    const id = model?.plan?.id ?? '未知方案';
    if (!model?.plan?.id || !model?.source?.runId) throw new Error(`方案 ${id} 缺少方案标识或 runId`);
    if (!Array.isArray(model.devices) || !model.devices.length) throw new Error(`方案 ${id} 缺少设备点位`);
    if (!Array.isArray(model.metrics?.conditions) || !model.metrics.conditions.length) throw new Error(`方案 ${id} 缺少覆盖指标`);
    if (!model.emc?.verdict) throw new Error(`方案 ${id} 缺少 EMC 结论`);
    for (const row of model.metrics.conditions) {
      for (const key of ['coverageRate', 'blindRate', 'coreCoverageRate', 'coreRedundantRate']) {
        if (row[key] !== null && row[key] !== undefined && !Number.isFinite(Number(row[key]))) throw new Error(`方案 ${id} 的 ${key} 非法`);
      }
    }
  }
  return true;
}

function buildCover(models) {
  const first = models[0],selectedId = first.comparison.rows.find(row => row.selected)?.id ?? models.find(model => model.plan.recommended)?.plan.id;
  const coverModel = models.find(model => model.plan.recommended) ?? first;
  const summaryRows = models.map(model => {
    const averageCoverage = model.metrics.conditions.reduce((sum, row) => sum + (isNumber(row.coverageRate) ? Number(row.coverageRate) : 0), 0) / Math.max(1, model.metrics.conditions.length);
    return [
      cell(`${model.plan.name}${model.plan.recommended ? ' ★' : ''}${model.plan.id === selectedId ? ' · 当前选中' : ''}`, {bold: model.plan.id === selectedId}),
      cell(num(model.plan.deviceCount, 0)),
      cell(pct(averageCoverage)),
      cell(pct(model.metrics.averageBlindRate)),
      cell(num(model.plan.cost)),
      cell(model.plan.recommended ? '推荐' : '候选'),
      cell(verdict(model.emc.verdict)),
    ];
  });

  return [
    {text: '反无人机装备优化部署与仿真推演平台', fontSize: 9, bold: true, color: ACCENT},
    {text: `部署方案仿真推演报告${models.length > 1 ? '（已生成 ' + models.length + ' 套方案）' : ''}`, fontSize: 24, bold: true, color: INK, margin: [0, 6, 0, 4]},
    {text: '核心优化目标', fontSize: 10, bold: true, color: GOLD, margin: [0, 10, 0, 2]},
    {text: `${first.sceneName??'当前场景'} · 多工况覆盖与部署约束评估`, fontSize: 14, bold: true, color: INK},
    {text: '依托三维环境模型与多元装备特性模型，完成多套布设方案的自动化仿真推演与迭代优化。', fontSize: 10, color: MUTED, margin: [0, 4, 0, 10]},
    simpleTable(['方案', '设备', '平均覆盖率', '平均盲区占比', '相对成本', '推荐', 'EMC'], summaryRows, ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], {fontSize: 8}),
    {text: '报告范围', bold: true, fontSize: 10, margin: [0, 12, 0, 4]},
    simpleTable(['项目', '内容'], [
      ['runId', first.source.runId],
      ['报告时间 / 生成时间', `${first.source.reportCreatedAt ?? '未提供'} / ${first.generatedAt ?? '未提供'}`],
      ['覆盖范围', `东西 ${num(first.scope.widthM, 0)} m × 南北 ${num(first.scope.depthM, 0)} m`],
      ['装备构成', typeSummary(coverModel.devices)],
      ['方案数量', `${models.length} 套`],
    ], ['auto', '*']),
    {text: '报告结构', bold: true, fontSize: 10, margin: [0, 12, 0, 4]},
    {ul: [
      {text: '一、部署方案设计：装备选型、点位、安装方式与范围约束', fontSize: 9},
      {text: '二、覆盖效果推演：多工况覆盖率、核心区覆盖、盲区分类与面积估计', fontSize: 9},
      {text: '三、多维度方案择优：覆盖、盲区、成本、可行性四指标与综合排名', fontSize: 9},
      {text: '四、多威胁场景鲁棒性验证：单机、多方向、蜂群饱和三类场景', fontSize: 9},
      {text: '五、电磁兼容性校核：射频冲突、严重度与处置建议', fontSize: 9},
      {text: '六、警车部署与资源评估　七、通用布设规则核验　八、必要假设与模型限制',fontSize:9},
    ]},
  ];
}

function buildPlanDesign(models) {
  const first = models[0];
  const content = [
    sectionTitle('一', '部署方案设计'),
    {text: '以真实三维城市模型（建筑轮廓、DEM 与地形网格）为基础，结合雷达、无线电、光电、声学等多元装备特性模型，在给定范围、网格与高度层上生成候选点位，并通过覆盖推演迭代形成各套布设方案。', fontSize: 9.5, color: INK, margin: [0, 0, 0, 6]},
    simpleTable(['约束项', '取值'], [
      ['请求范围', `东西 ${num(first.scope.widthM, 0)} m × 南北 ${num(first.scope.depthM, 0)} m${first.scope.clipped ? '（已按有效地形裁切）' : ''}`],
      ['覆盖网格间距', `${num(first.grid.spacingM, 0)} m`],
      ['安装候选分格间距', `${num(first.grid.siteSpacingM, 0)} m`],
      ['离地高度层', first.grid.heightsM.map(value => `${num(value, 0)} m`).join(' / ')],
      ['有效空域采样 / 候选 / 初始站点', `${first.grid.sampleCount} / ${first.grid.candidateCount} / ${first.grid.siteCount}`],
      ['覆盖裕量门槛', `${num(first.grid.marginReserveDb)} dB`],
      ['建筑禁部署约束', `${first.buildingExclusions?.buildingIds?.length??0} 个源建筑实体；初始选点、补点、迁移与移动补盲共同遵守`],
    ], ['auto', '*']),
  ];

  models.forEach((model, index) => {
    content.push(subTitle(`${index + 1}. ${model.plan.name}${model.plan.recommended ? '（推荐）' : ''}`));
    const deviceRows = model.devices.map(device => [
      cell(device.displayName),
      cell(device.typeName),
      cell(device.modelName, {color: GOLD}),
      cell(device.siteName),
      cell(device.mobile ? '警车移动部署' : device.installation),
      cell(`东 ${num(device.position[0])}，上 ${num(device.position[1])}，北 ${num(-device.position[2])}`),
    ]);
    content.push(simpleTable(['设备', '类型', '型号', '部署点位', '安装方式', '模型坐标 / m'], deviceRows, ['auto', 'auto', 'auto', '*', '*', 'auto'], {fontSize: 7.5}));
    content.push(muted(`设备 ${model.plan.deviceCount} 台；类型构成：${typeSummary(model.devices)}；相对成本 ${num(model.plan.cost)}（非人民币报价）。`, [0, 4, 0, 4]));
    for (const item of model.cases) {
      content.push({
        stack: [
          {columns: [
            {text: `${item.displayName} · ${item.typeName}`, bold: true, color: ACCENT, fontSize: 8.5},
            {text: item.modelName, bold: true, color: GOLD, alignment: 'right', fontSize: 8.5},
          ]},
          {text: [{text: '点位：', bold: true, color: MUTED}, item.siteName], fontSize: 8, margin: [0, 2, 0, 0]},
          {text: [{text: '实际覆盖贡献：', bold: true, color: MUTED}, `${item.coveredSamples}/${item.totalSamples}；独立覆盖 ${item.independentSamples}`], fontSize: 8},
          {ul: item.reasons.map(reason => ({text: reason, fontSize: 8, color: '#374151'})), margin: [4, 2, 0, 0]},
        ],
        margin: [0, 0, 0, 6],
      });
    }
  });
  return content;
}

function buildCoverage(models) {
  const content = [
    sectionTitle('二', '覆盖效果推演'),
    {text: '覆盖效果按多工况离散空域采样计算；覆盖完整性取各工况覆盖率下限并计入核心区二重覆盖，盲区占比取各工况盲区率均值。', fontSize: 9.5, color: INK, margin: [0, 0, 0, 6]},
  ];

  models.forEach((model, index) => {
    content.push(subTitle(`${index + 1}. ${model.plan.name}`));
    const metricRows = model.metrics.conditions.map(row => [
      cell(row.name),
      cell(`${num(row.covered, 0)}/${num(row.total, 0)}`),
      cell(pct(row.coverageRate)),
      cell(pct(row.blindRate)),
      cell(pct(row.coreCoverageRate)),
      cell(pct(row.coreRedundantRate)),
    ]);
    content.push(simpleTable(['工况', '覆盖采样', '覆盖率', '盲区占比', '核心区覆盖', '核心二重覆盖'], metricRows, ['auto', 'auto', '*', '*', '*', '*'], {fontSize: 8}));

    const core = model.coverage.core;
    content.push({
      table: {widths: ['*', '*', '*', '*'], body: [[
        {stack: [{text: '核心区半径', fontSize: 8, color: MUTED}, {text: `${num(core.radiusM, 0)} m`, bold: true, fontSize: 11, color: ACCENT}]},
        {stack: [{text: '核心区采样', fontSize: 8, color: MUTED}, {text: num(core.sampleCount, 0), bold: true, fontSize: 11, color: ACCENT}]},
        {stack: [{text: '核心区覆盖率', fontSize: 8, color: MUTED}, {text: pct(core.coverageRate), bold: true, fontSize: 11, color: ACCENT}]},
        {stack: [{text: '核心区二重覆盖', fontSize: 8, color: MUTED}, {text: pct(core.redundantRate), bold: true, fontSize: 11, color: ACCENT}]},
      ]]},
      layout: {hLineWidth: () => 0.6, hLineColor: () => LINE, vLineWidth: () => 0.4, vLineColor: () => LINE, paddingTop: () => 6, paddingBottom: () => 6},
    });

    const blindHeaders = ['工况', '盲区合计', ...Object.values(BLIND_CATEGORIES)];
    const blindRows = model.metrics.conditions.map(row => [
      cell(row.name),
      cell(num(row.blindTotal, 0)),
      ...Object.keys(BLIND_CATEGORIES).map(key => cell(num(row.byCategory?.[key] ?? 0, 0))),
    ]);
    content.push(simpleTable(blindHeaders, blindRows, ['auto', 'auto', ...Array(Object.keys(BLIND_CATEGORIES).length).fill('*')], {fontSize: 7.5}));

    const areaRows = [];
    for (const row of model.metrics.conditions) {
      for (const area of row.areaEstimates ?? []) {
        areaRows.push([
          cell(row.name),
          cell(`${num(area.height, 0)} m`),
          cell(num(area.validGridCells, 0)),
          cell(num(area.blindGridCells, 0)),
          cell(num((area.approximateBlindAreaMeters2 ?? 0) / 1e6, 3)),
        ]);
      }
    }
    if (areaRows.length) content.push(simpleTable(['工况', '离地高度', '有效网格', '盲区网格', '近似盲区面积 / km²'], areaRows, ['auto', 'auto', '*', '*', '*'], {fontSize: 7.5}));
    else content.push(muted('当前报告未提供高度层面积估计。'));

    const weakest = model.metrics.conditions.find(row => row.condition === model.metrics.weakestConditionId) ?? model.metrics.conditions[0];
    content.push({
      text: `平均采样盲区占比 ${pct(model.metrics.averageBlindRate)}；最弱工况“${weakest?.name ?? '未提供'}”覆盖率 ${pct(weakest?.coverageRate)}。核心区覆盖率 ${pct(core.coverageRate)} 为离散采样口径，达到 100% 也不构成连续空域无盲区证明。`,
      fontSize: 8.5, color: GOLD, margin: [0, 4, 0, 8],
    });
  });
  return content;
}

function buildScoring(models) {
  const comparison = models[0].comparison;
  const content = [
    sectionTitle('三', '多维度方案择优'),
    {text: '对经济型、均衡型、增强型等多套布设方案执行同一覆盖推演与 EMC 校核，按覆盖完整性、盲区占比、配置成本、施工可行性四指标跨方案归一化后综合评分。', fontSize: 9.5, color: INK, margin: [0, 0, 0, 6]},
    subTitle('3.1 指标权重'),
  ];

  const weights = comparison.weights ?? {};
  content.push(simpleTable(['覆盖完整性', '盲区面积占比', '装备配置成本', '现场施工可行性'], [[cell(pct(weights.coverage)), cell(pct(weights.blind)), cell(pct(weights.cost)), cell(pct(weights.feasibility))]], ['*', '*', '*', '*']));
  content.push(muted('权重之和应为 100%；盲区面积占比与装备配置成本越小越好；装备配置成本为相对单位，非人民币报价。', [0, 4, 0, 6]));
  if (comparison.method) content.push(muted(comparison.method, [0, 0, 0, 6]));

  content.push(subTitle('3.2 方案比较'));
  const rows = comparison.rows.map(row => [
    cell(num(row.rank, 0)),
    cell(`${row.name}${row.recommended ? ' ★' : ''}${row.selected ? ' · 当前选中' : ''}`, {color: row.selected ? ACCENT : INK, bold: row.selected}),
    cell(num(row.deviceCount, 0)),
    cell(pct(row.coverage)),
    cell(pct(row.blindRatio)),
    cell(num(row.cost)),
    cell(num(row.feasibility, 3)),
    cell(verdict(row.emcVerdict)),
    cell(num(row.score, 4)),
  ]);
  content.push(simpleTable(['排名', '方案', '设备', '覆盖完整性', '盲区占比', '成本', '可行性', 'EMC', '综合得分'], rows, ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], {fontSize: 7.5}));

  content.push(subTitle('3.3 推荐结论'));
  const status = comparison.recommendationStatus === 'deployable' ? '推荐方案满足当前 EMC 可部署条件。' : comparison.recommendationStatus === 'unresolved' ? '所选方案仍有未解决的 EMC 严重冲突，推荐结果标记为未解决。' : '未提供推荐状态。';
  content.push({text: `推荐方案：${comparison.recommendedName ?? '未提供'}（${comparison.recommendedId ?? '—'}）。${status}`, fontSize: 9.5, color: INK, margin: [0, 0, 0, 4]});
  content.push(muted('方案比较排名始终基于原流水线方案；警车移动补盲派生方案的新增设备与成本不参与原排名。'));
  return content;
}

function buildThreats(models) {
  const content = [sectionTitle('四', '多威胁场景鲁棒性验证')];
  models.forEach((model, index) => {
    const threats = model.threats;
    content.push(subTitle(`${index + 1}. ${model.plan.name}`));
    if (threats.note) content.push(muted(threats.note));
    if (!threats.available || !threats.scenarios.length) {
      content.push(muted('当前报告未提供该方案的威胁场景验证结果。'));
      return;
    }
    const rows = threats.scenarios.map(scenario => [
      cell(scenario.name, {bold: true}),
      cell(num(scenario.targetCount, 0)),
      cell(`${num(scenario.detectedCount, 0)} 架`),
      cell(scenario.meanFirstDetectionTime === null ? '未检出' : `${num(scenario.meanFirstDetectionTime)} s`),
      cell(pct(scenario.meanDetectedFraction)),
      cell(pct(scenario.minDetectedFraction)),
      cell(`${num(scenario.overflowEvents, 0)} 架次${scenario.overflowedTargets ? `（涉及 ${num(scenario.overflowedTargets, 0)} 架）` : ''}`),
    ]);
    content.push(simpleTable(['威胁场景', '目标数', '检出数', '平均首报', '平均检出占比', '最低检出占比', '容量溢出'], rows, ['auto', 'auto', 'auto', 'auto', '*', '*', 'auto'], {fontSize: 7.5}));

    for (const scenario of threats.scenarios) {
      if (!scenario.perTarget.length) continue;
      const weakest = [...scenario.perTarget].sort((a, b) => (a.detectedFraction ?? 1) - (b.detectedFraction ?? 1)).slice(0, 5);
      const targetRows = weakest.map(target => [
        cell(target.id ?? '—'),
        cell(target.firstDetectionTime === null ? '未检出' : `${num(target.firstDetectionTime)} s`),
        cell(pct(target.detectedFraction)),
        cell(num(target.lossEvents, 0)),
      ]);
      content.push(muted(`${scenario.name} · 检出占比最低的 ${weakest.length} 个目标（共 ${scenario.perTarget.length} 个）`, [0, 2, 0, 2]));
      content.push(simpleTable(['目标', '首报时间', '检出占比', '失联次数'], targetRows, ['*', 'auto', 'auto', 'auto'], {fontSize: 7.5}));
    }
  });
  content.push(muted('检出结果来自感知模型对三维场景遮挡与装备参数的逐帧实判；容量溢出与漏探如实计数，不宣称全威胁鲁棒。', [0, 6, 0, 0]));
  return content;
}

function buildEmc(models) {
  const content = [sectionTitle('五', '电磁兼容性校核')];
  models.forEach((model, index) => {
    const emc = model.emc;
    content.push(subTitle(`${index + 1}. ${model.plan.name}`));
    content.push({text: `校核结论：${verdict(emc.verdict)}；严重冲突 ${num(emc.counts.fail, 0)} 项，提示冲突 ${num(emc.counts.warning, 0)} 项。`, fontSize: 9.5, bold: true, color: emc.verdict === 'fail' ? '#b91c1c' : emc.verdict === 'degraded' ? GOLD : ACCENT, margin: [0, 0, 0, 4]});
    if (emc.text) content.push({text: emc.text, fontSize: 8.5, color: INK, margin: [0, 0, 0, 4]});

    if (emc.conflicts.length) {
      const rows = emc.conflicts.map(conflict => [
        cell(`${deviceName(model, conflict.a)} ↔ ${deviceName(model, conflict.b)}`),
        cell(EMC_KIND[conflict.kind] ?? conflict.kind),
        cell(conflict.severity === 'fail' ? '严重' : '提示', {color: conflict.severity === 'fail' ? '#b91c1c' : GOLD}),
        cell(num(conflict.distanceM)),
        cell(conflict.recommendation ?? '未提供'),
      ]);
      content.push(simpleTable(['设备对', '冲突类型', '严重度', '距离 / m', '处置建议'], rows, ['*', 'auto', 'auto', 'auto', '*'], {fontSize: 7.5}));
    } else {
      content.push(muted('未发现装备间射频冲突。'));
    }

    if (emc.remediation) {
      const statusText = emc.remediation.status === 'not-required' ? '无需处置' : emc.remediation.status === 'resolved' ? '已通过换频/局部移位解决严重冲突' : emc.remediation.status === 'unresolved' ? '仍有未解决的严重冲突，需要人工调整装备或点位' : '未提供处置状态';
      content.push({text: `自动处置：${statusText}；处置动作 ${emc.remediation.actionCount} 项；剩余未解决严重冲突 ${emc.remediation.unresolvedCount} 项。`, fontSize: 8.5, color: INK, margin: [0, 4, 0, 2]});
      const initial=emc.remediation.initial?.conflicts??[];
      for(const kind of new Set(initial.filter(c=>c.severity==='fail').map(c=>c.kind))){
        const issues=initial.filter(c=>c.severity==='fail'&&c.kind===kind);
        const remaining=emc.conflicts.filter(c=>c.severity==='fail'&&c.kind===kind);
        content.push(muted(`${EMC_KIND[kind]??kind}：初检 ${issues.length} 项，最终 ${remaining.length} 项。处置建议：${[...new Set(issues.map(c=>c.recommendation).filter(Boolean))].join('；')}`));
      }
      for (const action of emc.remediation.actions) {
        content.push({text: `${num(action.step, 0)}. ${action.action === 'retune' ? '换频' : '局部移位'} · ${deviceName(model, action.deviceId)} · ${action.reason ?? ''}`, fontSize: 8, color: '#374151', margin: [8, 0, 0, 1]});
      }
      const review=emc.remediation.warningReview;
      content.push(muted(review?`提示级修复：提示项由 ${review.before.counts.warning} 项变为 ${review.after.counts.warning} 项，严重项由 ${review.before.counts.fail} 项变为 ${review.after.counts.fail} 项。${review.reason??''}`:'未记录提示级自动修复。'));
      if(review?.actions?.length)content.push(simpleTable(['设备','调整方式','调整前','调整后'],review.actions.map(a=>[deviceName(model,a.replacementDeviceId??a.deviceId),a.action==='retune'?'换频':'移位',...([a.before,a.after].map(s=>a.action==='retune'?`${num(s.frequencyGHz,3)} GHz`:s.siteId??'未记录'))]),['*','auto','*','*']));
    } else {
      content.push(muted('当前方案未提供自动处置记录。'));
    }
    if (emc.notes.length) content.push(muted(emc.notes.join('；'), [0, 2, 0, 2]));
  });
  content.push(muted('EMC 为基于装备频段事实与工程阈值的代理校核，不是频谱合规认证；现场仍需频谱监测与实测复核。', [0, 6, 0, 0]));
  return content;
}

function buildLimitations(models) {
  const limitations = [...new Set(models.flatMap(model => model.limitations))];
  return [
    sectionTitle('八', '必要假设与模型限制'),
    {ul: limitations.map(item => ({text: item, fontSize: 9, color: INK, margin: [0, 0, 0, 2]})), margin: [0, 0, 0, 6]},
    {text: '覆盖率是离散有效采样的计算结果，不是连续空域无盲区证明；施工条件、道路可达性与电磁合规仍需现场实测。', fontSize: 9, color: GOLD},
  ];
}

const paragraph=text=>({text,leadingIndent:20,fontSize:10,margin:[0,3,0,5],lineHeight:1.35});
function mobileText(model){
 const m=model.mobileRepair,d=model.daily;
 const base=m.enabled?`在${model.metrics.conditions.find(c=>c.condition===m.conditionId)?.name??m.conditionId}工况下，新增 ${num(m.addedDeviceCount,0)} 台车载设备，未覆盖采样点由 ${num(m.before,0)} 个变为 ${num(m.after,0)} 个。车载设备增量成本为 ${num(m.addedCost)} 个相对单位。`:'本轮方案采用固定设备，未启用警车补盲。';
 return base+(d?`日常部署核算可用 ${d.available} 辆、使用 ${d.used} 辆，覆盖原有 ${d.total} 个未覆盖点中的 ${d.covered} 个。`:'当前工况未记录限额车辆的日常部署核算。');
}
function exampleFigures(model){
 const index=model.metrics.conditions.findIndex(c=>c.condition===model.caseCondition.id);
 return (model.examples??[]).map((e,i)=>{
  const svg=e.bands&&pairedCoverageSvg(e.bands,index);
  return {unbreakable:true,stack:[
   subTitle(`${e.displayName}　${e.modelName}`),
   paragraph(`${model.caseCondition.name}工况下，该设备覆盖 ${e.coveredSamples}／${e.totalSamples} 个采样点，其中独立覆盖 ${e.independentSamples} 个。`),
   ...(svg?[{svg,width:430,alignment:'center'}, {...muted(`图 ${i+1}　距离—高度剖面（左）与同一设备的三维分层演示（右）`),alignment:'center'}]:[muted('该运行记录未保存距离及高度分档计数。')]),
  ]};
 });
}
const figureKey='横轴为水平距离（米），各层按离地高度标注。环带颜色由浅至深表示分档覆盖率升高，灰色表示无样本。各方位合并统计。';
function ruleSection(models){
 const content=[sectionTitle('七','通用布设规则核验')];
 for(const model of models){
  content.push(subTitle(model.plan.name));
  if(!model.matchedRules){content.push(muted('该记录未附通用规则库。'));continue;}
  content.push(muted(`规则库日期 ${model.ruleVersion?.slice(0,10)??'未记录'}。本轮逐条核对触发条件及关联设备。`));
  for(const r of model.matchedRules){
   content.push({unbreakable:true,stack:[
    subTitle(`${r.id}　${r.condition}`),paragraph(r.conclusion),muted(r.basis),
    muted(r.deviceIds.length?'关联设备：'+r.deviceIds.map(id=>deviceName(model,id)).join('、'):'本轮无匹配设备。')
   ]});
  }
 }
 return content;
}

export function buildBriefDocument(model){
 validateDeploymentDocument(model);
 const name=model.sceneName??'当前场景',figures=exampleFigures(model),rows=new Map();
 for(const d of model.devices){const key=d.modelName+'｜'+(d.mobile?'车载':'固定');rows.set(key,(rows.get(key)??0)+1);}
 const matches=model.matchedRules?.filter(r=>r.deviceIds.length);
 const metrics=model.metrics.conditions;
 const weakest=metrics.find(c=>c.condition===model.metrics.weakestConditionId);
 return {pageSize:'A4',pageMargins:[42,40,42,42],defaultStyle:{font:FONT,fontSize:10,color:INK},
  info:{title:name+'仿真部署方案（精简版）'},footer:(p,n)=>({text:`第 ${p} / ${n} 页`,alignment:'center',fontSize:8,color:MUTED,margin:[0,15]}),
  content:[{text:name+'仿真部署方案',fontSize:19,bold:true,alignment:'center'},{text:model.plan.name,alignment:'center',margin:[0,4,0,6]},
   sectionTitle('一','部署方案概述'),paragraph(`推演范围为 ${num(model.scope.widthM,0)} 米 × ${num(model.scope.depthM,0)} 米。水平网格间距 ${model.grid.spacingM} 米，离地高度层为 ${model.grid.heightsM.join('、')} 米，共有 ${model.grid.sampleCount} 个有效采样点。覆盖指标按各工况独立计算。`),
   sectionTitle('二','装备部署清单'),simpleTable(['装备型号','部署方式','数量／台'],[...rows].map(([k,n])=>[...k.split('｜'),n]),['*','*','auto']),
   paragraph(`本方案共 ${model.devices.length} 台设备，相对成本为 ${num(model.plan.cost)}。`+mobileText(model)),
   sectionTitle('三','关键点位展示'),muted(figureKey),...figures.slice(0,1),
   ...(figures.length>1?[{text:'关键点位展示（续）',pageBreak:'before',fontSize:13,bold:true},...figures.slice(1)]:[]),
   {...sectionTitle('四','推演效果分析'),...(figures.length<2?{pageBreak:'before'}:{})},simpleTable(['工况','覆盖点／有效点','全域覆盖率','核心二重覆盖率'],metrics.map(c=>[c.name,`${num(c.covered,0)}／${num(c.total,0)}`,pct(c.coverageRate),pct(c.coreRedundantRate)]),['*','auto','auto','auto']),
   ...(weakest?[paragraph(`全域采样覆盖率最低的工况为“${weakest.name}”，覆盖 ${num(weakest.covered,0)} 个采样点。该工况的核心二重覆盖率为 ${pct(weakest.coreRedundantRate)}，表示核心区内至少两台设备同时达到判定门限的采样比例。`)]:[]),
   paragraph(`电磁兼容校核记录严重冲突 ${model.emc.counts.fail} 项、提示 ${model.emc.counts.warning} 项。`+(model.emc.remediation?.warningReview?'已执行提示级修复，表述采用修复后的校核结果。':'未记录提示级自动修复。')),
   paragraph(matches?`通用规则核验共匹配 ${matches.length} 条。`+matches.map(r=>`${r.id}（${r.condition}）关联 ${r.deviceIds.length} 台`).join('；')+(matches.length?'。':''):'本轮未附通用规则核验记录。'),
   ...(model.threats.available?[paragraph((model.threats.note??'动态推演按有效目标帧统计。')+model.threats.scenarios.map(s=>`${s.name}平均检出占比 ${pct(s.meanDetectedFraction)}`).join('，')+'。')]:[]),
   muted('覆盖率适用于本轮离散采样与模型条件。'),muted(`运行编号　${model.source.runId}`)
  ]};
}

// 单方案或全部方案共用同一渲染入口；传入数组即生成合并报告。
export function buildDocument(input) {
  const models = Array.isArray(input) ? input : [input];
  validateDeploymentDocument(models);
  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 48],
    defaultStyle: {font: FONT, fontSize: 10, color: INK, lineHeight: 1.4},
    info: {title: `部署方案仿真推演报告-${models.map(model => model.plan.name).join('-')}`, author: '反无人机装备优化部署与仿真推演平台'},
    footer: (currentPage, pageCount) => ({text: `第 ${currentPage} / ${pageCount} 页`, alignment: 'center', fontSize: 8, color: MUTED, margin: [0, 20, 0, 0]}),
    content: [
      ...buildCover(models),
      ...buildPlanDesign(models),
      ...buildCoverage(models),
      ...models.flatMap(m=>[subTitle(m.plan.name+' · 代表设备分层覆盖'),muted(figureKey),...exampleFigures(m)]),
      ...buildScoring(models),
      ...buildThreats(models),
      ...buildEmc(models),
      sectionTitle('六','警车部署与资源评估'),...models.flatMap(m=>[subTitle(m.plan.name),paragraph(mobileText(m))]),
      ...ruleSection(models),
      ...buildLimitations(models),
    ],
  };
}

// 供浏览器端测试/预览直接取得 PDF 二进制，不触发下载。
export async function renderDeploymentPdfBuffer(input) {
  await ensureFont();
  const docDefinition = buildDocument(input);
  return pdfMake.createPdf(docDefinition).getBuffer();
}

export function buildDeviceExplanationPdf(model){return buildDeviceExplanationDocument(model);}
export async function renderDeviceExplanationPdfBuffer(model){await ensureFont();return pdfMake.createPdf(buildDeviceExplanationPdf(model)).getBuffer();}
export async function exportDeviceExplanationPdf(input){
 const model=createDeviceExplanation(input);await ensureFont();
 await pdfMake.createPdf(buildDeviceExplanationPdf(model)).download(`设备部署解释明细-${model.runId}-${model.planId}.pdf`);return model;
}

// 导出入口：确保字体就绪后生成并下载 PDF。
// planIds='all' 时一次生成三套方案的完整合并报告；否则仅导出当前方案。
export async function exportDeploymentPdf({report,run,planIds='all',activePlanId,rules=[],conditionId,review,brief=false,isCurrent=()=>true}){
  const args={report,run,activePlanId,rules,conditionId,review},all=!brief&&planIds==='all';
  const document=all?createDeploymentDocumentAll(args):createDeploymentDocument(args);
  const plans=all?document.plans:[document];
  const definition=brief?buildBriefDocument(document):buildDocument(plans);
  await ensureFont();
  const blob=await pdfMake.createPdf(definition).getBlob();
  if(!isCurrent())throw Error('导出期间方案或工况已变化，请重新导出。');
  window.__task3DeploymentModel=document;window.__task3DeploymentPlans=plans;
  const suffix=brief?'精简版':all?'已生成方案':activePlanId;
  const a=window.document.createElement('a'),url=URL.createObjectURL(blob);
  a.href=url;a.download=`${plans[0].sceneName}-部署方案仿真推演报告-${run.runId}-${suffix}.pdf`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
