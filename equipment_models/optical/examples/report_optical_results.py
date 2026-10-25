"""从已有 JSON 生成中文报告，无需重新计算模型。"""
import importlib.util
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("chinese_report", ROOT/"src/optical_model/report.py")
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)
if __name__ == "__main__":
    report.main("optical", ROOT)
