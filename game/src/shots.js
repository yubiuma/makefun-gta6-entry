// The screenshot scenes behind ?shot=start|drive|chase|mission (with &seed=N). Each
// one stages the real game — the actual world, missions and HUD — into a composed
// frame and steps it briefly so traffic and people are mid-motion, then holds it.
// The same seed always gives the same frame. Staging happens in simulation
// coordinates exactly as it did in the top-down version; what changed is the
// composition: each scene also hands the 3D renderer a camera (a fixed frame for
// the cover, a pulled-back chase camera for the pursuit) chosen so everything the
// scene is about is actually in the picture.
import { STEP, TRAFFIC } from './config.js';
import { streetCenterY } from './city.js';
import { heatForStars } from './wanted.js';
import { updateMissions } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './screens.js';

const IDLE = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false, sprint: false, enter: false };
const DRIVING = { moveX: 0, moveY: -1, aimX: null, aimY: null, firing: false, sprint: false, enter: false };

function stepFor(world, seconds, ctrl) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) world.step(STEP, ctrl);
}

/** Park a traffic car on a horizontal street's lane, set up to hold that lane. */
function stageTraffic(car, x, y, dir, speed, streetJ, nextI) {
  if (!car) return;
  car.x = x;
  car.y = y;
  car.angle = dir > 0 ? 0 : Math.PI;
  car.speed = speed;
  car.roadDir = { x: dir, y: 0 };
  car.streetJ = streetJ;
  car.nextI = nextI;
  car.nextJ = streetJ;
  car.turnCooldown = 99; // straight through the frame: no turns while the scene steps
}

/** Set pedestrians down at spots in the frame, strolling east along the pavement. */
function placePeds(world, spots, offset = 0) {
  const peds = world.state.peds;
  spots.forEach(([x, y], i) => {
    const ped = peds[(i + offset) % peds.length];
    if (!ped) return;
    ped.x = x;
    ped.y = y;
    ped.state = 'walk';
    ped.targetX = x + 130;
    ped.targetY = y;
  });
}

/** The cover: a fixed elevated frame on the noodle bar corner — Dee under her neon
 *  sign, her coupe at the kerb, traffic rolling past on the street below. */
function stageStart(world, city) {
  const noodle = city.specials.noodle;
  const laneY = streetCenterY(4);
  const traffic = world.state.cars.filter((car) => car.kind === 'traffic');
  stageTraffic(traffic[0], noodle.x - 316, laneY + TRAFFIC.laneOffset, 1, 210, 4, 3);
  stageTraffic(traffic[1], noodle.x + 544, laneY - TRAFFIC.laneOffset, -1, 195, 4, 2);
  stageTraffic(traffic[2], noodle.x - 516, laneY + TRAFFIC.laneOffset, 1, 224, 4, 3);
  placePeds(world, [
    [noodle.x - 136, noodle.y - 5],
    [noodle.x + 134, noodle.y - 3],
    [noodle.x - 6, noodle.y + 90],
    [noodle.x + 224, noodle.y - 5],
    [noodle.x - 256, noodle.y + 90],
  ], 2);
  stepFor(world, 3.2, IDLE);
  return {
    screen: SCREEN_TITLE,
    camera: {
      mode: 'fixed',
      x: noodle.x + 128, y: noodle.y + 238, height: 64,
      lookX: noodle.x - 8, lookY: noodle.y - 14, lookHeight: 24,
    },
  };
}

/** Mid-errand: Rook in Dee's coupe in moving traffic, the cannery run on the HUD,
 *  rolling past the noodle bar and Rook's own place, both signs in frame. */
function stageDrive(world, missions, city) {
  const noodle = city.specials.noodle;
  // Walk up to Dee: the first mission starts, exactly as it does in play.
  world.teleportPlayer(noodle.x + 20, noodle.y + 4);
  updateMissions(missions, world, city);
  const coupe = world.state.coupe;
  const laneY = streetCenterY(4) + TRAFFIC.laneOffset; // the eastbound lane below the noodle bar
  coupe.x = 950;
  coupe.y = laneY;
  coupe.angle = 0;
  coupe.speed = 228;
  // Company on the road: one car ahead in lane, one coming the other way, one behind.
  const traffic = world.state.cars.filter((car) => car.kind === 'traffic');
  stageTraffic(traffic[0], 1330, laneY, 1, 205, 4, 5);
  stageTraffic(traffic[1], 1520, streetCenterY(4) - TRAFFIC.laneOffset, -1, 198, 4, 3);
  stageTraffic(traffic[2], 740, laneY, 1, 218, 4, 4);
  placePeds(world, [
    [1050, noodle.y - 7],
    [1230, noodle.y + 95],
    [860, noodle.y - 7],
  ], 5);
  world.putPlayerInCar(coupe);
  updateMissions(missions, world, city); // the enterCoupe step completes, as in play
  stepFor(world, 0.7, DRIVING);
  // A wandering pedestrian can step into the road during the staged roll and
  // leave the frame at two stars; the composed shot is a clean errand run.
  world.setHeat(0);
  return { screen: SCREEN_PLAY, camera: null };
}

