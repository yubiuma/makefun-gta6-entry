// The simulation: the player on foot and in cars, civilian traffic following the street
// grid, pedestrians on the pavements, police pursuit, bullets, particles and the camera.
// step() advances one fixed step from a control snapshot and returns what happened as bit
// flags, so the caller can make noise and change screens without the world knowing about
// either. Crimes are reported to the wanted system only when a pedestrian or an officer
// is close enough to witness them.
import { CAR, CITY, GARAGE, GUN, PARTICLE_POOL, PED, PLAYER, POLICE, TAIL, TRAFFIC, VIEW, WANTED } from './config.js';
import { pick, range, rangeInt } from './random.js';
import { angleDiff, angleTurn, circleRectResolve, clamp, dist, dist2 } from './geom.js';
import { isOnStreet, randomStreetPoint, streetCenterX, streetCenterY } from './city.js';
import { clearWanted, createWanted, heatForStars, policeQuota, reportCrime, setHeat as setWantedHeat, updateWanted } from './wanted.js';

export const EV_SHOT = 1;
export const EV_HIT = 2;
export const EV_CRASH = 4;
export const EV_STEAL = 8;
export const EV_BUSTED = 16;
export const EV_WASTED = 32;
export const EV_ENTER = 64;
export const EV_EXIT = 128;
export const EV_PED_DOWN = 256;

const CAR_COLORS = ['#d95f4b', '#4b7fd9', '#e0b84f', '#5fae6e', '#9a6fc0', '#d9d9d9', '#3f4750', '#c94f7e', '#4fb8c9', '#e07b39'];
const SHIRT_COLORS = ['#d96a4b', '#4b7fd9', '#e0cf4f', '#5fae6e', '#c0c6cc', '#c94f7e', '#7a5230', '#4fb8c9', '#ece7db', '#5b4a8a'];

function makeCar(random, x, y, angle, kind, color) {
  return {
    x, y, angle, kind, color,
    speed: 0,
    driver: kind === 'traffic' || kind === 'police' ? 'ai' : null,
    health: CAR.maxHealth,
    cruise: range(random, TRAFFIC.cruiseMin, TRAFFIC.cruiseMax),
    roadDir: { x: 1, y: 0 },
    streetI: 0,
    streetJ: 0,
    nextI: 0,
    nextJ: 0,
    inIntersection: false,
    turnCooldown: 0,
    stuckTime: 0,
    recoverX: 0,
    recoverY: 0,
    recovering: false,
    stolen: false,
    smokeTimer: 0,
    /** Routed cars (the tail target) drive to this point and park up for good. */
    routeDest: null,
    arrived: false,
    /** World time of the last collision the player was part of, against this car. */
    lastPlayerHitTime: -99,
  };
}

