// Race rules (ARCHITECTURE.md §14): countdown + start boost, checkpoints, laps, places, finish,
// 12 s wait + estimation, results and GP points. main.js owns phases; it watches race.state.
import { forwardOf } from '../core/math.js';

const fwd = { x: 0, y: 0, z: 0 };

export function createRace(game, { laps, mode, ghostPlayer = null, ghostRecorder = null }) {
  const R = game.config.race;
  const track = game.track;
  const L = track.length;
  const cps = game.config.track.checkpoints;
  const STEP = game.config.STEP;
  // The countdown counts whole fixed steps: subtracting 1/120 s 360 times leaves a float crumb that
  // used to fire GO twice.
  const stepsPerCount = Math.round(R.countdownStep / STEP);
  const PACE_N = Math.round(R.paceWindow / 0.5) + 1; // samples kept for the finish estimate

  const race = {
    laps,
    mode,
    state: 'countdown',
    countdown: 3,
    finishOrder: [],
    results: null,
    bestLapTime: null,
    waitLeft: R.finishWait,
    startGrade: null,
    // extras
    timeToGo: 3 * stepsPerCount * STEP,
    stepsToGo: 3 * stepsPerCount,
    placeChanges: 0,
    trackLength: L,
    update,
    finishNow,
  };

  const per = new Map();
  for (const k of game.karts) {
    per.set(k, {
      lastD: relDist(k),
      nextCp: 0,
      cpCount: 0,
      lastEdge: -99, // countdown throttle press edge, seconds relative to GO
      wrongT: 0,
      rightT: 0,
      paceT: new Float64Array(PACE_N),
      paceP: new Float64Array(PACE_N),
      paceCount: 0,
      paceHead: 0,
      paceNext: 0,
    });
    k.lap = 0;
    k.crossLap = 0;
    k.progress = relDist(k) - L;
    k.maxProgress = k.progress;
    k.lapTimes = [];
    k.bestLap = null;
    k.finished = false;
    k.finishTime = null;
    k.pinned = true;
  }

  function relDist(k) {
    let d = k.trackInfo.dist - track.startDist;
    if (d < 0) d += L;
    return d;
  }

  function update(dt) {
    if (race.state === 'countdown') return stepCountdown();
    if (race.state === 'done') return;
    for (const k of game.karts) stepKart(k, dt);
    updatePlaces();
    if (race.state === 'finishing') {
      race.waitLeft -= dt;
      if (allFinished() || race.waitLeft <= 0) conclude();
    } else if (allFinished()) {
      conclude();
    }
  }

  function stepCountdown() {
    const nb = Math.ceil(race.stepsToGo / stepsPerCount);
    race.stepsToGo = Math.max(0, race.stepsToGo - 1);
    race.timeToGo = race.stepsToGo * STEP;
    for (const k of game.karts) {
      const p = per.get(k);
      if (k.controls.throttle > 0.5 && !(k.prevControls.throttle > 0.5)) p.lastEdge = -race.timeToGo;
    }
    if (race.stepsToGo > 0) {
      const n = Math.ceil(race.stepsToGo / stepsPerCount);
      if (n !== nb) { race.countdown = n; game.events.emit('countdown', { n }); }
      return;
    }
    race.countdown = 0;
    race.state = 'running';
    game.events.emit('countdown', { n: 0 });
    game.events.emit('raceStart', {});
    const B = game.config.kart.boosts;
    for (const k of game.karts) {
      k.pinned = false;
      const p = per.get(k);
      const e = p.lastEdge;
      let grade = null;
      if (k.controls.throttle > 0.5) {
        if (e >= R.startPerfect[0] && e <= R.startPerfect[1]) grade = 'perfect';
        else if (e > R.startGood[0] && e <= R.startGood[1]) grade = 'good';
        else if (e >= -3 * R.countdownStep && e < -2 * R.countdownStep) grade = 'burnout';
      }
      if (grade === 'perfect') k.applyBoost(B.start[0], B.start[1], 'start', { grade });
      else if (grade === 'good') k.applyBoost(B.weakStart[0], B.weakStart[1], 'start', { grade });
      else if (grade === 'burnout') k.spinOut('burnout', null);
      if (k.isPlayer) race.startGrade = grade;
    }
  }

  function stepKart(k, dt) {
    const p = per.get(k);
    const d = relDist(k);
    if (p.lastD > L - 60 && d < 60) k.crossLap++;
    else if (p.lastD < 60 && d > L - 60) k.crossLap--;
    p.lastD = d;
    const prog = (k.crossLap - 1) * L + d;
    k.progress = prog;
    const limit = 2 * Math.abs(k.speed) * dt + 1;
    k.maxProgress = Math.min(Math.max(k.maxProgress, prog), k.maxProgress + limit);

    if (!k.finished) {
      // checkpoints of the current lap, in order
      if (k.lap >= 1) {
        while (p.nextCp < cps.length && k.maxProgress >= (k.lap - 1) * L + cps[p.nextCp] * L) {
          const index = p.nextCp;
          p.nextCp++;
          let split = null;
          if (k.isPlayer && ghostRecorder) ghostRecorder.mark(game.raceTime);
          if (k.isPlayer && ghostPlayer) split = ghostPlayer.splitAt(p.cpCount, game.raceTime);
          p.cpCount++;
          game.events.emit('checkpoint', { kart: k, index, lap: k.lap, split });
        }
      }
      // lap line
      if (k.crossLap > k.lap) {
        const valid = k.lap === 0 || (p.nextCp >= cps.length && k.maxProgress >= (k.lap - 1) * L + cps[cps.length - 1] * L);
        if (valid) crossLine(k, p);
      }
    }

    // pace for estimates: ring of the last PACE_N samples, one every 0.5 s
    if (game.raceTime >= p.paceNext) {
      p.paceNext = game.raceTime + 0.5;
      p.paceT[p.paceHead] = game.raceTime;
      p.paceP[p.paceHead] = k.progress;
      p.paceHead = (p.paceHead + 1) % PACE_N;
      if (p.paceCount < PACE_N) p.paceCount++;
    }

    // wrong way
    forwardOf(k.heading, fwd);
    const t = k.trackInfo.tangent;
    const dot = fwd.x * t.x + fwd.z * t.z;
    if (!k.finished && !k.respawn.active && dot < R.wrongWayDot && Math.abs(k.speed) > 2) {
      p.wrongT += dt; p.rightT = 0;
      if (!k.wrongWay && p.wrongT >= R.wrongWayTime) { k.wrongWay = true; game.events.emit('wrongWay', { kart: k, on: true }); }
    } else {
      p.rightT += dt; p.wrongT = 0;
      if (k.wrongWay && p.rightT >= R.wrongWayOffTime) { k.wrongWay = false; game.events.emit('wrongWay', { kart: k, on: false }); }
    }
  }

  function crossLine(k, p) {
    const now = game.raceTime;
    if (k.lap >= 1) {
      const lt = now - k.lapStartTime;
      k.lapTimes.push(lt);
      if (k.bestLap == null || lt < k.bestLap) k.bestLap = lt;
      if (race.bestLapTime == null || lt < race.bestLapTime) race.bestLapTime = lt;
      if (k.isPlayer && ghostRecorder) ghostRecorder.mark(now);
      if (k.isPlayer && ghostPlayer) p.cpCount++;
    }
    k.lap++;
    k.lapStartTime = now;
    p.nextCp = 0;
    if (k.lap > race.laps) {
      finishKart(k, now, false);
      return;
    }
    if (k.lap >= 2) game.events.emit('lap', { kart: k, lap: k.lap, lapTime: k.lapTimes[k.lapTimes.length - 1] });
    if (k.lap === race.laps && race.laps > 1) game.events.emit('finalLap', { kart: k });
  }

  function finishKart(k, time, estimated) {
    k.finished = true;
    k.finishTime = time;
    k.estimated = estimated;
    race.finishOrder.push(k.id);
    updatePlaces();
    game.events.emit('finish', { kart: k, place: k.place, time, estimated });
    if (k.isPlayer) {
      k.autopilot = true;
      if (race.state === 'running') {
        race.state = 'finishing';
        race.waitLeft = R.finishWait;
      }
    }
  }

  const order = game.karts.slice();
  function byPlace(a, b) {
    if (a.finished && b.finished) return race.finishOrder.indexOf(a.id) - race.finishOrder.indexOf(b.id);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  }

  function allFinished() {
    for (let i = 0; i < game.karts.length; i++) if (!game.karts[i].finished) return false;
    return true;
  }

  // Insertion sort in place: the order barely changes between steps, and Array.sort would copy.
  function updatePlaces() {
    for (let i = 1; i < order.length; i++) {
      const k = order[i];
      let j = i - 1;
      while (j >= 0 && byPlace(order[j], k) > 0) { order[j + 1] = order[j]; j--; }
      order[j + 1] = k;
    }
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const place = i + 1;
      if (k.place !== place) {
        const prev = k.place;
        k.place = place;
        race.placeChanges++;
        game.events.emit('place', { kart: k, place, prev });
      }
    }
  }

  function paceOf(k) {
    const p = per.get(k);
    if (p.paceCount >= 2) {
      const newest = (p.paceHead - 1 + PACE_N) % PACE_N;
      const oldest = p.paceCount < PACE_N ? 0 : p.paceHead;
      const dt = p.paceT[newest] - p.paceT[oldest];
      const dp = p.paceP[newest] - p.paceP[oldest];
      if (dt > 0.5 && dp > 0) return dp / dt;
    }
    return Math.max(1, Math.abs(k.speed));
  }

  function conclude() {
    const now = game.raceTime;
    const pending = game.karts.filter((k) => !k.finished);
    const est = pending.map((k) => {
      const remaining = Math.max(0, race.laps * L - k.progress);
      const pace = Math.max(paceOf(k), 0.5 * k.topSpeed);
      return { k, time: now + remaining / pace };
    }).sort((a, b) => a.time - b.time);
    for (const e of est) {
      e.k.finished = true;
      e.k.finishTime = e.time;
      e.k.estimated = true;
      race.finishOrder.push(e.k.id);
    }
    updatePlaces();
    for (const e of est) game.events.emit('finish', { kart: e.k, place: e.k.place, time: e.time, estimated: true });
    buildResults();
    race.state = 'done';
    for (const k of game.karts) k.autopilot = true;
    game.events.emit('raceEnd', { results: race.results });
  }

  function buildResults() {
    const pts = R.points;
    const gp = game.gp;
    const results = race.finishOrder.map((id, i) => {
      const k = game.karts.find((x) => x.id === id);
      return {
        kartId: k.id, characterId: k.character.id, place: i + 1, time: k.finishTime,
        estimated: !!k.estimated, bestLap: k.bestLap, points: 0, totalPoints: 0,
      };
    });
    if (mode === 'gp' && gp.active) {
      for (const r of results) {
        r.points = pts[r.place - 1] || 0;
        gp.standings[r.characterId] = (gp.standings[r.characterId] || 0) + r.points;
        gp.lastPlaces[r.characterId] = r.place;
        gp.totalTimes[r.characterId] = (gp.totalTimes[r.characterId] || 0) + (r.time || 0);
        r.totalPoints = gp.standings[r.characterId];
      }
    }
    race.results = results;
  }

  // Tests: classify everyone now and go to results.
  function finishNow() {
    if (race.state === 'done') return;
    if (race.state === 'countdown') {
      race.state = 'running';
      race.stepsToGo = 0;
      race.timeToGo = 0;
      for (const k of game.karts) k.pinned = false;
    }
    conclude();
  }

  return race;
}

// GP standings order: points desc, then better last-race place, then lower total time.
export function sortStandings(gp) {
  return Object.keys(gp.standings).sort((a, b) => {
    const d = (gp.standings[b] || 0) - (gp.standings[a] || 0);
    if (d) return d;
    const p = (gp.lastPlaces[a] || 99) - (gp.lastPlaces[b] || 99);
    if (p) return p;
    return (gp.totalTimes[a] || 0) - (gp.totalTimes[b] || 0);
  });
}
