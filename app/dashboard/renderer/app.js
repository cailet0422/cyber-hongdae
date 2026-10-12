// 관리자 대시보드 화면 로직
const $ = (id) => document.getElementById(id);
const bridge = window.api;
const CHAR = { yui: ['유이', '#ff4848'], mio: ['미오', '#4d7cff'], ritsu: ['리츠', '#ffd23f'], mugi: ['무기', '#ff7eb6'], azusa: ['아즈사', '#3fd46e'] };
let S = null; // 전체 상태
let seeking = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtT = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtClock = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
const fmtBytes = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + 'GB' : (n / 1e6).toFixed(0) + 'MB';
let toastT;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
async function call(m, ...a) {
  try { return await bridge.call(m, ...a); }
  catch (e) { toast('⚠ ' + String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, ''), 5000); throw e; }
}

// ------------------------------------------------------------------ 탭
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('sel', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'board') drawSignPreview();
});

// ------------------------------------------------------------------ 서버
$('btnOpen').onclick = async () => {
  const exposure = document.querySelector('input[name=exp]:checked').value;
  $('openErr').textContent = '';
  $('btnOpen').disabled = true;
  $('errLink').classList.add('hidden');
  setHero('wait', exposure === 'tunnel' ? 'Cloudflare 공개 주소를 만드는 중… (10초 정도)' : exposure === 'tailscale' ? 'Tailscale Funnel을 켜는 중…' : '서버를 여는 중…');
  try {
    await call('setConfig', { password: $('password').value.trim() });
    S = await call('start', { port: +$('port').value || 7777, exposure });
    renderAll();
    toast('✅ 서버가 열렸습니다! 주소를 공유하세요.');
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');
    $('openErr').textContent = msg + (exposure === 'upnp' ? '\n→ "인터넷 공개 (추천)" 방식으로 다시 시도해 보세요.' : '');
    const link = msg.match(/https:\/\/\S+/);
    if (link) { $('errLink').classList.remove('hidden'); $('errLink').onclick = () => call('openExternal', link[0]); }
    setHero('off');
  } finally { $('btnOpen').disabled = false; }
};
$('btnClose').onclick = async () => {
  if (!confirm('서버를 닫으면 모든 접속자의 연결이 끊어집니다. 닫을까요?')) return;
  S = await call('stop');
  renderAll();
};
$('copyUrl').onclick = () => { call('copy', S.urls?.public || S.urls?.lan?.[0] || S.urls?.local); toast('📋 주소를 복사했습니다'); };
$('openMine').onclick = () => call('openExternal', S.urls?.local);
$('openPublic').onclick = () => call('openExternal', S.urls?.public || S.urls?.lan?.[0] || S.urls?.local);

function setHero(state, text) {
  const el = $('heroState');
  el.className = 'hero-state ' + (state === 'on' ? 'on' : state === 'wait' ? 'wait' : '');
  el.textContent = state === 'on' ? '서버가 열려 있습니다' : state === 'wait' ? '여는 중…' : '서버가 꺼져 있습니다';
  $('heroDesc').textContent = text || (state === 'on' ? '아래 주소로 누구나 접속할 수 있습니다.' : '아래 버튼을 누르면 인터넷 어디서나 접속할 수 있는 주소가 자동으로 만들어집니다.');
  $('btnOpen').classList.toggle('hidden', state === 'on');
  $('btnClose').classList.toggle('hidden', state !== 'on');
  const side = $('sideStatus');
  side.className = 'pill ' + (state === 'on' ? 'on' : state === 'wait' ? 'wait' : 'off');
  side.textContent = state === 'on' ? '● 서버 열림' : state === 'wait' ? '● 여는 중' : '● 서버 꺼짐';
  document.querySelectorAll('input[name=exp], #port').forEach((x) => (x.disabled = state !== 'off'));
}

