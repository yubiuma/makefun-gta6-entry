// AIR-1, the police helicopter: presentation only. At three stars and up it hangs
// ahead of the player, weaving on a slow figure from state.time, with its searchlight
// on the player's car. Nothing in the simulation knows it exists; the renderer, the
// dispatch panel and the radar all read the same pose from here.

const ALTITUDE = 78;

/** {x, y, alt, angle, lightX, lightY, rotor} or null below three stars. */
export function airUnit(state) {
  if (state.wanted.stars < 3) return null;
  const player = state.player;
  const heading = player.inCar && player.car ? player.car.angle : player.angle;
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const t = state.time;
  const ahead = 155 + Math.cos(t * 0.4) * 30;
  const side = 22 + Math.sin(t * 0.4) * 26;
  const x = player.x + fx * ahead - fy * side;
  const y = player.y + fy * ahead + fx * side;
  // The light trails the car a little and never sits perfectly still.
  const lightX = player.x + Math.sin(t * 1.3) * 12 - fx * 8;
  const lightY = player.y + Math.cos(t * 1.1) * 12 - fy * 8;
  return {
    x, y, alt: ALTITUDE,
    angle: Math.atan2(player.y - y, player.x - x),
    lightX, lightY,
    rotor: t * 31,
    d: Math.hypot(x - player.x, y - player.y),
  };
}
