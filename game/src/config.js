// Every tuning number and colour for Azura Bay: Night Run in one place. The city is a
// grid of blocks and roads measured in world units on the ground plane (x east, y
// south — the 3D renderer maps them to x and z, with height its own axis), and no rule
// below depends on the screen size or the camera.

/** The logical view the simulation's own camera bookkeeping clamps to, in units. */
export const VIEW = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The city grid: square blocks of BLOCK pixels separated by ROAD-wide streets. */
export const CITY = {
  cols: 8,
  rows: 8,
  block: 208,
  road: 72,
  /** Distance between the starts of two neighbouring streets. */
  pitch: 280,
  /** The whole world, edge to edge: the last street's far side. */
  size: 8 * 280 + 72,
  /** How far buildings sit inside their block, leaving a pavement ring to walk on. */
  pavement: 18,
};

/** The player character on foot. */
export const PLAYER = {
  radius: 11,
  walkSpeed: 178,
  sprintSpeed: 268,
  maxHealth: 100,
  /** Health regained per second once this many seconds have passed without damage. */
  regenDelay: 5,
  regenRate: 5,
  /** How close to a car the player must stand to get in. */
  enterRange: 54,
};

/** Cars, whoever is driving them. Length runs along the car's heading. */
export const CAR = {
  length: 46,
  width: 22,
  maxSpeed: 432,
  maxReverse: 132,
  acceleration: 305,
  braking: 520,
  drag: 0.55,
  /** Steering lock in radians at a standstill, fading as speed rises. */
  steerLock: 0.62,
  turnRate: 2.6,
  maxHealth: 100,
  /** Collision speed (px/s of closing velocity) below which a bump costs no health. */
  softHit: 90,
};

/** Civilian traffic. */
export const TRAFFIC = {
  count: 14,
  cruiseMin: 168,
  cruiseMax: 252,
  /** Lane offset from the road centre, right-hand traffic. */
  laneOffset: 17,
  /** A car brakes when something is this far ahead of it, and stops at half of it. */
  lookAhead: 92,
};

/** Pedestrians. */
export const PED = {
  count: 44,
  radius: 10,
  walkSpeed: 64,
  fleeSpeed: 196,
  maxHealth: 70,
  /** Gunfire within this radius makes a pedestrian run and remember the danger. */
  panicRadius: 300,
  fleeSeconds: 3.2,
  /** Seconds a knocked-down pedestrian stays down before getting up (if still alive). */
  downSeconds: 6,
};

/** Police behaviour per wanted level. */
export const POLICE = {
  /** Cars the force fields at 0..5 wanted stars. */
  carsForStars: [0, 1, 2, 3, 5, 7],
  maxSpeed: 478,
  acceleration: 348,
  /** How close an officer must be, with the player nearly stopped, to work the bust meter. */
  bustRange: 96,
  bustFill: 0.5,
  bustDrain: 0.85,
  /** A police car farther than this from the player, with no heat on, gives up and leaves. */
  giveUpRange: 1500,
  spawnMin: 660,
  spawnMax: 980,
};

/**
 * The wanted system. Heat is a hidden score; stars are what the player sees. A crime only
 * counts when witnessed: a pedestrian within WITNESS.ped pixels or an officer within
 * WITNESS.police. Heat fades while no officer can see the player.
 */
export const WANTED = {
  maxHeat: 500,
  /** Heat at which each star lights, from the first to the fifth. */
  starThresholds: [25, 90, 170, 280, 400],
  crimes: {
    gunshot: 5,
    stealCar: 40,
    hitCar: 15,
    hitPoliceCar: 50,
    hitPed: 60,
    pedDown: 45,
    shootCar: 10,
    shootPoliceCar: 40,
    shootPed: 30,
  },
  witness: { ped: 250, police: 400 },
  /** An officer this close can see the player, so the heat stays. */
  sightRange: 540,
  /** Calm seconds before unseen heat starts to fade, and how fast it fades. */
  decayDelay: 2.5,
  decayRate: 17,
};

/**
 * Skypak Garage's repair bay: a painted rectangle on the ground in front of the garage.
 * Driving in and pressing the action key pays the fee, repairs the car fully and sheds
 * one wanted star; the crew then needs a breather before the next job.
 */
export const GARAGE = {
  /** The bay's centre sits this far south of the garage's front-door marker. */
  bayOffsetY: 30,
  bayRadius: 58,
  /** Seconds before the crew will take another car. */
  cooldown: 20,
  baseFee: 15,
  /** Dollars charged per point of damage repaired. */
  perDamage: 1.1,
};

/**
 * The tail job (mission 5): stay inside the distance band around the target car. The
 * meter fills while you are in the band and drains outside it; loitering inside
 * tooClose for spookSeconds, or touching the car at all, blows the job.
 */
export const TAIL = {
  bandMin: 110,
  bandMax: 300,
  tooClose: 80,
  spookSeconds: 2,
  /** Meter gained per second in the band (a full meter takes about 13 s). */
  fillRate: 1 / 13,
  /** Meter lost per second outside the band. */
  drainRate: 1 / 7,
  /** The meter must hold at least this much when the target parks up. */
  passMeter: 0.5,
  /** The target sedan's cruising speed. */
  cruise: 205,
};

/** The player's pistol: fast projectiles, short life, fired from the hip on foot. */
export const GUN = {
  bulletSpeed: 940,
  bulletLife: 0.5,
  fireInterval: 0.145,
  damage: 34,
  spread: 0.035,
  poolSize: 72,
};

/** How many sparks, smoke puffs and flashes can exist at once; the pool is allocated once. */
export const PARTICLE_POOL = 260;

/** Daytime palette: sunlit streets, pale pavements, painted roofs. */
export const PALETTE = {
  backdrop: '#20242c',
  grass: '#79a95c',
  grassDark: '#6f9e54',
  park: '#8abb6d',
  pavement: '#bdb5a4',
  pavementEdge: '#a89f8d',
  road: '#3d4149',
  roadEdge: '#2e3238',
  laneMark: '#e9e4d2',
  crosswalk: '#d9d5c8',
  water: '#3f7f9e',
  sand: '#d9c491',
  buildingShadow: 'rgba(30, 34, 28, 0.28)',
  windowLit: '#ffe9a8',
  windowDark: '#5d6a72',
  player: '#ffd23e',
  playerDark: '#2b2f36',
  npc: '#ff7eb6',
  policeBody: '#eef1f4',
  policeTrim: '#23272e',
  lightRed: '#ff4545',
  lightBlue: '#4d7cff',
  marker: '#ffc93e',
  markerBeam: 'rgba(255, 201, 62, 0.20)',
  target: '#ff9f43',
  garage: '#8fd0e0',
  health: '#58d977',
  healthLow: '#ff5d5d',
  money: '#9fe870',
  panel: 'rgba(18, 21, 27, 0.88)',
  panelEdge: '#ffc93e',
  text: '#f4f2ea',
  muted: '#b9bdc7',
  danger: '#ff5d5d',
  star: '#ffc93e',
  starOff: '#565d68',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where progress is kept between visits (this browser only). */
export const SAVE_KEY = 'azura-bay-night-run.save.v1';

export const GAME_TITLE = 'AZURA BAY';
export const GAME_SUBTITLE = 'NIGHT RUN';
