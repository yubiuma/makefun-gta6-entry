// The story: nine jobs for fixer Dee Voss, then open-ended courier work. A mission is a
// list of steps; each step has a kind (talk, enterCoupe, goto, pickup, deliver, escape,
// pickupCousin, timedGoto, tailStart, tail, stealShowpiece, deliverShowpiece), a place in
// the city, the objective line the HUD shows, and Dee's phone line (`dee`; a mission's
// `outro` is her line when it pays; both are HUD text only). The state machine here
// watches the world, advances steps, pays rewards into the world's money, and reports
// completions so the caller can banner, save and make noise. Places are keys into city.specials.
import { CAR, TAIL, TRAFFIC } from './config.js';
import { heatForStars } from './wanted.js';
import { dist } from './geom.js';
import { streetCenterX, streetCenterY } from './city.js';

export const CHAIN = [
  {
    id: 'noodle-run',
    title: 'Noodle Run',
    reward: 150,
    intro: 'Dee needs her coupe dropped at the Old Cannery.',
    outro: 'Clean work. Come back when you want real money.',
    steps: [
      { kind: 'enterCoupe', text: "Get into Dee's red coupe, parked outside", dee: 'Keys are in it. Scratch my paint and you wash dishes till spring.' },
      { kind: 'goto', loc: 'cannery', text: 'Drive the coupe to the Old Cannery', dee: 'Old Cannery, east side. Leave it by the loading door and walk.' },
    ],
  },
  {
    id: 'hot-soup',
    title: 'Hot Soup',
    reward: 300,
    intro: 'A package at the Cannery needs to reach Skypak Garage. It will attract attention.',
    outro: 'Skypak says thanks. I say do it quieter next time.',
    steps: [
      { kind: 'pickup', loc: 'cannery', text: 'Pick up the package at the Old Cannery', setStars: 2, dee: "The package is at the Cannery. Don't open it. Don't shake it." },
      { kind: 'deliver', loc: 'garage', text: 'Deliver the package to Skypak Garage', dee: 'That box lit up every scanner in the bay. Skypak, now, Rook!' },
    ],
  },
  {
    id: 'last-delivery',
    title: 'The Last Delivery',
    reward: 650,
    intro: 'One last run: a cash duffel at Marina Stores, and every cop in Azura Bay will want it.',
    outro: 'That was the last delivery. Probably.',
    steps: [
      { kind: 'goto', loc: 'marina', text: 'Drive to Marina Stores', dee: "Marina Stores. The duffel's behind the counter. This is the big one." },
      { kind: 'pickup', loc: 'marina', text: 'Grab the cash duffel', setStars: 3, dee: 'Grab it and go. Every siren in Azura Bay is about to hear about it.' },
      { kind: 'escape', text: 'Lose the police!', dee: 'Three stars! Lose them. Do NOT bring them to my door.' },
      { kind: 'deliver', loc: 'noodle', text: 'Bring the duffel back to Dee', dee: 'Quiet now? Good. Bring my duffel home.' },
    ],
  },
  {
    id: 'cousin-trouble',
    title: 'Cousin Trouble',
    reward: 400,
    intro: "Dee's cousin Milo is stranded at Marina Stores and late for his shift at the Lumiere. Fetch him. Quickly.",
    outro: 'He made it. My aunt owes you a dinner.',
    steps: [
      { kind: 'pickupCousin', loc: 'marina', text: "Pick up Dee's cousin Milo at Marina Stores — bring a car", dee: "Milo's at the Marina, late as always. He won't walk, so bring a car." },
      { kind: 'timedGoto', loc: 'hotel', text: 'Get Milo to Hotel Lumiere before his shift starts', timeLimit: 75, dee: "Lumiere, seventy-five seconds. If he's fired, he moves in with me." },
    ],
  },
  {
    id: 'quiet-tail',
    title: 'Quiet Tail',
    reward: 500,
    intro: 'A grey sedan is moving something for the Port Market crew. Follow it home, and do not be made.',
    outro: 'The station lot. Now we know. Nice work, shadow.',
    steps: [
      { kind: 'tailStart', loc: 'market', text: 'Get to Port Market — a grey sedan is about to roll out', dee: 'A grey sedan leaves Port Market tonight. I want to know where it sleeps.' },
      { kind: 'tail', destLoc: 'station', text: 'Tail the grey sedan — stay close, never closer', dee: "Don't ride his bumper, Rook. Port Market crews check their mirrors." },
    ],
  },
  {
    id: 'the-showpiece',
    title: 'The Showpiece',
    reward: 1200,
    intro: 'A gold Vantara S is sitting in the bank lot and Dee has a buyer with cash. Bring it home whole.',
    outro: 'Sold. Half the city owes you now. The other half runs Port Market.',
    steps: [
      { kind: 'stealShowpiece', text: 'Steal the gold Vantara S from the bank lot', dee: 'Gold Vantara S, bank lot. The tracker wakes up the second you touch it.' },
      { kind: 'deliverShowpiece', loc: 'garage', text: 'Deliver the Vantara to Skypak Garage — keep her above 40% health', minHealth: 40, dee: 'Skypak, and keep her pretty. My buyer pays for paint, not dents.' },
    ],
  },
  {
    id: 'market-squeeze',
    title: 'Market Squeeze',
    reward: 900,
    intro: "The Port Market crew keeps its ledger in the back office. Take it, shake four stars, and drop it at the Old Cannery.",
    outro: "Their whole book, in my freezer. Port Market won't sleep tonight.",
    steps: [
      { kind: 'pickup', loc: 'market', text: 'Lift the ledger from the Port Market back office', setStars: 4, dee: 'In and out of Port Market. The crew calls the cops on thieves. Funny, right?' },
      { kind: 'escape', text: 'Four stars — lose them!', dee: 'Four stars, Rook! Use the side streets. Skypak can buy you a star.' },
      { kind: 'deliver', loc: 'cannery', text: 'Drop the ledger at the Old Cannery', dee: "Clear? Good. Cannery freezer, third shelf. Don't read it." },
    ],
  },
  {
    id: 'night-shift',
    title: 'Night Shift',
    reward: 600,
    intro: 'Milo traded the Lumiere for night shifts at St Marina Hospital. He is stuck at Marina Stores again, and late again.',
    outro: 'A porter with a getaway driver. My aunt is so proud.',
    steps: [
      { kind: 'pickupCousin', loc: 'marina', text: 'Pick up Milo at Marina Stores — bring a car', dee: "Milo again. Marina Stores. I'm buying that boy a bicycle." },
      { kind: 'timedGoto', loc: 'hospital', text: 'Get Milo to St Marina Hospital before his shift', timeLimit: 80, dee: 'St Marina, eighty seconds. The night nurse does not forgive.' },
    ],
  },
  {
    id: 'bank-holiday',
    title: 'Bank Holiday',
    reward: 1500,
    intro: "Dee's last favour: a deposit box at Azura Bank that half the city is watching. Get it to Rook's Place.",
    outro: "Debts paid, Rook. Azura Bay is yours. Come eat, it's on me.",
    steps: [
      { kind: 'goto', loc: 'bank', text: 'Drive to Azura Bank', dee: "Last one, I swear. Azura Bank. Box 1404. They know you're coming." },
      { kind: 'pickup', loc: 'bank', text: 'Take box 1404 from the bank', setStars: 3, dee: 'Alarms. Of course alarms. Go, go!' },
      { kind: 'deliver', loc: 'safehouse', text: "Get the box home to Rook's Place", dee: "Your place, right by mine. Lose them or don't. Just get there." },
    ],
  },
];

