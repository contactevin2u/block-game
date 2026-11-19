/* Sound: a calm generated soundtrack plus soft effects, all made with the Web Audio API. No files, no licences.
   Browsers only allow audio after the player touches or presses something, so everything starts lazily. */
(function (root) {
  'use strict';
  var ctx = null, master = null, musicBus = null, sfxBus = null, delay = null;
  var settings = { music: true, sfx: true, volume: 0.7 };
  var music = { on: false, timer: null, nextChord: 0, chordIdx: 0, nextPluck: 0, voices: [] };
  var unlocked = false;

  var NOTE = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };
  // Relaxed progression in C: Cmaj7, Am7, Fmaj7, G6 (MIDI numbers), 6 seconds per chord.
  var CHORDS = [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 52]];
  var BASS = [36, 33, 29, 31];
  var PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
  var CHORD_SECONDS = 6;

  function ensure() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = settings.volume;
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = settings.music ? 1 : 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx ? 1 : 0; sfxBus.connect(master);
    // A soft echo for the plucked notes.
    delay = ctx.createDelay(1.0); delay.delayTime.value = 0.42;
    var fb = ctx.createGain(); fb.gain.value = 0.32;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    delay.connect(fb); fb.connect(lp); lp.connect(delay); delay.connect(musicBus);
    return true;
  }
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
    if (music.on && !music.timer) startScheduler();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { root.addEventListener(ev, unlock, { passive: true }); });

  // ---- music ------------------------------------------------------------------------
  function pad(midi, t, dur) {
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 1.8); g.gain.setValueAtTime(0.045, t + dur - 2.2); g.gain.linearRampToValueAtTime(0, t + dur);
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(1100, t + dur / 2); f.frequency.linearRampToValueAtTime(600, t + dur);
    [-6, 6].forEach(function (cents) { var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = NOTE(midi); o.detune.value = cents; o.connect(f); o.start(t); o.stop(t + dur + 0.1); });
    f.connect(g); g.connect(musicBus);
  }
  function bass(midi, t, dur) {
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(midi);
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.8); g.gain.setValueAtTime(0.09, t + dur - 1.5); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.1);
  }
  function pluck(midi, t, vol) {
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(midi);
    var o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = NOTE(midi) * 2;
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    var g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musicBus); g.connect(delay);
    o.start(t); o.stop(t + 1.7); o2.start(t); o2.stop(t + 1.7);
  }
  function schedule() {
    var now = ctx.currentTime, horizon = now + 0.6;
    while (music.nextChord < horizon) {
      var t = Math.max(music.nextChord, now), chord = CHORDS[music.chordIdx % CHORDS.length];
      chord.forEach(function (m) { pad(m, t, CHORD_SECONDS + 1.5); });
      bass(BASS[music.chordIdx % BASS.length], t, CHORD_SECONDS);
      music.chordIdx++; music.nextChord = t + CHORD_SECONDS;
    }
    while (music.nextPluck < horizon) {
      var tp = Math.max(music.nextPluck, now);
      if (Math.random() < 0.7) pluck(PENTA[Math.floor(Math.random() * PENTA.length)], tp, 0.035 + Math.random() * 0.02);
      music.nextPluck = tp + 0.75 * (1 + Math.floor(Math.random() * 3));
    }
  }
  function startScheduler() {
    if (!ctx || music.timer) return;
    music.nextChord = ctx.currentTime + 0.1; music.nextPluck = ctx.currentTime + 2; music.chordIdx = 0;
    schedule(); music.timer = setInterval(schedule, 250);
  }
  function stopScheduler() { if (music.timer) { clearInterval(music.timer); music.timer = null; } }

  // ---- effects ----------------------------------------------------------------------
  function tone(freq, t, dur, vol, type, to) {
    var o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, vol, from, to) {
    var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = ctx.createBufferSource(); s.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    var g = ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur);
  }
  var SFX = {
    move: function (t) { tone(520, t, 0.04, 0.05, 'triangle'); },
    rotate: function (t) { tone(700, t, 0.07, 0.06, 'sine', 960); },
    hold: function (t) { tone(600, t, 0.06, 0.05); tone(800, t + 0.06, 0.08, 0.05); },
    drop: function (t) { noise(t, 0.14, 0.18, 2400, 300); tone(160, t + 0.02, 0.1, 0.08); },
    lock: function (t) { tone(190, t, 0.09, 0.07, 'triangle', 120); },
    clear1: function (t) { tone(660, t, 0.25, 0.09); },
    clear2: function (t) { tone(660, t, 0.2, 0.08); tone(830, t + 0.08, 0.3, 0.08); },
    clear3: function (t) { tone(660, t, 0.2, 0.08); tone(830, t + 0.08, 0.2, 0.08); tone(990, t + 0.16, 0.35, 0.08); },
    clear4: function (t) { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, t + i * 0.07, 0.45, 0.09); }); noise(t, 0.3, 0.05, 4000, 800); },
    tspin: function (t) { [784, 988, 1175, 1568].forEach(function (f, i) { tone(f, t + i * 0.06, 0.4, 0.08, 'triangle'); }); },
    level: function (t) { [523, 659, 784].forEach(function (f, i) { tone(f, t + i * 0.12, 0.4, 0.09); }); },
    garbage: function (t) { noise(t, 0.25, 0.2, 500, 120); tone(90, t, 0.25, 0.1, 'sine', 60); },
    shield: function (t) { tone(1047, t, 0.5, 0.09); tone(1319, t + 0.1, 0.6, 0.07); },
    over: function (t) { [392, 330, 262].forEach(function (f, i) { tone(f, t + i * 0.28, 0.6, 0.1, 'triangle'); }); },
    win: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, t + i * 0.1, 0.6, 0.1); }); },
    tick: function (t) { tone(880, t, 0.05, 0.05); },
    start: function (t) { tone(1319, t, 0.3, 0.08); }
  };

  var Audio = {
    apply: function (s) {
      settings.music = s.music !== false && s.sound !== false;
      settings.sfx = s.sfx !== false && s.sound !== false;
      settings.volume = typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.7;
      if (!ctx) return;
      master.gain.setTargetAtTime(settings.volume, ctx.currentTime, 0.05);
      musicBus.gain.setTargetAtTime(settings.music ? 1 : 0, ctx.currentTime, 0.2);
      sfxBus.gain.setTargetAtTime(settings.sfx ? 1 : 0, ctx.currentTime, 0.05);
    },
    startMusic: function () { music.on = true; if (unlocked && ensure()) { if (ctx.state === 'suspended') ctx.resume(); startScheduler(); } },
    stopMusic: function () { music.on = false; stopScheduler(); },
    duck: function (on) { if (ctx) musicBus.gain.setTargetAtTime(!settings.music ? 0 : (on ? 0.35 : 1), ctx.currentTime, 0.2); },
    sfx: function (name) { if (!settings.sfx || !unlocked || !ensure() || !SFX[name]) return; try { SFX[name](ctx.currentTime); } catch (e) {} },
    preview: function () { unlock(); this.sfx('clear4'); }
  };
  root.Audio = Audio;
})(window);
