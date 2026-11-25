"""Allow-listed simulation statistics for project Q&A."""

import math


PLAN_NAMES = {'economy': '经济型', 'balanced': '均衡型', 'enhanced': '增强型'}
CONDITION_NAMES = {
    'nominal': '基线 · 发射', 'silent': '无线电静默',
    'weather': '雨雾及街道噪声', 'interference': '电磁干扰',
}
STATUS_LABELS = {
    'none': '当前场景尚未生成方案',
    'switching': '正在切换场景，等待新场景就绪',
    'working': '方案结果正在计算',
    'stale': '输入已修改，需要重新生成方案',
    'ready': '本轮已生成',
}
RECOMMENDATION = {'deployable': '通过本轮模型筛选', 'unresolved': '推荐排序仍有严重 EMC 冲突'}
EMC_VERDICTS = {'pass': '通过', 'degraded': '降额', 'fail': '不通过'}
COMPARISON_RATIOS = {
    'score': '综合得分', 'scoreBeforeEmc': 'EMC 校核前得分', 'emcFactor': 'EMC 校核系数',
    'coverage': '覆盖完整性指标', 'blindRatio': '平均盲区占比', 'feasibility': '施工可行性代理分',
}
CONDITION_RATIOS = {
    'coverageRate': '采样覆盖率', 'blindRate': '采样盲区占比',
    'coreCoverageRate': '核心区覆盖率', 'coreRedundantRate': '核心区二重覆盖率',
}
DEVICE_TYPES = {
    'radar': ('雷达', '利用回波参与仿真目标的发现与跟踪。'),
    'radio': ('无线电', '通过接收无线电信号，为其他感知手段提供补充线索。'),
    'optical': ('光电', '利用可见光或热成像进行画面观察，辅助核验目标。'),
    'acoustic': ('声学', '根据声音特征提供辅助感知，与其他设备互补。'),
}
DEVICE_MODELS = {
    'radar-02c': ('radar', '02C 三坐标雷达'),
    'radar-03d': ('radar', '03D 三坐标雷达'),
    'radio-tdoa': ('radio', 'TDOA-X1B'),
    'radio-mini': ('radio', 'OA-X1Bmini'),
    'radio-x1c': ('radio', 'X1C 侦测设备'),
    'optical-nvt': ('optical', 'NVT-951 双光谱光电'),
    'acoustic-cry': ('acoustic', 'CRY8500 声学相机'),
}
DEVICE_ROLES = {
    'greedy': '原方案首轮选入，承担基础感知覆盖。',
    'refill': '原方案的补选设备，用于补充感知覆盖。',
    'redundancy': '原方案的二重覆盖增强设备，为已有覆盖增加冗余。',
    'mobile': '移动补盲阶段新增，用于补充本轮方案的感知覆盖。',
}
DEVICE_STATUSES = {
    'found': '已定位设备',
    'choose-plan': '请确认要查询的方案',
    'plan-not-found': '本轮未生成所问方案',
    'choose-device': '请提供一台设备的界面编号',
    'not-found': '所问编号不在这套方案中',
}


def _label(choices, value):
    return choices.get(value) if isinstance(value, str) else None


def _numbers(data, fields, maximum, *, integers=False):
    if not isinstance(data, dict):
        return {}
    values = {}
    for key, label in fields.items():
        number = data.get(key)
        if type(number) not in (int, float) or not 0 <= number <= maximum or not math.isfinite(number):
            continue
        if integers and number != int(number):
            continue
        values[label] = int(number) if integers else round(number, 6)
    return values


def _conditions(rows):
    if not isinstance(rows, list) or len(rows) > len(CONDITION_NAMES):
        return []
    summary = []
    for item in rows:
        if not isinstance(item, dict) or not (name := _label(CONDITION_NAMES, item.get('id'))):
            continue
        summary.append({
            '工况': name,
            **_numbers(item, CONDITION_RATIOS, 1),
            **_numbers(item, {'covered': '覆盖采样点', 'total': '有效采样点'}, 10_000_000, integers=True),
        })
    return summary


def _emc(data):
    if not isinstance(data, dict):
        return {}
    return {
        '结论': _label(EMC_VERDICTS, data.get('verdict')),
        **_numbers(data, {'severe': '严重冲突数', 'warnings': '提示数'}, 100_000, integers=True),
    }