/** Places a courier job can start or end at: everywhere with a name except Dee's door. */
const COURIER_PLACES = ['cannery', 'garage', 'marina', 'bank', 'hotel', 'hospital', 'station', 'market', 'safehouse'];

export function createMissionState(random) {
  return {
    random,
    /** Index into CHAIN of the next story mission; CHAIN.length when the story is done. */
    chainIndex: 0,
    stepIndex: 0,
    active: false,
    carrying: false,
    /** Milo is in the passenger seat (mission 4, between pickup and drop-off). */
    passenger: false,
    /** Seconds left on a timedGoto step; null when no clock is running. */
    timer: null,
    /** The tail job's sedan, a world car, while the tail step runs. */
    tailCar: null,
    /** Tail bookkeeping: the meter, how long the player has loitered too close, and
     *  the last player-on-sedan contact the state machine has already accounted for. */
    tail: { meter: 0, closeTime: 0, hitSeen: -99, stuck: 0, lx: 0, ly: 0 },
    /** The open courier job once the story is done: {phase, pickup, drop, reward}. */
    sideJob: null,
    sideJobsDone: 0,
    /** Set for one update when a mission or job completes: {title, reward}. */
    justCompleted: null,
    /** Set for one update when a mission starts: the mission definition. */
    justStarted: null,
    /** Set for one update when a package changes hands. */
    justPickedUp: false,
    /** Set for one update when a step blows it and resets: {title, reason}. */
    justFailed: null,
  };
}

