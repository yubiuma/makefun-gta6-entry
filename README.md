# makefun-gta6-entry

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/yubiuma/makefun-gta6-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/yubiuma/makefun-gta6-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

## Azura Bay: Night Run

An original open-world crime game that plays entirely in the browser, in
full 3D: a third-person chase camera over a night city of lit towers, neon
storefront signs and streetlit avenues, rendered with three.js (vendored
into the repo) over a simulation written in plain JavaScript — no build
step, nothing fetched from the network. The whole game is the static files
under `game/`; open the page and the city is just there.

You are Rook, a courier with more debts than sense, working the night streets
of Azura Bay, an island port city of marinas, storefronts and rain-slick
avenues. Your work comes from Dee Voss, a fixer who pays cash for packages
moved quickly and questions asked never. Walk the sidewalks or take a car —
any car, parked or otherwise; its owner may object, and the Azura Bay police
definitely will. Traffic flows, pedestrians stroll and scatter, and every
crime the law sees pushes your wanted level up another star, bringing more
patrol cars down on you until you break their line of sight and let things
cool off. On foot the camera stays close over your shoulder; put your foot
down in a car and it pulls back and leans into the speed.

A nine-mission story chain for Dee carries you from a first nervous pickup
through a package run that draws every cop in the city, a timed dash to get
Dee's stranded cousin to his shift at the Hotel Lumiere, a quiet tail across
town — close enough to watch, never close enough to be made — a gold
Vantara S lifted from the bank lot and delivered whole, a four-star raid on
the Port Market crew's ledger, Milo's night shift at St Marina, and one last
deposit box out of Azura Bank. Finish the story and the work never really
ends: courier jobs keep generating for as long as you care to run them.

When the driving gets expensive, Skypak Garage earns its keep: roll into the
painted bay out front and the crew will repair your car to showroom shape and
see to it that the law forgets one of your stars, for a fee that scales with
the damage. A live minimap keeps the city, the law and your next drop-off in
view, the soundtrack and effects are synthesised in code rather than sampled,
and your money and progress persist between visits in localStorage.

## Run it

Serve the folder with the small static server bundled in this repo:

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser and press Enter to
start.

Controls:

- **On foot** — WASD or the arrow keys to move, the mouse to aim, click to
  shoot, Shift to sprint.
- **Driving** — W and S to accelerate and brake, A and D to steer, E or F to
  get into or out of a car.
- **At Skypak Garage** — park in the repair bay and press E for a full
  repair that also sheds a wanted star.
- **Anywhere** — P pauses, M mutes the synth sound.

Handing the entry in is `node main.ts`, which copies `game/` and
`screenshots/` to the output directory, writes the dossier a judge reads,
and then re-checks its own output — screenshot count, formats and sizes, the
entry page's size — before reporting success.

<sub>Entered on [make.fun](https://make.fun/?ref=s9v1an22&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
