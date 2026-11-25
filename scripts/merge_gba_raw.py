"""Merge cached GBA GeoJSON cells/strips into one de-duplicated FeatureCollection.

The WFS returns neighbouring features in each cell/strip, so the same
(source, ogc_fid) feature can appear several times.  The merged file is the
input for ``prepare_beijing_gba_model.py``.
"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


def key(feature):
    props = feature.get('properties') or {}
    ogc_fid = props.get('ogc_fid')
    if ogc_fid is not None:
        return props.get('source'), ogc_fid
    geometry = json.dumps(feature.get('geometry'), sort_keys=True)
    return (props.get('source'), props.get('id'),
            hashlib.sha1(geometry.encode()).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    features, seen, duplicates = [], set(), 0
    for path in args.inputs:
        if not path.exists():
            raise SystemExit(f'missing input: {path}')
        payload = json.loads(path.read_text(encoding='utf-8'))
        for feature in payload.get('features', []):
            item = key(feature)
            if item in seen:
                duplicates += 1
                continue
            seen.add(item)
            features.append(feature)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        'type': 'FeatureCollection', 'features': features,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(features)} unique features to {args.out} '
          f'({duplicates} duplicates removed)')


if __name__ == '__main__':
    main()