let lastQr = '';
async function renderServer() {
  const st = S.status;
  const running = st === 'running';
  setHero(running ? 'on' : ['starting', 'tunnel', 'upnp'].includes(st) ? 'wait' : 'off');
  $('shareCard').classList.toggle('hidden', !running);
  if (running && S.urls) {
    const main = S.urls.public || S.urls.lan?.[0] || S.urls.local;
    $('publicUrl').textContent = main;
    $('openPublic').classList.toggle('hidden', !S.urls.public);
    $('lanUrls').innerHTML = (S.urls.exposure === 'lan' ? '같은 와이파이 주소: ' : S.urls.lan?.length ? '같은 집에서는 이 주소도 됩니다: ' : '') + (S.urls.lan || []).map(esc).join(' · ');
    if (main !== lastQr) { lastQr = main; $('qr').src = await call('qr', main); }
  }
}

// ------------------------------------------------------------------ 상영 관리
$('cToggle').onclick = () => call('toggle');
$('cPrev').onclick = () => call('prev');
$('cNext').onclick = () => call('next');
$('cStop').onclick = () => call('stopPlayback');
$('cLoop').onchange = () => call('setLoop', $('cLoop').value);
$('seek').addEventListener('input', () => { seeking = true; const d = curDuration(); $('posText').textContent = fmtT($('seek').value / 1000 * d); });
$('seek').addEventListener('change', () => { const d = curDuration(); if (d) call('seek', $('seek').value / 1000 * d); seeking = false; });
function curDuration() { return S?.playback?.item?.duration || 0; }

$('addFiles').onclick = async () => { const f = await call('pickFiles', 'media'); if (f.length) { await call('addFiles', f); toast(`${f.length}개 파일을 추가했습니다`); } };
$('addFolder').onclick = async () => { const d = await call('pickFolder'); if (d) { const r = await call('addFolder', d); toast(`폴더에서 ${r.length}개 영상을 추가했습니다`); } };
$('addUrl').onclick = async () => {
  const text = $('urlInput').value.trim();
  if (!text) return toast('링크를 입력하세요');
  $('addUrl').disabled = true;
  try {
    const r = await call('addUrls', text, { mode: $('urlMode').value === 'stream' ? 'stream' : 'download' });
    $('urlInput').value = '';
    toast(r.length ? `${r.length}개 링크를 추가했습니다. 정보를 확인하는 중…` : '추가할 수 있는 링크가 없습니다');
  } finally { $('addUrl').disabled = false; }
};
$('clearPl').onclick = () => confirm('재생목록을 모두 비울까요?') && call('clearPlaylist');
$('clearCache').onclick = async () => { await call('clearCache'); toast('사용하지 않는 캐시를 정리했습니다'); };

// 드래그&드롭
const dz = document.body;
dz.addEventListener('dragover', (e) => { e.preventDefault(); $('dropZone').classList.add('drag'); });
dz.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('dropZone').classList.remove('drag'); });
dz.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('dropZone').classList.remove('drag');
  const paths = [...e.dataTransfer.files].map((f) => bridge.pathOf(f)).filter(Boolean);
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (paths.length) {
    for (const p of paths) {
      // 폴더면 폴더 추가, 파일이면 파일 추가
      if (!/\.[a-z0-9]{2,5}$/i.test(p)) await call('addFolder', p).catch(() => call('addFiles', [p]));
    }
    const files = paths.filter((p) => /\.[a-z0-9]{2,5}$/i.test(p));
    if (files.length) await call('addFiles', files);
    toast('추가했습니다');
  } else if (text && /^https?:/.test(text)) {
    await call('addUrls', text, { mode: 'download' });
    toast('링크를 추가했습니다');
  }
});

