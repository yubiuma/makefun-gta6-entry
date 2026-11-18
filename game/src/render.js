// Drawing only: the world and the interface state in, pixels out. The camera looks down on
// the city in a fixed 1280x720 logical view, scaled to fit the window. Streets come first,
// then buildings with their shadows and lit windows, then cars, people, bullets and
// particles; the HUD (health, money, wanted stars, objective, minimap) and the screens
// (title, pause, busted, wasted, mission banners) are painted over the top in view space.
import { CAR, CITY, FONT, GAME_SUBTITLE, GAME_TITLE, GARAGE, PALETTE, PLAYER, VIEW } from './config.js';
import { clamp, hash2 } from './geom.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_WASTED = 'wasted';

const MINIMAP = { x: 18, y: VIEW.height - 206, size: 188 };

function font(size, weight = 400) {
  return `${weight} ${size}px ${FONT}`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function createRenderer(canvas, city) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  let vignette = null;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / VIEW.width, height / VIEW.height);
    view.x = (width - VIEW.width * view.scale) / 2;
    view.y = (height - VIEW.height * view.scale) / 2;
    vignette = ctx.createRadialGradient(VIEW.width / 2, VIEW.height / 2, VIEW.height * 0.45, VIEW.width / 2, VIEW.height / 2, VIEW.width * 0.72);
    vignette.addColorStop(0, 'rgba(10, 12, 16, 0)');
    vignette.addColorStop(1, 'rgba(10, 12, 16, 0.26)');
  }

  /** Convert a mouse event's client point to logical view coordinates. */
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
  }

  // ------------------------------------------------------------ the city

  function drawGround(cam) {
    const left = cam.x - VIEW.width / 2 - 40;
    const right = cam.x + VIEW.width / 2 + 40;
    const top = cam.y - VIEW.height / 2 - 40;
    const bottom = cam.y + VIEW.height / 2 + 40;
    // Water all around the island city, a sand rim, then grass.
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(-26, -26, city.size + 52, city.size + 52);
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, city.size, city.size);

    // Parks: lawns with crossing paths.
    for (const park of city.parks) {
      if (park.x > right || park.x + park.w < left || park.y > bottom || park.y + park.h < top) continue;
      ctx.fillStyle = PALETTE.park;
      ctx.fillRect(park.x, park.y, park.w, park.h);
      ctx.fillStyle = PALETTE.sand;
      ctx.fillRect(park.x, park.y + park.h / 2 - 7, park.w, 14);
      ctx.fillRect(park.x + park.w / 2 - 7, park.y, 14, park.h);
    }

    // Pavements: every block's base.
    ctx.fillStyle = PALETTE.pavement;
    for (let row = 0; row < CITY.rows; row += 1) {
      for (let col = 0; col < CITY.cols; col += 1) {
        const x = col * CITY.pitch + CITY.road;
        const y = row * CITY.pitch + CITY.road;
        if (x > right || x + CITY.block < left || y > bottom || y + CITY.block < top) continue;
        ctx.fillRect(x, y, CITY.block, CITY.block);
      }
    }

    // Streets.
    ctx.fillStyle = PALETTE.road;
    for (let i = 0; i <= CITY.cols; i += 1) ctx.fillRect(i * CITY.pitch, 0, CITY.road, city.size);
    for (let j = 0; j <= CITY.rows; j += 1) ctx.fillRect(0, j * CITY.pitch, city.size, CITY.road);
    // Kerb lines.
    ctx.fillStyle = PALETTE.roadEdge;
    for (let i = 0; i <= CITY.cols; i += 1) {
      ctx.fillRect(i * CITY.pitch, 0, 3, city.size);
      ctx.fillRect(i * CITY.pitch + CITY.road - 3, 0, 3, city.size);
      ctx.fillRect(0, i * CITY.pitch, city.size, 3);
      ctx.fillRect(0, i * CITY.pitch + CITY.road - 3, city.size, 3);
    }
    // Centre dashes, skipped inside intersections.
    ctx.fillStyle = PALETTE.laneMark;
    for (let i = 0; i <= CITY.cols; i += 1) {
      const cx = i * CITY.pitch + CITY.road / 2 - 2;
      for (let y = 8; y < city.size - 8; y += 38) {
        if ((y % CITY.pitch) < CITY.road) continue;
        if (y > top - 40 && y < bottom) ctx.fillRect(cx, y, 4, 20);
      }
      const cy = i * CITY.pitch + CITY.road / 2 - 2;
      for (let x = 8; x < city.size - 8; x += 38) {
        if ((x % CITY.pitch) < CITY.road) continue;
        if (x > left - 40 && x < right) ctx.fillRect(x, cy, 20, 4);
      }
    }
    // Crosswalks at every intersection in view.
    ctx.fillStyle = PALETTE.crosswalk;
    for (let i = 0; i <= CITY.cols; i += 1) {
      for (let j = 0; j <= CITY.rows; j += 1) {
        const x = i * CITY.pitch;
        const y = j * CITY.pitch;
        if (x > right || x + CITY.road < left || y > bottom || y + CITY.road < top) continue;
        for (let s = 0; s < 4; s += 1) {
          const off = 8 + s * 15;
          ctx.fillRect(x + off, y - 9, 8, 7);
          ctx.fillRect(x + off, y + CITY.road + 2, 8, 7);
          ctx.fillRect(x - 9, y + off, 7, 8);
          ctx.fillRect(x + CITY.road + 2, y + off, 7, 8);
        }
      }
    }
  }

  function drawBuildings(cam) {
    const left = cam.x - VIEW.width / 2 - 60;
    const right = cam.x + VIEW.width / 2 + 60;
    const top = cam.y - VIEW.height / 2 - 60;
    const bottom = cam.y + VIEW.height / 2 + 60;
    for (const b of city.buildings) {
      if (b.x > right || b.x + b.w < left || b.y > bottom || b.y + b.h < top) continue;
      ctx.fillStyle = PALETTE.buildingShadow;
      ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);
      ctx.fillStyle = b.wall;
      ctx.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Windows: a grid, some lit, decided by a hash so they never flicker.
      const cols = Math.max(1, Math.floor(b.w / 21));
      const rows = Math.max(1, Math.floor(b.h / 21));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          const lit = hash2(b.index * 31 + cx, cy * 17 + b.index) > 0.52;
          ctx.fillStyle = lit ? PALETTE.windowLit : PALETTE.windowDark;
          ctx.fillRect(b.x + 8 + cx * 21, b.y + 8 + cy * 21, 9, 7);
        }
      }
      if (b.prop) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(b.x + b.w * b.prop.fx, b.y + b.h * b.prop.fy, b.w * b.prop.fw, b.h * b.prop.fh);
      }
      if (b.label) {
        ctx.font = font(13, 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(20, 22, 26, 0.55)';
        const w = ctx.measureText(b.label).width + 16;
        roundRectPath(ctx, b.x + b.w / 2 - w / 2, b.y + b.h / 2 - 11, w, 22, 5);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      }
    }
    // Trees and lamps.
    for (const tree of city.trees) {
      if (tree.x < left || tree.x > right || tree.y < top || tree.y > bottom) continue;
      ctx.fillStyle = 'rgba(30, 40, 24, 0.3)';
      ctx.beginPath();
      ctx.ellipse(tree.x + 4, tree.y + 5, tree.r, tree.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4e7d3a';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#63924c';
      ctx.beginPath();
      ctx.arc(tree.x - tree.r * 0.25, tree.y - tree.r * 0.25, tree.r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#565d54';
    for (const lamp of city.lamps) {
      if (lamp.x < left || lamp.x > right || lamp.y < top || lamp.y > bottom) continue;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------ actors

  function drawCar(car, time) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = 'rgba(20, 22, 26, 0.3)';
    roundRectPath(ctx, -CAR.length / 2 + 3, -CAR.width / 2 + 4, CAR.length, CAR.width, 7);
    ctx.fill();
    const isPolice = car.kind === 'police';
    ctx.fillStyle = isPolice ? PALETTE.policeBody : car.color;
    roundRectPath(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 7);
    ctx.fill();
    if (isPolice) {
      ctx.fillStyle = PALETTE.policeTrim;
      ctx.fillRect(-CAR.length / 2, -CAR.width / 2, 11, CAR.width);
      ctx.fillRect(CAR.length / 2 - 9, -CAR.width / 2, 9, CAR.width);
    }
    // Cabin and glass.
    ctx.fillStyle = 'rgba(24, 30, 38, 0.85)';
    roundRectPath(ctx, -CAR.length * 0.18, -CAR.width / 2 + 3, CAR.length * 0.4, CAR.width - 6, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(168, 205, 225, 0.9)';
    ctx.fillRect(CAR.length * 0.2, -CAR.width / 2 + 4, 5, CAR.width - 8);
    ctx.fillRect(-CAR.length * 0.24, -CAR.width / 2 + 4, 4, CAR.width - 8);
    // Headlights.
    ctx.fillStyle = '#fff6c9';
    ctx.fillRect(CAR.length / 2 - 2, -CAR.width / 2 + 3, 3, 4);
    ctx.fillRect(CAR.length / 2 - 2, CAR.width / 2 - 7, 3, 4);
    if (isPolice) {
      // Each car's light bar runs on its own phase, so a pack of them strobes raggedly.
      const phase = Math.floor(time * 2.4 + (car.x + car.y) * 0.013) % 2 === 0;
      ctx.fillStyle = phase ? PALETTE.lightRed : '#5a1616';
      ctx.fillRect(-7, -CAR.width / 2 + 3, 6, 6);
      ctx.fillStyle = phase ? '#16295e' : PALETTE.lightBlue;
      ctx.fillRect(-7, CAR.width / 2 - 9, 6, 6);
      ctx.fillStyle = '#23272e';
      ctx.fillRect(-8, -3, 8, 6);
    }
    if (car.kind === 'showpiece') {
      // The Vantara's racing stripe, nose to tail.
      ctx.fillStyle = PALETTE.policeTrim;
      ctx.fillRect(-CAR.length / 2 + 5, -3, CAR.length - 10, 6);
    }
    if (car.health < 100) {
      ctx.fillStyle = `rgba(20, 20, 20, ${(1 - car.health / 100) * 0.35})`;
      roundRectPath(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, bodyColor, options = {}) {
    ctx.fillStyle = 'rgba(20, 22, 26, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 4, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(x, y, options.radius ?? 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = options.head ?? '#e8b98d';
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, 5.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorld(world, ui) {
    const state = world.state;
    const cam = state.camera;
    const left = cam.x - VIEW.width / 2 - 60;
    const right = cam.x + VIEW.width / 2 + 60;
    const top = cam.y - VIEW.height / 2 - 60;
    const bottom = cam.y + VIEW.height / 2 + 60;
    const inView = (x, y, pad = 0) => x > left - pad && x < right + pad && y > top - pad && y < bottom + pad;

    drawGround(cam);
    drawBuildings(cam);

    // Skypak Garage's repair bay: a dashed painted box on the ground in front of the
    // garage, with its little standing sign. It lights up gold while you are in it.
    const garagePlace = city.specials.garage;
    const bay = { x: garagePlace.x, y: garagePlace.y + GARAGE.bayOffsetY };
    if (inView(bay.x, bay.y, 110)) {
      ctx.strokeStyle = ui.garageActive ? PALETTE.marker : 'rgba(143, 208, 224, 0.9)';
      ctx.lineWidth = ui.garageActive ? 3.5 : 2.5;
      ctx.setLineDash([14, 9]);
      roundRectPath(ctx, bay.x - 56, bay.y - 38, 112, 76, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = font(13, 800);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(20, 26, 30, 0.5)';
      ctx.fillText('REPAIR BAY', bay.x, bay.y + 54);
      ctx.fillStyle = '#3a3f46';
      ctx.fillRect(bay.x - 68, bay.y - 54, 4, 26);
      ctx.fillStyle = PALETTE.garage;
      roundRectPath(ctx, bay.x - 86, bay.y - 72, 40, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#16303a';
      ctx.font = font(10, 800);
      ctx.fillText('FIX', bay.x - 66, bay.y - 58);
    }

    // The mission beacon: a ring on the ground and a pillar of light.
    const marker = ui.marker;
    if (marker && ui.screen !== SCREEN_TITLE) {
      const pulse = 1 + Math.sin(state.time * 4) * 0.12;
      ctx.strokeStyle = PALETTE.marker;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 26 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      const grad = ctx.createLinearGradient(0, marker.y - 190, 0, marker.y);
      grad.addColorStop(0, 'rgba(255, 201, 62, 0)');
      grad.addColorStop(1, PALETTE.markerBeam);
      ctx.fillStyle = grad;
      ctx.fillRect(marker.x - 13, marker.y - 190, 26, 190);
      ctx.fillStyle = PALETTE.marker;
      ctx.save();
      ctx.translate(marker.x, marker.y - 196 - Math.sin(state.time * 3) * 5);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-8, -8, 16, 16);
      ctx.restore();
    }

    for (const car of state.cars) if (inView(car.x, car.y, 40)) drawCar(car, state.time);
    // The tail target wears an orange ring and a bobbing arrow: the sedan, marked.
    for (const car of state.cars) {
      if (car.kind !== 'target' || !inView(car.x, car.y, 40)) continue;
      const pulse = 1 + Math.sin(state.time * 5) * 0.1;
      ctx.strokeStyle = PALETTE.target;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 34 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      const bob = Math.sin(state.time * 3) * 3;
      ctx.fillStyle = PALETTE.target;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y - 46 + bob);
      ctx.lineTo(car.x - 7, car.y - 58 + bob);
      ctx.lineTo(car.x + 7, car.y - 58 + bob);
      ctx.closePath();
      ctx.fill();
    }
    // Highlight the player's own car.
    if (state.player.inCar && state.player.car) {
      const car = state.player.car;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(car.x, car.y, 34 + Math.sin(state.time * 5) * 2, 0, Math.PI * 2);
      ctx.stroke();
      // A passenger's head beside the driver's, when someone is riding along.
      if (ui.passenger) {
        const side = car.angle + Math.PI / 2;
        const hx = car.x + Math.cos(side) * 6 - Math.cos(car.angle) * 2;
        const hy = car.y + Math.sin(side) * 6 - Math.sin(car.angle) * 2;
        ctx.fillStyle = '#e8b98d';
        ctx.beginPath();
        ctx.arc(hx, hy, 4.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const ped of state.peds) {
      if (!inView(ped.x, ped.y)) continue;
      if (ped.state === 'down') {
        ctx.save();
        ctx.globalAlpha = ped.dead ? Math.max(0, ped.fade) : 1;
        ctx.translate(ped.x, ped.y);
        ctx.rotate(ped.angle + Math.PI / 2);
        ctx.fillStyle = ped.color;
        roundRectPath(ctx, -6, -13, 12, 26, 6);
        ctx.fill();
        ctx.fillStyle = '#e8b98d';
        ctx.beginPath();
        ctx.arc(0, -16, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        drawPerson(ped.x, ped.y, ped.angle, ped.color);
      }
    }

    // Dee Voss, the fixer, in her apron outside the noodle bar.
    const npc = state.npc;
    if (inView(npc.x, npc.y)) {
      drawPerson(npc.x, npc.y, npc.angle + Math.sin(state.time * 1.4) * 0.2, PALETTE.npc, { radius: 11 });
      ctx.font = font(12, 700);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(18, 21, 27, 0.75)';
      const w = ctx.measureText('DEE VOSS').width + 12;
      roundRectPath(ctx, npc.x - w / 2, npc.y - 34, w, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText('DEE VOSS', npc.x, npc.y - 21);
    }

    // Milo, Dee's cousin, waiting out front of Marina Stores during mission 4.
    if (ui.cousin && inView(ui.cousin.x, ui.cousin.y)) {
      drawPerson(ui.cousin.x, ui.cousin.y, Math.PI / 2 + Math.sin(state.time * 1.7) * 0.25, '#4fb8c9', { radius: 11 });
      ctx.font = font(12, 700);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(18, 21, 27, 0.75)';
      const w = ctx.measureText(ui.cousin.name).width + 12;
      roundRectPath(ctx, ui.cousin.x - w / 2, ui.cousin.y - 34, w, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ui.cousin.name, ui.cousin.x, ui.cousin.y - 21);
    }

    // The player, when on foot.
    const player = state.player;
    if (!player.inCar) {
      drawPerson(player.x, player.y, player.angle, PALETTE.player, { radius: PLAYER.radius });
      // The pistol, pointed at the aim.
      ctx.strokeStyle = '#22262c';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(player.x + Math.cos(player.angle) * 8, player.y + Math.sin(player.angle) * 8);
      ctx.lineTo(player.x + Math.cos(player.angle) * 19, player.y + Math.sin(player.angle) * 19);
      ctx.stroke();
      if (player.sinceHurt < 0.4) {
        ctx.strokeStyle = 'rgba(255, 70, 70, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 17, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Bullets as short bright tracers.
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (const b of state.bullets) {
      if (!b.active) continue;
      ctx.moveTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Particles.
    for (const p of state.particles) {
      if (!p.active) continue;
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.4, p.size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ HUD

  function drawMinimap(world, ui) {
    const state = world.state;
    const { x, y, size } = MINIMAP;
    ctx.save();
    roundRectPath(ctx, x, y, size, size, 10);
    ctx.fillStyle = 'rgba(16, 22, 18, 0.88)';
    ctx.fill();
    ctx.clip();
    const s = size / city.size;
    ctx.fillStyle = '#3d4a3a';
    for (let row = 0; row < CITY.rows; row += 1) {
      for (let col = 0; col < CITY.cols; col += 1) {
        ctx.fillRect(x + (col * CITY.pitch + CITY.road) * s, y + (row * CITY.pitch + CITY.road) * s, CITY.block * s, CITY.block * s);
      }
    }
    // The buildings themselves, faint, so the blocks read as a built-up city.
    ctx.fillStyle = 'rgba(235, 230, 205, 0.15)';
    for (const b of city.buildings) {
      ctx.fillRect(x + b.x * s, y + b.y * s, Math.max(1.4, b.w * s), Math.max(1.4, b.h * s));
    }
    ctx.strokeStyle = '#9aa48f';
    ctx.lineWidth = Math.max(1, CITY.road * s * 0.5);
    ctx.beginPath();
    for (let i = 0; i <= CITY.cols; i += 1) {
      ctx.moveTo(x + (i * CITY.pitch + CITY.road / 2) * s, y);
      ctx.lineTo(x + (i * CITY.pitch + CITY.road / 2) * s, y + size);
      ctx.moveTo(x, y + (i * CITY.pitch + CITY.road / 2) * s);
      ctx.lineTo(x + size, y + (i * CITY.pitch + CITY.road / 2) * s);
    }
    ctx.stroke();
    // Mission marker.
    if (ui.marker) {
      const pulse = 3.4 + Math.sin(state.time * 5) * 1.1;
      ctx.fillStyle = PALETTE.marker;
      ctx.save();
      ctx.translate(x + ui.marker.x * s, y + ui.marker.y * s);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-pulse / 1.4, -pulse / 1.4, pulse * 1.4, pulse * 1.4);
      ctx.restore();
    }
    // Police blips, alternating red and blue around a white core.
    const phase = Math.floor(state.time * 2.4) % 2 === 0;
    for (const car of state.cars) {
      if (car.kind !== 'police') continue;
      ctx.fillStyle = phase ? PALETTE.lightRed : PALETTE.lightBlue;
      ctx.beginPath();
      ctx.arc(x + car.x * s, y + car.y * s, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + car.x * s, y + car.y * s, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // The tail target, an orange diamond, while a tail is running.
    for (const car of state.cars) {
      if (car.kind !== 'target') continue;
      ctx.fillStyle = PALETTE.target;
      ctx.save();
      ctx.translate(x + car.x * s, y + car.y * s);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
    // Skypak Garage: a wrench-blue square with its G.
    const garagePlace = city.specials.garage;
    ctx.fillStyle = PALETTE.garage;
    ctx.fillRect(x + garagePlace.x * s - 3.6, y + garagePlace.y * s - 3.6, 7.2, 7.2);
    ctx.fillStyle = '#16303a';
    ctx.font = font(7.5, 800);
    ctx.textAlign = 'center';
    ctx.fillText('G', x + garagePlace.x * s, y + garagePlace.y * s + 2.6);
    // Dee.
    ctx.fillStyle = PALETTE.npc;
    ctx.beginPath();
    ctx.arc(x + state.npc.x * s, y + state.npc.y * s, 3, 0, Math.PI * 2);
    ctx.fill();
    // The player arrow.
    const player = state.player;
    const angle = player.inCar && player.car ? player.car.angle : player.angle;
    ctx.save();
    ctx.translate(x + player.x * s, y + player.y * s);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.6);
    ctx.lineTo(-5, 4.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    roundRectPath(ctx, x, y, size, size, 10);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.font = font(11, 700);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'left';
    ctx.fillText('N', x + size - 14, y + 16);
  }

  function drawHud(world, ui) {
    const state = world.state;
    const player = state.player;

    // Health, top left.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(13, 700);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText('HEALTH', 20, 30);
    roundRectPath(ctx, 20, 38, 228, 17, 5);
    ctx.fillStyle = 'rgba(14, 16, 20, 0.72)';
    ctx.fill();
    const hpFrac = clamp(player.health / PLAYER.maxHealth, 0, 1);
    if (hpFrac > 0) {
      roundRectPath(ctx, 22, 40, 224 * hpFrac, 13, 4);
      ctx.fillStyle = hpFrac < 0.3 ? PALETTE.healthLow : PALETTE.health;
      ctx.fill();
    }
    if (player.inCar && player.car) {
      ctx.font = font(11, 700);
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText('CAR', 20, 74);
      roundRectPath(ctx, 52, 63, 150, 10, 4);
      ctx.fillStyle = 'rgba(14, 16, 20, 0.72)';
      ctx.fill();
      const carFrac = clamp(player.car.health / CAR.maxHealth, 0, 1);
      if (carFrac > 0) {
        roundRectPath(ctx, 53.5, 64.5, 147 * carFrac, 7, 3);
        ctx.fillStyle = carFrac < 0.3 ? PALETTE.healthLow : '#7ec8e3';
        ctx.fill();
      }
    }

    // Money and stars, top right.
    ctx.textAlign = 'right';
    ctx.font = font(30, 800);
    ctx.fillStyle = PALETTE.money;
    ctx.fillText(`$${state.money.toLocaleString('en-US')}`, VIEW.width - 22, 40);
    const stars = state.wanted.stars;
    ctx.font = font(27, 800);
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < stars ? PALETTE.star : PALETTE.starOff;
      ctx.fillText('★', VIEW.width - 22 - (4 - i) * 30, 74);
    }
    if (state.wanted.bust > 0.02) {
      ctx.font = font(11, 700);
      ctx.fillStyle = state.wanted.bust > 0.7 && Math.floor(state.time * 4) % 2 === 0 ? '#ffffff' : PALETTE.danger;
      ctx.fillText('BUSTED', VIEW.width - 22, 94);
      roundRectPath(ctx, VIEW.width - 172, 100, 150, 8, 4);
      ctx.fillStyle = 'rgba(14, 16, 20, 0.72)';
      ctx.fill();
      roundRectPath(ctx, VIEW.width - 170.5, 101.5, 147 * state.wanted.bust, 5, 3);
      ctx.fillStyle = PALETTE.danger;
      ctx.fill();
    }
    if (ui.carrying) {
      ctx.font = font(14, 700);
      ctx.fillStyle = PALETTE.marker;
      ctx.fillText('CARRYING: PACKAGE', VIEW.width - 22, 128);
    }
    if (ui.passenger) {
      ctx.font = font(14, 700);
      ctx.fillStyle = PALETTE.marker;
      ctx.fillText('PASSENGER: MILO', VIEW.width - 22, ui.carrying ? 152 : 128);
    }

    // Objective, top centre.
    if (ui.objective) {
      ctx.font = font(13, 700);
      const titleW = ctx.measureText(ui.objective.title.toUpperCase()).width;
      ctx.font = font(19, 600);
      const textW = ctx.measureText(ui.objective.text).width;
      const w = Math.max(titleW, textW) + 44;
      const x = VIEW.width / 2 - w / 2;
      roundRectPath(ctx, x, 16, w, 62, 10);
      ctx.fillStyle = PALETTE.panel;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 201, 62, 0.4)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = font(13, 700);
      ctx.fillStyle = PALETTE.marker;
      ctx.fillText(ui.objective.title.toUpperCase(), VIEW.width / 2, 40);
      ctx.font = font(19, 600);
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(ui.objective.text, VIEW.width / 2, 66);
    }

    // The mission countdown, big in the centre, flashing white-red when it runs low.
    if (ui.timer !== null && ui.timer !== undefined) {
      const t = Math.ceil(ui.timer);
      const urgent = t <= 10;
      ctx.textAlign = 'center';
      ctx.font = font(30, 800);
      ctx.fillStyle = urgent ? (Math.floor(state.time * 4) % 2 === 0 ? '#ffffff' : PALETTE.danger) : PALETTE.text;
      ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, VIEW.width / 2, 118);
    }

    // The mission meter (the tail's patience, the Vantara's hull): a labelled bar.
    if (ui.meter) {
      const w = 300;
      const x = VIEW.width / 2 - w / 2;
      const y = ui.timer !== null && ui.timer !== undefined ? 132 : 94;
      ctx.textAlign = 'left';
      ctx.font = font(12, 700);
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(ui.meter.label, x, y - 6);
      roundRectPath(ctx, x, y, w, 11, 5);
      ctx.fillStyle = 'rgba(14, 16, 20, 0.72)';
      ctx.fill();
      const frac = clamp(ui.meter.frac, 0, 1);
      if (frac > 0) {
        roundRectPath(ctx, x + 1.5, y + 1.5, (w - 3) * frac, 8, 4);
        ctx.fillStyle = ui.meter.good ? PALETTE.health : PALETTE.marker;
        ctx.fill();
      }
    }

    drawMinimap(world, ui);

    // Speed, bottom right, while driving.
    if (player.inCar && player.car) {
      ctx.textAlign = 'right';
      ctx.font = font(26, 800);
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(`${Math.round(Math.abs(player.car.speed) * 0.32)}`, VIEW.width - 62, VIEW.height - 24);
      ctx.font = font(13, 600);
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText('km/h', VIEW.width - 22, VIEW.height - 24);
    }

    // The context prompt, bottom centre.
    if (ui.prompt) {
      ctx.font = font(18, 700);
      const w = ctx.measureText(ui.prompt).width + 36;
      roundRectPath(ctx, VIEW.width / 2 - w / 2, VIEW.height - 58, w, 38, 9);
      ctx.fillStyle = PALETTE.panel;
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(ui.prompt, VIEW.width / 2, VIEW.height - 33);
    }
  }

  // ------------------------------------------------------------ banners and screens

  function drawBanner(banner) {
    const t = banner.t;
    const alpha = t < 0.25 ? t / 0.25 : t > banner.duration - 0.4 ? Math.max(0, (banner.duration - t) / 0.4) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = 560;
    const x = VIEW.width / 2 - w / 2;
    const y = 108 + (1 - Math.min(1, t / 0.25)) * -14;
    roundRectPath(ctx, x, y, w, 74, 12);
    ctx.fillStyle = PALETTE.panel;
    ctx.fill();
    ctx.strokeStyle = PALETTE.panelEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font(25, 800);
    ctx.fillStyle = PALETTE.marker;
    ctx.fillText(banner.title, VIEW.width / 2, y + 34);
    ctx.font = font(16, 500);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(banner.sub, VIEW.width / 2, y + 60);
    ctx.restore();
  }

  function drawEdgeArrow(world, ui) {
    const marker = ui.marker;
    if (!marker) return;
    const cam = world.state.camera;
    const sx = marker.x - cam.x + VIEW.width / 2;
    const sy = marker.y - cam.y + VIEW.height / 2;
    if (sx > 30 && sx < VIEW.width - 30 && sy > 30 && sy < VIEW.height - 30) return;
    const cx = clamp(sx, 44, VIEW.width - 44);
    const cy = clamp(sy, 44, VIEW.height - 44);
    const angle = Math.atan2(sy - cy, sx - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = PALETTE.marker;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const d = Math.round(Math.hypot(marker.x - world.state.player.x, marker.y - world.state.player.y) / 10);
    ctx.font = font(13, 700);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.marker;
    ctx.fillText(`${d}m`, cx, cy + 26);
  }

  function panel(title, titleColor, lines, prompt) {
    ctx.fillStyle = 'rgba(10, 12, 16, 0.55)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    const w = 640;
    const h = 150 + lines.length * 30 + 56;
    const x = VIEW.width / 2 - w / 2;
    const y = VIEW.height / 2 - h / 2;
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = PALETTE.panel;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font(52, 800);
    ctx.fillStyle = titleColor;
    ctx.fillText(title, VIEW.width / 2, y + 76);
    ctx.font = font(18, 500);
    ctx.fillStyle = PALETTE.muted;
    lines.forEach((line, i) => ctx.fillText(line, VIEW.width / 2, y + 122 + i * 30));
    ctx.font = font(19, 700);
    ctx.fillStyle = PALETTE.marker;
    ctx.fillText(prompt, VIEW.width / 2, y + h - 26);
  }

  function drawTitle(world, ui) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    grad.addColorStop(0, 'rgba(12, 14, 20, 0.62)');
    grad.addColorStop(0.45, 'rgba(12, 14, 20, 0.18)');
    grad.addColorStop(1, 'rgba(12, 14, 20, 0.66)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    try {
      ctx.letterSpacing = '6px';
    } catch { /* older engines: spacing is a nicety */ }
    ctx.font = font(96, 800);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(GAME_TITLE, VIEW.width / 2, 168);
    ctx.font = font(40, 800);
    ctx.fillStyle = PALETTE.marker;
    ctx.fillText(`— ${GAME_SUBTITLE} —`, VIEW.width / 2, 224);
    try {
      ctx.letterSpacing = '0px';
    } catch { /* as above */ }

    const lines = [
      'Rook owes money all over Azura Bay. Dee Voss, fixer and noodle chef,',
      'has work: six jobs, one dented coupe, and every cop in the city.',
      'Drive anything. Run from everyone. Try not to get busted.',
    ];
    ctx.font = font(19, 500);
    ctx.fillStyle = PALETTE.text;
    lines.forEach((line, i) => ctx.fillText(line, VIEW.width / 2, 292 + i * 28));

    ctx.font = font(21, 700);
    ctx.fillStyle = PALETTE.marker;
    ctx.fillText('ENTER — Start a new game', VIEW.width / 2, 428);
    if (ui.saveExists) {
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(`C — Continue: ${ui.saveSummary}`, VIEW.width / 2, 464);
    }
    ctx.font = font(16, 500);
    ctx.fillStyle = PALETTE.muted;
    const controls = [
      'On foot: WASD / arrows move · mouse aims · click shoots · Shift sprints',
      'In a car: W/S accelerate & brake · A/D steer · E or F get in / out',
      'Skypak Garage bay: full repair — and the law forgets a star',
      'P pause · M mute · Lose the stars to cool off',
    ];
    controls.forEach((line, i) => ctx.fillText(line, VIEW.width / 2, 540 + i * 26));
    if (ui.muted) {
      ctx.fillStyle = PALETTE.danger;
      ctx.fillText('SOUND OFF (M)', VIEW.width / 2, 640);
    }
  }

  /** Paint one frame. ui: {screen, marker, objective, prompt, banner, carrying, passenger,
   *  timer, meter, cousin, garageActive, muted, saveExists, saveSummary}. */
  function draw(world, ui) {
    const state = world.state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.save();
    ctx.translate(VIEW.width / 2 - state.camera.x, VIEW.height / 2 - state.camera.y);
    drawWorld(world, ui);
    ctx.restore();

    if (ui.screen === SCREEN_TITLE) {
      drawTitle(world, ui);
    } else {
      drawHud(world, ui);
      drawEdgeArrow(world, ui);
      if (ui.banner) drawBanner(ui.banner);
      if (ui.screen === SCREEN_PAUSED) {
        panel('PAUSED', PALETTE.text, ['The city holds its breath.'], 'P or ESC — Resume · ENTER — Title');
      } else if (ui.screen === SCREEN_BUSTED) {
        const flash = Math.floor(state.time * 3) % 2 === 0;
        ctx.fillStyle = flash ? 'rgba(255, 60, 60, 0.10)' : 'rgba(60, 90, 255, 0.10)';
        ctx.fillRect(0, 0, VIEW.width, VIEW.height);
        panel('BUSTED', PALETTE.danger, ['The Azura Bay PD finally got their hands on you.', `Bail and fines: $${ui.fine ?? 0}`], 'R — Back on the street');
      } else if (ui.screen === SCREEN_WASTED) {
        ctx.fillStyle = 'rgba(30, 8, 8, 0.35)';
        ctx.fillRect(0, 0, VIEW.width, VIEW.height);
        panel('WASTED', PALETTE.danger, ['You wake up at St Marina Hospital.', `The bill: $${ui.fine ?? 0}`], 'R — Discharge yourself');
      }
    }
    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toLogical };
}
