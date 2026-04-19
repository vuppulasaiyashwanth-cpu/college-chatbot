// ═══════════════════════════════════════════════════════════════════
//  CRAWLER.JS v4 — Full-access crawler with image + deadline extraction
// ═══════════════════════════════════════════════════════════════════

const OCR_API_KEY = 'helloworld';
const OCR_API_URL = 'https://api.ocr.space/parse/imageurl';
const JINA_BASE   = 'https://r.jina.ai/';

class CollegeCrawler {
  constructor() {
    this.pages     = new Map();
    this.images    = [];       // { url, alt, pageTitle, pageUrl }
    this.deadlines = [];       // { text, date, pageTitle, pageUrl, daysLeft }
    this.queue     = [];
    this.visited   = new Set();
    this.baseUrl   = '';
    this.baseHost  = '';
    this.running   = false;
  }

  // ── Type detection ──
  isPdf(u)      { return /\.pdf(\?|#|$)/i.test(u); }
  isDoc(u)      { return /\.(docx?|pptx?|xlsx?)(\?|#|$)/i.test(u); }
  isImage(u)    { return /\.(jpg|jpeg|png|gif|webp|bmp)(\?|#|$)/i.test(u); }
  isMedia(u)    { return /\.(svg|ico|mp4|mp3|zip|exe|css|js|woff|ttf)(\?|#|$)/i.test(u); }
  isGDrive(u)   { return /drive\.google\.com|docs\.google\.com/i.test(u); }
  isOneDrive(u) { return /onedrive\.live\.com|1drv\.ms|sharepoint\.com/i.test(u); }
  isSkippable(u){ return this.isMedia(u)||/mailto:|tel:|javascript:|#(?!$)|logout|login|signin|captcha/i.test(u); }

  // ── Fetch via Jina ──
  async fetchJina(url, ms = 18000) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(JINA_BASE + url, {
        signal: ctrl.signal,
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' }
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch(e) { clearTimeout(timer); throw e; }
  }

  // ── OCR for scanned PDFs ──
  async ocrPdf(pdfUrl) {
    try {
      const form = new FormData();
      form.append('url', pdfUrl);
      form.append('apikey', OCR_API_KEY);
      form.append('language', 'eng');
      form.append('isOverlayRequired', 'false');
      form.append('filetype', 'PDF');
      form.append('OCREngine', '2');
      form.append('isTable', 'true');
      const res  = await fetch(OCR_API_URL, { method: 'POST', body: form });
      const data = await res.json();
      if (data.IsErroredOnProcessing) throw new Error(data.ErrorMessage?.join(', '));
      return (data.ParsedResults || []).map(p => p.ParsedText || '').join('\n\n---\n\n').trim();
    } catch(e) { console.warn('OCR failed:', pdfUrl, e.message); return ''; }
  }

  // ── Google Drive URL converter ──
  gDriveUrl(url) {
    const file = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (file) return `https://drive.google.com/uc?export=download&id=${file[1]}`;
    const doc  = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (doc)  return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`;
    const sheet= url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (sheet) return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv`;
    return url;
  }

  // ── Extract image URLs from markdown content ──
  extractImages(content, pageUrl, pageTitle) {
    const found = [];
    // Markdown images: ![alt](url)
    for (const m of content.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const imgUrl = m[2];
      if (this.isImage(imgUrl) || /\.(jpg|jpeg|png|gif|webp)/i.test(imgUrl)) {
        // Skip tiny icons/logos (usually < 200px filenames hint)
        if (/icon|logo|favicon|button|arrow|social|share|thumb.*small/i.test(imgUrl)) continue;
        found.push({ url: imgUrl, alt: m[1] || pageTitle, pageTitle, pageUrl });
      }
    }
    // Direct img URLs in text
    for (const m of content.matchAll(/https?:\/\/[^\s"'<)]+\.(?:jpg|jpeg|png|gif|webp)/gi)) {
      const imgUrl = m[0];
      if (/icon|logo|favicon|button|arrow|social|1x1|pixel/i.test(imgUrl)) continue;
      if (!found.find(f => f.url === imgUrl)) {
        found.push({ url: imgUrl, alt: pageTitle, pageTitle, pageUrl });
      }
    }
    return found;
  }

  // ── Extract dates/deadlines from content ──
  extractDeadlines(content, pageTitle, pageUrl) {
    const found = [];
    const now = new Date();
    now.setHours(0,0,0,0);

    // Date patterns (Indian + international formats)
    const patterns = [
      // "15 January 2025", "15 Jan 2025"
      /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/gi,
      // "January 15, 2025"
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/gi,
      // "15/01/2025" or "15-01-2025"
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})/g,
      // "2025-01-15"
      /(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,
    ];

    const months = {
      january:0,february:1,march:2,april:3,may:4,june:5,
      july:6,august:7,september:8,october:9,november:10,december:11,
      jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
    };

    // Context keywords that suggest this is a deadline/event
    const keywords = /last\s*date|deadline|due\s*date|submission|admission|exam|test|result|registration|apply|apply\s*before|closing|open|start|end|commence|schedule|notice|circular|important|date|event|fest|convocation/i;

    for (const pattern of patterns) {
      for (const m of content.matchAll(pattern)) {
        let date = null;
        try {
          if (m[2] && isNaN(m[2])) {
            // "15 January 2025" format
            const month = months[m[2].toLowerCase()];
            if (month !== undefined) date = new Date(parseInt(m[3]), month, parseInt(m[1]));
          } else if (m[1] && isNaN(m[1])) {
            // "January 15, 2025" format
            const month = months[m[1].toLowerCase()];
            if (month !== undefined) date = new Date(parseInt(m[3]), month, parseInt(m[2]));
          } else if (m[3]?.startsWith('20')) {
            // DD/MM/YYYY
            date = new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
          } else if (m[1]?.startsWith('20')) {
            // YYYY-MM-DD
            date = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
          }
        } catch {}
        if (!date || isNaN(date)) continue;
        // Only include dates from 2023 onwards
        if (date.getFullYear() < 2023) continue;

        // Get context around the match (100 chars before and after)
        const idx     = m.index || 0;
        const context = content.slice(Math.max(0, idx-100), idx+m[0].length+100);
        if (!keywords.test(context)) continue;

        const daysLeft = Math.ceil((date - now) / 86400000);
        const text = context.replace(/\n/g,' ').trim().slice(0, 120);

        // Avoid duplicates
        if (!found.find(f => f.dateStr === date.toDateString() && f.pageUrl === pageUrl)) {
          found.push({
            text, pageTitle, pageUrl,
            date: date.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}),
            dateStr: date.toDateString(),
            dateObj: date,
            daysLeft
          });
        }
      }
    }
    return found;
  }

  // ── Smart fetch with fallback ──
  async smartFetch(url) {
    if (this.isGDrive(url) || this.isOneDrive(url)) {
      const content = await this.fetchJina(this.isGDrive(url) ? this.gDriveUrl(url) : url, 20000);
      return { content, type: 'gdrive', ocrUsed: false };
    }
    const content = await this.fetchJina(url);
    const scanned = this.isPdf(url) && content.length < 400;
    if (scanned && el('opt-ocr')?.checked) {
      const ocr = await this.ocrPdf(url);
      if (ocr?.length > 100) return { content: ocr, type: 'pdf', ocrUsed: true };
    }
    return { content, type: this.isPdf(url) ? 'pdf' : this.isDoc(url) ? 'doc' : 'page', ocrUsed: false };
  }

  // ── Extract title ──
  extractTitle(content, url) {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines.slice(0, 10)) {
      if (l.startsWith('# '))  return l.slice(2).trim();
      if (l.startsWith('## ')) return l.slice(3).trim();
    }
    const m = content.match(/(?:Title:|title:)\s*(.+)/);
    if (m) return m[1].trim().slice(0, 80);
    try {
      const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Home';
      return slug.replace(/[-_.]/g,' ').replace(/\.\w+$/,'').replace(/\b\w/g,c=>c.toUpperCase()) || 'Page';
    } catch { return 'Page'; }
  }

  // ── Extract links ──
  extractLinks(content) {
    const found = new Set();
    for (const m of content.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g))
      found.add(m[2].split('#')[0].replace(/[.,;!?]+$/,''));
    for (const m of content.matchAll(/https?:\/\/[^\s\)\]"'<>,]+/g))
      found.add(m[0].split('#')[0].replace(/[.,;!?]+$/,''));
    return [...found].filter(url => {
      if (this.isSkippable(url) || this.isMedia(url)) return false;
      if (this.isPdf(url) || this.isDoc(url))
        return el('opt-crossdomain')?.checked !== false;
      if (this.isGDrive(url) || this.isOneDrive(url))
        return el('opt-gdrive')?.checked !== false;
      try { return new URL(url).hostname === this.baseHost; } catch { return false; }
    });
  }

  // ── Sitemap ──
  async loadSitemap() {
    for (const u of [this.baseUrl+'/sitemap.xml',this.baseUrl+'/sitemap_index.xml']) {
      try {
        const content = await this.fetchJina(u, 8000);
        const urls = [];
        for (const m of content.matchAll(/https?:\/\/[^\s<>"'\]]+/g)) {
          const u2 = m[0].replace(/[.,<>]+$/,'');
          if (!this.isSkippable(u2) && !this.isMedia(u2)) urls.push(u2);
        }
        if (urls.length > 3) return urls;
      } catch {}
    }
    return [];
  }

  // ══ MAIN CRAWL ══
  async crawl(url, { maxPages=50, onProgress=()=>{}, onComplete=()=>{} }={}) {
    if (!url.startsWith('http')) url = 'https://'+url;
    try { url = new URL(url).origin + new URL(url).pathname; } catch { throw new Error('Invalid URL'); }
    if (url.endsWith('/')) url = url.slice(0,-1);

    this.baseUrl  = url;
    this.baseHost = new URL(url).hostname;
    this.pages.clear();
    this.images   = [];
    this.deadlines= [];
    this.visited.clear();
    this.queue    = [];
    this.running  = true;

    onProgress({ phase:'start' });
    this.queue.push({ url, priority:10 });

    onProgress({ phase:'log', msg:'Checking sitemap...', cls:'fetching' });
    const sitemapUrls = await this.loadSitemap();
    if (sitemapUrls.length > 0) {
      onProgress({ phase:'log', msg:`Sitemap: ${sitemapUrls.length} URLs found`, cls:'done' });
      for (const u of sitemapUrls.slice(0,100))
        this.queue.push({ url:u, priority: this.isPdf(u)?9:4 });
    }
    this._sort();

    while (this.queue.length > 0 && this.pages.size < maxPages && this.running) {
      const { url:pageUrl } = this.queue.shift();
      if (this.visited.has(pageUrl)) continue;
      this.visited.add(pageUrl);

      const shortUrl = this._short(pageUrl);
      onProgress({ phase:'fetching', url:pageUrl, shortUrl, indexed:this.pages.size });

      try {
        const { content, type, ocrUsed } = await this.smartFetch(pageUrl);
        if (!content || content.length < 60) { await delay(400); continue; }

        const title   = this.extractTitle(content, pageUrl);
        const cleaned = content.replace(/!\[.*?\]\(.*?\)/g,'').trim().slice(0,15000);
        const finalType = (this.isGDrive(pageUrl)||this.isOneDrive(pageUrl)) ? 'gdrive' : type;

        this.pages.set(pageUrl, {
          url:pageUrl, title, type:finalType,
          content:cleaned, chars:cleaned.length,
          ocrUsed, timestamp:Date.now()
        });

        // Extract images
        if (el('opt-images')?.checked) {
          const imgs = this.extractImages(content, pageUrl, title);
          this.images.push(...imgs);
          if (imgs.length > 0)
            onProgress({ phase:'images', count:this.images.length, newImgs:imgs });
        }

        // Extract deadlines
        const dls = this.extractDeadlines(content, title, pageUrl);
        this.deadlines.push(...dls);
        if (dls.length > 0)
          onProgress({ phase:'deadlines', deadlines:this.deadlines });

        onProgress({ phase:'indexed', url:pageUrl, title, type:finalType, ocrUsed, indexed:this.pages.size });

        // Queue links
        if ((type==='page'||type==='gdrive') && this.pages.size < maxPages) {
          for (const link of this.extractLinks(content)) {
            if (!this.visited.has(link) && !this.queue.find(q=>q.url===link)) {
              this.queue.push({ url:link, priority: this.isPdf(link)?9:this.isGDrive(link)?7:3 });
            }
          }
          this._sort();
        }
        await delay(700);
      } catch(e) {
        onProgress({ phase:'error', url:pageUrl, msg:e.message });
        await delay(300);
      }
    }

    // Sort deadlines by date
    this.deadlines.sort((a,b) => a.dateObj - b.dateObj);

    this.running = false;
    onComplete(this.pages);
  }

  stop() { this.running = false; }
  _sort() { this.queue.sort((a,b) => b.priority-a.priority); }
  _short(url) {
    try { return (new URL(url).pathname+(new URL(url).search)).slice(0,50)||'/'; }
    catch { return url.slice(0,50); }
  }

  // ── Manual import ──
  addManual(title, content, sourceUrl='') {
    const key = 'manual:'+Date.now();
    this.pages.set(key, {
      url: sourceUrl||key, title, type:'manual',
      content: content.slice(0,15000), chars:content.length,
      ocrUsed:false, timestamp:Date.now()
    });
    return key;
  }

  // ── Search ──
  search(query, topK=5) {
    const words = query.toLowerCase().split(/\s+/).filter(w=>w.length>2);
    if (!words.length || !this.pages.size) return [];
    const results = [];
    for (const [,page] of this.pages) {
      const hay = (page.title+' '+page.content).toLowerCase();
      let score = 0;
      for (const w of words) {
        score += (hay.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length;
        if (page.title.toLowerCase().includes(w)) score += 15;
      }
      if (page.type==='pdf'||page.ocrUsed) score += 3;
      if (page.type==='manual') score += 5;
      if (score>0) results.push({...page, score});
    }
    return results.sort((a,b)=>b.score-a.score).slice(0,topK);
  }

  // ── Find relevant images for a query ──
  searchImages(query, limit=4) {
    if (!this.images.length) return [];
    const words = query.toLowerCase().split(/\s+/).filter(w=>w.length>2);
    return this.images
      .filter(img => {
        const hay = (img.alt+' '+img.pageTitle).toLowerCase();
        return words.some(w => hay.includes(w));
      })
      .slice(0, limit);
  }

  buildContext(query) {
    const hits = this.search(query);
    if (!hits.length) return { context:'', sources:[] };
    const parts = hits.map(p => {
      const tag = p.ocrUsed ? '[OCR-extracted from scanned PDF]' :
                  p.type==='manual' ? '[Manually imported]' :
                  p.type==='gdrive' ? '[Google Drive file]' :
                  p.type==='pdf' ? '[PDF document]' : '[Web page]';
      return `=== ${tag}: ${p.title} ===\nSource: ${p.url}\n\n${p.content}`;
    });
    return {
      context: parts.join('\n\n---\n\n'),
      sources: hits.map(p => ({
        title: p.title.slice(0,50), url: p.url,
        type: p.ocrUsed ? 'ocr' : p.type
      }))
    };
  }

  stats() {
    let pages=0,pdfs=0,manual=0,gdrive=0,ocr=0;
    for (const p of this.pages.values()) {
      if (p.type==='manual') manual++;
      else if (p.type==='gdrive') gdrive++;
      else if (p.type==='pdf'||p.type==='doc') { pdfs++; if (p.ocrUsed) ocr++; }
      else pages++;
    }
    return { total:this.pages.size, pages, pdfs, manual, gdrive, ocr, images:this.images.length };
  }
}

function delay(ms) { return new Promise(r=>setTimeout(r,ms)); }
function el(id) { return document.getElementById(id); }
window.crawler = new CollegeCrawler();
