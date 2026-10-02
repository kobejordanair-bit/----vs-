"""Export the public archive as a portable ZIP, excluding private snapshots and secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'backend/source-archive.html', 'backend/history-lab.html',
    'backend/static/js/source-archive.js', 'backend/static/css/source-archive.css',
    'backend/static/js/history-data.js', 'backend/static/js/history-investigation.js',
    'backend/static/js/history-lab.js', 'backend/static/css/history-lab.css',
    'backend/static/data/legends.js',
    'backend/static/data/history/source-archive.v1.json',
    'backend/static/data/history/chuhan-foundation.v1.json',
    'backend/static/data/history/chuhan-cases.v1.json',
    'backend/static/data/history/schema.v1.json',
    'backend/static/art/history/archive-hall-v1.png',
    'backend/static/art/history/asset-provenance.json',
    'scripts/serve-history-preview.cjs', 'scripts/harvest-person-sources.cjs',
    'scripts/harvest-historical-corpus.cjs', 'scripts/wikisource-text.cjs',
    'scripts/normalize-historical-corpus.cjs', 'scripts/build-source-archive.cjs',
    'scripts/harvest-corpus-supplements.cjs',
    'scripts/export-source-archive.py',
    'data/source-archive/catalog.json', 'data/source-archive/editorial-reviews.json',
    'data/source-archive/harvest-person-sources.json', 'data/source-archive/harvest-query-aliases.json',
    'data/source-archive/corpus-manifest.json',
    'data/source-archive/corpus-quality-overrides.json',
    'data/source-archive/harvest-validation.json',
    'data/source-archive/harvest-corpus-supplement-check.json',
    'docs/source-archive-release.md', 'docs/source-archive-attribution.md',
    'docs/source-archive-research.md', 'docs/history-data-contract.md',
    'docs/history-verification.md',
    'tests/source-archive.test.cjs', 'tests/source-harvest.test.cjs',
    'tests/wikisource-text.test.cjs',
    'tests/corpus-normalization.test.cjs',
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = json.loads((ROOT / 'backend/static/data/history/source-archive.v1.json').read_text(encoding='utf-8'))
    editorial = json.loads((ROOT / 'data/source-archive/editorial-reviews.json').read_text(encoding='utf-8'))
    paths = list(FILES)
    for book in archive['books']:
        relative = 'backend' + book['contentPath']
        resolved = (ROOT / relative).resolve()
        if not resolved.is_relative_to(ROOT / 'backend/static/data/history/archive-books') or resolved.suffix != '.json':
            raise ValueError('Unsafe corpus path')
        paths.append(relative)
    missing = [name for name in paths if not (ROOT / name).is_file()]
    if missing:
        raise FileNotFoundError('Missing delivery files: ' + ', '.join(missing))
    report = {
        'format': 'dynasty-source-archive-delivery-report', 'schemaVersion': 1,
        'builtAt': archive['createdAt'], 'archiveVersion': archive['archiveVersion'],
        'summary': archive['summary'], 'provenance': archive['provenance'],
        'modernCoverage': editorial.get('modernCoverage'),
        'unretrievedDocuments': [{'id': d['id'], 'title': d['title'], 'status': d['status']} for d in archive['documents'] if d['status'] != 'downloaded'],
        'books': [{'id': b['id'], 'title': b['title'], 'status': b['status'], 'pages': b['chapterCount'], 'retrievedPages': b['downloadedCount']} for b in archive['books']],
        'limitations': archive['limitations'],
        'privacy': 'No private complete character snapshot, credentials, environment files or original long-form analyses were added to this archive export. Existing repository demonstration data remains included for the history lab.',
    }
    entries = {name: (ROOT / name).read_bytes() for name in sorted(set(paths))}
    entries['SOURCE_ARCHIVE_REPORT.json'] = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    entries['啟動檔案館.cmd'] = ('@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js 18 or newer is required.\r\n  pause\r\n  exit /b 1\r\n)\r\necho Open http://127.0.0.1:8877/source-archive\r\necho Keep this window open while reading the archive.\r\nnode scripts/serve-history-preview.cjs --port 8877\r\npause\r\n').encode('ascii')
    entries['開始閱讀.txt'] = ('王侯將相 · 人物來源檔案館\n\n先解壓縮，再執行「啟動檔案館.cmd」。需要 Node.js 18 或更新版本。\n開啟 http://127.0.0.1:8877/source-archive 並保持終端機開啟。\n若端口已占用：node scripts/serve-history-preview.cjs --port 8878\n\n資料、全文與搜尋皆在本機；不需要模型金鑰。完整私人人物文章未隨公開包散布。\n使用說明：docs/source-archive-release.md\n署名與使用條件：docs/source-archive-attribution.md\n實際覆蓋數與缺口：SOURCE_ARCHIVE_REPORT.json\n檔案校驗值：FILES.sha256\n\n來源候選、姓名命中與限定核讀用途不同，本包沒有宣稱取得所有歷史來源或完成每篇分析的查證。\n').encode('utf-8-sig')
    entries['FILES.sha256'] = ''.join(hashlib.sha256(body).hexdigest() + '  ' + name + '\n' for name, body in sorted(entries.items())).encode('utf-8')
    destination = output / '王侯將相_人物來源檔案館.zip'
    prefix = '王侯將相_人物來源檔案館/'
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
        for name, body in entries.items():
            zipped.writestr(prefix + name, body)
    with zipfile.ZipFile(destination) as zipped:
        if zipped.testzip() is not None:
            raise ValueError('ZIP CRC verification failed')
        for name, expected in entries.items():
            if hashlib.sha256(zipped.read(prefix + name)).digest() != hashlib.sha256(expected).digest():
                raise ValueError('ZIP content verification failed: ' + name)
    (output / 'SOURCE_ARCHIVE_REPORT.json').write_bytes(entries['SOURCE_ARCHIVE_REPORT.json'])
    print(json.dumps({'file': str(destination), 'files': len(entries), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'verified': True}, ensure_ascii=True))

if __name__ == '__main__':
    main()
