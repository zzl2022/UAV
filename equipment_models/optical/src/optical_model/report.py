"""Offline Chinese presentation of existing results; never recalculates capability."""
import argparse
from html import escape
import json
from pathlib import Path

STATUS = {'provided': '原始资料提供（非本项目实测）', 'assumed': '假设值',
          'derived': '由输入计算', 'uncalibrated': '未标定', 'missing': '缺失',
          'relative_only': '仅供相对比较', 'insufficient_data': '数据不足',
          'unavailable_view': '当前观测条件不满足', 'outside_model_scope': '超出模型适用范围',
          'outside_device_conditions': '超出设备条件', 'clear': '直达路径未被所建建筑遮挡',
          'blocked': '直达路径被建筑遮挡', 'unknown': '无法判断'}
NAMES = {'clear': '无遮挡', 'blocked': '有建筑遮挡', 'day_clear': '白天晴好',
         'night_clear': '夜间', 'day_fog_rain': '白天雨雾', 'quiet_clear': '安静环境',
         'farther_clear': '目标更远', 'traffic': '交通噪声', 'mixed_city_noise': '多种城市噪声',
         'wind_rain': '风雨环境', 'building_screen': '建筑遮挡', 'narrow_corridor': '狭窄街巷',
         'missing_building_height': '建筑高度缺失', 'missing_source_level': '目标声级缺失',
         'official_footprints_unknown_height': '官方建筑轮廓／高度未确认',
         'official_footprints_synthetic_ray': '官方建筑轮廓／合成测试路径'}

def label(name):
    return '／'.join(NAMES.get(x, x) for x in name.split('/'))

def fmt(value):
    if value is None:
        return '无法计算／未提供'
    if isinstance(value, bool):
        return '是' if value else '否'
    if isinstance(value, (float, int)):
        return f'{value:.3f}'.rstrip('0').rstrip('.') if isinstance(value, float) else str(value)
    if isinstance(value, (list, tuple)):
        return ' × '.join(fmt(x) for x in value)
    return str(value)

def metric(m):
    if not isinstance(m, dict):
        return fmt(m)
    return f"{fmt(m.get('value'))} {m.get('unit', '')}【{STATUS.get(m.get('status'), m.get('status', '来源未提供'))}】"