def _plan_totals(plan):
    return {
        **_numbers(plan, {'deviceCount': '设备数量', 'deviceLimit': '设备上限'}, 256, integers=True),
        **_numbers(plan, {'cost': '相对成本', 'budget': '相对预算'}, 100_000),
        'EMC': _emc(plan.get('emc')),
        '工况明细': _conditions(plan.get('conditions')),
    }


def _device_summary(device, rows_by_id, active_id, supplement):
    if not isinstance(device, dict) or not (status := _label(DEVICE_STATUSES, device.get('status'))):
        return None
    details = {'状态': status}
    plan_id = device.get('planId')
    plan_name = _label(PLAN_NAMES, plan_id)
    if not plan_name:
        return details
    details['方案'] = plan_name
    plan = rows_by_id.get(plan_id)
    if not plan:
        details['状态'] = DEVICE_STATUSES['plan-not-found']
        return details
    totals = supplement if plan_id == active_id and supplement else plan
    count = totals.get('设备数量')
    if count is not None:
        details['方案设备数量'] = count
    number = _numbers(device, {'number': '编号'}, 999_999, integers=True).get('编号')
    if number is not None:
        details['设备编号'] = f'设备-{number}'
    if device['status'] != 'found':
        return details
    if number is None or count is None or not 1 <= number <= count:
        details['状态'] = DEVICE_STATUSES['not-found']
        return details

    type_id = device.get('type')
    kind = _label(DEVICE_TYPES, type_id)
    model = _label(DEVICE_MODELS, device.get('presetId'))
    if kind:
        details['类型'], details['仿真用途'] = kind
    if model and model[0] == type_id:
        details['型号'] = model[1]
    details['方案角色'] = _label(DEVICE_ROLES, device.get('role')) or '原方案设备，入选阶段未记录。'
    return details


def summarize_plan(value):
    # Older clients send just the scene and conversation.
    if value is None:
        return {'状态': STATUS_LABELS['none']}
    if not isinstance(value, dict) or not (status := _label(STATUS_LABELS, value.get('status'))):
        raise ValueError('方案摘要状态有误。')
    if value['status'] != 'ready':
        return {'状态': status}

    rows = value.get('plans')
    if not isinstance(rows, list) or not 1 <= len(rows) <= len(PLAN_NAMES):
        raise ValueError('方案摘要数量有误。')
    rows_by_id = {}
    for plan in rows:
        if not isinstance(plan, dict) or not (name := _label(PLAN_NAMES, plan.get('id'))):
            raise ValueError('方案摘要类别有误。')
        if plan['id'] in rows_by_id:
            raise ValueError('方案摘要包含重复方案。')
        rows_by_id[plan['id']] = {
            '方案': name,
            **_numbers(plan, {'rank': '原方案排名'}, len(PLAN_NAMES), integers=True),
            **_numbers(plan, COMPARISON_RATIOS, 1),
            **_plan_totals(plan),
        }

    active = _label(rows_by_id, value.get('activePlanId'))
    recommended = _label(rows_by_id, value.get('recommendedPlanId'))
    summary = {
        '状态': status,
        '当前方案': active['方案'] if active else None,
        '推荐方案': recommended['方案'] if recommended else None,
        '推荐状态': _label(RECOMMENDATION, value.get('recommendationStatus')),
        '当前工况': _label(CONDITION_NAMES, value.get('conditionId')),
        **_numbers(value, {'budget': '总相对预算', 'deviceLimit': '设备总上限'}, 1000, integers=True),
        '范围按有效数据裁切': value.get('scopeClipped') is True,
        '评分权重': _numbers(value.get('weights'), {
            'coverage': '覆盖完整性', 'blind': '盲区占比', 'cost': '相对成本', 'feasibility': '施工可行性',
        }, 1),
        '原方案对比': list(rows_by_id.values()),
    }
    supplement = value.get('supplement')
    if active and isinstance(supplement, dict):
        summary['当前移动补充结果'] = {
            **_plan_totals(supplement),
            **_numbers(supplement, {'addedDeviceCount': '新增设备数'}, 256, integers=True),
            **_numbers(supplement, {'addedCost': '新增相对成本'}, 100_000),
        }
    device = _device_summary(value.get('device'), rows_by_id, value.get('activePlanId'),
                             summary.get('当前移动补充结果'))
    if device:
        summary['单台设备说明'] = device
    return summary
