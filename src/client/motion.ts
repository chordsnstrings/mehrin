/** Decorative feedback only: native clicks, focus, scrolling and form submission stay in charge. */
export function initSurfaceMotion(): void {
  if (typeof window.matchMedia !== 'function') return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const presses = new Map<number, HTMLElement>();
  const blooms = new Map<HTMLElement, number>();
  const wakes = new Map<HTMLElement, number>();
  const bloomVersions = new WeakMap<HTMLElement, boolean>();
  let keyboardPress: HTMLElement | null = null;
  let litSurface: HTMLElement | null = null;
  let frame = 0;
  let pendingLight: { surface: HTMLElement; x: number; y: number } | null = null;

  const controlAt = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || target.closest(':disabled, [aria-disabled="true"]')) return null;
    return target.closest<HTMLElement>('button, summary, .input-wrap');
  };
  const surfaceAt = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.glass') : null;

  function position(node: HTMLElement, x: number | undefined, y: number | undefined, kind: 'tap' | 'light'): void {
    const rect = node.getBoundingClientRect();
    const localX = x == null ? rect.width / 2 : Math.max(0, Math.min(rect.width, x - rect.left));
    const localY = y == null ? rect.height / 2 : Math.max(0, Math.min(rect.height, y - rect.top));
    node.style.setProperty(`--${kind}-x`, `${localX}px`);
    node.style.setProperty(`--${kind}-y`, `${localY}px`);
    if (kind === 'tap') node.style.setProperty('--tap-size', `${Math.hypot(rect.width, rect.height) * 2}px`);
  }

  function wake(surface: HTMLElement | null, x?: number, y?: number): void {
    if (!surface) return;
    window.clearTimeout(wakes.get(surface));
    position(surface, x, y, 'light');
    surface.dataset.wake = '';
    wakes.set(surface, window.setTimeout(() => {
      delete surface.dataset.wake;
      wakes.delete(surface);
    }, 650));
  }

  function press(control: HTMLElement, x?: number, y?: number): void {
    window.clearTimeout(blooms.get(control));
    blooms.delete(control);
    delete control.dataset.bloom;
    position(control, x, y, 'tap');
    control.dataset.pressed = '';
  }

  function releasePointer(event: PointerEvent): void {
    const control = presses.get(event.pointerId);
    if (control) delete control.dataset.pressed;
    presses.delete(event.pointerId);
  }

  function releaseKeyboard(): void {
    if (keyboardPress) delete keyboardPress.dataset.pressed;
    keyboardPress = null;
  }

  function clearLight(): void {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    pendingLight = null;
    if (litSurface) delete litSurface.dataset.lit;
    litSurface = null;
  }

  function reset(): void {
    clearLight();
    releaseKeyboard();
    for (const control of presses.values()) delete control.dataset.pressed;
    presses.clear();
    for (const [control, timer] of blooms) {
      window.clearTimeout(timer);
      delete control.dataset.bloom;
    }
    blooms.clear();
    for (const [surface, timer] of wakes) {
      window.clearTimeout(timer);
      delete surface.dataset.wake;
    }
    wakes.clear();
  }

  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion.matches || event.button !== 0 || event.isPrimary === false) return;
    const control = controlAt(event.target);
    if (control) {
      press(control, event.clientX, event.clientY);
      presses.set(event.pointerId, control);
    }
    wake(surfaceAt(event.target), event.clientX, event.clientY);
  }, { passive: true });
  window.addEventListener('pointerup', releasePointer, { passive: true });
  window.addEventListener('pointercancel', releasePointer, { passive: true });

  // Capture the activation before a handler disables a submit button or opens a dialog.
  document.addEventListener('click', (event) => {
    if (reducedMotion.matches) return;
    const control = controlAt(event.target);
    if (!control) return;
    const x = event.detail === 0 ? undefined : event.clientX;
    const y = event.detail === 0 ? undefined : event.clientY;
    delete control.dataset.pressed;
    position(control, x, y, 'tap');
    window.clearTimeout(blooms.get(control));
    const version = !bloomVersions.get(control);
    bloomVersions.set(control, version);
    control.dataset.bloom = version ? 'a' : 'b';
    blooms.set(control, window.setTimeout(() => {
      delete control.dataset.bloom;
      blooms.delete(control);
    }, 550));
    wake(surfaceAt(control), x, y);
  }, { capture: true, passive: true });

  document.addEventListener('keydown', (event) => {
    if (reducedMotion.matches || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const control = controlAt(event.target);
    if (!control?.matches('button, summary')) return;
    releaseKeyboard();
    keyboardPress = control;
    press(control);
  }, { capture: true, passive: true });
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') releaseKeyboard();
  }, { passive: true });
  document.addEventListener('focusout', releaseKeyboard, { passive: true });
  document.addEventListener('focusin', (event) => {
    if (!reducedMotion.matches) wake(surfaceAt(event.target));
  }, { passive: true });

  document.addEventListener('pointermove', (event) => {
    if (reducedMotion.matches || !hoverPointer.matches || event.pointerType === 'touch') return;
    const surface = surfaceAt(event.target);
    if (!surface) { clearLight(); return; }
    pendingLight = { surface, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!pendingLight) return;
      const { surface: next, x, y } = pendingLight;
      pendingLight = null;
      if (litSurface !== next && litSurface) delete litSurface.dataset.lit;
      litSurface = next;
      position(next, x, y, 'light');
      next.dataset.lit = '';
    });
  }, { passive: true });
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) clearLight();
  }, { passive: true });
  document.addEventListener('scroll', clearLight, { capture: true, passive: true });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => {
    document.documentElement.toggleAttribute('data-page-hidden', document.hidden);
    if (document.hidden) reset();
  });
  reducedMotion.addEventListener('change', reset);
  hoverPointer.addEventListener('change', clearLight);
}