export function createWorld(random, city) {
  const wanted = createWanted();
  const player = {
    x: 0, y: 0, angle: -Math.PI / 2, health: PLAYER.maxHealth,
    inCar: false, car: null, speedMag: 0, kx: 0, ky: 0,
    fireCooldown: 0, hurtCooldown: 0, sinceHurt: 99,
  };
  const state = {
    time: 0,
    money: 0,
    player,
    wanted,
    cars: [],
    peds: [],
    bullets: [],
    particles: [],
    camera: { x: 0, y: 0 },
    cameraLock: null,
    attract: false,
    coupe: null,
    showpiece: null,
    /** Skypak Garage's crew: seconds until they will take another car. */
    garage: { cooldown: 0 },
    npc: { x: city.specials.noodle.x, y: city.specials.noodle.y - 16, angle: Math.PI / 2 },
    over: null,
    policeTimer: 0,
  };
  for (let i = 0; i < GUN.poolSize; i += 1) state.bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  for (let i = 0; i < PARTICLE_POOL; i += 1) {
    state.particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#ffffff', grav: 0, grow: 0 });
  }

  // ------------------------------------------------------------ particles

  function spawnParticle(x, y, vx, vy, life, size, color, grav = 0, grow = 0) {
    for (const p of state.particles) {
      if (p.active) continue;
      p.active = true;
      p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.life = life; p.maxLife = life; p.size = size; p.color = color; p.grav = grav; p.grow = grow;
      return;
    }
  }

  function sparks(x, y, count, color = '#ffd76a') {
    for (let i = 0; i < count; i += 1) {
      const a = random() * Math.PI * 2;
      const s = range(random, 40, 220);
      spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, range(random, 0.15, 0.45), range(random, 1.5, 3), color, 300);
    }
  }

  function smoke(x, y, dark) {
    spawnParticle(x + range(random, -6, 6), y + range(random, -6, 6), range(random, -8, 8), range(random, -34, -18),
      range(random, 0.7, 1.4), range(random, 4, 7), dark ? '#3a3f46' : '#9aa0a6', -12, 7);
  }

  function stepParticles(dt) {
    for (const p of state.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
    }
  }

  // ------------------------------------------------------------ witnesses and crime

  function witnessed(x, y) {
    for (const ped of state.peds) {
      if (ped.state !== 'down' && dist2(x, y, ped.x, ped.y) < WANTED.witness.ped * WANTED.witness.ped) return true;
    }
    for (const car of state.cars) {
      if (car.kind === 'police' && dist2(x, y, car.x, car.y) < WANTED.witness.police * WANTED.witness.police) return true;
    }
    return false;
  }

  function reportIfWitnessed(kind, x, y) {
    if (witnessed(x, y)) reportCrime(wanted, kind);
  }

  function panicPeds(x, y, radius) {
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      if (dist2(x, y, ped.x, ped.y) < radius * radius) {
        ped.state = 'flee';
        ped.fleeTime = PED.fleeSeconds * range(random, 0.7, 1.3);
        ped.fleeX = x;
        ped.fleeY = y;
      }
    }
  }

  // ------------------------------------------------------------ spawning

  function laneSpawn(minPlayerDist) {
    for (let tries = 0; tries < 10; tries += 1) {
      const point = randomStreetPoint(random);
      if (dist(point.x, point.y, player.x, player.y) < minPlayerDist) continue;
      const vertical = Math.abs((point.x - CITY.road / 2) % CITY.pitch) < 1;
      return { point, vertical };
    }
    return { point: randomStreetPoint(random), vertical: true };
  }

  function aimAtIntersection(car) {
    // Intersections are indexed by street: (i, j) sits at streetCenterX(i), streetCenterY(j).
    car.nextI = clamp(Math.round((car.x - CITY.road / 2) / CITY.pitch) + car.roadDir.x, 0, CITY.cols);
    car.nextJ = clamp(Math.round((car.y - CITY.road / 2) / CITY.pitch) + car.roadDir.y, 0, CITY.rows);
    if (car.roadDir.x !== 0) car.streetJ = clamp(Math.round((car.y - CITY.road / 2) / CITY.pitch), 0, CITY.rows);
    if (car.roadDir.y !== 0) car.streetI = clamp(Math.round((car.x - CITY.road / 2) / CITY.pitch), 0, CITY.cols);
  }

  /** Quietly re-enter a car on a far street, rolling again — the jam breaker. */
  function recycleCar(car) {
    const { point, vertical } = laneSpawn(700);
    car.x = point.x;
    car.y = point.y;
    car.speed = 0;
    const dir = random() < 0.5 ? 1 : -1;
    if (vertical) { car.roadDir = { x: 0, y: dir }; car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { car.roadDir = { x: dir, y: 0 }; car.angle = dir > 0 ? 0 : Math.PI; }
    aimAtIntersection(car);
  }

  function spawnTrafficCar() {
    const { point, vertical } = laneSpawn(320);
    const dir = random() < 0.5 ? 1 : -1;
    const car = makeCar(random, point.x, point.y, 0, 'traffic', pick(random, CAR_COLORS));
    if (vertical) {
      car.roadDir = { x: 0, y: dir };
      car.x = streetCenterX(Math.round((point.x - CITY.road / 2) / CITY.pitch)) + (dir > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset);
      car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.roadDir = { x: dir, y: 0 };
      car.y = streetCenterY(Math.round((point.y - CITY.road / 2) / CITY.pitch)) + (dir > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset);
      car.angle = dir > 0 ? 0 : Math.PI;
    }
    aimAtIntersection(car);
    state.cars.push(car);
    return car;
  }

  function spawnPoliceCar() {
    for (let tries = 0; tries < 10; tries += 1) {
      const point = randomStreetPoint(random);
      const d = dist(point.x, point.y, player.x, player.y);
      if (d < POLICE.spawnMin || d > POLICE.spawnMax + 400) continue;
      const car = makeCar(random, point.x, point.y, Math.atan2(player.y - point.y, player.x - point.x), 'police', '#eef1f4');
      car.cruise = POLICE.maxSpeed;
      state.cars.push(car);
      return car;
    }
    return null;
  }

  function spawnPed(x, y) {
    const ped = {
      x, y, angle: range(random, 0, Math.PI * 2), health: PED.maxHealth,
      state: 'walk', targetX: x, targetY: y, blockCol: 0, blockRow: 0,
      fleeTime: 0, fleeX: 0, fleeY: 0, downTime: 0, dead: false, fade: 1,
      vx: 0, vy: 0, color: pick(random, SHIRT_COLORS), speedVar: range(random, 0.8, 1.2),
    };
    choosePedTarget(ped, true);
    state.peds.push(ped);
    return ped;
  }

  /** A point on a block's pavement ring: where pedestrians stroll. */
  function ringPoint(col, row) {
    const bx = col * CITY.pitch + CITY.road;
    const by = row * CITY.pitch + CITY.road;
    const inset = 9;
    const side = rangeInt(random, 0, 3);
    const t = range(random, inset, CITY.block - inset);
    if (side === 0) return { x: bx + t, y: by + inset };
    if (side === 1) return { x: bx + t, y: by + CITY.block - inset };
    if (side === 2) return { x: bx + inset, y: by + t };
    return { x: bx + CITY.block - inset, y: by + t };
  }

  function choosePedTarget(ped, anywhere = false) {
    if (anywhere || random() < 0.35) {
      ped.blockCol = clamp(ped.blockCol + rangeInt(random, -1, 1), 0, CITY.cols - 1);
      ped.blockRow = clamp(ped.blockRow + rangeInt(random, -1, 1), 0, CITY.rows - 1);
    }
    const point = ringPoint(ped.blockCol, ped.blockRow);
    ped.targetX = point.x;
    ped.targetY = point.y;
  }

  // ------------------------------------------------------------ setup

  function reset() {
    state.time = 0;
    state.money = 0;
    state.over = null;
    state.cars.length = 0;
    state.peds.length = 0;
    for (const b of state.bullets) b.active = false;
    for (const p of state.particles) p.active = false;
    clearWanted(wanted);

    for (const spawn of city.parkedSpawns) {
      state.cars.push(makeCar(random, spawn.x, spawn.y, spawn.angle, 'parked', pick(random, CAR_COLORS)));
    }
    const coupe = makeCar(random, city.coupeSpawn.x, city.coupeSpawn.y, city.coupeSpawn.angle, 'parked', '#d23b2e');
    state.cars.push(coupe);
    state.coupe = coupe;
    const showpiece = makeCar(random, city.showpieceSpawn.x, city.showpieceSpawn.y, city.showpieceSpawn.angle, 'showpiece', '#e6b93d');
    state.cars.push(showpiece);
    state.showpiece = showpiece;
    state.garage.cooldown = 0;
    for (let i = 0; i < TRAFFIC.count; i += 1) spawnTrafficCar();

    for (let i = 0; i < PED.count; i += 1) {
      const col = rangeInt(random, 0, CITY.cols - 1);
      const row = rangeInt(random, 0, CITY.rows - 1);
      const point = ringPoint(col, row);
      const ped = spawnPed(point.x, point.y);
      ped.blockCol = col;
      ped.blockRow = row;
      choosePedTarget(ped, true);
    }

    const home = city.specials.safehouse;
    player.x = home.x;
    player.y = home.y;
    player.angle = Math.PI / 2;
    player.health = PLAYER.maxHealth;
    player.inCar = false;
    player.car = null;
    player.kx = 0; player.ky = 0;
    state.camera.x = player.x;
    state.camera.y = player.y;
    state.cameraLock = null;
    state.attract = false;
  }

  /** Put the run back on its feet after an arrest or a hospital visit. */
  function respawnAt(x, y) {
    player.x = x;
    player.y = y;
    player.health = PLAYER.maxHealth;
    player.inCar = false;
    player.car = null;
    player.kx = 0; player.ky = 0;
    player.sinceHurt = 99;
    clearWanted(wanted);
    state.cars = state.cars.filter((car) => car.kind !== 'police');
    state.over = null;
    state.camera.x = x;
    state.camera.y = y;
  }

  // ------------------------------------------------------------ cars

  /** Shared arcade driving: throttle and steering in, speed and heading out. */
  function driveInputs(car, dt, throttle, steer, maxSpeed, accel) {
    if (car.health <= 0) throttle = 0;
    if (throttle > 0) {
      car.speed += accel * throttle * dt * (car.speed < 0 ? 2.2 : 1);
    } else if (throttle < 0) {
      car.speed += (car.speed > 8 ? CAR.braking : CAR.acceleration * 0.55) * throttle * dt;
    } else {
      const roll = 130 * dt;
      car.speed = Math.abs(car.speed) <= roll ? 0 : car.speed - Math.sign(car.speed) * roll;
    }
    car.speed -= car.speed * CAR.drag * dt;
    car.speed = clamp(car.speed, -CAR.maxReverse, maxSpeed);
    const lock = CAR.steerLock * (1 - 0.42 * Math.min(1, Math.abs(car.speed) / CAR.maxSpeed));
    const turn = (car.speed / 34) * Math.tan(steer * lock);
    car.angle += clamp(turn * dt, -0.09, 0.09);
  }

  /** Move a car and push it out of buildings and the world edge; returns impact speed. */
  function integrateCar(car, dt) {
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    let impact = 0;
    const probeR = CAR.width * 0.58;
    for (const ahead of [CAR.length * 0.28, -CAR.length * 0.28]) {
      const px = car.x + Math.cos(car.angle) * ahead;
      const py = car.y + Math.sin(car.angle) * ahead;
      for (const rect of city.colliders) {
        if (px < rect.x - probeR || px > rect.x + rect.w + probeR || py < rect.y - probeR || py > rect.y + rect.h + probeR) continue;
        const hit = circleRectResolve(px, py, probeR, rect);
        if (!hit) continue;
        car.x += hit.x - px;
        car.y += hit.y - py;
        const into = -(Math.cos(car.angle) * car.speed * hit.nx + Math.sin(car.angle) * car.speed * hit.ny);
        if (into > 0) {
          impact = Math.max(impact, into);
          car.speed *= 0.82;
        }
      }
    }
    const m = 20;
    if (car.x < m || car.x > city.size - m || car.y < m || car.y > city.size - m) {
      car.x = clamp(car.x, m, city.size - m);
      car.y = clamp(car.y, m, city.size - m);
      car.speed *= 0.7;
    }
    return impact;
  }

  function damageCar(car, amount, events) {
    if (car.health <= 0) return;
    car.health -= amount;
    if (car.health <= 0) {
      car.health = 0;
      if (car.driver === 'ai' && car.kind === 'traffic') car.driver = null;
    }
    return events;
  }

  /** The traffic brain: follow the lane to the next intersection, then choose a way on. */
  function trafficControl(car, dt) {
    // A routed car (the tail target) pulls over and parks up for good at its destination.
    if (car.routeDest && dist2(car.x, car.y, car.routeDest.x, car.routeDest.y) < 110 * 110) {
      if (Math.abs(car.speed) > 6) driveInputs(car, dt, -0.7, 0, CAR.maxSpeed, CAR.acceleration);
      else {
        car.speed = 0;
        car.arrived = true;
      }
      return;
    }
    let targetSpeed = car.health <= 0 ? 0 : car.cruise;
    // Obstacles ahead in this lane: other cars (the player's included), then people.
    let blockerCar = null;
    let blockerAhead = Infinity;
    for (const other of state.cars) {
      if (other === car) continue;
      const ahead = (other.x - car.x) * Math.cos(car.angle) + (other.y - car.y) * Math.sin(car.angle);
      const lateral = Math.abs(-(other.x - car.x) * Math.sin(car.angle) + (other.y - car.y) * Math.cos(car.angle));
      if (ahead > 0 && ahead < TRAFFIC.lookAhead && lateral < 17) {
        targetSpeed = ahead < TRAFFIC.lookAhead * 0.5 ? 0 : Math.min(targetSpeed, car.cruise * 0.4);
        if (ahead < blockerAhead) { blockerAhead = ahead; blockerCar = other; }
      }
    }
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const ahead = (ped.x - car.x) * Math.cos(car.angle) + (ped.y - car.y) * Math.sin(car.angle);
      const lateral = Math.abs(-(ped.x - car.x) * Math.sin(car.angle) + (ped.y - car.y) * Math.cos(car.angle));
      if (ahead > 4 && ahead < 56 && lateral < 15) targetSpeed = 0;
    }
    if (!player.inCar) {
      const ahead = (player.x - car.x) * Math.cos(car.angle) + (player.y - car.y) * Math.sin(car.angle);
      const lateral = Math.abs(-(player.x - car.x) * Math.sin(car.angle) + (player.y - car.y) * Math.cos(car.angle));
      if (ahead > 4 && ahead < 56 && lateral < 15) targetSpeed = 0;
    }

    // Steering: aim at a look-ahead point pinned to this car's lane.
    let targetX;
    let targetY;
    if (car.roadDir.x !== 0) {
      targetX = car.x + car.roadDir.x * 130;
      targetY = streetCenterY(car.streetJ) + (car.roadDir.x > 0 ? TRAFFIC.laneOffset : -TRAFFIC.laneOffset);
    } else {
      targetX = streetCenterX(car.streetI) + (car.roadDir.y > 0 ? -TRAFFIC.laneOffset : TRAFFIC.laneOffset);
      targetY = car.y + car.roadDir.y * 130;
    }
    const desired = Math.atan2(targetY - car.y, targetX - car.x);
    const diff = angleDiff(car.angle, desired);
    const steer = clamp(diff * 2.2, -1, 1);
    if (Math.abs(diff) > 0.55) targetSpeed = Math.min(targetSpeed, car.cruise * 0.5);
    const throttle = car.speed < targetSpeed ? 0.85 : -0.7;
    driveInputs(car, dt, targetSpeed === 0 && car.speed < 4 ? -0.4 : throttle, steer, CAR.maxSpeed, CAR.acceleration);

    // Jam breaking: a car held up by another car — queued behind a wreck or locked
    // in a nose-to-nose knot — eventually clears. (Being held up by the player or
    // an officer does not count: that queue is honest.) Ordinary traffic is
    // recycled to a far street, the far-traffic cleanup's trick; a routed car
    // instead has the traffic blocking it recycled, so a tail can never deadlock.
    const heldByCar = blockerCar !== null && blockerCar.kind !== 'police' && blockerCar.driver !== 'player';
    if (heldByCar && car.health > 0 && Math.abs(car.speed) < 20) {
      car.jamTime = (car.jamTime ?? 0) + dt;
      const limit = car.kind === 'target' ? 5 : 8;
      if (car.jamTime > limit) {
        car.jamTime = 0;
        if (car.kind === 'target') {
          if (blockerCar.kind === 'traffic') recycleCar(blockerCar);
          else if (blockerCar.kind === 'parked' && blockerCar !== state.coupe && blockerCar !== state.showpiece) {
            // A kerbside car can simply be parked somewhere else instead.
            const spawn = pick(random, city.parkedSpawns);
            blockerCar.x = spawn.x;
            blockerCar.y = spawn.y;
            blockerCar.angle = spawn.angle;
            blockerCar.speed = 0;
          } else recycleCar(car);
        } else {
          recycleCar(car);
        }
      }
    } else {
      car.jamTime = Math.max(0, (car.jamTime ?? 0) - dt * 3);
    }

    // Arriving at the target intersection: pick the way on.
    car.turnCooldown -= dt;
    const cx = streetCenterX(car.nextI);
    const cy = streetCenterY(car.nextJ);
    if (dist2(car.x, car.y, cx, cy) < 30 * 30 && car.turnCooldown <= 0) {
      const atI = car.nextI;
      const atJ = car.nextJ;
      const options = [];
      const straight = car.roadDir;
      const left = { x: car.roadDir.y, y: -car.roadDir.x };
      const right = { x: -car.roadDir.y, y: car.roadDir.x };
      const addIfLegal = (dir, weight) => {
        const ni = atI + dir.x;
        const nj = atJ + dir.y;
        if (ni >= 0 && ni <= CITY.cols && nj >= 0 && nj <= CITY.rows) options.push({ dir, weight });
      };
      addIfLegal(straight, 0.55);
      addIfLegal(left, 0.22);
      addIfLegal(right, 0.23);
      if (options.length === 0) {
        car.roadDir = { x: -straight.x, y: -straight.y };
      } else if (car.routeDest) {
        // Routed cars take whichever legal way on leaves them closest to the destination.
        let chosen = options[0].dir;
        let bestD = Infinity;
        for (const option of options) {
          const d = dist2(streetCenterX(atI + option.dir.x), streetCenterY(atJ + option.dir.y), car.routeDest.x, car.routeDest.y);
          if (d < bestD) { bestD = d; chosen = option.dir; }
        }
        car.roadDir = chosen;
      } else {
        let roll = random();
        let chosen = options[options.length - 1].dir;
        for (const option of options) {
          roll -= option.weight;
          if (roll <= 0) { chosen = option.dir; break; }
        }
        car.roadDir = chosen;
      }
      // The street the car now travels on is the one through the intersection it just reached.
      if (car.roadDir.x !== 0) car.streetJ = atJ;
      if (car.roadDir.y !== 0) car.streetI = atI;
      car.nextI = atI + car.roadDir.x;
      car.nextJ = atJ + car.roadDir.y;
      car.turnCooldown = 1.4;
    }
  }

  /** The police brain: run the player down, then sit on them until the bust meter fills. */
  function policeControl(car, dt) {
    const target = player.inCar && player.car ? player.car : player;
    const d = dist(car.x, car.y, target.x, target.y);
    let aimX = target.x;
    let aimY = target.y;
    if (player.inCar && player.car) {
      aimX += Math.cos(player.car.angle) * player.car.speed * 0.32;
      aimY += Math.sin(player.car.angle) * player.car.speed * 0.32;
    }
    if (car.recovering) {
      aimX = car.recoverX;
      aimY = car.recoverY;
      if (dist(car.x, car.y, aimX, aimY) < 60 || car.stuckTime <= 0) car.recovering = false;
    }
    const desired = Math.atan2(aimY - car.y, aimX - car.x);
    const diff = angleDiff(car.angle, desired);
    const steer = clamp(diff * 2.4, -1, 1);
    let targetSpeed = POLICE.maxSpeed;
    if (d < 130) targetSpeed = Math.max(player.inCar ? Math.abs(player.car.speed) + 52 : 66, 60);
    if (!player.inCar && d < 74) targetSpeed = 44;
    if (Math.abs(diff) > 1.15) targetSpeed = Math.min(targetSpeed, 130);
    const throttle = car.speed < targetSpeed ? 1 : -0.8;
    driveInputs(car, dt, throttle, steer, POLICE.maxSpeed, POLICE.acceleration);
    // Stuck against a building? Break for the nearest street and come again.
    if (!car.recovering && Math.abs(car.speed) < 16 && throttle > 0) car.stuckTime += dt;
    else if (!car.recovering) car.stuckTime = Math.max(0, car.stuckTime - dt * 2);
    if (car.stuckTime > 0.9 && !car.recovering) {
      const point = randomStreetPoint(random);
      car.recoverX = point.x;
      car.recoverY = point.y;
      car.recovering = true;
      car.stuckTime = 1.6;
    }
    if (car.recovering) car.stuckTime -= dt;
  }

  function carCarCollisions(events) {
    const cars = state.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 42 * 42 || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (42 - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const avx = Math.cos(a.angle) * a.speed;
        const avy = Math.sin(a.angle) * a.speed;
        const bvx = Math.cos(b.angle) * b.speed;
        const bvy = Math.sin(b.angle) * b.speed;
        const closing = (avx - bvx) * nx + (avy - bvy) * ny;
        // Any touch involving the player's car is stamped on the other car, hard or
        // gentle: the tail job reads it to know the sedan has been hit.
        if (player.inCar && (player.car === a || player.car === b)) {
          const other = player.car === a ? b : a;
          other.lastPlayerHitTime = state.time;
        }
        if (closing <= CAR.softHit) continue;
        const damage = Math.min(20, (closing - CAR.softHit) / 12);
        damageCar(a, damage);
        damageCar(b, damage);
        sparks((a.x + b.x) / 2, (a.y + b.y) / 2, closing > 250 ? 14 : 7);
        a.speed *= 0.68;
        b.speed *= 0.68;
        const playerInvolved = (player.inCar && (player.car === a || player.car === b));
        if (playerInvolved) {
          events |= closing > 250 ? EV_CRASH : EV_HIT;
          const other = player.car === a ? b : a;
          other.lastPlayerHitTime = state.time;
          // Blame follows the approach: the crime counts only when the player's car
          // was driving into the other one harder than it was driving into them.
          // Getting rammed by a pursuer, or rear-ended at a light, is not your crime.
          const dirx = player.car === a ? nx : -nx;
          const diry = player.car === a ? ny : -ny;
          const playerApproach = (Math.cos(player.car.angle) * player.car.speed) * dirx
            + (Math.sin(player.car.angle) * player.car.speed) * diry;
          const otherApproach = -((Math.cos(other.angle) * other.speed) * dirx
            + (Math.sin(other.angle) * other.speed) * diry);
          if (playerApproach > otherApproach) {
            reportIfWitnessed(other.kind === 'police' ? 'hitPoliceCar' : 'hitCar', other.x, other.y);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ people

  function stepPeds(dt) {
    for (const ped of state.peds) {
      if (ped.dead) {
        ped.fade = Math.max(0, ped.fade - dt * 0.03);
        continue;
      }
      if (ped.state === 'down') {
        ped.downTime -= dt;
        ped.x += ped.vx * dt;
        ped.y += ped.vy * dt;
        ped.vx *= 0.86;
        ped.vy *= 0.86;
        if (ped.downTime <= 0 && ped.health > 0) ped.state = 'walk';
        continue;
      }
      let speed = PED.walkSpeed * ped.speedVar;
      let tx = ped.targetX;
      let ty = ped.targetY;
      if (ped.state === 'flee') {
        ped.fleeTime -= dt;
        const away = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
        tx = ped.x + Math.cos(away) * 120;
        ty = ped.y + Math.sin(away) * 120;
        speed = PED.fleeSpeed;
        if (ped.fleeTime <= 0) {
          ped.state = 'walk';
          choosePedTarget(ped, true);
        }
      } else if (dist2(ped.x, ped.y, tx, ty) < 12 * 12) {
        choosePedTarget(ped);
        continue;
      }
      const desired = Math.atan2(ty - ped.y, tx - ped.x);
      ped.angle = angleTurn(ped.angle, desired, 6 * dt);
      ped.x += Math.cos(ped.angle) * speed * dt;
      ped.y += Math.sin(ped.angle) * speed * dt;
      for (const rect of city.colliders) {
        const hit = circleRectResolve(ped.x, ped.y, PED.radius, rect);
        if (hit) { ped.x = hit.x; ped.y = hit.y; }
      }
      ped.x = clamp(ped.x, 8, city.size - 8);
      ped.y = clamp(ped.y, 8, city.size - 8);
    }
  }

  function hurtPed(ped, amount, fromX, fromY, events) {
    if (ped.dead) return events;
    ped.health -= amount;
    const away = Math.atan2(ped.y - fromY, ped.x - fromX);
    ped.vx = Math.cos(away) * 190;
    ped.vy = Math.sin(away) * 190;
    if (ped.health <= 0) {
      ped.state = 'down';
      ped.dead = true;
      ped.downTime = 9999;
      events |= EV_PED_DOWN;
    } else if (ped.state !== 'down') {
      ped.state = 'down';
      ped.downTime = PED.downSeconds;
      events |= EV_PED_DOWN;
    }
    return events;
  }

  function pedCarContacts(events) {
    for (const car of state.cars) {
      if (Math.abs(car.speed) < 30) continue;
      for (const ped of state.peds) {
        if (ped.state === 'down') continue;
        if (dist2(car.x, car.y, ped.x, ped.y) > 30 * 30) continue;
        const wasAlive = ped.health > 0;
        events = hurtPed(ped, Math.abs(car.speed) * 0.32, car.x, car.y, events);
        if (player.inCar && player.car === car) {
          reportIfWitnessed('hitPed', ped.x, ped.y);
          if (wasAlive && ped.health <= 0) reportIfWitnessed('pedDown', ped.x, ped.y);
          events |= EV_HIT;
        }
        sparks(ped.x, ped.y, 5, '#e8e4da');
      }
      // The player, on foot, in the road.
      if (!player.inCar && dist2(car.x, car.y, player.x, player.y) < 30 * 30) {
        const severity = Math.abs(car.speed);
        if (severity > 105 && player.hurtCooldown <= 0) {
          hurtPlayer((severity - 105) * 0.14, car.x, car.y);
          events |= EV_HIT;
        }
        const away = Math.atan2(player.y - car.y, player.x - car.x);
        player.kx = Math.cos(away) * severity * 0.7;
        player.ky = Math.sin(away) * severity * 0.7;
      }
    }
    return events;
  }

  function hurtPlayer(amount, fromX, fromY) {
    player.health -= amount;
    player.sinceHurt = 0;
    player.hurtCooldown = 0.5;
    const away = Math.atan2(player.y - fromY, player.x - fromX);
    player.kx += Math.cos(away) * 120;
    player.ky += Math.sin(away) * 120;
  }

  // ------------------------------------------------------------ bullets

  function fireBullet(angle) {
    for (const b of state.bullets) {
      if (b.active) continue;
      b.active = true;
      b.x = player.x + Math.cos(angle) * 16;
      b.y = player.y + Math.sin(angle) * 16;
      b.vx = Math.cos(angle) * GUN.bulletSpeed;
      b.vy = Math.sin(angle) * GUN.bulletSpeed;
      b.life = GUN.bulletLife;
      spawnParticle(b.x, b.y, Math.cos(angle) * 30, Math.sin(angle) * 30, 0.06, 5, '#ffe9a8');
      return;
    }
  }

  function stepBullets(dt, events) {
    for (const b of state.bullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0) { b.active = false; continue; }
      let stopped = false;
      for (const rect of city.colliders) {
        if (b.x >= rect.x && b.x <= rect.x + rect.w && b.y >= rect.y && b.y <= rect.y + rect.h) {
          sparks(b.x, b.y, 3);
          stopped = true;
          break;
        }
      }
      if (stopped) { b.active = false; continue; }
      for (const car of state.cars) {
        if (dist2(b.x, b.y, car.x, car.y) < 24 * 24) {
          damageCar(car, GUN.damage * 0.5);
          sparks(b.x, b.y, 6);
          reportIfWitnessed(car.kind === 'police' ? 'shootPoliceCar' : 'shootCar', player.x, player.y);
          events |= EV_HIT;
          stopped = true;
          break;
        }
      }
      if (stopped) { b.active = false; continue; }
      for (const ped of state.peds) {
        if (ped.state === 'down') continue;
        if (dist2(b.x, b.y, ped.x, ped.y) < 12 * 12) {
          events = hurtPed(ped, GUN.damage, player.x, player.y, events);
          reportIfWitnessed('shootPed', player.x, player.y);
          sparks(b.x, b.y, 4, '#d95f4b');
          stopped = true;
          break;
        }
      }
      if (stopped) b.active = false;
    }
    return events;
  }

  // ------------------------------------------------------------ the player

  function nearestEnterableCar() {
    let best = null;
    let bestD = PLAYER.enterRange * PLAYER.enterRange;
    for (const car of state.cars) {
      if (car.kind === 'police' || car.kind === 'target') continue;
      if (Math.abs(car.speed) > 70) continue;
      const d = dist2(player.x, player.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function enterCar(car, events) {
    const wasDriven = car.driver === 'ai';
    if (wasDriven) {
      // The driver bails out and runs: hand the nearest far pedestrian the part.
      let spare = null;
      let spareD = -1;
      for (const ped of state.peds) {
        const d = dist2(player.x, player.y, ped.x, ped.y);
        if (ped.state !== 'down' && d > spareD) { spareD = d; spare = ped; }
      }
      if (spare) {
        spare.x = car.x + 20;
        spare.y = car.y + 10;
        spare.state = 'flee';
        spare.fleeTime = PED.fleeSeconds;
        spare.fleeX = car.x;
        spare.fleeY = car.y;
      }
    }
    car.driver = 'player';
    if (car.kind === 'traffic') car.kind = 'parked';
    player.inCar = true;
    player.car = car;
    if (!car.stolen && car !== state.coupe) {
      car.stolen = true;
      reportIfWitnessed('stealCar', car.x, car.y);
      events |= EV_STEAL;
    }
    return events | EV_ENTER;
  }

  function exitCar(events) {
    const car = player.car;
    car.driver = null;
    car.speed = 0;
    const side = car.angle + Math.PI / 2;
    player.x = car.x + Math.cos(side) * 30;
    player.y = car.y + Math.sin(side) * 30;
    for (const rect of city.colliders) {
      const hit = circleRectResolve(player.x, player.y, PLAYER.radius, rect);
      if (hit) { player.x = hit.x; player.y = hit.y; }
    }
    player.inCar = false;
    player.car = null;
    return events | EV_EXIT;
  }

  function stepPlayer(dt, ctrl, events) {
    player.fireCooldown -= dt;
    player.hurtCooldown -= dt;
    player.sinceHurt += dt;
    if (!player.inCar && player.health > 0 && player.sinceHurt > PLAYER.regenDelay) {
      player.health = Math.min(PLAYER.maxHealth, player.health + PLAYER.regenRate * dt);
    }

    if (ctrl.enter) {
      if (player.inCar) events = exitCar(events);
      else {
        const car = nearestEnterableCar();
        if (car) events = enterCar(car, events);
      }
    }

    if (player.inCar) {
      const car = player.car;
      // Positive steer turns clockwise (right, in screen space), like the traffic brain's.
      const throttle = ctrl.moveY < 0 ? 1 : ctrl.moveY > 0 ? -1 : 0;
      driveInputs(car, dt, throttle, ctrl.moveX, CAR.maxSpeed, CAR.acceleration);
      player.x = car.x;
      player.y = car.y;
      player.speedMag = Math.abs(car.speed);
      if (car.health < 55 && random() < 0.3) smoke(car.x, car.y, car.health < 25);
    } else {
      let mx = ctrl.moveX;
      let my = ctrl.moveY;
      const len = Math.hypot(mx, my);
      if (len > 0) { mx /= len; my /= len; }
      const speed = ctrl.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      player.x += (mx * speed + player.kx) * dt;
      player.y += (my * speed + player.ky) * dt;
      player.kx *= 0.84;
      player.ky *= 0.84;
      player.speedMag = len > 0 ? speed : Math.hypot(player.kx, player.ky);
      if (ctrl.aimX !== null) player.angle = Math.atan2(ctrl.aimY - player.y, ctrl.aimX - player.x);
      else if (len > 0) player.angle = Math.atan2(my, mx);
      for (const rect of city.colliders) {
        const hit = circleRectResolve(player.x, player.y, PLAYER.radius, rect);
        if (hit) { player.x = hit.x; player.y = hit.y; }
      }
      for (const car of state.cars) {
        if (dist2(player.x, player.y, car.x, car.y) < 30 * 30) {
          const d = Math.max(1, dist(player.x, player.y, car.x, car.y));
          const push = (30 - d);
          player.x += ((player.x - car.x) / d) * push;
          player.y += ((player.y - car.y) / d) * push;
        }
      }
      player.x = clamp(player.x, 10, city.size - 10);
      player.y = clamp(player.y, 10, city.size - 10);

      if (ctrl.firing && player.fireCooldown <= 0) {
        player.fireCooldown = GUN.fireInterval;
        fireBullet(player.angle + range(random, -GUN.spread, GUN.spread));
        panicPeds(player.x, player.y, PED.panicRadius);
        reportIfWitnessed('gunshot', player.x, player.y);
        events |= EV_SHOT;
      }
    }
    return events;
  }

  // ------------------------------------------------------------ police bookkeeping

  function stepPolice(dt) {
    const quota = policeQuota(wanted);
    let count = 0;
    for (const car of state.cars) if (car.kind === 'police') count += 1;
    state.policeTimer -= dt;
    if (count < quota && state.policeTimer <= 0) {
      if (spawnPoliceCar()) count += 1;
      state.policeTimer = 0.7;
    }
    // Officers far away with the heat off give up and leave the world.
    state.cars = state.cars.filter((car) => {
      if (car.kind !== 'police') return true;
      if (wanted.stars > 0) return true;
      return dist(car.x, car.y, player.x, player.y) < POLICE.giveUpRange;
    });

    // The bust meter: an officer close by while the player is nearly stopped.
    let nearOfficer = false;
    if (wanted.stars > 0) {
      for (const car of state.cars) {
        if (car.kind === 'police' && dist2(car.x, car.y, player.x, player.y) < POLICE.bustRange * POLICE.bustRange) {
          nearOfficer = true;
          break;
        }
      }
    }
    if (nearOfficer && player.speedMag < 46) wanted.bust = Math.min(1, wanted.bust + POLICE.bustFill * dt);
    else wanted.bust = Math.max(0, wanted.bust - POLICE.bustDrain * dt);
  }

  // ------------------------------------------------------------ Skypak Garage

  /** The repair bay's centre and radius, on the ground in front of the garage. */
  function garageBayPoint() {
    const g = city.specials.garage;
    return { x: g.x, y: g.y + GARAGE.bayOffsetY, r: GARAGE.bayRadius };
  }

  function removeCar(car) {
    const index = state.cars.indexOf(car);
    if (index >= 0) state.cars.splice(index, 1);
  }

  /**
   * What the Skypak crew would do for the car the player is sitting in, or null when
   * the player is not in a car in the bay. A quote with clean=true means there is
   * nothing to fix and no heat to shed.
   */
  function garageQuote() {
    if (!player.inCar || !player.car) return null;
    const bay = garageBayPoint();
    if (dist(player.x, player.y, bay.x, bay.y) > bay.r) return null;
    const shedStar = wanted.stars > 0;
    const clean = player.car.health >= CAR.maxHealth && !shedStar;
    const fee = Math.round(GARAGE.baseFee + (CAR.maxHealth - player.car.health) * GARAGE.perDamage);
    return { fee, shedStar, clean, cooldown: state.garage.cooldown };
  }

  /**
   * Pay the crew: full repair and one wanted star forgotten, then a cooldown.
   * Returns {ok:true, fee, shedStar} or {ok:false, reason: 'away'|'clean'|'busy'|'cash'}.
   */
  function tryGarageService() {
    const quote = garageQuote();
    if (!quote) return { ok: false, reason: 'away' };
    if (quote.clean) return { ok: false, reason: 'clean' };
    if (state.garage.cooldown > 0) return { ok: false, reason: 'busy', cooldown: state.garage.cooldown };
    if (state.money < quote.fee) return { ok: false, reason: 'cash', fee: quote.fee };
    state.money -= quote.fee;
    player.car.health = CAR.maxHealth;
    if (quote.shedStar) setWantedHeat(wanted, heatForStars(wanted.stars - 1));
    state.garage.cooldown = GARAGE.cooldown;
    return { ok: true, fee: quote.fee, shedStar: quote.shedStar };
  }

  // ------------------------------------------------------------ camera

  function stepCamera(dt) {
    if (state.cameraLock) {
      state.camera.x = state.cameraLock.x;
      state.camera.y = state.cameraLock.y;
      return;
    }
    let tx = player.x;
    let ty = player.y;
    if (state.attract) {
      tx = city.size / 2 + Math.cos(state.time * 0.05) * 420;
      ty = city.size / 2 + Math.sin(state.time * 0.037) * 420;
    } else if (player.inCar && player.car) {
      tx += Math.cos(player.car.angle) * player.car.speed * 0.24;
      ty += Math.sin(player.car.angle) * player.car.speed * 0.24;
    }
    const k = 1 - Math.exp(-dt * 4.2);
    state.camera.x += (tx - state.camera.x) * k;
    state.camera.y += (ty - state.camera.y) * k;
    state.camera.x = clamp(state.camera.x, VIEW.width / 2, city.size - VIEW.width / 2);
    state.camera.y = clamp(state.camera.y, VIEW.height / 2, city.size - VIEW.height / 2);
  }

  // ------------------------------------------------------------ the step

  /**
   * Advance the world one fixed step. ctrl: {moveX, moveY, aimX, aimY (world coords or
   * null), firing, sprint, enter}. Returns EV_* flags for what happened.
   */
  function step(dt, ctrl) {
    let events = 0;
    if (state.over) return events;
    state.time += dt;
    if (state.garage.cooldown > 0) state.garage.cooldown = Math.max(0, state.garage.cooldown - dt);

    events = stepPlayer(dt, ctrl, events);

    for (const car of state.cars) {
      if (car.driver !== 'player') {
        if (car.kind === 'police' && car.driver === 'ai' && wanted.stars > 0) policeControl(car, dt);
        else if ((car.kind === 'traffic' || car.kind === 'target') && car.driver === 'ai') trafficControl(car, dt);
        else {
          // Parked or abandoned: roll to a stop.
          car.speed -= car.speed * 2.4 * dt;
          if (Math.abs(car.speed) < 2) car.speed = 0;
        }
      }
      const impact = integrateCar(car, dt);
      if (impact > CAR.softHit) {
        damageCar(car, Math.min(22, (impact - CAR.softHit) / 14));
        sparks(car.x, car.y, impact > 250 ? 12 : 6);
        if (car.driver === 'player') {
          events |= impact > 250 ? EV_CRASH : EV_HIT;
          reportIfWitnessed('hitCar', car.x, car.y);
        }
      }
      if (car.health < 55 && car.health > 0 && random() < 0.22) smoke(car.x, car.y, car.health < 25);
      // Traffic that has wandered far from the action quietly re-enters near it.
      if (car.kind === 'traffic' && car.driver === 'ai' && dist2(car.x, car.y, player.x, player.y) > 1250 * 1250) {
        const { point, vertical } = laneSpawn(700);
        car.x = point.x;
        car.y = point.y;
        car.speed = 0;
        const dir = random() < 0.5 ? 1 : -1;
        if (vertical) { car.roadDir = { x: 0, y: dir }; car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
        else { car.roadDir = { x: dir, y: 0 }; car.angle = dir > 0 ? 0 : Math.PI; }
        aimAtIntersection(car);
      }
    }
    if (player.inCar && player.car) {
      player.x = player.car.x;
      player.y = player.car.y;
    }
    carCarCollisions(events);
    events = pedCarContacts(events);
    stepPeds(dt);
    events = stepBullets(dt, events);
    stepParticles(dt);
    stepPolice(dt);

    let seen = false;
    for (const car of state.cars) {
      if (car.kind === 'police' && dist2(car.x, car.y, player.x, player.y) < WANTED.sightRange * WANTED.sightRange) {
        seen = true;
        break;
      }
    }
    updateWanted(wanted, dt, seen);

    if (wanted.bust >= 1) {
      state.over = 'busted';
      events |= EV_BUSTED;
    } else if (player.health <= 0) {
      player.health = 0;
      state.over = 'wasted';
      events |= EV_WASTED;
    }

    stepCamera(dt);
    return events;
  }

  reset();

  return {
    state,
    reset,
    step,
    respawnAt,
    nearestEnterableCar,
    setHeat(value) {
      setWantedHeat(wanted, value);
    },
    /** Direct scene-setting helpers, used by the screenshot staging. */
    teleportPlayer(x, y) {
      player.x = x;
      player.y = y;
      state.camera.x = x;
      state.camera.y = y;
    },
    putPlayerInCar(car) {
      car.driver = 'player';
      if (car.kind === 'traffic') car.kind = 'parked';
      player.inCar = true;
      player.car = car;
      player.x = car.x;
      player.y = car.y;
    },
    spawnPoliceNow() {
      return spawnPoliceCar();
    },
    /** Place a police car exactly here, rolling: scene staging for screenshots. */
    addPoliceAt(x, y, angle, speed) {
      const car = makeCar(random, x, y, angle, 'police', '#eef1f4');
      car.speed = speed;
      state.cars.push(car);
      return car;
    },
    /**
     * Send out a routed car: it drives the streets like traffic but chooses its way at
     * every intersection toward (destX, destY), then pulls over and parks for good.
     * Used for the tail job's sedan. Heading east along a street, like a traffic spawn.
     */
    spawnRouteCar(x, y, angle, destX, destY, color) {
      const car = makeCar(random, x, y, angle, 'target', color);
      car.driver = 'ai';
      car.cruise = TAIL.cruise;
      car.routeDest = { x: destX, y: destY };
      car.roadDir = { x: 1, y: 0 };
      aimAtIntersection(car);
      state.cars.push(car);
      return car;
    },
    removeCar,
    /**
     * Make sure the gold Vantara S is sitting in the bank lot, whole: if it was wrecked
     * (and the player is not sitting in the wreck), a fresh one takes its place.
     */
    stageShowpiece() {
      const current = state.showpiece;
      if (current && (current.health > 0 || player.car === current)) return current;
      if (current) removeCar(current);
      const car = makeCar(random, city.showpieceSpawn.x, city.showpieceSpawn.y, city.showpieceSpawn.angle, 'showpiece', '#e6b93d');
      state.cars.push(car);
      state.showpiece = car;
      return car;
    },
    garageBay() {
      return garageBayPoint();
    },
    garageQuote,
    tryGarageService,
  };
}
