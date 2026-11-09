// 部署方案 PDF 导出：pdfmake + 思源黑体，完整五大节，多场景通用。
// 数据全部来自当前场景的动态 report/run（createDeploymentDocument 产出），不硬编码任何场景。
import pdfMake from 'pdfmake/build/pdfmake';
import {createDeploymentDocument} from './deployment-doc.js';

const FONT = 'NotoSansSC';
const FONT_FILE = 'NotoSansSC-Regular.otf';
const VERDICT = {pass: '通过', degraded: '降额', fail: '不通过'};
const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#0f766e';
const GOLD = '#b45309';
const LINE = '#d1d5db';

const percent = value => `${(value * 100).toFixed(2)}%`;
const number = (value, digits = 1) => Number(value).toFixed(digits);

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
  })();
  return fontPromise;
}

const sectionTitle = text => ({text, bold: true, fontSize: 14, color: INK, margin: [0, 18, 0, 8]});
const muted = (text, margin = [0, 0, 0, 0]) => ({text, fontSize: 8.5, color: MUTED, margin});

function buildMetricTable(model) {
  const body = [['工况', '覆盖采样', '覆盖率', '盲区占比', '核心区覆盖', '核心二重覆盖']];
  for (const row of model.metrics.conditions) {
    body.push([row.name, `${row.covered}/${row.total}`, percent(row.coverageRate), percent(row.blindRate), percent(row.coreCoverageRate), percent(row.coreRedundantRate)]);
  }
  return {
    table: {
      headerRows: 1,
      widths: ['auto', 'auto', '*', '*', '*', '*'],
      body,
    },
    layout: {
      hLineWidth: i => (i === 0 || i === 1 ? 0.6 : 0.3),
      hLineColor: () => LINE,
      vLineWidth: () => 0,
      fillColor: () => '#f3f4f6',
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  };
}

function buildCards(model) {
  const caseMetric = model.metrics.conditions.find(row => row.condition === model.caseCondition.id) ?? model.metrics.conditions[0];
  const cards = [
    {num: `${model.plan.deviceCount} 台`, label: '当前方案实际设备数'},
    {num: percent(caseMetric.coverageRate), label: `${model.caseCondition.name}采样覆盖率`},
    {num: percent(model.metrics.averageBlindRate), label: '各工况平均采样盲区占比'},
    {num: number(model.plan.cost), label: '相对成本，非人民币报价'},
    {num: VERDICT[model.emc.verdict], label: `EMC：严重 ${model.emc.counts.fail} / 提示 ${model.emc.counts.warning}`},
  ];
  const cells = cards.map(card => ({
    stack: [
      {text: card.num, bold: true, fontSize: 13, color: ACCENT, alignment: 'center'},
      {text: card.label, fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 3, 0, 0]},
    ],
    alignment: 'center',
  }));
  return {
    table: {body: [cells]},
    layout: {
      hLineWidth: () => 0.6,
      hLineColor: () => LINE,
      vLineWidth: () => 0.4,
      vLineColor: () => LINE,
      paddingTop: () => 8,
      paddingBottom: () => 8,
      paddingLeft: () => 4,
      paddingRight: () => 4,
    },
  };
}

function buildRules(model) {
  if (!model.rules.length) return {text: '当前多轮记录没有满足样本量要求的规则。', fontSize: 9, color: MUTED};
  return model.rules.map(rule => ({
    stack: [
      {text: `${rule.id} · ${rule.title}`, bold: true, fontSize: 10, color: ACCENT, margin: [0, 0, 0, 2]},
      {text: rule.text, fontSize: 9.5, color: INK},
      {text: `样本量 ${rule.evidence.samples}；统计口径：${rule.evidence.method}；来源 runId：${rule.evidence.runIds}`, fontSize: 8, color: MUTED, margin: [0, 3, 0, 0]},
    ],
    margin: [0, 0, 0, 8],
  }));
}

function buildCases(model) {
  return model.cases.map(item => ({
    stack: [
      {columns: [
        {text: `${item.displayName} · ${item.typeName}`, bold: true, color: ACCENT},
        {text: item.modelName, bold: true, color: GOLD, alignment: 'right'},
      ]},
      {text: [{text: '点位：', bold: true, color: MUTED}, item.siteName], fontSize: 8.5, margin: [0, 2, 0, 0]},
      {text: [{text: '模型坐标 / m：', bold: true, color: MUTED}, `东 ${number(item.position[0])}，上 ${number(item.position[1])}，北 ${number(-item.position[2])}`], fontSize: 8.5},
      {text: [{text: '实际覆盖贡献：', bold: true, color: MUTED}, `${item.coveredSamples}/${item.totalSamples}；独立覆盖 ${item.independentSamples}`], fontSize: 8.5},
      {text: [{text: '部署状态：', bold: true, color: MUTED}, item.mobile ? '警车移动补盲新增设备' : '原流水线固定点位设备'], fontSize: 8.5},
      {ul: item.reasons.map(reason => ({text: reason, fontSize: 8.5, color: '#374151'})), margin: [4, 3, 0, 0]},
    ],
    margin: [0, 0, 0, 10],
  }));
}

