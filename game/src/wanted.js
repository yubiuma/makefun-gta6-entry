// The wanted system: a hidden heat score, the stars it lights, and the bust meter. Crimes
// add heat only when witnessed (the world checks the witnesses); while no officer can see
// the player the heat cools, star by star, until the slate is clean.
import { POLICE, WANTED } from './config.js';
import { clamp } from './geom.js';

/** How many stars a heat score lights, 0..5. */
export function starsForHeat(heat) {
  let stars = 0;
  for (const threshold of WANTED.starThresholds) if (heat >= threshold) stars += 1;
  return stars;
}

/** The heat at which a given star count begins (1..5); handy for scripted trouble. */
export function heatForStars(stars) {
  return stars <= 0 ? 0 : WANTED.starThresholds[stars - 1] + 5;
}

export function createWanted() {
  return {
    heat: 0,
    stars: 0,
    /** Seconds since an officer last had eyes on the player. */
    unseenTime: 0,
    /** 0..1: how close the police are to making an arrest. */
    bust: 0,
  };
}

/** Add a crime's heat (see WANTED.crimes) and relight the stars. */
export function reportCrime(wanted, kind) {
  wanted.heat = clamp(wanted.heat + (WANTED.crimes[kind] ?? 0), 0, WANTED.maxHeat);
  wanted.stars = starsForHeat(wanted.heat);
}

/** Set the heat directly (mission scripts, respawns); stars follow. */
export function setHeat(wanted, heat) {
  wanted.heat = clamp(heat, 0, WANTED.maxHeat);
  wanted.stars = starsForHeat(wanted.heat);
}

/** Clear the slate completely: respawns and served sentences. */
export function clearWanted(wanted) {
  wanted.heat = 0;
  wanted.stars = 0;
  wanted.unseenTime = 0;
  wanted.bust = 0;
}

/**
 * One step of the cooling-off rules. `seen` is whether any officer is within sight range
 * this step. The bust meter is worked by the world, which knows where everyone is.
 */
export function updateWanted(wanted, dt, seen) {
  if (seen) {
    wanted.unseenTime = 0;
  } else {
    wanted.unseenTime += dt;
    if (wanted.unseenTime > WANTED.decayDelay && wanted.heat > 0) {
      wanted.heat = Math.max(0, wanted.heat - WANTED.decayRate * dt);
      wanted.stars = starsForHeat(wanted.heat);
      if (wanted.heat === 0) wanted.bust = 0;
    }
  }
}

/** How many police cars the force fields at the current wanted level. */
export function policeQuota(wanted) {
  return POLICE.carsForStars[wanted.stars];
}