/** Restore progress from a save: story position and courier tally. Fields a save does
 *  not carry (older saves predate them) fall back to a fresh run's values. */
export function restoreMissions(ms, saved) {
  ms.chainIndex = Math.min(CHAIN.length, Math.max(0, saved.chainIndex | 0));
  ms.sideJobsDone = Math.max(0, saved.sideJobsDone | 0);
  ms.stepIndex = 0;
  ms.active = false;
  ms.carrying = false;
  ms.passenger = false;
  ms.timer = null;
  ms.tailCar = null;
  ms.tail = { meter: 0, closeTime: 0, hitSeen: -99, stuck: 0, lx: 0, ly: 0 };
  ms.sideJob = null;
}

export function currentStep(ms) {
  if (ms.active) return CHAIN[ms.chainIndex].steps[ms.stepIndex] ?? null;
  if (ms.sideJob) {
    return ms.sideJob.phase === 'pickup'
      ? { kind: 'pickup', loc: ms.sideJob.pickupKey, text: `Pick up the parcel at ${ms.sideJob.pickupName}` }
      : { kind: 'deliver', loc: ms.sideJob.dropKey, text: `Deliver the parcel to ${ms.sideJob.dropName}` };
  }
  return null;
}

/** The headline over the objective line: the mission's name, or the standing instruction. */
export function objectiveTitle(ms) {
  if (ms.active) return `Mission ${ms.chainIndex + 1} — ${CHAIN[ms.chainIndex].title}`;
  if (ms.sideJob) return 'Courier Job';
  return ms.chainIndex < CHAIN.length ? 'Story' : 'Free Roam';
}

/** The objective line the HUD shows right now. */
export function objectiveText(ms) {
  const step = currentStep(ms);
  if (step) return step.text;
  if (ms.chainIndex < CHAIN.length) return 'Meet Dee Voss outside the Voss Noodle Bar';
  return 'Talk to Dee for courier work — or just enjoy Azura Bay';
}

/**
 * Where the map marker stands, as {x, y, kind}, or null when there is nowhere to go
 * (the escape step: the marker is the police themselves). The coupe's, the sedan's and
 * the showpiece's markers move with the cars.
 */
export function markerFor(ms, city, world) {
  const step = currentStep(ms);
  if (!ms.active && !ms.sideJob) {
    const noodle = city.specials.noodle;
    return { x: noodle.x, y: noodle.y, kind: 'talk' };
  }
  if (!step) return null;
  if (step.kind === 'escape') return null;
  if (step.kind === 'enterCoupe') {
    const coupe = world.state.coupe;
    return { x: coupe.x, y: coupe.y, kind: 'car' };
  }
  if (step.kind === 'stealShowpiece') {
    const showpiece = world.state.showpiece;
    return showpiece ? { x: showpiece.x, y: showpiece.y, kind: 'car' } : null;
  }
  if (step.kind === 'tail') {
    if (ms.tailCar) return { x: ms.tailCar.x, y: ms.tailCar.y, kind: 'tail' };
    const market = city.specials.market;
    return { x: market.x, y: market.y, kind: 'goto' };
  }
  const place = city.specials[step.loc];
  return place ? { x: place.x, y: place.y, kind: step.kind } : null;
}