function buildDocument(model) {
  const plan = model.plan;
  const content = [
    {text: '创意科目二 · 子任务三 · 真实流水线导出', fontSize: 9, bold: true, color: ACCENT},
    {text: '当前推演方案\n布设规则与代表点案例', fontSize: 22, bold: true, color: INK, lineHeight: 1.25, margin: [0, 4, 0, 4]},
    {text: `方案：${plan.name}${plan.recommended ? '（本次推荐方案）' : '（当前选中方案）'} · runId：${model.source.runId}`, fontSize: 9, color: MUTED},
    {text: `报告时间 ${model.source.reportCreatedAt}；文档生成时间 ${model.generatedAt}`, fontSize: 9, color: MUTED, margin: [0, 0, 0, 4]},

    sectionTitle('一、方案与关键指标'),
    buildCards(model),
    muted('以下为各工况采样覆盖指标（来自当前 report/run 的真实离散采样计算）。', [0, 4, 0, 4]),
    buildMetricTable(model),

    sectionTitle('二、真实 GIS 范围与网格口径'),
    {text: [
      {text: '请求范围：', bold: true}, `东西 ${number(model.scope.widthM, 0)} m × 南北 ${number(model.scope.depthM, 0)} m。`,
      {text: '覆盖网格间距 '}, `${number(model.grid.spacingM, 0)} m，屋顶候选抽稀间距 ${number(model.grid.siteSpacingM, 0)} m，离地高度层 ${model.grid.heightsM.join(' / ')} m。`,
    ], fontSize: 9.5, color: INK, margin: [0, 0, 0, 3]},
    {text: `有效空域采样 ${model.grid.sampleCount} 个；候选 ${model.grid.candidateCount} 个；初始屋顶站点 ${model.grid.siteCount} 个；覆盖裕量门槛 ${number(model.grid.marginReserveDb)} dB。`, fontSize: 9.5, color: INK, margin: [0, 0, 0, 3]},
    {text: model.scope.note, fontSize: 9, color: MUTED},

    sectionTitle('三、多轮仿真提炼的布设规则'),
    muted('只列出具有实际样本、统计口径和 runId 的规则；样本不足的规则不生成。', [0, 0, 0, 6]),
    buildRules(model),

    sectionTitle(`四、当前实际方案代表点（${model.cases.length} 个）`),
    muted(`从当前${plan.recommended ? '推荐' : '选中'}方案的 ${model.caseCondition.name} 逐设备真实贡献中选取：优先独立覆盖，并补充设备类型与移动派生代表性。`, [0, 0, 0, 6]),
    buildCases(model),

    sectionTitle('五、必要假设与模型限制'),
    {ul: model.limitations.map(item => ({text: item, fontSize: 9, color: INK, margin: [0, 0, 0, 2]})), margin: [0, 0, 0, 6]},
    {text: '覆盖率是离散有效采样的计算结果，不是连续空域无盲区证明；施工、道路可达与电磁合规仍需现场实测。', fontSize: 9, color: GOLD},
  ];

  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 48],
    defaultStyle: {font: FONT, fontSize: 10, color: INK, lineHeight: 1.4},
    info: {title: `任务三部署方案-${plan.name}`, author: '反无装备优化部署与仿真推演平台'},
    footer: (currentPage, pageCount) => ({text: `第 ${currentPage} / ${pageCount} 页`, alignment: 'center', fontSize: 8, color: MUTED, margin: [0, 20, 0, 0]}),
    content,
  };
}

// 导出入口：确保字体就绪后生成并下载 PDF。文件名随 runId 与方案 id，多场景通用。
export async function exportDeploymentPdf({report, run, activePlanId, rules = [], conditionId}) {
  await ensureFont();
  const model = createDeploymentDocument({
    report,
    run,
    activePlanId,
    rules,
    conditionId,
    documentKind: 'current',
  });
  window.__task3DeploymentModel = model; // 供浏览器冒烟测试校验文档数据模型
  const docDefinition = buildDocument(model);
  await pdfMake.createPdf(docDefinition).download(`任务三部署方案-${run.runId}-${activePlanId}.pdf`);
}
