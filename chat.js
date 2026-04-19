// ═══════════════════════════════════════════════════════════════════
//  CHAT.JS v4 — Powered by Google Gemini API (100% FREE, no credit card)
//
//  HOW TO GET YOUR FREE KEY:
//  1. Go to https://aistudio.google.com
//  2. Sign in with Google (Gmail)
//  3. Click "Get API Key" → "Create API key"
//  4. Paste it below
// ═══════════════════════════════════════════════════════════════════

// ✅ Paste your FREE Gemini API key here (from https://aistudio.google.com)
const GEMINI_API_KEY = 'AIzaSyDL4MJs3ViLMNcnYwfUd9gOXXMYjJjUS3U';

// Gemini model — gemini-1.5-flash is free and very capable
const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

let chatHistory  = [];
let isLoading    = false;
let isIndexed    = false;
let collegeUrl   = '';
let manualItems  = [];
let recognition  = null;
let isListening  = false;
let isSpeaking   = false;
let isDark       = true;

// ════════════════════════════════════
//  CALL GEMINI API
//  Different format from OpenAI/Anthropic — simpler!
// ════════════════════════════════════
async function callGemini(systemPrompt, messages) {
  // Convert chat history to Gemini format
  // Gemini uses "user" and "model" (not "assistant")
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: contents,
    generationConfig: {
      maxOutputTokens: 1500,
      temperature: 0.7,
    }
  };

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || `API error ${res.status}`;
    throw new Error(errMsg);
  }

  // Extract text from Gemini response
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
}

// ════════════════════════════════════
//  THEME
// ════════════════════════════════════
function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('light', !isDark);
  el('theme-btn').textContent = isDark ? '🌙' : '☀️';
}

// ════════════════════════════════════
//  TABS
// ════════════════════════════════════
function switchTab(btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  el(btn.dataset.tab).classList.add('active');
}

// ════════════════════════════════════
//  VOICE INPUT
// ════════════════════════════════════
function toggleVoice() {
  if (isListening) { stopVoice(); return; }
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Voice works in Chrome and Edge. Please use one of those browsers.');
    return;
  }
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRec();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-IN';

  recognition.onstart = () => {
    isListening = true;
    el('voice-btn').classList.add('active');
    show('voice-bar');
  };
  recognition.onresult = (e) => {
    const transcript = [...e.results].map(r => r[0].transcript).join('');
    el('msg-input').value = transcript;
    el('voice-text').textContent = `"${transcript}"`;
    if (e.results[e.results.length - 1].isFinal) {
      stopVoice();
      setTimeout(sendMsg, 300);
    }
  };
  recognition.onerror = (e) => { stopVoice(); };
  recognition.onend   = () => stopVoice();
  recognition.start();
}

function stopVoice() {
  isListening = false;
  el('voice-btn').classList.remove('active');
  hide('voice-bar');
  el('voice-text').textContent = 'Listening... speak your question';
  try { recognition?.stop(); } catch {}
}

// ════════════════════════════════════
//  TEXT-TO-SPEECH
// ════════════════════════════════════
function speakText(text, btn) {
  if (!window.speechSynthesis) return;
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    document.querySelectorAll('.speak-btn').forEach(b => { b.classList.remove('speaking'); b.textContent = '🔊 Listen'; });
    return;
  }
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 0.9; utterance.lang = 'en-IN';
  const voices = window.speechSynthesis.getVoices();
  const indian = voices.find(v => /india|en-IN/i.test(v.lang + v.name));
  if (indian) utterance.voice = indian;
  utterance.onstart = () => { isSpeaking = true; btn.classList.add('speaking'); btn.textContent = '⏹ Stop'; };
  utterance.onend = utterance.onerror = () => { isSpeaking = false; btn.classList.remove('speaking'); btn.textContent = '🔊 Listen'; };
  window.speechSynthesis.speak(utterance);
}

