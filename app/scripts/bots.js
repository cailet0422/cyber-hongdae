// 부하 테스트용 봇:  node scripts/bots.js [인원=50] [주소=ws://localhost:7777/ws] [초=60]
const WebSocket = require('ws');
const N = +process.argv[2] || 50;
const URL = process.argv[3] || 'ws://localhost:7777/ws';
const SEC = +process.argv[4] || 60;
const CH = ['yui', 'mio', 'ritsu', 'mugi', 'azusa'];
const LINES = ['ㅋㅋㅋㅋ', '오 시작한다', '응원봉 흔들자!', '여기 자리 있어요?', '팝콘 사올게', '케이온 최고', '와 화질 좋다', '유이 귀여워'];
let connected = 0, msgs = 0, bytes = 0;

for (let i = 0; i < N; i++) {
  setTimeout(() => {
    const ws = new WebSocket(URL);
    let x = 5 + Math.random() * 15, z = 25 + Math.random() * 30, a = Math.random() * 6.28;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', clientId: 'bot' + i, char: CH[i % 5] })));
    ws.on('message', (m) => {
      msgs++; bytes += m.length;
      const j = JSON.parse(m);
      if (j.t !== 'welcome') return;
      connected++;
      const moving = Math.random() < 0.6;
      const iv = setInterval(() => {
        if (moving) { a += (Math.random() - 0.5) * 0.4; x = Math.max(2, Math.min(20, x + Math.sin(a) * 0.25)); z = Math.max(24, Math.min(60, z + Math.cos(a) * 0.25)); }
        ws.send(JSON.stringify({ t: 'p', d: [x, 0, z, a, moving ? 1 : 0] }));
        if (Math.random() < 0.004) ws.send(JSON.stringify({ t: 'chat', text: LINES[Math.floor(Math.random() * LINES.length)] }));
        if (Math.random() < 0.002) ws.send(JSON.stringify({ t: 'stick', on: true, color: i % 5, wave: Math.random() < 0.5 }));
      }, 100);
      ws.on('close', () => clearInterval(iv));
    });
    ws.on('error', () => {});
    setTimeout(() => ws.close(), SEC * 1000);
  }, i * 30);
}
const t0 = Date.now();
const rep = setInterval(() => {
  console.log(`접속 ${connected}/${N}  수신 ${msgs}건 ${(bytes / 1024 / ((Date.now() - t0) / 1000)).toFixed(0)}KB/s (봇 전체)`);
}, 5000);
setTimeout(() => { clearInterval(rep); process.exit(0); }, SEC * 1000 + 1500);
