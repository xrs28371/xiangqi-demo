/* 楚河漢界 · 前端交互：只调用 Xiangqi / XiangqiAI 契约接口，不含任何规则逻辑 */
(function () {
  'use strict';

  var X = window.Xiangqi;
  var AI = window.XiangqiAI;

  var PLAYER = 'red';
  var AI_SIDE = 'black';
  var ROWS = 10;
  var COLS = 9;
  var STORE_KEY = 'xq-demo-level';

  var GLYPH = {
    R: '俥', N: '傌', B: '相', A: '仕', K: '帥', C: '炮', P: '兵',
    r: '車', n: '馬', b: '象', a: '士', k: '將', c: '炮', p: '卒'
  };
  var SIDE_CN = { red: '红', black: '黑' };
  var LEVEL_CN = { 1: '新手', 2: '进阶', 3: '高手' };

  var game = {
    states: [],
    moves: [],
    selected: null,
    targets: [],
    over: false,
    result: null,
    thinking: false,
    level: 2,
    aiToken: 0,
    aiTimer: null,
    modalTimer: null,
    ready: false
  };

  var dom = {};
  var pointEls = [];

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function opp(side) { return side === 'red' ? 'black' : 'red'; }
  function current() { return game.states[game.states.length - 1]; }
  function rowOf(i) { return Math.floor(i / COLS); }
  function colOf(i) { return i % COLS; }
  function coord(i) { return '(' + rowOf(i) + ',' + colOf(i) + ')'; }
  function glyphOf(code) { return GLYPH[code] || String(code || ''); }

  function sideOf(code) {
    if (!code) return null;
    var s = null;
    try { s = X.pieceSide(code); } catch (e) { s = null; }
    if (s === 'red' || s === 'black') return s;
    return code === String(code).toUpperCase() ? 'red' : 'black';
  }

  function safeInCheck(st, side) {
    try { return !!X.isInCheck(st, side); } catch (e) { return false; }
  }

  function cloneState(st) {
    var o = {};
    for (var k in st) {
      if (Object.prototype.hasOwnProperty.call(st, k)) {
        o[k] = Array.isArray(st[k]) ? st[k].slice() : st[k];
      }
    }
    return o;
  }

  function applySafe(st, move) {
    var copy = cloneState(st);
    var out;
    try {
      out = X.applyMove(copy, move);
    } catch (e) {
      if (window.console) console.error('applyMove 失败', e);
      return null;
    }
    var next = (out && out.board) ? out : copy;
    if (next.turn === st.turn) next.turn = opp(st.turn);
    return next;
  }

  function legalFrom(st, idx) {
    var list;
    try { list = X.movesFrom(st, idx) || []; } catch (e) { list = []; }
    var res = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || typeof m.to !== 'number') continue;
      if (m.from === undefined) {
        var c = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) c[k] = m[k];
        c.from = idx;
        m = c;
      } else if (m.from !== idx) {
        continue;
      }
      res.push(m);
    }
    return res;
  }

  /* ---------- 终局判定（只做返回值归一化） ---------- */
  function reasonCN(r) {
    if (!r) return '';
    var s = String(r);
    if (/[\u4e00-\u9fa5]/.test(s)) return s;
    s = s.toLowerCase();
    if (s.indexOf('stalemate') >= 0) return '困毙';
    if (s.indexOf('mate') >= 0) return '绝杀';
    if (s.indexOf('nomove') >= 0 || s.indexOf('no_move') >= 0 || s.indexOf('no-move') >= 0) return '无着可走';
    if (s.indexOf('repet') >= 0) return '重复局面';
    if (s.indexOf('king') >= 0 || s.indexOf('capture') >= 0) return '擒将';
    if (s.indexOf('draw') >= 0) return '和局';
    return '';
  }

  function parseWinner(v, st) {
    if (v === null || v === undefined || v === false || v === true) return null;
    var s = String(v).toLowerCase().trim();
    if (!s) return null;
    if (/ongoing|playing|progress|^none$|continue|active|pending|^null$|^undefined$/.test(s)) return null;
    if (/draw|tie|和/.test(s)) return 'draw';
    var lose = /lose|lost|loss|mated|负/.test(s);
    if (/^red|[^a-z]red|^r$|红/.test(s)) return lose ? 'black' : 'red';
    if (/^black|[^a-z]black|^b$|黑/.test(s)) return lose ? 'red' : 'black';
    if (/mate|stalemate|绝杀|困毙|nomove|no_move|no-move/.test(s)) return opp(st.turn);
    return null;
  }

  function normalizeResult(r, st) {
    if (!r) return null;
    if (typeof r === 'string') {
      var w1 = parseWinner(r, st);
      return w1 ? { winner: w1, reason: reasonCN(r) } : null;
    }
    if (typeof r === 'object') {
      if (r.over === false || r.gameOver === false || r.finished === false || r.ended === false) return null;
      var cand = [r.winner, r.result, r.status, r.outcome, r.type];
      var w = null;
      for (var i = 0; i < cand.length && !w; i++) w = parseWinner(cand[i], st);
      if (!w && r.draw) w = 'draw';
      var isOver = !!(r.over || r.gameOver || r.finished || r.ended);
      if (!w && isOver) {
        w = (Object.prototype.hasOwnProperty.call(r, 'winner') && r.winner == null) ? 'draw' : opp(st.turn);
      }
      if (!w) return null;
      return { winner: w, reason: reasonCN(r.reason || r.message || r.type || r.status || '') };
    }
    return null;
  }

  function evaluateResult(st) {
    var raw = null;
    try { raw = X.getGameResult(st); } catch (e) { raw = null; }
    var res = normalizeResult(raw, st);
    if (!res) {
      var moves = null;
      try { moves = X.generateMoves(st, st.turn); } catch (e) { moves = null; }
      if (moves && moves.length === 0) {
        res = { winner: opp(st.turn), reason: '' };
      }
    }
    if (res && !res.reason && res.winner !== 'draw' && res.winner === opp(st.turn)) {
      res.reason = safeInCheck(st, st.turn) ? '绝杀' : '困毙';
    }
    return res;
  }

  /* ---------- 棋盘构建 ---------- */
  function buildLines() {
    var U = 100;
    var s = [];
    function ln(x1, y1, x2, y2) {
      s.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>');
    }
    s.push('<rect class="frame-line" x="-16" y="-16" width="832" height="932"/>');
    var r, c;
    for (r = 0; r < ROWS; r++) ln(0, r * U, 8 * U, r * U);
    for (c = 0; c < COLS; c++) {
      if (c === 0 || c === COLS - 1) {
        ln(c * U, 0, c * U, 9 * U);
      } else {
        ln(c * U, 0, c * U, 4 * U);
        ln(c * U, 5 * U, c * U, 9 * U);
      }
    }
    // 九宫斜线
    ln(300, 0, 500, 200);
    ln(500, 0, 300, 200);
    ln(300, 700, 500, 900);
    ln(500, 700, 300, 900);
    // 炮位、兵卒位角标
    var marks = [
      [2, 1], [2, 7], [7, 1], [7, 7],
      [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
      [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]
    ];
    var g = 9, l = 22, d = '';
    marks.forEach(function (m) {
      var y = m[0] * U, x = m[1] * U;
      [-1, 1].forEach(function (dx) {
        if ((m[1] === 0 && dx < 0) || (m[1] === COLS - 1 && dx > 0)) return;
        [-1, 1].forEach(function (dy) {
          d += 'M' + (x + dx * (g + l)) + ' ' + (y + dy * g) +
               'L' + (x + dx * g) + ' ' + (y + dy * g) +
               'L' + (x + dx * g) + ' ' + (y + dy * (g + l)) + ' ';
        });
      });
    });
    s.push('<path class="marker" d="' + d + '"/>');
    // 楚河 漢界
    [['楚', 150], ['河', 260], ['漢', 540], ['界', 650]].forEach(function (t) {
      s.push('<text class="river-text" x="' + t[1] + '" y="450" text-anchor="middle" dominant-baseline="central">' + t[0] + '</text>');
    });
    return '<svg class="board-lines" viewBox="0 0 800 900" aria-hidden="true" focusable="false">' + s.join('') + '</svg>';
  }

  function buildBoard() {
    dom.board.innerHTML = buildLines() + '<div class="points" id="points"></div>';
    var layer = dom.board.querySelector('.points');
    var frag = document.createDocumentFragment();
    pointEls = [];
    for (var i = 0; i < ROWS * COLS; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'point';
      b.dataset.idx = String(i);
      b.style.setProperty('--r', String(rowOf(i)));
      b.style.setProperty('--c', String(colOf(i)));
      b._code = undefined;
      frag.appendChild(b);
      pointEls.push(b);
    }
    layer.appendChild(frag);
    layer.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== layer && !(t.classList && t.classList.contains('point'))) t = t.parentNode;
      if (!t || t === layer) return;
      onPointClick(parseInt(t.dataset.idx, 10));
    });
  }

  function pieceHTML(code) {
    var side = sideOf(code);
    return '<span class="piece ' + side + '" aria-hidden="true"><span class="glyph">' + glyphOf(code) + '</span></span>';
  }

  function pointLabel(i, code) {
    var pos = '第' + rowOf(i) + '行第' + colOf(i) + '列';
    return code ? pos + '，' + SIDE_CN[sideOf(code)] + glyphOf(code) : pos + '，空';
  }

  /* ---------- 渲染 ---------- */
  function isPlayerTurn() {
    return game.ready && !game.over && !game.thinking && current() && current().turn === PLAYER;
  }

  function checkedSide() {
    var st = current();
    if (!st || game.over) return null;
    return safeInCheck(st, st.turn) ? st.turn : null;
  }

  function renderBoard() {
    var st = current();
    if (!st) return;
    var last = game.moves.length ? game.moves[game.moves.length - 1] : null;
    var targets = {};
    game.targets.forEach(function (m) { targets[m.to] = true; });
    var cs = checkedSide();
    var kingIdx = cs ? st.board.indexOf(cs === 'red' ? 'K' : 'k') : -1;

    dom.board.classList.toggle('can-play', isPlayerTurn());

    for (var i = 0; i < pointEls.length; i++) {
      var p = pointEls[i];
      var code = st.board[i] || null;
      if (p._code !== code) {
        p._code = code;
        p.innerHTML = code ? pieceHTML(code) : '';
      }
      var isTarget = !!targets[i];
      p.classList.toggle('has-piece', !!code);
      p.classList.toggle('own', !!code && sideOf(code) === PLAYER);
      p.classList.toggle('selected', game.selected === i);
      p.classList.toggle('target', isTarget);
      p.classList.toggle('capture', isTarget && !!code);
      p.classList.toggle('last-from', !!last && last.from === i);
      p.classList.toggle('last-to', !!last && last.to === i);
      p.classList.toggle('in-check', i === kingIdx);
      p.setAttribute('aria-label', pointLabel(i, code) + (isTarget ? '，可落子' : ''));
      p.setAttribute('aria-pressed', game.selected === i ? 'true' : 'false');
    }
  }

  function renderStatus() {
    var st = current();
    var cs = checkedSide();
    var text;
    var dot = 'red';

    if (!st) return;

    if (game.over && game.result) {
      var w = game.result.winner;
      dot = w === 'draw' ? 'draw' : w;
      text = w === 'draw' ? '对局结束 · 和棋' : '对局结束 · ' + SIDE_CN[w] + '方胜';
    } else if (st.turn === PLAYER) {
      dot = 'red';
      text = '轮到你走 · 红方';
    } else {
      dot = 'black';
      text = '黑方（' + LEVEL_CN[game.level] + '）思考中';
    }

    dom.turnDot.className = 'turn-dot ' + dot;
    dom.turnText.textContent = text;
    dom.turnLine.classList.toggle('thinking', game.thinking && !game.over);

    if (cs) {
      dom.checkText.textContent = cs === PLAYER ? '红方被将，请速应将' : '黑方被将';
      dom.checkAlert.hidden = false;
    } else {
      dom.checkAlert.hidden = true;
    }

    dom.moveCount.textContent = '共 ' + game.moves.length + ' 步';
    dom.undo.disabled = game.moves.length === 0;

    for (var i = 0; i < dom.levelBtns.length; i++) {
      var b = dom.levelBtns[i];
      var on = parseInt(b.dataset.level, 10) === game.level;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    dom.levelNote.textContent = '当前：' + LEVEL_CN[game.level] + ' · 切换即时生效';
  }

  function renderLog() {
    var ol = dom.log;
    var last = game.moves.length ? game.moves[game.moves.length - 1] : null;
    if (ol._count === game.moves.length && ol._last === last) return;
    ol._count = game.moves.length;
    ol._last = last;
    ol.innerHTML = '';

    if (!game.moves.length) {
      var empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = '尚无着法 · 红方先行';
      ol.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    game.moves.forEach(function (m, i) {
      var li = document.createElement('li');
      li.className = 'log-item ' + m.side + (i === game.moves.length - 1 ? ' latest' : '');

      var no = document.createElement('span');
      no.className = 'no';
      no.textContent = (i + 1) + '.';

      var mv = document.createElement('span');
      mv.className = 'mv';
      var side = document.createElement('b');
      side.className = 'side';
      side.textContent = SIDE_CN[m.side];
      mv.appendChild(side);
      mv.appendChild(document.createTextNode(' · ' + glyphOf(m.piece) + ' ' + coord(m.from) + '→' + coord(m.to)));

      li.appendChild(no);
      li.appendChild(mv);

      if (m.captured) {
        var cap = document.createElement('span');
        cap.className = 'cap';
        cap.textContent = '吃' + glyphOf(m.captured);
        li.appendChild(cap);
      }
      frag.appendChild(li);
    });
    ol.appendChild(frag);
    ol.scrollTop = ol.scrollHeight;
  }

  function renderAll() {
    renderBoard();
    renderStatus();
    renderLog();
  }

  function flashCheck() {
    var el = dom.flash;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  /* ---------- 交互 ---------- */
  function clearSelection() {
    game.selected = null;
    game.targets = [];
  }

  function onPointClick(idx) {
    if (!isPlayerTurn()) return;
    var st = current();
    var code = st.board[idx];

    if (game.selected !== null) {
      for (var i = 0; i < game.targets.length; i++) {
        if (game.targets[i].to === idx) {
          commit(game.targets[i]);
          return;
        }
      }
    }

    if (code && sideOf(code) === PLAYER) {
      if (game.selected === idx) {
        clearSelection();
      } else {
        game.selected = idx;
        game.targets = legalFrom(st, idx);
      }
    } else {
      clearSelection();
    }
    renderBoard();
  }

  function commit(move) {
    var st = current();
    var piece = move.piece || st.board[move.from];
    var captured = move.captured !== undefined ? move.captured : st.board[move.to];
    var rec = {
      from: move.from,
      to: move.to,
      piece: piece,
      captured: captured || null,
      side: sideOf(piece) || st.turn
    };

    var next = applySafe(st, move);
    if (!next) {
      clearSelection();
      renderAll();
      return false;
    }

    game.states.push(next);
    game.moves.push(rec);
    clearSelection();

    var res = evaluateResult(next);
    if (res) endGame(res);

    renderAll();

    if (!game.over && safeInCheck(next, next.turn)) flashCheck();
    if (!game.over && next.turn === AI_SIDE) scheduleAI();
    return true;
  }

  /* ---------- AI ---------- */
  function cancelAI() {
    game.aiToken++;
    if (game.aiTimer) clearTimeout(game.aiTimer);
    game.aiTimer = null;
    game.thinking = false;
  }

  function scheduleAI() {
    cancelAI();
    if (game.over) return;
    var st = current();
    if (!st || st.turn !== AI_SIDE) return;

    game.thinking = true;
    var token = ++game.aiToken;
    renderAll();

    var delay = 400 + Math.floor(Math.random() * 401);
    game.aiTimer = setTimeout(function () {
      game.aiTimer = null;
      if (token !== game.aiToken) return;

      var s = current();
      var move = null;
      try {
        move = AI.chooseMove(s, game.level);
      } catch (e) {
        if (window.console) console.error('AI 出错', e);
        move = null;
      }
      if (token !== game.aiToken) return;
      game.thinking = false;

      if (!move) {
        var res = evaluateResult(s) || { winner: PLAYER, reason: '黑方无着可走' };
        endGame(res);
        renderAll();
        return;
      }
      commit(move);
    }, delay);
  }

  /* ---------- 终局 / 弹层 ---------- */
  function endGame(res) {
    game.over = true;
    game.result = res;
    clearSelection();
    cancelAI();
    if (game.modalTimer) clearTimeout(game.modalTimer);
    game.modalTimer = setTimeout(function () {
      game.modalTimer = null;
      if (game.over) showModal(res);
    }, 520);
  }

  function showModal(res) {
    var seal = dom.modalSeal;
    var reason = res.reason ? '（' + res.reason + '）' : '';
    if (res.winner === PLAYER) {
      seal.className = 'modal-seal win';
      seal.textContent = '胜';
      dom.modalTitle.textContent = '红方胜';
      dom.modalDesc.textContent = '恭喜，你以红方取胜' + reason + '！';
    } else if (res.winner === AI_SIDE) {
      seal.className = 'modal-seal lose';
      seal.textContent = '负';
      dom.modalTitle.textContent = '黑方胜';
      dom.modalDesc.textContent = '惜败一局' + reason + '，再接再厉。';
    } else {
      seal.className = 'modal-seal draw';
      seal.textContent = '和';
      dom.modalTitle.textContent = '和棋';
      dom.modalDesc.textContent = '旗鼓相当，握手言和' + reason + '。';
    }
    dom.modal.hidden = false;
    void dom.modal.offsetWidth;
    dom.modal.classList.add('show');
    setTimeout(function () { try { dom.again.focus(); } catch (e) {} }, 60);
  }

  function hideModal() {
    if (game.modalTimer) {
      clearTimeout(game.modalTimer);
      game.modalTimer = null;
    }
    dom.modal.classList.remove('show');
    dom.modal.hidden = true;
  }

  /* ---------- 控制 ---------- */
  function restart() {
    cancelAI();
    hideModal();
    var init;
    try {
      init = X.createInitialState();
    } catch (e) {
      dom.turnText.textContent = '规则引擎初始化失败';
      return;
    }
    if (!init || !init.board) {
      dom.turnText.textContent = '规则引擎返回的局面无效';
      return;
    }
    game.states = [init];
    game.moves = [];
    game.over = false;
    game.result = null;
    clearSelection();
    game.ready = true;
    renderAll();
    if (init.turn === AI_SIDE) scheduleAI();
  }

  function undo() {
    if (!game.moves.length) return;
    cancelAI();
    hideModal();
    game.over = false;
    game.result = null;

    game.states.pop();
    game.moves.pop();
    if (current().turn !== PLAYER && game.moves.length > 0) {
      game.states.pop();
      game.moves.pop();
    }
    clearSelection();
    renderAll();
    if (current().turn === AI_SIDE) scheduleAI();
  }

  function setLevel(n) {
    if (!LEVEL_CN[n]) return;
    game.level = n;
    try { localStorage.setItem(STORE_KEY, String(n)); } catch (e) {}
    renderStatus();
  }

  function loadLevel() {
    try {
      var v = parseInt(localStorage.getItem(STORE_KEY), 10);
      if (LEVEL_CN[v]) game.level = v;
    } catch (e) {}
  }

  /* ---------- 启动 ---------- */
  function init() {
    dom.board = $('board');
    dom.flash = $('checkFlash');
    dom.turnLine = $('turnLine');
    dom.turnDot = $('turnDot');
    dom.turnText = $('turnText');
    dom.checkAlert = $('checkAlert');
    dom.checkText = $('checkText');
    dom.levelBtns = document.querySelectorAll('.level-btn');
    dom.levelNote = $('levelNote');
    dom.restart = $('btnRestart');
    dom.undo = $('btnUndo');
    dom.log = $('moveLog');
    dom.moveCount = $('moveCount');
    dom.modal = $('resultModal');
    dom.modalSeal = $('resultSeal');
    dom.modalTitle = $('resultTitle');
    dom.modalDesc = $('resultDesc');
    dom.again = $('btnAgain');
    dom.review = $('btnReview');

    if (!X || !AI) {
      dom.turnText.textContent = '未能载入 engine.js / ai.js';
      dom.undo.disabled = true;
      return;
    }

    buildBoard();
    loadLevel();

    for (var i = 0; i < dom.levelBtns.length; i++) {
      dom.levelBtns[i].addEventListener('click', function () {
        setLevel(parseInt(this.dataset.level, 10));
      });
    }
    dom.restart.addEventListener('click', restart);
    dom.undo.addEventListener('click', undo);
    dom.again.addEventListener('click', restart);
    dom.review.addEventListener('click', hideModal);
    dom.modal.addEventListener('click', function (e) {
      if (e.target === dom.modal) hideModal();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && !dom.modal.hidden) hideModal();
    });

    restart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