/** The package run at its worst: three stars, four patrol cars in the frame —
 *  one on each flank, one cutting in ahead, one hard on the bumper — under a
 *  pulled-back chase camera so the whole pursuit reads at once. */
function stageChase(world, missions) {
  missions.chainIndex = 1;
  missions.active = true;
  missions.stepIndex = 1; // the deliver step of Hot Soup
  missions.carrying = true;
  const coupe = world.state.coupe;
  const laneY = streetCenterY(5) + TRAFFIC.laneOffset;
  coupe.x = 980;
  coupe.y = laneY;
  coupe.angle = 0;
  coupe.speed = 305;
  world.putPlayerInCar(coupe);
  world.setHeat(heatForStars(3));
  // Placed a half-step wide on purpose: the pursuit steering converges on the
  // coupe while the scene steps, so the flank cars start at the road's edges
  // and close into an escort formation instead of piling straight onto it.
  world.addPoliceAt(948, laneY - 50, 0.05, 306); // left flank
  world.addPoliceAt(952, laneY + 50, -0.05, 303); // right flank
  world.addPoliceAt(1158, laneY - 8, 0.3, 290); // cutting in ahead
  world.addPoliceAt(892, laneY + 14, -0.03, 324); // on the bumper
  // Civilian traffic fleeing ahead and coming the other way; neighbours watching.
  const traffic = world.state.cars.filter((car) => car.kind === 'traffic');
  stageTraffic(traffic[0], 1420, laneY, 1, 265, 5, 6);
  stageTraffic(traffic[1], 1560, streetCenterY(5) - TRAFFIC.laneOffset, -1, 200, 5, 4);
  placePeds(world, [
    [1090, laneY - 62],
    [905, laneY + 32],
    [1200, laneY - 62],
  ], 8);
  stepFor(world, 0.22, DRIVING);
  // Contact during the staged chase bumps the heat; pin the frame at exactly three stars.
  world.setHeat(heatForStars(3));
  return {
    screen: SCREEN_PLAY,
    camera: { dist: 160, height: 72, lookAhead: 40 },
  };
}

/** Mission 5, mid-tail: the grey sedan rolling east out of Port Market with Rook
 *  hanging back inside the band, the tail meter up on the HUD where a good shadow
 *  keeps it, and the night city lit up ahead of them both. */
function stageMission(world, missions, city) {
  missions.chainIndex = 4;
  missions.active = true;
  missions.stepIndex = 1; // the tail step of Quiet Tail
  updateMissions(missions, world, city, 0); // the sedan rolls out, exactly as in play
  const target = missions.tailCar;
  const laneY = streetCenterY(3) + TRAFFIC.laneOffset;
  target.x = 760;
  target.y = laneY;
  target.angle = 0;
  target.speed = 200;
  // Rook's ride: a parked car lifted for the job, staged a band's width behind.
  const ride = world.state.cars.find((car) => car.kind === 'parked' && car !== world.state.coupe) ?? world.state.coupe;
  ride.x = 566;
  ride.y = laneY;
  ride.angle = 0;
  ride.speed = 196;
  world.putPlayerInCar(ride);
  // One more car ahead of the sedan, and neighbours on both pavements.
  const traffic = world.state.cars.filter((car) => car.kind === 'traffic');
  stageTraffic(traffic[0], 1080, laneY, 1, 185, 3, 4);
  placePeds(world, [
    [700, laneY - 62],
    [880, laneY + 36],
    [1020, laneY - 62],
  ], 11);
  // Clear the sedan's lane corridor east of the market: a stray parked car or a
  // crossing pedestrian would have it brake, and Rook would run up its bumper.
  for (const car of world.state.cars) {
    if (car === target || car === ride || car === traffic[0] || car.kind === 'police') continue;
    if (Math.abs(car.y - laneY) < 34 && car.x > 480 && car.x < 1500) car.y = laneY + 280 * 3;
  }
  for (const ped of world.state.peds) {
    if (Math.abs(ped.y - laneY) < 22 && ped.x > 480 && ped.x < 1500) ped.y = laneY - 62;
  }
  // Roll for a second, driving the ride the way a player tails: gas on to close,
  // off the pedal to hold the band, brake before the sedan's bumper.
  const steps = Math.round(1.0 / STEP);
  for (let i = 0; i < steps; i += 1) {
    const gap = Math.hypot(target.x - ride.x, target.y - ride.y);
    const moveY = gap > 185 ? -1 : gap < 140 ? 1 : 0;
    world.step(STEP, { ...DRIVING, moveY });
  }
  missions.tail.meter = 0.65; // the meter where a good shadow keeps it
  return {
    screen: SCREEN_PLAY,
    camera: { dist: 148, height: 70, lookAhead: 130 },
  };
}

/**
 * Set the world and missions to the named scene and return {screen, camera} for
 * the renderer and HUD. Any other name is the title scene.
 */
export function stageShot(name, world, missions, city) {
  switch (name) {
    case 'drive':
      return stageDrive(world, missions, city);
    case 'chase':
      return stageChase(world, missions);
    case 'mission':
      return stageMission(world, missions, city);
    default:
      return stageStart(world, city);
  }
}
