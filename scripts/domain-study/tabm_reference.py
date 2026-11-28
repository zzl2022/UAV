"""Independent TabM reference on the same source/test split as study.py."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import torch
from study import OUT, SEED, STEPS, as_tensor, features, read_archive

wheels = sorted((OUT/'wheels').glob('*.whl'))
sys.path[:0] = [str(p) for p in wheels]
from tabm import TabM

torch.set_num_threads(1)
torch.use_deterministic_algorithms(True)
rows = read_archive()
x = as_tensor([features(r) for r in rows])
y = as_tensor([r['auditCoverage'] for r in rows])
domains = np.array([r['mapId'] for r in rows])
cases = np.array([r['caseId'] for r in rows])
folds = []
for domain in sorted(set(domains)):
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    src = domains != domain
    calibration = sorted(set(cases[~src]),key=lambda v:hashlib.sha256(v.encode()).digest())[::3]
    test = ~src & ~np.isin(cases,calibration)
    xs, ys = x[src], y[src]
    mu, sd = xs.mean(0), xs.std(0,unbiased=False).clamp_min(1e-5)
    model = TabM.make(n_num_features=x.shape[1],d_out=1,k=4,n_blocks=2,d_block=32,dropout=0.)
    optimizer = torch.optim.AdamW(model.parameters(),lr=.003,weight_decay=.001)
    for step in range(STEPS):
        i = rng.integers(len(xs), size=64)
        pred = model((xs[i]-mu)/sd).squeeze(-1)
        loss = (pred.sigmoid()-ys[i,None]).abs().mean()
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
    model.eval()
    with torch.inference_mode():
        pred=model((x[test]-mu)/sd).squeeze(-1).sigmoid().mean(1)
        folds.append(float((pred-y[test]).abs().mean()))
result={'model':'TabM','steps':STEPS,'members':4,'fold_mae':folds,'mean_mae':float(np.mean(folds)),
        'wheels':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in wheels}}
(OUT/'tabm.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(result)
