# -*- coding: utf-8 -*-
"""task3 图片灰度化：将 showcase / mobile-repair / figure-* PNG 转为灰度图。

输出目录：artifacts/task3/word-assets/gray/（保持原文件名，不覆盖原图）。
每张输出图逐像素校验 R=G=B，不通过则抛错。
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TASK3 = ROOT / "artifacts" / "task3"
OUT_DIR = TASK3 / "word-assets" / "gray"


def collect_inputs():
    inputs = []
    showcase = sorted((TASK3 / "showcase").glob("*.png"))
    inputs.extend(showcase)
    for name in ("mobile-repair.png", "mobile-repair-restored.png", "mobile-repair-condition.png"):
        p = TASK3 / name
        if p.exists():
            inputs.append(p)
    figures = sorted((TASK3 / "word-assets").glob("figure-*.png"))
    inputs.extend(figures)
    return inputs


def to_grayscale(src: Path, dst: Path):
    with Image.open(src) as img:
        gray = img.convert("L").convert("RGB")
        gray.save(dst)
    return gray.size


def verify_grayscale(path: Path):
    """逐像素校验 R=G=B，返回像素总数。"""
    with Image.open(path) as img:
        rgb = img.convert("RGB")
        total = 0
        for r, g, b in rgb.getdata():
            if not (r == g == b):
                raise ValueError(f"校验失败：{path} 存在非灰度像素 ({r},{g},{b})")
            total += 1
    return total


def main():
    inputs = collect_inputs()
    if not inputs:
        print("未找到任何输入图片", file=sys.stderr)
        sys.exit(1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"共 {len(inputs)} 张图片待处理，输出目录：{OUT_DIR}\n")
    for src in inputs:
        dst = OUT_DIR / src.name
        size = to_grayscale(src, dst)
        print(f"[转换] {src}\n       -> {dst}  尺寸: {size[0]}x{size[1]}")
    print("\n开始逐像素灰度校验 ...")
    for src in inputs:
        dst = OUT_DIR / src.name
        px = verify_grayscale(dst)
        print(f"[校验通过] {dst.name}  共 {px} 像素，全部满足 R=G=B")
    print(f"\n全部 {len(inputs)} 张图片灰度化并校验成功。")


if __name__ == "__main__":
    main()
