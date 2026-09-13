// igscript.com shared transcription widget logic (one widget per page)
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  if (!$('go')) return;
  let lastSegments = [];

  $('go').addEventListener('click', async () => {
    const url = $('url').value.trim();
    const status = $('status');
    if (!url) { status.textContent = 'Paste an Instagram link first'; status.className = 'status err'; return; }
    $('go').disabled = true;
    status.className = 'status';
    status.textContent = 'Extracting the video and transcribing — usually takes 10-60 seconds. Please keep this page open…';
    $('result').style.display = 'none';
    try {
      const r = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      lastSegments = data.segments || [];
      const text = data.text || '';
      if (!text) throw new Error('No speech detected in this video');
      $('out').value = text;
      status.textContent = 'Done';
      $('result').style.display = 'block';
    } catch (e) {
      status.textContent = 'Transcription failed: ' + e.message;
      status.className = 'status err';
    } finally {
      $('go').disabled = false;
    }
  });

  function fmtTime(sec, srt) {
    const h = String(Math.floor(sec/3600)).padStart(2,'0');
    const m = String(Math.floor(sec%3600/60)).padStart(2,'0');
    const s = String(Math.floor(sec%60)).padStart(2,'0');
    const ms = String(Math.floor((sec%1)*1000)).padStart(3,'0');
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