// ════════════════════════════════════
//  CRAWL
// ════════════════════════════════════
async function startCrawl() {
  let url = el('url-input').value.trim();
  if (!url) return alert('Please enter your college website URL.');
  if (!url.startsWith('http')) url = 'https://' + url;
  collegeUrl = url;

  const maxPages = parseInt(el('max-pages').value) || 50;
  isIndexed = false; chatHistory = [];

  el('crawl-btn').disabled = true;
  el('crawl-btn').textContent = 'Indexing...';
  show('stop-btn'); show('progress-wrap'); hide('quick-section');
  el('crawl-bar-fill').style.width = '0%';
  el('crawl-log').innerHTML = '';
  el('stat-pages').textContent = '0 pages';
  el('stat-pdfs').textContent  = '0 PDFs';
  el('stat-imgs').textContent  = '0 imgs';
  el('progress-pct').textContent = '0%';
  el('chat-hd-sub').textContent = 'Indexing...';
  hide('kb-badge');

  el('image-gallery').innerHTML  = '<div class="gallery-empty"><div style="font-size:32px;margin-bottom:8px">⏳</div><div>Extracting images...</div></div>';
  el('deadlines-list').innerHTML = '<div class="gallery-empty"><div style="font-size:32px;margin-bottom:8px">⏳</div><div>Scanning for dates...</div></div>';

  addBotMsg('🔍 Crawling your college website. This takes 2–5 minutes. You can ask questions while I index!');

  try {
    await crawler.crawl(url, { maxPages, onProgress: handleProgress, onComplete: handleComplete });
  } catch (e) {
    addBotMsg(`<span style="color:#dc2626">Error: ${esc(e.message)}</span>`);
    el('crawl-btn').disabled = false;
    el('crawl-btn').textContent = 'Crawl & Index Everything';
    hide('stop-btn');
  }
}

function stopCrawl() {
  crawler.stop(); hide('stop-btn');
  el('crawl-btn').disabled = false;
  el('crawl-btn').textContent = 'Crawl & Index Everything';
  addBotMsg('⏹ Stopped. I can answer from what\'s indexed so far.');
}

function handleProgress(evt) {
  const { phase, url, title, type, ocrUsed, indexed, msg, cls } = evt;
  if (phase === 'log') { appendLog(msg, cls || 'fetching'); return; }
  if (phase === 'fetching') {
    appendLog((type === 'pdf' ? '📄 ' : '🌐 ') + (url?.replace(/^https?:\/\/[^/]+/, '').slice(0, 48) || '...'), 'fetching');
    updateBar(indexed || 0); return;
  }
  if (phase === 'indexed') {
    const last = el('crawl-log').lastElementChild;
    if (last) {
      last.className = `log-entry ${ocrUsed ? 'ocr' : type === 'pdf' ? 'pdf' : 'done'}`;
      const dot = last.querySelector('.log-dot');
      if (dot) dot.className = `log-dot ${ocrUsed ? 'ocr' : type}`;
    }
    const s = crawler.stats();
    el('stat-pages').textContent = s.pages + ' pages';
    el('stat-pdfs').textContent  = s.pdfs  + ' PDFs';
    el('stat-imgs').textContent  = s.images + ' imgs';
    updateBar(indexed); updateKbBadge(); return;
  }
  if (phase === 'images')    { renderGallery(); return; }
  if (phase === 'deadlines') { renderDeadlines(); return; }
  if (phase === 'error') {
    const last = el('crawl-log').lastElementChild;
    if (last) last.className = 'log-entry error';
  }
}

function handleComplete(pages) {
  el('crawl-bar-fill').style.width = '100%'; el('progress-pct').textContent = '100%';
  isIndexed = true; hide('stop-btn');
  el('crawl-btn').disabled = false; el('crawl-btn').textContent = 'Crawl & Index Everything';

  let hostname = collegeUrl; try { hostname = new URL(collegeUrl).hostname; } catch {}
  el('chat-hd-sub').textContent = 'Connected · ' + hostname;

  const s = crawler.stats();
  updateKbBadge(); buildKbList(); show('quick-section'); renderGallery(); renderDeadlines();

  const pdfNote  = s.pdfs   > 0 ? `, <strong>${s.pdfs} PDFs</strong>` : '';
  const imgNote  = s.images > 0 ? `, <strong>${s.images} images</strong>` : '';
  const dlNote   = crawler.deadlines.length > 0 ? `<br>⏰ Found <strong>${crawler.deadlines.length} deadlines</strong> — check the Deadlines tab!` : '';
  const galNote  = s.images > 0 ? `<br>🖼️ Check the <strong>Gallery</strong> tab for all images!` : '';

  addBotMsg(`✅ <strong>Done!</strong> Read <strong>${s.pages} pages</strong>${pdfNote}${imgNote} from <em>${hostname}</em>.${dlNote}${galNote}<br><br>Ask me anything!`);
}

