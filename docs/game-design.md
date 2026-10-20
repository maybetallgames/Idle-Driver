# Idle Driver: Game Design

Status: draft v0.1. Questions still open for the owner are listed at the end and marked **[OPEN]**
where they come up.

## Pitch

A family loads up an old SUV in Florida and heads for the Rocky Mountains. They can't afford the
trip, so they livestream it. Stream money pays for gas, and whatever is left over buys driver-assist
features for the car. You see the trip the way the car sees it: an overhead 3D view like the screen
in a self-driving car, showing the road, lanes and traffic the car has detected. At the start the car
has no autonomy at all. By the end it drives itself across the country while the family sleeps, and
the stream runs on its own.

## Pillars

1. **You can see the car getting smarter.** Every sensor upgrade changes the picture: the area the
   car "sees" grows, objects it can now recognize appear, and the lane lines light up when it can
   hold a lane. Progress is visible, not just a bigger number.
2. **The trip is real.** The route follows real US highways from Florida to the Rockies. Cities,
   state lines and landmarks show up at their real distances, and the scenery changes from palms to
   pines to plains to peaks.
3. **The family is the content.** The stream is the economy. Things that happen on the road
   (a dinosaur roadside attraction, a thunderstorm, a kid getting carsick) bring in viewers.
4. **Idle first, phone first.** The car keeps driving while you are away, more and more as autonomy
   improves. Everything works in a phone browser in portrait.

## Core loop

```
 drive ──> miles & stream content ──> viewers ──> $ from stream
   ^                                                  │
   │                                                  v
 more autonomy, longer idle driving  <── buy gas (keep moving)
 better sensors, better stream         └─ buy car features / stream gear
```

1. The car drives along the route. Driving burns **gas** and produces **content** (time on stream,
   landmarks, events).
2. Content grows the **viewer count**. Viewers pay out **dollars** over time (subs, tips, sponsors).
3. Dollars buy **gas** (needed to keep moving) and **upgrades** (car features and stream gear).
4. Car features raise autonomy, which means the car drives faster, needs you less, and keeps going
   for longer while you are offline.

Short-term goal: reach the next landmark or city. Long-term goal: reach the mountains with a car
that drives itself.

## Who is driving: autonomy levels

The progression follows the real SAE driving automation levels, because players already half-know
them and they map cleanly to idle-game "how much does this run without me" tiers.

| Level | Name in game | What it means for play | Offline driving |
|---|---|---|---|
| L0 | Dad drives | A parent drives. Slow, takes frequent breaks, the car only makes good progress while you are actively playing. **[OPEN] see Q1** | Very little (parent stops for the night) |
| L1 | Driver assist | Adaptive cruise *or* lane keeping. Steadier speed, fewer breaks. | A few hours |
| L2 | Partial autopilot | Cruise + lane keeping together on highways. Lane lines turn blue on screen. | Longer, but stops at hard situations |
| L3 | Highway pilot | Handles highways fully, including lane changes and merges. Asks for help at interchanges, construction, cities. | Most highway time |
| L4 | City & night pilot | Handles nearly everything, including cities and night driving. Rare requests for help. | Most of the day and night |
| L5 | Full self driving | No driver needed. The family sleeps in the back. Endgame. | Unlimited (within the offline cap) |

A level is unlocked by owning the required set of features (see below), not bought directly. This
keeps the "unlock" moment tied to something the player built.

### Interventions (takeovers)

Below L5, the car meets situations it can't handle: a construction zone, a confusing interchange, a
toll plaza, a storm. When that happens it slows and asks for help with a takeover prompt. Tapping
it resolves the situation (a small, satisfying action rather than real steering).

- While you are playing, takeovers are quick taps and often give a bonus ("chat went wild").
- While you are away, an unhandled takeover means the car pulls over and waits, so idle progress
  stops early. Higher autonomy means fewer takeovers, which is why autonomy is the idle multiplier.
- Takeovers are also stream content: near-misses and "the car figured it out" moments spike viewers.

## Sensors and what the car sees

The overhead view only shows what the car has perceived. Beyond sensor range the world fades to
an unlit outline. This is the main visual reward for upgrades.

