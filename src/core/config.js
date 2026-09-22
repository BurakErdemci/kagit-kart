// Every tunable lives here. Numbers follow ARCHITECTURE.md §8.1 unless a comment says why they differ.

export const config = {
  STEP: 1 / 120,
  MAX_FRAME_DT: 0.1,
  MAX_STEPS_PER_FRAME: 8, // multiplied by timeScale

  // System stack only (§2/§13): nothing is downloaded. Display type is ui/lettering.js.
  fonts: {
    body: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },

  classes: {
    80: { top: 20, rubberK: 0.05 },
    120: { top: 25, rubberK: 0.04 },
    200: { top: 30, rubberK: 0.03 },
  },

  kart: {
    radius: 1.1,
    statSpeed: 0.03,
    statAccel: 0.08,
    statHandling: 0.06,
    statWeight: 0.15,
    statOffroad: 0.04,

    accelTime: 2.2, // to 80% of top
    coastDecel: 3.5,
    overCapDecel: 14, // when above the current cap (offroad entry, boost ending)
    brakeDecel: 22,
    brakeDelay: 0.2,
    softBrakeDecel: 6, // before brakeDelay, so a quick tap for a backward throw barely slows
    reverseMax: 6,
    reverseAccel: 9,

    yawLow: 2.4,
    yawHigh: 1.3,
    yawLowSpeed: 8,
    // Below this speed yaw scales down linearly so a stopped kart cannot spin on the spot.
    yawFullSpeed: 3.5,
    steerRampIn: 0.10,
    steerRampOut: 0.06,
    airYaw: 0.3,

    grip: 14,
    driftGrip: 7,
    iceGrip: 0.35,

    hopVy: 3.2,
    driftMinStart: 9,
    driftMinHold: 7,
    driftYawNeutral: 1.1,
    driftYawIn: 1.7,
    driftYawOut: 0.45,
    driftChargeIn: 1.5,
    driftChargeOut: 0.6,
    driftTiers: [1.0, 2.2, 3.5],
    driftVisualYaw: 28 * Math.PI / 180,
    driftVisualSteer: 10 * Math.PI / 180,
    driftSteerDeadzone: 0.2,

    boostTopGain: 0.35,
    boostRampTime: 0.3,
    boosts: {
      tier1: [0.45, 1], tier2: [0.9, 1], tier3: [1.4, 1],
      start: [1.0, 1], weakStart: [0.4, 1], trick: [0.8, 1], pad: [1.0, 1],
      rocket: [1.3, 1.15], draft: [0.9, 0.6], respawn: [0.5, 1],
    },

    draftRange: 14,
    draftCone: 12 * Math.PI / 180,
    draftMinSpeed: 0.6,
    draftCharge: 1.2,
    draftDecay: 0.6,

    offroadCap: 0.55,
    sandCap: 0.8,
    sandYaw: 0.9,
    outCap: 0.35,
    outRespawn: 2.0,

    gravity: 18,
    groundSnap: 0.35,
    upDampHalfLife: 0.08,
    airUpHalfLife: 0.35,
    maxClimbVy: 12,

    trickBefore: 0.25,
    trickAfter: 0.3,

    wallTangent: 0.92,
    wallNormal: 0.25,
    wallHardAngle: 45 * Math.PI / 180,
    wallHardSpeed: 0.6,
    wallSteerLock: 0.2,
    wallScrape: 8,
    wallImpactSpeed: 1.5, // m/s into the wall that counts as an impact (below: sliding contact)
    wallImpactCooldown: 0.3,
    wallAlign: 2.5, // rad/s the nose turns along the wall while sliding
    wallInset: 0.9, // kart centre stays this far inside the wall line

    bumpImpulse: 4,
    bumpSpeedLoss: 0.05,
    bumpCooldown: 0.2,

    spins: {
      gum: { time: 0.9, speed: 0.4 },
      plane: { time: 1.3, speed: 0.1 },
      homing: { time: 1.3, speed: 0.1 },
      rocket: { time: 1.3, speed: 0.1 },
      scissors: { time: 1.8, speed: 0 },
      foil: { time: 0.9, speed: 0.4 },
      burnout: { time: 0.8, speed: 0 },
      default: { time: 1.0, speed: 0.3 },
    },
    graceAfterSpin: 1.0,
    graceAfterRespawn: 1.5,
    invincibleTopGain: 0.15,

    respawnLift: 0.6,
    respawnCarry: 0.8,
    respawnDrop: 0.5,
    respawnHeight: 5,
    respawnSafeTime: 0.5,
    respawnLateral: 0.5,
    respawnLaunchWindow: 0.25,
  },

  track: {
    spacing: 1,
    denseSteps: 48, // curve evaluations per control segment before resampling
    gridCell: 16,
    checkpoints: [0.25, 0.5, 0.75],
    killDepth: 14,
    wallHeight: 1.15,
    curbWidth: 1.0,
    curbHeight: 0.07,
    padWidth: 4,
    padLength: 6,
    waterDrop: 2.2, // water surface this far below the edge height
    pageMargin: 260,
    deskDrop: 7,
    roadDashPeriod: 12,
    layout: {
      lapMin: 1000, lapMax: 1400,
      radiusMargin: 4,
      separationExtra: 6, separationHeight: 6,
      // Pairs closer along the track than this factor × the required separation are "consecutive".
      separationArcFactor: 1.6,
      cornerRadius: 110, // |curvature| ≥ 1/cornerRadius counts as cornering
      tier3Arc: 80, tier2Arc: 45,
      tier3Min: 2, tier2Min: 3, tier2Max: 5,
      rampStraight: 50, rampStraightAngle: 15 * Math.PI / 180,
      shortcutMin: 15, shortcutMax: 40, shortcutSaving: 40,
      halfWidthMin: 8, halfWidthMax: 12,
      fogFarMin: 180,
    },
  },

  camera: {
    near: 0.3, far: 900,
    distance: 6.5, boostDistance: 0.8,
    height: 2.6,
    lookAhead: 5, lookHeight: 1.0,
    yawHalfLife: 0.12, driftYawShare: 0.3,
    posHalfLife: 0.10, heightHalfLife: 0.25, airHeightHalfLife: 0.4,
    hfovRest: 90, hfovTop: 95, hfovBoost: 102,
    vfovMin: 50, vfovMax: 75,
    fovHalfLife: 0.25,
    shakeDecay: 6,
    shakeHit: 0.35, shakeWall: 0.22,
    lookBackDistance: 6.0,
  },

  race: {
    countdownStep: 1,
    startPerfect: [-1.0, -0.65],
    startGood: [-0.65, -0.30],
    finishWait: 12,
    points: [15, 12, 10, 8, 6, 4, 2, 1],
    wrongWayTime: 1.5,
    wrongWayOffTime: 0.5,
    wrongWayDot: -0.3,
    paceWindow: 5,
    ghostHz: 20,
  },

  render: {
    shadowSize: { high: 2048, medium: 1024, low: 0 },
    // Half-size of the sun's ortho frustum; its centre sits shadowLead m ahead along the view, so the
    // 2048 map spends its texels where the camera looks (3.9 cm texels instead of 5.4 at 55 m).
    shadowExtent: 40,
    shadowLead: 16,
    outlinePx: 1, // ink outline tap offset (whole px) at 720 px of render height; scales with resolution
    shadowDistance: 120,
    pixelCap: { high: 2.4e6, medium: 1.4e6, low: 0.9e6 },
    dotPx: 6,
    gradient: [0.38, 0.7, 1.0], // three toon bands
  },

  quality: {
    measureTime: 1.0,
    window: 3.0,
    slowFactor: 1.2,
  },

  settingsDefaults: {
    musicVolume: 0.7,
    sfxVolume: 0.9,
    reducedMotion: 'auto',
    cameraShake: true,
    quality: 'auto',
    touchControls: 'auto',
    autoAccelerate: false,
    showFps: false,
    seenTutorial: false,
    muted: false,
  },
};

// Theme used outside races (title, menus, podium).
export const BOOK_THEME = {
  paper: '#f3ead3', ink: '#2d2a32', road: '#9aa1a8', roadLine: '#fbf6e9',
  curbA: '#d9483b', curbB: '#fbf6e9', offroad: '#9cc56b', wall: '#e3cfa2', desk: '#7a5236',
  skyTop: '#9cc9e6', skyBottom: '#f6e6c2',
  fog: { color: '#f1e4c6', near: 140, far: 560 },
  sun: { dir: [0.45, 0.8, 0.35], color: '#fff4de', intensity: 2.0 },
  ambient: { color: '#c9d8ec', intensity: 1.25 },
  accents: ['#f2c14e', '#e56b6f', '#6c8ead'],
};