function updateBar(indexed) {
  const max = parseInt(el('max-pages').value) || 50;
  const pct = Math.min(Math.round((indexed / max) * 100), 99);
  el('crawl-bar-fill').style.width = pct + '%';
  el('progress-pct').textContent = pct + '%';
}

function appendLog(text, cls) {
  const log = el('crawl-log');
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.innerHTML = `<div class="log-dot ${cls}"></div><span>${esc(text)}</span>`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}

// ════════════════════════════════════
//  IMAGE GALLERY
// ════════════════════════════════════
function renderGallery() {
  const gallery = el('image-gallery');
  const imgs    = crawler.images;
  if (!imgs.length) {
    gallery.innerHTML = '<div class="gallery-empty"><div style="font-size:32px;margin-bottom:8px">🖼️</div><div>No images found yet.</div></div>';
    hide('gallery-count'); return;
  }
  show('gallery-count');
  el('gallery-count').textContent = `${imgs.length} image${imgs.length > 1 ? 's' : ''} extracted`;
  gallery.innerHTML = '';
  for (const img of imgs.slice(0, 60)) {
    const div = document.createElement('div');
    div.className = 'gallery-thumb';
    div.onclick = () => openLightbox(img.url, img.alt);
    div.innerHTML = `<img src="${esc(img.url)}" alt="${esc(img.alt)}" loading="lazy" onerror="this.parentElement.style.display='none'"/>
      <div class="gallery-thumb-caption">${esc(img.alt.slice(0, 40))}</div>`;
    gallery.appendChild(div);
  }
}

function openLightbox(url, caption) { el('lightbox-img').src = url; el('lightbox-caption').textContent = caption || ''; show('lightbox'); }
function closeLightbox() { hide('lightbox'); el('lightbox-img').src = ''; }

// ════════════════════════════════════
//  DEADLINES
// ════════════════════════════════════
function renderDeadlines() {
  const list = el('deadlines-list');
  const dls  = crawler.deadlines;
  if (!dls.length) {
    list.innerHTML = '<div class="gallery-empty"><div style="font-size:32px;margin-bottom:8px">✅</div><div>No upcoming deadlines found yet.</div></div>';
    return;
  }
  list.innerHTML = '';
  for (const dl of dls) {
    const div = document.createElement('div');
    div.className = 'deadline-card';
    let cls = 'future', label = `In ${dl.daysLeft} days`;
    if (dl.daysLeft < 0)  { cls = 'past';   label = 'Passed'; }
    if (dl.daysLeft === 0){ cls = 'urgent';  label = 'TODAY!'; }
    if (dl.daysLeft > 0 && dl.daysLeft <= 3) { cls = 'urgent'; label = `${dl.daysLeft}d left!`; }
    if (dl.daysLeft > 3  && dl.daysLeft <= 10){ cls = 'soon'; label = `${dl.daysLeft}d left`; }
    div.innerHTML = `
      <div class="dl-header">
        <div class="dl-title">${esc(dl.text.slice(0, 100))}</div>
        <div class="dl-countdown ${cls}">${label}</div>
      </div>
      <div class="dl-date">📅 ${dl.date}</div>
      <div class="dl-source">${esc(dl.pageTitle)}</div>`;
    div.onclick = () => ask(`Tell me more about: ${dl.text.slice(0, 80)}`);
    list.appendChild(div);
  }
}

// ════════════════════════════════════
//  MANUAL IMPORT
// ════════════════════════════════════
async function importUrl() {
  const url = el('import-url').value.trim();
  if (!url) return;
  showImportStatus('Fetching...', false);
  try {
    const content = await crawler.fetchJina(url, 15000);
    if (!content || content.length < 50) throw new Error('No readable content found.');
    el('import-content').value = content.slice(0, 12000);
    if (!el('import-title').value) el('import-title').value = crawler.extractTitle(content, url);
    showImportStatus('✅ Fetched! Click Add to Knowledge Base.', false);
  } catch (e) { showImportStatus('❌ ' + e.message, true); }
}

