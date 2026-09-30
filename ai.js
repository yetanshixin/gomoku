/* ============================================================
 * 五子棋 AI 引擎（纯逻辑，无 DOM 依赖）
 * 组成：棋型评估 + 威胁空间搜索(VCF 连杀) + Minimax/Alpha-Beta
 * ============================================================ */

const EMPTY = 0, BLACK = 1, WHITE = 2;
const SIZE = 15;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// 棋型分值（参考五子棋终结者 F/L 评分表：冲四=活四>>活三>>冲三>活二>冲二）
const WIN_SCORE   = 100000000;  // 五连
const LIVE_FOUR   = 1000000;    // 活四（必胜）
const FOUR        = 16000;      // 冲四
const LIVE_THREE  = 750;        // 活三
const SLEEP_THREE = 50;         // 眠三（冲三）
const LIVE_TWO    = 30;         // 活二
const SLEEP_TWO   = 5;          // 眠二（冲二）
const FLEX_WEIGHT = 20;         // 灵活性加成（多点开花 vs 单线堆积）

function inBoard(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function opp(p) {
  return p === BLACK ? WHITE : BLACK;
}

function countStones(board) {
  let n = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (board[r][c] !== EMPTY) n++;
  return n;
}

// (r,c) 处是否为 p 的五连
function isWinAt(board, r, c, p) {
  for (const [dr, dc] of DIRS) {
    let cnt = 1;
    for (let s = 1; s < 5; s++) { const nr = r + dr * s, nc = c + dc * s; if (!inBoard(nr, nc) || board[nr][nc] !== p) break; cnt++; }
    for (let s = 1; s < 5; s++) { const nr = r - dr * s, nc = c - dc * s; if (!inBoard(nr, nc) || board[nr][nc] !== p) break; cnt++; }
    if (cnt >= 5) return true;
  }
  return false;
}

// 单行棋型评分（黑白一起，一次遍历）
// 额外统计：四数（活四/冲四/跳四）、活三数，用于组合威胁识别
function scoreLineBoth(line) {
  let b = 0, w = 0;
  let fourB = 0, fourW = 0, threeB = 0, threeW = 0;
  const n = line.length;

  // 连续块
  let i = 0;
  while (i < n) {
    if (line[i] === EMPTY) { i++; continue; }
    const color = line[i];
    let j = i;
    while (j < n && line[j] === color) j++;
    const len = j - i;
    const lo = i > 0 && line[i - 1] === EMPTY;
    const ro = j < n && line[j] === EMPTY;
    let add = 0;
    if (len >= 5) add = WIN_SCORE;
    else if (len === 4) {
      add = (lo && ro) ? LIVE_FOUR : ((lo || ro) ? FOUR : 0);
      if (lo || ro) { if (color === BLACK) fourB++; else fourW++; }
    }
    else if (len === 3) {
      add = (lo && ro) ? LIVE_THREE : ((lo || ro) ? SLEEP_THREE : 0);
      if (lo && ro) { if (color === BLACK) threeB++; else threeW++; }
    }
    else if (len === 2) add = (lo && ro) ? LIVE_TWO : ((lo || ro) ? SLEEP_TWO : 0);
    else if (len === 1) add = (lo && ro) ? 10 : ((lo || ro) ? 2 : 0);
    if (color === BLACK) b += add; else w += add;
    i = j;
  }

  // 跳四（5 窗口，4 子 1 空）
  for (let k = 0; k + 4 < n; k++) {
    let bc = 0, wc = 0, ec = 0, ei = -1;
    for (let t = 0; t < 5; t++) {
      const v = line[k + t];
      if (v === BLACK) bc++;
      else if (v === WHITE) wc++;
      else { ec++; if (ei === -1) ei = t; }
    }
    if (bc > 0 && wc > 0) continue;              // 混色无效
    if (ec === 1 && (bc === 4 || wc === 4)) {
      if (ei >= 1 && ei <= 3) { if (bc === 4) { b += FOUR; fourB++; } else { w += FOUR; fourW++; } }
    }
  }
  // 跳三（4 窗口，3 子 1 空）
  for (let k = 0; k + 3 < n; k++) {
    let bc = 0, wc = 0, ec = 0, ei = -1;
    for (let t = 0; t < 4; t++) {
      const v = line[k + t];
      if (v === BLACK) bc++;
      else if (v === WHITE) wc++;
      else { ec++; if (ei === -1) ei = t; }
    }
    if (bc > 0 && wc > 0) continue;
    if (ec === 1 && (bc === 3 || wc === 3)) {
      // 白棋下空(ei)成四连 k..k+3，两端 k-1 和 k+4
      const lo = k > 0 && line[k - 1] === EMPTY;
      const ro = k + 4 < n && line[k + 4] === EMPTY;
      const add = (lo && ro) ? LIVE_THREE : ((lo || ro) ? SLEEP_THREE : 0);
      if (bc === 3) { b += add; if (lo && ro) threeB++; }
      else { w += add; if (lo && ro) threeW++; }
    }
  }
  return { b, w, fourB, fourW, threeB, threeW };
}

// 整盘评估（从 p 视角，正数对 p 有利）
function evaluateBoard(board, p) {
  let total = 0;
  let fourP = 0, fourO = 0, threeP = 0, threeO = 0;
  for (const [dr, dc] of DIRS) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (inBoard(r - dr, c - dc)) continue;   // 仅取每行起点
      const line = [];
      let rr = r, cc = c;
      while (inBoard(rr, cc)) { line.push(board[rr][cc]); rr += dr; cc += dc; }
      if (line.length < 5) continue;
      const s = scoreLineBoth(line);
      total += (p === BLACK ? s.b - s.w : s.w - s.b);
      if (p === BLACK) { fourP += s.fourB; fourO += s.fourW; threeP += s.threeB; threeO += s.threeW; }
      else { fourP += s.fourW; fourO += s.fourB; threeP += s.threeW; threeO += s.threeB; }
    }
  }
  // 组合威胁识别：双四 / 四三 → 强奖励（但不直接判必胜，避免水平线效应误判）
  const THREAT = 120000;
  if (fourP >= 2) total += THREAT;
  else if (fourP >= 1 && threeP >= 1) total += THREAT;
  if (fourO >= 2) total -= THREAT;
  else if (fourO >= 1 && threeO >= 1) total -= THREAT;
  // 灵活性：鼓励多点开花、多方向呼应，避免单线堆积
  total += FLEX_WEIGHT * (flexibility(board, p) - flexibility(board, opp(p)));
  return total;
}

