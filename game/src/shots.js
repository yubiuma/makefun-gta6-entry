// The screenshot scenes behind ?shot=start|drive|chase|mission (with &seed=N). Each one
// stages the real game — the actual world, missions and HUD — into a composed frame and
// steps it briefly so traffic and people are mid-motion, then holds it. The same seed
// always gives the same frame.
import { STEP } from './config.js';
import { streetCenterY } from './city.js';
import { heatForStars } from './wanted.js';
import { updateMissions } from './missions.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const IDLE = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false, sprint: false, enter: false };
const DRIVING = { moveX: 0, moveY: -1, aimX: null, aimY: null, firing: false, sprint: false, enter: false };

function stepFor(world, seconds, ctrl) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) world.step(STEP, ctrl);
}

/** The title over a framed view of the noodle bar corner: Dee, her coupe, traffic passing. */
function stageStart(world, city) {
  const noodle = city.specials.noodle;
  world.state.cameraLock = { x: noodle.x + 90, y: noodle.y - 30 };
  stepFor(world, 3.2, IDLE);
  return SCREEN_TITLE;
}

/** Mid-errand: Rook in Dee's coupe in moving traffic, the cannery run on the HUD. */
function stageDrive(world, missions, city) {
  const noodle = city.specials.noodle;
  // Walk up to Dee: the first mission starts, exactly as it does in play.
  world.teleportPlayer(noodle.x + 20, noodle.y + 4);
  updateMissions(missions, world, city);
  const coupe = world.state.coupe;
  const laneY = streetCenterY(4) + 17; // the eastbound lane of the street below the noodle bar
  coupe.x = 1240;
  coupe.y = laneY;
  coupe.angle = 0;
  coupe.speed = 228;
  // Company on the road: one car ahead in lane, one coming the other way.
  const traffic = world.state.cars.filter((car) => car.kind === 'traffic');
  if (traffic[0]) {
    traffic[0].x = 1560; traffic[0].y = laneY; traffic[0].angle = 0; traffic[0].speed = 205;
    traffic[0].roadDir = { x: 1, y: 0 };
  }
  if (traffic[1]) {
    traffic[1].x = 1620; traffic[1].y = streetCenterY(4) - 17; traffic[1].angle = Math.PI; traffic[1].speed = 198;
    traffic[1].roadDir = { x: -1, y: 0 };
  }
  world.putPlayerInCar(coupe);
  updateMissions(missions, world, city); // the enterCoupe step completes, as in play
  world.state.camera.x = coupe.x + 60;
  world.state.camera.y = coupe.y;
  stepFor(world, 0.7, DRIVING);
  return SCREEN_PLAY;
}

/** The package run at its worst: three stars, three patrol cars, nowhere to hide. */
function stageChase(world, missions) {
  missions.chainIndex = 1;
  missions.active = true;
  missions.stepIndex = 1; // the deliver step of Hot Soup
  missions.carrying = true;
  const coupe = world.state.coupe;
  const laneY = streetCenterY(5) + 17;
  coupe.x = 980;
  coupe.y = laneY;
  coupe.angle = 0;
  coupe.speed = 305;
  world.putPlayerInCar(coupe);
  world.setHeat(heatForStars(3));
  world.addPoliceAt(838, laneY - 26, 0.1, 322);
  world.addPoliceAt(822, laneY + 30, -0.08, 330);
  world.addPoliceAt(742, laneY, 0, 315);
  world.state.camera.x = coupe.x + 40;
  world.state.camera.y = coupe.y;
  stepFor(world, 0.55, DRIVING);
  // Contact during the staged chase bumps the heat; pin the frame at exactly three stars.
  world.setHeat(heatForStars(3));
  return SCREEN_PLAY;
}

/** On foot at the noodle bar: Dee, the first job's marker, and the red coupe waiting. */
function stageMission(world, city) {
  const npc = world.state.npc;
  world.teleportPlayer(npc.x + 30, npc.y + 8);
  world.state.player.angle = Math.PI; // facing Dee
  world.state.cameraLock = { x: npc.x + 16, y: npc.y + 52 };
  stepFor(world, 1.4, IDLE);
  return SCREEN_PLAY;
}

/**
 * Set the world and missions to the named scene and return the screen to draw over it.
 * Any other name is the title scene.
 */
export function stageShot(name, world, missions, city) {
  switch (name) {
    case 'drive':
      return { screen: stageDrive(world, missions, city) };
    case 'chase':
      return { screen: stageChase(world, missions) };
    case 'mission':
      return { screen: stageMission(world, city) };
    default:
      return { screen: stageStart(world, city) };
  }
}
