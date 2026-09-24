// igscript.com shared transcription widget logic (one widget per page)
// 免费用户：单条链接；Pro 用户（localStorage 有通行证）：可一次粘最多 10 条链接。
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  if (!$('go')) return;
  let lastSegments = [];
  let lastPro = false;

  const PASS_KEY = 'igscript_pass';
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }

  // 页面载入时查询 Pro 状态，顺带提示剩余额度
  if (getPass()) {
    fetch('/api/pro-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass: getPass() })
    }).then(r => r.json()).then(d => {
      if (d.valid) {
        lastPro = true;
        showStatus('Pro active — ' + d.credits_left + ' credits left until ' + d.expires.slice(0, 10) + '. Paste up to 10 links (separated by spaces or new lines).');
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

  function parseLinks(raw) {
    const max = lastPro ? 10 : 1;
    const links = raw.trim().split(/\s+/).filter(u => /^https?:\/\//i.test(u));
    return { links: links.slice(0, max), dropped: Math.max(0, links.length - max) };
  }

  $('go').addEventListener('click', async () => {
    const { links, dropped } = parseLinks($('url').value);
    if (!links.length) { showStatus('Paste an Instagram link first', 'err'); return; }
    $('go').disabled = true;
    showStatus(links.length > 1
      ? 'Pro batch: ' + links.length + ' links queued — this can take a few minutes. Please keep this page open…'
      : 'Extracting the video and transcribing — usually takes 10-60 seconds. Please keep this page open…');
    $('result').style.display = 'none';

    const outputs = [];
    let firstError = null;
    for (let i = 0; i < links.length; i++) {
      try {
        const r = await fetch('/api/transcript', {
          method: 'POST',
          headers: Object.assign(
            { 'Content-Type': 'application/json' },
            getPass() ? { 'x-pass': getPass() } : {}
          ),
          body: JSON.stringify({ url: links[i] })
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && (data.text || '').trim()) {
          if (links.length === 1) {
            lastSegments = data.segments || [];
            $('out').value = data.text;
            const left = typeof data.left_uses === 'number' && !data.pro
              ? ' — ' + data.left_uses + ' free use' + (data.left_uses === 1 ? '' : 's') + ' left today'
              : (typeof data.left_credits === 'number' ? ' — ' + data.left_credits + ' Pro credits left' : '');
            showStatus('Done' + left);
            $('result').style.display = 'block';
            $('go').disabled = false;
            return;
          }
          outputs.push('=== ' + (i + 1) + '/' + links.length + ' · ' + links[i] + ' ===\n' + data.text);
          showStatus('Batch progress: ' + (i + 1) + ' of ' + links.length + ' done…');
          continue;
        }
        // 服务端按 code 分流；单条直出，批量则中断并报告
        firstError = describeError(r.status, data);
        if (links.length === 1) { showStatus(firstError.msg, firstError.cls, firstError.upgrade); $('go').disabled = false; return; }
        break;
      } catch (e) {
        firstError = { msg: 'Transcription failed: ' + e.message, cls: 'err', upgrade: false };
        if (links.length === 1) { showStatus(firstError.msg, 'err'); $('go').disabled = false; return; }
        break;
      }
    }

    if (outputs.length) {
      lastSegments = [];
      $('out').value = outputs.join('\n\n') + (firstError ? '\n\n[Stopped: ' + firstError.msg + ']' : '');
      showStatus('Batch done: ' + outputs.length + ' of ' + links.length + ' transcribed.' +
        (dropped ? ' (' + dropped + ' extra link' + (dropped > 1 ? 's' : '') + ' ignored — batch limit is 10.)' : ''));
      $('result').style.display = 'block';
    } else if (firstError) {
      showStatus(firstError.msg, firstError.cls, firstError.upgrade);
    }
    $('go').disabled = false;
  });

  function describeError(status, data) {
    if (data.code === 'nocaptions') return { msg: data.error || 'No captions or spoken words were found for this link.', cls: 'err' };
    if (data.code === 'quota') return { msg: 'You\'ve used today\'s free quota (3 transcriptions or 30 credits per day). ', cls: 'err', upgrade: true };
    if (data.code === 'length') return { msg: data.error + ' ', cls: 'err', upgrade: true };
    if (data.code === 'length_paid') return { msg: data.error, cls: 'err' };
    if (data.code === 'busy') return { msg: data.error, cls: 'err' };
    if (data.code === 'paid_quota') return { msg: data.error + ' ', cls: 'err', upgrade: true };
    if (data.code === 'pass_expired' || data.code === 'bad_pass') {
      try { localStorage.removeItem(PASS_KEY); } catch (e) {}
      return { msg: (data.error || 'Pass not recognized') + ' ', cls: 'err', upgrade: true };
    }
    return { msg: 'Transcription failed: ' + (data.error || ('HTTP ' + status)), cls: 'err' };
  }

  function fmtTime(sec, srt) {
    const total = Math.round(sec * 1000); // 先取整毫秒，防浮点截断（8.542s 被 floor 成 08,541）
    const h = String(Math.floor(total/3600000)).padStart(2,'0');
    const m = String(Math.floor(total/60000)%60).padStart(2,'0');
    const s = String(Math.floor(total/1000)%60).padStart(2,'0');
    const ms = String(total%1000).padStart(3,'0');
    return srt ? h+':'+m+':'+s+','+ms : h+':'+m+':'+s;
  }
  function download(name, content) {
    const blob = new Blob([content], { type:'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }
  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('out').value);
    $('copy').textContent = 'Copied';
    setTimeout(() => $('copy').textContent = 'Copy', 1500);
  });
  $('txt').addEventListener('click', () => download('transcript.txt', $('out').value));
  $('srt').addEventListener('click', () => {
    const srt = lastSegments.map((s,i) =>
      (i+1)+'\n'+fmtTime(s.start,true)+' --> '+fmtTime(s.end||s.start+2,true)+'\n'+(s.text||'').trim()+'\n'
    ).join('\n');
    download('transcript.srt', srt || $('out').value);
  });
});