// 统计某方棋子的“多方向连接度”：每颗子在多少个方向上有相邻友方棋子
function flexibility(board, p) {
  let score = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c] !== p) continue;
    let dirs = 0;
    for (const [dr, dc] of DIRS) {
      for (const s of [1, -1]) {
        const nr = r + dr * s, nc = c + dc * s;
        if (inBoard(nr, nc) && board[nr][nc] === p) { dirs++; break; }
      }
    }
    score += dirs;
  }
  return score;
}

// 候选点：已有棋子周围 radius 格内的空点
function getCandidates(board, radius) {
  const set = new Set();
  let has = false;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c] === EMPTY) continue;
    has = true;
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      const nr = r + dr, nc = c + dc;
      if (inBoard(nr, nc) && board[nr][nc] === EMPTY) set.add(nr * SIZE + nc);
    }
  }
  if (!has) return [{ r: 7, c: 7 }];
  const res = [];
  set.forEach(k => res.push({ r: Math.floor(k / SIZE), c: k % SIZE }));
  return res;
}

// 快速评估某点落子后的局部价值（用于排序）
function pointScore(board, r, c, p) {
  let s = 0;
  for (const [dr, dc] of DIRS) {
    const before = [];
    let tr = r - dr, tc = c - dc;
    while (inBoard(tr, tc)) { before.unshift([tr, tc]); tr -= dr; tc -= dc; }
    const after = [];
    tr = r + dr; tc = c + dc;
    while (inBoard(tr, tc)) { after.push([tr, tc]); tr += dr; tc += dc; }
    const coords = before.concat([[r, c]], after);
    const line = coords.map(([x, y]) => (x === r && y === c) ? p : board[x][y]);
    if (line.length < 5) continue;
    const { b, w } = scoreLineBoth(line);
    s += (p === BLACK ? b - w : w - b);
  }
  return s;
}

