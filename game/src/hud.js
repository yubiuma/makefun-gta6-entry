// The HUD: DOM elements over the 3D view (bars, money, stars, objective, prompts,
// banners and the menu screens) plus a 2D canvas minimap in the corner — the same
// instruments the top-down version painted, in the same places, reading the same
// ui object main.js builds each frame. Only the world view went 3D; the cockpit
// stayed familiar on purpose.
import { CALLSIGNS, CAR, CITY, PALETTE, PLAYER, RADIO } from './config.js';
import { angleDiff, clamp } from './geom.js';
import { airUnit } from './air.js';

const MINIMAP_SIZE = 196;
/** World units from the radar's centre to its rim. */
const RADAR_RANGE = 470;
/** Named places on the radar: special key, glyph, disc colour. */
const POI_GLYPHS = [
  ['noodle', 'D', PALETTE.npc], ['safehouse', 'R', '#c9d3e6'], ['garage', 'G', PALETTE.garage],
  ['bank', '$', '#9fe870'], ['hospital', '+', '#ff8a8a'], ['hotel', 'H', '#c8a6e8'],
  ['cannery', 'C', '#d9b07a'], ['marina', 'M', '#7fc6ef'], ['station', 'S', '#aab8d0'], ['market', 'P', '#b9d39a'],
];

/** Dee's phone portrait, painted once: black bob and fringe, pink jacket, phone at
 *  her ear, and the red noodle-bar neon behind her rimming one side of her face. */
function drawPortrait(canvas) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const bg = g.createLinearGradient(0, 0, 0, W);
  bg.addColorStop(0, '#2a1630');
  bg.addColorStop(1, '#0d0a14');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, W);
  const glow = g.createRadialGradient(W * 0.8, W * 0.18, 2, W * 0.8, W * 0.18, W * 0.62);
  glow.addColorStop(0, 'rgba(230, 80, 60, 0.8)');
  glow.addColorStop(1, 'rgba(230, 80, 60, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, W);
  const shape = (fill, draw) => { g.fillStyle = fill; g.beginPath(); draw(); g.fill(); };
  // Jacket, shoulders and a dark top at the collar.
  shape(PALETTE.npc, () => {
    g.moveTo(W * 0.06, W);
    g.quadraticCurveTo(W * 0.12, W * 0.71, W * 0.5, W * 0.69);
    g.quadraticCurveTo(W * 0.88, W * 0.71, W * 0.94, W);
  });
  shape('#1b1720', () => { g.moveTo(W * 0.41, W * 0.7); g.lineTo(W * 0.5, W * 0.88); g.lineTo(W * 0.59, W * 0.7); });
  // Hair behind the head, then neck and face.
  shape('#16121c', () => g.ellipse(W * 0.5, W * 0.42, W * 0.25, W * 0.25, 0, 0, Math.PI * 2));
  g.fillRect(W * 0.25, W * 0.4, W * 0.5, W * 0.22);
  shape('#b98a6c', () => g.rect(W * 0.43, W * 0.55, W * 0.14, W * 0.17));
  shape('#d6a585', () => g.ellipse(W * 0.5, W * 0.44, W * 0.165, W * 0.2, 0, 0, Math.PI * 2));
  // The fringe: a straight cut just above the brows.
  shape('#16121c', () => g.ellipse(W * 0.5, W * 0.31, W * 0.2, W * 0.1, 0, Math.PI, 0));
  g.fillRect(W * 0.31, W * 0.3, W * 0.38, W * 0.07);
  // Eyes (one brow raised), lips.
  g.fillStyle = '#1b1720';
  g.fillRect(W * 0.4, W * 0.435, W * 0.065, W * 0.026);
  g.fillRect(W * 0.535, W * 0.435, W * 0.065, W * 0.026);
  g.fillRect(W * 0.53, W * 0.395, W * 0.08, W * 0.016);
  g.fillStyle = '#b8456a';
  g.fillRect(W * 0.45, W * 0.545, W * 0.1, W * 0.026);
  // Phone at her ear, and the neon rim light.
  g.fillStyle = '#2b2f36';
  g.fillRect(W * 0.66, W * 0.37, W * 0.07, W * 0.18);
  g.strokeStyle = 'rgba(255, 150, 190, 0.85)';
  g.lineWidth = W * 0.018;
  g.beginPath();
  g.ellipse(W * 0.5, W * 0.44, W * 0.165, W * 0.2, 0, -1.1, 0.9);
  g.stroke();
}

