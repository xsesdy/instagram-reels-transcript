// igscript.com Facebook video transcript widget (single link)
// 独立于 tool.js：Facebook 页单链接，输出区带时间戳，TXT 导纯文本，SRT 前端拼。
// 不改 tool.js，不动 IG 页行为；后端 /api/transcript 不分平台，无需改动。
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  if (!$('go')) return;
  let lastSegments = [];

  const PASS_KEY = 'igscript_pass';
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }

  // 页面载入时查询 Pro 状态（同一通行证全站通用）
  if (getPass()) {
    fetch('/api/pro-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass: getPass() })
    }).then(r => r.json()).then(d => {
      if (d.valid) {
        showStatus('Pro active — ' + d.credits_left + ' credits left until ' + d.expires.slice(0, 10) + '.');
      } else if (d.expired) {
        showStatus('Your Pro pass has expired — you can renew on the upgrade page.', 'err', true);
      } else {
        try { localStorage.removeItem(PASS_KEY); } catch (e) {}
      }
    }).catch(() => {});
  }

  function showStatus(msg, cls, withUpgrade) {
    const status = $('status');
    status.className = 'status' + (cls ? ' ' + cls : '');
    if (withUpgrade) {
      status.textContent = msg + ' ';
      const a = document.createElement('a');
      a.href = '/upgrade';
      a.textContent = 'See the Pro plan →';
      a.style.fontWeight = '600';
      status.appendChild(a);
    } else {
      status.textContent = msg;
    }
  }

  $('go').addEventListener('click', async () => {
    const url = $('url').value.trim().split(/\s+/)[0] || '';
    if (!/^https?:\/\//i.test(url)) { showStatus('Paste a Facebook video link first', 'err'); return; }
    $('go').disabled = true;
    showStatus('Extracting the video and transcribing — usually takes 10-60 seconds. Please keep this page open…');
    $('result').style.display = 'none';

    try {
      const r = await fetch('/api/transcript', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          getPass() ? { 'x-pass': getPass() } : {}
        ),
        body: JSON.stringify({ url: url })
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && (data.text || '').trim()) {
        lastSegments = data.segments || [];
        $('out').value = lastSegments.length
          ? lastSegments.map(s => '[' + fmtTime(s.start) + '] ' + (s.text || '').trim()).join('\n')
          : data.text;
        const left = typeof data.left_uses === 'number' && !data.pro
          ? ' — ' + data.left_uses + ' free use' + (data.left_uses === 1 ? '' : 's') + ' left today'
          : (typeof data.left_credits === 'number' ? ' — ' + data.left_credits + ' Pro credits left' : '');
        showStatus('Done' + left);
        $('result').style.display = 'block';
      } else {
        showError(r.status, data);
      }
    } catch (e) {
      showStatus('Transcription failed: ' + e.message, 'err');
    }
    $('go').disabled = false;
  });

  function showError(status, data) {
    if (data.code === 'nocaptions') return showStatus(data.error || 'No captions or spoken words were found for this link.', 'err');
    if (data.code === 'quota') return showStatus('You\'ve used today\'s free quota (3 transcriptions or 30 credits per day). ', 'err', true);
    if (data.code === 'length') return showStatus(data.error + ' ', 'err', true);
    if (data.code === 'length_paid' || data.code === 'busy' || data.code === 'paid_quota') return showStatus(data.error, 'err');
    if (data.code === 'pass_expired' || data.code === 'bad_pass') {
      try { localStorage.removeItem(PASS_KEY); } catch (e) {}
      return showStatus((data.error || 'Pass not recognized') + ' ', 'err', true);
    }
    showStatus('Transcription failed: ' + (data.error || ('HTTP ' + status)), 'err');
  }

  // 先取整毫秒再格式化，避免浮点截断（8.542s 会被 floor 成 08,541）
  function fmtTime(sec) {
    const total = Math.round(sec * 1000);
    const m = String(Math.floor(total / 60000) % 60).padStart(2, '0');
    const s = String(Math.floor(total / 1000) % 60).padStart(2, '0');
    return m + ':' + s;
  }
  function fmtTimeSrt(sec) {
    const total = Math.round(sec * 1000);
    const h = String(Math.floor(total / 3600000)).padStart(2, '0');
    const m = String(Math.floor(total / 60000) % 60).padStart(2, '0');
    const s = String(Math.floor(total / 1000) % 60).padStart(2, '0');
    const ms = String(total % 1000).padStart(3, '0');
    return h + ':' + m + ':' + s + ',' + ms;
  }
  function download(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('out').value);
    $('copy').textContent = 'Copied';
    setTimeout(() => $('copy').textContent = 'Copy', 1500);
  });
  $('txt').addEventListener('click', () => {
    const plain = lastSegments.length
      ? lastSegments.map(s => (s.text || '').trim()).join(' ')
      : $('out').value;
    download('facebook-video-transcript.txt', plain);
  });
  $('srt').addEventListener('click', () => {
    const srt = lastSegments.map((s, i) =>
      (i + 1) + '\n' + fmtTimeSrt(s.start) + ' --> ' + fmtTimeSrt(s.end || s.start + 2) + '\n' + (s.text || '').trim() + '\n'
    ).join('\n');
    download('facebook-video-transcript.srt', srt || $('out').value);
  });
});