| Sensor | Unlocks seeing | Gameplay effect |
|---|---|---|
| (none) | Just the car, a short pool of headlights, rough road | Parent driving only |
| Front camera | Lane lines and cars ahead, short range | Required for lane keeping |
| Front radar | Cars ahead at long range, with speed | Required for adaptive cruise; safe higher speeds |
| Side & rear cameras | Adjacent lanes, cars beside and behind | Required for lane changes |
| Ultrasonic sensors | Close obstacles, parking | Self-parking at gas stops (faster refuels) |
| Lidar | Full 3D 360° picture, works at night | Required for night driving |
| HD maps + GPS | Road ahead before it is visible, upcoming exits | Fewer takeovers at interchanges |
| Better compute | Recognizes more object types (trucks, cyclists, deer, cones) | Fewer takeovers overall |
| Weather radar / sensor cleaning | Sees through rain and snow | Keeps driving in storms and mountain snow |

Each sensor also has range/quality levels (repeatable upgrades), so there is always something to
buy. A sensor's first purchase is the big unlock; later levels widen the visible area and add speed.

## Car features (software)

Features are the software side. Each needs certain sensors and unlocks part of an autonomy level.

- **Adaptive cruise control** (radar): steady speed, fewer slow-downs. Part of L1.
- **Lane keeping** (front camera): holds the lane. Part of L1.
- **Autosteer** (cruise + lane keeping + compute): both at once. Unlocks L2.
- **Auto lane change** (side cameras): passes slow traffic. Part of L3.
- **Navigate on highway** (HD maps): takes exits and merges itself. Unlocks L3.
- **Night vision** (lidar): keeps driving after dark. Part of L4.
- **City streets** (lidar + compute): drives through cities. Unlocks L4.
- **Weather handling** (weather sensors): keeps driving in storms and snow.
- **Self-park & self-refuel** (ultrasonic): gas stops take seconds instead of minutes.
- **Full self driving** (everything + top compute): unlocks L5.

## Economy

Three numbers matter to the player:

- **$ (dollars)**: spent on everything.
- **Gas**: the tank drains as you drive. Empty tank means the car stops until you buy gas at the
  next station. Refueling costs $, and gas prices vary by state along the route (for example
  cheaper in Missouri and Kansas, pricier in Florida and Colorado).
- **Viewers**: how many people are watching right now. Earnings per second come from viewers.

### Stream income

`$ per second = viewers × payout rate × hype multiplier`

Viewers grow toward a target set by how interesting the stream is right now:

- **Base audience** from followers (followers accumulate permanently from peak viewers).
- **Scenery**: boring stretches (flat interstate) pull viewers down, landmarks and mountains pull
  them up. This makes the real route matter: Kansas is a grind, Colorado is a payday.
