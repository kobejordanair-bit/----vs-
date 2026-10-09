// Formatting only. The unmodified clipboard export remains the provenance file.
export function normalizeExport(raw) {
  const cards = new Set(['维基文库，自由的图书馆', '維基文庫，自由的圖書館', 'Wiley Online Library', 'Oxford Academic', 'mdpi.com', 'www1.ihp.sinica.edu.tw', 'ctwx.tsinghua.edu.cn', 'Cambridge Core', '清華學報', '華藝線上圖書館', 'xuebao.snnu.edu.cn']);
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  let removed = 0;
  for (const line of lines) {
    const s = line.trim();
    if (/^\[image\]\(https:\/\/www\.google\.com\/s2\/favicons\?/.test(s) || cards.has(s) || /^\+\d+$/.test(s)) { removed++; continue; }
    kept.push(line);
  }
  const text = kept.join('\n').replace(/\\\*/g, '*').replace(/`(<!-- (?:PILOT|LAYER)_COMPLETE [^>]+ -->)`/g, '$1').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return { text, removedCardLines: removed };
}
