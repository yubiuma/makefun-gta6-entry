// Keyboard and pointer input. Held keys give a movement vector, a sprint flag and the mouse
// state (aim and trigger); one-shot presses are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost and never counted twice.

export const ACTION_ENTER = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CONFIRM = 4;
export const ACTION_MUTE = 8;
export const ACTION_RESTART = 16;

const KEYMAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export function createInput(canvas) {
  const held = { up: false, down: false, left: false, right: false };
  const mouse = { clientX: 0, clientY: 0, down: false };
  let sprint = false;
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    const direction = KEYMAP[event.code];
    if (direction) held[direction] = true;
    else if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') sprint = true;
    else if (event.code === 'KeyE' || event.code === 'KeyF') {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (event.code === 'Enter' || event.code === 'Space') {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (event.code === 'KeyM') {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (event.code === 'KeyR') {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    const direction = KEYMAP[event.code];
    if (direction) held[direction] = false;
    else if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') sprint = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = false;
    sprint = false;
    mouse.down = false;
  });
  window.addEventListener('mousemove', (event) => {
    mouse.clientX = event.clientX;
    mouse.clientY = event.clientY;
  });
  canvas.addEventListener('pointerdown', (event) => {
    mouse.down = true;
    mouse.clientX = event.clientX;
    mouse.clientY = event.clientY;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    mouse.down = false;
  });

  return {
    mouse,
    /** The held movement direction as a unit-ish vector (not normalised on diagonals). */
    moveX() {
      return (held.right ? 1 : 0) - (held.left ? 1 : 0);
    },
    moveY() {
      return (held.down ? 1 : 0) - (held.up ? 1 : 0);
    },
    sprint() {
      return sprint;
    },
    /** True while the mouse button is held: the trigger. */
    firing() {
      return mouse.down;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
