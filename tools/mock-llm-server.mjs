/**
 * 本地模拟 OpenAI 兼容接口，用来验证 TT_ChatChoice 的大模型通道（不花钱、不联网）。
 *
 *   node tools/mock-llm-server.mjs [port]
 *
 * 然后在浏览器打开：
 *   mock/index.html?auto=llm&api=1&endpoint=http://127.0.0.1:8123/v1/chat/completions
 *
 * 行为：从 prompt 里解析「选项列表」和「玩家说」，用关键词简单猜一个下标
 * （"便宜"→ Bad Advice / "贵"→ Good Advice / 说不清→ 0）。
 */
import http from 'node:http';

const port = Number(process.argv[2] || 8123);

function pickIndex(prompt) {
  const n = Number((prompt.match(/选项（从 0 开始编号）：([\s\S]*?)\n玩家说/) || [])[1] ? 4 : 0) || 4;
  if (/便宜|省钱|钱少|三块|3.clams|bad/i.test(prompt)) return 1;
  if (/贵|100|good/i.test(prompt)) return 0;
  return 0;
}

const server = http.createServer((req, res) => {
  // CORS 预检：浏览器发 POST + Authorization 前会先来 OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Max-Age': '600'
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let q = {};
    try { q = JSON.parse(body); } catch (e) { /* ignore */ }
    const prompt = (q.messages && q.messages[0] && q.messages[0].content) || '';
    const index = pickIndex(prompt);
    console.log('[mock-llm] auth=' + String(req.headers.authorization || '').slice(0, 24) + '… index=' + index);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, authorization'
    });
    res.end(JSON.stringify({
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      model: q.model || 'mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify({ index, reason: 'mock: 按关键词猜的' }) },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: prompt.length, completion_tokens: 8, total_tokens: prompt.length + 8 }
    }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log('[mock-llm] listening on http://127.0.0.1:' + port + '/v1/chat/completions');
});