/** Where Milo waits, while the pickup step of mission 4 is live: {x, y, name} or null. */
export function cousinSpot(ms, city) {
  if (!ms.active || ms.passenger) return null;
  const step = currentStep(ms);
  if (!step || step.kind !== 'pickupCousin') return null;
  const marina = city.specials.marina;
  return { x: marina.x - 16, y: marina.y + 4, name: 'MILO' };
}

/**
 * The extra instruments the HUD paints under the objective: a countdown for the timed
 * step, and a labelled meter for the tail and for the showpiece's hull.
 */
export function hudExtras(ms, world) {
  const step = currentStep(ms);
  let timer = null;
  let meter = null;
  if (ms.active && step) {
    if (step.kind === 'timedGoto' && ms.timer !== null) timer = Math.max(0, ms.timer);
    if (step.kind === 'tail') {
      meter = { label: 'TAIL', frac: ms.tail.meter, good: ms.tail.meter >= TAIL.passMeter };
    }
    if (step.kind === 'stealShowpiece' || step.kind === 'deliverShowpiece') {
      const car = world.state.showpiece;
      if (car && world.state.player.car === car) {
        meter = { label: 'VANTARA HULL', frac: car.health / CAR.maxHealth, good: car.health >= (step.minHealth ?? 40) };
      }
    }
  }
  return { timer, meter };
}

function startChainMission(ms) {
  ms.active = true;
  ms.stepIndex = 0;
  ms.carrying = false;
  ms.passenger = false;
  ms.timer = null;
  ms.justStarted = CHAIN[ms.chainIndex];
}

function startSideJob(ms, city) {
  const pickupKey = COURIER_PLACES[Math.floor(ms.random() * COURIER_PLACES.length)];
  let dropKey = pickupKey;
  while (dropKey === pickupKey) dropKey = COURIER_PLACES[Math.floor(ms.random() * COURIER_PLACES.length)];
  const a = city.specials[pickupKey];
  const b = city.specials[dropKey];
  const reward = Math.round((110 + dist(a.x, a.y, b.x, b.y) * 0.055) / 5) * 5;
  ms.sideJob = { phase: 'pickup', pickupKey, dropKey, pickupName: a.name, dropName: b.name, reward };
}

/** Take the tail sedan out of the world and forget the run at it. */
function clearTail(ms, world) {
  if (ms.tailCar) {
    world.removeCar(ms.tailCar);
    ms.tailCar = null;
  }
  ms.tail = { meter: 0, closeTime: 0, hitSeen: -99, stuck: 0, lx: 0, ly: 0 };
}

function completeStep(ms, world, city) {
  const step = currentStep(ms);
  if (step && step.kind === 'pickup') {
    ms.carrying = true;
    ms.justPickedUp = true;
    if (step.setStars) {
      const wanted = world.state.wanted;
      const heat = heatForStars(step.setStars);
      if (wanted.heat < heat) world.setHeat(heat);
    }
  }
  if (step && step.kind === 'deliver') ms.carrying = false;
  if (step && step.kind === 'pickupCousin') {
    ms.passenger = true;
    ms.justPickedUp = true;
  }
  if (step && step.kind === 'timedGoto') {
    ms.passenger = false;
    ms.timer = null;
  }
  if (step && step.kind === 'stealShowpiece') {
    // The lot has cameras and the Vantara has a tracker: three stars, instantly.
    world.setHeat(heatForStars(3));
  }
  if (step && step.kind === 'tail') clearTail(ms, world);

  if (ms.sideJob) {
    if (ms.sideJob.phase === 'pickup') {
      ms.sideJob.phase = 'deliver';
    } else {
      world.state.money += ms.sideJob.reward;
      ms.justCompleted = { title: 'Courier Job', reward: ms.sideJob.reward };
      ms.sideJob = null;
      ms.sideJobsDone += 1;
    }
    return;
  }

  ms.stepIndex += 1;
  if (ms.stepIndex >= CHAIN[ms.chainIndex].steps.length) {
    const mission = CHAIN[ms.chainIndex];
    world.state.money += mission.reward;
    ms.justCompleted = { title: mission.title, reward: mission.reward };
    ms.chainIndex += 1;
    ms.active = false;
    ms.stepIndex = 0;
    ms.carrying = false;
    ms.passenger = false;
    ms.timer = null;
  }
}

