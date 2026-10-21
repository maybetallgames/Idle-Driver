import './style.css';
import {
  UPGRADES, advance, buy, canBuy, catchUp, currentLandmark, deserialize, formatNumber,
  honk, level, newGame, nextLandmark, serialize, speed, tripProgress, upgradeCost,
  type GameState,
} from './game';
import { createMapView } from './scene/mapScene';
import { sensorCones } from './perception';

const SAVE_KEY = 'idle-driver-save';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function load(): GameState {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* storage blocked */ }
  return deserialize(raw, Date.now());
}

function save() {
  try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch { /* storage blocked */ }
}

let { state, seconds: offline } = catchUp(load(), Date.now());

// ?seed=123 fixes the traffic so screenshots are reproducible; ?mile=430 shows a spot on the route.
const params = new URLSearchParams(location.search);
const mileParam = params.get('mile');
const roadScene = createMapView($('view'), {
  seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e9),
  mile: mileParam === null ? undefined : Number(mileParam),
});
const upgradesEl = $('upgrades');

// Build upgrade buttons once; update text each frame.
const upgradeButtons = UPGRADES.map((u) => {
  const btn = document.createElement('button');
  btn.className = 'upgrade';
  btn.innerHTML = `<span><span class="name"></span><br><span class="desc">${u.description}</span></span><span class="cost"></span>`;
  btn.addEventListener('click', () => { state = buy(state, u.id); save(); render(); });
  upgradesEl.appendChild(btn);
  return { u, btn, name: btn.querySelector('.name')!, cost: btn.querySelector('.cost')! };
});

$('honk').addEventListener('click', () => { state = honk(state); render(); });
$('reset').addEventListener('click', () => {
  if (confirm('Start the trip over from the driveway?')) { state = newGame(Date.now()); save(); render(); }
});
$('build').textContent = `build ${__BUILD_ID__}`;

function render() {
  $('miles').textContent = formatNumber(state.miles);
  $('speed').textContent = formatNumber(speed(state));
  $('progress').style.width = `${(tripProgress(state) * 100).toFixed(2)}%`;
  $('landmark').textContent = `📍 ${currentLandmark(state).name}`;
  const next = nextLandmark(state);
  $('next').textContent = next
    ? `Next: ${next.name} in ${formatNumber(next.at - state.odometer)} miles`
    : 'You made it to the mountains! 🏔️';
  const where = roadScene.place();
  if (where) {
    const toNext = where.next ? ` · ${where.next.name} in ${formatNumber((where.next.s - where.s) / 1609.344)} mi` : '';
    $('place').textContent = `Near ${where.prev}${toNext}`;
  }
  for (const b of upgradeButtons) {
    b.name.textContent = `${b.u.name} (lv ${level(state, b.u.id)})`;
    b.cost.textContent = `${formatNumber(upgradeCost(state, b.u.id))} mi`;
    b.btn.disabled = !canBuy(state, b.u.id);
  }
}

let last = performance.now();
let lastSave = 0;
function frame(t: number) {
  const dt = Math.min((t - last) / 1000, 1);
  last = t;
  state = { ...advance(state, dt), lastTick: Date.now() };
  roadScene.frame(Math.min(dt, 0.1), speed(state), tripProgress(state), sensorCones(state.levels));
  render();
  if (t - lastSave > 5000) { save(); lastSave = t; }
  requestAnimationFrame(frame);
}

// Catch up when returning to the tab (rAF pauses in the background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ({ state, seconds: offline } = catchUp(state, Date.now()));
    if (offline > 60) alert(`While you were away the autopilot drove ${formatNumber(speed(state) * offline)} miles.`);
  } else {
    save();
  }
});

if (offline > 60) {
  setTimeout(() => alert(`While you were away the autopilot drove ${formatNumber(speed(state) * offline)} miles.`), 100);
}
render();
requestAnimationFrame(frame);
