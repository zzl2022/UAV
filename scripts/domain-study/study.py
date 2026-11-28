"""Offline aggregate coverage calibration. Run at repository root after the fixture generator."""
import hashlib
import importlib.util
import json
import statistics
import subprocess
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/domain-study'
UPSTREAM = OUT / 'upstream-tllib'
PIN = 'c4aa59eb565650a552b809411601d0589efbbfe4'
ARCHIVE = ROOT / 'artifacts/cross-map-study/all-plan-results.jsonl'
CONDITIONS = ('nominal', 'silent', 'weather', 'interference')
SEED = 734
STEPS = 240
PLANS = ('economy', 'balanced', 'enhanced')


def load_grl():
    revision = subprocess.check_output(['git', '-C', str(UPSTREAM), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != PIN:
        raise ValueError(f'Expected upstream {PIN}, found {revision}')
    relative = 'tllib/modules/grl.py'
    source = UPSTREAM / relative
    blob = subprocess.check_output(['git', '-C', str(UPSTREAM), 'show', f'{PIN}:{relative}'])
    if source.read_bytes().replace(b'\r\n', b'\n') != blob:
        raise ValueError('Upstream gradient reversal source differs from pinned commit')
    spec = importlib.util.spec_from_file_location('reference_grl', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.GradientReverseFunction.apply


def upstream_check(reverse):
    x = torch.tensor([[2., -1.]], requires_grad=True)
    d = nn.Linear(2, 1, bias=False)
    with torch.no_grad():
        d.weight.copy_(torch.tensor([[0.4, -0.2]]))
    target = torch.ones(1, 1)
    direct = F.binary_cross_entropy_with_logits(d(x), target)
    direct_grads = torch.autograd.grad(direct, (x, d.weight))
    z = reverse(x, .65)
    loss = F.binary_cross_entropy_with_logits(d(z), target)
    actual = torch.autograd.grad(loss, (x, d.weight))
    torch.testing.assert_close(z, x)
    torch.testing.assert_close(actual[0], -.65 * direct_grads[0])
    torch.testing.assert_close(actual[1], direct_grads[1])
    return {'forward_identity': True, 'encoder_gradient_ratio': -.65, 'discriminator_gradient_ratio': 1.}


def features(row):
    metrics = {m['condition']: m for m in row['trainMetrics']}
    rates = [metrics[k]['coverageRate'] for k in CONDITIONS]
    redundancy = [metrics[k]['redundant'] / metrics[k]['total'] for k in CONDITIONS]
    counts = [row['typeCounts'][t] for t in ('radar', 'radio', 'optical', 'acoustic')]
    return rates + redundancy + counts + [row['deviceCount'], row['cost'], row['budgetLimit'], row['deviceLimit']]


def as_tensor(values):
    return torch.as_tensor(np.asarray(values), dtype=torch.float32)


class Calibrator(nn.Module):
    def __init__(self, width, members):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(width, 24), nn.ReLU(), nn.Linear(24, 12), nn.ReLU())
        self.heads = nn.Linear(12, members)
        self.domain = nn.Sequential(nn.Linear(12, 12), nn.ReLU(), nn.Linear(12, 1))


def fit(x, y, target_x, variant, reverse):
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    x, y, target_x = map(as_tensor, (x, y, target_x))
    mu, scale = x.mean(0), x.std(0, unbiased=False).clamp_min(1e-5)
    xs, xt = (x - mu) / scale, (target_x - mu) / scale
    residual = variant == 'residual_ensemble'
    model = Calibrator(x.shape[1], 4 if residual else 1)
    opt = torch.optim.AdamW(model.parameters(), lr=.003, weight_decay=.001)
    for step in range(STEPS):
        i = rng.integers(len(xs), size=64)
        z = model.encoder(xs[i])
        raw = model.heads(z)
        if residual:
            errors = (raw + x[i, :1] - y[i, None]).abs()
            # Independent bootstrap draws for each head, with a shared trunk.
            draws = torch.from_numpy(rng.integers(len(i), size=(len(i), raw.shape[1])))
            task_loss = errors.gather(0, draws).mean()
        else:
            task_loss = (raw.sigmoid().squeeze(1) - y[i]).abs().mean()
        loss = task_loss
        if variant != 'erm':
            target_z = model.encoder(xt[rng.integers(len(xt), size=len(i))])
            alpha = .15 * (2 / (1 + np.exp(-8 * step / STEPS)) - 1)
            logits = model.domain(reverse(torch.cat([z, target_z]), float(alpha))).flatten()
            labels = torch.cat([torch.zeros(len(i)), torch.ones(len(i))])
            loss = loss + F.binary_cross_entropy_with_logits(logits, labels)
        opt.zero_grad()
        loss.backward()
        opt.step()
    model.eval()
    def predict(values):
        values = as_tensor(values)
        with torch.inference_mode():
            out = model.heads(model.encoder((values - mu) / scale))
            pred = (out + values[:, :1]).mean(1) if residual else out.sigmoid().flatten()
            return pred.clamp(0, 1).numpy()
    def dense(layer):
        return {'weight': layer.weight.detach().tolist(), 'bias': layer.bias.detach().tolist()}
    if residual:
        predict.weights = {'mu':mu.tolist(),'scale':scale.tolist(),'layers':[dense(model.encoder[0]),dense(model.encoder[2]),dense(model.heads)]}
    return predict


def read_archive():
    rows = [json.loads(line) for line in ARCHIVE.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    groups = defaultdict(list)
    for row in rows:
        groups[(row['mapId'], row['caseId'])].append(row)
    for key, group in groups.items():
        if sorted(r['planId'] for r in group) != sorted(PLANS) or len({r['runId'] for r in group}) != 1:
            raise ValueError(f'Unpaired baseline run: {key}')
    return rows


def cross_validate(rows, reverse):
    domains = np.array([r['mapId'] for r in rows])
    cases = np.array([r['caseId'] for r in rows])
    plans = np.array([r['planId'] for r in rows])
    x = np.array([features(r) for r in rows])
    y = np.array([r['auditCoverage'] for r in rows])
    if not np.isfinite(x).all() or not np.all((0 <= y) & (y <= 1)):
        raise ValueError('Missing or invalid observations')
    folds = []
    for n, domain in enumerate(sorted(set(domains))):
        source = domains != domain
        calibration_cases = sorted(set(cases[~source]), key=lambda c: hashlib.sha256(c.encode()).digest())[::3]
        calibration = ~source & np.isin(cases, calibration_cases)
        holdout = ~source & ~calibration
        predictions = {'raw': x[holdout, 0]}
        for variant in ('erm', 'dann', 'residual_ensemble'):
            predictor = fit(x[source], y[source], x[calibration], variant, reverse)
            predictions[variant] = predictor(x[holdout])
        fold = {'fold': n+1, 'source': int(source.sum()), 'unlabelled': int(calibration.sum()), 'test': int(holdout.sum()), 'mae': {}, 'mae_by_plan': {}}
        for name, pred in predictions.items():
            errors = np.abs(pred - y[holdout])
            fold['mae'][name] = float(errors.mean())
            fold['mae_by_plan'][name] = {p: float(errors[plans[holdout] == p].mean()) for p in PLANS}
        folds.append(fold)
    return folds


def selection(candidates):
    feasible = [c for c in candidates if c['feasible']]
    if not feasible:
        return None
    peak = max(c['prediction'] for c in feasible)
    return min((c for c in feasible if c['prediction'] >= peak-.01), key=lambda c: (c['cost'], -c['prediction'], c['key']))


def prepare_fixture_model(rows, reverse):
    data = json.loads((OUT/'fixtures.json').read_text(encoding='utf-8'))
    dev = [r for r in data if r['seed'] < 200]
    options = ('small','medium','large')
    start = time.perf_counter()
    model = fit([features(r) for r in rows], [r['auditCoverage'] for r in rows], [features(r) for r in dev], 'residual_ensemble', reverse)
    train_ms = 1000*(time.perf_counter()-start)
    pred = model([features(r) for r in dev])
    profiles = []
    for key in options:
        ii = [i for i,r in enumerate(dev) if r['key']==key]
        profiles.append({'key':key,'cost':statistics.mean(dev[i]['cost'] for i in ii),
                         'prediction':float(pred[ii].mean()),'feasible':all(dev[i]['feasible'] for i in ii)})
    compiled = selection(profiles)
    if compiled is None:
        raise ValueError('No feasible development profile')
    # Third research iteration: a supervised calibration stage on the three development
    # fixtures only. Unseen evaluation fixtures never supply labels to this routine.
    base = np.array([features(r)[0] for r in dev])
    y = np.array([r['auditCoverage'] for r in dev])
    mixing = min([0.,.25,.5,.75,1.],key=lambda weight:np.mean(np.abs(base+weight*(pred-base)-y)))
    validated = [{**c,'prediction':statistics.mean(r['auditCoverage'] for r in dev if r['key']==c['key'])} for c in profiles]
    lean = selection(validated)
    reference = [{'x':features(r),'prediction':float(p)} for r,p in zip(dev[:3],pred[:3])]
    packing={'weights':model.weights,'compiled':compiled['key'],'reference':reference,
             'lean':lean['key'],'mixing':mixing}
    (OUT/'calibrator.json').write_text(json.dumps(packing),encoding='utf-8')
    return {'trainMs':train_ms,'compiledProfile':compiled['key'],'devProfiles':profiles,
            'leanProfile':lean['key'],'mixing':mixing,'devAudits':validated}


def main():
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    reverse = load_grl()
    reproduction = upstream_check(reverse)
    rows = read_archive()
    folds = cross_validate(rows, reverse)
    bench = prepare_fixture_model(rows, reverse)
    means={k: statistics.mean(f['mae'][k] for f in folds) for k in folds[0]['mae']}
    diffs=np.array([f['mae']['residual_ensemble']-f['mae']['raw'] for f in folds])
    rng=np.random.default_rng(SEED)
    interval=np.quantile(rng.choice(diffs,(10000,len(diffs)),replace=True).mean(axis=1),[.025,.975]).tolist()
    result={'upstream':PIN,'archive_sha256':hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(),'torch':torch.__version__,
            'numpy':np.__version__,'reproduction':reproduction,'folds':folds,'mean_mae':means,'paired_map_bootstrap_interval':interval,
            'fixture':bench,'field_accuracy_validated':False,'released':False}
    (OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'mae':means,'interval':interval,'fixture':bench},indent=2))


if __name__=='__main__':
    main()
