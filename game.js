/* ============================================================
 * 五子棋游戏逻辑 + 渲染 + 交互 + 音效 + 彩带
 * 依赖 ai.js（提供 EMPTY/BLACK/WHITE/SIZE/inBoard/opp/isWinAt/getBestMove）
 * ============================================================ */
(function () {
  'use strict';

  // DOM
  const boardCanvas = document.getElementById('board');
  const ctx = boardCanvas.getContext('2d');
  const confettiCanvas = document.getElementById('confetti');
  const confettiCtx = confettiCanvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const confirmBtn = document.getElementById('confirmBtn');
  const undoBtn = document.getElementById('undoBtn');
  const restartBtn = document.getElementById('restartBtn');
  const reviewPanel = document.getElementById('reviewPanel');
  const reviewInput = document.getElementById('reviewInput');
  const loadReviewBtn = document.getElementById('loadReviewBtn');
  const reviewStep = document.getElementById('reviewStep');
  const reviewError = document.getElementById('reviewError');
  const navStartBtn = document.getElementById('navStartBtn');
  const navPrevBtn = document.getElementById('navPrevBtn');
  const navNextBtn = document.getElementById('navNextBtn');
  const navEndBtn = document.getElementById('navEndBtn');
  const resultOverlay = document.getElementById('resultOverlay');
  const resultTitle = document.getElementById('resultTitle');
  const reviewGameBtn = document.getElementById('reviewGameBtn');
  const copyReviewBtn = document.getElementById('copyReviewBtn');
  const againBtn = document.getElementById('againBtn');
  const copyHint = document.getElementById('copyHint');
  const aiComment = document.getElementById('aiComment');
  const aiCommentText = document.getElementById('aiCommentText');
  const speakBtn = document.getElementById('speakBtn');

  // 状态
  let board, mode, humanSide, current, history, over, winner, thinking;
  let selected, lastMove, touchPending, hoverCell, cursorVisible, winLine;
  let reviewMoves = [], reviewIndex = 0;
  let boardSizePx = 500; // 画布逻辑尺寸
  const LABEL_MARGIN = 0.62; // 四边坐标标注边距（占一格的比例）
  let speakEnabled = false, zhVoice = null; // 朗读开关（默认关）+ 中文语音

  /* ---------------- 初始化 ---------------- */
  function freshBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  }

  function resetState() {
    board = freshBoard();
    history = [];
    over = false;
    winner = EMPTY;
    thinking = false;
    current = BLACK;
    selected = { r: 7, c: 7 };
    lastMove = null;
    touchPending = null;
    hoverCell = null;
    cursorVisible = false;
    winLine = null;
    reviewMoves = [];
    reviewIndex = 0;
    reviewStep.textContent = '第 0 / 0 步';
    reviewError.textContent = '';
    clearAiComment();
  }

  function init() {
    mode = 'pve';
    humanSide = WHITE;
    resetState();
    bindUI();
    updateControlsVisibility();
    updateStatus();
    resizeCanvas();
    render();
    maybeTriggerAI();
  }

  /* ---------------- 状态辅助 ---------------- */
  function updateControlsVisibility() {
    const pve = mode === 'pve';
    const review = mode === 'review';
    document.getElementById('sideGroup').style.display = pve ? '' : 'none';
    reviewPanel.style.display = review ? '' : 'none';
    undoBtn.style.display = review ? 'none' : '';
    aiComment.style.display = pve ? '' : 'none';
  }

  function currentName(p) { return p === BLACK ? '黑方' : '白方'; }

  function updateStatus() {
    if (mode === 'review') {
      statusEl.textContent = '复盘模式';
      statusEl.classList.remove('turn-black', 'turn-white', 'turn-win');
      statusEl.classList.add('turn-review');
      return;
    }
    if (over) {
      statusEl.textContent = winner === EMPTY ? '平局' : currentName(winner) + '获胜！';
    } else if (mode === 'pve' && thinking) {
      statusEl.textContent = '电脑思考中…';
    } else {
      statusEl.textContent = '轮到' + currentName(current);
    }
    statusEl.classList.remove('turn-black', 'turn-white', 'turn-win', 'turn-review');
    if (!over) statusEl.classList.add(current === BLACK ? 'turn-black' : 'turn-white');
    else statusEl.classList.add('turn-win');
  }

  function canHumanMove() {
    if (mode === 'review') return false;
    if (over) return false;
    if (mode === 'pve') return !thinking && current === humanSide;
    return true; // pvp 双方随时可下
  }

  /* ---------------- 落子流程 ---------------- */
  function handlePlace(r, c) {
    if (!canHumanMove()) return;
    if (board[r][c] !== EMPTY) return;
    placeStone(r, c, current);
  }

  function placeStone(r, c, player, why, comment) {
    board[r][c] = player;
    history.push({ r, c, player, why, comment });
    lastMove = { r, c };
    playPlace(player);

    const line = findWinLine(r, c, player);
    if (line) {
      winLine = line;
      endGame(player);
      return;
    }

    // 平局（棋盘满）
    if (history.length === SIZE * SIZE) {
      endGame(EMPTY);
      return;
    }

    if (mode === 'pvp') {
      current = opp(player);
    } else {
      if (player === humanSide) {
        current = opp(player);
        thinking = true;
        updateStatus();
        render();
        setTimeout(aiMove, 260);
      } else {
        current = humanSide;
        thinking = false;
      }
    }
    updateStatus();
    render();
  }

  function endGame(wp) {
    over = true;
    winner = wp;
    thinking = false;
    touchPending = null;
    confirmBtn.style.display = 'none';
    updateStatus();
    if (mode === 'pvp' || wp === humanSide) { playWin(); launchConfetti(); }
    else { playLose(); }
    render();
    showResultOverlay(wp);
  }

  /* ---------------- AI ---------------- */
  function aiMove() {
    if (over || mode !== 'pve') return;
    const ai = opp(humanSide);
    const mv = getBestMove(board, ai, 'hard', history);
    if (mv && inBoard(mv.r, mv.c) && board[mv.r][mv.c] === EMPTY) {
      const text = showAiComment(mv, ai);
      speakAiComment(text);
      placeStone(mv.r, mv.c, ai, mv.why, text);
    } else {
      thinking = false;
      updateStatus();
      render();
    }
  }

  // 更新电脑走棋解释（气泡显隐由模式控制，见 updateControlsVisibility）
  function showAiComment(mv, ai) {
    const text = explainMove(mv, board, ai);
    aiCommentText.textContent = text;
    return text;
  }

  function clearAiComment() {
    aiCommentText.textContent = '';
  }

  // 悔棋后刷新：显示当前局面下最近一次电脑走子的解释
  function refreshAiComment() {
    if (mode !== 'pve') return;
    let lastAi = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].player === opp(humanSide)) { lastAi = history[i]; break; }
    }
    if (lastAi && lastAi.comment) aiCommentText.textContent = lastAi.comment;
    else clearAiComment();
  }

  function maybeTriggerAI() {
    if (mode === 'pve' && !over && !thinking && current === opp(humanSide)) {
      thinking = true;
      updateStatus();
      render();
      setTimeout(aiMove, 420);
    }
  }

  /* ---------------- 悔棋 / 重开 ---------------- */
  function undo() {
    if (thinking) return;
    if (mode === 'pvp') {
      if (history.length === 0) return;
      const m = history.pop();
      board[m.r][m.c] = EMPTY;
      current = m.player;
    } else {
      // 人类刚获胜时，只悔掉人类自己的获胜手（一步），不误悔电脑的黑棋
      const humanJustWon = over && winner === humanSide;
      const steps = humanJustWon ? 1 : 2;
      if (history.length < steps) return;
      for (let i = 0; i < steps; i++) {
        const m = history.pop();
        board[m.r][m.c] = EMPTY;
      }
      current = humanSide;
    }
    over = false;
    winner = EMPTY;
    winLine = null;
    touchPending = null;
    confirmBtn.style.display = 'none';
    lastMove = history.length ? history[history.length - 1] : null;
    updateStatus();
    render();
    if (mode === 'pve') refreshAiComment();
  }

  function restart() {
    resetState();
    hideResultOverlay();
    updateControlsVisibility();
    updateStatus();
    render();
    maybeTriggerAI();
  }

  /* ---------------- 胜负连线 ---------------- */
  function findWinLine(r, c, p) {
    for (const [dr, dc] of DIRS) {
      const line = [{ r, c }];
      for (let s = 1; s < 5; s++) { const nr = r + dr * s, nc = c + dc * s; if (!inBoard(nr, nc) || board[nr][nc] !== p) break; line.push({ r: nr, c: nc }); }
      for (let s = 1; s < 5; s++) { const nr = r - dr * s, nc = c - dc * s; if (!inBoard(nr, nc) || board[nr][nc] !== p) break; line.push({ r: nr, c: nc }); }
      if (line.length >= 5) return line;
    }
    return null;
  }

  /* ---------------- 渲染 ---------------- */
  function resizeCanvas() {
    const wrap = boardCanvas.parentElement;
    const size = Math.max(280, Math.min(wrap.clientWidth, 560));
    const dpr = window.devicePixelRatio || 1;
    boardSizePx = size;
    boardCanvas.style.width = size + 'px';
    boardCanvas.style.height = size + 'px';
    boardCanvas.width = Math.round(size * dpr);
    boardCanvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function cellCenter(r, c) {
    const cell = boardSizePx / (SIZE - 1 + 2 * LABEL_MARGIN);
    const origin = LABEL_MARGIN * cell;
    return { x: origin + c * cell, y: origin + r * cell, cell };
  }

  function cellFromPoint(px, py) {
    const cell = boardSizePx / (SIZE - 1 + 2 * LABEL_MARGIN);
    const origin = LABEL_MARGIN * cell;
    const c = Math.round((px - origin) / cell);
    const r = Math.round((py - origin) / cell);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return { r, c };
  }

  function drawStone(r, c, p, cell, glow) {
    const { x, y } = cellCenter(r, c);
    const rad = cell * 0.42;
    ctx.save();
    if (glow) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6; }
    const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.15, x, y, rad);
    if (p === BLACK) {
      g.addColorStop(0, '#5a5a5a');
      g.addColorStop(0.6, '#1a1a1a');
      g.addColorStop(1, '#000000');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#e8e8e8');
      g.addColorStop(1, '#c0c0c0');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (p === WHITE) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function render() {
    const px = boardSizePx;
    const cell = px / (SIZE - 1 + 2 * LABEL_MARGIN);
    const origin = LABEL_MARGIN * cell;
    ctx.clearRect(0, 0, px, px);

    // 木纹底
    const bg = ctx.createLinearGradient(0, 0, px, px);
    bg.addColorStop(0, '#e3b877');
    bg.addColorStop(1, '#c9924a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < 18; i++) { // 淡淡木纹
      ctx.strokeStyle = 'rgba(120,70,20,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const yy = (i / 18) * px;
      ctx.moveTo(0, yy); ctx.lineTo(px, yy + 8); ctx.stroke();
    }

    // 网格线
    ctx.strokeStyle = 'rgba(70,40,15,0.75)';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const d = origin + i * cell;
      ctx.beginPath(); ctx.moveTo(d, origin); ctx.lineTo(d, origin + (SIZE - 1) * cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(origin, d); ctx.lineTo(origin + (SIZE - 1) * cell, d); ctx.stroke();
    }
    // 边框加粗
    ctx.lineWidth = 2;
    ctx.strokeRect(origin, origin, (SIZE - 1) * cell, (SIZE - 1) * cell);

    // 四边坐标标注（交错显示，避免过密）：
    // 底轴 A C E…（偶数列），顶轴 B D F…（奇数列）
    // 左轴 2 4 6…（偶数行），右轴 1 3 5…（奇数行）
    ctx.fillStyle = 'rgba(90,55,20,0.85)';
    ctx.font = '600 ' + Math.round(cell * 0.5) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lo = origin * 0.55;
    for (let c = 0; c < SIZE; c++) {
      const x = origin + c * cell;
      const ch = String.fromCharCode(65 + c);
      if (c % 2 === 0) ctx.fillText(ch, x, origin + (SIZE - 1) * cell + lo);  // 底轴
      else ctx.fillText(ch, x, origin - lo);                                   // 顶轴
    }
    for (let r = 0; r < SIZE; r++) {
      const y = origin + r * cell;
      const num = String(15 - r);
      if ((15 - r) % 2 === 0) ctx.fillText(num, origin - lo, y);               // 左轴（偶数行）
      else ctx.fillText(num, origin + (SIZE - 1) * cell + lo, y);              // 右轴（奇数行）
    }

    // 星位
    const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    ctx.fillStyle = 'rgba(70,40,15,0.9)';
    for (const [r, c] of stars) {
      const { x, y } = cellCenter(r, c);
      ctx.beginPath(); ctx.arc(x, y, cell * 0.13, 0, Math.PI * 2); ctx.fill();
    }

    // 键盘光标
    if (!over && cursorVisible) drawCursor(selected, cell);
    // 触屏待确认高亮
    if (!over && touchPending) drawCursor(touchPending, cell, true);
    // 鼠标悬停
    if (!over && hoverCell && board[hoverCell.r][hoverCell.c] === EMPTY && canHumanMove()) {
      drawHover(hoverCell, cell, current);
    }

    // 棋子
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (board[r][c] !== EMPTY) drawStone(r, c, board[r][c], cell);

    // 最后落子标记
    if (lastMove && board[lastMove.r][lastMove.c] !== EMPTY) {
      const { x, y } = cellCenter(lastMove.r, lastMove.c);
      ctx.fillStyle = board[lastMove.r][lastMove.c] === BLACK ? '#ff5252' : '#d81b60';
      ctx.beginPath(); ctx.arc(x, y, cell * 0.12, 0, Math.PI * 2); ctx.fill();
    }

    // 获胜连线高亮
    if (winLine) {
      for (const { r, c } of winLine) {
        const { x, y } = cellCenter(r, c);
        ctx.strokeStyle = 'rgba(255,60,60,0.95)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, cell * 0.2, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawCursor(cellObj, cell, strong) {
    const { x, y } = cellCenter(cellObj.r, cellObj.c);
    ctx.save();
    ctx.strokeStyle = strong ? '#ff8f00' : '#1565c0';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = strong ? 'rgba(255,143,0,0.7)' : 'rgba(21,101,192,0.6)';
    ctx.shadowBlur = 8;
    ctx.strokeRect(x - cell * 0.46, y - cell * 0.46, cell * 0.92, cell * 0.92);
    ctx.restore();
  }

  function drawHover(cellObj, cell, p) {
    const { x, y } = cellCenter(cellObj.r, cellObj.c);
    ctx.save();
    ctx.globalAlpha = 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.42);
    if (p === BLACK) { g.addColorStop(0, '#333'); g.addColorStop(1, 'transparent'); }
    else { g.addColorStop(0, '#fff'); g.addColorStop(1, 'transparent'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* ---------------- 交互 ---------------- */
  function showConfirmAt(cellObj) {
    const { x, y, cell } = cellCenter(cellObj.r, cellObj.c);
    confirmBtn.style.display = 'flex';
    const bw = confirmBtn.offsetWidth || 92;
    const bh = confirmBtn.offsetHeight || 40;
    let left = x - bw / 2;
    let top = y + cell * 0.55;
    left = Math.max(4, Math.min(left, boardSizePx - bw - 4));
    top = Math.max(4, Math.min(top, boardSizePx - bh - 4));
    confirmBtn.style.left = left + 'px';
    confirmBtn.style.top = top + 'px';
  }

  function onPointerDown(e) {
    e.preventDefault();
    ensureAudio();
    if (!canHumanMove()) return;
    const rect = boardCanvas.getBoundingClientRect();
    const cell = cellFromPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (!cell || board[cell.r][cell.c] !== EMPTY) return;

    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      touchPending = cell;
      cursorVisible = false;
      showConfirmAt(cell);
    } else {
      touchPending = null;
      confirmBtn.style.display = 'none';
      cursorVisible = false;
      handlePlace(cell.r, cell.c);
    }
    render();
  }

  function onPointerMove(e) {
    if (e.pointerType !== 'mouse') return;
    cursorVisible = false;
    const rect = boardCanvas.getBoundingClientRect();
    const cell = cellFromPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (cell && board[cell.r][cell.c] === EMPTY) {
      if (!hoverCell || hoverCell.r !== cell.r || hoverCell.c !== cell.c) { hoverCell = cell; render(); }
    } else if (hoverCell) { hoverCell = null; render(); }
  }

  function onPointerLeave() {
    if (hoverCell) { hoverCell = null; render(); }
  }

  function onKeyDown(e) {
    const k = e.key;
    const isNav = k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight'
      || k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'W' || k === 'A' || k === 'S' || k === 'D';
    if (isNav) {
      e.preventDefault();
      if (!canHumanMove()) return;
      cursorVisible = true;
      hoverCell = null;
      touchPending = null;
      confirmBtn.style.display = 'none';
      switch (k.toLowerCase()) {
        case 'arrowup': case 'w': selected.r = Math.max(0, selected.r - 1); break;
        case 'arrowdown': case 's': selected.r = Math.min(SIZE - 1, selected.r + 1); break;
        case 'arrowleft': case 'a': selected.c = Math.max(0, selected.c - 1); break;
        case 'arrowright': case 'd': selected.c = Math.min(SIZE - 1, selected.c + 1); break;
      }
      render();
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (!canHumanMove()) return;
      const cell = touchPending || selected;
      if (!cell || board[cell.r][cell.c] !== EMPTY) return;
      touchPending = null;
      confirmBtn.style.display = 'none';
      handlePlace(cell.r, cell.c);
    }
  }

  function onConfirmClick() {
    ensureAudio();
    if (touchPending) {
      const { r, c } = touchPending;
      touchPending = null;
      confirmBtn.style.display = 'none';
      if (canHumanMove() && board[r][c] === EMPTY) handlePlace(r, c);
      render();
    }
  }

  /* ---------------- 音效（Web Audio 合成） ---------------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function tone(freq, start, dur, type, vol) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + start;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function playPlace(player) {
    ensureAudio();
    if (player === BLACK) {
      tone(520, 0, 0.09, 'triangle', 0.3);
      tone(780, 0, 0.05, 'sine', 0.12);
    } else {
      tone(430, 0, 0.09, 'triangle', 0.3);
      tone(650, 0, 0.05, 'sine', 0.12);
    }
  }

  function playWin() {
    ensureAudio();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.13, 0.28, 'triangle', 0.3));
  }

  function playLose() {
    ensureAudio();
    [392, 311.13, 261.63].forEach((f, i) => tone(f, i * 0.17, 0.32, 'sawtooth', 0.16));
  }

  /* ---------------- 朗读（Web Speech API 文字转语音） ---------------- */
  function initSpeech() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      const vs = speechSynthesis.getVoices();
      zhVoice = vs.find(v => v.lang && v.lang.toLowerCase().indexOf('zh') === 0) || null;
    };
    load();
    if (typeof speechSynthesis.onvoiceschanged !== 'undefined') speechSynthesis.onvoiceschanged = load;
  }

  function updateSpeakBtn() {
    speakBtn.textContent = speakEnabled ? '🔊 朗读开' : '🔇 朗读关';
    speakBtn.classList.toggle('active', speakEnabled);
  }

  function speakAiComment(text) {
    if (!speakEnabled || !text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      if (zhVoice) u.voice = zhVoice;
      u.rate = 1.0;
      speechSynthesis.speak(u);
    } catch (e) { /* 忽略朗读错误 */ }
  }

  /* ---------------- 彩带 ---------------- */
  let confettiParts = [];
  let confettiAnimId = null;
  function launchConfetti() {
    const w = window.innerWidth, h = window.innerHeight;
    confettiCanvas.width = w;
    confettiCanvas.height = h;
    confettiCanvas.style.width = w + 'px';
    confettiCanvas.style.height = h + 'px';
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff9f45', '#c792ea', '#f472b6', '#22d3ee'];
    const n = Math.min(200, Math.max(80, Math.floor(w * h / 9000)));
    confettiParts = [];
    for (let i = 0; i < n; i++) {
      confettiParts.push({
        x: Math.random() * w,
        y: -30 - Math.random() * h * 0.4,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 7,
        color: colors[(Math.random() * colors.length) | 0],
        vx: (Math.random() - 0.5) * 2.5,
        vy: 2 + Math.random() * 3.5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.02 + Math.random() * 0.04
      });
    }
    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(50, now - last); last = now;
      confettiCtx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of confettiParts) {
        p.sway += p.swaySpeed * dt;
        p.x += (p.vx + Math.sin(p.sway) * 0.6) * dt * 0.06;
        p.y += p.vy * dt * 0.06;
        p.rot += p.vr * dt * 0.06;
        if (p.y < h + 30) alive = true;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.globalAlpha = p.y > h - 40 ? Math.max(0, (h - p.y) / 40) : 1;
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        confettiCtx.restore();
      }
      if (alive) confettiAnimId = requestAnimationFrame(tick);
      else { confettiCtx.clearRect(0, 0, w, h); confettiAnimId = null; }
    }
    confettiAnimId = requestAnimationFrame(tick);
  }

  /* ---------------- 对局导出 / 复盘 ---------------- */
  function encodeMove(r, c) {
    return String.fromCharCode(97 + c) + (15 - r); // 列字母 a~o + 行号 1~15（从下到上）
  }

  function exportGame() {
    return 'G1:' + history.map(h => encodeMove(h.r, h.c)).join('');
  }

  function fallbackCopy(text) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }

  // 解析复盘字符串，返回 [{r,c}, ...]；格式错误抛异常（中文提示）
  function parseGame(text) {
    let s = String(text || '').trim().toLowerCase();
    if (s.startsWith('g1:')) s = s.slice(3);
    else if (s.startsWith('g:')) s = s.slice(2);

    const moves = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch < 'a' || ch > 'o') throw new Error('第 ' + (moves.length + 1) + ' 步列字母无效（应为 a~o）');
      let j = i + 1, rowStr = '';
      while (j < s.length && s[j] >= '0' && s[j] <= '9') { rowStr += s[j]; j++; }
      if (!rowStr) throw new Error('第 ' + (moves.length + 1) + ' 步缺少行号');
      const r = 15 - parseInt(rowStr, 10);  // 行号 1~15（从下到上）→ 内部 0~14（从上到下）
      const c = ch.charCodeAt(0) - 97;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) throw new Error('坐标越界：' + ch + rowStr);
      if (moves.some(m => m.r === r && m.c === c)) throw new Error('落子重叠：' + ch + rowStr);
      moves.push({ r, c });
      i = j;
    }
    if (moves.length === 0) throw new Error('没有解析到任何落子');
    return moves;
  }

  // 依据 reviewIndex 重建棋盘并渲染
  function applyReviewIndex() {
    board = freshBoard();
    for (let i = 0; i < reviewIndex; i++) {
      const m = reviewMoves[i];
      board[m.r][m.c] = (i % 2 === 0) ? BLACK : WHITE;
    }
    lastMove = reviewIndex > 0 ? reviewMoves[reviewIndex - 1] : null;
    winLine = null;
    if (lastMove) {
      const p = ((reviewIndex - 1) % 2 === 0) ? BLACK : WHITE;
      winLine = findWinLine(lastMove.r, lastMove.c, p);
    }
    reviewStep.textContent = '第 ' + reviewIndex + ' / ' + reviewMoves.length + ' 步';
    updateStatus();
    render();
  }

  function loadReview() {
    try {
      reviewMoves = parseGame(reviewInput.value);
      reviewIndex = 1; // 进入第一步
      reviewError.textContent = '';
      applyReviewIndex();
    } catch (e) {
      reviewError.textContent = e.message;
    }
  }

  function showResultOverlay(wp) {
    resultTitle.textContent = wp === EMPTY ? '平局' : (wp === BLACK ? '黑方获胜！' : '白方获胜！');
    copyHint.textContent = '';
    resultOverlay.style.display = 'flex';
  }

  function hideResultOverlay() {
    resultOverlay.style.display = 'none';
  }

  /* ---------------- 绑定 UI ---------------- */
  function bindUI() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        ensureAudio();
        restart();
      });
    });
    document.querySelectorAll('.side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        humanSide = btn.dataset.side === 'black' ? BLACK : WHITE;
        document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b === btn));
        ensureAudio();
        restart();
      });
    });
    // 复盘导航
    loadReviewBtn.addEventListener('click', () => { ensureAudio(); loadReview(); });
    navStartBtn.addEventListener('click', () => { reviewIndex = 0; applyReviewIndex(); });
    navPrevBtn.addEventListener('click', () => { reviewIndex = Math.max(0, reviewIndex - 1); applyReviewIndex(); });
    navNextBtn.addEventListener('click', () => { reviewIndex = Math.min(reviewMoves.length, reviewIndex + 1); applyReviewIndex(); });
    navEndBtn.addEventListener('click', () => { reviewIndex = reviewMoves.length; applyReviewIndex(); });

    // 复盘按钮：复制 reviewInput 内容到剪贴板
    copyReviewBtn.addEventListener('click', () => {
      const text = reviewInput.value.trim();
      if (!text) { reviewError.textContent = '没有可复制的对局码'; return; }
      copyText(text).then(() => {
        reviewError.textContent = '已复制到剪贴板 ✓';
      }, () => {
        reviewError.textContent = '复制失败，请手动复制：' + text;
      });
    });

    // 胜负弹窗：复盘按钮 → 切到复盘模式并自动加载当前对局
    reviewGameBtn.addEventListener('click', () => {
      const text = exportGame();
      mode = 'review';
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'review'));
      ensureAudio();
      restart(); // 重置并显示复盘面板、关闭弹窗
      reviewInput.value = text;
      loadReview();
    });
    againBtn.addEventListener('click', () => { ensureAudio(); hideResultOverlay(); restart(); });
    resultOverlay.addEventListener('click', (e) => { if (e.target === resultOverlay) hideResultOverlay(); });

    boardCanvas.addEventListener('pointerdown', onPointerDown);
    boardCanvas.addEventListener('pointermove', onPointerMove);
    boardCanvas.addEventListener('pointerleave', onPointerLeave);
    confirmBtn.addEventListener('click', onConfirmClick);
    undoBtn.addEventListener('click', () => { ensureAudio(); undo(); });
    restartBtn.addEventListener('click', () => { ensureAudio(); restart(); });
    initSpeech();
    updateSpeakBtn();
    speakBtn.addEventListener('click', () => {
      speakEnabled = !speakEnabled;
      updateSpeakBtn();
      if (!speakEnabled && 'speechSynthesis' in window) speechSynthesis.cancel();
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', resizeCanvas);
  }

  // 调试接口（供自动化测试读取真实状态，只读）
  window.__gomoku = {
    getBoard: () => board.map(row => row.slice()),
    getCurrent: () => current,
    getMode: () => mode,
    getStatus: () => statusEl.textContent,
    getHistory: () => history.map(h => ({ ...h })),
    getReviewIndex: () => reviewIndex,
    getReviewMoves: () => reviewMoves.slice(),
    exportGame,
    loadReviewText: (t) => { reviewInput.value = t; loadReview(); }
  };

  // 启动
  init();
})();
