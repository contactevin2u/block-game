/* Adventure mode: 30 stages with goals, stars and coin rewards. Equipment is allowed here. */
(function (root) {
  'use strict';
  var STAGE_COUNT = 30;

  function stage(n) {
    var level = 1 + Math.floor((n - 1) / 3);
    var kind = ['lines', 'score', 'survive'][(n - 1) % 3];
    var goal;
    if (kind === 'lines') goal = { type: 'lines', target: 10 + n * 2, text: 'Clear ' + (10 + n * 2) + ' lines' };
    else if (kind === 'score') goal = { type: 'score', target: 4000 * n, text: 'Score ' + (4000 * n).toLocaleString() };
    else goal = { type: 'survive', target: 60 + n * 10, text: 'Survive ' + (60 + n * 10) + ' seconds' };
    return { n: n, level: level, goal: goal, reward: 50 + n * 10, name: 'Stage ' + n };
  }

  function all() { var out = []; for (var i = 1; i <= STAGE_COUNT; i++) out.push(stage(i)); return out; }

  // Progress check during play. Returns true when the goal is met.
  function goalMet(st, game) {
    var g = st.goal;
    if (g.type === 'lines') return game.lines >= g.target;
    if (g.type === 'score') return game.score >= g.target;
    return game.time >= g.target;
  }
  function progress(st, game) {
    var g = st.goal, v = g.type === 'lines' ? game.lines : g.type === 'score' ? Math.floor(game.score) : Math.floor(game.time);
    return { value: Math.min(v, g.target), target: g.target, pct: Math.min(100, Math.round(v / g.target * 100)) };
  }

  // Stars: 3 clean, 2 with equipment, 1 with a continue.
  function stars(usedEquipment, continued) { return continued ? 1 : usedEquipment ? 2 : 3; }

  function complete(user, st, result) {
    var adv = user.adventure || (user.adventure = { unlocked: 1, stages: {} });
    var prev = adv.stages[st.n] || { stars: 0, best: 0 };
    var s = stars(result.usedEquipment, result.continued);
    var firstTime = !adv.stages[st.n];
    adv.stages[st.n] = { stars: Math.max(prev.stars, s), best: Math.max(prev.best, result.score), at: Date.now() };
    if (st.n >= adv.unlocked && st.n < STAGE_COUNT) adv.unlocked = st.n + 1;
    var coins = firstTime ? st.reward : Math.round(st.reward / 4);
    coins += s * 10;
    // Coins are credited by Backend.saveRun (run.coins), not here.
    return { stars: s, coins: coins, firstTime: firstTime };
  }

  root.Adventure = { COUNT: STAGE_COUNT, stage: stage, all: all, goalMet: goalMet, progress: progress, complete: complete };
})(window);
