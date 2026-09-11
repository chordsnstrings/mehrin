const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const code = buildSync({
  entryPoints: [path.resolve(__dirname, '../src/client/motion.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text;

// Test event lifecycle and native-action safety without simulating visual rendering.
function harness() {
  class Element {
    constructor(tag = 'div', className = '', parent = null) {
      Object.assign(this, { tag, className, parent, disabled: false, dataset: {}, properties: new Map() });
      this.style = { setProperty: (key, value) => this.properties.set(key, value) };
    }
    matches(selector) {
      return selector.split(',').some((part) => {
        const rule = part.trim();
        if (rule === ':disabled') return this.disabled;
        if (rule === '[aria-disabled="true"]') return this.ariaDisabled === 'true';
        if (rule.startsWith('.')) return this.className.split(' ').includes(rule.slice(1));
        return this.tag === rule;
      });
    }
    closest(selector) {
      for (let node = this; node; node = node.parent) if (node.matches(selector)) return node;
      return null;
    }
    getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 48 }; }
    toggleAttribute(name, value) { this.properties.set(name, value); }
  }
  const media = (matches) => Object.assign(new EventTarget(), { matches });
  const reduced = media(false);
  const fine = media(true);
  const timers = new Map();
  const frames = new Map();
  let nextId = 0;
  const document = Object.assign(new EventTarget(), { hidden: false, documentElement: new Element('html') });
  const window = Object.assign(new EventTarget(), {
    matchMedia: (query) => query.includes('reduced-motion') ? reduced : fine,
    setTimeout: (callback) => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, window, document, Element });
  module.exports.initSurfaceMotion();

  function emit(bus, type, target, values = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [name, value] of Object.entries({ target, ...values })) Object.defineProperty(event, name, { value });
    bus.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${type} must retain its native behavior`);
  }
  const flush = (queue) => {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback());
  };
  return { Element, document, window, reduced, fine, timers, frames, emit, flush };
}

const pointer = { pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 40, clientY: 35 };

test('touch feedback releases outside the control, cancels with scrolling, and never blocks activation', () => {
  const h = harness();
  const surface = new h.Element('section', 'glass');
  const button = new h.Element('button', '', surface);
  const icon = new h.Element('span', '', button);
  h.emit(h.document, 'pointerdown', icon, pointer);
  assert.equal(button.dataset.pressed, '');
  assert.equal(button.properties.get('--tap-x'), '30px');
  h.emit(h.window, 'pointercancel', h.document, pointer);
  assert.equal(button.dataset.pressed, undefined);
  assert.equal(button.dataset.bloom, undefined, 'a canceled gesture is not an activation');

  h.emit(h.document, 'pointerdown', icon, pointer);
  h.emit(h.window, 'pointerup', h.document, pointer);
  assert.equal(button.dataset.pressed, undefined);
  h.emit(h.document, 'click', icon, { ...pointer, detail: 1 });
  const firstBloom = button.dataset.bloom;
  h.emit(h.document, 'click', icon, { ...pointer, detail: 1 });
  assert.notEqual(button.dataset.bloom, firstBloom, 'rapid activations restart the light bloom');
  assert.equal(h.timers.size, 2, 'repeated taps replace the control and surface timers');
  h.flush(h.timers);
  assert.equal(button.dataset.bloom, undefined);
  assert.equal(surface.dataset.wake, undefined);

  button.disabled = true;
  h.emit(h.document, 'pointerdown', icon, pointer);
  h.emit(h.document, 'click', icon, { detail: 0 });
  assert.equal(button.dataset.pressed, undefined);
  assert.equal(button.dataset.bloom, undefined);

  // A newly rendered ledger action works through delegation, without another setup call.
  const newAction = new h.Element('button', 'tx-del', surface);
  h.emit(h.document, 'click', newAction, { detail: 0 });
  assert.ok(newAction.dataset.bloom);
});

test('keyboard feedback leaves input entry alone and responds immediately to reduced-motion changes', () => {
  const h = harness();
  const button = new h.Element('button');
  const field = new h.Element('div', 'input-wrap');
  const input = new h.Element('input', '', field);
  h.emit(h.document, 'keydown', input, { key: ' ', repeat: false });
  assert.equal(field.dataset.pressed, undefined);
  h.emit(h.document, 'keydown', button, { key: ' ', repeat: false });
  assert.equal(button.dataset.pressed, '');
  assert.equal(button.properties.get('--tap-x'), '100px');
  h.emit(h.document, 'focusout', button);
  assert.equal(button.dataset.pressed, undefined);
  h.emit(h.document, 'keydown', button, { key: 'Enter', repeat: false });
  h.emit(h.document, 'click', button, { detail: 0 });
  h.emit(h.document, 'keyup', button, { key: 'Enter' });
  assert.equal(button.dataset.pressed, undefined);
  assert.ok(button.dataset.bloom);

  h.reduced.matches = true;
  h.emit(h.reduced, 'change', h.reduced);
  assert.equal(button.dataset.bloom, undefined);
  assert.equal(h.timers.size, 0);
  h.emit(h.document, 'pointerdown', button, pointer);
  h.emit(h.document, 'click', button, { detail: 0 });
  assert.equal(button.dataset.pressed, undefined);
  assert.equal(button.dataset.bloom, undefined);
  h.reduced.matches = false;
  h.emit(h.reduced, 'change', h.reduced);
  h.emit(h.document, 'click', button, { detail: 0 });
  assert.ok(button.dataset.bloom);
});

test('reflections coalesce pointer movement and clean up pending work on blur, scroll and page hiding', () => {
  const h = harness();
  const surface = new h.Element('section', 'glass');
  const button = new h.Element('button', '', surface);
  h.emit(h.document, 'pointermove', surface, pointer);
  assert.equal(h.frames.size, 0, 'touch scrolling does not drive hover effects');
  const mouse = { ...pointer, pointerType: 'mouse' };
  h.emit(h.document, 'pointermove', surface, mouse);
  h.emit(h.document, 'pointermove', surface, { ...mouse, clientX: 90 });
  assert.equal(h.frames.size, 1);
  h.flush(h.frames);
  assert.equal(surface.properties.get('--light-x'), '80px');
  assert.equal(surface.dataset.lit, '');
  h.emit(h.document, 'scroll', h.document);
  assert.equal(surface.dataset.lit, undefined);
  h.emit(h.document, 'pointermove', surface, mouse);
  h.emit(h.document, 'pointerdown', button, mouse);
  h.emit(h.window, 'blur', h.window);
  assert.equal(button.dataset.pressed, undefined);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);

  h.emit(h.document, 'click', button, { detail: 0 });
  h.document.hidden = true;
  h.emit(h.document, 'visibilitychange', h.document);
  assert.equal(button.dataset.bloom, undefined);
  assert.equal(surface.dataset.wake, undefined);
  assert.equal(h.timers.size, 0);
});
