// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps, missions advance once a frame, and the 3D renderer and the DOM HUD paint what
// is there. The game moves between five screens: title, play, paused, busted and
// wasted. Progress (money, story position, courier tally) is kept in localStorage
// between visits.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints a few frames so the WebGL
// scene is fully uploaded, and sets window.__shotReady for a screenshot.
import { SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld, EV_BUSTED, EV_CRASH, EV_ENTER, EV_EXIT, EV_HIT, EV_PED_DOWN, EV_SHOT, EV_STEAL, EV_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { CHAIN, cousinSpot, createMissionState, currentStep, hudExtras, markerFor, objectiveText, objectiveTitle, restoreMissions, updateMissions, failCurrentJob } from './missions.js';
import { createRenderer } from './render3d.js';
import { SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './screens.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const city = createCity(createRandom(seed));
const world = createWorld(createRandom(seed ^ 0x9e3779b9), city);
const missions = createMissionState(createRandom(seed ^ 0x51ab2f));
const renderer = createRenderer(canvas, city);
const hud = createHud();
const audio = createAudio();

// ------------------------------------------------------------ save and load

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.money !== 'number' || typeof parsed.chainIndex !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      // Version 2: the six-mission story. Version 1 saves (three missions) still load:
      // they carry the same money/chainIndex/sideJobsDone fields, and restoreMissions
      // defaults anything a save does not have.
      version: 2,
      money: world.state.money,
      chainIndex: missions.chainIndex,
      sideJobsDone: missions.sideJobsDone,
    }));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

/** Story progress for the HUD's pips and courier rep. */
function storyFor(ms) {
  return { done: ms.chainIndex, total: CHAIN.length, active: ms.active, sideJobs: ms.sideJobsDone };
}

/** Dee's line for the story step now running, if it has one. */
function deeLine(ms) {
  const step = ms.active ? currentStep(ms) : null;
  return step?.dee ?? null;
}

function saveSummary(save) {
  const story = save.chainIndex >= CHAIN.length ? 'story complete' : `mission ${save.chainIndex + 1} of ${CHAIN.length}`;
  return `$${save.money.toLocaleString('en-US')} · ${story}`;
}

// ------------------------------------------------------------ screenshot mode