/** Blow the tail step back to its start: the sedan vanishes, the market try again. */
function failTailStep(ms, world, reason) {
  clearTail(ms, world);
  ms.stepIndex = Math.max(0, ms.stepIndex - 1);
  ms.justFailed = { title: CHAIN[ms.chainIndex].title, reason };
}

/** Below this speed (px/s) the tail sedan counts as stopped: snarled in traffic. */
const SEDAN_STOPPED_SPEED = 30;

/**
 * The tail step, one update: keep the sedan rolling, watch the distance band, the
 * spook rules and the meter, and settle the step when the sedan parks up.
 */
function updateTail(ms, world, city, step, dt) {
  const player = world.state.player;
  if (!ms.tailCar) {
    const market = city.specials.market;
    const dest = city.specials[step.destLoc];
    // The sedan rolls out of the market's street, already moving, a little east of the door.
    ms.tailCar = world.spawnRouteCar(
      market.x + 150, streetCenterY(market.row + 1) + TRAFFIC.laneOffset, 0,
      streetCenterX(dest.col), streetCenterY(dest.row + 1),
      '#8a8f96',
    );
    ms.tailCar.speed = 160;
    ms.tail = { meter: 0, closeTime: 0, hitSeen: ms.tailCar.lastPlayerHitTime, stuck: 0, lx: ms.tailCar.x, ly: ms.tailCar.y };
  }
  const target = ms.tailCar;

  // A sedan wedged on a corner or boxed in by an odd pile-up would deadlock the
  // job: if it has barely moved for a good while, its driver backs out and
  // re-enters the route from the nearest street centre, health and all.
  if (!target.arrived && dist(target.x, target.y, ms.tail.lx, ms.tail.ly) < 10) {
    ms.tail.stuck += dt;
    if (ms.tail.stuck > 7) {
      const dest = city.specials[step.destLoc];
      const nx = streetCenterX(Math.max(0, Math.min(8, Math.round((target.x - 36) / 280))));
      const ny = streetCenterY(Math.max(0, Math.min(8, Math.round((target.y - 36) / 280))));
      const health = target.health;
      world.removeCar(target);
      ms.tailCar = world.spawnRouteCar(
        nx, ny, target.angle,
        streetCenterX(dest.col), streetCenterY(dest.row + 1),
        '#8a8f96',
      );
      ms.tailCar.health = health;
      ms.tail.stuck = 0;
      ms.tail.lx = nx;
      ms.tail.ly = ny;
      ms.tail.hitSeen = ms.tailCar.lastPlayerHitTime;
      return;
    }
  } else {
    ms.tail.stuck = 0;
    ms.tail.lx = target.x;
    ms.tail.ly = target.y;
  }

  if (target.lastPlayerHitTime > ms.tail.hitSeen) {
    failTailStep(ms, world, 'You clipped the sedan and it bolted. Dee will have it roll out again.');
    return;
  }
  if (target.health <= 25) {
    failTailStep(ms, world, 'The sedan is a wreck — whatever it carried is lost with it. Start the tail again.');
    return;
  }

  const d = dist(player.x, player.y, target.x, target.y);
  // A sedan snarled in traffic cannot be spooked: while it is barely moving,
  // sitting close behind it is the jam's fault, not the player's, so the spook
  // clock holds where it is instead of filling. It only runs while the sedan
  // is actually rolling, and it still drains as before once the player backs off.
  const sedanStopped = Math.abs(target.speed) < SEDAN_STOPPED_SPEED;
  if (d < TAIL.tooClose) {
    if (!sedanStopped) {
      ms.tail.closeTime += dt;
      if (ms.tail.closeTime > TAIL.spookSeconds) {
        failTailStep(ms, world, 'Too close, too long — the driver made you. Back off and start the tail again.');
        return;
      }
    }
  } else {
    ms.tail.closeTime = Math.max(0, ms.tail.closeTime - dt * 1.5);
  }
  if (d >= TAIL.bandMin && d <= TAIL.bandMax) {
    ms.tail.meter = Math.min(1, ms.tail.meter + TAIL.fillRate * dt);
  } else {
    ms.tail.meter = Math.max(0, ms.tail.meter - TAIL.drainRate * dt);
  }

  if (target.arrived) {
    if (ms.tail.meter >= TAIL.passMeter) completeStep(ms, world, city);
    else failTailStep(ms, world, 'The sedan parked up and you were nowhere near it. Stay on it next time.');
  }
}