/** A patrol unit's job in the pursuit, read from where it sits relative to the player. */
function unitRole(player, car, heading) {
  const dx = car.x - player.x;
  const dy = car.y - player.y;
  const d = Math.hypot(dx, dy);
  const ahead = dx * Math.cos(heading) + dy * Math.sin(heading);
  const side = -dx * Math.sin(heading) + dy * Math.cos(heading);
  if (d > 520) return ['RESPONDING', false];
  if (ahead > 70 && Math.abs(side) < 60) return ['CUTTING AHEAD', true];
  if (Math.abs(side) >= 15 && ahead > -70 && ahead < 90) return [side < 0 ? 'FLANKING L' : 'FLANKING R', true];
  if (ahead < 0 && Math.abs(side) < 30 && d < 180) return ['ON BUMPER', true];
  return [ahead < 0 ? 'PURSUING' : 'INTERCEPT', false];
}

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const root = el('hud');
  const topLeft = el('top-left');
  const topRight = el('top-right');
  const hpFill = el('hp-fill');
  const carWrap = el('car-wrap');
  const carFill = el('car-fill');
  const money = el('money');
  const starsBox = el('stars');
  const bustWrap = el('bust-wrap');
  const bustFill = el('bust-fill');
  const bustLabel = el('bust-label');
  const carrying = el('carrying');
  const passengerLine = el('passenger-line');
  const objective = el('objective');
  const objTitle = el('obj-title');
  const objText = el('obj-text');
  const timer = el('timer');
  const meterWrap = el('meter-wrap');
  const meterLabel = el('meter-label');
  const meterFill = el('meter-fill');
  const speed = el('speed');
  const speedNum = el('speed-num');
  const prompt = el('prompt');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const arrow = el('edge-arrow');
  const arrowGlyph = el('arrow-glyph');
  const arrowDist = el('arrow-dist');
  const flash = el('flash');
  const titleScreen = el('title-screen');
  const saveLine = el('save-line');
  const muteLine = el('mute-line');
  const panelScreen = el('panel-screen');
  const panelTitle = el('panel-title');
  const panelLines = el('panel-lines');
  const panelPrompt = el('panel-prompt');
  const dispatch = el('dispatch');
  const dispatchRows = el('dispatch-rows');
  const radio = el('radio');
  const radioName = el('radio-name');
  const radioTrack = el('radio-track');
  const radioBars = [...el('radio-eq').children];
  const dialogue = el('dialogue');
  const dialogueVia = el('dialogue-via');
  const dialogueText = el('dialogue-text');
  const storyRow = el('story-row');
  const storyCount = el('story-count');
  const storyPips = el('story-pips');
  const storyRep = el('story-rep');
  drawPortrait(el('dee-portrait'));
  const minimap = el('minimap');
  const mctx = minimap.getContext('2d');

  const starSpans = [];
  for (let i = 0; i < 5; i += 1) {
    const span = document.createElement('span');
    span.textContent = '★';
    starsBox.appendChild(span);
    starSpans.push(span);
  }

  // ------------------------------------------------------------ the minimap

  /** Radar: a disc centred on the player, heading up, about 940 world units across,
   *  in a night palette, with POI glyphs, police cones, AIR-1 and a route to the marker. */
  function drawMinimap(world, ui, city) {
    const state = world.state;
    const R = MINIMAP_SIZE / 2;
    const player = state.player;
    const heading = player.inCar && player.car ? player.car.angle : player.angle;
    const s = (R - 5) / RADAR_RANGE;
    const rot = -heading - Math.PI / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const toRadar = (wx, wy) => {
      const dx = (wx - player.x) * s;
      const dy = (wy - player.y) * s;
      return [R + dx * cos - dy * sin, R + dx * sin + dy * cos];
    };
    const atRim = (wx, wy, inset) => {
      const [px, py] = toRadar(wx, wy);
      const d = Math.hypot(px - R, py - R);
      const max = R - inset;
      return d <= max ? [px, py, false] : [R + (px - R) * max / d, R + (py - R) * max / d, true];
    };
    mctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    mctx.save();
    mctx.beginPath();
    mctx.arc(R, R, R - 1, 0, Math.PI * 2);
    mctx.fillStyle = 'rgba(6, 9, 16, 0.92)';
    mctx.fill();
    mctx.clip();

    // The streets, in world space under the radar's rotation.
    mctx.save();
    mctx.translate(R, R);
    mctx.rotate(rot);
    mctx.scale(s, s);
    mctx.translate(-player.x, -player.y);
    mctx.fillStyle = '#34405a';
    mctx.fillRect(0, 0, city.size, city.size);
    mctx.fillStyle = '#161c2b';
    for (let row = 0; row < CITY.rows; row += 1) {
      for (let col = 0; col < CITY.cols; col += 1) {
        mctx.fillRect(col * CITY.pitch + CITY.road, row * CITY.pitch + CITY.road, CITY.block, CITY.block);
      }
    }
    mctx.fillStyle = '#15301f';
    for (const park of city.parks) mctx.fillRect(park.x, park.y, park.w, park.h);
    mctx.fillStyle = '#26304a';
    for (const b of city.buildings) mctx.fillRect(b.x, b.y, b.w, b.h);
    mctx.strokeStyle = 'rgba(255, 214, 120, 0.4)';
    mctx.lineWidth = 5;
    mctx.setLineDash([22, 18]);
    mctx.beginPath();
    for (let i = 0; i <= CITY.cols; i += 1) {
      const c = i * CITY.pitch + CITY.road / 2;
      mctx.moveTo(c, 0);
      mctx.lineTo(c, city.size);
      mctx.moveTo(0, c);
      mctx.lineTo(city.size, c);
    }
    mctx.stroke();
    mctx.setLineDash([]);
    mctx.restore();

    // A slow sweep and two range rings.
    const sweep = (state.time * 1.6) % (Math.PI * 2);
    const grad = mctx.createConicGradient(sweep, R, R);
    grad.addColorStop(0, 'rgba(110, 200, 255, 0.22)');
    grad.addColorStop(0.12, 'rgba(110, 200, 255, 0)');
    grad.addColorStop(1, 'rgba(110, 200, 255, 0)');
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    mctx.strokeStyle = 'rgba(140, 170, 255, 0.16)';
    mctx.lineWidth = 1;
    for (const f of [0.36, 0.7]) {
      mctx.beginPath();
      mctx.arc(R, R, R * f, 0, Math.PI * 2);
      mctx.stroke();
    }

    // Named places as glyphs.
    mctx.font = '800 8.5px system-ui, sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    for (const [key, glyph, color] of POI_GLYPHS) {
      const place = city.specials[key];
      if (!place) continue;
      const [px, py, clipped] = atRim(place.x, place.y, 8);
      if (clipped && key !== 'garage') continue;
      mctx.globalAlpha = clipped ? 0.6 : 1;
      mctx.fillStyle = color;
      mctx.beginPath();
      mctx.arc(px, py, 6, 0, Math.PI * 2);
      mctx.fill();
      mctx.fillStyle = '#0b1020';
      mctx.fillText(glyph, px, py + 0.5);
      mctx.globalAlpha = 1;
    }

    // The route to the marker: a dashed line, and the marker pinned to the rim when far.
    if (ui.marker) {
      const [mx, my] = atRim(ui.marker.x, ui.marker.y, 9);
      mctx.strokeStyle = 'rgba(255, 201, 62, 0.75)';
      mctx.lineWidth = 2;
      mctx.setLineDash([5, 4]);
      mctx.beginPath();
      mctx.moveTo(R, R);
      mctx.lineTo(mx, my);
      mctx.stroke();
      mctx.setLineDash([]);
      const pulse = 4.4 + Math.sin(state.time * 5) * 1.2;
      mctx.save();
      mctx.translate(mx, my);
      mctx.rotate(Math.PI / 4);
      mctx.fillStyle = PALETTE.marker;
      mctx.fillRect(-pulse / 1.4, -pulse / 1.4, pulse * 1.4, pulse * 1.4);
      mctx.restore();
    }

    // Mission targets, police (cones facing their way), AIR-1. Dee is the D glyph.
    for (const car of state.cars) {
      if (car.kind !== 'target' && car.kind !== 'showpiece') continue;
      const [tx, ty] = atRim(car.x, car.y, 6);
      mctx.save();
      mctx.translate(tx, ty);
      mctx.rotate(Math.PI / 4);
      mctx.fillStyle = car.kind === 'showpiece' ? '#e6b93d' : PALETTE.target;
      mctx.fillRect(-3.4, -3.4, 6.8, 6.8);
      mctx.restore();
    }
    state.cars.forEach((car, n) => {
      if (car.kind !== 'police') return;
      const [cx, cy, far] = atRim(car.x, car.y, 6);
      const red = Math.floor(state.time * 3.75 + n) % 2 === 0;
      mctx.save();
      mctx.translate(cx, cy);
      mctx.rotate(car.angle + rot);
      if (!far) {
        mctx.fillStyle = red ? 'rgba(255, 69, 69, 0.18)' : 'rgba(77, 124, 255, 0.2)';
        mctx.beginPath();
        mctx.moveTo(0, 0);
        mctx.arc(0, 0, 26, -0.45, 0.45);
        mctx.closePath();
        mctx.fill();
      }
      mctx.fillStyle = red ? PALETTE.lightRed : PALETTE.lightBlue;
      mctx.beginPath();
      mctx.moveTo(6, 0);
      mctx.lineTo(-4, -4);
      mctx.lineTo(-4, 4);
      mctx.closePath();
      mctx.fill();
      mctx.restore();
    });
    const air = airUnit(state);
    if (air) {
      const [hx, hy] = atRim(air.x, air.y, 8);
      const [lx, ly] = toRadar(air.lightX, air.lightY);
      mctx.fillStyle = 'rgba(220, 235, 255, 0.25)';
      mctx.beginPath();
      mctx.arc(lx, ly, 9, 0, Math.PI * 2);
      mctx.fill();
      mctx.save();
      mctx.translate(hx, hy);
      mctx.rotate(air.rotor * 0.2);
      mctx.strokeStyle = '#e8f0ff';
      mctx.lineWidth = 1.6;
      mctx.beginPath();
      mctx.moveTo(-7, 0); mctx.lineTo(7, 0);
      mctx.moveTo(0, -7); mctx.lineTo(0, 7);
      mctx.stroke();
      mctx.restore();
      mctx.fillStyle = '#e8f0ff';
      mctx.beginPath();
      mctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
      mctx.fill();
    }

    // The player, always at the centre, always pointing up.
    mctx.fillStyle = '#ffffff';
    mctx.beginPath();
    mctx.moveTo(R, R - 8);
    mctx.lineTo(R - 5.5, R + 6);
    mctx.lineTo(R, R + 3);
    mctx.lineTo(R + 5.5, R + 6);
    mctx.closePath();
    mctx.fill();
    mctx.restore();

    // The rim: red and blue on the strobe beat while wanted, and north riding it.
    const wanted = state.wanted.stars > 0;
    const beat = Math.floor(state.time * 3.75) % 2 === 0;
    mctx.beginPath();
    mctx.arc(R, R, R - 1.5, 0, Math.PI * 2);
    mctx.strokeStyle = wanted ? (beat ? 'rgba(255, 69, 69, 0.85)' : 'rgba(77, 124, 255, 0.85)') : 'rgba(140, 170, 255, 0.5)';
    mctx.lineWidth = wanted ? 2.6 : 1.8;
    mctx.stroke();
    const north = rot - Math.PI / 2;
    const nx = R + Math.cos(north) * (R - 10);
    const ny = R + Math.sin(north) * (R - 10);
    mctx.fillStyle = 'rgba(6, 9, 16, 0.9)';
    mctx.beginPath();
    mctx.arc(nx, ny, 7, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = '#ffffff';
    mctx.font = '800 10px system-ui, sans-serif';
    mctx.fillText('N', nx, ny + 0.5);
  }

  // ------------------------------------------------------------ the arrow

  function updateArrow(world, ui, cameraState) {
    const marker = ui.marker;
    if (!marker || ui.screen === 'title' || !cameraState) {
      arrow.style.display = 'none';
      return;
    }
    const relX = marker.x - cameraState.x;
    const relY = marker.y - cameraState.y;
    const bearing = Math.atan2(relY, relX);
    const diff = angleDiff(cameraState.angle, bearing);
    // Roughly ahead of the camera: the gold beam itself does the guiding.
    if (Math.abs(diff) < 1.02 && Math.hypot(relX, relY) < 1500) {
      arrow.style.display = 'none';
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dirX = Math.sin(diff);
    const dirY = -Math.cos(diff);
    const reach = Math.min(w, h) / 2 - 64;
    const ax = clamp(w / 2 + dirX * reach, 46, w - 46);
    const ay = clamp(h / 2 + dirY * reach, 46, h - 46);
    arrow.style.display = 'block';
    arrow.style.left = `${ax}px`;
    arrow.style.top = `${ay}px`;
    arrowGlyph.style.transform = `rotate(${diff}rad)`;
    const d = Math.round(Math.hypot(marker.x - world.state.player.x, marker.y - world.state.player.y) / 10);
    arrowDist.textContent = `${d}m`;
  }

  // ------------------------------------------------------------ screens

  function updateScreens(world, ui) {
    titleScreen.style.display = ui.screen === 'title' ? 'flex' : 'none';
    if (ui.screen === 'title') {
      saveLine.style.display = ui.saveExists ? 'block' : 'none';
      if (ui.saveExists) saveLine.textContent = `C — Continue: ${ui.saveSummary}`;
      muteLine.style.display = ui.muted ? 'block' : 'none';
    }
    let panel = null;
    if (ui.screen === 'paused') {
      panel = { title: 'PAUSED', color: PALETTE.text, lines: ['The city holds its breath.'], prompt: 'P or ESC — Resume · ENTER — Title' };
    } else if (ui.screen === 'busted') {
      panel = {
        title: 'BUSTED', color: PALETTE.danger,
        lines: ['The Azura Bay PD finally got their hands on you.', `Bail and fines: $${ui.fine ?? 0}`],
        prompt: 'R — Back on the street',
      };
    } else if (ui.screen === 'wasted') {
      panel = {
        title: 'WASTED', color: PALETTE.danger,
        lines: ['You wake up at St Marina Hospital.', `The bill: $${ui.fine ?? 0}`],
        prompt: 'R — Discharge yourself',
      };
    }
    panelScreen.style.display = panel ? 'flex' : 'none';
    if (panel) {
      panelTitle.textContent = panel.title;
      panelTitle.style.color = panel.color;
      panelLines.innerHTML = '';
      for (const line of panel.lines) {
        const div = document.createElement('div');
        div.textContent = line;
        panelLines.appendChild(div);
      }
      panelPrompt.textContent = panel.prompt;
    }
    if (ui.screen === 'busted') {
      const flashOn = Math.floor(world.state.time * 3) % 2 === 0;
      flash.style.background = flashOn ? 'rgba(255, 60, 60, 0.10)' : 'rgba(60, 90, 255, 0.10)';
      flash.style.display = 'block';
    } else if (ui.screen === 'wasted') {
      flash.style.background = 'rgba(30, 8, 8, 0.35)';
      flash.style.display = 'block';
    } else if (ui.screen === 'play' && world.state.wanted.stars >= 2) {
      // Under pursuit the screen edges pick up the light bars: red on one side,
      // blue on the other, swapping on the strobe beat, stronger with each star.
      const a = (0.1 + world.state.wanted.stars * 0.035).toFixed(3);
      const swap = Math.floor(world.state.time * 3.75) % 2 === 0;
      const red = `rgba(255, 40, 48, ${a})`;
      const blue = `rgba(48, 92, 255, ${a})`;
      flash.style.background = `linear-gradient(90deg, ${swap ? red : blue} 0%, transparent 16%, transparent 84%, ${swap ? blue : red} 100%),`
        + ` linear-gradient(0deg, ${swap ? blue : red} 0%, transparent 9%)`;
      flash.style.display = 'block';
    } else {
      flash.style.display = 'none';
    }
  }

  // ------------------------------------------------------------ storytelling

  /** STORY n/N with a pip per mission, and courier rep stars (3, 8, 15 side jobs). */
  function updateStory(ui) {
    const story = ui.story;
    storyRow.style.display = story ? 'flex' : 'none';
    if (!story) return;
    const current = Math.min(story.total, story.done + (story.active ? 1 : 0));
    storyCount.textContent = `${current}/${story.total}`;
    while (storyPips.childElementCount < story.total) storyPips.appendChild(document.createElement('i'));
    [...storyPips.children].forEach((pip, i) => {
      pip.className = i < story.done ? 'done' : i === story.done && story.active ? 'now' : '';
    });
    const rep = [3, 8, 15].filter((n) => story.sideJobs >= n).length;
    storyRep.innerHTML = `COURIER REP <b>${'★'.repeat(rep)}${'☆'.repeat(3 - rep)}</b>`;
  }

  /** Police dispatch: every unit on the player, nearest first, with callsign, job and range. */
  function updateDispatch(world, ui) {
    const state = world.state;
    if (ui.screen !== 'play' || state.wanted.stars === 0) {
      dispatch.style.display = 'none';
      return;
    }
    const player = state.player;
    const heading = player.inCar && player.car ? player.car.angle : player.angle;
    const units = state.cars.filter((car) => car.kind === 'police').map((car, n) => ({
      call: CALLSIGNS[n % CALLSIGNS.length], n,
      role: unitRole(player, car, heading),
      d: Math.hypot(car.x - player.x, car.y - player.y),
    }));
    units.sort((a, b) => a.d - b.d);
    const row = (dot, call, role, hot, d) => `<div class="unit-row"><i style="background:${dot}"></i><span>${call}</span>`
      + `<span class="role${hot ? ' hot' : ''}">${role}</span><span class="dist">${d}</span></div>`;
    const rows = units.slice(0, 5).map((u) => {
      const red = Math.floor(state.time * 3.75 + u.n) % 2 === 0;
      return row(red ? PALETTE.lightRed : PALETTE.lightBlue, u.call, u.role[0], u.role[1], `${Math.round(u.d / 10)}m`);
    });
    const air = airUnit(state);
    if (air) rows.push(row(Math.floor(state.time * 6) % 2 ? '#e8f0ff' : '#7f8aa0', 'AIR-1', 'SEARCHLIGHT ON', true, `${Math.round(air.d / 10)}m`));
    if (rows.length === 0) rows.push(row('transparent', 'ALL UNITS', 'BOLO · SEARCHING', false, ''));
    dispatchRows.innerHTML = rows.join('');
    dispatch.style.display = 'block';
  }

  /** The car radio: station from the car's index, track from the game clock. */
  function updateRadio(world, ui) {
    const state = world.state;
    const player = state.player;
    if (ui.screen !== 'play' || !player.inCar || !player.car) {
      radio.style.display = 'none';
      return;
    }
    const carIndex = Math.max(0, state.cars.indexOf(player.car));
    const station = RADIO[(carIndex + 2) % RADIO.length];
    const [title, artist] = station.tracks[(Math.floor(state.time / 140) + carIndex) % station.tracks.length];
    radio.style.display = 'block';
    radioName.textContent = `${station.name} · ${station.tag.toUpperCase()}`;
    const by = document.createElement('span');
    by.textContent = ` · ${artist}`;
    radioTrack.replaceChildren(`♪ “${title}”`, by);
    radioBars.forEach((bar, i) => {
      bar.style.height = `${3 + Math.abs(Math.sin(state.time * (5.3 + i * 1.7) + i * 1.3)) * 7}px`;
    });
  }

  /** Dee's line, fading in and out like the banner; it rides above any prompt. */
  function updateDialogue(ui) {
    const d = ui.dialogue;
    if (!d || ui.screen !== 'play') {
      dialogue.style.display = 'none';
      return;
    }
    const alpha = d.t < 0.3 ? d.t / 0.3 : d.t > d.duration - 0.5 ? Math.max(0, (d.duration - d.t) / 0.5) : 1;
    dialogue.style.display = 'block';
    dialogue.style.opacity = `${alpha}`;
    dialogue.style.bottom = ui.prompt ? '74px' : '22px';
    dialogueVia.textContent = d.via;
    dialogueText.textContent = `“${d.text}”`;
  }

  // ------------------------------------------------------------ the update

  /** Refresh every instrument from the world state and this frame's ui object.
   *  city is needed by the minimap; cameraState (from the 3D renderer) by the arrow. */
  function update(world, ui, city, cameraState) {
    const state = world.state;
    const player = state.player;
    const inGame = ui.screen !== 'title';
    root.style.display = 'block';
    topLeft.style.display = inGame ? 'block' : 'none';
    topRight.style.display = inGame ? 'block' : 'none';

    hpFill.style.width = `${clamp(player.health / PLAYER.maxHealth, 0, 1) * 100}%`;
    hpFill.style.background = player.health / PLAYER.maxHealth < 0.3 ? PALETTE.healthLow : PALETTE.health;
    if (player.inCar && player.car) {
      carWrap.style.display = 'flex';
      const frac = clamp(player.car.health / CAR.maxHealth, 0, 1);
      carFill.style.width = `${frac * 100}%`;
      carFill.style.background = frac < 0.3 ? PALETTE.healthLow : '#7ec8e3';
    } else {
      carWrap.style.display = 'none';
    }

    money.textContent = `$${state.money.toLocaleString('en-US')}`;
    starSpans.forEach((span, i) => {
      span.style.color = i < state.wanted.stars ? PALETTE.star : PALETTE.starOff;
    });
    if (state.wanted.bust > 0.02) {
      bustWrap.style.display = 'block';
      bustFill.style.width = `${state.wanted.bust * 100}%`;
      bustLabel.style.color = state.wanted.bust > 0.7 && Math.floor(state.time * 4) % 2 === 0 ? '#ffffff' : PALETTE.danger;
    } else {
      bustWrap.style.display = 'none';
    }
    carrying.style.display = ui.carrying ? 'block' : 'none';
    passengerLine.style.display = ui.passenger ? 'block' : 'none';

    if (ui.objective && inGame) {
      objective.style.display = 'block';
      objTitle.textContent = ui.objective.title.toUpperCase();
      objText.textContent = ui.objective.text;
    } else {
      objective.style.display = 'none';
    }

    if (ui.timer !== null && ui.timer !== undefined) {
      const t = Math.ceil(ui.timer);
      timer.style.display = 'block';
      timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      timer.style.color = t <= 10
        ? (Math.floor(state.time * 4) % 2 === 0 ? '#ffffff' : PALETTE.danger)
        : PALETTE.text;
    } else {
      timer.style.display = 'none';
    }

    if (ui.meter) {
      meterWrap.style.display = 'block';
      meterLabel.textContent = ui.meter.label;
      meterFill.style.width = `${clamp(ui.meter.frac, 0, 1) * 100}%`;
      meterFill.style.background = ui.meter.good ? PALETTE.health : PALETTE.marker;
      meterWrap.style.top = ui.timer !== null && ui.timer !== undefined ? '156px' : '118px';
    } else {
      meterWrap.style.display = 'none';
    }

    if (player.inCar && player.car && inGame) {
      speed.style.display = 'block';
      speedNum.textContent = `${Math.round(Math.abs(player.car.speed) * 0.32)}`;
    } else {
      speed.style.display = 'none';
    }

    if (ui.prompt && ui.screen === 'play') {
      prompt.style.display = 'block';
      prompt.textContent = ui.prompt;
    } else {
      prompt.style.display = 'none';
    }

    if (ui.banner) {
      const b = ui.banner;
      const alpha = b.t < 0.25 ? b.t / 0.25 : b.t > b.duration - 0.4 ? Math.max(0, (b.duration - b.t) / 0.4) : 1;
      banner.style.display = 'block';
      banner.style.opacity = `${alpha}`;
      banner.style.transform = `translate(-50%, ${(1 - Math.min(1, b.t / 0.25)) * -14}px)`;
      bannerTitle.textContent = b.title;
      bannerSub.textContent = b.sub;
    } else {
      banner.style.display = 'none';
    }

    updateStory(inGame ? ui : {});
    updateDispatch(world, ui);
    updateRadio(world, ui);
    updateDialogue(ui);

    minimap.style.display = inGame ? 'block' : 'none';
    if (inGame) drawMinimap(world, ui, city);
    updateArrow(world, ui, cameraState);
    updateScreens(world, ui);
  }

  return { update };
}
