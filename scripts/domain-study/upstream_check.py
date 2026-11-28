"""Run the pinned upstream DANN loss without loading its unrelated vision datasets."""
import ast
import json
import subprocess
from typing import Optional
import torch
from torch import nn
from torch.nn import functional as F
from study import OUT, PIN, UPSTREAM, load_grl, upstream_check

reverse = load_grl()
context = {'torch':torch, 'nn':nn, 'F':F, 'Optional':Optional}
# Load the original definitions at the pinned Git revision. The full upstream package
# eagerly imports optional image datasets that are not used in this CPU numerical test.
for path,names in [('tllib/utils/metric/__init__.py',{'binary_accuracy','accuracy'}),
                   ('tllib/alignment/dann.py',{'DomainAdversarialLoss'})]:
    source=subprocess.check_output(['git','-C',str(UPSTREAM),'show',f'{PIN}:{path}']).decode()
    tree=ast.parse(source)
    tree.body=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.ClassDef)) and node.name in names]
    assert len(tree.body)==len(names)
    exec(compile(tree,path,'exec'),context)

class Reverse(nn.Module):
    def forward(self,x):
        return reverse(x,.65)

torch.set_num_threads(1)
torch.manual_seed(92)
source=torch.randn(64,2,requires_grad=True)
target=(torch.randn(64,2)+.7).requires_grad_()
head=nn.Sequential(nn.Linear(2,1),nn.Sigmoid())
official=context['DomainAdversarialLoss'](head,grl=Reverse())
loss=official(source,target)
observed=torch.autograd.grad(loss,(source,target,*head.parameters()))
manual=(F.binary_cross_entropy(head(source),torch.ones(64,1))+
        F.binary_cross_entropy(head(target),torch.zeros(64,1)))/2
expected=torch.autograd.grad(manual,(source,target,*head.parameters()))
torch.testing.assert_close(loss,manual)
for i,grad in enumerate(observed):
    torch.testing.assert_close(grad,expected[i]*(-.65 if i<2 else 1.))
result={'upstream':PIN,**upstream_check(reverse),'actual_domain_loss':loss.item(),'reference_bce':manual.item(),
        'checked':['source gradient','target gradient','head weight gradient','head bias gradient']}
(OUT/'upstream-check.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(result)
