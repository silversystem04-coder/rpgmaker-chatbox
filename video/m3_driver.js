// M3 driver: runs inside OMORI (NW.js page) and performs the demo timeline.
// Injected via a temporary <script> tag; writes progress to game/m3.log.
(function () {
  'use strict';
  var FS = null;
  try { FS = require('fs'); } catch (e) {}
  var LOG_PATH = 'C:/Users/Lenovo/Desktop/OMORI-73665/game/m3.log';

  function log(msg) {
    try {
      if (FS) FS.appendFileSync(LOG_PATH, '[' + new Date().toISOString().slice(11, 23) + '] ' + msg + '\n');
    } catch (e) {}
  }

  var CHOICES = [
    'Good Advice (100 Clams)',
    'Bad Advice (3 Clams)',
    'Ok Advice (10 Clams)',
    'No Advice'
  ];

  var started = false;
  var t0 = 0;
  var fired = {};

  function once(key) {
    if (fired[key]) return false;
    fired[key] = true;
    return true;
  }

  function sceneName() {
    try { return SceneManager._scene ? SceneManager._scene.constructor.name : 'none'; } catch (e) { return 'err'; }
  }

  function openChoice() {
    try {
      $gameMessage.clear();
      $gameMessage.add('TT M3 test');
      $gameMessage.setChoices(CHOICES, 0, 0);
      $gameMessage.setChoiceCallback(function (idx) { log('CALLBACK idx=' + idx); });
      log('OPEN');
    } catch (e) { log('OPEN_ERR ' + e.message); }
  }

  function key(k) {
    try {
      var el = document.querySelector('#tt-chat-input') || document;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      log('KEY ' + k);
    } catch (e) { log('KEY_ERR ' + e.message); }
  }

  function type(text) {
    try {
      var inp = document.querySelector('#tt-chat-input');
      if (!inp) { log('NO_INPUT'); return; }
      inp.value = text;
      inp.dispatchEvent(new KeyboardEvent('input', { bubbles: true }));
      log('TYPED ' + text);
    } catch (e) { log('TYPE_ERR ' + e.message); }
  }

  function mouse(target, type, x, y) {
    try {
      var node = (typeof target === 'string') ? document.querySelector(target) : target;
      if (!node) { log('NO_NODE ' + target); return; }
      node.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: 1
      }));
    } catch (e) { log('MOUSE_ERR ' + type + ' ' + e.message); }
  }

  function dragHeader(tx, ty) {
    var head = document.querySelector('#tt-chat-head');
    if (!head) { log('NO_HEAD'); return; }
    var r = head.getBoundingClientRect();
    var sx = r.left + Math.min(80, r.width / 2);
    var sy = r.top + r.height / 2;
    mouse('#tt-chat-head', 'mousedown', sx, sy);
    var steps = 16;
    for (var i = 1; i <= steps; i++) {
      (function (i) {
        setTimeout(function () {
          mouse(document, 'mousemove', sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps);
          if (i === steps) { mouse(document, 'mouseup', tx, ty); log('DRAGGED'); }
        }, i * 20);
      })(i);
    }
  }

  function resizeBox(dw, dh) {
    var grip = document.querySelector('#tt-chat-grip');
    if (!grip) { log('NO_GRIP'); return; }
    var r = grip.getBoundingClientRect();
    var sx = r.left + r.width / 2;
    var sy = r.top + r.height / 2;
    mouse('#tt-chat-grip', 'mousedown', sx, sy);
    var steps = 14;
    for (var i = 1; i <= steps; i++) {
      (function (i) {
        setTimeout(function () {
          mouse(document, 'mousemove', sx + dw * i / steps, sy + dh * i / steps);
          if (i === steps) { mouse(document, 'mouseup', sx + dw, sy + dh); log('RESIZED'); }
        }, i * 22);
      })(i);
    }
  }

  function tick() {
    if (!window.$gameMessage) return;

    if (!started) {
      var sn = sceneName();
      if (/Title/i.test(sn)) {
        started = true;
        log('TITLE ' + sn);
        try {
          DataManager.setupNewGame();
          SceneManager.goto(Scene_Map);
          log('GOTO_MAP');
        } catch (e) { log('SETUP_ERR ' + e.message); }
      }
      return;
    }

    var now = Date.now();
    if (!t0) {
      if (sceneName() === 'Scene_Map') { t0 = now; log('MAP_READY'); }
      return;
    }

    var t = now - t0;
    if (t > 3000 && once('open')) openChoice();
    if (t > 5200 && once('type')) { type('bad advice'); setTimeout(function () { key('Enter'); }, 800); }
    if (t > 7200 && once('drag')) dragHeader(120, 380);
    if (t > 9400 && once('resize')) resizeBox(140, 80);
    if (t > 12000 && once('apply')) key('Enter');
    if (t > 13500 && once('done')) log('DONE');
  }

  setInterval(tick, 50);
  log('DRIVER_LOADED');
})();