def table(headers, rows):
    return '<div class="scroll"><table><thead><tr>' + ''.join('<th>'+escape(str(x))+'</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+escape(str(x))+'</td>' for x in row)+'</tr>' for row in rows) + '</tbody></table></div>'

def evidence(obj, prefix=''):
    rows = []
    if isinstance(obj, dict):
        if 'value' in obj and 'status' in obj:
            rows.append((prefix, metric(obj), json.dumps(obj.get('source'), ensure_ascii=False)))
        else:
            for key, value in obj.items():
                rows.extend(evidence(value, prefix+'.'+key if prefix else key))
    return rows

def explain(result, kind):
    notes = []
    if kind == 'acoustic':
        state = result.get('relative_signal_quality', {}).get('state', 'unknown')
        notes.append('结果状态：'+STATUS.get(state, state)+'。')
        path = result.get('building_environment', {}).get('direct_path', {}).get('state', 'unknown')
        if path == 'blocked':
            notes.append('建筑挡住了直达路径。声学模型按有限附加损失处理，不表示声音完全消失。')
        elif path == 'unknown':
            notes.append('建筑影响无法判断：请核对是否加载环境、建筑高度及模型适用范围。不能当作无遮挡。')
        snr = result.get('signal_noise_difference', {}).get('value')
        if snr is not None:
            relation = '高于' if snr >= 0 else '低于'
            notes.append(f'模型估计的目标声音{relation}所输入的环境噪声约 {abs(snr):.2f} dB；这不直接判定能否检测到目标。')
        else:
            notes.append('无法计算目标声音与噪声的差值，请核对目标参考声级、频带、环境噪声和传播损失所需数据。')
        notes.append('相对信号质量是模型归一化指标，不是探测概率；方向误差尺度也不是实测定位精度。')
    else:
        path = result.get('line_of_sight', {}).get('state', 'unknown')
        if path == 'blocked':
            notes.append('建筑挡住视线；当前不透明建筑体模型下无法直接观察目标。')
        elif path == 'unknown':
            notes.append('视线遮挡无法判断，请核对建筑高度及环境数据；未知不等于无遮挡。')
        for name, ch in result.get('channels', {}).items():
            title = {'visible':'可见光', 'thermal':'热成像'}.get(name, name)
            index = ch.get('relative_recognition_index', {})
            notes.append(title+'：'+STATUS.get(index.get('state'), str(index.get('state', 'unknown')))+'；目标中心在视场内：'+fmt(ch.get('target_in_fov', {}).get('value'))+'。')
            if index.get('state') == 'unavailable_view':
                notes.append(title+'当前观测条件不满足，请检查视场、云台朝向、建筑遮挡和工作温度。')
        notes.append('可见光受照度影响；热成像使用热对比度，不能把夜间简单理解为热成像失效。相对识别指标不是识别成功率。')
    return notes

def render_report(payload, kind, source_name=''):
    if kind not in ('optical', 'acoustic'):
        raise ValueError('kind must be optical or acoustic')
    if not isinstance(payload, dict) or not isinstance(payload.get('scenarios'), list) or not payload['scenarios']:
        raise ValueError('结果必须包含非空 scenarios 列表；请使用演示程序生成的 JSON')
    title = ('光电' if kind == 'optical' else '声学')+'模型中文结果报告'
    summaries, details = [], []
    for i, row in enumerate(payload['scenarios'], 1):
        if not isinstance(row, dict) or not isinstance(row.get('result'), dict):
            raise ValueError('每个场景必须包含 result 对象')
        r, name = row['result'], label(str(row.get('scenario', i)))
        required = 'channels' if kind == 'optical' else 'relative_signal_quality'
        if required not in r:
            raise ValueError('结果类型不匹配：请使用对应光电或声学报告入口')
        inputs = r.get('inputs', {})
        cond = inputs.get('conditions', {})
        distance = metric(r.get('distance'))
        if kind == 'acoustic':
            path = r.get('building_environment', {}).get('direct_path', {}).get('state', 'unknown')
            summaries.append([name, distance, STATUS.get(path, path), metric(r.get('noise', {}).get('total_level')), metric(r.get('signal_noise_difference')), metric(r.get('relative_signal_quality'))])
            input_rows = [('传感器坐标（米）', fmt(inputs.get('sensor', {}).get('position'))), ('目标坐标（米）', fmt(inputs.get('target', {}).get('position'))), ('目标参考声压级（dB SPL）', fmt(inputs.get('target', {}).get('reference_level_db'))), ('参考距离（米）', fmt(inputs.get('target', {}).get('reference_distance_m'))), ('目标频带（Hz）', fmt(inputs.get('target', {}).get('band_hz'))), ('风速（m/s）', fmt(cond.get('wind_speed_m_s'))), ('雨强（mm/h）', fmt(cond.get('rain_mm_h')))]
            for n in r.get('noise', {}).get('components', []):
                input_rows.append(('接收端噪声：'+str(n.get('name')), fmt(n.get('level_db'))+' dB SPL；'+STATUS.get(n.get('status'), str(n.get('status')))))
            axis_names = {'azimuth_scale':'方位角误差尺度', 'elevation_scale':'俯仰角误差尺度', 'azimuth_transverse_scale':'方位横向位移尺度', 'elevation_transverse_scale':'俯仰横向位移尺度', 'range_error':'距离估计误差', 'estimated_target_position':'估计目标位置'}
            extra = table(['方向不确定性（未标定，非实测精度）','结果'], [(axis_names.get(k,k), metric(v)) for k,v in r.get('direction_uncertainty', {}).items()])
        else:
            path = r.get('line_of_sight', {}).get('state', 'unknown')
            channels = r.get('channels', {})
            summaries.append([name, distance, STATUS.get(path, path), metric(channels.get('visible', {}).get('relative_recognition_index')), metric(channels.get('thermal', {}).get('relative_recognition_index'))])
            input_rows = [('传感器坐标（米）',fmt(inputs.get('pose', {}).get('position'))), ('目标坐标（米）',fmt(inputs.get('target', {}).get('position'))), ('照度（lux）',fmt(cond.get('illuminance_lux'))), ('能见度（米）', '未设置：当前模型不计雾项' if cond.get('visibility_m') is None else fmt(cond['visibility_m'])), ('雨强（mm/h）',fmt(cond.get('rain_mm_h'))), ('可见光对比度',fmt(cond.get('visible_contrast'))), ('热对比度',fmt(cond.get('thermal_contrast')))]
            extra = table(['通道','水平 × 垂直视场','目标中心在视场内','投影像素尺寸','状态'], [({'visible':'可见光','thermal':'热成像'}.get(k,k), metric(v.get('fov')),metric(v.get('target_in_fov')),metric(v.get('projected_target_size')),STATUS.get(v.get('relative_recognition_index',{}).get('state'), '未知')) for k,v in channels.items()])
        notes = ''.join('<li>'+escape(n)+'</li>' for n in explain(r, kind))
        details.append('<section><h2>'+str(i)+'. '+escape(name)+'</h2><ul>'+notes+'</ul>'+table(['输入条件','数值'],input_rows)+extra+'<details><summary>参数来源与结果状态（保留字段名，便于核查）</summary>'+table(['字段','数值及来源状态','原始来源说明'], evidence(r))+'</details><details><summary>完整原始场景数据</summary><pre>'+escape(json.dumps(row,ensure_ascii=False,indent=2))+'</pre></details></section>')
    headers = ['场景','距离','建筑路径','接收端总噪声','目标声音－环境噪声','相对信号质量（0～1）'] if kind == 'acoustic' else ['场景','距离','建筑视线','可见光相对指标（0～1）','热成像相对指标（0～1）']
    audit = payload.get('scene_audit')
    audit_text = '本结果包含建筑数据审计记录，详见下方原始元数据；读取真实轮廓不代表高度、目标或环境条件已经实测。' if audit else '本结果未附官方建筑读取审计记录；默认演示使用合成建筑场景，不应宣称为真实城区验证。'
    metadata = {k:v for k,v in payload.items() if k != 'scenarios'}
    return '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'''+title+'''</title><style>
body{font-family:"Microsoft YaHei",sans-serif;background:#f3f6fa;color:#203044;margin:0;line-height:1.7}main{max-width:1280px;margin:auto;padding:28px}h1{font-size:30px}h2{font-size:21px}.notice,section{background:white;border-radius:12px;padding:22px;margin:20px 0}.notice{border-left:6px solid #be7923}table{border-collapse:collapse;width:100%;background:white;font-size:14px}th,td{padding:12px;text-align:left;border:1px solid #dce3eb;min-width:100px}th{background:#e7eff8}.scroll{overflow-x:auto}details{margin-top:16px}summary{cursor:pointer;color:#165a91}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}button{padding:10px 20px;cursor:pointer}@media print{button{display:none}main{padding:0}.scroll{overflow:visible}th,td{min-width:0;padding:5px;font-size:10px}section{break-inside:avoid}body{background:white}}
</style><main><h1>'''+title+'</h1><p>结果文件：'+escape(source_name)+'</p><button onclick="window.print()">打印／另存为 PDF</button><div class="notice"><strong>阅读须知</strong><p>'+escape(str(payload.get('warning','本报告展示计算结果，未经实测标定。')))+' 相对指标 0.8 不代表 80% 成功率；0 不代表真实概率为零；“无法计算”不能当作零。</p><p>'+escape(audit_text)+'</p><p>本页只解释已有 JSON，不重新运行模型。修改配置后需重新计算并生成报告。表中对比为不同场景的描述，只有其他输入和配置一致时，才能将差异归因于单一因素。</p></div><h2>场景对比</h2>'+table(headers,summaries)+''.join(details)+'<section><h2>来源状态怎么理解</h2><p>原始资料提供：设备文件中的标称参数，不代表现场实测。假设值：用于演示或软件验证。由输入计算：可信程度取决于输入及模型假设。未标定：只能作模型内部相对比较。缺失：需要补充数据。</p><details><summary>本次运行元数据与建筑审计</summary><pre>'+escape(json.dumps(metadata,ensure_ascii=False,indent=2))+'</pre></details></section></main></html>'

def write_report(payload, output, kind, source_name=''):
    html = render_report(payload, kind, source_name)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding='utf-8')
    return output

def main(kind, root):
    parser = argparse.ArgumentParser(description='将模型演示 JSON 转成中文场景对比报告（离线 HTML）')
    parser.add_argument('--input', type=Path, default=root/'outputs'/f'{kind}_demo.json')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or args.input.with_name(args.input.stem+'_report.html')
    if output.resolve() == args.input.resolve():
        parser.error('报告输出不能覆盖输入 JSON')
    try:
        payload = json.loads(args.input.read_text(encoding='utf-8-sig'))
        write_report(payload, output, kind, str(args.input.resolve()))
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(1, f'生成报告失败：{exc}\n')
    print(f'中文报告已生成：{output.resolve()}')