- **Events**: random on-road events (storm, roadside attraction, wildlife, a kid's meltdown) spike
  viewers briefly. Some are offered as optional detours: spend time, get hype.
- **Autonomy content**: a new autonomy level unlock is a big stream moment ("first time the car
  drove itself!").

### Stream gear (second upgrade track)

Upgrades that improve income rather than driving: better phone camera, dash cam, phone mount and
gimbal, mobile hotspot (fewer dropped streams in rural areas), roof cam, overlays and alerts, a
merch store, sponsor deals. This gives players a choice each purchase: drive better or earn more.

### Gas as pressure

Gas is what makes this more than "number go up". If income falls behind fuel cost (a boring
stretch, too many idle hours without stream gear), the car stalls at a gas station until you
earn more. Fuel efficiency is itself upgradeable (smooth driving from adaptive cruise uses less
gas, eco mode, roof box removal). Balance target: running out of gas should be a soft slowdown,
never a hard lock. The stream keeps earning a trickle while parked.

### Offline progress

While you are away the car drives for as long as its autonomy and gas allow (capped, as in the
current build, at 8 hours). The return screen summarizes: miles driven, $ earned, gas used, and why
the car stopped if it did ("Stopped at a construction zone near Chattanooga, needs your help").

## The route

**[OPEN] Q3** for exact start and destination. Working proposal, about 2,100 miles:

Orlando, FL → I-75 north → Atlanta, GA → I-75 / I-24 → Chattanooga → Nashville, TN → I-24 / I-64
→ St. Louis, MO (Gateway Arch) → I-70 west → Kansas City → across Kansas (long, flat, boring on
purpose) → Denver, CO → into the mountains (I-70 to the Eisenhower Tunnel, or US-36 to Estes Park
and Rocky Mountain National Park).

Why this route: a clean north-then-west shape, big recognizable cities, a real "boring flat
middle" that the stream economy can play off, and a dramatic finish where the Rockies rise out of
the plains.

### Regions (scenery biomes)

| Stretch | Scenery | Stream effect |
|---|---|---|
| Central FL | Palms, flat, swamp, billboards | Average |
| North FL / GA | Pine forest, peach stands | Average |
| Atlanta | Dense city, many lanes, heavy traffic | Hard (takeovers), high viewers |
| TN hills | Rolling hills, Lookout Mountain, rock cuts | Good |
| Nashville | City, music | Event-rich |
| KY / IL / MO | Farmland, rivers, St. Louis Arch | Average, Arch is a spike |
| Kansas | Flat, wheat, wind turbines, giant sky | Low (the grind) |
| Eastern CO | High plains, first sight of mountains | Rising |
| Front Range / Rockies | Switchbacks, tunnels, snow | Best, but hard driving |

### Landmarks and cities

Landmarks sit at their real distance along the route and act as the milestones the current build
already has. Examples: Disney/Orlando start, Florida/Georgia line, Atlanta, Lookout Mountain,
Nashville, the Gateway Arch, Kansas City, the "geographic center" in Kansas, the first view of the
Rockies near Limon, Denver, Eisenhower Tunnel or Estes Park.

### Time scale

The trip is ~2,100 real miles. The game compresses time so the whole trip takes a set number of
real-world days of idle play. **[OPEN] Q2.** Proposal: about 1 to 2 weeks for a first trip, with L5
reached in the final stretch (Colorado), so full self driving arrives right as the mountains do.

## End of the trip

**[OPEN] Q4.** Proposal: arriving at the cabin finishes the trip with a summary (miles, peak
viewers, takeovers). Then a "next vacation" prestige: new route (e.g. to the Grand Canyon or Pacific
Coast Highway), keep followers as a permanent multiplier, car resets to L0 (a new rental, or the old
SUV's software gets wiped). This can come after the first trip is fun on its own.

## Screen layout (portrait phone)

- **Top bar**: $, gas gauge, viewers (with a live "LIVE" dot), autonomy level badge.
- **Middle (most of the screen)**: the 3D overhead view of the car. Takeover prompts and event
  pop-ups appear over it.
- **Bottom**: route progress strip (FL → CO with your dot and next landmark), and a sheet with
  tabs for **Car** (sensors + features), **Stream** (gear), **Trip** (map, stats).

## Mapping from the current build

The setup PR has a working 2D idle loop (miles as currency, four upgrades, seven landmarks,
offline catch-up, local saves). Most of its structure carries over:

- Keep: pure logic in `game.ts` with tests, offline catch-up, saves with backward compatibility,
  landmark list, `formatNumber`.
- Change: currency becomes $ from viewers, not miles; add gas; upgrades split into sensors,
  features and stream gear with requirements; landmarks move to real mile markers.
- Replace: the 2D canvas `road.ts` with a Three.js scene (see `docs/prototype-plan.md`).

## Open questions for the owner

1. **What does the player do at L0?** Options: (a) a parent drives on their own, slowly and with
   lots of breaks, and you help by tapping takeovers; or (b) the car only moves while you actively
   hold or tap, and autonomy is what lets it move without you. (a) is gentler and more idle; (b)
   makes the first upgrades feel huge.
2. **How long should the whole trip take in real time?** A few days, 1 to 2 weeks, or a month+?
3. **Start and destination.** Orlando to Rocky Mountain National Park / Estes Park, or somewhere
   else in Florida, or a specific Colorado town?
4. **After arrival:** stop there, or a prestige loop with new trips?
5. **The family:** named characters with personalities (the parent driver, kids who cause events),
   or kept abstract? Should we show a fake stream chat on screen?