function importManual() {
  const title   = el('import-title').value.trim();
  const content = el('import-content').value.trim();
  const srcUrl  = el('import-url').value.trim();
  if (!title || !content) return showImportStatus('❌ Fill in title and content.', true);
  const key = crawler.addManual(title, content, srcUrl);
  manualItems.push({ key, title });
  el('import-title').value = ''; el('import-content').value = ''; el('import-url').value = '';
  showImportStatus(`✅ "${title}" added!`, false);
  updateKbBadge(); buildKbList(); show('imported-list-wrap');
  el('import-count').textContent = manualItems.length;
  const item = document.createElement('div');
  item.className = 'imported-item';
  item.innerHTML = `<div class="imported-item-title">${esc(title)}</div>
    <button class="del-btn" onclick="deleteManual('${key}',this)">✕</button>`;
  el('imported-list').appendChild(item);
}

function deleteManual(key, btn) {
  crawler.pages.delete(key); manualItems = manualItems.filter(m => m.key !== key);
  btn.parentElement.remove(); el('import-count').textContent = manualItems.length;
  updateKbBadge(); buildKbList();
}

function showImportStatus(msg, isErr) {
  const s = el('import-status');
  s.textContent = msg; s.className = isErr ? 'error' : ''; show('import-status');
  setTimeout(() => hide('import-status'), 5000);
}

// ════════════════════════════════════
//  KB TAB
// ════════════════════════════════════
function buildKbList() {
  const list = el('kb-list');
  list.innerHTML = '';
  const s = crawler.stats();
  el('kbs-total').textContent = s.total; el('kbs-pages').textContent = s.pages;
  el('kbs-pdfs').textContent  = s.pdfs;  el('kbs-imgs').textContent  = s.images;
  if (!crawler.pages.size) { show('kb-empty'); hide('kb-stats-row'); return; }
  hide('kb-empty'); show('kb-stats-row');
  for (const [url, page] of crawler.pages) {
    const tag = page.ocrUsed ? '<span class="tag tag-ocr">OCR</span>' :
      page.type === 'pdf' ? '<span class="tag tag-pdf">PDF</span>' :
      page.type === 'manual' ? '<span class="tag tag-manual">MANUAL</span>' :
      page.type === 'gdrive' ? '<span class="tag tag-gdrive">DRIVE</span>' :
      '<span class="tag tag-page">PAGE</span>';
    const kb = Math.round(page.chars / 1000);
    const div = document.createElement('div');
    div.className = 'kb-item'; div.title = url;
    div.innerHTML = `<div class="kb-item-title">${esc(page.title)}</div>
      <div class="kb-item-meta">${tag}<span>${kb}k chars</span></div>`;
    div.onclick = () => { el('msg-input').value = `Tell me about: ${page.title}`; };
    list.appendChild(div);
  }
}

function filterKb(q) {
  document.querySelectorAll('.kb-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

function clearKb() {
  if (!confirm('Clear all indexed knowledge?')) return;
  crawler.pages.clear(); crawler.images = []; crawler.deadlines = [];
  manualItems = []; isIndexed = false; chatHistory = [];
  buildKbList(); updateKbBadge(); renderGallery(); renderDeadlines();
  el('crawl-bar-fill').style.width = '0%';
  el('stat-pages').textContent = '0 pages'; el('stat-pdfs').textContent = '0 PDFs'; el('stat-imgs').textContent = '0 imgs';
  el('chat-hd-sub').textContent = 'Index your college website to start';
  hide('quick-section'); hide('imported-list-wrap'); el('crawl-log').innerHTML = '';
}

function updateKbBadge() {
  const s = crawler.stats();
  el('kb-badge-text').textContent = `${s.total} docs · ${s.images} imgs`;
  if (s.total > 0) show('kb-badge'); else hide('kb-badge');
  isIndexed = s.total > 0;
}

// ════════════════════════════════════
//  EXPORT
// ════════════════════════════════════
function exportAnswer(html, btn) {
  const text = html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.innerHTML = '📋 Copy'; }, 2000);
  });
}

