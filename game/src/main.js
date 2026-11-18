// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps, missions advance once a frame, and the renderer paints what is there. The game
// moves between five screens: title, play, paused, busted and wasted. Progress (money,
// story position, courier tally) is kept in localStorage between visits.
//
// ?seed=N fixes the city and the traffic. ?shot=start|drive|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { SAVE_KEY, STEP, VIEW } from './config.js';
import { createRandom } from './random.js';
import { createCity } from './city.js';
import { createWorld, EV_BUSTED, EV_CRASH, EV_ENTER, EV_EXIT, EV_HIT, EV_PED_DOWN, EV_SHOT, EV_STEAL, EV_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { CHAIN, createMissionState, markerFor, objectiveText, objectiveTitle, restoreMissions, updateMissions, failCurrentJob } from './missions.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WASTED } from './render.js';
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
      money: world.state.money,
      chainIndex: missions.chainIndex,
      sideJobsDone: missions.sideJobsDone,
    }));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function saveSummary(save) {
  const story = save.chainIndex >= CHAIN.length ? 'story complete' : `mission ${save.chainIndex + 1} of ${CHAIN.length}`;
  return `$${save.money.toLocaleString('en-US')} · ${story}`;
}

// ------------------------------------------------------------ screenshot mode

function runShot(name) {
  const scene = stageShot(name, world, missions, city);
  const ui = {
    screen: scene.screen,
    marker: scene.screen === SCREEN_TITLE ? null : markerFor(missions, city, world),
    objective: scene.screen === SCREEN_TITLE ? null : { title: objectiveTitle(missions), text: objectiveText(missions) },
    prompt: null,
    banner: null,
    carrying: missions.carrying,
    muted: false,
    saveExists: false,
    saveSummary: '',
    fine: 0,
  };
  let painted = 0;
  function paint() {
    renderer.draw(world, ui);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
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
    screen = SCREEN_PLAY;
    showBanner('AZURA BAY', objectiveText(missions), 3);
    announce('Playing. ' + objectiveText(missions));
  }

  function endRun(kind) {
    screen = kind === 'busted' ? SCREEN_BUSTED : SCREEN_WASTED;
    fine = kind === 'busted'
      ? Math.min(world.state.money, 60 + world.state.wanted.stars * 40)
      : Math.min(world.state.money, 80);
    failCurrentJob(missions);
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

  function handleMissions() {
    updateMissions(missions, world, city);
    if (missions.justStarted) {
      const mission = missions.justStarted;
      showBanner(`MISSION ${missions.chainIndex + 1} — ${mission.title.toUpperCase()}`, mission.intro);
      audio.click();
      announce(`Mission: ${mission.title}. ${mission.intro}`);
    }
    if (missions.justPickedUp) {
      audio.pickup();
      announce('Package picked up.');
    }
    if (missions.justCompleted) {
      const done = missions.justCompleted;
      showBanner('JOB COMPLETE', `${done.title} — +$${done.reward}`);
      audio.success();
      persist();
      save = loadSave();
      announce(`Job complete: ${done.title}, plus $${done.reward}.`);
    }
  }

  function currentPrompt() {
    const player = world.state.player;
    if (screen !== SCREEN_PLAY || player.inCar) return null;
    const car = world.nearestEnterableCar();
    if (!car) return null;
    return car === world.state.coupe ? "E — Get into Dee's coupe" : 'E — Steal this car';
  }

  function buildUi() {
    return {
      screen,
      marker: screen === SCREEN_TITLE ? null : markerFor(missions, city, world),
      objective: screen === SCREEN_TITLE ? null : { title: objectiveTitle(missions), text: objectiveText(missions) },
      prompt: currentPrompt(),
      banner,
      carrying: missions.carrying,
      muted: audio.muted,
      saveExists: save !== null,
      saveSummary: save ? saveSummary(save) : '',
      fine,
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
      const logical = renderer.toLogical(input.mouse.clientX, input.mouse.clientY);
      const hasMouse = input.mouse.clientX !== 0 || input.mouse.clientY !== 0;
      let firstStep = true;
      while (accumulator >= STEP && playing) {
        const ctrl = {
          moveX: screen === SCREEN_PLAY ? input.moveX() : 0,
          moveY: screen === SCREEN_PLAY ? input.moveY() : 0,
          aimX: hasMouse ? logical.x + world.state.camera.x - VIEW.width / 2 : null,
          aimY: hasMouse ? logical.y + world.state.camera.y - VIEW.height / 2 : null,
          firing: screen === SCREEN_PLAY && input.firing() && !player.inCar,
          sprint: input.sprint(),
          enter: firstStep && (actions & ACTION_ENTER) !== 0,
        };
        const events = world.step(STEP, ctrl);
        if (screen === SCREEN_PLAY) handleEvents(events);
        firstStep = false;
        accumulator -= STEP;
        if (world.state.over && screen === SCREEN_PLAY) break;
      }
      if (screen === SCREEN_PLAY) handleMissions();
    } else {
      accumulator = 0;
    }

    if (banner) {
      banner.t += 1 / 60; // frames arrive at the display's rate; close enough for a fade
      if (banner.t >= banner.duration) banner = null;
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

    renderer.draw(world, buildUi());
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