// 走法排序（按局部价值降序，并截断）
function orderMoves(board, moves, p, cap) {
  const scored = moves.map(m => {
    board[m.r][m.c] = p;
    const s = pointScore(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  let arr = scored.map(x => x.m);
  if (cap && arr.length > cap) arr = arr.slice(0, cap);
  return arr;
}

// 找某方直接成五的点
function findWinningMove(board, p) {
  for (const m of getCandidates(board, 1)) {
    board[m.r][m.c] = p;
    const w = isWinAt(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (w) return m;
  }
  return null;
}

// 找某方所有直接成五的点（识别双四/活四：多个成五点堵不住）
function findWinningMoves(board, p) {
  const res = [];
  for (const m of getCandidates(board, 1)) {
    board[m.r][m.c] = p;
    const w = isWinAt(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (w) res.push(m);
  }
  return res;
}

// 提取穿过 (r,c) 的线（假设 (r,c) 已放 p），返回该线上所有"延伸点"（落 p 即成五的空点坐标）
function lineExtPoints(board, r, c, p, dr, dc) {
  const before = [];
  let tr = r - dr, tc = c - dc;
  while (inBoard(tr, tc)) { before.unshift([tr, tc]); tr -= dr; tc -= dc; }
  const after = [];
  tr = r + dr; tc = c + dc;
  while (inBoard(tr, tc)) { after.push([tr, tc]); tr += dr; tc += dc; }
  const cells = before.concat([[r, c]], after);
  const ci = before.length;
  const L = cells.map(([x, y]) => (x === r && y === c) ? p : board[x][y]);

  // 五连检测
  let cnt = 1;
  for (let s = 1; s < 5 && ci - s >= 0 && L[ci - s] === p; s++) cnt++;
  for (let s = 1; s < 5 && ci + s < L.length && L[ci + s] === p; s++) cnt++;
  if (cnt >= 5) return { five: true, pts: [] };

  const pts = new Set();
  for (let s = Math.max(0, ci - 4); s + 4 < L.length && s <= ci; s++) {
    let pc = 0, ec = 0, op = false, ea = -1;
    for (let t = 0; t < 5; t++) {
      const v = L[s + t];
      if (v === p) pc++;
      else if (v === EMPTY) { ec++; ea = s + t; }
      else op = true;
    }
    if (op) continue;
    if (pc === 4 && ec === 1) pts.add(cells[ea][0] * SIZE + cells[ea][1]);
  }
  return { five: false, pts: [...pts] };
}

// 找 p 的所有"四"级威胁落点
function findFourMoves(board, p) {
  const res = [];
  for (const m of getCandidates(board, 1)) {
    board[m.r][m.c] = p;
    if (isWinAt(board, m.r, m.c, p)) { board[m.r][m.c] = EMPTY; continue; }
    let openLine = false;
    const pts = new Set();
    for (const [dr, dc] of DIRS) {
      const info = lineExtPoints(board, m.r, m.c, p, dr, dc);
      if (info.five) { openLine = true; break; }
      if (info.pts.length >= 2) openLine = true;   // 活四
      info.pts.forEach(pt => pts.add(pt));
    }
    board[m.r][m.c] = EMPTY;
    if (openLine || pts.size >= 2) res.push({ r: m.r, c: m.c, type: 'open4' });
    else if (pts.size === 1) {
      const k = pts.values().next().value;
      res.push({ r: m.r, c: m.c, type: 'rush4', block: { r: Math.floor(k / SIZE), c: k % SIZE } });
    }
  }
  return res;
}

// VCF 递归：p 是否能借连续冲四强制取胜
function vcfSearch(board, p, o, depth) {
  if (depth <= 0) return false;
  if (findWinningMove(board, p)) return true;
  const fours = findFourMoves(board, p);
  for (const m of fours) if (m.type === 'open4') return true;
  for (const m of fours) {
    if (m.type !== 'rush4') continue;
    const b = m.block;
    board[m.r][m.c] = p;
    board[b.r][b.c] = o;
    const ok = vcfSearch(board, p, o, depth - 1);
    board[m.r][m.c] = EMPTY;
    board[b.r][b.c] = EMPTY;
    if (ok) return true;
  }
  return false;
}

// 我方活四（最快必胜，可先于防守）
function findOpenFour(board, p) {
  const fours = findFourMoves(board, p);
  const open4s = fours.filter(m => m.type === 'open4');
  return open4s.length ? pickBest(board, p, open4s) : null;
}

// 我方 VCF（连续冲四必胜，需在对手无更急威胁时使用）
function findVCF(board, p, o) {
  const fours = findFourMoves(board, p);
  for (const m of fours) {
    if (m.type !== 'rush4') continue;
    const b = m.block;
    board[m.r][m.c] = p;
    board[b.r][b.c] = o;
    const ok = vcfSearch(board, p, o, 6);
    board[m.r][m.c] = EMPTY;
    board[b.r][b.c] = EMPTY;
    if (ok) return { r: m.r, c: m.c };
  }
  return null;
}

/* ============ VCT（连续威胁取胜搜索） ============
 * 参考 figrid-board 的 ThreatKind 分类 + AND-OR 搜索：
 * - OR 节点（进攻方回合）：任一威胁能取胜即胜
 * - AND 节点（防守方回合）：所有应对都挡不住才胜
 * - 防守方应对 = 挡威胁延伸点 + 反造威胁（成五/活四/冲四/活三）
 */
let vctNodes = 0;
let vctTT = null;
const VCT_NODE_LIMIT = 1000000;
const VCT_TIME_LIMIT = 5000;
const VCT_DEPTH = 20;
// 威胁等级排序权重（越急越先搜）：成五 > 活四/双杀 > 冲四 > 活三
const LEVEL_ORDER = { five: 0, open4: 1, rush4: 2, live3: 3, none: 4 };

// Zobrist 哈希（置换表用）
const ZOBRIST = [];
for (let p = 0; p < 2; p++) {
  ZOBRIST[p] = [];
  for (let r = 0; r < SIZE; r++) {
    ZOBRIST[p][r] = [];
    for (let c = 0; c < SIZE; c++) ZOBRIST[p][r][c] = (Math.random() * 0xffffffff) >>> 0;
  }
}
function boardHash(board) {
  let h = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const v = board[r][c];
    if (v !== EMPTY) h = (h ^ ZOBRIST[v - 1][r][c]) >>> 0;
  }
  return h;
}

// 一次构建线，同时分析四（五连延伸点）和三（活四延伸点）
function analyzeDir(board, r, c, p, dr, dc) {
  const before = [];
  let tr = r - dr, tc = c - dc;
  while (inBoard(tr, tc)) { before.push([tr, tc]); tr -= dr; tc -= dc; }
  before.reverse();
  const after = [];
  tr = r + dr; tc = c + dc;
  while (inBoard(tr, tc)) { after.push([tr, tc]); tr += dr; tc += dc; }
  const cells = before.concat([[r, c]], after);
  const ci = before.length;
  const L = cells.map(([x, y]) => (x === r && y === c) ? p : board[x][y]);

  // 五连检测
  let cnt = 1;
  for (let s = 1; s < 5 && ci - s >= 0 && L[ci - s] === p; s++) cnt++;
  for (let s = 1; s < 5 && ci + s < L.length && L[ci + s] === p; s++) cnt++;
  if (cnt >= 5) return { five: true, pts: [], threeExts: [] };

  // 四的延伸点（五连点）
  const pts = [];
  for (let s = Math.max(0, ci - 4); s + 4 < L.length && s <= ci; s++) {
    let pc = 0, ec = 0, ea = -1, op = false;
    for (let t = 0; t < 5; t++) {
      const v = L[s + t];
      if (v === p) pc++;
      else if (v === EMPTY) { ec++; ea = s + t; }
      else { op = true; break; }
    }
    if (!op && pc === 4 && ec === 1) pts.push(cells[ea][0] * SIZE + cells[ea][1]);
  }

  // 三的延伸点（活四点）
  const threeExts = [];
  for (let d = 1; d <= 4; d++) {
    for (const off of [ci - d, ci + d]) {
      if (off < 0 || off >= L.length || L[off] !== EMPTY) continue;
      L[off] = p;
      const open = lineHasOpenFourAt(L, ci, p);
      L[off] = EMPTY;
      if (open) threeExts.push(cells[off][0] * SIZE + cells[off][1]);
    }
  }
  return { five: false, pts, threeExts };
}

// 分类某点落 p 后形成的威胁（需调用前先把 p 放到 (r,c)）
function classifyThreat(board, r, c, p) {
  let five = false, openFour = false, fours = 0, threes = 0;
  const exts = new Set();
  for (const [dr, dc] of DIRS) {
    const info = analyzeDir(board, r, c, p, dr, dc);
    if (info.five) { five = true; continue; }
    if (info.pts.length >= 2) { openFour = true; for (const pt of info.pts) exts.add(pt); }
    else if (info.pts.length === 1) { fours++; exts.add(info.pts[0]); }
    else if (info.threeExts.length > 0) { threes++; for (const pt of info.threeExts) exts.add(pt); }
  }
  const winning = five || openFour || fours >= 2 || (fours >= 1 && threes >= 1) || threes >= 2;
  const forcing = !winning && (fours >= 1 || threes >= 1);
  // 威胁等级（急迫度）：five 成五 > open4 活四/双四/四三/三三 > rush4 冲四 > live3 活三
  let level = 'none';
  if (five) level = 'five';
  else if (winning) level = 'open4';
  else if (fours >= 1) level = 'rush4';
  else if (threes >= 1) level = 'live3';
  // hard = 成五（这一手直接赢，无需验证）；活四/双四/四三/三三 都要验证防守方反击
  return { winning, forcing, hard: five, level, exts: [...exts] };
}

// AND 节点：防守方所有应对是否都挡不住进攻方
// attackLevel = 进攻方当前威胁等级（five/open4/rush4/live3），用于判定防守方反造威胁是否"更快"
function defenderCantRefute(board, a, d, exts, attackLevel, depth, deadline) {
  if (findWinningMove(board, d)) return false;  // 防守方能立即成五 → 反制
  const respSet = new Set(exts);
  // 防守方反冲四（仅在进攻方是活三时更急）→ 进攻方需堵其五连点后重新搜威胁，单独收集
  const counterFours = [];
  // 防守方反造威胁分级：只有"成五/活四级"永远反驳；"冲四"仅在进攻方是活三时反驳（冲四兑现快于活三）；
  // "活三"反造威胁兑现慢于进攻方冲四/活四，不反驳（忽略，避免过度悲观）
  for (const m of getCandidates(board, 1)) {
    if (board[m.r][m.c] !== EMPTY || respSet.has(m.r * SIZE + m.c)) continue;
    board[m.r][m.c] = d;
    const cls = classifyThreat(board, m.r, m.c, d);
    board[m.r][m.c] = EMPTY;
    if (cls.hard || cls.winning) respSet.add(m.r * SIZE + m.c);
    else if (cls.level === 'rush4' && attackLevel === 'live3') counterFours.push(cls.exts[0]);
  }
  let any = false;
  for (const pt of respSet) {
    const r = Math.floor(pt / SIZE), c = pt % SIZE;
    if (board[r][c] !== EMPTY) continue;
    board[r][c] = d;
    const ok = vctWin(board, a, d, depth, deadline);
    board[r][c] = EMPTY;
    any = true;
    if (!ok) return false;
  }
  // 防守方反冲四：进攻方先堵五连点（消耗一手），再重新搜威胁
  for (const pt of counterFours) {
    const r = Math.floor(pt / SIZE), c = pt % SIZE;
    if (board[r][c] !== EMPTY) continue;
    board[r][c] = a;
    const ok = vctWin(board, a, d, depth - 1, deadline);
    board[r][c] = EMPTY;
    any = true;
    if (!ok) return false;
  }
  return any;
}

// OR 节点：进攻方能否强制取胜（带置换表）
function vctWin(board, a, d, depth, deadline) {
  if (depth <= 0 || vctNodes > VCT_NODE_LIMIT || Date.now() > deadline) return false;
  vctNodes++;
  if (findWinningMove(board, a)) return true;

  const h = boardHash(board);
  const entry = vctTT.get(h);
  if (entry !== undefined) {
    // win=true 需存得更浅（entry.depth <= 当前 depth）才可复用；
    // win=false 需存得更深（entry.depth >= 当前 depth）才可复用
    if (entry.win && depth >= entry.depth) return true;
    if (!entry.win && depth <= entry.depth) return false;
  }

  let result = false;
  const cands = getCandidates(board, 1);
  const forcingMoves = [];
  for (const m of cands) {
    if (board[m.r][m.c] !== EMPTY) continue;
    board[m.r][m.c] = a;
    const cls = classifyThreat(board, m.r, m.c, a);
    board[m.r][m.c] = EMPTY;
    if (cls.winning && cls.hard) { result = true; break; }
    if (cls.winning || cls.forcing) forcingMoves.push({ m, level: cls.level, exts: cls.exts });
  }
  if (!result) {
    forcingMoves.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    for (const { m, level, exts } of forcingMoves) {
      board[m.r][m.c] = a;
      const win = defenderCantRefute(board, a, d, exts, level, depth - 1, deadline);
      board[m.r][m.c] = EMPTY;
      if (win) { result = true; break; }
    }
  }
  if (Date.now() <= deadline && vctNodes <= VCT_NODE_LIMIT) vctTT.set(h, { win: result, depth });
  return result;
}

// 我方 VCT 入口：返回必胜第一步或 null（迭代加深：浅层必胜秒回，需要时再往深算）
function findVCT(board, p, o) {
  vctNodes = 0;
  vctTT = new Map();
  const deadline = Date.now() + VCT_TIME_LIMIT;
  if (findWinningMove(board, p)) return null;  // 直接成五由上层处理
  const cands = getCandidates(board, 1);

  // 分类一次：必胜点直接返回，强制威胁收集起来复用
  const forcingMoves = [];
  for (const m of cands) {
    if (board[m.r][m.c] !== EMPTY) continue;
    board[m.r][m.c] = p;
    const cls = classifyThreat(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (cls.winning && cls.hard) return { r: m.r, c: m.c };
    if (cls.winning || cls.forcing) forcingMoves.push({ m, level: cls.level, exts: cls.exts });
  }
  forcingMoves.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  // 迭代加深：从浅到深搜索强制威胁（复用已分类结果）
  for (let d = 4; d <= VCT_DEPTH; d += 2) {
    if (Date.now() > deadline) break;
    for (const { m, level, exts } of forcingMoves) {
      board[m.r][m.c] = p;
      const win = defenderCantRefute(board, p, o, exts, level, d, deadline);
      board[m.r][m.c] = EMPTY;
      if (win) return { r: m.r, c: m.c };
    }
  }
  return null;
}

// 生成搜索候选：把"堵对手威胁点"（五连/活四/冲四/双杀）排在前面，避免被 cap 剪掉
// （否则对手的冲四五连点 pointScore 低、会被 cap 剪掉，导致搜索漏掉关键防守，误判对手必胜）
function searchMoves(board, p) {
  const o = opp(p);
  const moves = getCandidates(board, 2);
  const defSet = new Set();
  for (const m of findWinningMoves(board, o)) defSet.add(m.r * SIZE + m.c);
  for (const m of findFourMoves(board, o)) {
    if (m.type === 'open4') defSet.add(m.r * SIZE + m.c);
    else if (m.type === 'rush4' && m.block) defSet.add(m.block.r * SIZE + m.block.c);
  }
  const dbl = findDoubleThreatMove(board, o);
  if (dbl) defSet.add(dbl.r * SIZE + dbl.c);
  const defMoves = moves.filter(m => defSet.has(m.r * SIZE + m.c));
  const others = orderMoves(board, moves.filter(m => !defSet.has(m.r * SIZE + m.c)), p, 14);
  return defMoves.concat(others);
}

// Negamax + Alpha-Beta
function negamax(board, depth, alpha, beta, color, lastR, lastC, deadline) {
  if (lastR >= 0 && isWinAt(board, lastR, lastC, opp(color))) return -WIN_SCORE - depth;
  if (depth <= 0) return evaluateBoard(board, color);
  if (Date.now() > deadline) return evaluateBoard(board, color);

  const moves = searchMoves(board, color);
  let best = -Infinity;
  for (const m of moves) {
    board[m.r][m.c] = color;
    let v;
    if (isWinAt(board, m.r, m.c, color)) v = WIN_SCORE + depth;
    else v = -negamax(board, depth - 1, -beta, -alpha, opp(color), m.r, m.c, deadline);
    board[m.r][m.c] = EMPTY;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

// 根节点搜索
function minimaxRoot(board, p, depth, deadline) {
  const moves = searchMoves(board, p);
  if (moves.length === 0) return { move: null, score: 0 };
  let bestMove = moves[0], bestScore = -Infinity, alpha = -Infinity;
  for (const m of moves) {
    board[m.r][m.c] = p;
    let v;
    if (isWinAt(board, m.r, m.c, p)) v = WIN_SCORE + depth;
    else v = -negamax(board, depth - 1, -Infinity, -alpha, opp(p), m.r, m.c, deadline);
    board[m.r][m.c] = EMPTY;
    if (v > bestScore) { bestScore = v; bestMove = m; }
    if (bestScore > alpha) alpha = bestScore;
    if (Date.now() > deadline) break;
  }
  return { move: bestMove, score: bestScore };
}

// 紧急防御：封对手活三（→活四）/ 双杀（四四/四三/三三）
function findUrgentDefense(board, p, o) {
  const threats = findFourMoves(board, o);
  const open4s = threats.filter(m => m.type === 'open4');
  if (open4s.length) return pickBest(board, p, open4s);
  const dbl = findDoubleThreatMove(board, o);
  if (dbl) return dbl;
  return null;
}

// 非紧急防御：封对手冲四（眠三/跳三可下成冲四）
function findRush4Defense(board, p, o) {
  const threats = findFourMoves(board, o);
  const rush4s = threats.filter(m => m.type === 'rush4');
  if (rush4s.length) return pickBest(board, p, rush4s.map(m => m.block));
  return null;
}

// 从候选点中挑对自己最有利的一个（用于防守选点）
function pickBest(board, p, moves) {
  let best = moves[0], bestS = -Infinity;
  for (const m of moves) {
    board[m.r][m.c] = p;
    const s = pointScore(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (s > bestS) { bestS = s; best = m; }
  }
  return best;
}

// 判断 L 中是否存在包含 idx、且两端皆空的连续四（活四）
function lineHasOpenFourAt(L, idx, p) {
  let s = idx, e = idx;
  while (s - 1 >= 0 && L[s - 1] === p) s--;
  while (e + 1 < L.length && L[e + 1] === p) e++;
  if (e - s + 1 < 4) return false;
  const lo = s - 1 >= 0 && L[s - 1] === EMPTY;
  const ro = e + 1 < L.length && L[e + 1] === EMPTY;
  return lo && ro;
}

// 返回 (r,c) 落 p 后，在 (dr,dc) 方向成活三的「成四延伸点」（黑棋下一步成活四的点）
function lineOpenThreeExts(board, r, c, p, dr, dc) {
  const before = [];
  let tr = r - dr, tc = c - dc;
  while (inBoard(tr, tc)) { before.unshift([tr, tc]); tr -= dr; tc -= dc; }
  const after = [];
  tr = r + dr; tc = c + dc;
  while (inBoard(tr, tc)) { after.push([tr, tc]); tr += dr; tc += dc; }
  const coords = before.concat([[r, c]], after);
  const ci = before.length;
  const L = coords.map(([x, y]) => (x === r && y === c) ? p : board[x][y]);

  const exts = new Set();
  for (let d = 1; d <= 4; d++) {
    for (const off of [ci - d, ci + d]) {
      if (off < 0 || off >= L.length || L[off] !== EMPTY) continue;
      L[off] = p;
      const open = lineHasOpenFourAt(L, ci, p);
      L[off] = EMPTY;
      if (open) exts.add(coords[off][0] * SIZE + coords[off][1]);
    }
  }
  return [...exts].map(k => ({ r: Math.floor(k / SIZE), c: k % SIZE }));
}

// 判断 (r,c) 落 p 后，在 (dr,dc) 方向是否形成「活三」（下一步可成活四）
function lineHasOpenThree(board, r, c, p, dr, dc) {
  return lineOpenThreeExts(board, r, c, p, dr, dc).length > 0;
}

// 统计某点落 p 后形成的威胁：{fours: 成四的方向数, threes: 成活三的方向数}
function threatCountAt(board, r, c, p) {
  let fours = 0, threes = 0;
  for (const [dr, dc] of DIRS) {
    const info = lineExtPoints(board, r, c, p, dr, dc);
    if (info.five) { fours += 2; continue; }       // 直接成五
    if (info.pts.length >= 1) { fours++; continue; } // 成四（冲四/活四）
    if (lineHasOpenThree(board, r, c, p, dr, dc)) threes++;
  }
  return { fours, threes };
}

// 是否构成「双杀」（四四 / 四三 / 三三）
function isDoubleThreat(fours, threes) {
  return (fours >= 2) || (fours >= 1 && threes >= 1) || (threes >= 2);
}

// 找某方的「双杀」必胜点（四四/四三/三三）
function findDoubleThreatMove(board, p) {
  for (const m of getCandidates(board, 2)) {
    board[m.r][m.c] = p;
    const tc = threatCountAt(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (isDoubleThreat(tc.fours, tc.threes)) return { r: m.r, c: m.c };
  }
  return null;
}

// 找某方的双杀点，区分类型：win=true 表示四四/四三（必胜），win=false 表示三三（可堵）
function findDoubleThreatTyped(board, p) {
  let three = null;
  for (const m of getCandidates(board, 2)) {
    if (board[m.r][m.c] !== EMPTY) continue;
    board[m.r][m.c] = p;
    const tc = threatCountAt(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (tc.fours >= 2 || (tc.fours >= 1 && tc.threes >= 1)) return { r: m.r, c: m.c, win: true };
    if (tc.threes >= 2 && !three) three = { r: m.r, c: m.c, win: false };
  }
  return three;
}

/* 开局库：黑方必胜开局
 * 坐标约定：内部 (r,c)，r 从上到下 0~14，c 从左到右 0~14；天元 (7,7)
 * （外部棋谱坐标“行号从下到上1~15”，转换：内部r = 15 - 外部行号）
 * - 花月（白②直指/正交）：黑③ = 白②垂直偏移1格的对角邻点（紧邻白②）
 * - 浦月（白②斜指/对角）：黑③ = 与白②同列、跨天元的另一对角邻点
 */
function openingThird(board) {
  let w = null;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++)
    if (board[r][c] === WHITE) { w = { r, c }; break; }
  if (!w) return null;
  const dr = w.r - 7, dc = w.c - 7;
  // 白②必须紧贴天元（8 邻点之一），否则非定式，交回搜索
  if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return null;
  if (Math.abs(dr) + Math.abs(dc) === 1) {
    // 花月（直指）
    return { r: w.r + dc, c: w.c - dr, kind: 'flower' };
  }
  // 浦月（斜指）
  return { r: w.r, c: 14 - w.c, kind: 'pyel' };
}

// 解析开局库数据（每步 2 个十六进制字符 行r列c，分支 | 分隔）
function parseBook(str) {
  if (typeof str !== 'string' || !str) return null;
  return str.split('|').map(path => {
    const moves = [];
    for (let i = 0; i < path.length; i += 2) {
      moves.push({ r: parseInt(path[i], 16), c: parseInt(path[i + 1], 16) });
    }
    return moves;
  });
}

// 兜底开局库（无 book.js 时）：浦月 + 花月各一条
const FALLBACK_LINES = [
  [{ r: 7, c: 7 }, { r: 6, c: 8 }, { r: 8, c: 8 }, { r: 6, c: 6 }, { r: 6, c: 9 }, { r: 7, c: 9 }, { r: 8, c: 10 }, { r: 8, c: 9 }, { r: 9, c: 10 }],
  [{ r: 7, c: 7 }, { r: 6, c: 7 }, { r: 6, c: 8 }, { r: 5, c: 9 }, { r: 8, c: 6 }, { r: 5, c: 7 }, { r: 9, c: 5 }, { r: 10, c: 4 }, { r: 8, c: 5 }, { r: 5, c: 6 }, { r: 5, c: 8 }, { r: 7, c: 8 }, { r: 8, c: 9 }, { r: 8, c: 7 }, { r: 9, c: 6 }, { r: 5, c: 4 }, { r: 7, c: 5 }, { r: 3, c: 4 }, { r: 4, c: 5 }, { r: 5, c: 3 }, { r: 5, c: 5 }, { r: 7, c: 6 }]
];

// 8 个棋盘对称变换（中心 (7,7)），让开局库覆盖白2 的所有方向
const SYMMETRIES = [
  (r, c) => [r, c],
  (r, c) => [c, 14 - r],
  (r, c) => [14 - r, 14 - c],
  (r, c) => [14 - c, r],
  (r, c) => [r, 14 - c],
  (r, c) => [14 - r, c],
  (r, c) => [c, r],
  (r, c) => [14 - c, 14 - r]
];

// 生成 8 个对称版本，覆盖白2 的 8 个相邻方向
function symmetrize(lines) {
  const result = [];
  for (const line of lines) {
    for (const sym of SYMMETRIES) {
      result.push(line.map(m => { const [r, c] = sym(m.r, m.c); return { r, c }; }));
    }
  }
  return result;
}

// 黑棋必胜库（花月/浦月全深度）+ 白棋防守库（16 手截断，覆盖所有开局），各做 8 向对称
const OPENING_LINES = symmetrize(parseBook(typeof BLACK_BOOK_DATA === 'string' ? BLACK_BOOK_DATA : '') || FALLBACK_LINES);
const WHITE_LINES = symmetrize(parseBook(typeof WHITE_BOOK_DATA === 'string' ? WHITE_BOOK_DATA : '') || FALLBACK_LINES);

// 查多步开局库：n = 已落子数（黑方回合 n 为偶数），返回黑方下一手或 null
function bookMove(board, n) {
  for (const line of OPENING_LINES) {
    if (n >= line.length) continue;
    let match = true;
    for (let i = 0; i < n; i++) {
      const m = line[i];
      const expected = (i % 2 === 0) ? BLACK : WHITE;
      if (board[m.r][m.c] !== expected) { match = false; break; }
    }
    if (match && board[line[n].r][line[n].c] === EMPTY) {
      return { r: line[n].r, c: line[n].c };
    }
  }
  return null;
}

// 白棋防守开局库：选让黑棋赢得最慢（最顽强）的防守点
function bookMoveWhite(board, n) {
  const byMove = new Map();  // key -> 该落点「黑棋最快赢」的剩余步数
  for (const line of WHITE_LINES) {
    if (n >= line.length) continue;
    let match = true;
    for (let i = 0; i < n; i++) {
      const m = line[i];
      const expected = (i % 2 === 0) ? BLACK : WHITE;
      if (board[m.r][m.c] !== expected) { match = false; break; }
    }
    if (!match) continue;
    const mv = line[n];
    if (board[mv.r][mv.c] !== EMPTY) continue;
    const key = mv.r * SIZE + mv.c;
    const remaining = line.length - n;
    if (!byMove.has(key) || remaining < byMove.get(key)) {
      byMove.set(key, remaining);
    }
  }
  let bestKey = -1, bestMin = -1;
  for (const [key, minRem] of byMove) {
    if (minRem > bestMin) { bestMin = minRem; bestKey = key; }
  }
  if (bestKey < 0) return null;
  return { r: Math.floor(bestKey / SIZE), c: bestKey % SIZE };
}

/* 对外主入口：求最佳落点（返回 {r,c,why}，why 用于生成走棋解释）
 * history：走法序列 [{r,c},...]，用于查必胜地毯谱（需与棋盘一致） */
function getBestMove(board, p, difficulty, history) {
  const o = opp(p);
  const n = countStones(board);

  // 白2 特殊处理：走黑1 的斜邻牵制（地毯谱 depth 会误选边中点，实测黑棋反而最快赢）
  if (p === WHITE && n === 1) {
    let b1 = null;
    for (let r = 0; r < SIZE && !b1; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === BLACK) { b1 = { r, c }; break; }
    if (b1) {
      const diag = [
        { r: b1.r - 1, c: b1.c - 1 }, { r: b1.r - 1, c: b1.c + 1 },
        { r: b1.r + 1, c: b1.c - 1 }, { r: b1.r + 1, c: b1.c + 1 },
      ];
      const m = diag.find(d => inBoard(d.r, d.c) && board[d.r][d.c] === EMPTY);
      if (m) return { r: m.r, c: m.c, why: 'white2' };
    }
  }

  // 必胜地毯谱查表（无禁手黑棋必胜，优先于一切）
  if (history && history.length === n) {
    const cm = carpetMove(history, p);
    if (cm && cm.win) {
      return { r: cm.r, c: cm.c, why: p === BLACK ? 'carpet-win' : 'carpet-def' };
    }
    if (cm) {
      return { r: cm.r, c: cm.c, why: 'carpet-adv' };
    }
  }

  // 开局定式（仅黑方）：黑1 天元、黑3 花月/浦月
  if (p === BLACK) {
    if (n === 0) return { r: 7, c: 7, why: 'first' };
    if (n === 2) {
      const m = openingThird(board);
      if (m) return { r: m.r, c: m.c, why: m.kind };
      // 白2 没贴天元（走远）：黑3 走天元斜邻点形成斜二，往下延伸方向避开白2
      let w = null;
      for (let r = 0; r < SIZE && !w; r++) for (let c = 0; c < SIZE; c++) if (board[r][c] === WHITE) { w = { r, c }; break; }
      const g = (w && w.r < 7) ? { r: 6, c: 6 } : { r: 6, c: 8 };
      if (board[g.r][g.c] === EMPTY) return { r: g.r, c: g.c, why: 'black3' };
    }
    // 脱谱后的开局库查表移到 search 之后（让 minimax 先找必胜反杀，而非盲目按谱走）
  }

  // 立即取胜 / 必须防守
  const win = findWinningMove(board, p);
  if (win) return { r: win.r, c: win.c, why: 'win' };
  const blocks = findWinningMoves(board, o);
  if (blocks.length >= 1) return { r: blocks[0].r, c: blocks[0].c, why: 'block' };

  // 我方活四（最快必胜，先于防守）
  const open4 = findOpenFour(board, p);
  if (open4) return { r: open4.r, c: open4.c, why: 'open4' };

  // 我方连杀（VCT：连续强制威胁取胜。先于堵对手双杀/活三，因为 VCT 的冲四会强制对手应对，能反杀对手的威胁）
  const vct = findVCT(board, p, o);
  if (vct) return { r: vct.r, c: vct.c, why: 'vct' };

  // 堵对手必胜双杀（四四/四三，1 步必胜，必须堵）
  const oppDouble = findDoubleThreatTyped(board, o);
  if (oppDouble && oppDouble.win) {
    // 双杀不止堵交叉点：也可堵某个威胁的延伸点
    //  - 四四：堵任一冲四的五连点（冲四变眠四）
    //  - 四三：堵冲四五连点，或堵活三端点（活三变眠三）
    // 候选 = 交叉点 + classifyThreat 收集的所有延伸点，pickBest 选"既能破坏双杀、又对黑棋最有利"的堵点
    const cands = [oppDouble];
    board[oppDouble.r][oppDouble.c] = o;
    const cls = classifyThreat(board, oppDouble.r, oppDouble.c, o);
    board[oppDouble.r][oppDouble.c] = EMPTY;
    for (const pt of cls.exts) {
      const r = Math.floor(pt / SIZE), c = pt % SIZE;
      if (board[r][c] === EMPTY) cands.push({ r, c });
    }
    const bt = pickBest(board, p, cands);
    return { r: bt.r, c: bt.c, why: 'defense' };
  }

  // 堵对手活三（2 步威胁：活四→五连。先于我方双杀，因为对手活四会打断我方双杀）
  const oppThree = findFourMoves(board, o).filter(m => m.type === 'open4');
  if (oppThree.length) {
    const bt = pickBest(board, p, oppThree);
    return { r: bt.r, c: bt.c, why: 'defense' };
  }

  // 我方双杀（四四/四三必胜 + 三三可堵）：收集所有双杀点，pickBest 选对黑棋后续棋型最有利的
  const doubleCands = [];
  for (const m of getCandidates(board, 2)) {
    if (board[m.r][m.c] !== EMPTY) continue;
    board[m.r][m.c] = p;
    const tc = threatCountAt(board, m.r, m.c, p);
    board[m.r][m.c] = EMPTY;
    if (isDoubleThreat(tc.fours, tc.threes)) doubleCands.push({ r: m.r, c: m.c });
  }
  if (doubleCands.length) {
    const bt = pickBest(board, p, doubleCands);
    return { r: bt.r, c: bt.c, why: 'double' };
  }

  // 堵对手三三（可堵，优先级低于我方双杀，最后才堵）
  if (oppDouble && !oppDouble.win) {
    const cands = [oppDouble];
    board[oppDouble.r][oppDouble.c] = o;
    const cls = classifyThreat(board, oppDouble.r, oppDouble.c, o);
    board[oppDouble.r][oppDouble.c] = EMPTY;
    for (const pt of cls.exts) {
      const r = Math.floor(pt / SIZE), c = pt % SIZE;
      if (board[r][c] === EMPTY) cands.push({ r, c });
    }
    const bt = pickBest(board, p, cands);
    return { r: bt.r, c: bt.c, why: 'defense' };
  }

  // 白棋防守开局库（无战术威胁时按谱防守）
  if (p === WHITE) {
    const wm = bookMoveWhite(board, n);
    if (wm) return { r: wm.r, c: wm.c, why: 'book-white' };
  }

  // 博弈树（迭代加深 + 时限）
  // 先于 rush-defense：让 minimax 有机会发现"反杀必胜手"（如脱谱后 K5），
  // 而不是盲目堵对手冲四（否则会错过必胜反杀，被动挨打）
  const cfg = { easy: { depth: 2, time: 200 }, medium: { depth: 4, time: 900 }, hard: { depth: 6, time: 1800 } };
  const c = cfg[difficulty] || cfg.medium;
  const deadline = Date.now() + c.time;
  let best = null;
  for (let d = 2; d <= c.depth; d++) {
    if (Date.now() > deadline) break;
    const r = minimaxRoot(board, p, d, deadline);
    if (r && r.move) best = r;
  }

  if (best && best.move) return { r: best.move.r, c: best.move.c, why: 'search' };

  // 开局库（脱谱后兜底：minimax 没找到更好走法时按谱走）
  if (p === BLACK && n > 2) {
    const bm = bookMove(board, n);
    if (bm) return { r: bm.r, c: bm.c, why: 'book' };
  }

  // 非紧急防御：封对手冲四（minimax 没找到更好走法时的兜底）
  const rush = findRush4Defense(board, p, o);
  if (rush) return { r: rush.r, c: rush.c, why: 'rush-defense' };

  const fallback = orderMoves(board, getCandidates(board, 2), p, 1);
  return fallback.length ? { r: fallback[0].r, c: fallback[0].c, why: 'search' } : null;
}

/* 内部坐标 (r,c) → 标准记谱（列字母 A~O 大写 + 行号 1~15 从下到上） */
function coordName(r, c) {
  return String.fromCharCode(65 + c) + (15 - r);
}

/* 根据决策原因（why）+ 客观棋型，生成人话走棋解释 */
function explainMove(mv, board, p) {
  if (!mv) return '';
  const o = opp(p);
  const name = coordName(mv.r, mv.c);

  switch (mv.why) {
    case 'first':
      return name + ' 占据天元：黑棋先手最稳的起手，向四个方向都能展开，也是花月/浦月必胜开局的第一步。';
    case 'white2':
      return name + ' 白②斜指牵制黑棋：斜邻是白棋最强的起手，封锁黑棋斜线发展，尽量拖慢黑棋的必胜。';
    case 'flower':
      return '花月开局第 3 手 ' + name + '：黑棋最强必胜开局之一（白②直指时用）。进入必胜谱库后，无论白棋怎么防，黑棋都沿谱必胜。';
    case 'pyel':
      return '浦月开局第 3 手 ' + name + '：黑棋必胜开局之一（白②斜指时用）。进入必胜谱库后，无论白棋怎么防，黑棋都沿谱必胜。';
    case 'carpet-win':
      return name + ' 是必胜地毯谱中的确定必胜手：无论你接下来怎么走，我都沿谱在 33 手内连成五。';
    case 'carpet-adv':
      return name + ' 是地毯谱中的优势手（该分支尚未完全证必胜），保持攻势，你很难防守。';
    case 'carpet-def':
      return name + ' 是地毯谱中最顽强的防守点：在必败线里，这一手能让黑棋赢得最慢、拖到最久。';
    case 'win':
      return name + ' 直接连成五子，锁定胜局。';
    case 'block':
      return name + ' 必须堵在这里：这是你下一手的五连点，不堵就输了。';
    case 'open4':
      return name + ' 下出活四：两端都能连成五，你堵哪一端，我都从另一端连五，已经必胜。';
    case 'double': {
      board[mv.r][mv.c] = p;
      const tc = threatCountAt(board, mv.r, mv.c, p);
      board[mv.r][mv.c] = EMPTY;
      if (tc.fours >= 2) {
        return name + ' 同时形成两处冲四（四四双杀）：你只能堵一处，另一处我下一手就连五。';
      } else if (tc.fours >= 1 && tc.threes >= 1) {
        return name + ' 同时形成冲四 + 活三（四三双杀）：你挡冲四，我就把活三走成活四；挡活三，我就冲四连五。';
      } else {
        return name + ' 同时形成两个活三（三三双杀）：你挡一边，另一边下一手就成活四。';
      }
    }
    case 'vct':
      return name + ' 开启连续冲四（VCF）杀棋：接下来我会步步冲四，每次只留一个必堵点，逼你一路被动，直到连成五。';
    case 'defense': {
      const threats = findFourMoves(board, o);
      const open4s = threats.filter(t => t.type === 'open4');
      if (open4s.length) {
        return name + ' 堵住你的活四：你已形成活四，这里必须堵，否则你下一手两端都能连五。';
      }
      const dbl = findDoubleThreatMove(board, o);
      if (dbl && dbl.r === mv.r && dbl.c === mv.c) {
        return name + ' 抢占你双杀的关键点：否则你会在这里形成四三/三三，我挡不住两处。';
      }
      return name + ' 是针对你活三/双杀威胁的紧急防守，先化解你的进攻。';
    }
    case 'rush-defense':
      return name + ' 挡下你的冲四点：不挡的话，你下一手在这里就连成五。';
    case 'black3':
      return name + ' 白②没贴天元（走远了），黑③走斜二标准起手，先手优势更大，开始压制。';
    case 'book':
      return name + ' 按必胜开局谱库走子：这是该局面下经过验证的正着，延续黑棋的必胜线。';
    case 'book-white':
      return name + ' 按防守谱库选点：在所有白棋防守分支里，这一手能让黑棋的胜路最长，尽量拖住局面。';
    case 'search':
    default:
      return name + ' 是综合评估后的最佳落点，兼顾进攻与防守。';
  }
}

/* ============ 必胜地毯谱（无禁手黑棋必胜，Embryo 制谱） ============
 * 数据来自 book2.js 的 CARPET_DATA 字符串，树编码：
 * 每节点 3 字符 = 坐标(r,c各1位十六进制) + 标记(A-H)
 * 标记 A=有子无兄弟/必胜 B=叶子无兄弟/必胜 C=有子有兄弟/必胜 D=叶子有兄弟/必胜
 *       E-H 同上结构但=优势(未证必胜)
 */
let carpet = null;

function initCarpet() {
  if (carpet) return;
  if (typeof CARPET_DATA !== 'string') return; // book2.js 未加载则跳过
  const rs = [], cs = [], win = [], child = [], sib = [], depth = [];
  let pos = 0;
  function build() {
    const idx = rs.length;
    rs.push(parseInt(CARPET_DATA[pos], 16));
    cs.push(parseInt(CARPET_DATA[pos + 1], 16));
    const m = CARPET_DATA.charCodeAt(pos + 2) - 65;
    pos += 3;
    const struct = m & 3;
    const hasChild = (struct === 0 || struct === 2);
    const hasSibling = (struct === 2 || struct === 3);
    win.push(m < 4);
    child.push(-1); sib.push(-1); depth.push(0);
    if (hasChild) child[idx] = build();
    if (hasSibling) sib[idx] = build();
    depth[idx] = 1 + (child[idx] >= 0 ? depth[child[idx]] : 0);
    return idx;
  }
  build();
  carpet = { rs, cs, win, child, sib, depth };
}

// 8 向对称的逆变换索引（SYMMETRIES 定义在开局库部分）
const SYM_INV = [0, 3, 2, 1, 4, 5, 6, 7];

// 查必胜地毯：沿 history 匹配，返回 AI 该走的走法 {r,c,win} 或 null
// 支持 8 向对称（黑1 天元为对称中心，覆盖白2 的 8 个邻点方向）
// p=BLACK 选必胜儿子；p=WHITE 选子树最深（撑最久）的儿子
function carpetMove(history, p) {
  initCarpet();
  if (!carpet) return null;
  for (let s = 0; s < 8; s++) {
    const sym = SYMMETRIES[s];
    const mapped = history.map(m => { const t = sym(m.r, m.c); return { r: t[0], c: t[1] }; });
    const res = carpetMatch(mapped, p);
    if (res) {
      const inv = SYMMETRIES[SYM_INV[s]];
      const t = inv(res.r, res.c);
      return { r: t[0], c: t[1], win: res.win };
    }
  }
  return null;
}

function carpetMatch(history, p) {
  const { rs, cs, win, child, sib, depth } = carpet;
  let node = 0;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (i === 0) { if (rs[node] !== m.r || cs[node] !== m.c) return null; continue; }
    let next = -1, c = child[node];
    while (c >= 0) { if (rs[c] === m.r && cs[c] === m.c) { next = c; break; } c = sib[c]; }
    if (next < 0) return null;
    node = next;
  }
  if (history.length === 0) return { r: rs[0], c: cs[0], win: win[0] };
  if (p === BLACK) {
    let best = -1, c = child[node];
    while (c >= 0) { if (win[c]) { best = c; break; } c = sib[c]; }
    if (best < 0) best = child[node];
    if (best < 0) return null;
    return { r: rs[best], c: cs[best], win: win[best] };
  } else {
    let best = child[node], bestD = -1, c = child[node];
    while (c >= 0) { if (depth[c] > bestD) { bestD = depth[c]; best = c; } c = sib[c]; }
    if (best < 0) return null;
    return { r: rs[best], c: cs[best], win: win[best] };
  }
}
