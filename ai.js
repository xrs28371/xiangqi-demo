(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.XiangqiAI = factory(root.Xiangqi);
}(typeof window !== 'undefined' ? window : globalThis, function (X) {
  'use strict';
  var VALUE = { R: 900, N: 450, C: 450, B: 200, A: 200, P: 100, K: 100000 };
  var MATE = 10000000;
  // Tables use ranks measured from the piece's own home rank.
  var TABLE = {};
  ['P', 'N', 'C', 'R'].forEach(function (type) {
    TABLE[type] = Array.from({ length: 90 }, function (_, i) {
      var rank = Math.floor(i / 9), center = 4 - Math.abs(i % 9 - 4);
      if (type === 'P') return rank * 5 + (rank >= 5 ? center * 9 : 0);
      if (type === 'N') return center * 10 + Math.min(rank, 8) * 4 - (rank === 0 ? 15 : 0);
      if (type === 'C') return center * 6 + (rank >= 2 && rank <= 6 ? 12 : 0);
      return center * 3 + rank * 3;
    });
  });
  function value(piece, index) {
    if (!piece) return 0;
    var t = piece.toUpperCase(), rank = Math.floor(index / 9);
    return VALUE[t] + (t === 'P' && (piece === t ? rank <= 4 : rank >= 5) ? 100 : 0);
  }
  function evaluate(state, advanced, mobilityCount, opponentCount) {
    var score = 0;
    state.board.forEach(function (p, i) {
      if (!p) return;
      var red = X.pieceSide(p) === X.pieceSide('K');
      var rank = red ? 9 - Math.floor(i / 9) : Math.floor(i / 9);
      var t = p.toUpperCase(), center = 4 - Math.abs(i % 9 - 4);
      var positional = advanced && TABLE[t] ? TABLE[t][rank * 9 + i % 9] : center * 2 + (t === 'P' ? rank * 2 : 0);
      score += (red ? 1 : -1) * (value(p, i) + positional);
    });
    if (advanced && mobilityCount !== undefined) {
      var difference = mobilityCount - opponentCount;
      score += (state.turn === 'red' ? difference : -difference) * 3;
    }
    return state.turn === X.pieceSide('K') ? score : -score;
  }
  function order(moves) {
    return moves.slice().sort(function (a, b) {
      return (value(b.captured, b.to) * 16 - value(b.piece, b.from)) -
        (value(a.captured, a.to) * 16 - value(a.piece, a.from));
    });
  }
  function chooseMove(state, level) {
    var moves = X.generateMoves(state, state.turn);
    if (!moves.length) return null;
    level = Number(level) || 1;
    if (level <= 1) {
      var weights = moves.map(function (m) {
        var child = X.applyMove(state, m);
        return 10 + value(m.captured, m.to) / 12 + (X.isInCheck(child, child.turn) ? 35 : 0);
      });
      var pick = Math.random() * weights.reduce(function (a, b) { return a + b; }, 0);
      for (var w = 0; w < moves.length; w++) { pick -= weights[w]; if (pick < 0) return moves[w]; }
      return moves[moves.length - 1];
    }
    var advanced = level >= 3;
    var reflections = new Map();
    var cache = new Map(), moveCache = new Map(), stateKeys = new WeakMap(), history = Object.create(null), preferred = new Map(), killers = [];
    function key(s) {
      var id = stateKeys.get(s);
      if (!id) { id = s.board.map(function (p) { return p || '.'; }).join(''); stateKeys.set(s, id); }
      return id;
    }
    // Horizontal reflection preserves rules, piece-square tables and mobility.
    function reflectedKey(s) {
      var id = key(s), reflected = reflections.get(id);
      if (!reflected) {
        reflected = '';
        for (var r = 0; r < 90; r += 9)
          for (var c = 8; c >= 0; c--) reflected += id[r + c];
        reflections.set(id, reflected);
        reflections.set(reflected, id);
      }
      return reflected;
    }
    function child(s, m) {
      var next = X.applyMove(s, m), id = key(s);
      var lo = Math.min(m.from, m.to), hi = Math.max(m.from, m.to);
      var nextKey = id.slice(0, lo) + (lo === m.from ? '.' : m.piece) +
        id.slice(lo + 1, hi) + (hi === m.from ? '.' : m.piece) + id.slice(hi + 1);
      stateKeys.set(next, nextKey);
      return next;
    }
    function legalMoves(s, side) {
      var id = key(s) + side, found = moveCache.get(id);
      if (!found) { found = X.generateMoves(s, side); moveCache.set(id, found); }
      return found;
    }
    function hasLegalMove(s) {
      var found = moveCache.get(key(s) + s.turn);
      if (found) return found.length > 0;
      for (var i = 0; i < 90; i++) {
        if (X.pieceSide(s.board[i]) === s.turn && X.movesFrom(s, i).length) return true;
      }
      return false;
    }
    function positionalGain(m) {
      var t = m.piece.toUpperCase(), table = TABLE[t];
      if (!table) return 0;
      var red = m.piece === t;
      var from = red ? (9 - Math.floor(m.from / 9)) * 9 + m.from % 9 : m.from;
      var to = red ? (9 - Math.floor(m.to / 9)) * 9 + m.to % 9 : m.to;
      return table[to] - table[from];
    }
    function ranked(legal, s, ply) {
      var preferredMove = s && preferred.get(key(s) + s.turn);
      var ks = killers[ply] || [];
      return legal.map(function (m, index) {
        var priority = (preferredMove && m.from === preferredMove.from && m.to === preferredMove.to ? 100000000 : 0) +
          (m.captured ? 1000000 + value(m.captured, m.to) * 16 - value(m.piece, m.from) : 0) +
          (history[m.from * 90 + m.to] || 0) + positionalGain(m);
        for (var k = 0; k < ks.length; k++) {
          if (ks[k].from === m.from && ks[k].to === m.to) { priority += 500000; break; }
        }
        return { move: m, priority: priority, index: index };
      }).sort(function (a, b) {
        return b.priority - a.priority || a.index - b.index;
      }).map(function (entry) { return entry.move; });
    }
    // TT keys omit ply so transpositions reached by different paths can reuse
    // bounds. Mate distance may consequently differ by a few plies; acceptable
    // here since the immediate mate check below still takes priority.
    // Store bounds separately from exact scores; a cutoff is not an exact evaluation.
    function memo(s, tag, alpha, beta, compute) {
      var boardKey = key(s), reflected = reflectedKey(s);
      var id = (boardKey < reflected ? boardKey : reflected) + s.turn + tag, entry = cache.get(id);
      if (entry) {
        if (entry.kind === 'exact' || entry.kind === 'lower' && entry.score >= beta ||
            entry.kind === 'upper' && entry.score <= alpha) return entry.score;
      }
      var originalAlpha = alpha, originalBeta = beta;
      if (entry) {
        if (entry.kind === 'lower') alpha = Math.max(alpha, entry.score);
        if (entry.kind === 'upper') beta = Math.min(beta, entry.score);
      }
      var score = compute(alpha, beta);
      cache.set(id, { score: score, kind: score <= originalAlpha ? 'upper' : score >= originalBeta ? 'lower' : 'exact' });
      return score;
    }
    function quiet(s, alpha, beta, remaining, ply, legal, initialStand) {
      return memo(s, 'q' + remaining + ':' + (initialStand !== undefined), alpha, beta, function (alpha, beta) {
        return quietBody(s, alpha, beta, remaining, ply, legal, initialStand);
      });
    }
    function quietBody(s, alpha, beta, remaining, ply, legal, initialStand) {
      var checked = X.isInCheck(s, s.turn);
      var stand = initialStand === undefined ? evaluate(s, advanced) : initialStand;
      // At a static horizon or stand-pat cutoff, only existence is needed.
      // movesFrom stops after the first mobile piece instead of enumerating both armies.
      if (!remaining || !checked && stand >= beta) {
        return (legal ? legal.length : hasLegalMove(s)) ? stand : -MATE + ply;
      }
      legal = legal || legalMoves(s, s.turn);
      if (!legal.length) return -MATE + ply;
      if (!checked) {
        alpha = Math.max(alpha, stand);
        legal = legal.filter(function (m) { return m.captured; });
      }
      legal = ranked(legal, s, ply);
      for (var i = 0; i < legal.length; i++) {
        var score = -quiet(child(s, legal[i]), -beta, -alpha, remaining - 1, ply + 1);
        if (score >= beta) return score;
        alpha = Math.max(alpha, score);
      }
      return alpha;
    }
    function search(s, depth, alpha, beta, ply) {
      return memo(s, 's' + depth, alpha, beta, function (alpha, beta) {
        return searchBody(s, depth, alpha, beta, ply);
      });
    }
    function searchBody(s, depth, alpha, beta, ply) {
      if (!depth && !advanced) return hasLegalMove(s) ? evaluate(s, advanced) : -MATE + ply;
      var legal = legalMoves(s, s.turn);
      if (!legal.length) return -MATE + ply;
      if (!depth) {
        // Mobility is evaluated only at the main search horizon, never in extensions.
        var mobility = X.countPseudoMoves(s, s.turn);
        var opponent = X.countPseudoMoves(s, s.turn === 'red' ? 'black' : 'red');
        return quiet(s, alpha, beta, 2, ply, legal, evaluate(s, true, mobility, opponent));
      }
      legal = ranked(legal, s, ply);
      var best = -Infinity;
      for (var i = 0; i < legal.length; i++) {
        var next = child(s, legal[i]);
        var score;
        // PVS: only the first move needs the full window unless a later move
        // improves alpha. Re-search every improvement inside the window.
        if (i && Number.isFinite(alpha)) {
          score = -search(next, depth - 1, -alpha - 1, -alpha, ply + 1);
          if (score > alpha && score < beta)
            score = -search(next, depth - 1, -beta, -alpha, ply + 1);
        } else score = -search(next, depth - 1, -beta, -alpha, ply + 1);
        if (score > best) {
          best = score;
          preferred.set(key(s) + s.turn, legal[i]);
        }
        alpha = Math.max(alpha, score);
        if (alpha >= beta) {
          if (!legal[i].captured) {
            var ks = killers[ply] || [];
            killers[ply] = [legal[i]].concat(ks.filter(function (m) {
              return m.from !== legal[i].from || m.to !== legal[i].to;
            })).slice(0, 2);
            var id = legal[i].from * 90 + legal[i].to;
            history[id] = (history[id] || 0) + depth * depth;
          }
          break;
        }
      }
      return best;
    }
    // Prefer checkmate when both checkmate and stalemate win immediately.
    var immediateWin = null;
    for (var i = 0; i < moves.length; i++) {
      var result = X.getGameResult(X.applyMove(state, moves[i]));
      if (result.over && result.winner === state.turn) {
        if (result.reason === 'checkmate') return moves[i];
        if (!immediateWin) immediateWin = moves[i];
      }
    }
    if (immediateWin) return immediateWin;
    moves = order(moves);
    // File reflection preserves every rule and every evaluation term. On a
    // symmetric root, search one representative of each mirrored move pair.
    var symmetric = state.board.every(function (p, i) {
      return p === state.board[Math.floor(i / 9) * 9 + 8 - i % 9];
    });
    if (symmetric) moves = moves.filter(function (m) {
      var from = Math.floor(m.from / 9) * 9 + 8 - m.from % 9;
      var to = Math.floor(m.to / 9) * 9 + 8 - m.to % 9;
      return m.from * 90 + m.to <= from * 90 + to;
    });
    var bestMove = moves[0], priorScores = new Map();
    // Each iteration searches all root moves together. A shared alpha lets later
    // roots prove they cannot improve the best move without an exact full score.
    // Keep the original depth below each root move (3 / 2), without reductions.
    for (var d = 1; d <= (advanced ? 3 : 2); d++) {
      var bestScore = -Infinity, scores = new Map();
      for (var j = 0; j < moves.length; j++) {
        var next = child(state, moves[j]);
        var score = j ? -search(next, d, -bestScore - 1, -bestScore, 1) :
          -search(next, d, -Infinity, Infinity, 1);
        if (j && score > bestScore)
          score = -search(next, d, -Infinity, -bestScore, 1);
        scores.set(moves[j], score);
        if (score > bestScore) { bestScore = score; bestMove = moves[j]; }
      }
      // Blend consecutive iterations to reduce odd/even ordering swings.
      moves.sort(function (a, b) {
        return scores.get(b) + (priorScores.get(b) || 0) - scores.get(a) - (priorScores.get(a) || 0);
      });
      priorScores = scores;
    }
    return bestMove;
  }
  return { chooseMove: chooseMove };
}));
