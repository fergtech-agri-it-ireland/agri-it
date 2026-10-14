#!/usr/bin/env python3
"""
Fetch the CSO's monthly national average prices for feed (AJM08) and fertiliser (AJM09),
in euro per tonne excluding VAT, and save the last 24 months to src/lib/cso/cso-prices.json.

Run monthly by .github/workflows/cso.yml (the CSO publishes about six weeks after each
month). The app bundles the file, so the phone carries the figures with no live connection.
Every figure keeps its month; the file records when it was fetched. Nothing is estimated:
a month the CSO left blank stays out.

Source: Central Statistics Office, Agricultural Price Indices, tables AJM08 and AJM09
(https://data.cso.ie/table/AJM08, https://data.cso.ie/table/AJM09), CC BY 4.0.
"""
import json, sys, urllib.request, datetime, pathlib

API = 'https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/{}/JSON-stat/2.0/en'
TABLES = {'AJM08': 'feed', 'AJM09': 'fertiliser'}
KEEP_MONTHS = 24
OUT = pathlib.Path(__file__).resolve().parents[2] / 'src/lib/cso/cso-prices.json'


def fetch(code: str) -> dict:
    req = urllib.request.Request(API.format(code), headers={'User-Agent': 'Agri-It (github.com/fergtech-agri-it-ireland/agri-it)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def series(ds: dict) -> tuple[str, dict[str, dict[str, float]], dict]:
    """JSON-stat 2.0 to {item label: {YYYY-MM: value}}. Finds the time and item dimensions by role/name."""
    ids, size, dims, values = ds['id'], ds['size'], ds['dimension'], ds['value']
    role_time = set(ds.get('role', {}).get('time', []))
    time_dim = next((d for d in ids if d in role_time or d.startswith('TLIST')), None)
    stat_dim = next((d for d in ids if d.upper() == 'STATISTIC'), None)
    item_dims = [d for d in ids if d not in (time_dim, stat_dim) and size[ids.index(d)] > 1]
    if time_dim is None or len(item_dims) != 1:
        raise SystemExit(f'Unexpected table shape: {ids} {size}')
    item_dim = item_dims[0]

    def cats(d):
        c = dims[d]['category']
        idx = c['index']
        order = idx if isinstance(idx, list) else sorted(idx, key=lambda k: idx[k])
        return order, c.get('label', {})

    # Strides for the flat value array (row-major over ids)
    strides = [1] * len(ids)
    for i in range(len(ids) - 2, -1, -1):
        strides[i] = strides[i + 1] * size[i + 1]
    out: dict[str, dict[str, float]] = {}
    t_order, _ = cats(time_dim)
    i_order, i_label = cats(item_dim)
    ti, ii = ids.index(time_dim), ids.index(item_dim)
    for tpos, t in enumerate(t_order):
        # '2026M07' -> '2026-07'
        if 'M' not in t:
            continue
        month = f'{t[:4]}-{t[5:].zfill(2)}'
        for ipos, item in enumerate(i_order):
            flat = tpos * strides[ti] + ipos * strides[ii]  # other dimensions have size 1
            v = values[flat] if isinstance(values, list) else values.get(str(flat))
            if v is None:
                continue
            out.setdefault(i_label.get(item, item), {})[month] = float(v)
    unit = dims.get(stat_dim, {}).get('category', {}).get('unit', {}) if stat_dim else {}
    label = ds.get('label', '')
    return label, out, unit


def main() -> None:
    result = {
        'source': 'Central Statistics Office, Agricultural Price Indices',
        'licence': 'CC BY 4.0',
        'note': 'National average prices paid by farmers, euro per tonne, excluding VAT. Not a quote from any supplier.',
        'fetched_on': datetime.date.today().isoformat(),
        'tables': {}
    }
    for code, kind in TABLES.items():
        label, data, _ = series(fetch(code))
        months = sorted({m for s in data.values() for m in s})
        keep = set(months[-KEEP_MONTHS:])
        items = {name: {m: v for m, v in s.items() if m in keep} for name, s in data.items()}
        items = {k: v for k, v in items.items() if v}
        result['tables'][code] = {
            'kind': kind, 'title': label, 'url': f'https://data.cso.ie/table/{code}',
            'latest_month': max((m for s in items.values() for m in s), default=None),
            'items': dict(sorted(items.items()))
        }
        print(f'{code}: {len(items)} items with data, latest {result["tables"][code]["latest_month"]}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    old = json.loads(OUT.read_text()) if OUT.exists() else None
    # Only the fetch date changed: leave the file alone so nothing is committed
    if old and {**old, 'fetched_on': None} == {**result, 'fetched_on': None}:
        print('No new figures')
        return
    OUT.write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    sys.exit(main())
