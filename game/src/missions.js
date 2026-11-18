// The story: three jobs for fixer Dee Voss, then open-ended courier work. A mission is a
// list of steps; each step has a kind (talk, enterCoupe, goto, pickup, deliver, escape), a
// place in the city, and the objective line the HUD shows. The state machine here watches
// the world, advances steps, pays rewards into the world's money, and reports completions
// so the caller can banner, save and make noise. Places are keys into city.specials.
import { heatForStars } from './wanted.js';
import { dist } from './geom.js';

export const CHAIN = [
  {
    id: 'noodle-run',
    title: 'Noodle Run',
    reward: 150,
    intro: 'Dee needs her coupe dropped at the Old Cannery.',
    steps: [
      { kind: 'enterCoupe', text: "Get into Dee's red coupe, parked outside" },
      { kind: 'goto', loc: 'cannery', text: 'Drive the coupe to the Old Cannery' },
    ],
  },
  {
    id: 'hot-soup',
    title: 'Hot Soup',
    reward: 300,
    intro: 'A package at the Cannery needs to reach Skypak Garage. It will attract attention.',
    steps: [
      { kind: 'pickup', loc: 'cannery', text: 'Pick up the package at the Old Cannery', setStars: 2 },
      { kind: 'deliver', loc: 'garage', text: 'Deliver the package to Skypak Garage' },
    ],
  },
  {
    id: 'last-delivery',
    title: 'The Last Delivery',
    reward: 650,
    intro: 'One last run: a cash duffel at Marina Stores, and every cop in Azura Bay will want it.',
    steps: [
      { kind: 'goto', loc: 'marina', text: 'Drive to Marina Stores' },
      { kind: 'pickup', loc: 'marina', text: 'Grab the cash duffel', setStars: 3 },
      { kind: 'escape', text: 'Lose the police!' },
      { kind: 'deliver', loc: 'noodle', text: 'Bring the duffel back to Dee' },
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
    /** The open courier job once the story is done: {phase, pickup, drop, reward}. */
    sideJob: null,
    sideJobsDone: 0,
    /** Set for one update when a mission or job completes: {title, reward}. */
    justCompleted: null,
    /** Set for one update when a mission starts: the mission definition. */
    justStarted: null,
    /** Set for one update when a package changes hands. */
    justPickedUp: false,
  };
}

/** Restore progress from a save: story position and courier tally. */
export function restoreMissions(ms, saved) {
  ms.chainIndex = Math.min(CHAIN.length, Math.max(0, saved.chainIndex | 0));
  ms.sideJobsDone = Math.max(0, saved.sideJobsDone | 0);
  ms.stepIndex = 0;
  ms.active = false;
  ms.carrying = false;
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
 * (the escape step: the marker is the police themselves). The coupe's marker moves with it.
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
  const place = city.specials[step.loc];
  return place ? { x: place.x, y: place.y, kind: step.kind } : null;
}

function startChainMission(ms) {
  ms.active = true;
  ms.stepIndex = 0;
  ms.carrying = false;
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
  }
}

/**
 * Advance the story by one step of game time. Reads the player out of the world, writes
 * rewards and scripted heat back into it, and leaves one-shot reports (justStarted,
 * justCompleted, justPickedUp) for the caller to consume.
 */
export function updateMissions(ms, world, city) {
  ms.justCompleted = null;
  ms.justStarted = null;
  ms.justPickedUp = false;
  const player = world.state.player;
  const noodle = city.specials.noodle;

  if (!ms.active && !ms.sideJob) {
    // Standing work: walk up to Dee, on foot, and the next job begins.
    if (!player.inCar && dist(player.x, player.y, noodle.x, noodle.y) < 48) {
      if (ms.chainIndex < CHAIN.length) startChainMission(ms);
      else startSideJob(ms, city);
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
export function failCurrentJob(ms) {
  ms.stepIndex = 0;
  ms.carrying = false;
  if (ms.sideJob) ms.sideJob.phase = 'pickup';
}