/**
 * Advance the story by one frame of game time (dt is the simulated seconds the frame
 * covered; the timers and the tail meter run on it). Reads the player out of the world,
 * writes rewards and scripted heat back into it, and leaves one-shot reports
 * (justStarted, justCompleted, justPickedUp, justFailed) for the caller to consume.
 */
export function updateMissions(ms, world, city, dt = 0) {
  ms.justCompleted = null;
  ms.justStarted = null;
  ms.justPickedUp = false;
  ms.justFailed = null;
  const player = world.state.player;
  const noodle = city.specials.noodle;

  if (!ms.active && !ms.sideJob) {
    // Standing work: walk up to Dee, on foot, and the next job begins.
    if (!player.inCar && dist(player.x, player.y, noodle.x, noodle.y) < 48) {
      if (ms.chainIndex < CHAIN.length) {
        startChainMission(ms);
        if (CHAIN[ms.chainIndex].id === 'the-showpiece') world.stageShowpiece();
      } else {
        startSideJob(ms, city);
      }
    }
    return;
  }

  const step = currentStep(ms);
  if (!step) return;
  const marker = markerFor(ms, city, world);
  switch (step.kind) {
    case 'enterCoupe':
      if (player.inCar && player.car === world.state.coupe) completeStep(ms, world, city);
      break;
    case 'escape':
      if (world.state.wanted.stars === 0) completeStep(ms, world, city);
      break;
    case 'pickupCousin':
      // Milo only gets into a car: roll up to the Marina doors with wheels under you.
      if (player.inCar && marker && dist(player.x, player.y, marker.x, marker.y) < 50) completeStep(ms, world, city);
      break;
    case 'timedGoto': {
      if (ms.timer === null) ms.timer = step.timeLimit;
      ms.timer -= dt;
      if (ms.timer <= 0) {
        // The clock restarts on the same leg: Milo stays put, the shift does not wait.
        ms.timer = step.timeLimit;
        ms.justFailed = { title: CHAIN[ms.chainIndex].title, reason: "Out of time — Milo's shift started without him. The clock is running again." };
        break;
      }
      if (marker && dist(player.x, player.y, marker.x, marker.y) < 46) completeStep(ms, world, city);
      break;
    }
    case 'tailStart':
      if (marker && dist(player.x, player.y, marker.x, marker.y) < 60) completeStep(ms, world, city);
      break;
    case 'tail':
      updateTail(ms, world, city, step, dt);
      break;
    case 'stealShowpiece': {
      const showpiece = world.state.showpiece;
      // A wrecked Vantara (with nobody sitting in it) is quietly replaced in the lot.
      if (showpiece && showpiece.health <= 0 && player.car !== showpiece) world.stageShowpiece();
      if (player.inCar && player.car === world.state.showpiece) completeStep(ms, world, city);
      break;
    }
    case 'deliverShowpiece': {
      const showpiece = world.state.showpiece;
      if (
        player.inCar && player.car === showpiece && marker
        && dist(player.x, player.y, marker.x, marker.y) < 46
        && showpiece.health >= step.minHealth
      ) completeStep(ms, world, city);
      break;
    }
    case 'pickup':
    case 'deliver':
    case 'goto':
      if (marker && dist(player.x, player.y, marker.x, marker.y) < 46) completeStep(ms, world, city);
      break;
    default:
      break;
  }
}

/** Fail the running job back to its start (an arrest or a hospital visit). */
export function failCurrentJob(ms, world) {
  ms.stepIndex = 0;
  ms.carrying = false;
  ms.passenger = false;
  ms.timer = null;
  if (world) clearTail(ms, world);
  if (ms.sideJob) ms.sideJob.phase = 'pickup';
}
