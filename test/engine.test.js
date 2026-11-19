// Run: node test/engine.test.js
require('../js/engine.js'); require('../js/bot.js');
var E = globalThis.Engine, Bot = globalThis.Bot;
var fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }

// 1. 7-bag: every 7 draws contain each piece once
var g = new E.Game({ seed: 42 });
var seen = {};
var seq = [g.current.type].concat(g.queue);
while (seq.length < 14) { g.hardDrop(); g.update(0.5); seq.push(g.queue[g.queue.length - 1]); }
var bag1 = seq.slice(0, 7).sort().join(''), bag2 = seq.slice(7, 14).sort().join('');
check('7-bag first bag', bag1 === 'IJLOSTZ');
check('7-bag second bag', bag2 === 'IJLOSTZ');

// 2. Same seed, same sequence
var a = new E.Game({ seed: 7 }), b = new E.Game({ seed: 7 });
check('seeded sequence matches', a.queue.join('') === b.queue.join('') && a.current.type === b.current.type);

// 3. Gravity table
check('gravity level 1 = 1s', Math.abs(E.gravitySeconds(1) - 1) < 1e-9);
check('gravity level 10 faster than level 5', E.gravitySeconds(10) < E.gravitySeconds(5));

// 4. Hard drop locks and spawns the next piece
var g2 = new E.Game({ seed: 1 });
var first = g2.current.type;
g2.hardDrop(); g2.update(0.01);
check('hard drop locks piece', g2.stats.pieces === 2 && g2.current && g2.current.type !== undefined);
check('first piece landed on floor', g2.grid[E.ROWS - 1].some(function (c) { return c === first; }));

// 5. Line clear scoring: build 9 cells on bottom row then drop a vertical I in column 9
var g3 = new E.Game({ seed: 3, clearDuration: 0.1 });
for (var y = E.ROWS - 4; y < E.ROWS; y++) for (var x = 0; x < 9; x++) g3.grid[y][x] = 'J';
g3.current = { type: 'I', rot: 1, x: 7, y: 0 }; // vertical I in column x+2 = 9
g3.hardDrop();
check('tetris detected (as perfect clear on an empty board)', g3.lastClear && g3.lastClear.lines === 4 && g3.lastClear.perfect);
check('tetris scores 800 at level 1', g3.score >= 800);
g3.update(0.2);
check('rows removed after clear', g3.grid[E.ROWS - 1].every(function (c) { return !c; }));
check('level up after 10 lines not yet', g3.level === 1);

// 6. SRS kick: T piece rotates into a T-slot (T-spin double)
var g4 = new E.Game({ seed: 5, clearDuration: 0.1 });
// Build a TSD setup: rows 20,21 full except columns 4 (row 20) and 3,4,5 overhang shape
var R = E.ROWS;
for (var x2 = 0; x2 < 10; x2++) { g4.grid[R - 1][x2] = 'J'; g4.grid[R - 2][x2] = 'J'; }
g4.grid[R - 1][4] = 0; g4.grid[R - 2][3] = 0; g4.grid[R - 2][4] = 0; g4.grid[R - 2][5] = 0;
g4.grid[R - 3][2] = 'L'; g4.grid[R - 3][6] = 'L'; g4.grid[R - 3][5] = 'L'; // overhang on right, open on left
// T piece pointing down, placed to the left of the slot at row R-3 then rotated in
g4.current = { type: 'T', rot: 2, x: 3, y: R - 4 }; // rot 2 = pointing down, cells (3,R-3),(4,R-3),(5,R-3),(4,R-2)
// That overlaps the L at (5,R-3); instead place rot 3 (pointing left) hanging at x=3
g4.current = { type: 'T', rot: 1, x: 2, y: R - 4 };
var moved = g4.rotateCW(); // to rot 2 with a kick
check('T rotates into slot with kick', moved && g4.current.rot === 2);
g4.hardDrop();
check('T-spin recognised', g4.lastClear && /T-spin/.test(g4.lastClear.label));

// 7. Garbage insertion keeps one hole and shifts stack up
var g5 = new E.Game({ seed: 9 });
g5.grid[R - 1][0] = 'J';
g5.receiveGarbage(2); g5.applyGarbage();
var holes = g5.grid[R - 1].filter(function (c) { return !c; }).length;
check('garbage row has one hole', holes === 1 && g5.grid[R - 1].indexOf('G') >= 0);
check('old stack shifted up by 2', g5.grid[R - 3][0] === 'J');

// 8. Bot plays 300 pieces without crashing and clears lines
var g6 = new E.Game({ seed: 11, clearDuration: 0.05 });
var bot = new Bot(g6, { actionInterval: 0.01, thinkDelay: 0, mistake: 0 });
var steps = 0;
while (!g6.over && g6.stats.pieces < 300 && steps < 200000) { bot.update(0.02); g6.update(0.02); steps++; }
check('bot survives 300 pieces', !g6.over && g6.stats.pieces >= 300);
check('bot clears lines', g6.lines > 40);
console.log('bot: pieces ' + g6.stats.pieces + ', lines ' + g6.lines + ', score ' + Math.floor(g6.score) + ', tetrises ' + g6.stats.tetrises);

// 9. Random player does eventually top out (gravity 20G at high level)
var g7 = new E.Game({ seed: 13, startLevel: 15, clearDuration: 0.05 });
var n = 0;
while (!g7.over && n < 5000) { var r = Math.random(); if (r < 0.3) g7.moveLeft(); else if (r < 0.6) g7.moveRight(); else if (r < 0.8) g7.rotateCW(); else g7.hardDrop(); g7.update(0.05); n++; }
check('random play tops out', g7.over);

// 10. Continue clears the top half and resumes
g7.continueRun(); g7.update(0.5);
check('continue resumes play', !g7.over && g7.continues === 1 && g7.phase === 'play');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