function runShot(name) {
  const scene = stageShot(name, world, missions, city);
  const extras = hudExtras(missions, world);
  const ui = {
    screen: scene.screen,
    camera: scene.camera ?? null,
    marker: scene.screen === SCREEN_TITLE ? null : markerFor(missions, city, world),
    objective: scene.screen === SCREEN_TITLE ? null : { title: objectiveTitle(missions), text: objectiveText(missions) },
    prompt: null,
    banner: null,
    carrying: missions.carrying,
    passenger: missions.passenger,
    timer: extras.timer,
    meter: extras.meter,
    cousin: cousinSpot(missions, city),
    garageActive: false,
    muted: false,
    saveExists: false,
    saveSummary: '',
    fine: 0,
    story: scene.screen === SCREEN_TITLE ? null : storyFor(missions),
    dialogue: scene.screen === SCREEN_TITLE ? null : scene.dialogue ?? null,
    air: scene.air ?? null,
  };
  let painted = 0;
  function paint() {
    renderer.draw(world, ui);
    hud.update(world, ui, city, renderer.cameraState);
    painted += 1;
    if (painted < 4) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// ------------------------------------------------------------ the game

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let save = loadSave();
  let banner = null;
  let dialogue = null;
  let lastStepKey = '';
  let fine = 0;
  let accumulator = 0;
  let last = performance.now();

  world.state.attract = true;

  function announce(message) {
    status.textContent = message;
  }

  function showBanner(title, sub, duration = 3.4) {
    banner = { title, sub, t: 0, duration };
  }

  function say(text, via = 'ON THE PHONE') {
    dialogue = { text, via, t: 0, duration: Math.max(4.5, 2 + text.length * 0.06) };
  }

  function startRun(fresh) {
    world.reset();
    if (fresh) {
      restoreMissions(missions, { chainIndex: 0, sideJobsDone: 0 });
      persist();
    } else if (save) {
      world.state.money = save.money;
      restoreMissions(missions, save);
    }
    world.state.attract = false;
    dialogue = null;
    lastStepKey = '';
    screen = SCREEN_PLAY;
    showBanner('AZURA BAY', objectiveText(missions), 3);
    announce('Playing. ' + objectiveText(missions));
  }

  function endRun(kind) {
    screen = kind === 'busted' ? SCREEN_BUSTED : SCREEN_WASTED;
    fine = kind === 'busted'
      ? Math.min(world.state.money, 60 + world.state.wanted.stars * 40)
      : Math.min(world.state.money, 80);
    failCurrentJob(missions, world);
    audio.fail();
    audio.sirenSet(0);
    audio.engineSet(null);
    announce(kind === 'busted' ? 'Busted.' : 'Wasted.');
  }

  function backOnStreet() {
    world.state.money -= fine;
    fine = 0;
    const place = screen === SCREEN_BUSTED ? city.specials.noodle : city.specials.hospital;
    world.respawnAt(place.x, place.y);
    persist();
    save = loadSave();
    screen = SCREEN_PLAY;
    announce('Back on the street. ' + objectiveText(missions));
  }

  function handleEvents(events) {
    if (events & EV_SHOT) audio.shot();
    if (events & EV_CRASH) audio.crash();
    else if (events & EV_HIT) audio.hit(0.55);
    if (events & EV_PED_DOWN) audio.hit(0.85);
    if (events & EV_STEAL) audio.hit(0.3);
    if (events & (EV_ENTER | EV_EXIT)) audio.click();
    if (events & EV_BUSTED) endRun('busted');
    else if (events & EV_WASTED) endRun('wasted');
  }

  function handleMissions(simDt) {
    updateMissions(missions, world, city, simDt);
    if (missions.justStarted) {
      const mission = missions.justStarted;
      showBanner(`MISSION ${missions.chainIndex + 1} — ${mission.title.toUpperCase()}`, mission.intro);
      audio.click();
      announce(`Mission: ${mission.title}. ${mission.intro}`);
    }
    if (missions.justFailed) {
      const failed = missions.justFailed;
      showBanner('JOB BLOWN', failed.reason, 3.8);
      audio.fail();
      announce(`Job blown: ${failed.reason}`);
    }
    if (missions.justPickedUp) {
      audio.pickup();
      announce('Package picked up.');
    }
    // Dee calls as each story step begins (in person when the mission starts at her
    // door), and once more when a mission pays out.
    const stepKey = missions.active ? `${missions.chainIndex}:${missions.stepIndex}` : '';
    if (stepKey !== lastStepKey) {
      lastStepKey = stepKey;
      const line = deeLine(missions);
      if (line) say(line, missions.justStarted ? 'IN PERSON' : 'ON THE PHONE');
    }
    if (missions.justCompleted) {
      const done = missions.justCompleted;
      const outro = CHAIN.find((m) => m.title === done.title)?.outro;
      if (outro) say(outro);
      showBanner('JOB COMPLETE', `${done.title} — +$${done.reward}`);
      audio.success();
      persist();
      save = loadSave();
      announce(`Job complete: ${done.title}, plus $${done.reward}.`);
    }
  }

  function currentPrompt() {
    const player = world.state.player;
    if (screen !== SCREEN_PLAY) return null;
    const bay = world.garageBay();
    const inBay = Math.hypot(player.x - bay.x, player.y - bay.y) < bay.r;
    if (player.inCar) {
      // In the Skypak bay the action key is the crew's, not the door's.
      if (!inBay) return null;
      const quote = world.garageQuote();
      if (!quote || quote.clean) return quote ? 'Skypak Garage — she runs clean, nothing to fix' : null;
      if (quote.cooldown > 0) return `Skypak crew is busy — back in ${Math.ceil(quote.cooldown)}s`;
      return quote.shedStar
        ? `E — Skypak: full repair + shed a star ($${quote.fee})`
        : `E — Skypak: full repair ($${quote.fee})`;
    }
    if (inBay) return 'Skypak Garage — drive a car into the bay for repairs';
    const car = world.nearestEnterableCar();
    if (!car) return null;
    return car === world.state.coupe ? "E — Get into Dee's coupe" : 'E — Steal this car';
  }

  function buildUi() {
    const extras = hudExtras(missions, world);
    const player = world.state.player;
    const bay = world.garageBay();
    return {
      screen,
      camera: null,
      marker: screen === SCREEN_TITLE ? null : markerFor(missions, city, world),
      objective: screen === SCREEN_TITLE ? null : { title: objectiveTitle(missions), text: objectiveText(missions) },
      prompt: currentPrompt(),
      banner,
      carrying: missions.carrying,
      passenger: missions.passenger,
      timer: extras.timer,
      meter: extras.meter,
      cousin: cousinSpot(missions, city),
      garageActive: Math.hypot(player.x - bay.x, player.y - bay.y) < bay.r,
      muted: audio.muted,
      saveExists: save !== null,
      saveSummary: save ? saveSummary(save) : '',
      fine,
      story: screen === SCREEN_TITLE ? null : storyFor(missions),
      dialogue,
      air: null,
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    audio.unlock();

    const actions = input.takeActions();
    if (actions & ACTION_MUTE) audio.toggleMute();

    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startRun(true);
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & ACTION_PAUSE) screen = SCREEN_PLAY;
      else if (actions & ACTION_CONFIRM) {
        screen = SCREEN_TITLE;
        world.state.attract = true;
      }
    } else if (screen === SCREEN_BUSTED || screen === SCREEN_WASTED) {
      if (actions & (ACTION_RESTART | ACTION_CONFIRM)) backOnStreet();
    }

    const playing = screen === SCREEN_PLAY || screen === SCREEN_TITLE;
    if (playing) {
      const player = world.state.player;
      // On foot the mouse aims where its ray meets the street; the simulation
      // still thinks in ground points, so the renderer hands back exactly that.
      const aimPoint = renderer.toGround(input.mouse.clientX, input.mouse.clientY);
      const hasMouse = input.mouse.clientX !== 0 || input.mouse.clientY !== 0;

      // In the Skypak bay, the action key talks to the crew instead of the door:
      // a successful service swallows the press, anything else lets it through.
      let enterPressed = (actions & ACTION_ENTER) !== 0;
      if (enterPressed && screen === SCREEN_PLAY && player.inCar) {
        const res = world.tryGarageService();
        if (res.ok) {
          enterPressed = false;
          showBanner('SKYPAK GARAGE', res.shedStar
            ? `Repaired, resprayed, one star forgotten — -$${res.fee}`
            : `Repaired and resprayed — -$${res.fee}`);
          audio.success();
          persist();
          save = loadSave();
          announce(`Garage service: repaired for $${res.fee}.`);
        } else if (res.reason === 'cash') {
          announce(`Skypak needs $${res.fee} for that — you are short.`);
        } else if (res.reason === 'busy') {
          announce('The Skypak crew is still busy with the last car.');
        }
      }

      let firstStep = true;
      let simDt = 0;
      while (accumulator >= STEP && playing) {
        const ctrl = {
          moveX: screen === SCREEN_PLAY ? input.moveX() : 0,
          moveY: screen === SCREEN_PLAY ? input.moveY() : 0,
          aimX: hasMouse && aimPoint ? aimPoint.x : null,
          aimY: hasMouse && aimPoint ? aimPoint.y : null,
          firing: screen === SCREEN_PLAY && input.firing() && !player.inCar,
          sprint: input.sprint(),
          enter: firstStep && enterPressed,
        };
        const events = world.step(STEP, ctrl);
        simDt += STEP;
        if (screen === SCREEN_PLAY) handleEvents(events);
        firstStep = false;
        accumulator -= STEP;
        if (world.state.over && screen === SCREEN_PLAY) break;
      }
      if (screen === SCREEN_PLAY) handleMissions(simDt);
    } else {
      accumulator = 0;
    }

    if (banner) {
      banner.t += 1 / 60; // frames arrive at the display's rate; close enough for a fade
      if (banner.t >= banner.duration) banner = null;
    }
    if (dialogue && screen === SCREEN_PLAY) {
      dialogue.t += 1 / 60;
      if (dialogue.t >= dialogue.duration) dialogue = null;
    }

    // The loops under the game: sirens follow the stars, the engine follows the car.
    if (screen === SCREEN_PLAY) {
      const stars = world.state.wanted.stars;
      audio.sirenSet(stars > 0 ? 0.3 + stars * 0.14 : 0);
      const player = world.state.player;
      audio.engineSet(player.inCar && player.car ? Math.abs(player.car.speed) / 432 : null);
    } else if (screen === SCREEN_TITLE || screen === SCREEN_PAUSED) {
      audio.sirenSet(0);
      audio.engineSet(null);
    }

    const ui = buildUi();
    renderer.draw(world, ui);
    hud.update(world, ui, city, renderer.cameraState);
  }

  // Continue is its own key on the title screen.
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC' && screen === SCREEN_TITLE && save) startRun(false);
  });

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Azura Bay: Night Run. Press Enter to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