function statusHtml(it) {
  const pct = Math.round((it.progress || 0) * 100);
  if (it.status === 'ready') return `<span class="st-ready">● 준비 완료</span>${it.live ? ' <b style="color:#ff5a5a">LIVE</b>' : ''}${it.mode === 'stream' && it.kind !== 'file' ? ' <span class="muted">(스트리밍)</span>' : ''}`;
  if (it.status === 'error') return `<span class="st-error" title="${esc(it.error)}">✖ 실패: ${esc((it.error || '').slice(0, 40))}</span>`;
  if (it.status === 'queued') return `<span class="st-wait">◌ ${esc(it.statusText || '대기 중')}</span>`;
  return `<span class="st-wait">${esc(it.statusText || '준비 중')} ${pct}%</span><div class="prog"><i style="width:${pct}%"></i></div>`;
}
const KIND = { file: '파일', direct: '직접 링크', hls: 'HLS', ytdl: '링크' };

function renderPlaylist() {
  const pl = S.media.playlist;
  const el = $('playlist');
  $('plEmpty').classList.toggle('hidden', pl.length > 0);
  $('plCount').textContent = pl.length ? `${pl.length}개` : '';
  $('cacheInfo').textContent = `캐시 ${fmtBytes(S.media.cacheBytes || 0)}`;
  const cur = S.playback.itemId;
  el.innerHTML = pl.map((it, i) => `
    <div class="pl-item ${it.id === cur ? 'cur' : ''}" data-id="${it.id}">
      <div class="pl-idx">${it.id === cur ? '▶' : i + 1}</div>
      <div class="pl-title"><b title="더블클릭해서 이름 바꾸기">${esc(it.title)}</b><small>${KIND[it.kind] || ''} · ${it.duration ? fmtT(it.duration) : '길이 미상'} · ${esc(it.source)}</small></div>
      <div class="pl-status" data-status="${it.id}">${statusHtml(it)}</div>
      <div class="pl-sub"><select data-sub="${it.id}" title="자막">
        <option value="">자막 없음</option>
        ${it.subs.map((s) => `<option value="${s.id}" ${s.id === it.sub ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        <option value="__add">+ 자막 파일 추가…</option>
      </select></div>
      <div class="pl-actions">
        <button class="btn" data-act="play" title="지금 재생">▶</button>
        <button class="btn" data-act="up" title="위로">↑</button>
        <button class="btn" data-act="down" title="아래로">↓</button>
        ${it.status === 'error' ? '<button class="btn" data-act="retry" title="다시 시도">↻</button>' : ''}
        ${it.kind === 'ytdl' || it.kind === 'direct' ? `<button class="btn" data-act="mode" title="재생 방식 바꾸기">${it.mode === 'stream' ? '⬇' : '📡'}</button>` : ''}
        <button class="btn danger" data-act="del" title="삭제">🗑</button>
      </div>
    </div>`).join('');
}
$('playlist').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.pl-item').dataset.id;
  const i = S.media.playlist.findIndex((x) => x.id === id);
  const it = S.media.playlist[i];
  switch (b.dataset.act) {
    case 'play': return call('playId', id);
    case 'up': return call('move', id, i - 1);
    case 'down': return call('move', id, i + 1);
    case 'retry': return call('retry', id);
    case 'mode': toast(it.mode === 'stream' ? '미리 받아서 재생으로 바꿉니다' : '바로 스트리밍으로 바꿉니다'); return call('setMode', id, it.mode === 'stream' ? 'download' : 'stream');
    case 'del': return call('remove', id);
  }
});
$('playlist').addEventListener('dblclick', (e) => {
  const t = e.target.closest('.pl-title b');
  if (!t) return;
  const id = t.closest('.pl-item').dataset.id;
  const name = prompt('새 제목', t.textContent);
  if (name) call('rename', id, name);
});
$('playlist').addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-sub]');
  if (!sel) return;
  const id = sel.dataset.sub;
  if (sel.value === '__add') {
    const f = await call('pickFiles', 'sub');
    if (f[0]) { await call('attachSub', id, f[0]); toast('자막을 붙였습니다'); }
    else renderPlaylist();
    return;
  }
  call('selectSub', id, sel.value || null);
});

function renderPlayer() {
  const p = S.playback;
  const it = p.item;
  $('npTitle').textContent = p.title || '상영 중인 영상 없음';
  const stTxt = { playing: '▶ 재생 중', paused: '⏸ 일시정지', preparing: '⏳ 준비 중', stopped: '⏹ 정지' }[p.status] || '';
  $('npSub').textContent = `${stTxt}${p.total ? ` · ${p.index + 1} / ${p.total}` : ''}${p.prepare ? ` · ${p.prepare.text || ''} ${Math.round((p.prepare.progress || 0) * 100)}%` : ''}${it?.live ? ' · 생방송' : ''}`;
  $('cToggle').textContent = p.playing ? '⏸' : '▶';
  $('cLoop').value = p.loop;
  $('sideNow').textContent = p.title ? `${p.playing ? '▶' : '⏸'} ${p.title}` : '';
  $('statNow').textContent = p.title || '-';
}
function tickSeek() {
  if (!S) return;
  const p = S.playback;
  const d = curDuration();
  const pos = p.playing ? p.pos + (Date.now() - p._recv) / 1000 : p.pos;
  if (!seeking) {
    $('seek').value = d ? Math.min(1000, pos / d * 1000) : 0;
    $('posText').textContent = fmtT(pos);
  }
  $('durText').textContent = p.item?.live ? 'LIVE' : fmtT(d);
  $('seek').disabled = !d;
}
setInterval(tickSeek, 250);

// ------------------------------------------------------------------ 접속자
function renderUsers() {
  const u = S.users;
  $('userBadge').textContent = u.length;
  $('statUsers').textContent = u.length;
  $('usersCount').textContent = `${u.length}명`;
  $('usersEmpty').classList.toggle('hidden', u.length > 0);
  $('usersBody').innerHTML = u.map((x) => `<tr data-id="${x.id}">
    <td><b>${esc(x.nick)}</b>${x.muted ? ' <span class="muted">(채팅금지)</span>' : ''}</td>
    <td><span class="cdot" style="background:${CHAR[x.char]?.[1]}"></span>${CHAR[x.char]?.[0] || x.char}${x.model ? `<br><small class="muted">🧸 ${esc(x.model.name || x.model.ext)}</small>` : ''}</td>
    <td class="muted">${esc(x.ip)}</td><td>${x.seat || '-'}</td><td class="muted">${fmtClock(x.joinedAt)}</td>
    <td>${x.model ? '<button class="btn small" data-act="model">모델 초기화</button>' : ''}<button class="btn small" data-act="mute">${x.muted ? '채팅 허용' : '채팅 금지'}</button><button class="btn small" data-act="kick">강퇴</button><button class="btn small danger" data-act="ban">밴</button></td></tr>`).join('');
  const b = S.bans;
  $('bansEmpty').classList.toggle('hidden', b.length > 0);
  $('bansBody').innerHTML = b.map((x) => `<tr data-id="${x.id}"><td>${esc(x.nick)}</td><td class="muted">${esc(x.ip)}</td><td>${esc(x.reason || '-')}</td><td class="muted">${new Date(x.at).toLocaleString('ko-KR')}</td><td><button class="btn small" data-act="unban">차단 해제</button></td></tr>`).join('');
}
$('usersBody').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = +b.closest('tr').dataset.id;
  const u = S.users.find((x) => x.id === id);
  if (b.dataset.act === 'kick') { if (confirm(`${u.nick} 님을 강퇴할까요? (다시 들어올 수 있음)`)) { await call('kick', id); toast('강퇴했습니다'); } }
  if (b.dataset.act === 'ban') { const r = prompt(`${u.nick} 님을 차단합니다. 같은 IP·기기로는 다시 들어올 수 없습니다.\n차단 사유 (선택):`, ''); if (r !== null) { await call('ban', id, r); toast('차단했습니다'); } }
  if (b.dataset.act === 'mute') call('mute', id, !u.muted);
  if (b.dataset.act === 'model') { if (confirm(`${u.nick} 님의 3D 모델을 기본 캐릭터로 되돌릴까요?`)) { await call('resetModel', id); toast('모델을 초기화했습니다'); } }
});
$('bansBody').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) call('unban', b.closest('tr').dataset.id); });

// ------------------------------------------------------------------ 채팅
function chatRow(m) {
  const d = document.createElement('div');
  d.className = m.t === 'sys' ? 'sys' : m.t === 'notice' ? 'notice' : '';
  const time = `<time>${m.ts ? fmtClock(m.ts) : ''}</time>`;
  if (m.t === 'chat') d.innerHTML = `${time}<b style="color:${CHAR[m.char]?.[1] || '#fff'}">${esc(m.nick)}</b> ${esc(m.text)}`;
  else if (m.t === 'notice') d.innerHTML = `${time}📢 ${esc(m.text)}`;
  else d.innerHTML = `${time}${esc(m.text)}`;
  return d;
}
function addChat(m) {
  const log = $('chatLog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(chatRow(m));
  while (log.children.length > 500) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}
$('noticeForm').onsubmit = (e) => { e.preventDefault(); const t = $('noticeInput').value.trim(); if (!t) return; call('notice', t); $('noticeInput').value = ''; };
$('clearChat').onclick = () => confirm('모든 접속자의 채팅 기록을 지울까요?') && call('clearChat');
$('chatEnabled').onchange = () => call('setConfig', { chat: { enabled: $('chatEnabled').checked } });
$('slowMode').onchange = () => call('setConfig', { chat: { slowMode: Math.max(0, +$('slowMode').value || 0) } });
$('maxLen').onchange = () => call('setConfig', { chat: { maxLen: Math.min(500, Math.max(10, +$('maxLen').value || 200)) } });

// ------------------------------------------------------------------ 전광판
const signBg = new Image();
signBg.src = '../../client/assets/textures/sign4_bg.jpg';
signBg.onload = () => drawSignPreview();
let customBg = null;
function signForm() {
  return {
    hall: $('sHall').value, floor: $('sFloor').value, autoTitle: $('sAuto').checked, title: $('sTitle').value,
    message: $('sMsg').value, messageEn: $('sMsgEn').value, color: $('sColor').value, showClock: $('sClock').checked,
  };
}
function drawSignPreview() {
  const c = $('signPreview');
  const g = c.getContext('2d');
  const s = signForm();
  const W = c.width, H = c.height;
  const bg = customBg && customBg.complete ? customBg : signBg;
  if (bg.complete && bg.naturalWidth) g.drawImage(bg, 0, 0, W, H); else { g.fillStyle = '#123'; g.fillRect(0, 0, W, H); }
  g.fillStyle = 'rgba(0,30,60,0.25)'; g.fillRect(0, 0, W, H);
  g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 10; g.fillStyle = s.color;
  if (s.showClock) { const n = new Date(), h = n.getHours(); g.font = 'bold 44px Arial'; g.textAlign = 'left'; g.fillText(`${String(h % 12 || 12).padStart(2, '0')} ${String(n.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, 26, 60); }
  g.font = 'bold 26px Arial'; g.textAlign = 'right'; g.fillText('LOTTE CINEMA', W - 26, 52);
  g.textAlign = 'left'; g.font = 'bold 70px "Malgun Gothic"'; g.fillText(s.hall, 26, 200);
  const hw = g.measureText(s.hall).width;
  g.font = 'bold 92px "Malgun Gothic"'; g.fillText(s.floor, 56 + hw, 200);
  const tx = 56 + hw + g.measureText(s.floor).width + 36;
  const title = s.autoTitle ? (S?.playback?.title || s.title || '(상영 중인 영상 제목)') : s.title;
  g.save(); g.beginPath(); g.rect(tx, 90, W - tx - 20, 140); g.clip(); g.fillText(title, tx, 200); g.restore();
  g.font = '40px "Malgun Gothic"'; g.fillText(s.message, 26, 290);
  g.font = '30px Arial'; g.fillText(s.messageEn, 26, 336);
  g.shadowBlur = 0;
}
['sHall', 'sFloor', 'sTitle', 'sMsg', 'sMsgEn', 'sColor', 'sClock', 'sAuto'].forEach((id) => $(id).addEventListener('input', drawSignPreview));
$('sSave').onclick = async () => { await call('setConfig', { sign4: signForm() }); toast('✅ 전광판에 적용했습니다'); };
$('sBg').onclick = async () => {
  const f = await call('pickFiles', 'image');
  if (!f[0]) return;
  await call('setConfig', { sign4: { bg: f[0] } });
  customBg = new Image(); customBg.onload = drawSignPreview; customBg.src = 'file:///' + f[0].replace(/\\/g, '/');
  toast('배경을 바꿨습니다');
};
$('sBgReset').onclick = async () => { await call('setConfig', { sign4: { bg: 'default' } }); customBg = null; drawSignPreview(); };

function renderLobby() {
  const list = S.media.lobby;
  const cur = S.media.lobbyItemId;
  $('lobbyList').innerHTML = list.map((it) => `<div class="pl-item ${it.id === cur ? 'cur' : ''}" data-id="${it.id}">
    <div class="pl-title"><b>${it.id === cur ? '📺 ' : ''}${esc(it.title)}</b><small>${esc(it.source)}</small></div>
    <div class="pl-status">${statusHtml(it)}</div>
    <div class="pl-actions"><button class="btn" data-act="use">${it.id === cur ? '사용 중' : '사용'}</button><button class="btn danger" data-act="del">🗑</button></div></div>`).join('') || '<div class="empty">추가된 로비 영상이 없습니다 (기본 화면 사용 중)</div>';
}
$('lobbyList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.closest('.pl-item').dataset.id;
  if (b.dataset.act === 'use') call('setLobby', id);
  if (b.dataset.act === 'del') call('remove', id);
});
$('lAddFile').onclick = async () => {
  const f = await call('pickFiles', 'lobby');
  if (!f.length) return;
  const r = await call('addFiles', f, { role: 'lobby' });
  if (r[0]) call('setLobby', r[0].id);
};
$('lAddUrl').onclick = async () => {
  const u = $('lUrl').value.trim();
  if (!u) return;
  const r = await call('addUrls', u, { role: 'lobby', mode: 'download' });
  $('lUrl').value = '';
  if (r[0]) call('setLobby', r[0].id);
};
$('lDefault').onclick = () => call('setLobby', null);
$('lVol').oninput = () => { $('lVolVal').textContent = Math.round($('lVol').value * 100) + '%'; };
$('lVol').onchange = () => call('setConfig', { lobby: { volume: +$('lVol').value } });

// ------------------------------------------------------------------ 설정
function renderSettings() {
  const c = S.config;
  $('port').value = c.port;
  $('password').value = c.password || '';
  document.querySelectorAll('input[name=exp]').forEach((r) => (r.checked = r.value === (S.urls?.exposure || c.exposure)));
  $('cfgName').value = c.serverName;
  $('cfgMax').value = c.maxUsers;
  $('cfgHeight').value = String(c.media.maxHeight);
  $('cfgYtSubs').checked = c.media.ytSubs !== false;
  $('cfgPrefetch').value = c.media.prefetch ?? 3;
  $('cfgNames').value = c.names.join(', ');
  $('cfgCustom').checked = c.customModels?.enabled !== false;
  $('cfgCustomMB').value = c.customModels?.maxMB ?? 60;
  $('chatEnabled').checked = c.chat.enabled;
  $('slowMode').value = c.chat.slowMode;
  $('maxLen').value = c.chat.maxLen;
  const s = c.sign4;
  $('sHall').value = s.hall; $('sFloor').value = s.floor; $('sAuto').checked = s.autoTitle; $('sTitle').value = s.title;
  $('sMsg').value = s.message; $('sMsgEn').value = s.messageEn; $('sColor').value = s.color || '#ffffff'; $('sClock').checked = s.showClock !== false;
  $('sBgName').textContent = s.bg && s.bg !== 'default' ? s.bg.split(/[\\/]/).pop() : '기본 배경';
  if (s.bg && s.bg !== 'default' && !customBg) { customBg = new Image(); customBg.onload = drawSignPreview; customBg.src = 'file:///' + s.bg.replace(/\\/g, '/'); }
  $('lVol').value = c.lobby.volume; $('lVolVal').textContent = Math.round(c.lobby.volume * 100) + '%';
  $('stickCfg').innerHTML = c.stickColors.map((x, i) => `<div class="s"><input value="${esc(x.name)}" data-sn="${i}"><input type="color" value="${x.color}" data-sc="${i}"></div>`).join('');
  drawSignPreview();
}
$('cfgSave').onclick = async () => {
  const names = $('cfgNames').value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
  const sticks = S.config.stickColors.map((x, i) => ({ ...x, name: document.querySelector(`[data-sn="${i}"]`).value, color: document.querySelector(`[data-sc="${i}"]`).value }));
  await call('setConfig', {
    serverName: $('cfgName').value.trim() || '사이버 홍대입구', maxUsers: Math.max(1, +$('cfgMax').value || 150),
    names: names.length ? names : S.config.names, stickColors: sticks,
    customModels: { enabled: $('cfgCustom').checked, maxMB: Math.min(500, Math.max(1, +$('cfgCustomMB').value || 60)) },
    media: { maxHeight: +$('cfgHeight').value, ytSubs: $('cfgYtSubs').checked, prefetch: Math.max(0, +$('cfgPrefetch').value || 0) },
  });
  toast('✅ 설정을 저장했습니다');
};
$('openData').onclick = () => call('openDataDir');

// ------------------------------------------------------------------ 이벤트 수신
function renderAll() {
  S.playback._recv = Date.now();
  renderServer(); renderPlayer(); renderPlaylist(); renderUsers(); renderLobby(); renderSettings();
  $('statList').textContent = S.media.playlist.length;
  $('logs').textContent = S.logs.join('\n');
}
bridge.on('status', (d) => { if (!S) return; S.status = d.status; S.urls = d.urls; renderServer(); });
bridge.on('log', (l) => { if (!S) return; S.logs.push(l); const el = $('logs'); el.textContent += (el.textContent ? '\n' : '') + l; });
bridge.on('users', (u) => { if (!S) return; S.users = u; renderUsers(); });
bridge.on('chat', (m) => addChat(m));
bridge.on('chatclear', () => ($('chatLog').innerHTML = ''));
bridge.on('playback', (p) => { if (!S) return; p._recv = Date.now(); S.playback = p; renderPlayer(); renderPlaylist(); });
bridge.on('media', (m) => { if (!S) return; S.media = m; renderPlaylist(); renderLobby(); $('statList').textContent = m.playlist.length; });
bridge.on('item', (it) => {
  if (!S) return;
  const arr = it.role === 'lobby' ? S.media.lobby : S.media.playlist;
  const i = arr.findIndex((x) => x.id === it.id);
  if (i >= 0) arr[i] = it;
  const el = document.querySelector(`[data-status="${it.id}"]`);
  if (el) el.innerHTML = statusHtml(it);
});
bridge.on('config', (c) => { if (!S) return; S.config = c; });
bridge.on('bans', (b) => { if (!S) return; S.bans = b; renderUsers(); });

(async () => {
  S = await call('state');
  renderAll();
  for (const m of S.chat) addChat(m);
})();
