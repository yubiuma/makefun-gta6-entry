// The five screens the game moves between, named in one place so the simulation
// staging, the renderer, the HUD and the main loop all agree on the strings —
// and so the shot scenes can be staged in plain node without three.js.
export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';
