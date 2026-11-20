/* ============================================================
   顶栏音符图标 → 迷你播放器(Apple Music 30 秒试听)
   控件本体来自 ~/projects/迷你播放器/Apple试听版.html 的最终版。
   这里只做两件事:①第一次点图标时才建 DOM / 拉 iTunes 数据(懒加载)
                    ②把卡片定位在图标正下方,点外面 / Esc 关闭
   ============================================================ */
(function () {
  'use strict';

  var CARD = `  <div class="card" id="card">
    <div class="art-col">
      <div class="art" id="artBox" tabindex="0" role="link" title="点击打开 YouTube 视频">
      <img id="coverImg" alt="" hidden>
      <div class="cover" id="cover">载入中…</div>
      </div>
      <a class="badge" href="https://music.apple.com/cn/album/the-bigger-picture-ep/1669321650" target="_blank" rel="noopener noreferrer" aria-label="在 Apple Music 打开这张专辑"><img id="badgeImg" alt="" src="/img/apple-badge-light.png"></a>
    </div>

    <div class="col">
      <div class="row-title">
        <h1 class="title" data-music="title">The Bigger Picture EP</h1>
        <div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="sub">
        <span class="album" data-music="album">The Bigger Picture - EP</span>
      </div>
      <div class="artist-line">
        <span class="artist" data-music="artist">Blue Wednesday</span>
        <span class="artist-sep" aria-hidden="true">·</span>
        <span id="loopTag">30 秒试听</span>
      </div>

      <div class="controls">
        <button data-music="back" id="backBtn" aria-label="上一首" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M13.2 6.6v10.8L3.3 12z"/><path d="M22.2 6.6v10.8L12.3 12z"/></g></svg>
        </button>
        <button data-music="play" id="playBtn" class="big" aria-label="播放" disabled>
          <svg class="ico-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 3.7v16.6L21.3 12z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
          <svg class="ico-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.4" y="4.2" width="4.2" height="15.6" rx="1.7"/><rect x="13.4" y="4.2" width="4.2" height="15.6" rx="1.7"/></svg>
        </button>
        <button data-music="forward" id="nextBtn" aria-label="下一首" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M10.8 6.6v10.8L20.7 12z"/><path d="M1.8 6.6v10.8L11.7 12z"/></g></svg>
        </button>
      </div>

      <div class="playhead" id="playhead" aria-hidden="true">
        <div class="inner" id="inner"></div>
      </div>

      <div class="times">
        <span data-music="elapsed">00:00</span>
        <span data-music="remaining">-00:00</span>
      </div>
    </div>
  </div>`;

  var pop = null, started = false, open = false, trigger = null;

  function startPlayer() {
    'use strict';
    const $ = (s, r = pop) => r.querySelector(s);
    const STUB = { textContent: '' };   // 时间行/提示行已删,写入时走空壳
    const el = {
      html: document.documentElement,
      card: $('#card'),
      coverImg: $('#coverImg'),
      cover: $('#cover'),
      artBox: $('#artBox'),
      title: $('[data-music="title"]'),
      artist: $('[data-music="artist"]'),
      album: $('[data-music="album"]'),
      loopTag: $('#loopTag'),
      play: $('#playBtn'),
      back: $('#backBtn'),
      forward: $('#nextBtn'),
      playhead: $('#playhead'),
      inner: $('#inner'),
      elapsed: $('[data-music="elapsed"]') || STUB,
      remaining: $('[data-music="remaining"]') || STUB,
      hintMsg: $('#hintMsg') || STUB,
      audio: $('#audio'),
      badgeImg: $('#badgeImg'),
    };

    const VIDEO_URL = 'https://www.youtube.com/watch?v=7IjikRSGvAU';
    const ALBUM_ID  = '1669321650';
    const STORE     = 'us';
    const BADGE_LIGHT = '/img/apple-badge-light.png';
    const BADGE_DARK  = '/img/apple-badge-dark.png';
    const DEFAULT_MSG = 'Apple Music 30 秒在线试听';

    const state = { list: [], idx: 0, playing: false, ready: false };
    const NO_EQ = new URLSearchParams(location.search).has('noeq');   // ?noeq=1 → 不走 WebAudio，用来对比排查
    const blobCache = new Map();      // url -> objectURL
    const blobPending = new Map();

    /* ---------- 工具 ---------- */
    const fmt = s => {
      if (!isFinite(s) || s < 0) s = 0;
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    };
    function setHint(text, sticky) {
      const msg = text || DEFAULT_MSG;
      if (el.hintMsg.textContent === msg) return;
      el.hintMsg.textContent = msg;
    }
    // 徽标跟着弹层底色走:浅色玻璃(浅色主题)上必须用深色字标,否则看不清
    const isLightTheme = () => document.documentElement.getAttribute('data-theme') === 'light';
    let lastArt = '';
    function setBadgeTone(src) {
      lastArt = src || lastArt;
      const light = isLightTheme();
      el.badgeImg.src = light ? BADGE_DARK : BADGE_LIGHT;
      const im = new Image();
      im.crossOrigin = 'anonymous';   // 不开 CORS,canvas 被污染就读不到像素(封面主机返回 *)
      im.onload = () => {
        try {
          const cv = document.createElement('canvas'); cv.width = cv.height = 8;
          const g = cv.getContext('2d'); g.drawImage(im, 0, 0, 8, 8);
          const d = g.getImageData(0, 0, 8, 8).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (!light) el.badgeImg.src = (sum / (d.length / 4) > 130) ? BADGE_DARK : BADGE_LIGHT;
          applyTint(d);
        } catch (e) { /* 读不到像素就保持默认中性玻璃 */ }
      };
      im.src = src;
    }

    // 从封面里取主色,写成 --mp-tint-rgb,毛玻璃底层铺这层强调色
    function applyTint(d) {
      const buckets = {}; let best = null;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 160) continue;
        const k = (d[i] >> 5) + ',' + (d[i + 1] >> 5) + ',' + (d[i + 2] >> 5);
        const b = buckets[k] || (buckets[k] = { n: 0, r: 0, g: 0, b: 0 });
        b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
        if (!best || b.n > best.n) best = b;
      }
      if (!best || !pop) return;
      let r = best.r / best.n, g = best.g / best.n, bl = best.b / best.n;
      const avg = (r + g + bl) / 3, boost = 1.4;    // 提饱和,偏灰的封面也能透出颜色
      r  = Math.max(0, avg + (r  - avg) * boost);
      g  = Math.max(0, avg + (g  - avg) * boost);
      bl = Math.max(0, avg + (bl - avg) * boost);
      // 再按最亮通道归一化:封面主色偏黑时按比例提亮,否则叠上去等于没有
      const k = 190 / Math.max(r, g, bl, 1);
      r = Math.min(255, r * k); g = Math.min(255, g * k); bl = Math.min(255, bl * k);
      document.documentElement.style.setProperty('--mp-tint-rgb', (r | 0) + ', ' + (g | 0) + ', ' + (bl | 0));
    }
    function paintButtons() {
      const has = state.list.length > 0;
      el.play.disabled = !has;
      el.back.disabled = !has;
      el.forward.disabled = !has;
      el.html.dataset.isPlaying = state.playing ? 'true' : 'false';
      el.play.setAttribute('aria-label', state.playing ? '暂停' : '播放');
    }

    /* ---------- 音轨 ---------- */
    function setTrack(i, autoplay) {
      if (!state.list.length) return;
      state.idx = (i + state.list.length) % state.list.length;
      const t = state.list[state.idx];
      el.title.textContent = t.name;
      el.album.textContent = t.album || '';
      el.artist.textContent = t.artist;
      el.audio.src = blobCache.get(t.url) || t.url;   // 已缓存的直接用本地 blob，否则先流式播、后台补缓存
      prefetchAudio(t.url);
      prefetchAudio((state.list[(state.idx + 1) % state.list.length] || {}).url);
      el.coverImg.src = t.art;
      el.coverImg.hidden = false;
      el.cover.classList.add('is-hidden');
      pop.style.setProperty('--art-url', 'url("' + t.art + '")');
      pop.setAttribute('data-has-art', 'true');
      setBadgeTone(t.art);
      el.inner.style.transform = 'translateX(-100%)';
      el.elapsed.textContent = '00:00';
      el.remaining.textContent = '-00:30';
      paintButtons();
      if (autoplay) play();
    }
    // 把 30 秒试听整段下到内存（约 700KB），之后播放不再碰网络，避免流式缓冲造成的爆音/卡顿
    function prefetchAudio(url) {
      if (!url || blobCache.has(url) || blobPending.has(url)) return;
      blobPending.set(url, true);
      fetch(url, { cache: 'force-cache' })
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('http ' + r.status)))
        .then(buf => {
          blobCache.set(url, URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' })));
          // 不做播放中切换（换 src 会跳位），缓存留给这首的下次播放和已预取的下一首
        })
        .catch(() => {})            // 取不到就继续用流式，不影响播放
        .finally(() => blobPending.delete(url));
    }
    function play() {
      if (!state.list.length) return;
      ensureAudioGraph();
      const p = el.audio.play();
      if (p && p.catch) p.catch((err) => {
        const name = (err && err.name) || '';
        if (name === 'AbortError') return;                        // 连点 / 切歌打断，属于正常
        if (name === 'NotAllowedError') { setHint('浏览器拦了自动播放，点一下中间的大按钮'); return; }
        setHint('播放失败了，再点一次试试');
      });
    }
    function pause() {
      const a = el.audio;
      if (!ac || !gainNode) { a.pause(); return; }
      const tok = ++playToken;
      fadeTo(0, 0.025);
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => { if (tok === playToken) a.pause(); }, 30);
    }
    function fadeTo(v, sec) {
      if (!ac || !gainNode) return;
      const t = ac.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setValueAtTime(gainNode.gain.value, t);
        gainNode.gain.linearRampToValueAtTime(v, t + sec);
      } catch (e) {}
    }
    function fadeIn() {
      playToken++;
      if (ac && ac.state === 'suspended') ac.resume();
      fadeTo(1, 0.06);
    }
    function toggle() { if (el.audio.paused) play(); else pause(); }

    /* ---------- 播放器事件 ---------- */
    el.audio.addEventListener('play',  () => { state.playing = true;  paintButtons(); eqStart(); anchorClock(); progStart(); });
    el.audio.addEventListener('pause', () => { state.playing = false; paintButtons(); eqStop(); progStop(); });
    el.audio.addEventListener('loadedmetadata', () => {
      el.remaining.textContent = '-' + fmt(el.audio.duration);
    });
    // 用 performance.now() 外推播放位置：audio.currentTime 更新粒度粗，直接读会一格一格跳
    let anchorT = 0, anchorAt = 0, clockRunning = false;
    function anchorClock() { anchorT = el.audio.currentTime || 0; anchorAt = performance.now(); }
    function clockNow() {
      const a = el.audio;
      if (a.paused || !a.duration) return a.currentTime || 0;
      if (!clockRunning) return a.currentTime;          // 还没真正出声，别外推
      const rate = a.playbackRate || 1;
      const est = anchorT + (performance.now() - anchorAt) / 1000 * rate;
      const err = est - a.currentTime;
      if (Math.abs(err) > 0.30) { anchorClock(); return a.currentTime; }   // seek / 卡顿：直接重钉
      anchorT -= err * 0.12;                                              // 小漂移：每帧修 12%，看不见跳变
      return Math.min(a.duration, Math.max(0, anchorT + (performance.now() - anchorAt) / 1000 * rate));
    }
    function paintProgress() {
      const a = el.audio;
      if (!a.duration) return;
      const t = clockNow();
      el.inner.style.transform = 'translateX(' + ((t / a.duration - 1) * 100).toFixed(3) + '%)';
      el.elapsed.textContent = fmt(Math.floor(t));
      el.remaining.textContent = '-' + fmt(Math.ceil(Math.max(0, a.duration - t)));
    }
    let progRAF = 0;
    function progTick() { paintProgress(); progRAF = requestAnimationFrame(progTick); }
    function progStart() { if (!progRAF) progRAF = requestAnimationFrame(progTick); }
    function progStop()  { if (progRAF) { cancelAnimationFrame(progRAF); progRAF = 0; } paintProgress(); }

    el.audio.addEventListener('playing', () => {
      clockRunning = true; anchorClock(); paintProgress(); setHint('');
      fadeIn();                       // 起播 60ms 淡入，避免那一瞬间的爆音
    });
    el.audio.addEventListener('pause', () => {
      clockRunning = false;
      el.playhead.classList.add('is-paused');   // 暂停后残留的亚像素误差用短过渡收掉
      setTimeout(() => { paintProgress(); el.playhead.classList.remove('is-paused'); }, 180);
      paintProgress();
    });
    el.audio.addEventListener('waiting', () => { clockRunning = false; });
    el.audio.addEventListener('seeking', () => { clockRunning = false; });
    el.audio.addEventListener('emptied', () => { clockRunning = false; });
    el.audio.addEventListener('timeupdate', paintProgress);
    el.audio.addEventListener('seeked', () => {
      anchorClock();
      if (!el.audio.paused) clockRunning = true;
      paintProgress();
    });
    el.audio.addEventListener('loadedmetadata', anchorClock);
    el.audio.addEventListener('ended', () => { progStop(); setTrack(state.idx + 1, true); });
    el.audio.addEventListener('error', () => setHint('这首试听拉不下来，换下一首试试'));

    /* ---------- 控件 ---------- */
    el.play.addEventListener('click', toggle);
    el.back.addEventListener('click', () => setTrack(state.idx - 1, !el.audio.paused));
    el.forward.addEventListener('click', () => setTrack(state.idx + 1, !el.audio.paused));

    el.artBox.addEventListener('click', () => window.open(VIDEO_URL, '_blank', 'noopener'));
    el.artBox.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); window.open(VIDEO_URL, '_blank', 'noopener');
    });

    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!pop.classList.contains('is-open')) return;      // 弹层没开时不要劫持全站空格键
      if (e.key === ' ')  { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); el.audio.volume = Math.min(1, el.audio.volume + 0.05); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); el.audio.volume = Math.max(0, el.audio.volume - 0.05); }
    });

    /* ---------- 实时声纹（Web Audio Analyser）---------- */
    const eqEl = $('.eq');
    const eqBars = [...pop.querySelectorAll('.eq i')];
    const BANDS = [[1, 2], [2, 4], [4, 8], [8, 16], [16, 40]];   // 倍频程分段，相邻段互相独立得多
    const GAIN  = [1.0, 1.0, 1.05, 1.15, 1.5];
    const peaks = [40, 60, 40, 24, 12];   // 各频段峰值保持（缓慢衰减）
    const floors = [6, 12, 8, 4, 2];      // 各频段底噪，做对比度拉伸用
    const cur = [0.12, 0.12, 0.12, 0.12, 0.12];   // 显示值
    const tgt = [0.12, 0.12, 0.12, 0.12, 0.12];   // 平滑后的目标值
    const T_SMOOTH = 0.30;                        // 目标平滑（去掉 FFT 抖动）
    const ATTACK = 0.22, RELEASE = 0.09;          // 弹簧跟随系数（每帧 60fps）
    let ac = null, analyser = null, freq = null, eqRAF = 0, gainNode = null, fadeTimer = 0, playToken = 0;

    function ensureAudioGraph() {
      if (NO_EQ) return false;      // 调试开关：绕过 WebAudio，走系统直出
      if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        ac = new AC();
        const src = ac.createMediaElementSource(el.audio);
        analyser = ac.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -85;
        analyser.maxDecibels = -15;
        analyser.smoothingTimeConstant = 0.55;
        gainNode = ac.createGain();
        gainNode.gain.value = 1;
        window.__analyser = analyser; window.__ac = ac; window.__gain = gainNode;   // 调试用
        src.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(ac.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        if (ac.state === 'suspended') ac.resume();
        return true;
      } catch (e) { ac = null; analyser = null; return false; }
    }

    function eqIdle() {
      for (let i = 0; i < cur.length; i++) { cur[i] = 0.10; tgt[i] = 0.10; }
      eqEl.classList.add('is-idle');                    // 先切慢速过渡，再落到静止高度
      requestAnimationFrame(() => eqBars.forEach(b => b.style.setProperty('--h', '0.10')));
    }
    function eqTick() {
      if (!analyser) { eqRAF = 0; return; }
      analyser.getByteFrequencyData(freq);
      for (let b = 0; b < BANDS.length; b++) {
        const [s0, e0] = BANDS[b];
        let sum = 0, n = 0;
        for (let i = s0; i < e0 && i < freq.length; i++) { sum += freq[i]; n++; }
        const v = n ? sum / n : 0;
        // 每段各自做自适应拉伸：峰值慢降、底噪慢升，把信号铺满 0..1，五根才会各跳各的
        peaks[b]  = Math.max(v, peaks[b]  * 0.995, floors[b] + 6);
        floors[b] = Math.min(v, floors[b] * 0.997 + 0.15 * (peaks[b] - floors[b]) * 0.02 + 0.05, peaks[b] - 2);
        const ratio = (v - floors[b]) / Math.max(4, peaks[b] - floors[b]);
        const raw = 0.10 + Math.pow(Math.min(1, Math.max(0, ratio * GAIN[b])), 1.1) * 0.90;
        tgt[b] += (raw - tgt[b]) * T_SMOOTH;          // 先抹平原始数据的毛刺
        const k = tgt[b] > cur[b] ? ATTACK : RELEASE;  // 冲得快、落得慢
        cur[b] += (tgt[b] - cur[b]) * k;
        eqBars[b].style.setProperty('--h', cur[b].toFixed(4));
      }
      eqRAF = requestAnimationFrame(eqTick);
    }
    function eqStart() {
      if (!ensureAudioGraph()) { eqEl.classList.remove('is-live'); return; }  // 兜底：退回 CSS 动画
      eqEl.classList.add('is-live');
      eqEl.classList.remove('is-idle');                 // 回到跟手速度
      if (!eqRAF) eqRAF = requestAnimationFrame(eqTick);
    }
    function eqStop() {
      if (eqRAF) { cancelAnimationFrame(eqRAF); eqRAF = 0; }
      eqIdle();
    }
    eqEl.classList.add('is-live');   // 先停掉固定动画,等真正播放再驱动
    eqIdle();

    // 切换深浅主题时重算徽标配色
    new MutationObserver(() => { if (lastArt) setBadgeTone(lastArt); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ---------- 启动：拉 Apple 的试听 ---------- */
    (async function boot() {
      el.title.textContent = '载入中…';
      el.album.textContent = 'The Bigger Picture - EP';
      el.artist.textContent = 'Blue Wednesday';
      el.cover.textContent = '载入中…';
      setHint('正在拉取 Apple Music 试听…', true);
      try {
        const res = await fetch('https://itunes.apple.com/lookup?id=' + ALBUM_ID + '&entity=song&country=' + STORE);
        const data = await res.json();
        state.list = (data.results || [])
          .filter(r => r.wrapperType === 'track' && r.previewUrl)
          .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0))
          .map(r => ({
            name: r.trackName,
            artist: r.artistName,
            album: (r.collectionName || '').trim(),
            url: r.previewUrl,
            art: String(r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
          }));
        if (!state.list.length) { setHint('没拿到试听数据（可能是网络/代理问题）', true); return; }
        setTrack(0, false);
        setHint('');
        el.loopTag.textContent = '30 秒试听 · ' + state.list.length + ' 首';
      } catch (err) {
        setHint('连不上 Apple 的接口：检查代理或网络', true);
        el.title.textContent = '载入失败';
        el.artist.textContent = '重开一次试试';
      }
    })();
  }

  /* ---------- 弹层:建 DOM / 定位 / 开关 ---------- */
  function build() {
    pop = document.createElement('div');
    pop.className = 'mp-pop';
    pop.id = 'notePlayer';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '迷你播放器');
    pop.innerHTML = CARD + '<audio id="audio" preload="auto" crossorigin="anonymous"></audio>';
    document.body.appendChild(pop);
  }

  function place() {
    if (!pop || !trigger) return;
    var r = trigger.getBoundingClientRect();
    var vw = window.innerWidth;
    var hd = document.querySelector('.header') || document.querySelector('header');
    var pad = hd ? (parseFloat(getComputedStyle(hd).paddingLeft) || 16) : 16;
    // 手机端:卡片宽度取导航栏内容宽度(视口 - 左右 padding),左右两侧和导航栏齐平
    if (vw <= 684) {
      var mw = Math.max(240, vw - pad * 2);
      pop.style.setProperty('--mp-zoom', (mw / 500).toFixed(4));
      pop.style.top = Math.round(r.bottom + 8) + 'px';
      pop.style.right = Math.round(pad) + 'px';
      return;
    }
    var w = pop.offsetWidth || 0;
    var icons = document.querySelector('.header__right');
    var anchor = icons ? icons.getBoundingClientRect().right : r.right;   // 对齐图标组右缘
    var right = vw - anchor;
    var maxRight = vw - w - 12;
    if (right > maxRight) right = maxRight;
    if (right < 12) right = 12;
    pop.style.top = Math.round(r.bottom + 10) + 'px';
    pop.style.right = Math.round(right) + 'px';
  }

  function openPop() {
    if (!started) { build(); startPlayer(); started = true; }
    open = true;
    pop.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    place();
  }

  function closePop() {
    if (!pop || !open) return;
    open = false;
    pop.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    // 关闭弹层不停播放:音乐继续放,再点开还是同一个状态
  }

  function togglePop() { open ? closePop() : openPop(); }

  function wire() {
    trigger = document.querySelector('.header-note');
    if (!trigger) return;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', '打开音乐播放器');
    trigger.addEventListener('click', function (e) { e.preventDefault(); togglePop(); });
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePop(); }
    });
    document.addEventListener('click', function (e) {
      if (!open) return;
      if (pop && pop.contains(e.target)) return;
      if (trigger.contains(e.target)) return;
      closePop();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) closePop();
    });
    window.addEventListener('resize', function () { syncMenuPos(); if (open) place(); });
    syncMenuPos();
    wireNav();
  }

  /* ---------- 站内跳转改成局部替换,音乐不中断 ----------
     静态站每次点链接都是整页重载,<audio> 会被销毁 → 播放停掉。
     这里拦住站内链接,fetch 新页面后只把 .container 里的内容换掉:
     header(菜单/主题切换的绑定)和 body 上的播放器都原地保留,
     音频元素没有被销毁,所以可以一直播。 */
  var navIdx = (history.state && typeof history.state.idx === 'number') ? history.state.idx : 0;
  var navMax = navIdx;   // 本次加载最多走到第几层,用来判断「前进」能不能点

  function paintArrows() {
    var b = document.querySelector('.nav-back'), f = document.querySelector('.nav-fwd');
    if (b) b.classList.toggle('is-off', navIdx <= 0);
    if (f) f.classList.toggle('is-off', navIdx >= navMax);
  }

  function wireArrows() {
    var b = document.querySelector('.nav-back'), f = document.querySelector('.nav-fwd');
    function act(el, can, run) {
      if (!el) return;
      el.addEventListener('click', function () { if (can()) run(); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (can()) run(); }
      });
    }
    act(b, function () { return navIdx > 0; }, function () { history.back(); });
    act(f, function () { return navIdx < navMax; }, function () { history.forward(); });
    paintArrows();
  }

  function isInternalLink(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(href)) return false;
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    return true;
  }

  function swapInto(doc) {
    var oldC = document.querySelector('.container');
    var newC = doc.querySelector('.container');
    if (!oldC || !newC) return false;
    var header = oldC.querySelector(':scope > header');
    if (!header) return false;
    while (oldC.firstChild) oldC.removeChild(oldC.firstChild);
    oldC.appendChild(header);          // 顶栏原地保留,菜单/主题切换不用重建
    Array.prototype.slice.call(newC.children).forEach(function (el) {   // 先拍快照:搬走节点会让 live HTMLCollection 收缩
      var tag = el.tagName.toLowerCase();
      if (tag === 'header' || tag === 'script' || tag === 'style') return;
      oldC.appendChild(el);
    });
    document.body.className = doc.body.className;   // 首页 body.home 这类类名要跟着换
    return true;
  }

  function pjaxGo(href, push, hash) {
    fetch(href, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!swapInto(doc)) throw new Error('no container');
        document.title = doc.title || document.title;
        if (push) {
          navIdx++;
          if (navIdx > navMax) navMax = navIdx;
          history.pushState({ pjax: 1, idx: navIdx }, '', href);
          paintArrows();
        }
        if (hash) {
          var t = document.getElementById(hash.slice(1));
          if (t) { t.scrollIntoView(); return; }
        }
        window.scrollTo(0, 0);
        if (window.Prism && window.Prism.highlightAll) { try { Prism.highlightAll(); } catch (e) {} }
      })
      .catch(function () { location.href = href; });   // 出错就退回整页跳转
  }

  function wireNav() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a') : null;
        if (!isInternalLink(a)) return;
        var u = new URL(a.href, location.href);
        if (u.pathname === location.pathname && u.search === location.search) {
          // 点的是当前这一页(比如在首页点左上角 logo):浏览器会整页重载把音乐打断,
          // 这里改成不重载,只回顶部 / 滚到锚点
          e.preventDefault();
          if (u.hash) {
            var t = document.getElementById(u.hash.slice(1));
            if (t) { t.scrollIntoView(); return; }
          }
          window.scrollTo(0, 0);
          return;
        }
        e.preventDefault();
        pjaxGo(a.href, true, a.hash);
    });
    window.addEventListener('popstate', function (e) {
      navIdx = (e.state && typeof e.state.idx === 'number') ? e.state.idx : 0;
      paintArrows();
      pjaxGo(location.href, false, location.hash);
    });
    wireArrows();
  }

  // 三横菜单的定位:顶线和音乐控件同一条(图标底 + 间隙),右边对齐图标组右缘
  function syncMenuPos() {
    var icons = document.querySelector('.header__right');
    var note = document.querySelector('.header-note');
    if (!icons || !note) return;
    var gap = window.innerWidth <= 684 ? 8 : 10;
    var root = document.documentElement;
    root.style.setProperty('--menu-top', Math.round(note.getBoundingClientRect().bottom + gap) + 'px');
    root.style.setProperty('--menu-right', Math.round(window.innerWidth - icons.getBoundingClientRect().right) + 'px');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