// ════════════════════════════════════
//  FOLLOW-UP SUGGESTIONS (using Gemini)
// ════════════════════════════════════
async function generateFollowups(question, answer) {
  try {
    const text = await callGemini(
      'You generate short follow-up questions for a college assistant chatbot. Return ONLY a JSON array of 3 short questions, nothing else. No markdown, no explanation.',
      [{ role: 'user', content: `Q: ${question}\nA: ${answer.slice(0, 300)}\n\nGenerate 3 follow-up questions as JSON array.` }]
    );
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch { return []; }
}

// ════════════════════════════════════
//  MAIN SEND
// ════════════════════════════════════
function ask(q) { el('msg-input').value = q; sendMsg(); }

async function sendMsg() {
  if (isLoading) return;
  const inp  = el('msg-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';

  addUserMsg(text);
  chatHistory.push({ role: 'user', content: text });
  isLoading = true; el('send-btn').disabled = true;
  const tid = addTyping();

  const lang = el('lang-select').value;
  const langInstr = lang !== 'english'
    ? `IMPORTANT: Respond entirely in ${lang} language using the correct script.`
    : '';

  try {
    let replyText, sources = [];

    if (isIndexed && crawler.pages.size > 0) {
      // ── RAG mode: answer from knowledge base ──
      const { context, sources: srcs } = crawler.buildContext(text);
      sources = srcs;

      const systemPrompt = `You are a helpful college assistant for ${collegeUrl}.
${langInstr}

The content below was extracted directly from the college website (web pages, PDFs, scanned docs, Google Drive files).

ANSWER RULES:
- Answer ONLY from the provided content
- Use **bold** for important info (dates, fees, names, timings)
- Use bullet points for lists and schedules
- Format timetables and fee structures as proper tables using | pipes |
- If information is not in the content, say so honestly
- Be helpful and concise
${langInstr}

COLLEGE CONTENT EXTRACTED FROM WEBSITE:
${context || 'No relevant content found for this query.'}`;

      replyText = await callGemini(systemPrompt, chatHistory);

    } else {
      // ── No index yet: general help ──
      const systemPrompt = `You are a helpful college assistant. The college website is: ${collegeUrl || '(not set yet)'}.
${langInstr}
The student has not indexed their college website yet. Remind them to use the Crawl tab first. Still help with general college questions if you can.`;
      replyText = await callGemini(systemPrompt, chatHistory);
    }

    // Find relevant images
    const relevantImgs = crawler.searchImages(text, 3);

    removeTyping(tid);
    const replyHtml = fmtMd(replyText);
    const msgDiv    = addBotMsg(replyHtml, sources, relevantImgs);
    chatHistory.push({ role: 'assistant', content: replyText });

    // Follow-up suggestions
    if (isIndexed) {
      generateFollowups(text, replyText).then(followups => {
        if (!followups?.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'followups';
        for (const q of followups) {
          const btn = document.createElement('button');
          btn.className = 'followup-btn';
          btn.textContent = '💡 ' + q;
          btn.onclick = () => ask(q);
          wrap.appendChild(btn);
        }
        msgDiv.querySelector('.msg-col').appendChild(wrap);
        el('messages').scrollTop = el('messages').scrollHeight;
      });
    }

  } catch (e) {
    removeTyping(tid);
    const isKeyErr = /API_KEY_INVALID|API key|403|400/i.test(e.message);
    addBotMsg(isKeyErr
      ? `<span style="color:#dc2626">⚠️ Invalid Gemini API key. Open <code>chat.js</code> and replace <code>AIzaSyDL4MJs3ViLMNcnYwfUd9gOXXMYjJjUS3U</code> with your key from <a href="https://aistudio.google.com" target="_blank" style="color:#1d4ed8">aistudio.google.com</a>.</span>`
      : `<span style="color:#dc2626">Error: ${esc(e.message)}</span>`
    );
    console.error(e);
  }

  isLoading = false; el('send-btn').disabled = false;
}

function clearChat() {
  chatHistory = []; el('messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">🎓</div>
      <h2>Campus AI v4</h2>
      <p>Powered by Google Gemini — 100% free, no credit card needed.</p>
      <div class="feature-grid">
        <div class="feat-card">🖼️<span>Image Gallery</span></div>
        <div class="feat-card">🎙️<span>Voice Mode</span></div>
        <div class="feat-card">⏰<span>Deadline Tracker</span></div>
        <div class="feat-card">🌐<span>Multilingual</span></div>
        <div class="feat-card">📊<span>Smart Tables</span></div>
        <div class="feat-card">💡<span>Follow-ups</span></div>
        <div class="feat-card">📄<span>OCR PDFs</span></div>
        <div class="feat-card">☁️<span>Google Drive</span></div>
      </div>
      <div class="how-it-works">
        <div class="step"><div class="step-n">1</div><div>Enter college URL → <strong>Crawl & Index Everything</strong></div></div>
        <div class="step"><div class="step-n">2</div><div>Browse <strong>Gallery</strong> tab for all extracted images</div></div>
        <div class="step"><div class="step-n">3</div><div>Check <strong>Deadlines</strong> tab for important dates</div></div>
        <div class="step"><div class="step-n">4</div><div>Ask in any language — voice or text</div></div>
      </div>
    </div>`;
}

// ════════════════════════════════════
//  DOM HELPERS
// ════════════════════════════════════
function el(id)   { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove('hidden'); }
function hide(id) { el(id)?.classList.add('hidden'); }
function now()    { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function esc(t = '') { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtMd(text) {
  // Render markdown tables as HTML
  text = text.replace(/(\|.+\|[\r\n]+)+/g, match => {
    const rows = match.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return match;
    let html = '<table>';
    rows.forEach((row, i) => {
      if (/^\|[\s\-|]+\|$/.test(row.trim())) return;
      const cells = row.split('|').filter((_, j, a) => j > 0 && j < a.length - 1).map(c => c.trim());
      html += i === 0
        ? `<tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>`
        : `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    });
    return html + '</table>';
  });
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3}\s+(.+)/gm, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+(.+)/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)+/g, m => `<ul style="padding-left:16px;margin:6px 0">${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function addUserMsg(text) {
  const msgs = el('messages');
  const div  = document.createElement('div');
  div.className = 'msg-row user';
  div.innerHTML = `<div class="msg-av av-user">Me</div>
    <div class="msg-col">
      <div class="bubble user">${esc(text)}</div>
      <div class="msg-ts">${now()}</div>
    </div>`;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
}

function addBotMsg(html, sources = [], images = []) {
  const msgs = el('messages');
  const div  = document.createElement('div');
  div.className = 'msg-row';
  let srcsHtml = '';
  if (sources.length) {
    srcsHtml = '<div class="sources-row">' + sources.map(s => {
      const icon = s.type === 'pdf' ? '📄' : s.type === 'manual' ? '📋' : s.type === 'ocr' ? '🔍' : s.type === 'gdrive' ? '☁️' : '🌐';
      return `<span class="src-chip ${s.type}" title="${esc(s.url)}">${icon} ${esc(s.title)}</span>`;
    }).join('') + '</div>';
  }
  let imgsHtml = '';
  if (images.length) {
    imgsHtml = '<div class="msg-images">' + images.map(img =>
      `<div class="msg-img-wrap" onclick="openLightbox('${esc(img.url)}','${esc(img.alt)}')">
        <img src="${esc(img.url)}" alt="${esc(img.alt)}" loading="lazy" onerror="this.parentElement.style.display='none'"/>
      </div>`).join('') + '</div>';
  }
  const msgId = 'msg-' + Date.now();
  div.innerHTML = `
    <div class="msg-av av-bot">AI</div>
    <div class="msg-col">
      <div class="bubble bot" id="${msgId}">${html}</div>
      ${imgsHtml}
      ${srcsHtml}
      <div class="msg-actions">
        <button class="export-btn" onclick="exportAnswer(el('${msgId}').innerHTML, this)">📋 Copy</button>
        <button class="speak-btn" onclick="speakText(el('${msgId}').textContent, this)">🔊 Listen</button>
      </div>
      <div class="msg-ts">${now()}</div>
    </div>`;
  msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function addTyping() {
  const id  = 'typ-' + Date.now();
  const div = document.createElement('div');
  div.id = id; div.className = 'msg-row';
  div.innerHTML = `<div class="msg-av av-bot">AI</div>
    <div class="msg-col">
      <div class="bubble bot"><div class="typing-wrap"><span></span><span></span><span></span></div></div>
    </div>`;
  el('messages').appendChild(div); el('messages').scrollTop = 9999;
  return id;
}
function removeTyping(id) { el(id)?.remove(); }

document.addEventListener('DOMContentLoaded', () => {
  buildKbList();
  const inp = el('msg-input');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  inp.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'm') { e.preventDefault(); toggleVoice(); } });
});
