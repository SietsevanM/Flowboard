(function () {
  'use strict';

  var t = function (key, params) { return FlowboardI18n.t(key, params); };

  var STORAGE_KEY = 'flowboard:tactic';
  var FIELD_LENGTH = 35;
  var FIELD_WIDTH = 23;
  var HALF_LENGTH = 17.5;
  var BOAT_LENGTH = 3;
  var BOAT_WIDTH = 0.6;
  // Kayak outline in metres (geometric centre at origin, bow at +x), traced from Keistad playbook.
  var BOAT_HULL = [
    [1.498, 0.000],
    [1.415, 0.113],
    [-0.369, 0.299],
    [-1.498, 0.122],
    [-1.498, -0.122],
    [-0.369, -0.299],
    [1.415, -0.113]
  ];
  var BOAT_COCKPIT = [
    [0.373, 0.000],
    [0.326, 0.142],
    [-0.211, 0.209],
    [-0.359, 0.108],
    [-0.359, -0.108],
    [-0.211, -0.209],
    [0.326, -0.142]
  ];
  var BOAT_HULL_CORNER_RADIUS = 0.1;
  var BOAT_COCKPIT_CORNER_RADIUS = 0.045;
  // Two-colour split: just before the hull's widest point (toward the bow).
  var BOAT_COLOR_SPLIT_X = (function () {
    var widestHalfWidth = 0;
    var widestX = 0;
    BOAT_HULL.forEach(function (point) {
      var halfWidth = Math.abs(point[1]);
      if (halfWidth > widestHalfWidth) {
        widestHalfWidth = halfWidth;
        widestX = point[0];
      }
    });
    return widestX + 0.04;
  })();
  var BALL_DIAMETER = 0.7;
  var BALL_CLAIM_SNAP_RADIUS = 1;
  var DRIBBLE_AHEAD_SECONDS = 1.2;
  var ARC_SAMPLES = 48;
  var GOAL_WIDTH = 1.5;
  var CONFETTI_COLORS = ['#facc15', '#ef4444', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#a855f7'];
  var CONFETTI_COUNT = 48;
  var LINE_4M = 4;
  var LINE_6M = 6;
  var CANVAS_PADDING_DESKTOP = 28;
  var CANVAS_PADDING_PHONE = 6;
  var KEEPER_CENTER_X = 0.25;
  var KMH_PER_MS = 3.6;

  var canvas = document.getElementById('field-canvas');
  var ctx = canvas.getContext('2d');
  var fieldScale = 28;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function defaultSettings() {
    return {
      fieldMode: 'half',
      showLine4m: false,
      showLine6m: true,
      showNumbers: false,
      defenseFormation: '1-3-1',
      attackFormation: 'midline',
      showAttack: true,
      showDefense: true,
      motionUnits: 'kmh',
      motionTimingMode: 'boatSpeed',
      boatSpeedSyncArrival: true,
      stepDuration: 2,
      boatSpeed: 15,
      boatAcceleration: 13,
      boatRotationSpeed: 180,
      ballSpeed: 30,
      // colors[0]=primary/bow, colors[1]=secondary/stern
      colorsLayout: 'bow-stern',
      defense: {
        boatCount: 5,
        colors: ['#ef4444'],
      },
      attack: {
        boatCount: 5,
        colors: ['#111111', '#facc15'],
      },
    };
  }

  function spacedYs(count, margin) {
    var m = margin == null ? 3 : margin;
    if (count <= 0) return [];
    if (count === 1) return [FIELD_WIDTH / 2];
    var usable = FIELD_WIDTH - m * 2;
    var step = usable / (count - 1);
    var ys = [];
    for (var i = 0; i < count; i++) ys.push(m + step * i);
    return ys;
  }

  function defenseSlots(formation) {
    var centerY = FIELD_WIDTH / 2;
    // 0.5 m ruimte tussen boten in de lengterichting (steven tot steven).
    var defenderX = KEEPER_CENTER_X + BOAT_LENGTH + 0.5;
    var hunterX = defenderX + BOAT_LENGTH + 0.5;
    if (formation === '1-2-2') {
      return [
        { role: 'keeper', x: KEEPER_CENTER_X, y: centerY, rotation: 0 },
        { role: 'defender', x: defenderX, y: 7.5, rotation: 0 },
        { role: 'defender', x: defenderX, y: 15.5, rotation: 0 },
        { role: 'hunter', x: hunterX, y: 8.2, rotation: 0 },
        { role: 'hunter', x: hunterX, y: 14.8, rotation: 0 },
      ];
    }
    return [
      { role: 'keeper', x: KEEPER_CENTER_X, y: centerY, rotation: 0 },
      { role: 'defender', x: defenderX, y: centerY - 2.75, rotation: 0 },
      { role: 'defender', x: defenderX, y: centerY, rotation: 0 },
      { role: 'defender', x: defenderX, y: centerY + 2.75, rotation: 0 },
      { role: 'hunter', x: hunterX, y: centerY, rotation: 0 },
    ];
  }

  function attackSlots(formation, boatCount) {
    if (formation === 'fan') {
      var fanCenterX = 2;
      var fanCenterY = FIELD_WIDTH / 2;
      var goalX = 0;
      var fanRadius = HALF_LENGTH - fanCenterX;
      var fanArcSpan = 140;
      var fanHalfArc = fanArcSpan / 2;
      var fieldMargin = BOAT_LENGTH / 2 + 0.3;
      var angles = [];
      if (boatCount <= 1) {
        angles = [0];
      } else {
        for (var i = 0; i < boatCount; i++) {
          angles.push(-fanHalfArc + (fanArcSpan * i) / (boatCount - 1));
        }
      }
      return angles.map(function (angleDeg) {
        var angleRad = (angleDeg * Math.PI) / 180;
        var radius = Math.abs(angleDeg) < 0.001 ? fanRadius - 1 : fanRadius;
        var pose = clampPoseToField({
          x: fanCenterX + radius * Math.cos(angleRad),
          y: fanCenterY + radius * Math.sin(angleRad),
          rotation: 0,
        });
        pose.y = clamp(pose.y, fieldMargin, FIELD_WIDTH - fieldMargin);
        pose.rotation = rotationFromTangent(goalX - pose.x, fanCenterY - pose.y, 180);
        return {
          role: 'attacker',
          x: pose.x,
          y: pose.y,
          rotation: pose.rotation,
        };
      });
    }
    var ys = spacedYs(boatCount, 3.5);
    return ys.map(function (y) {
      return { role: 'attacker', x: HALF_LENGTH - 1, y: y, rotation: 180 };
    });
  }

  function takeSlots(slots, count) {
    if (count >= slots.length) {
      if (count === slots.length) return slots.slice();
      var extra = [];
      var base = slots.slice();
      var extrasNeeded = count - slots.length;
      var ys = spacedYs(extrasNeeded + 2, 4).slice(1, extrasNeeded + 1);
      for (var i = 0; i < extrasNeeded; i++) {
        extra.push({
          role: 'extra',
          x: slots[slots.length - 1] ? slots[slots.length - 1].x + 1.2 : 8,
          y: ys[i] || FIELD_WIDTH / 2,
          rotation: 0,
        });
      }
      return base.concat(extra);
    }
    return slots.slice(0, count);
  }

  function teamColor(teamSettings, index) {
    var colors = teamSettings.colors && teamSettings.colors.length
      ? teamSettings.colors
      : ['#94a3b8'];
    return colors[index % colors.length];
  }

  function buildEntities(settings) {
    var entities = [];
    var showDefense = settings.showDefense !== false;
    var showAttack = settings.showAttack !== false;

    if (showDefense) {
      var dSlots = takeSlots(defenseSlots(settings.defenseFormation), settings.defense.boatCount);
      dSlots.forEach(function (slot, index) {
        entities.push({
          id: 'boat-defense-' + (index + 1),
          type: 'boat',
          team: 'defense',
          label: String(index + 1),
          color: teamColor(settings.defense, 0),
          colors: settings.defense.colors.slice(),
          initial: { x: slot.x, y: slot.y, rotation: slot.rotation },
        });
      });
    }

    if (showAttack) {
      var aSlots = attackSlots(settings.attackFormation, settings.attack.boatCount);
      aSlots.forEach(function (slot, index) {
        entities.push({
          id: 'boat-attack-' + (index + 1),
          type: 'boat',
          team: 'attack',
          label: String(index + 1),
          color: teamColor(settings.attack, 0),
          colors: settings.attack.colors.slice(),
          initial: { x: slot.x, y: slot.y, rotation: slot.rotation },
        });
      });
    }

    entities.push({
      id: 'ball',
      type: 'ball',
      team: 'neutral',
      label: t('entity.ball'),
      color: '#ffffff',
      colors: ['#ffffff'],
      initial: { x: HALF_LENGTH, y: FIELD_WIDTH / 2, rotation: 0 },
    });

    return entities;
  }

  function captureEntityPoses(entities) {
    var poses = {};
    (entities || []).forEach(function (entity) {
      poses[entity.id] = clone(entity.initial);
    });
    return poses;
  }

  function defaultStartBallHolderId(settings) {
    if (!settings || settings.showAttack === false) return null;
    var boatCount = settings.attack && settings.attack.boatCount;
    if (!boatCount || boatCount < 3) return null;
    return 'boat-attack-3';
  }

  function createStartStep(entities, settings) {
    var poses = captureEntityPoses(entities);
    var holderId = defaultStartBallHolderId(settings);
    if (holderId && poses[holderId]) {
      poses.ball = clone(poses[holderId]);
    }
    return createStep(t('step.start'), poses, null, holderId);
  }

  function createStep(name, poses, routes, ballHolderId) {
    return {
      id: uuid(),
      name: name,
      poses: poses || {},
      routes: routes || null,
      ballHolderId: ballHolderId == null ? null : ballHolderId,
    };
  }

  function stepNameForIndex(index) {
    return index === 0 ? t('step.start') : t('step.number', { n: index });
  }

  function defaultStepNameForLocale(index, locale) {
    return index === 0
      ? FlowboardI18n.tForLocale(locale, 'step.start')
      : FlowboardI18n.tForLocale(locale, 'step.number', { n: index });
  }

  function legacyDefaultStepNameForLocale(index, locale) {
    return index === 0
      ? FlowboardI18n.tForLocale(locale, 'step.start')
      : FlowboardI18n.tForLocale(locale, 'step.number', { n: index + 1 });
  }

  function isDefaultStepName(name, index) {
    if (!name) return true;
    return FlowboardI18n.supportedLocales.some(function (locale) {
      return name === defaultStepNameForLocale(index, locale) ||
        name === legacyDefaultStepNameForLocale(index, locale);
    });
  }

  function syncDefaultStepNames() {
    if (!state.tactic || !Array.isArray(state.tactic.steps)) return;
    state.tactic.steps.forEach(function (step, index) {
      if (!step || typeof step !== 'object') return;
      if (isDefaultStepName(step.name, index)) {
        step.name = stepNameForIndex(index);
      }
    });
  }

  function ensureSteps(tactic) {
    if (!Array.isArray(tactic.steps) || !tactic.steps.length) {
      var poses = captureEntityPoses(tactic.entities);
      if ((!poses || !Object.keys(poses).length) && tactic.startPositions) {
        poses = clone(tactic.startPositions);
      }
      tactic.steps = [createStartStep(tactic.entities, tactic.settings)];
    } else {
      tactic.steps.forEach(function (step, index) {
        if (!step || typeof step !== 'object') return;
        if (!step.id) step.id = uuid();
        if (isDefaultStepName(step.name, index)) {
          step.name = stepNameForIndex(index);
        }
        if (!step.poses || typeof step.poses !== 'object') step.poses = {};
        if (step.ballHolderId === undefined) {
          step.ballHolderId = index === 0
            ? defaultStartBallHolderId(tactic.settings)
            : null;
        }
        if (index === 0 && step.ballHolderId && step.poses && step.poses[step.ballHolderId]) {
          step.poses.ball = clone(step.poses[step.ballHolderId]);
        }
        if (index === 0) step.routes = null;
        else if (step.routes && typeof step.routes !== 'object') step.routes = null;
      });
    }
    if (typeof tactic.currentStepIndex !== 'number' || isNaN(tactic.currentStepIndex)) {
      tactic.currentStepIndex = tactic.steps.length - 1;
    }
    tactic.currentStepIndex = clamp(tactic.currentStepIndex, 0, tactic.steps.length - 1);
  }

  function applyStepPoses(step) {
    if (!step || !step.poses) return;
    state.tactic.entities.forEach(function (entity) {
      if (!step.poses[entity.id]) return;
      entity.initial = clone(step.poses[entity.id]);
      var track = state.tactic.tracks.find(function (item) { return item.entityId === entity.id; });
      if (track) track.segments = [];
    });
  }

  function loadRoutesOntoTracks(routes) {
    clearDraftRoutes();
    if (!routes) return;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var track = getTrackForEntity(entityId);
      track.segments = [clone(segment)];
    });
  }

  // Toont het eindresultaat van een stap: boten op de startpositie, ghosts + lijnen naar het eind.
  function applyStepDiagram(index) {
    ensureSteps(state.tactic);
    var steps = state.tactic.steps;
    var step = steps[index];
    if (!step) return;

    if (index <= 0) {
      applyStepPoses(step);
      return;
    }

    var fromStep = steps[index - 1];
    applyStepPoses(fromStep);
    var routes = step.routes && Object.keys(step.routes).length
      ? step.routes
      : buildFallbackRoutes(fromStep, step);
    // Herstel ontbrekende sync: start van deze stap = eind van de vorige.
    healRouteStartsFromPrevious(routes, fromStep, index);
    if (step.routes && Object.keys(step.routes).length) {
      step.routes = routes;
    }
    loadRoutesOntoTracks(routes);
  }

  function healRouteStartsFromPrevious(routes, fromStep, stepIndex) {
    if (!routes || !fromStep || !fromStep.poses) return;
    var changed = false;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment || !segment.startPose) return;
      var newStart;
      if (entityId === 'ball') {
        var holderId = fromStep.ballHolderId;
        if (holderId && fromStep.poses[holderId]) {
          newStart = {
            x: fromStep.poses[holderId].x,
            y: fromStep.poses[holderId].y,
            rotation: 0,
          };
        } else if (fromStep.poses.ball) {
          newStart = fromStep.poses.ball;
        } else {
          return;
        }
      } else if (fromStep.poses[entityId]) {
        newStart = fromStep.poses[entityId];
      } else {
        return;
      }
      if (posesApproxEqual(segment.startPose, newStart)) return;
      updateSegmentStartPose(segment, newStart, segment.startPose);
      changed = true;
    });
    if (changed) applyRouteDurations(routes, stepIndex);
  }

  function posesApproxEqual(a, b) {
    if (!a || !b) return false;
    return distanceMeters(a, b) < 0.05
      && Math.abs((a.rotation || 0) - (b.rotation || 0)) < 1;
  }

  function livePosesMatchStep(step) {
    if (!step || !step.poses) return false;
    var checked = 0;
    var match = 0;
    // Alleen boten: balpositie kan afwijken door possession/holder-logica.
    state.tactic.entities.forEach(function (entity) {
      if (entity.type === 'ball') return;
      var stepPose = step.poses[entity.id];
      var pose = entity.initial;
      if (!stepPose || !pose) return;
      checked += 1;
      if (posesApproxEqual(pose, stepPose)) match += 1;
    });
    return checked > 0 && match === checked;
  }

  // True wanneer de huidige drafts het opgeslagen eindresultaat van deze stap tonen
  // (boten op vorige stap, ghosts op deze stap) i.p.v. een nieuw concept daarna.
  function isReviewingCompletedStep() {
    ensureSteps(state.tactic);
    var index = state.tactic.currentStepIndex;
    if (index <= 0 || !hasDraftRoutes()) return false;
    var prev = state.tactic.steps[index - 1];
    return livePosesMatchStep(prev);
  }

  function syncCurrentStepPoses() {
    ensureSteps(state.tactic);
    // Tijdens review staan boten op de start van de stap; niet de opgeslagen eindposes overschrijven.
    if (isReviewingCompletedStep()) return;
    var step = state.tactic.steps[state.tactic.currentStepIndex];
    if (!step) return;
    step.poses = captureEntityPoses(state.tactic.entities);
  }

  function clearDraftRoutes() {
    state.tactic.tracks.forEach(function (track) {
      track.segments = [];
    });
  }

  function createInitialTactic() {
    var settings = defaultSettings();
    var entities = buildEntities(settings);
    var tactic = {
      id: uuid(),
      name: t('tactic.defaultName'),
      sport: 'canoe-polo',
      field: {
        sport: 'canoe-polo',
        width: FIELD_LENGTH,
        height: FIELD_WIDTH,
        goalWidth: GOAL_WIDTH,
      },
      settings: settings,
      entities: entities,
      tracks: entities.map(function (entity) {
        return { entityId: entity.id, segments: [] };
      }),
      interactions: [],
      startPositions: null,
      steps: [createStartStep(entities, settings)],
      currentStepIndex: 0,
      duration: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return tactic;
  }

  function normalizeTeamColors(team) {
    if (!team || typeof team !== 'object') {
      return { boatCount: 5, colors: ['#94a3b8'] };
    }
    var colors = Array.isArray(team.colors) ? team.colors.filter(Boolean) : [];
    if (!colors.length && team.color) colors = [team.color];
    if (!colors.length) colors = ['#94a3b8'];
    if (colors.length > 2) colors = colors.slice(0, 2);
    return {
      boatCount: clamp(Number(team.boatCount) || 5, 1, 10),
      colors: colors,
    };
  }

  function migrateTactic(tactic) {
    if (!tactic || typeof tactic !== 'object') return createInitialTactic();
    var settings = Object.assign(defaultSettings(), tactic.settings || {});
    settings.defense = normalizeTeamColors(settings.defense || tactic.settings && tactic.settings.defense);
    settings.attack = normalizeTeamColors(settings.attack || tactic.settings && tactic.settings.attack);
    settings.fieldMode = settings.fieldMode === 'full' ? 'full' : 'half';
    settings.showLine4m = !!settings.showLine4m;
    settings.showLine6m = settings.showLine6m !== false;
    settings.showNumbers = !!settings.showNumbers;
    settings.defenseFormation = settings.defenseFormation === '1-2-2' ? '1-2-2' : '1-3-1';
    settings.attackFormation = settings.attackFormation === 'fan' ? 'fan' : 'midline';
    var rawSettings = tactic.settings || {};
    // Old layout was [stern, bow]; flip once to [bow/primary, stern/secondary].
    var needsColorFlip = rawSettings.colorsLayout !== 'bow-stern';
    if (needsColorFlip) {
      if (settings.attack.colors.length === 2) {
        settings.attack.colors = [settings.attack.colors[1], settings.attack.colors[0]];
      }
      if (settings.defense.colors.length === 2) {
        settings.defense.colors = [settings.defense.colors[1], settings.defense.colors[0]];
      }
    }
    settings.colorsLayout = 'bow-stern';
    if (rawSettings.motionUnits !== 'kmh') {
      if (rawSettings.boatSpeed != null) settings.boatSpeed = Number(rawSettings.boatSpeed) * KMH_PER_MS;
      if (rawSettings.boatAcceleration != null) {
        settings.boatAcceleration = Number(rawSettings.boatAcceleration) * KMH_PER_MS;
      }
      if (rawSettings.ballSpeed != null) settings.ballSpeed = Number(rawSettings.ballSpeed) * KMH_PER_MS;
    }
    settings.motionUnits = 'kmh';
    settings.motionTimingMode = settings.motionTimingMode === 'stepDuration' ? 'stepDuration' : 'boatSpeed';
    settings.boatSpeedSyncArrival = rawSettings.boatSpeedSyncArrival !== false;
    settings.stepDuration = clamp(Number(settings.stepDuration) || 2, 0.25, 30);
    settings.boatSpeed = clamp(Number(settings.boatSpeed) || 15, 1, 40);
    settings.boatAcceleration = clamp(Number(settings.boatAcceleration) || 13, 1, 72);
    settings.boatRotationSpeed = clamp(Number(settings.boatRotationSpeed) || 180, 15, 360);
    settings.ballSpeed = clamp(Number(settings.ballSpeed) || 30, 1, 80);
    if (typeof rawSettings.showAttack === 'boolean' || typeof rawSettings.showDefense === 'boolean') {
      settings.showAttack = rawSettings.showAttack !== false;
      settings.showDefense = rawSettings.showDefense !== false;
    } else if (rawSettings.teamCount === 1) {
      settings.showAttack = rawSettings.singleTeam === 'attack';
      settings.showDefense = rawSettings.singleTeam === 'defense';
    } else {
      settings.showAttack = true;
      settings.showDefense = true;
    }
    delete settings.teamCount;
    delete settings.singleTeam;

    var hasNewTeams = (tactic.entities || []).some(function (entity) {
      return entity.team === 'defense' || entity.team === 'attack';
    });

    if (!hasNewTeams || !tactic.entities || !tactic.entities.length) {
      var rebuilt = createInitialTactic();
      rebuilt.id = tactic.id || rebuilt.id;
      rebuilt.name = tactic.name || rebuilt.name;
      rebuilt.settings = settings;
      rebuilt.entities = buildEntities(settings);
      rebuilt.tracks = rebuilt.entities.map(function (entity) {
        return { entityId: entity.id, segments: [] };
      });
      rebuilt.steps = [createStartStep(rebuilt.entities, settings)];
      rebuilt.currentStepIndex = 0;
      rebuilt.createdAt = tactic.createdAt || rebuilt.createdAt;
      rebuilt.updatedAt = new Date().toISOString();
      return rebuilt;
    }

    tactic.settings = settings;
    tactic.field = Object.assign({
      sport: 'canoe-polo',
      width: FIELD_LENGTH,
      height: FIELD_WIDTH,
      goalWidth: GOAL_WIDTH,
    }, tactic.field || {});
    tactic.field.width = FIELD_LENGTH;
    tactic.field.height = FIELD_WIDTH;
    tactic.field.goalWidth = GOAL_WIDTH;
    tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      if (!entity.colors || !entity.colors.length) {
        entity.colors = entity.team === 'attack'
          ? settings.attack.colors.slice()
          : settings.defense.colors.slice();
      } else if (needsColorFlip && entity.colors.length === 2) {
        entity.colors = [entity.colors[1], entity.colors[0]];
      }
      entity.color = entity.colors[0];
    });
    if (!Array.isArray(tactic.tracks)) tactic.tracks = [];
    if (!Array.isArray(tactic.interactions)) tactic.interactions = [];
    if (!tactic.duration) tactic.duration = 12;
    if (!tactic.startPositions || typeof tactic.startPositions !== 'object') {
      tactic.startPositions = null;
    }
    ensureSteps(tactic);
    return tactic;
  }

  function applyFormationReset(tactic) {
    var settings = tactic.settings;
    var entities = buildEntities(settings);
    tactic.entities = entities;
    tactic.tracks = entities.map(function (entity) {
      return { entityId: entity.id, segments: [] };
    });
    tactic.interactions = [];
    tactic.steps = [createStartStep(entities, settings)];
    tactic.currentStepIndex = 0;
    tactic.updatedAt = new Date().toISOString();
    if (state) {
      state.startPoseEdit = false;
      if (state.transport) {
        state.playbackMode = false;
        state.transport.timeline = null;
        state.transport.playing = false;
        state.transport.time = 0;
        stopTransportRaf();
      }
    }
  }

  var TRANSPORT_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3];

  var state = {
    tactic: createInitialTactic(),
    currentTime: 0,
    isPlaying: false,
    playRaf: null,
    playbackMode: false,
    transport: {
      playing: false,
      time: 0,
      duration: 0,
      speedIndex: 2,
      raf: null,
      lastFrameAt: null,
      timeline: null,
      scrubbing: false,
    },
    keyboardFocusEntityId: null,
    message: null,
    history: { past: [], future: [] },
    drag: null,
    pendingPointer: null,
    tool: null,
    startPoseEdit: false,
    settingsOpen: false,
    shortcutsOpen: false,
    stepRename: null,
    ballWasInGoal: false,
    confetti: {
      particles: [],
      raf: null,
      lastUpdateAt: null,
    },
  };

  var DRAG_THRESHOLD_PX = 8;
  var START_POSE_DRAG_THRESHOLD_PX = 16;
  var PHONE_LAYOUT_MQ = '(max-width: 1024px) and (orientation: portrait)';
  var PHONE_LANDSCAPE_MQ = '(orientation: landscape) and (max-height: 560px) and (pointer: coarse)';
  var SHEET_PEEK_PX = 118;
  var MIN_ENTITY_HIT_PX = 22;
  var DOUBLE_TAP_MS = 350;
  var DOUBLE_TAP_SLOP_PX = 28;

  function isPhoneLandscape() {
    return !!(window.matchMedia && window.matchMedia(PHONE_LANDSCAPE_MQ).matches);
  }

  function isPhoneLayout() {
    if (!window.matchMedia) return false;
    return window.matchMedia(PHONE_LAYOUT_MQ).matches || isPhoneLandscape();
  }

  function canvasPadding() {
    return isPhoneLayout() ? CANVAS_PADDING_PHONE : CANVAS_PADDING_DESKTOP;
  }

  function getSafeInset(side) {
    var styles = window.getComputedStyle(document.documentElement);
    var raw = styles.getPropertyValue('--safe-' + side).trim();
    var value = parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function getSheetPeekReserve() {
    // Portrait phone reserves bottom sheet height; landscape puts steps on the side.
    if (!isPhoneLayout() || isPhoneLandscape()) return 0;
    return SHEET_PEEK_PX + getSafeInset('bottom');
  }

  function setStepsSheetExpanded(expanded) {
    var panel = document.getElementById('steps-panel');
    var toggle = document.getElementById('btn-steps-toggle');
    if (!panel) return;
    if (!isPhoneLayout()) {
      panel.classList.add('is-peek');
      panel.classList.remove('is-expanded');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    var nextExpanded = !!expanded;
    var changed = panel.classList.contains('is-expanded') !== nextExpanded;
    panel.classList.toggle('is-expanded', nextExpanded);
    panel.classList.toggle('is-peek', !nextExpanded);
    if (toggle) toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    if (changed && isPhoneLandscape()) {
      // Side panel width changes the canvas wrap — refit after layout.
      requestAnimationFrame(function () {
        renderCanvas();
      });
    }
  }

  function collapseStepsSheet() {
    if (!isPhoneLayout()) return;
    setStepsSheetExpanded(false);
  }

  function syncStepsSheetLayout() {
    var panel = document.getElementById('steps-panel');
    if (!panel) return;
    if (!isPhoneLayout()) {
      panel.classList.add('is-peek');
      panel.classList.remove('is-expanded');
      var toggle = document.getElementById('btn-steps-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!panel.classList.contains('is-expanded') && !panel.classList.contains('is-peek')) {
      setStepsSheetExpanded(false);
    }
  }

  function updateSheetPeekSummary() {
    var summary = document.getElementById('sheet-peek-summary');
    if (!summary || !state.tactic || !state.tactic.steps) return;
    ensureSteps(state.tactic);
    var previewing = state.playbackMode;
    var currentIndex = previewing
      ? getTransportStepIndex()
      : state.tactic.currentStepIndex;
    var step = state.tactic.steps[currentIndex];
    var label = (step && step.name) || stepNameForIndex(currentIndex);
    var total = state.tactic.steps.length;
    summary.textContent = label + ' · ' + (currentIndex + 1) + '/' + total;
  }

  function clearTool() {
    state.tool = null;
    canvas.classList.remove('tool-active');
  }

  function clearPointerInteraction() {
    if (state.drag && state.drag.mode === 'freestyle') {
      restoreBallSnapPreview(state.drag);
    }
    state.drag = null;
    state.pendingPointer = null;
    clearTool();
    canvas.classList.remove('dragging');
  }

  function clearEntityRoute(entityId) {
    if (!canEdit()) return;
    if (!getPrimarySegment(entityId)) return;
    recordHistory();
    getTrackForEntity(entityId).segments = [];
    if (entityId !== 'ball') retargetBallRouteForLinkedBoat(entityId);
    recomputeAllSegmentDurations();
    if (entityId === 'ball') refreshAllBoatBallClaims();
    state.tactic.updatedAt = new Date().toISOString();
    clearPointerInteraction();
    renderAll();
  }

  function getCurrentStep() {
    ensureSteps(state.tactic);
    return state.tactic.steps[state.tactic.currentStepIndex];
  }

  function getBallHolderId(step) {
    step = step || getCurrentStep();
    return (step && step.ballHolderId) || null;
  }

  function setBallHolderId(holderId) {
    var step = getCurrentStep();
    if (!step) return;
    step.ballHolderId = holderId || null;
  }

  function isPoseNearBall(ballPose, boatPose) {
    return distanceMeters(ballPose, boatPose) <= BALL_CLAIM_SNAP_RADIUS;
  }

  function snapBallToBoatIfNear(entityId, boatPose, ballRefPose) {
    if (!canEdit() || hasBallRoute()) return false;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity || entity.type !== 'boat') return false;

    var pose = boatPose || getBoatTargetPose(entityId);
    var ballPose = ballRefPose || getBallStartPose();
    if (!isPoseNearBall(ballPose, pose)) return false;
    if (getBallHolderId() === entityId) return true;

    setBallHolderId(entityId);
    var ball = getBallEntity();
    if (ball) {
      ball.initial.x = pose.x;
      ball.initial.y = pose.y;
      ball.initial.rotation = 0;
    }
    var step = getCurrentStep();
    if (step && step.poses) {
      step.poses.ball = clone(pose);
    }
    state.tactic.updatedAt = new Date().toISOString();
    return true;
  }

  function restoreBallSnapPreview(drag) {
    if (!drag) return;
    setBallHolderId(drag.previousHolderId || null);
    var ball = getBallEntity();
    if (ball && drag.ballRefPose) {
      ball.initial.x = drag.ballRefPose.x;
      ball.initial.y = drag.ballRefPose.y;
      ball.initial.rotation = 0;
    }
    var step = getCurrentStep();
    if (step && step.poses && drag.ballRefPose) {
      step.poses.ball = clone(drag.ballRefPose);
    }
  }

  function previewFreestyleBallSnap(drag, entityId, boatPose) {
    if (!drag || drag.previousHolderId === entityId) return;
    if (snapBallToBoatIfNear(entityId, boatPose, drag.ballRefPose)) return;
    if (getBallHolderId() === entityId) restoreBallSnapPreview(drag);
  }

  function getClaimArcDistanceOnRoute(segment, ballPose) {
    var arcData = getSegmentArcData(segment);
    var samples = 56;
    for (var i = 0; i <= samples; i++) {
      var t = i / samples;
      var pose = poseAlongSegment(segment, t, null);
      if (distanceMeters(pose, ballPose) <= BALL_CLAIM_SNAP_RADIUS) {
        return arcDistanceAtProgress(arcData, t);
      }
    }
    var bestDist = Infinity;
    var bestArc = arcData.total;
    for (var j = 0; j <= samples; j++) {
      var t2 = j / samples;
      var pose2 = poseAlongSegment(segment, t2, null);
      var dist = distanceMeters(pose2, ballPose);
      if (dist < bestDist) {
        bestDist = dist;
        bestArc = arcDistanceAtProgress(arcData, t2);
      }
    }
    return bestArc;
  }

  function isFreeBallRoute(ballSeg) {
    return !!(ballSeg && (!ballSeg.passType || ballSeg.passType === 'free'));
  }

  function getFreeBallArrivalTime(routes) {
    var ballSeg = routes && routes.ball;
    if (!isFreeBallRoute(ballSeg)) return 0;
    return (ballSeg.throwDelay || 0) + (ballSeg.travelDuration || 0);
  }

  function getClaimableLooseBallPose() {
    var ballSeg = getPrimarySegment('ball');
    if (ballSeg) {
      if (!isFreeBallRoute(ballSeg)) return null;
      return clone(ballSeg.endPose);
    }
    return getBallStartPose();
  }

  function getBallClaimAtTime(routes, localTime, motionOptsByEntity) {
    if (!routes) return null;
    var claim = null;
    var freeBallArrival = getFreeBallArrivalTime(routes);
    Object.keys(routes).forEach(function (entityId) {
      if (entityId === 'ball') return;
      var seg = routes[entityId];
      if (!seg || !seg.claimsBall) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity) return;
      var claimArc = seg.claimArcDistance != null ? seg.claimArcDistance : 0;
      var motionOpts = motionOptsByEntity && motionOptsByEntity[entityId];
      var claimTime = localTimeAtArcDistance(seg, claimArc, entity, motionOpts, seg.endTime);
      var effectiveClaimTime = Math.max(claimTime, freeBallArrival);
      if (localTime >= effectiveClaimTime - 1e-6) {
        claim = { entityId: entityId, segment: seg, claimArc: claimArc, entity: entity };
      }
    });
    return claim;
  }

  function resolveBallClaimHolder(routes) {
    if (!routes) return null;
    var holderId = null;
    Object.keys(routes).forEach(function (entityId) {
      if (entityId === 'ball') return;
      var seg = routes[entityId];
      if (!seg || !seg.claimsBall) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity) return;
      var claimArc = seg.claimArcDistance != null ? seg.claimArcDistance : 0;
      var claimTime = localTimeAtArcDistance(seg, claimArc, entity, null, seg.endTime);
      if (seg.endTime >= claimTime - 1e-6) {
        holderId = entityId;
      }
    });
    return holderId;
  }

  function updateBallClaimOnRoute(entityId, boatPose) {
    if (!canEdit()) return false;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity || entity.type !== 'boat') return false;
    var segment = getPrimarySegment(entityId);
    if (!segment) return false;
    if (getBallHolderId() === entityId) {
      delete segment.claimsBall;
      delete segment.claimArcDistance;
      delete segment.claimBallPose;
      return false;
    }
    var pose = boatPose || getBoatTargetPose(entityId);
    var ballPose = getClaimableLooseBallPose();
    if (!ballPose || !isPoseNearBall(ballPose, pose)) {
      delete segment.claimsBall;
      delete segment.claimArcDistance;
      delete segment.claimBallPose;
      return false;
    }

    segment.claimsBall = true;
    segment.claimArcDistance = getClaimArcDistanceOnRoute(segment, ballPose);
    segment.claimBallPose = clone(ballPose);
    state.tactic.updatedAt = new Date().toISOString();
    return true;
  }

  function refreshAllBoatBallClaims() {
    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      updateBallClaimOnRoute(entity.id);
    });
  }

  function claimBallPossessionImmediate(entityId, boatPose, ballRefPose) {
    return snapBallToBoatIfNear(entityId, boatPose, ballRefPose);
  }

  function findNearestBoatIdNearPose(pose, maxDist) {
    if (!pose) return null;
    maxDist = maxDist == null ? BALL_CLAIM_SNAP_RADIUS : maxDist;
    var bestId = null;
    var bestDist = maxDist;
    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      var dist = distanceMeters(pose, entity.initial);
      if (dist <= bestDist) {
        bestDist = dist;
        bestId = entity.id;
      }
    });
    return bestId;
  }

  function placeBallFreestyleAt(pose) {
    var ball = getBallEntity();
    if (!ball || !pose) return;
    var boatId = findNearestBoatIdNearPose(pose);
    if (boatId) {
      var boat = state.tactic.entities.find(function (item) { return item.id === boatId; });
      setBallHolderId(boatId);
      if (boat) {
        ball.initial.x = boat.initial.x;
        ball.initial.y = boat.initial.y;
      } else {
        ball.initial.x = pose.x;
        ball.initial.y = pose.y;
      }
    } else {
      setBallHolderId(null);
      ball.initial.x = pose.x;
      ball.initial.y = pose.y;
    }
    ball.initial.rotation = 0;
  }

  function getBallEntity() {
    return state.tactic.entities.find(function (item) { return item.type === 'ball'; });
  }

  function hasBallRoute() {
    return !!getPrimarySegment('ball');
  }

  function isDribbleActive(ballHolderId, routes) {
    ballHolderId = ballHolderId == null ? getBallHolderId() : ballHolderId;
    if (!ballHolderId) return false;
    if (routes) {
      if (routes.ball) return false;
      return !!routes[ballHolderId];
    }
    if (hasBallRoute()) return false;
    return !!getPrimarySegment(ballHolderId);
  }

  function getBallStartPose() {
    var holderId = getBallHolderId();
    var poses = getPosesAtTime();
    if (holderId && poses[holderId] && !hasBallRoute()) {
      return clone(poses[holderId]);
    }
    var ball = getBallEntity();
    return clone(poses.ball || (ball && ball.initial) || { x: HALF_LENGTH, y: FIELD_WIDTH / 2, rotation: 0 });
  }

  function getBoatTargetPose(boatId) {
    var segment = getPrimarySegment(boatId);
    if (segment) return clone(segment.endPose);
    var entity = state.tactic.entities.find(function (item) { return item.id === boatId; });
    // Geen getPosesAtTime() hier: die roept syncLinkedBallRouteGeometry aan, die weer
    // getBoatTargetPose gebruikt — oneindige recursie bij een pass naar een stilstaande boot.
    return clone((entity && entity.initial) || { x: 0, y: 0, rotation: 0 });
  }

  function getHolderTeam(holderId) {
    if (!holderId) return null;
    var entity = state.tactic.entities.find(function (item) { return item.id === holderId; });
    return entity ? entity.team : null;
  }

  function getBallPickAtCanvasPoint(x, y) {
    if (hasBallRoute()) return null;
    var holderId = getBallHolderId();
    var startPose = getBallStartPose();
    var ball = getBallEntity();
    if (!ball) return null;

    var ballHit = Math.max(MIN_ENTITY_HIT_PX + 6, (BALL_DIAMETER * fieldScale) / 2 + 10);
    var canvasPose = metersToCanvas(startPose);
    if (Math.hypot(x - canvasPose.x, y - canvasPose.y) <= ballHit) {
      return { startPose: clone(startPose), holderId: holderId };
    }

    return null;
  }

  function hitTestBoatPassTarget(entity, pose, x, y, slopPx) {
    var canvasPose = metersToCanvas(pose);
    slopPx = slopPx || 0;
    var halfLength = Math.max(MIN_ENTITY_HIT_PX, (BOAT_LENGTH * fieldScale) / 2 + 4 + slopPx);
    var halfWidth = Math.max(MIN_ENTITY_HIT_PX * 0.55, (BOAT_WIDTH * fieldScale) / 2 + 4 + slopPx * 0.55);
    var dx = x - canvasPose.x;
    var dy = y - canvasPose.y;
    var rad = (-canvasPose.rotation * Math.PI) / 180;
    var localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    var localY = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(localX) <= halfLength && Math.abs(localY) <= halfWidth;
  }

  function resolveBallPasserId(startPose, explicitHolderId) {
    if (explicitHolderId) return explicitHolderId;
    var holderId = getBallHolderId();
    if (holderId) return holderId;
    if (!startPose) return null;
    var bestId = null;
    var bestDist = 1.6;
    var poses = getPosesAtTime();
    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      var pose = poses[entity.id] || entity.initial;
      var dist = distanceMeters(startPose, pose);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = entity.id;
      }
    });
    return bestId;
  }

  function getTeammatePassTargetAtCanvasPoint(x, y, passerTeam, passerId) {
    if (!passerTeam || !passerId) return null;
    var slop = Math.max(10, fieldScale * 0.35);

    for (var i = state.tactic.entities.length - 1; i >= 0; i--) {
      var entity = state.tactic.entities[i];
      if (entity.type !== 'boat' || entity.team !== passerTeam || entity.id === passerId) continue;
      var ghostPose = getGhostPose(entity.id);
      if (ghostPose && hitTestBoatPassTarget(entity, ghostPose, x, y, slop)) {
        return {
          boatId: entity.id,
          targetPose: getBoatTargetPose(entity.id),
          syncToEntityId: entity.id,
        };
      }
    }

    var poses = getPosesAtTime();
    for (var j = state.tactic.entities.length - 1; j >= 0; j--) {
      var boat = state.tactic.entities[j];
      if (boat.type !== 'boat' || boat.team !== passerTeam || boat.id === passerId) continue;
      var livePose = poses[boat.id] || boat.initial;
      if (hitTestBoatPassTarget(boat, livePose, x, y, slop)) {
        return {
          boatId: boat.id,
          targetPose: clone(livePose),
          syncToEntityId: null,
        };
      }
    }

    return null;
  }

  function routeHitSlopPx() {
    return Math.max(pathLineWidth() / 2 + 8, fieldScale * 0.25);
  }

  function getClosestPointOnRouteCanvas(segment, canvasX, canvasY) {
    var arcData = getSegmentArcData(segment);
    var bestDist = Infinity;
    var bestT = 0;
    var bestArc = 0;
    var samples = 56;
    for (var i = 0; i <= samples; i++) {
      var t = i / samples;
      var pose = poseAlongSegment(segment, t, null);
      var canvasPose = metersToCanvas(pose);
      var dist = Math.hypot(canvasPose.x - canvasX, canvasPose.y - canvasY);
      if (dist < bestDist) {
        bestDist = dist;
        bestT = t;
        bestArc = arcDistanceAtProgress(arcData, t);
      }
    }
    return {
      distance: bestDist,
      t: bestT,
      arcDistance: bestArc,
      pose: poseAlongSegment(segment, bestT, null),
    };
  }

  function getTeammateRoutePassTargetAtCanvasPoint(x, y, passerTeam, passerId) {
    if (!passerTeam || !passerId) return null;
    var slop = routeHitSlopPx();
    var best = null;

    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat' || entity.team !== passerTeam || entity.id === passerId) return;
      var segment = getPrimarySegment(entity.id);
      if (!segment) return;
      var hit = getClosestPointOnRouteCanvas(segment, x, y);
      if (hit.distance > slop) return;
      if (!best || hit.distance < best.distance) {
        best = {
          distance: hit.distance,
          boatId: entity.id,
          targetPose: clone(hit.pose),
          syncToEntityId: entity.id,
          syncArcDistance: hit.arcDistance,
          syncPathProgress: hit.t,
          passType: 'route',
        };
      }
    });

    return best;
  }

  function resolveBallPassTargetAtCanvasPoint(x, y, passerTeam, passerId) {
    return getTeammatePassTargetAtCanvasPoint(x, y, passerTeam, passerId)
      || getTeammateRoutePassTargetAtCanvasPoint(x, y, passerTeam, passerId);
  }

  function finishBallRouteDrag(drag, point) {
    var passerId = resolveBallPasserId(drag.startPose, drag.holderId);
    var passerTeam = getHolderTeam(passerId);
    var passTarget = drag.passTarget
      || (passerId
        ? resolveBallPassTargetAtCanvasPoint(point.x, point.y, passerTeam, passerId)
        : null);

    if (passTarget) {
      if (distanceMeters(drag.startPose, passTarget.targetPose) < 0.35) return;
      createBallRouteSegment(drag.startPose, passTarget.targetPose, {
        passType: passTarget.passType || 'direct',
        targetEntityId: passTarget.boatId,
        syncToEntityId: passTarget.syncToEntityId,
        syncArcDistance: passTarget.syncArcDistance,
        syncPathProgress: passTarget.syncPathProgress,
      });
      if (passTarget.syncToEntityId && !getPrimarySegment(passTarget.syncToEntityId)) {
        setMessage(t('message.syncNoBoatRoute'));
      }
      return;
    }

    var endPose = drag.previewPose;
    if (!endPose) {
      var meters = canvasToMeters(point.x, point.y, 0);
      endPose = clampPoseToField({ x: meters.x, y: meters.y, rotation: 0 });
    }
    if (distanceMeters(drag.startPose, endPose) < 0.35) return;
    createBallRouteSegment(drag.startPose, endPose, { passType: 'free' });
  }

  function resolveBallHolderAfterRoutes(routes, prevHolderId) {
    var ballSeg = routes && routes.ball;
    if (ballSeg) {
      if (isFreeBallRoute(ballSeg)) {
        return resolveBallClaimHolder(routes);
      }
      if (ballSeg.syncToEntityId) return ballSeg.syncToEntityId;
      if (ballSeg.targetEntityId) return ballSeg.targetEntityId;
      return null;
    }

    var claimHolder = resolveBallClaimHolder(routes);
    if (claimHolder) return claimHolder;

    if (prevHolderId && routes && routes[prevHolderId]) return prevHolderId;
    return prevHolderId || null;
  }

  function isEntityHighlighted(entityId) {
    if (state.tool && state.tool.entityId === entityId) return true;
    if (state.drag && state.drag.entityId === entityId) return true;
    if (state.keyboardFocusEntityId === entityId) return true;
    return false;
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function modShortcutLabel() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
      || /Mac OS/.test(navigator.userAgent || '')
      ? '⌘'
      : 'Ctrl';
  }

  function withShortcut(label, shortcut) {
    if (!label) return shortcut || '';
    if (!shortcut) return label;
    return label + ' (' + shortcut + ')';
  }

  function getBoatEntities() {
    return state.tactic.entities.filter(function (entity) {
      return entity.type === 'boat';
    });
  }

  function setKeyboardFocus(entityId) {
    if (!entityId || !canEdit()) {
      state.keyboardFocusEntityId = null;
      return;
    }
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    state.keyboardFocusEntityId = entity ? entity.id : null;
  }

  function cycleKeyboardFocus(direction) {
    if (!canEdit()) return;
    var entities = state.tactic.entities;
    if (!entities.length) return;
    var current = state.keyboardFocusEntityId;
    var index = entities.findIndex(function (entity) { return entity.id === current; });
    if (index < 0) index = direction > 0 ? -1 : 0;
    var next = (index + direction + entities.length) % entities.length;
    setKeyboardFocus(entities[next].id);
    renderAll();
  }

  function focusBoatByNumber(number) {
    if (!canEdit() || number < 1) return false;
    var boats = getBoatEntities();
    var boat = boats[number - 1];
    if (!boat) return false;
    setKeyboardFocus(boat.id);
    renderAll();
    return true;
  }

  function focusBallEntity() {
    if (!canEdit()) return false;
    var ball = state.tactic.entities.find(function (entity) { return entity.type === 'ball'; });
    if (!ball) return false;
    setKeyboardFocus(ball.id);
    renderAll();
    return true;
  }

  function getFocusedEntityId() {
    if (state.tool && state.tool.entityId) return state.tool.entityId;
    if (state.keyboardFocusEntityId) return state.keyboardFocusEntityId;
    return null;
  }

  function startToolOnFocused(mode) {
    var entityId = getFocusedEntityId();
    if (!entityId || !canEdit()) return;
    startBoatTool(mode, entityId);
  }

  function clearFocusedEntityRoute() {
    var entityId = getFocusedEntityId();
    if (!entityId) return;
    clearEntityRoute(entityId);
  }

  function selectAdjacentStep(delta) {
    ensureSteps(state.tactic);
    var index = state.playbackMode
      ? getTransportStepIndex()
      : state.tactic.currentStepIndex;
    selectStep(clamp(index + delta, 0, state.tactic.steps.length - 1));
  }

  function nudgeTransport(deltaRatio) {
    if (!state.playbackMode || state.isPlaying || !hasPlayableSteps()) return;
    ensureTransportTimeline();
    if (state.transport.duration <= 0) return;
    var ratio = state.transport.time / state.transport.duration;
    seekTransport(clamp(ratio + deltaRatio, 0, 1));
  }

  function toggleSettingsPanel() {
    if (isExportDialogOpen() || isShareDialogOpen() || state.shortcutsOpen) return;
    state.settingsOpen = !state.settingsOpen;
    renderSettings();
  }

  function triggerImportDialog() {
    if (!canEdit() || !isOnStartStep() || state.startPoseEdit) return;
    var input = document.getElementById('import-tactic-input');
    if (input) input.click();
  }

  function toggleStepsSheet() {
    if (!isPhoneLayout()) return;
    var panel = document.getElementById('steps-panel');
    if (!panel) return;
    setStepsSheetExpanded(!panel.classList.contains('is-expanded'));
  }

  function isShortcutsDialogOpen() {
    return !!state.shortcutsOpen;
  }

  function closeShortcutsDialog() {
    if (!state.shortcutsOpen) return;
    state.shortcutsOpen = false;
    renderShortcutsDialog();
  }

  function openShortcutsDialog() {
    if (isExportDialogOpen() || isShareDialogOpen()) return;
    state.settingsOpen = false;
    renderSettings();
    state.shortcutsOpen = true;
    renderShortcutsDialog();
  }

  function toggleShortcutsDialog() {
    if (state.shortcutsOpen) closeShortcutsDialog();
    else openShortcutsDialog();
  }

  function helpGuideItems() {
    return [
      { titleKey: 'help.guide.move.title', bodyKey: 'help.guide.move.body' },
      { titleKey: 'help.guide.turn.title', bodyKey: 'help.guide.turn.body' },
      { titleKey: 'help.guide.pass.title', bodyKey: 'help.guide.pass.body' },
      { titleKey: 'help.guide.vaarlijn.title', bodyKey: 'help.guide.vaarlijn.body' },
      { titleKey: 'help.guide.pickup.title', bodyKey: 'help.guide.pickup.body' },
    ];
  }

  function shortcutHelpGroups() {
    var mod = modShortcutLabel();
    return [
      {
        titleKey: 'shortcuts.group.general',
        items: [
          { keys: '?', actionKey: 'shortcuts.help' },
          { keys: 'Esc', actionKey: 'shortcuts.escape' },
          { keys: mod + '+Z', actionKey: 'shortcuts.undo' },
          { keys: mod + '+Y / ' + mod + '+Shift+Z', actionKey: 'shortcuts.redo' },
          { keys: 'S', actionKey: 'shortcuts.settings' },
          { keys: mod + '+S', actionKey: 'shortcuts.share' },
          { keys: mod + '+O', actionKey: 'shortcuts.import' },
          { keys: 'M', actionKey: 'shortcuts.toggleSheet' },
        ],
      },
      {
        titleKey: 'shortcuts.group.mode',
        items: [
          { keys: 'E', actionKey: 'shortcuts.editMode' },
          { keys: 'P', actionKey: 'shortcuts.playMode' },
          { keys: 'Space / G', actionKey: 'shortcuts.go' },
          { keys: '← / →', actionKey: 'shortcuts.prevNextStep' },
          { keys: 'Home / End', actionKey: 'shortcuts.firstLastStep' },
          { keys: 'H', actionKey: 'shortcuts.gotoStart' },
          { keys: 'L', actionKey: 'shortcuts.setStart' },
          { keys: 'R', actionKey: 'shortcuts.rename' },
          { keys: 'Shift+Backspace', actionKey: 'shortcuts.deleteStep' },
        ],
      },
      {
        titleKey: 'shortcuts.group.playback',
        items: [
          { keys: 'Space', actionKey: 'shortcuts.playPause' },
          { keys: ', / . / J / L', actionKey: 'shortcuts.seek' },
          { keys: '[ / ]', actionKey: 'shortcuts.speed' },
          { keys: '- / =', actionKey: 'shortcuts.speed' },
        ],
      },
      {
        titleKey: 'shortcuts.group.boats',
        items: [
          { keys: '1–9', actionKey: 'shortcuts.focusBoat' },
          { keys: '0 / B', actionKey: 'shortcuts.focusBall' },
          { keys: 'Tab / Shift+Tab', actionKey: 'shortcuts.cycleFocus' },
          { keys: 'V', actionKey: 'shortcuts.vaar' },
          { keys: 'T', actionKey: 'shortcuts.draai' },
          { keys: 'F', actionKey: 'shortcuts.pass' },
          { keys: 'W', actionKey: 'shortcuts.vaarlijn' },
          { keys: 'X / Backspace', actionKey: 'shortcuts.clearRoute' },
        ],
      },
    ];
  }

  function renderShortcutsDialog() {
    var backdrop = document.getElementById('shortcuts-backdrop');
    var body = document.getElementById('shortcuts-body');
    if (!backdrop || !body) return;
    if (!state.shortcutsOpen) {
      backdrop.classList.add('hidden');
      return;
    }
    backdrop.classList.remove('hidden');
    body.innerHTML = '';

    var guideSection = document.createElement('section');
    guideSection.className = 'shortcuts-section help-guide-section';
    var guideHeading = document.createElement('h3');
    guideHeading.textContent = t('help.guide.title');
    guideSection.appendChild(guideHeading);
    var guideIntro = document.createElement('p');
    guideIntro.className = 'help-guide-intro';
    guideIntro.textContent = t('help.guide.intro');
    guideSection.appendChild(guideIntro);
    var guideList = document.createElement('div');
    guideList.className = 'help-guide-list';
    helpGuideItems().forEach(function (item) {
      var article = document.createElement('article');
      article.className = 'help-guide-item';
      var title = document.createElement('h4');
      title.textContent = t(item.titleKey);
      var bodyText = document.createElement('p');
      bodyText.textContent = t(item.bodyKey);
      article.appendChild(title);
      article.appendChild(bodyText);
      guideList.appendChild(article);
    });
    guideSection.appendChild(guideList);
    body.appendChild(guideSection);

    var hotkeysHeading = document.createElement('h3');
    hotkeysHeading.className = 'shortcuts-hotkeys-heading';
    hotkeysHeading.textContent = t('shortcuts.hotkeys');
    body.appendChild(hotkeysHeading);

    shortcutHelpGroups().forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'shortcuts-section';
      var heading = document.createElement('h3');
      heading.textContent = t(group.titleKey);
      section.appendChild(heading);
      var list = document.createElement('dl');
      list.className = 'shortcuts-list';
      group.items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'shortcuts-row';
        var dt = document.createElement('dt');
        item.keys.split(' / ').forEach(function (key, index) {
          if (index > 0) {
            var sep = document.createElement('span');
            sep.className = 'shortcuts-sep';
            sep.textContent = '/';
            dt.appendChild(sep);
          }
          var kbd = document.createElement('kbd');
          kbd.textContent = key;
          dt.appendChild(kbd);
        });
        var dd = document.createElement('dd');
        dd.textContent = t(item.actionKey);
        row.appendChild(dt);
        row.appendChild(dd);
        list.appendChild(row);
      });
      section.appendChild(list);
      body.appendChild(section);
    });
  }

  function canEdit() {
    return !state.isPlaying && !state.playbackMode;
  }

  function transportSpeed() {
    return TRANSPORT_SPEEDS[state.transport.speedIndex] || 1;
  }

  function hasDraftRoutes() {
    return state.tactic.tracks.some(function (track) {
      return track.segments && track.segments.length > 0;
    });
  }

  function hasPlayableSteps() {
    ensureSteps(state.tactic);
    return state.tactic.steps.length > 1;
  }

  function maxRouteEndTime() {
    var max = 0;
    state.tactic.tracks.forEach(function (track) {
      (track.segments || []).forEach(function (segment) {
        if (segment.endTime > max) max = segment.endTime;
      });
    });
    return max;
  }

  function captureDraftRoutes() {
    var routes = {};
    state.tactic.tracks.forEach(function (track) {
      if (track.segments && track.segments.length) {
        routes[track.entityId] = clone(track.segments[0]);
      }
    });
    return routes;
  }

  function buildFallbackRoutes(fromStep, toStep) {
    var routes = {};
    if (!fromStep || !toStep) return routes;
    state.tactic.entities.forEach(function (entity) {
      var startPose = fromStep.poses && fromStep.poses[entity.id];
      var endPose = toStep.poses && toStep.poses[entity.id];
      if (!startPose || !endPose) return;
      if (distanceMeters(startPose, endPose) < 0.05
        && Math.abs((startPose.rotation || 0) - (endPose.rotation || 0)) < 1) {
        return;
      }
      var controls = entity.type === 'boat'
        ? boatRouteControls(
          startPose,
          endPose,
          startPose.rotation,
          endPose.rotation,
          distanceMeters(startPose, endPose) / 3
        )
        : null;
      routes[entity.id] = {
        startTime: 0,
        endTime: 0,
        startPose: clone(startPose),
        endPose: clone(endPose),
        controlOut: controls ? controls.controlOut : null,
        controlIn: controls ? controls.controlIn : null,
      };
    });
    applyRouteDurations(routes);
    return routes;
  }

  function routeSegmentDuration(segment, entity) {
    if (!segment) return 0;
    if ((segment.endTime || 0) > (segment.startTime || 0)) {
      return segment.endTime - (segment.startTime || 0);
    }
    var travelDist = entity && entity.type === 'boat'
      ? segmentTravelDistance(segment)
      : null;
    return entityMoveDuration(segment.startPose, segment.endPose, entity, travelDist);
  }

  function maxDurationOfRoutes(routes) {
    var max = 0;
    if (!routes) return 0;
    // After applyRouteDurations, segment endTimes already include synced arrival
    // and catch-pace extensions. Using those avoids cutting a slow meet-approach
    // short and teleporting the boat to its end pose.
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      var duration = routeSegmentDuration(segment, entity);
      if (duration > max) max = duration;
    });
    return max;
  }

  function normalizeRoutes(routes, stepIndex) {
    var normalized = {};
    if (!routes) return normalized;
    Object.keys(routes).forEach(function (entityId) {
      var segment = clone(routes[entityId]);
      if (!segment) return;
      normalized[entityId] = segment;
    });
    applyRouteDurations(normalized, stepIndex);
    return normalized;
  }

  function buildTransportTimeline() {
    ensureSteps(state.tactic);
    var steps = state.tactic.steps;
    var transitions = [];
    var cursor = 0;
    for (var i = 1; i < steps.length; i++) {
      var rawRoutes = steps[i].routes && Object.keys(steps[i].routes).length
        ? steps[i].routes
        : buildFallbackRoutes(steps[i - 1], steps[i]);
      healRouteStartsFromPrevious(rawRoutes, steps[i - 1], i);
      if (steps[i].routes && Object.keys(steps[i].routes).length) {
        steps[i].routes = rawRoutes;
      }
      var routes = normalizeRoutes(rawRoutes, i);
      var duration = Math.max(0.05, maxDurationOfRoutes(routes));
      transitions.push({
        startTime: cursor,
        endTime: cursor + duration,
        stepIndex: i,
        routes: routes,
        fromPoses: clone(steps[i - 1].poses || {}),
        toPoses: clone(steps[i].poses || {}),
      });
      cursor += duration;
    }
    return { transitions: transitions, duration: cursor };
  }

  function ensureTransportTimeline() {
    var previousDuration = state.transport.duration;
    var previousTime = state.transport.time;
    state.transport.timeline = buildTransportTimeline();
    state.transport.duration = state.transport.timeline.duration;
    if (previousDuration > 0 && state.transport.duration > 0 && previousDuration !== state.transport.duration) {
      state.transport.time = (previousTime / previousDuration) * state.transport.duration;
    }
    if (state.transport.time > state.transport.duration) {
      state.transport.time = state.transport.duration;
    }
    return state.transport.timeline;
  }

  function invalidateTransportTimeline() {
    state.transport.timeline = null;
  }

  function getTransportPoses(time) {
    ensureSteps(state.tactic);
    var timeline = state.transport.timeline || buildTransportTimeline();
    var poses = {};
    var startStep = state.tactic.steps[0];
    state.tactic.entities.forEach(function (entity) {
      if (startStep && startStep.poses && startStep.poses[entity.id]) {
        poses[entity.id] = clone(startStep.poses[entity.id]);
      } else {
        poses[entity.id] = clone(entity.initial);
      }
    });

    if (!timeline.transitions.length) return poses;

    if (time >= timeline.duration) {
      var lastStep = state.tactic.steps[state.tactic.steps.length - 1];
      state.tactic.entities.forEach(function (entity) {
        if (lastStep && lastStep.poses && lastStep.poses[entity.id]) {
          poses[entity.id] = clone(lastStep.poses[entity.id]);
        }
      });
      return poses;
    }

    for (var i = 0; i < timeline.transitions.length; i++) {
      var transition = timeline.transitions[i];
      if (time < transition.startTime) break;

      if (time >= transition.endTime) {
        state.tactic.entities.forEach(function (entity) {
          if (transition.toPoses[entity.id]) {
            poses[entity.id] = clone(transition.toPoses[entity.id]);
          }
        });
        continue;
      }

      var localTime = time - transition.startTime;
      var motionOptsByEntity = {};
      state.tactic.entities.forEach(function (entity) {
        motionOptsByEntity[entity.id] = getEntityMotionOpts(timeline, i, entity.id);
      });
      state.tactic.entities.forEach(function (entity) {
        var segment = transition.routes[entity.id];
        if (!segment) {
          if (transition.fromPoses[entity.id]) {
            poses[entity.id] = clone(transition.fromPoses[entity.id]);
          }
          return;
        }
        var motionOpts = motionOptsByEntity[entity.id];
        var pathT = entity.type === 'ball'
          ? ballSegmentPathProgress(segment, localTime)
          : boatPathProgressAtLocalTime(segment, localTime, entity, motionOpts);
        poses[entity.id] = poseAlongPathProgress(segment, pathT, entity);
      });
      var step = state.tactic.steps[transition.stepIndex];
      applyBallPoseOverrides(
        poses,
        transition.routes,
        localTime,
        step && step.ballHolderId,
        motionOptsByEntity
      );
      break;
    }
    return poses;
  }

  function getTransportStepIndex() {
    var timeline = state.transport.timeline || buildTransportTimeline();
    if (!timeline.transitions.length || state.transport.time <= 0) return 0;
    for (var i = 0; i < timeline.transitions.length; i++) {
      var transition = timeline.transitions[i];
      if (state.transport.time < transition.endTime) return transition.stepIndex;
    }
    return state.tactic.steps.length - 1;
  }

  function getDisplayPoses() {
    if (state.playbackMode) return getTransportPoses(state.transport.time);
    return getPosesAtTime();
  }

  function formatTransportTime(seconds) {
    var total = Math.max(0, Math.floor(seconds + 0.0001));
    var mins = Math.floor(total / 60);
    var secs = total % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function stopTransportRaf() {
    if (state.transport.raf) {
      cancelAnimationFrame(state.transport.raf);
      state.transport.raf = null;
    }
    state.transport.lastFrameAt = null;
  }

  function pauseTransport() {
    state.transport.playing = false;
    stopTransportRaf();
    updateTransportBar();
    ensureConfettiLoop();
  }

  function enterPlaybackMode() {
    if (state.isPlaying || state.playbackMode) return;
    if (!hasPlayableSteps()) {
      setMessage(t('message.noSteps'));
      return;
    }
    exitStartPoseEdit();
    state.stepRename = null;
    state.keyboardFocusEntityId = null;
    ensureTransportTimeline();
    state.playbackMode = true;
    state.transport.time = 0;
    state.transport.playing = false;
    clearPointerInteraction();
    setMessage(t('message.playbackMode'));
    renderAll();
    toggleTransportPlay();
  }

  function exitPlaybackMode() {
    if (!state.playbackMode) return;
    pauseTransport();
    var stepIndex = getTransportStepIndex();
    state.playbackMode = false;
    ensureSteps(state.tactic);
    state.tactic.currentStepIndex = clamp(stepIndex, 0, state.tactic.steps.length - 1);
    applyStepPoses(state.tactic.steps[state.tactic.currentStepIndex]);
    state.currentTime = 0;
    state.transport.time = 0;
    setMessage(t('message.editMode'));
    renderAll();
  }

  function seekTransportToStep(index) {
    ensureTransportTimeline();
    ensureSteps(state.tactic);
    index = clamp(index, 0, state.tactic.steps.length - 1);
    if (index <= 0) {
      state.transport.time = 0;
    } else {
      var transition = state.transport.timeline.transitions[index - 1];
      state.transport.time = transition ? transition.endTime : 0;
    }
    pauseTransport();
    updateTransportBar();
    renderCanvas();
    renderStepsPanel();
  }

  function transportFrame(now) {
    if (!state.playbackMode || !state.transport.playing) return;
    if (state.transport.lastFrameAt == null) state.transport.lastFrameAt = now;
    var dt = (now - state.transport.lastFrameAt) / 1000;
    state.transport.lastFrameAt = now;
    state.transport.time = Math.min(
      state.transport.duration,
      state.transport.time + dt * transportSpeed()
    );
    updateTransportBar();
    renderCanvas();
    renderStepsPanel();

    if (state.transport.time >= state.transport.duration) {
      pauseTransport();
      updateToolbar();
      return;
    }
    state.transport.raf = requestAnimationFrame(transportFrame);
  }

  function toggleTransportPlay() {
    if (!state.playbackMode || state.isPlaying || !hasPlayableSteps()) return;

    if (state.transport.playing) {
      pauseTransport();
      updateToolbar();
      return;
    }

    ensureTransportTimeline();
    if (state.transport.duration <= 0) return;

    if (state.transport.time >= state.transport.duration - 0.001) {
      state.transport.time = 0;
    }

    resetGoalTracking();
    state.transport.playing = true;
    state.transport.lastFrameAt = null;
    updateToolbar();
    updateTransportBar();
    renderStepsPanel();
    state.transport.raf = requestAnimationFrame(transportFrame);
  }

  function seekTransport(ratio) {
    if (!state.playbackMode || state.isPlaying || !hasPlayableSteps()) return;
    ensureTransportTimeline();
    if (state.transport.duration <= 0) return;

    if (state.transport.playing) pauseTransport();

    state.transport.time = clamp(ratio, 0, 1) * state.transport.duration;
    updateTransportBar();
    updateToolbar();
    renderCanvas();
    syncGoalTracking(false);
    renderStepsPanel();
  }

  function changeTransportSpeed(delta) {
    if (!state.playbackMode) return;
    var next = clamp(state.transport.speedIndex + delta, 0, TRANSPORT_SPEEDS.length - 1);
    state.transport.speedIndex = next;
    updateTransportBar();
  }

  function updateTransportBar() {
    var bar = document.getElementById('transport-bar');
    var playBtn = document.getElementById('btn-transport-play');
    var scrubber = document.getElementById('transport-scrubber');
    var timeEl = document.getElementById('transport-time');
    var speedLabel = document.getElementById('transport-speed-label');
    var speedDown = document.getElementById('btn-speed-down');
    var speedUp = document.getElementById('btn-speed-up');
    var iconPlay = document.getElementById('transport-icon-play');
    var iconPause = document.getElementById('transport-icon-pause');
    var editModeBtn = document.getElementById('btn-mode-edit');
    var playModeBtn = document.getElementById('btn-mode-play');
    if (!bar) return;

    var playable = hasPlayableSteps();
    if (editModeBtn) {
      editModeBtn.classList.toggle('is-active', !state.playbackMode);
      editModeBtn.setAttribute('aria-pressed', !state.playbackMode ? 'true' : 'false');
      editModeBtn.disabled = state.isPlaying;
      editModeBtn.title = withShortcut(t('header.edit.title'), 'E');
    }
    if (playModeBtn) {
      playModeBtn.classList.toggle('is-active', state.playbackMode);
      playModeBtn.setAttribute('aria-pressed', state.playbackMode ? 'true' : 'false');
      playModeBtn.disabled = state.isPlaying || (!playable && !state.playbackMode);
      playModeBtn.title = playable
        ? withShortcut(t('header.playback.titleOpen'), 'P')
        : t('header.playback.titleNoSteps');
    }

    bar.classList.toggle('hidden', !state.playbackMode);
    if (!state.playbackMode) return;

    ensureTransportTimeline();

    var duration = state.transport.duration;
    var time = state.transport.time;
    var ratio = duration > 0 ? clamp(time / duration, 0, 1) : 0;

    if (scrubber && !state.transport.scrubbing) {
      scrubber.value = String(Math.round(ratio * 1000));
      scrubber.disabled = !playable;
    }
    if (timeEl) {
      timeEl.textContent = formatTransportTime(time) + ' / ' + formatTransportTime(duration);
    }
    if (speedLabel) speedLabel.textContent = transportSpeed() + '×';
    if (speedDown) {
      speedDown.disabled = !playable;
      speedDown.title = withShortcut(t('transport.slower'), '[ / -');
    }
    if (speedUp) {
      speedUp.disabled = !playable;
      speedUp.title = withShortcut(t('transport.faster'), '] / =');
    }
    if (playBtn) {
      playBtn.disabled = !playable;
      playBtn.title = withShortcut(
        state.transport.playing ? t('transport.pause') : t('transport.play'),
        'Space'
      );
      playBtn.setAttribute('aria-label', playBtn.title);
    }
    if (iconPlay) iconPlay.classList.toggle('hidden', state.transport.playing);
    if (iconPause) iconPause.classList.toggle('hidden', !state.transport.playing);
  }

  function stopPlayback() {
    if (state.playRaf) {
      cancelAnimationFrame(state.playRaf);
      state.playRaf = null;
    }
    state.isPlaying = false;
    ensureConfettiLoop();
  }

  function animateCurrentRoutes(onComplete) {
    recomputeAllSegmentDurations();
    var duration = maxRouteEndTime();
    state.currentTime = 0;
    resetGoalTracking();

    if (duration <= 0) {
      if (onComplete) onComplete();
      return;
    }

    var startedAt = null;
    function frame(now) {
      if (!state.isPlaying) return;
      if (startedAt == null) startedAt = now;
      var elapsed = (now - startedAt) / 1000;
      state.currentTime = Math.min(elapsed, duration);
      renderCanvas();
      if (elapsed >= duration) {
        state.playRaf = null;
        if (onComplete) onComplete();
        return;
      }
      state.playRaf = requestAnimationFrame(frame);
    }
    state.playRaf = requestAnimationFrame(frame);
  }

  function posePositionDelta(newPose, oldPose) {
    if (!newPose || !oldPose) return { dx: 0, dy: 0 };
    return {
      dx: newPose.x - oldPose.x,
      dy: newPose.y - oldPose.y,
    };
  }

  // Pas route-start aan na een gewijzigde eindpositie van de vorige stap.
  // Eindposes en route-einden blijven gelijk; controlOut schuift mee met de start.
  function updateSegmentStartPose(segment, newStart, oldStart) {
    if (!segment || !newStart) return;
    oldStart = oldStart || segment.startPose;
    if (!oldStart) {
      segment.startPose = clone(newStart);
      return;
    }
    var delta = posePositionDelta(newStart, oldStart);
    segment.startPose = clone(newStart);
    if (segment.controlOut) {
      segment.controlOut.x += delta.dx;
      segment.controlOut.y += delta.dy;
    }
  }

  function segmentHasTravel(segment) {
    if (!segment || !segment.startPose || !segment.endPose) return false;
    return distanceMeters(segment.startPose, segment.endPose) >= 0.05
      || Math.abs((segment.startPose.rotation || 0) - (segment.endPose.rotation || 0)) >= 1;
  }

  function updateNextStepRouteStarts(nextStep, prevStep, oldPrevPoses) {
    if (!nextStep || !prevStep) return;
    var routes = nextStep.routes;
    if (!routes || !Object.keys(routes).length) return;
    var newPrevPoses = prevStep.poses || {};
    oldPrevPoses = oldPrevPoses || {};
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment || !segment.startPose) return;
      var oldStart = clone(segment.startPose);
      var newStart;
      if (entityId === 'ball') {
        var holderId = prevStep.ballHolderId;
        if (holderId && newPrevPoses[holderId] && oldPrevPoses[holderId]) {
          var holderDelta = posePositionDelta(newPrevPoses[holderId], oldPrevPoses[holderId]);
          newStart = {
            x: oldStart.x + holderDelta.dx,
            y: oldStart.y + holderDelta.dy,
            rotation: oldStart.rotation || 0,
          };
        } else if (newPrevPoses.ball) {
          newStart = clone(newPrevPoses.ball);
        } else {
          return;
        }
      } else if (newPrevPoses[entityId]) {
        newStart = newPrevPoses[entityId];
      } else {
        return;
      }
      updateSegmentStartPose(segment, newStart, oldStart);
    });
    applyRouteDurations(routes, state.tactic.steps.indexOf(nextStep));
  }

  // Na een gewijzigde eindpositie: start van de volgende stap laten meeschuiven.
  // Boten met een route: alleen startPose (eind blijft). Stilstaande boten: poses
  // meeschuiven en zo nodig verder doorgeven aan latere stappen.
  function propagateStepEndChanges(stepIndex, oldEndPoses) {
    ensureSteps(state.tactic);
    var step = state.tactic.steps[stepIndex];
    var nextStep = state.tactic.steps[stepIndex + 1];
    if (!step || !nextStep) return;

    updateNextStepRouteStarts(nextStep, step, oldEndPoses);

    var newEndPoses = step.poses || {};
    oldEndPoses = oldEndPoses || {};
    if (!nextStep.poses || typeof nextStep.poses !== 'object') nextStep.poses = {};
    var nextOldPoses = clone(nextStep.poses);
    var nextPosesChanged = false;

    state.tactic.entities.forEach(function (entity) {
      var entityId = entity.id;
      var oldPrev = oldEndPoses[entityId];
      var newPrev = newEndPoses[entityId];
      if (!oldPrev || !newPrev) return;
      if (posesApproxEqual(oldPrev, newPrev)) return;

      var route = nextStep.routes && nextStep.routes[entityId];
      if (segmentHasTravel(route)) return;

      var nextPose = nextStep.poses[entityId];
      if (nextPose && !posesApproxEqual(nextPose, oldPrev)) return;
      nextStep.poses[entityId] = clone(newPrev);
      nextPosesChanged = true;
    });

    if (nextStep.ballHolderId && nextStep.poses[nextStep.ballHolderId]) {
      nextStep.poses.ball = clone(nextStep.poses[nextStep.ballHolderId]);
    }

    if (nextPosesChanged) {
      propagateStepEndChanges(stepIndex + 1, nextOldPoses);
    }
  }

  function syncStepPosesFromRoutes(step, routes, startPoses, ballHolderId) {
    var poses = clone(startPoses || {});
    Object.keys(routes || {}).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment || !segment.endPose) return;
      if (entityId === 'ball') return;
      poses[entityId] = clone(segment.endPose);
    });
    if (ballHolderId && poses[ballHolderId]) {
      poses.ball = clone(poses[ballHolderId]);
    } else if (routes && routes.ball && routes.ball.endPose) {
      poses.ball = clone(routes.ball.endPose);
    }
    step.poses = poses;
  }

  function commitPlaybackToNextStep() {
    var reviewing = isReviewingCompletedStep();
    var routes = captureDraftRoutes();
    var prevStep = getCurrentStep();
    var prevHolderId = prevStep && prevStep.ballHolderId;
    var startPoses = captureEntityPoses(state.tactic.entities);
    var endPoses = getPosesAtTime();
    state.tactic.entities.forEach(function (entity) {
      if (!endPoses[entity.id]) return;
      entity.initial = clone(endPoses[entity.id]);
      var track = getTrackForEntity(entity.id);
      track.segments = [];
    });
    state.currentTime = 0;

    ensureSteps(state.tactic);
    var nextHolderId = resolveBallHolderAfterRoutes(routes, prevHolderId);
    if (reviewing) {
      var index = state.tactic.currentStepIndex;
      var step = state.tactic.steps[index];
      var savedName = step ? (step.name || stepNameForIndex(index)) : '';
      if (step) {
        var oldEndPoses = clone(step.poses);
        // Eindposes uit route-einden (betrouwbaarder dan alleen live interpolatie).
        syncStepPosesFromRoutes(step, routes, startPoses, nextHolderId);
        Object.keys(endPoses).forEach(function (entityId) {
          if (entityId === 'ball') return;
          if (routes[entityId]) return;
          if (endPoses[entityId]) step.poses[entityId] = clone(endPoses[entityId]);
        });
        if (nextHolderId && step.poses[nextHolderId]) {
          step.poses.ball = clone(step.poses[nextHolderId]);
        } else if (endPoses.ball) {
          step.poses.ball = clone(endPoses.ball);
        }
        step.routes = routes;
        step.ballHolderId = nextHolderId;
        propagateStepEndChanges(index, oldEndPoses);
      }
      // Save & Next: ga door naar de bestaande volgende stap als die er is.
      var followingIndex = index + 1;
      if (followingIndex < state.tactic.steps.length) {
        state.tactic.currentStepIndex = followingIndex;
        applyStepDiagram(followingIndex);
      }
      state.tactic.updatedAt = new Date().toISOString();
      clearPointerInteraction();
      invalidateTransportTimeline();
      return savedName;
    }

    var nextIndex = state.tactic.currentStepIndex + 1;
    var nextStep = createStep(
      stepNameForIndex(nextIndex),
      captureEntityPoses(state.tactic.entities),
      routes,
      nextHolderId
    );
    state.tactic.steps = state.tactic.steps.slice(0, nextIndex);
    state.tactic.steps.push(nextStep);
    state.tactic.currentStepIndex = nextIndex;
    state.tactic.updatedAt = new Date().toISOString();
    clearPointerInteraction();
    invalidateTransportTimeline();
    return nextStep.name || stepNameForIndex(nextIndex);
  }

  function finishGoPlayback() {
    stopPlayback();
    var savedName = commitPlaybackToNextStep();
    setMessage(t('message.stepSaved', {
      name: savedName || state.tactic.steps[state.tactic.currentStepIndex].name,
    }));
    renderAll();
    ensureConfettiLoop();
  }

  function runGoPlayback() {
    if (!canEdit() || !hasDraftRoutes() || state.startPoseEdit) return;
    if (state.playbackMode) exitPlaybackMode();
    recordHistory();
    state.isPlaying = true;
    clearPointerInteraction();
    updateToolbar();
    renderStepsPanel();
    animateCurrentRoutes(finishGoPlayback);
  }

  function selectStep(index) {
    if (state.isPlaying) return;
    ensureSteps(state.tactic);
    if (index < 0 || index >= state.tactic.steps.length) return;

    if (state.playbackMode) {
      seekTransportToStep(index);
      return;
    }

    if (!canEdit()) return;

    // Al dit stapeindresultaat in beeld: niet opnieuw laden.
    if (index === state.tactic.currentStepIndex && !state.startPoseEdit) {
      if (index > 0 && isReviewingCompletedStep()) return;
      if (hasDraftRoutes()) return;
      if (index === 0) return;
      // Zelfde afgeronde stap zonder drafts: toon opnieuw het diagram.
    }

    if (state.startPoseEdit) exitStartPoseEdit();

    recordHistory();
    state.tactic.currentStepIndex = index;
    applyStepDiagram(index);
    state.currentTime = 0;
    clearPointerInteraction();
    state.tactic.updatedAt = new Date().toISOString();
    setMessage(t('message.stepSelected', { name: state.tactic.steps[index].name }));
    renderAll();
  }

  function beginStepRename(index) {
    if (!canEdit()) return;
    ensureSteps(state.tactic);
    var step = state.tactic.steps[index];
    if (!step) return;
    state.stepRename = {
      index: index,
      value: step.name || stepNameForIndex(index),
    };
    renderStepsPanel();
  }

  function cancelStepRename() {
    if (!state.stepRename) return;
    state.stepRename = null;
    renderStepsPanel();
  }

  function commitStepRename() {
    if (!state.stepRename) return;
    var index = state.stepRename.index;
    var value = String(state.stepRename.value || '').trim();
    state.stepRename = null;
    ensureSteps(state.tactic);
    var step = state.tactic.steps[index];
    if (!step) {
      renderStepsPanel();
      return;
    }
    if (!value) value = stepNameForIndex(index);
    if (value === step.name) {
      renderStepsPanel();
      return;
    }
    recordHistory();
    step.name = value;
    state.tactic.updatedAt = new Date().toISOString();
    setMessage(t('message.stepRenamed', { name: value }));
    renderAll();
  }

  function deleteLastStep() {
    if (!canEdit() || state.isPlaying) return;
    ensureSteps(state.tactic);
    if (state.tactic.steps.length <= 1) return;

    if (state.stepRename) cancelStepRename();
    if (state.startPoseEdit) exitStartPoseEdit();

    var lastIndex = state.tactic.steps.length - 1;
    var deletedStep = state.tactic.steps[lastIndex];
    var deletedName = deletedStep.name || stepNameForIndex(lastIndex);

    recordHistory();
    stopPlayback();
    invalidateTransportTimeline();

    var wasOnLast = state.tactic.currentStepIndex === lastIndex;
    state.tactic.steps.pop();
    if (wasOnLast || state.tactic.currentStepIndex >= state.tactic.steps.length) {
      state.tactic.currentStepIndex = state.tactic.steps.length - 1;
    }

    applyStepDiagram(state.tactic.currentStepIndex);
    state.currentTime = 0;
    clearPointerInteraction();
    state.tactic.updatedAt = new Date().toISOString();
    setMessage(t('message.stepDeleted', { name: deletedName }));
    renderAll();
  }

  function renderStepsPanel() {
    ensureSteps(state.tactic);
    var list = document.getElementById('steps-list');
    var goBtn = document.getElementById('btn-go');
    var hint = document.getElementById('steps-hint');
    if (!list) return;

    var reviewing = isReviewingCompletedStep();
    var drafting = hasDraftRoutes() && !reviewing;
    var previewing = state.playbackMode;
    var editable = canEdit();
    var currentIndex = previewing
      ? getTransportStepIndex()
      : state.tactic.currentStepIndex;
    var renameIndex = state.stepRename ? state.stepRename.index : -1;
    list.innerHTML = '';

    state.tactic.steps.forEach(function (step, index) {
      var item = document.createElement('li');
      item.className = 'steps-list-item';
      var renaming = renameIndex === index;

      if (renaming) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'step-rename-input';
        input.value = state.stepRename.value;
        input.setAttribute('aria-label', t('steps.name.aria'));
        input.maxLength = 40;
        input.addEventListener('input', function () {
          if (state.stepRename && state.stepRename.index === index) {
            state.stepRename.value = input.value;
          }
        });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitStepRename();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelStepRename();
          }
        });
        input.addEventListener('blur', function () {
          setTimeout(function () {
            if (state.stepRename && state.stepRename.index === index) {
              commitStepRename();
            }
          }, 0);
        });
        item.appendChild(input);
      } else {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'step-btn' + (index === currentIndex ? ' is-active' : '');
        btn.textContent = step.name || stepNameForIndex(index);
        btn.disabled = state.isPlaying;
        btn.addEventListener('click', function () {
          selectStep(index);
        });
        item.appendChild(btn);

        if (editable) {
          var renameBtn = document.createElement('button');
          renameBtn.type = 'button';
          renameBtn.className = 'step-rename-btn';
          renameBtn.title = t('steps.rename');
          renameBtn.setAttribute('aria-label', t('steps.rename.aria', { name: step.name || stepNameForIndex(index) }));
          renameBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>' +
            '</svg>';
          renameBtn.addEventListener('mousedown', function (event) {
            event.preventDefault();
          });
          renameBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            if (state.stepRename && state.stepRename.index === index) return;
            if (state.stepRename) commitStepRename();
            beginStepRename(index);
          });
          item.appendChild(renameBtn);
        }

        var isLastStep = index === state.tactic.steps.length - 1;
        if (editable && isLastStep && index > 0) {
          var deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'step-delete-btn';
          deleteBtn.title = t('steps.delete');
          deleteBtn.setAttribute('aria-label', t('steps.delete.aria', { name: step.name || stepNameForIndex(index) }));
          deleteBtn.disabled = state.isPlaying;
          deleteBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' +
            '</svg>';
          deleteBtn.addEventListener('mousedown', function (event) {
            event.preventDefault();
          });
          deleteBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            deleteLastStep();
          });
          item.appendChild(deleteBtn);
        }
      }

      list.appendChild(item);
    });

    if (drafting && !state.isPlaying && !previewing) {
      var draftItem = document.createElement('li');
      draftItem.className = 'steps-list-item';
      var draftBtn = document.createElement('button');
      draftBtn.type = 'button';
      draftBtn.className = 'step-btn is-draft';
      draftBtn.textContent = stepNameForIndex(state.tactic.currentStepIndex + 1) + ' ' + t('steps.draft');
      draftBtn.disabled = true;
      draftItem.appendChild(draftBtn);
      list.appendChild(draftItem);
    }

    if (renameIndex >= 0) {
      var activeInput = list.querySelector('.step-rename-input');
      if (activeInput && document.activeElement !== activeInput) {
        activeInput.focus();
        activeInput.select();
      }
    }

    if (goBtn) {
      goBtn.disabled = !canEdit() || !hasDraftRoutes() || state.startPoseEdit;
      goBtn.textContent = state.isPlaying ? t('steps.go.busy') : t('steps.go');
      goBtn.title = withShortcut(t('steps.go'), 'Space / G');
    }
    if (hint) {
      var hintText = '';
      if (state.startPoseEdit) {
        hintText = t('steps.hint.startEdit');
      } else if (previewing) {
        hintText = state.transport.playing
          ? t('steps.hint.playing')
          : t('steps.hint.playback');
      } else if (state.isPlaying) {
        hintText = t('steps.hint.moving');
      } else if (reviewing) {
        hintText = t('steps.hint.review');
      } else if (drafting) {
        hintText = t('steps.hint.draft');
      }
      hint.textContent = hintText;
      hint.classList.toggle('hidden', !hintText);
    }
    updateTransportBar();
    updateSheetPeekSummary();
  }

  function recordHistory() {
    if (!canEdit()) return;
    state.history.past.push(clone(state.tactic));
    if (state.history.past.length > 50) state.history.past.shift();
    state.history.future = [];
  }

  function clearHistory() {
    state.history.past = [];
    state.history.future = [];
  }

  function restoreTacticKeepingSettings(nextTactic) {
    var settings = clone(state.tactic.settings);
    state.tactic = nextTactic;
    state.tactic.settings = settings;
    applyTeamColors('attack');
    applyTeamColors('defense');
    recomputeAllSegmentDurations();
  }

  function hasStartPosition() {
    return !!(state.tactic.startPositions && Object.keys(state.tactic.startPositions).length);
  }

  function isOnStartStep() {
    ensureSteps(state.tactic);
    return state.tactic.currentStepIndex === 0;
  }

  function updateToolbar() {
    var undoBtn = document.getElementById('btn-undo');
    var redoBtn = document.getElementById('btn-redo');
    var setStartBtn = document.getElementById('btn-set-start');
    var gotoStartBtn = document.getElementById('btn-goto-start');
    var startActions = document.getElementById('start-actions');
    var indicator = document.getElementById('start-indicator');
    var editable = canEdit();
    var onStart = isOnStartStep();
    var editingStart = state.startPoseEdit && onStart;
    if (!onStart && state.startPoseEdit) state.startPoseEdit = false;
    if (undoBtn) {
      undoBtn.disabled = !editable || !state.history.past.length;
      undoBtn.title = withShortcut(t('steps.undo'), modShortcutLabel() + '+Z');
    }
    if (redoBtn) {
      redoBtn.disabled = !editable || !state.history.future.length;
      redoBtn.title = withShortcut(t('steps.redo'), modShortcutLabel() + '+Y');
    }
    if (startActions) startActions.classList.toggle('hidden', !onStart);
    var predefinedBtn = document.getElementById('btn-predefined-flows');
    if (predefinedBtn) {
      predefinedBtn.disabled = !editable || !onStart || editingStart;
      predefinedBtn.title = t('predefined.choose.title');
      var predefinedLabel = predefinedBtn.querySelector('.btn-toolbar-label');
      if (predefinedLabel) predefinedLabel.textContent = t('predefined.choose');
    }
    if (setStartBtn) {
      setStartBtn.disabled = !editable || !onStart;
      setStartBtn.classList.toggle('is-editing', editingStart);
      var label = setStartBtn.querySelector('.btn-toolbar-label');
      if (label) label.textContent = editingStart ? t('steps.lock') : t('steps.setStart');
      setStartBtn.title = withShortcut(
        editingStart ? t('steps.setStart.titleConfirm') : t('steps.setStart.title'),
        'L'
      );
    }
    if (gotoStartBtn) {
      gotoStartBtn.disabled = !editable || editingStart;
      gotoStartBtn.title = withShortcut(t('steps.gotoStart.title'), 'H');
    }
    var resetBtn = document.getElementById('btn-reset-all');
    if (resetBtn) resetBtn.disabled = !editable;
    var importBtn = document.getElementById('btn-import-tactic');
    if (importBtn) {
      importBtn.title = withShortcut(t('settings.import'), modShortcutLabel() + '+O');
    }
    if (indicator) {
      var set = hasStartPosition();
      indicator.classList.toggle('is-set', set);
      indicator.title = set ? t('steps.startSet') : t('steps.startNotSet');
    }
    var shortcutsBtn = document.getElementById('btn-shortcuts');
    if (shortcutsBtn) {
      shortcutsBtn.title = withShortcut(t('shortcuts.help'), '?');
      shortcutsBtn.setAttribute('aria-label', shortcutsBtn.title);
    }
    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.title = withShortcut(t('header.settings'), 'S');
    updateShareButton();
    scheduleShareLinkRefresh();
    renderStepsPanel();
  }

  function undo() {
    if (!canEdit() || !state.history.past.length) return;
    stopPlayback();
    invalidateTransportTimeline();
    state.startPoseEdit = false;
    state.history.future.push(clone(state.tactic));
    restoreTacticKeepingSettings(state.history.past.pop());
    ensureSteps(state.tactic);
    state.currentTime = 0;
    clearPointerInteraction();
    renderAll();
  }

  function redo() {
    if (!canEdit() || !state.history.future.length) return;
    stopPlayback();
    invalidateTransportTimeline();
    state.startPoseEdit = false;
    state.history.past.push(clone(state.tactic));
    restoreTacticKeepingSettings(state.history.future.pop());
    ensureSteps(state.tactic);
    state.currentTime = 0;
    clearPointerInteraction();
    renderAll();
  }

  function enterStartPoseEdit() {
    if (!canEdit() || !isOnStartStep()) return;
    clearPointerInteraction();
    clearDraftRoutes();
    syncCurrentStepPoses();
    state.startPoseEdit = true;
    setMessage(t('message.startEdit'));
    renderAll();
  }

  function exitStartPoseEdit() {
    if (!state.startPoseEdit) return;
    syncCurrentStepPoses();
    state.startPoseEdit = false;
    clearPointerInteraction();
  }

  function confirmStartPoseEdit() {
    if (!canEdit() || !isOnStartStep() || !state.startPoseEdit) return;
    recordHistory();
    clearDraftRoutes();
    var snapshot = captureEntityPoses(state.tactic.entities);
    var holderId = getBallHolderId();
    if (holderId && snapshot[holderId]) {
      snapshot.ball = clone(snapshot[holderId]);
    }
    state.tactic.startPositions = snapshot;
    ensureSteps(state.tactic);
    var oldStartPoses = clone(state.tactic.steps[0].poses);
    state.tactic.steps[0].poses = clone(snapshot);
    state.tactic.steps[0].ballHolderId = holderId;
    propagateStepEndChanges(0, oldStartPoses);
    invalidateTransportTimeline();
    state.tactic.updatedAt = new Date().toISOString();
    state.startPoseEdit = false;
    clearPointerInteraction();
    setMessage(t('message.startSet'));
    renderAll();
  }

  function beginStartPoseRotate(entityId) {
    if (!canEdit() || !state.startPoseEdit || !isOnStartStep()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity || entity.type !== 'boat') return;

    state.tool = {
      mode: 'draai',
      entityId: entityId,
      basePose: clone(entity.initial),
      previewRotation: entity.initial.rotation,
      confirmOnUp: false,
    };
    canvas.classList.add('tool-active');
    setMessage(t('message.startRotate'));
    renderAll();
  }

  function toggleStartPoseEdit() {
    if (!canEdit() || !isOnStartStep()) return;
    if (state.startPoseEdit) confirmStartPoseEdit();
    else enterStartPoseEdit();
  }

  function gotoStartPosition() {
    if (!canEdit() || state.startPoseEdit) return;
    recordHistory();
    ensureSteps(state.tactic);
    var index = state.tactic.currentStepIndex;
    var step = state.tactic.steps[index];
    if (!step) return;
    // Op Start: herstel de vastgezette startpositie als die bestaat.
    if (index === 0 && hasStartPosition()) {
      step.poses = clone(state.tactic.startPositions);
    }
    applyStepPoses(step);
    state.currentTime = 0;
    clearPointerInteraction();
    state.tactic.updatedAt = new Date().toISOString();
    setMessage(t('message.gotoStart'));
    renderAll();
  }

  function resetAll() {
    if (!canEdit()) return;
    if (!window.confirm(t('confirm.resetAll'))) return;
    recordHistory();
    stopPlayback();
    state.startPoseEdit = false;
    if (state.playbackMode) exitPlaybackMode();
    applyFormationReset(state.tactic);
    state.tactic.startPositions = null;
    state.currentTime = 0;
    clearPointerInteraction();
    invalidateTransportTimeline();
    setMessage(t('message.resetAll'));
    renderAll();
  }

  function getSettings() {
    return state.tactic.settings;
  }

  function isHalfField() {
    return getSettings().fieldMode !== 'full';
  }

  function viewSizeMeters() {
    if (isHalfField()) {
      return { width: FIELD_WIDTH, height: HALF_LENGTH };
    }
    return { width: FIELD_LENGTH, height: FIELD_WIDTH };
  }

  function updateFieldScale() {
    var size = viewSizeMeters();
    var wrap = canvas.parentElement;
    var pad = canvasPadding();
    var availW;
    var availH;
    var wrapW = wrap ? wrap.clientWidth : 0;
    var wrapH = wrap ? wrap.clientHeight : 0;
    // Require a real laid-out box; 0×N during first paint collapses CSS max-height:100%.
    if (wrapW >= 32 && wrapH >= 32) {
      availW = wrapW;
      availH = wrapH;
    } else {
      var header = document.querySelector('.header');
      var headerH = header ? header.getBoundingClientRect().height : 48;
      var appPad = isPhoneLayout() ? 8 : 32;
      var peekReserve = getSheetPeekReserve();
      var rail = isPhoneLandscape() ? 104 : 0;
      var sideSteps = isPhoneLandscape() ? 132 : 0;
      availW = Math.max(240, window.innerWidth - rail - sideSteps - (isPhoneLayout() ? 0 : 8));
      availH = Math.max(
        180,
        window.innerHeight - (isPhoneLandscape() ? 0 : headerH) - appPad - peekReserve - getSafeInset('top') - (isPhoneLayout() ? 0 : getSafeInset('bottom'))
      );
    }
    var scaleW = (availW - pad * 2) / size.width;
    var scaleH = (availH - pad * 2) / size.height;
    fieldScale = Math.max(10, Math.min(scaleW, scaleH));
  }

  function metersToCanvas(pose) {
    if (isHalfField()) {
      // (x,y)→(y,x) maps heading θ to 90°−θ (not θ+90).
      return {
        x: canvasPadding() + pose.y * fieldScale,
        y: canvasPadding() + pose.x * fieldScale,
        rotation: 90 - pose.rotation,
      };
    }
    return {
      x: canvasPadding() + pose.x * fieldScale,
      y: canvasPadding() + pose.y * fieldScale,
      rotation: pose.rotation,
    };
  }

  function canvasToMeters(x, y, rotation) {
    if (isHalfField()) {
      return {
        x: (y - canvasPadding()) / fieldScale,
        y: (x - canvasPadding()) / fieldScale,
        rotation: rotation == null ? 0 : rotation,
      };
    }
    return {
      x: (x - canvasPadding()) / fieldScale,
      y: (y - canvasPadding()) / fieldScale,
      rotation: rotation == null ? 0 : rotation,
    };
  }

  function clampPoseToField(pose) {
    var maxX = isHalfField() ? HALF_LENGTH : FIELD_LENGTH;
    return {
      x: clamp(pose.x, 0, maxX),
      y: clamp(pose.y, 0, FIELD_WIDTH),
      rotation: pose.rotation == null ? 0 : pose.rotation,
    };
  }

  function clampPointToField(point) {
    var maxX = isHalfField() ? HALF_LENGTH : FIELD_LENGTH;
    return {
      x: clamp(point.x, 0, maxX),
      y: clamp(point.y, 0, FIELD_WIDTH),
    };
  }

  function pointInField(point) {
    var maxX = isHalfField() ? HALF_LENGTH : FIELD_LENGTH;
    return point.x >= 0 && point.x <= maxX && point.y >= 0 && point.y <= FIELD_WIDTH;
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function kmhToMs(kmh) {
    return Number(kmh) / KMH_PER_MS;
  }

  function distanceMeters(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function angleDeltaDegrees(from, to) {
    var delta = ((to - from + 540) % 360) - 180;
    return Math.abs(delta);
  }

  function travelTime(distance, speed, accel) {
    var v = Math.max(0.1, speed);
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    if (d < 1e-8) return 0;
    var dAccel = (v * v) / (2 * a);
    if (2 * dAccel >= d) return 2 * Math.sqrt(d / a);
    return (2 * v) / a + (d - 2 * dAccel) / v;
  }

  function distanceAtTime(time, distance, speed, accel) {
    var v = Math.max(0.1, speed);
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    if (d < 1e-8 || time <= 0) return 0;
    var total = travelTime(d, v, a);
    if (time >= total) return d;

    var dAccel = (v * v) / (2 * a);
    if (2 * dAccel >= d) {
      var tHalf = total / 2;
      var vPeak = a * tHalf;
      if (time <= tHalf) return 0.5 * a * time * time;
      var tDecel = time - tHalf;
      return d / 2 + vPeak * tDecel - 0.5 * a * tDecel * tDecel;
    }

    var tAccel = v / a;
    var dCruise = d - 2 * dAccel;
    var tCruise = dCruise / v;
    if (time <= tAccel) return 0.5 * a * time * time;
    if (time <= tAccel + tCruise) return dAccel + v * (time - tAccel);
    var t2 = time - tAccel - tCruise;
    return dAccel + dCruise + v * t2 - 0.5 * a * t2 * t2;
  }

  function motionPathProgress(timeProgress, distance, speed, accel) {
    var t = clamp(timeProgress, 0, 1);
    if (t <= 0) return 0;
    if (t >= 1 || distance < 1e-8) return 1;
    var total = travelTime(distance, speed, accel);
    if (total < 1e-8) return 1;
    return clamp(distanceAtTime(t * total, distance, speed, accel) / distance, 0, 1);
  }

  // Hermite-easing: startSlope/endSlope bepalen de snelheid aan begin/einde (0 = stilstand).
  // Bij opeenvolgende stappen sluiten de hellingen aan zodat de boot niet vertraagt en opnieuw versnelt.
  function hermiteProgress(timeProgress, startSlope, endSlope) {
    var t = clamp(timeProgress, 0, 1);
    var t2 = t * t;
    var t3 = t2 * t;
    return (t3 - 2 * t2 + t) * startSlope + (-2 * t3 + 3 * t2) + (t3 - t2) * endSlope;
  }

  function entityHasRouteInTransition(transition, entityId) {
    return !!(transition && transition.routes && transition.routes[entityId]);
  }

  function getEntityMotionOpts(timeline, transitionIndex, entityId) {
    var transitions = timeline.transitions;
    var transition = transitions[transitionIndex];
    if (!entityHasRouteInTransition(transition, entityId)) {
      return { continuesFromPrev: false, continuesToNext: false };
    }
    var continuesFromPrev = transitionIndex > 0
      && entityHasRouteInTransition(transitions[transitionIndex - 1], entityId);
    var continuesToNext = transitionIndex < transitions.length - 1
      && entityHasRouteInTransition(transitions[transitionIndex + 1], entityId);
    return { continuesFromPrev: continuesFromPrev, continuesToNext: continuesToNext };
  }

  function rotationFromTangent(dx, dy, fallback) {
    if (Math.abs(dx) < 1e-8 && Math.abs(dy) < 1e-8) {
      return fallback == null ? 0 : fallback;
    }
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  function getSegmentPath(segment) {
    var p0 = { x: segment.startPose.x, y: segment.startPose.y };
    var p3 = { x: segment.endPose.x, y: segment.endPose.y };
    var controls = resolveRouteControls(segment);
    if (!controls) {
      var mid = midpoint(p0, p3);
      return { p0: p0, p1: mid, p2: mid, p3: p3 };
    }
    return {
      p0: p0,
      p1: { x: controls.controlOut.x, y: controls.controlOut.y },
      p2: { x: controls.controlIn.x, y: controls.controlIn.y },
      p3: p3,
    };
  }

  function hasRouteControls(segment) {
    return !!(segment && (segment.controlOut || segment.controlIn || segment.controlPoint));
  }

  // Oude kwadratische controlPoint → kubische controlOut/controlIn.
  function resolveRouteControls(segment) {
    if (!segment) return null;
    if (segment.controlOut && segment.controlIn) {
      return { controlOut: segment.controlOut, controlIn: segment.controlIn };
    }
    if (!segment.controlPoint) return null;
    var p0 = { x: segment.startPose.x, y: segment.startPose.y };
    var p3 = { x: segment.endPose.x, y: segment.endPose.y };
    var q = segment.controlPoint;
    return {
      controlOut: {
        x: p0.x + (2 / 3) * (q.x - p0.x),
        y: p0.y + (2 / 3) * (q.y - p0.y),
      },
      controlIn: {
        x: p3.x + (2 / 3) * (q.x - p3.x),
        y: p3.y + (2 / 3) * (q.y - p3.y),
      },
    };
  }

  function applyRouteControls(segment, controls) {
    if (!segment || !controls) return;
    segment.controlOut = { x: controls.controlOut.x, y: controls.controlOut.y };
    segment.controlIn = { x: controls.controlIn.x, y: controls.controlIn.y };
    delete segment.controlPoint;
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    var u = 1 - t;
    var uu = u * u;
    var tt = t * t;
    return {
      x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
      y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
    };
  }

  function cubicTangent(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return {
      dx: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      dy: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
    };
  }

  // Punt op de curve (t=0.5) — dichter bij de zichtbare lijn dan de controlepunten.
  function getBendHandlePoint(segment) {
    var path = getSegmentPath(segment);
    return clampPointToField(cubicPoint(path.p0, path.p1, path.p2, path.p3, 0.5));
  }

  function unitFromRotation(rotation) {
    var rad = (rotation * Math.PI) / 180;
    return { x: Math.cos(rad), y: Math.sin(rad) };
  }

  function clampControlScaleForHandle(start, end, controlOut, controlIn, preferredScale) {
    var p0 = { x: start.x, y: start.y };
    var p3 = { x: end.x, y: end.y };
    var outDir = {
      x: controlOut.x - p0.x,
      y: controlOut.y - p0.y,
    };
    var inDir = {
      x: p3.x - controlIn.x,
      y: p3.y - controlIn.y,
    };
    var outLen = Math.hypot(outDir.x, outDir.y) || 1;
    var inLen = Math.hypot(inDir.x, inDir.y) || 1;
    var ux = outDir.x / outLen;
    var uy = outDir.y / outLen;
    var vx = inDir.x / inLen;
    var vy = inDir.y / inLen;

    function handleAt(scale) {
      var p1 = { x: p0.x + scale * ux, y: p0.y + scale * uy };
      var p2 = { x: p3.x - scale * vx, y: p3.y - scale * vy };
      return cubicPoint(p0, p1, p2, p3, 0.5);
    }

    var scale = Math.max(0.05, preferredScale);
    if (pointInField(handleAt(scale))) {
      return {
        controlOut: { x: p0.x + scale * ux, y: p0.y + scale * uy },
        controlIn: { x: p3.x - scale * vx, y: p3.y - scale * vy },
      };
    }

    var lo = 0.05;
    var hi = scale;
    var best = lo;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (pointInField(handleAt(mid))) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return {
      controlOut: { x: p0.x + best * ux, y: p0.y + best * uy },
      controlIn: { x: p3.x - best * vx, y: p3.y - best * vy },
    };
  }

  // Kubische controles met vaste start- en eindhoek.
  function boatRouteControls(start, end, startRotation, endRotation, preferredScale) {
    var dist = distanceMeters(start, end);
    var scale = Math.max(0.05, preferredScale != null ? preferredScale : dist / 3);
    var startU = unitFromRotation(startRotation);

    if (endRotation == null) {
      var roughOut = {
        x: start.x + scale * startU.x,
        y: start.y + scale * startU.y,
      };
      var toEndX = end.x - roughOut.x;
      var toEndY = end.y - roughOut.y;
      var toEndLen = Math.hypot(toEndX, toEndY) || 1;
      var roughIn = {
        x: end.x - scale * (toEndX / toEndLen),
        y: end.y - scale * (toEndY / toEndLen),
      };
      endRotation = arrivalRotation(start, end, roughOut, roughIn, startRotation);
    }

    var endU = unitFromRotation(endRotation);
    return clampControlScaleForHandle(
      start,
      end,
      { x: start.x + scale * startU.x, y: start.y + scale * startU.y },
      { x: end.x - scale * endU.x, y: end.y - scale * endU.y },
      scale
    );
  }

  // Vrije knik-dot: controlOut blijft op de wegvaar-straal, controlIn volgt de sleep.
  function controlsFromBendHandle(start, end, startRotation, existingControls, handle) {
    var startU = unitFromRotation(startRotation);
    var dist = distanceMeters(start, end);
    var mu = dist / 3;
    if (existingControls && existingControls.controlOut) {
      mu = (existingControls.controlOut.x - start.x) * startU.x
        + (existingControls.controlOut.y - start.y) * startU.y;
    }
    mu = Math.max(0.05, mu);
    var controlOut = {
      x: start.x + mu * startU.x,
      y: start.y + mu * startU.y,
    };
    // B(0.5) = (P0 + 3P1 + 3P2 + P3)/8  →  P2 = (8H − P0 − 3P1 − P3)/3
    var controlIn = {
      x: (8 * handle.x - start.x - 3 * controlOut.x - end.x) / 3,
      y: (8 * handle.y - start.y - 3 * controlOut.y - end.y) / 3,
    };
    return { controlOut: controlOut, controlIn: controlIn };
  }

  function poseAlongSegment(segment, t, entity) {
    if (t <= 0) return clone(segment.startPose);
    var path = getSegmentPath(segment);
    var point = cubicPoint(path.p0, path.p1, path.p2, path.p3, t);
    if (entity && entity.type === 'ball') {
      return { x: point.x, y: point.y, rotation: 0 };
    }
    if (t >= 1) return clone(segment.endPose);
    var tangent = cubicTangent(path.p0, path.p1, path.p2, path.p3, t);
    return {
      x: point.x,
      y: point.y,
      rotation: rotationFromTangent(tangent.dx, tangent.dy, segment.startPose.rotation),
    };
  }

  // pathProgress = fractie van de booglengte (0–1), niet de ruwe Bezier-parameter.
  // Bij scheve curves is |B'(t)| aan het eind vaak veel groter; zonder deze mapping
  // lijkt de boot daar te versnellen terwijl de tijd-easing juist afremt.
  function bezierTFromPathProgress(segment, pathProgress) {
    var progress = clamp(pathProgress, 0, 1);
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    var arcData = getSegmentArcData(segment);
    if (arcData.total < 1e-8) return progress;
    return pathProgressAtArcDistance(arcData, progress * arcData.total);
  }

  function poseAlongPathProgress(segment, pathProgress, entity) {
    return poseAlongSegment(segment, bezierTFromPathProgress(segment, pathProgress), entity);
  }

  function arcDistanceFromPathProgress(arcData, pathProgress) {
    return clamp(pathProgress, 0, 1) * (arcData.total || 0);
  }

  function arrivalRotation(start, end, controlOut, controlIn, fallbackRotation) {
    var p0 = { x: start.x, y: start.y };
    var p3 = { x: end.x, y: end.y };
    var p1 = controlOut ? { x: controlOut.x, y: controlOut.y } : midpoint(p0, p3);
    var p2 = controlIn ? { x: controlIn.x, y: controlIn.y } : midpoint(p0, p3);
    var tangent = cubicTangent(p0, p1, p2, p3, 1);
    return rotationFromTangent(tangent.dx, tangent.dy, fallbackRotation);
  }

  function getSegmentArcData(segment) {
    var path = getSegmentPath(segment);
    var table = [{ t: 0, distance: 0 }];
    var total = 0;
    var prev = { x: path.p0.x, y: path.p0.y };
    for (var i = 1; i <= ARC_SAMPLES; i++) {
      var t = i / ARC_SAMPLES;
      var pt = cubicPoint(path.p0, path.p1, path.p2, path.p3, t);
      total += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      table.push({ t: t, distance: total });
      prev = pt;
    }
    return { table: table, total: total };
  }

  function poseAtArcDistance(segment, distance, arcData) {
    arcData = arcData || getSegmentArcData(segment);
    distance = clamp(distance, 0, arcData.total);
    if (distance <= 0) return clone(segment.startPose);
    if (distance >= arcData.total) return clone(segment.endPose);
    var table = arcData.table;
    for (var i = 1; i < table.length; i++) {
      if (table[i].distance >= distance) {
        var prev = table[i - 1];
        var curr = table[i];
        var span = curr.distance - prev.distance;
        var frac = span <= 1e-8 ? 0 : (distance - prev.distance) / span;
        var t = prev.t + frac * (curr.t - prev.t);
        var point = poseAlongSegment(segment, t, null);
        return { x: point.x, y: point.y, rotation: 0 };
      }
    }
    return clone(segment.endPose);
  }

  function arcDistanceAtProgress(arcData, progress) {
    progress = clamp(progress, 0, 1);
    if (progress <= 0) return 0;
    if (progress >= 1) return arcData.total;
    var table = arcData.table;
    for (var i = 1; i < table.length; i++) {
      if (table[i].t >= progress) {
        var prev = table[i - 1];
        var curr = table[i];
        var span = curr.t - prev.t;
        var frac = span <= 1e-8 ? 0 : (progress - prev.t) / span;
        return prev.distance + frac * (curr.distance - prev.distance);
      }
    }
    return arcData.total;
  }

  function getDribbleThrowDistance(boatSegment) {
    var fallback = kmhToMs(getSettings().boatSpeed) * DRIBBLE_AHEAD_SECONDS;
    if (!boatSegment) return fallback;
    if (hasBoatCatchPace(boatSegment)) {
      // Na de vangst vaart de speler op normaal tempo.
      return fallback;
    }
    var motionDuration = Math.max(0, (boatSegment.endTime || 0) - (boatSegment.startTime || 0));
    if (motionDuration <= 1e-6) return fallback;
    var pathLength = getSegmentArcData(boatSegment).total;
    if (pathLength <= 1e-6) return fallback;
    // Afstand ≈ DRIBBLE_AHEAD_SECONDS varen op het staptempo van deze route.
    return (pathLength / motionDuration) * DRIBBLE_AHEAD_SECONDS;
  }

  // Laatste volle landings-arc; daarna alleen meenemen (rest < throwDistance).
  function getDribbleDriveStart(pathLength, throwDistance) {
    if (throwDistance <= 1e-6 || pathLength <= throwDistance) return 0;
    return Math.floor(pathLength / throwDistance + 1e-9) * throwDistance;
  }

  function getDribbleStartArcForEntity(entityId, boatSegment) {
    boatSegment = boatSegment || getPrimarySegment(entityId);
    if (!entityId || !boatSegment) return null;

    var ballSeg = getPrimarySegment('ball');
    if (ballSeg && ballSeg.syncToEntityId === entityId) {
      if (ballSeg.syncPathProgress != null) {
        refreshRoutePassArcDistance(ballSeg, boatSegment);
      }
      if (ballSeg.syncArcDistance != null) {
        return ballSeg.syncArcDistance;
      }
    }

    if (boatSegment.claimsBall && (!ballSeg || isFreeBallRoute(ballSeg))) {
      return boatSegment.claimArcDistance != null ? boatSegment.claimArcDistance : 0;
    }

    if (getBallHolderId() === entityId && isDribbleActive(entityId)) {
      return 0;
    }

    return null;
  }

  function clearBoatCatchPace(segment) {
    if (!segment) return;
    delete segment.catchMeetArc;
    delete segment.catchMeetTime;
    delete segment.catchAfterDuration;
    delete segment.catchApproachSpeed;
    delete segment.catchEntrySpeed;
    delete segment.catchContinuesToNext;
  }

  function hasBoatCatchPace(segment) {
    return !!(segment
      && segment.catchMeetTime != null
      && segment.catchMeetArc != null);
  }

  // Aanloop met beginsnelheid: accel/decel naar cruise, geen eindstop (bal vangen met vaart).
  function travelTimeNoDecelFromSpeed(distance, v0, vCruise, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    v0 = Math.max(0, v0);
    vCruise = Math.max(0.1, vCruise);
    if (d < 1e-8) return 0;

    if (Math.abs(v0 - vCruise) <= 1e-8) return d / vCruise;

    if (v0 < vCruise) {
      var dAccel = (vCruise * vCruise - v0 * v0) / (2 * a);
      if (dAccel >= d - 1e-8) {
        var vPeak = Math.sqrt(Math.max(0, v0 * v0 + 2 * a * d));
        return (vPeak - v0) / a;
      }
      return (vCruise - v0) / a + (d - dAccel) / vCruise;
    }

    var dDecel = (v0 * v0 - vCruise * vCruise) / (2 * a);
    if (dDecel >= d - 1e-8) {
      var vf = Math.sqrt(Math.max(0, v0 * v0 - 2 * a * d));
      return (v0 - vf) / a;
    }
    return (v0 - vCruise) / a + (d - dDecel) / vCruise;
  }

  function distanceAtTimeNoDecelFromSpeed(time, distance, v0, vCruise, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    v0 = Math.max(0, v0);
    vCruise = Math.max(0.1, vCruise);
    if (d < 1e-8 || time <= 0) return 0;
    var total = travelTimeNoDecelFromSpeed(d, v0, vCruise, a);
    if (time >= total) return d;

    if (Math.abs(v0 - vCruise) <= 1e-8) return Math.min(d, v0 * time);

    if (v0 < vCruise) {
      var dAccel = (vCruise * vCruise - v0 * v0) / (2 * a);
      var tAccel = (vCruise - v0) / a;
      if (dAccel >= d - 1e-8) {
        return Math.min(d, v0 * time + 0.5 * a * time * time);
      }
      if (time <= tAccel) return v0 * time + 0.5 * a * time * time;
      return dAccel + vCruise * (time - tAccel);
    }

    var dDecel = (v0 * v0 - vCruise * vCruise) / (2 * a);
    var tDecel = (v0 - vCruise) / a;
    if (dDecel >= d - 1e-8) {
      return Math.min(d, v0 * time - 0.5 * a * time * time);
    }
    if (time <= tDecel) return v0 * time - 0.5 * a * time * time;
    return dDecel + vCruise * (time - tDecel);
  }

  function timeToCoverDistanceNoDecelFromSpeed(pathDistance, coverDistance, v0, vCruise, accel) {
    var path = Math.max(0, pathDistance);
    var cover = clamp(coverDistance, 0, path);
    if (cover <= 1e-8) return 0;
    if (path < 1e-8 || cover >= path - 1e-8) {
      return travelTimeNoDecelFromSpeed(path, v0, vCruise, accel);
    }
    var total = travelTimeNoDecelFromSpeed(path, v0, vCruise, accel);
    var low = 0;
    var high = total;
    var i;
    for (i = 0; i < 24; i++) {
      var mid = (low + high) / 2;
      if (distanceAtTimeNoDecelFromSpeed(mid, path, v0, vCruise, accel) < cover) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  // Zoek cruise zodat travelTimeNoDecelFromSpeed(d, v0, cruise, a) ≈ desiredTime.
  function cruiseSpeedForTravelTimeNoDecelFromSpeed(distance, desiredTime, v0, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    var t = Math.max(0.01, desiredTime);
    v0 = Math.max(0, v0);
    if (d < 1e-8) return 0.1;
    if (v0 < 1e-8) return cruiseSpeedForTravelTimeNoDecel(d, t, a);

    // Snelste: accel oneindig hard (praktisch: hoge cruise).
    var minTime = travelTimeNoDecelFromSpeed(d, v0, Math.max(v0 * 4, d / Math.max(0.05, t) * 2), a);
    // Conservatiever: min tijd met cruise ≥ v0 (niet sneller dan nodig zoeken via binary).
    var highFast = Math.max(v0, (2 * d) / t, 1);
    var expand;
    for (expand = 0; expand < 16; expand++) {
      if (travelTimeNoDecelFromSpeed(d, v0, highFast, a) <= t) break;
      highFast *= 2;
    }
    minTime = travelTimeNoDecelFromSpeed(d, v0, highFast, a);
    if (t <= minTime + 1e-6) return Math.max(0.1, highFast);

    var low = 0.05;
    var high = highFast;
    var i;
    for (i = 0; i < 32; i++) {
      var mid = (low + high) / 2;
      if (travelTimeNoDecelFromSpeed(d, v0, mid, a) > t) low = mid;
      else high = mid;
    }
    return Math.max(0.05, high);
  }

  function entityContinuesFromPreviousStep(entityId, stepIndex) {
    ensureSteps(state.tactic);
    if (stepIndex == null) stepIndex = state.tactic.currentStepIndex;
    if (!entityId || stepIndex <= 0) return false;
    var prev = state.tactic.steps[stepIndex - 1];
    return !!(prev && prev.routes && prev.routes[entityId]);
  }

  function entityContinuesToNextStep(entityId, stepIndex) {
    ensureSteps(state.tactic);
    if (stepIndex == null) stepIndex = state.tactic.currentStepIndex;
    if (!entityId || stepIndex < 0) return false;
    var next = state.tactic.steps[stepIndex + 1];
    return !!(next && next.routes && next.routes[entityId]);
  }

  function catchEntrySpeedForEntity(entityId, stepIndex) {
    if (!entityContinuesFromPreviousStep(entityId, stepIndex)) return 0;
    return Math.max(0.1, kmhToMs(getSettings().boatSpeed));
  }

  // Als een boot doorvaart naar de volgende stap, niet vroeg stilzetten terwijl
  // bijv. de bal de stap nog verlengt — rek de bootbeweging op tot de stapduur.
  function stretchContinuingBoatDurations(routes, stepIndex) {
    if (!routes) return;
    var stepMax = 0;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var end = segment.endTime || 0;
      if (end > stepMax) stepMax = end;
    });
    if (stepMax <= 0) return;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment || hasBoatCatchPace(segment)) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity || entity.type !== 'boat') return;
      if (!entityContinuesToNextStep(entityId, stepIndex)) return;
      if ((segment.endTime || 0) < stepMax - 1e-6) {
        segment.endTime = stepMax;
      }
    });
  }

  // Na catch-pace of stretch: alle boten weer op dezelfde eindtijd (sync arrival).
  function resyncSyncedBoatArrivals(routes) {
    if (!routes || !isBoatSpeedSyncArrival()) return;
    var stepMax = 0;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity || entity.type !== 'boat') return;
      var end = segment.endTime || 0;
      if (end > stepMax) stepMax = end;
    });
    if (stepMax <= 0) return;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity || entity.type !== 'boat') return;
      if ((segment.endTime || 0) >= stepMax - 1e-6) return;
      segment.endTime = stepMax;
      if (hasBoatCatchPace(segment)) {
        var meetTime = Math.max(0, segment.catchMeetTime || 0);
        segment.catchAfterDuration = Math.max(
          0,
          stepMax - (segment.startTime || 0) - meetTime
        );
      }
    });
  }

  function earliestBoatMeetTime(meetArc, speed, accel, entrySpeed) {
    if (meetArc < 1e-8) return 0;
    entrySpeed = Math.max(0, entrySpeed || 0);
    if (entrySpeed > 1e-6) {
      return Math.max(0.25, travelTimeNoDecelFromSpeed(meetArc, entrySpeed, speed, accel));
    }
    return Math.max(0.25, travelTimeNoDecel(meetArc, speed, accel));
  }

  function applyBoatCatchPace(segment, meetArc, meetTime, entrySpeed, continuesToNext) {
    if (!segment) return;
    var arcData = getSegmentArcData(segment);
    var meet = meetArc == null ? arcData.total : clamp(meetArc, 0, arcData.total);
    var settings = getSettings();
    var accel = kmhToMs(settings.boatAcceleration);
    var normalSpeed = Math.max(0.1, kmhToMs(settings.boatSpeed));
    entrySpeed = Math.max(0, entrySpeed || 0);
    continuesToNext = !!continuesToNext;
    // Nooit sneller plannen dan met beginsnelheid + normale cruise haalbaar is.
    var arriveAt = Math.max(
      0.25,
      meetTime,
      earliestBoatMeetTime(meet, normalSpeed, accel, entrySpeed)
    );
    var remaining = Math.max(0, arcData.total - meet);
    var approachSpeed = 0;
    if (meet >= 1e-8) {
      approachSpeed = entrySpeed > 1e-6
        ? cruiseSpeedForTravelTimeNoDecelFromSpeed(meet, arriveAt, entrySpeed, accel)
        : cruiseSpeedForTravelTimeNoDecel(meet, arriveAt, accel);
      arriveAt = Math.max(
        arriveAt,
        entrySpeed > 1e-6
          ? travelTimeNoDecelFromSpeed(meet, entrySpeed, approachSpeed, accel)
          : travelTimeNoDecel(meet, approachSpeed, accel)
      );
    }
    // Doorvaart naar volgende stap: na de vangst niet afremmen naar stilstand.
    var afterDuration = remaining < 1e-8
      ? 0
      : Math.max(0.01, continuesToNext
        ? travelTimeNoDecelFromSpeed(remaining, approachSpeed, normalSpeed, accel)
        : travelTimeFromSpeed(remaining, approachSpeed, normalSpeed, accel));

    clearBoatCatchPace(segment);
    segment.catchMeetArc = meet;
    segment.catchMeetTime = arriveAt;
    segment.catchApproachSpeed = approachSpeed;
    segment.catchEntrySpeed = entrySpeed;
    segment.catchAfterDuration = afterDuration;
    segment.catchContinuesToNext = continuesToNext;
    segment.endTime = (segment.startTime || 0) + arriveAt + afterDuration;
  }

  // Als sync arrival de after-fase oprekt: trager varen i.p.v. vroeg aankomen en wachten.
  function catchAfterPhaseSpeed(remaining, afterDuration, approachSpeed, normalSpeed, accel, continuesToNext) {
    remaining = Math.max(0, remaining);
    afterDuration = Math.max(0, afterDuration);
    approachSpeed = Math.max(0, approachSpeed);
    normalSpeed = Math.max(0.1, normalSpeed);
    accel = Math.max(0.1, accel);
    if (remaining < 1e-8 || afterDuration <= 0) return normalSpeed;

    var natural = continuesToNext
      ? travelTimeNoDecelFromSpeed(remaining, approachSpeed, normalSpeed, accel)
      : travelTimeFromSpeed(remaining, approachSpeed, normalSpeed, accel);
    if (afterDuration <= natural + 1e-6) return normalSpeed;

    if (continuesToNext) {
      return cruiseSpeedForTravelTimeNoDecelFromSpeed(
        remaining,
        afterDuration,
        approachSpeed,
        accel
      );
    }

    // Met eindstop: zoek lagere cruise zodat travelTimeFromSpeed ≈ afterDuration.
    var low = 0.05;
    var high = normalSpeed;
    var i;
    for (i = 0; i < 32; i++) {
      var mid = (low + high) / 2;
      if (travelTimeFromSpeed(remaining, approachSpeed, mid, accel) > afterDuration) high = mid;
      else low = mid;
    }
    return Math.max(0.05, high);
  }

  function boatCatchPacePathProgress(segment, localTime) {
    var arcData = getSegmentArcData(segment);
    var meetArc = clamp(segment.catchMeetArc, 0, arcData.total);
    var meetTime = Math.max(0.01, segment.catchMeetTime);
    var afterDuration = Math.max(0, segment.catchAfterDuration || 0);
    var continuesToNext = !!segment.catchContinuesToNext;
    var settings = getSettings();
    var accel = kmhToMs(settings.boatAcceleration);
    var normalSpeed = Math.max(0.1, kmhToMs(settings.boatSpeed));
    var entrySpeed = Math.max(0, segment.catchEntrySpeed || 0);
    var approachSpeed = segment.catchApproachSpeed != null
      ? segment.catchApproachSpeed
      : (entrySpeed > 1e-6
        ? cruiseSpeedForTravelTimeNoDecelFromSpeed(meetArc, meetTime, entrySpeed, accel)
        : cruiseSpeedForTravelTimeNoDecel(meetArc, meetTime, accel));
    var boatArc;

    if (localTime <= meetTime) {
      if (meetArc < 1e-8) {
        boatArc = 0;
      } else if (entrySpeed > 1e-6) {
        boatArc = distanceAtTimeNoDecelFromSpeed(
          clamp(localTime, 0, meetTime),
          meetArc,
          entrySpeed,
          approachSpeed,
          accel
        );
      } else {
        boatArc = distanceAtTimeNoDecel(
          clamp(localTime, 0, meetTime),
          meetArc,
          approachSpeed,
          accel
        );
      }
    } else {
      var remaining = Math.max(0, arcData.total - meetArc);
      if (remaining < 1e-8 || afterDuration <= 0) {
        boatArc = arcData.total;
      } else {
        var afterTime = Math.min(Math.max(0, localTime - meetTime), afterDuration);
        var afterSpeed = catchAfterPhaseSpeed(
          remaining,
          afterDuration,
          approachSpeed,
          normalSpeed,
          accel,
          continuesToNext
        );
        var covered = continuesToNext
          ? distanceAtTimeNoDecelFromSpeed(
            afterTime,
            remaining,
            approachSpeed,
            afterSpeed,
            accel
          )
          : distanceAtTimeFromSpeed(
            afterTime,
            remaining,
            approachSpeed,
            afterSpeed,
            accel
          );
        boatArc = meetArc + covered;
      }
    }

    return clamp(boatArc / Math.max(1e-8, arcData.total), 0, 1);
  }

  function pathProgressAtArcDistance(arcData, targetArc) {
    targetArc = clamp(targetArc, 0, arcData.total);
    if (targetArc <= 0) return 0;
    if (targetArc >= arcData.total - 1e-8) return 1;
    var low = 0;
    var high = 1;
    for (var i = 0; i < 24; i++) {
      var mid = (low + high) / 2;
      if (arcDistanceAtProgress(arcData, mid) < targetArc) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  // Aanloop zonder einddeceleratie: versnellen, daarna cruise (bal ontvangen met snelheid).
  function travelTimeNoDecel(distance, speed, accel) {
    var v = Math.max(0.1, speed);
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    if (d < 1e-8) return 0;
    var dAccel = (v * v) / (2 * a);
    if (dAccel >= d) return Math.sqrt((2 * d) / a);
    return (v / a) + (d - dAccel) / v;
  }

  function distanceAtTimeNoDecel(time, distance, speed, accel) {
    var v = Math.max(0.1, speed);
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    if (d < 1e-8 || time <= 0) return 0;
    var tAccel = v / a;
    var dAccel = 0.5 * a * tAccel * tAccel;
    if (dAccel >= d) {
      var tAll = Math.sqrt((2 * d) / a);
      if (time >= tAll) return d;
      return 0.5 * a * time * time;
    }
    if (time <= tAccel) return 0.5 * a * time * time;
    return Math.min(d, dAccel + v * (time - tAccel));
  }

  // Zoek cruise-snelheid zodat travelTimeNoDecel(distance, speed, accel) ≈ desiredTime.
  // Als desiredTime korter is dan accel-only vanaf stilstand, geef de snelheid voor
  // die minimale tijd terug (caller moet arriveAt hierop clampen).
  function cruiseSpeedForTravelTimeNoDecel(distance, desiredTime, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    var t = Math.max(0.01, desiredTime);
    if (d < 1e-8) return 0.1;

    var minAccelOnlyTime = Math.sqrt((2 * d) / a);
    if (t <= minAccelOnlyTime + 1e-6) {
      // v_peak bij accel over hele afstand: v² = 2·a·d
      return Math.max(0.1, Math.sqrt(Math.max(0.1, 2 * a * d)));
    }

    var low = 0.05;
    var high = Math.max(1, (2 * d) / t);
    var expand;
    for (expand = 0; expand < 16; expand++) {
      if (travelTimeNoDecel(d, high, a) <= t) break;
      high *= 2;
    }

    var i;
    for (i = 0; i < 32; i++) {
      var mid = (low + high) / 2;
      if (travelTimeNoDecel(d, mid, a) > t) low = mid;
      else high = mid;
    }
    return Math.max(0.05, high);
  }

  function timeToCoverDistanceNoDecel(pathDistance, coverDistance, speed, accel) {
    var path = Math.max(0, pathDistance);
    var cover = clamp(coverDistance, 0, path);
    if (cover <= 1e-8) return 0;
    if (path < 1e-8 || cover >= path - 1e-8) {
      return travelTimeNoDecel(path, speed, accel);
    }
    var total = travelTimeNoDecel(path, speed, accel);
    var low = 0;
    var high = total;
    var i;
    for (i = 0; i < 24; i++) {
      var mid = (low + high) / 2;
      if (distanceAtTimeNoDecel(mid, path, speed, accel) < cover) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  // Na de vangst: start met v0, accel naar vMax, cruise, deceleratie naar stilstand.
  function travelTimeFromSpeed(distance, v0, vMax, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    v0 = Math.max(0, v0);
    vMax = Math.max(0.1, vMax);
    if (d < 1e-8) return 0;

    if (v0 > vMax + 1e-8) {
      var dStopFromV0 = (v0 * v0) / (2 * a);
      if (dStopFromV0 >= d - 1e-8) {
        var vfFast = Math.sqrt(Math.max(0, v0 * v0 - 2 * a * d));
        return (v0 - vfFast) / a;
      }
      var dDecelToMax = (v0 * v0 - vMax * vMax) / (2 * a);
      var dDecelEndFast = (vMax * vMax) / (2 * a);
      var dCruiseFast = d - dDecelToMax - dDecelEndFast;
      if (dCruiseFast < 0) {
        var vfOnly = Math.sqrt(Math.max(0, v0 * v0 - 2 * a * d));
        return (v0 - vfOnly) / a;
      }
      return (v0 - vMax) / a + dCruiseFast / vMax + vMax / a;
    }

    var dAccel = (vMax * vMax - v0 * v0) / (2 * a);
    var dDecel = (vMax * vMax) / (2 * a);
    if (dAccel + dDecel <= d + 1e-8) {
      return (vMax - v0) / a + (d - dAccel - dDecel) / vMax + vMax / a;
    }

    var vPeak2 = a * d + (v0 * v0) / 2;
    if (vPeak2 <= v0 * v0 + 1e-8) {
      var vfShort = Math.sqrt(Math.max(0, v0 * v0 - 2 * a * d));
      return (v0 - vfShort) / a;
    }
    var vPeak = Math.sqrt(vPeak2);
    return (vPeak - v0) / a + vPeak / a;
  }

  function distanceAtTimeFromSpeed(time, distance, v0, vMax, accel) {
    var a = Math.max(0.1, accel);
    var d = Math.max(0, distance);
    v0 = Math.max(0, v0);
    vMax = Math.max(0.1, vMax);
    if (d < 1e-8 || time <= 0) return 0;
    var total = travelTimeFromSpeed(d, v0, vMax, a);
    if (time >= total) return d;

    if (v0 > vMax + 1e-8) {
      var dStopFromV0 = (v0 * v0) / (2 * a);
      if (dStopFromV0 >= d - 1e-8) {
        return Math.min(d, v0 * time - 0.5 * a * time * time);
      }
      var dDecelToMax = (v0 * v0 - vMax * vMax) / (2 * a);
      var dDecelEndFast = (vMax * vMax) / (2 * a);
      var dCruiseFast = d - dDecelToMax - dDecelEndFast;
      if (dCruiseFast < 0) {
        return Math.min(d, v0 * time - 0.5 * a * time * time);
      }
      var tDown = (v0 - vMax) / a;
      var tCruiseFast = dCruiseFast / vMax;
      if (time <= tDown) return v0 * time - 0.5 * a * time * time;
      if (time <= tDown + tCruiseFast) return dDecelToMax + vMax * (time - tDown);
      var tdFast = time - tDown - tCruiseFast;
      return dDecelToMax + dCruiseFast + vMax * tdFast - 0.5 * a * tdFast * tdFast;
    }

    var dAccel = (vMax * vMax - v0 * v0) / (2 * a);
    var dDecel = (vMax * vMax) / (2 * a);
    if (dAccel + dDecel <= d + 1e-8) {
      var dCruise = d - dAccel - dDecel;
      var tAccel = (vMax - v0) / a;
      var tCruise = dCruise / vMax;
      if (time <= tAccel) return v0 * time + 0.5 * a * time * time;
      if (time <= tAccel + tCruise) return dAccel + vMax * (time - tAccel);
      var tDecel = time - tAccel - tCruise;
      return dAccel + dCruise + vMax * tDecel - 0.5 * a * tDecel * tDecel;
    }

    var vPeak2 = a * d + (v0 * v0) / 2;
    if (vPeak2 <= v0 * v0 + 1e-8) {
      return Math.min(d, v0 * time - 0.5 * a * time * time);
    }
    var vPeak = Math.sqrt(vPeak2);
    var tUp = (vPeak - v0) / a;
    var dUp = (vPeak * vPeak - v0 * v0) / (2 * a);
    if (time <= tUp) return v0 * time + 0.5 * a * time * time;
    var tDownPeak = time - tUp;
    return dUp + vPeak * tDownPeak - 0.5 * a * tDownPeak * tDownPeak;
  }

  function timeToCoverDistanceFromSpeed(pathDistance, coverDistance, v0, vMax, accel) {
    var path = Math.max(0, pathDistance);
    var cover = clamp(coverDistance, 0, path);
    if (cover <= 1e-8) return 0;
    if (path < 1e-8 || cover >= path - 1e-8) {
      return travelTimeFromSpeed(path, v0, vMax, accel);
    }
    var total = travelTimeFromSpeed(path, v0, vMax, accel);
    var low = 0;
    var high = total;
    var i;
    for (i = 0; i < 24; i++) {
      var mid = (low + high) / 2;
      if (distanceAtTimeFromSpeed(mid, path, v0, vMax, accel) < cover) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  function boatPathProgressAtLocalTime(segment, localTime, entity, motionOpts) {
    if (hasBoatCatchPace(segment)) {
      return boatCatchPacePathProgress(segment, localTime);
    }
    var duration = Math.max(0, (segment.endTime || 0) - (segment.startTime || 0));
    var timeProgress = duration <= 0 ? 1 : clamp(localTime / duration, 0, 1);
    return segmentPathProgress(segment, timeProgress, entity, motionOpts);
  }

  function localTimeAtArcDistanceCatchPace(segment, targetArc) {
    var arcData = getSegmentArcData(segment);
    targetArc = clamp(targetArc, 0, arcData.total);
    var meetArc = clamp(segment.catchMeetArc, 0, arcData.total);
    var meetTime = Math.max(0.01, segment.catchMeetTime);
    var afterDuration = Math.max(0, segment.catchAfterDuration || 0);
    var settings = getSettings();
    var accel = kmhToMs(settings.boatAcceleration);
    var normalSpeed = Math.max(0.1, kmhToMs(settings.boatSpeed));
    var entrySpeed = Math.max(0, segment.catchEntrySpeed || 0);
    var approachSpeed = segment.catchApproachSpeed != null
      ? segment.catchApproachSpeed
      : (entrySpeed > 1e-6
        ? cruiseSpeedForTravelTimeNoDecelFromSpeed(meetArc, meetTime, entrySpeed, accel)
        : cruiseSpeedForTravelTimeNoDecel(meetArc, meetTime, accel));

    if (targetArc <= 0) return 0;
    if (targetArc >= arcData.total - 1e-8) {
      return meetTime + afterDuration;
    }

    if (targetArc <= meetArc + 1e-8) {
      if (meetArc < 1e-8) return 0;
      if (entrySpeed > 1e-6) {
        return timeToCoverDistanceNoDecelFromSpeed(
          meetArc,
          targetArc,
          entrySpeed,
          approachSpeed,
          accel
        );
      }
      return timeToCoverDistanceNoDecel(meetArc, targetArc, approachSpeed, accel);
    }

    var remaining = Math.max(0, arcData.total - meetArc);
    var need = targetArc - meetArc;
    if (remaining < 1e-8) return meetTime;
    var afterSpeed = catchAfterPhaseSpeed(
      remaining,
      afterDuration,
      approachSpeed,
      normalSpeed,
      accel,
      !!segment.catchContinuesToNext
    );
    if (segment.catchContinuesToNext) {
      return meetTime + timeToCoverDistanceNoDecelFromSpeed(
        remaining,
        need,
        approachSpeed,
        afterSpeed,
        accel
      );
    }
    return meetTime + timeToCoverDistanceFromSpeed(
      remaining,
      need,
      approachSpeed,
      afterSpeed,
      accel
    );
  }

  function localTimeAtArcDistance(segment, targetArc, entity, motionOpts, segmentEndTime) {
    if (hasBoatCatchPace(segment)) {
      return localTimeAtArcDistanceCatchPace(segment, targetArc);
    }

    var duration = segmentEndTime != null
      ? Math.max(0, segmentEndTime)
      : Math.max(0, (segment.endTime || 0) - (segment.startTime || 0));
    if (targetArc <= 0 || duration <= 0) return 0;
    var arcData = getSegmentArcData(segment);
    targetArc = Math.min(targetArc, arcData.total);
    if (targetArc >= arcData.total) return duration;

    var low = 0;
    var high = 1;
    for (var i = 0; i < 24; i++) {
      var mid = (low + high) / 2;
      var pathProgress = segmentPathProgress(segment, mid, entity, motionOpts);
      var arc = arcDistanceFromPathProgress(arcData, pathProgress);
      if (arc < targetArc) low = mid;
      else high = mid;
    }
    return ((low + high) / 2) * duration;
  }

  function getDribbleBallPose(boatSegment, boatPose, localTime, segmentEndTime, holderEntity, motionOpts) {
    var arcData = getSegmentArcData(boatSegment);
    var pathLength = arcData.total;
    var throwDistance = getDribbleThrowDistance(boatSegment);
    if (pathLength <= throwDistance) {
      return clone(boatPose);
    }
    var pathProgress = boatPathProgressAtLocalTime(
      boatSegment,
      localTime,
      holderEntity,
      motionOpts
    );
    var boatArc = arcDistanceFromPathProgress(arcData, pathProgress);
    var driveStart = getDribbleDriveStart(pathLength, throwDistance);
    if (boatArc >= driveStart) {
      return clone(boatPose);
    }

    var cycleIndex = Math.floor(boatArc / throwDistance);
    var throwFromArc = cycleIndex * throwDistance;
    var restArc = throwFromArc + throwDistance;
    // Geen verkorte laatste dribbel: alleen volle worpen, daarna meevaren.
    if (restArc > driveStart + 1e-6) {
      return clone(boatPose);
    }
    var fromPose = poseAtArcDistance(boatSegment, throwFromArc, arcData);
    var toPose = poseAtArcDistance(boatSegment, restArc, arcData);
    var ballEntity = getBallEntity() || { type: 'ball' };
    var throwDuration = entityMoveDuration(fromPose, toPose, ballEntity);
    var throwStartTime = localTimeAtArcDistance(
      boatSegment,
      throwFromArc,
      holderEntity,
      motionOpts,
      segmentEndTime
    );
    var elapsed = localTime - throwStartTime;

    if (elapsed >= 0 && elapsed < throwDuration) {
      var throwFrac = elapsed / throwDuration;
      return {
        x: fromPose.x + (toPose.x - fromPose.x) * throwFrac,
        y: fromPose.y + (toPose.y - fromPose.y) * throwFrac,
        rotation: 0,
      };
    }

    return toPose;
  }

  function getDribbleBallPoseFromCatchArc(
    boatSegment,
    boatPose,
    localTime,
    segmentEndTime,
    holderEntity,
    motionOpts,
    catchArc
  ) {
    var arcData = getSegmentArcData(boatSegment);
    var pathLength = arcData.total;
    var throwDistance = getDribbleThrowDistance(boatSegment);
    var remainingLength = pathLength - catchArc;
    if (remainingLength <= throwDistance) {
      return clone(boatPose);
    }

    var pathProgress = boatPathProgressAtLocalTime(
      boatSegment,
      localTime,
      holderEntity,
      motionOpts
    );
    var boatArc = arcDistanceFromPathProgress(arcData, pathProgress);
    if (boatArc < catchArc) {
      return poseAtArcDistance(boatSegment, catchArc, arcData);
    }

    var effectiveArc = boatArc - catchArc;
    var driveStart = getDribbleDriveStart(remainingLength, throwDistance);
    if (effectiveArc >= driveStart) {
      return clone(boatPose);
    }

    var cycleIndex = Math.floor(effectiveArc / throwDistance);
    var throwFromArc = catchArc + cycleIndex * throwDistance;
    var restArc = throwFromArc + throwDistance;
    if (restArc > catchArc + driveStart + 1e-6) {
      return clone(boatPose);
    }
    var fromPose = poseAtArcDistance(boatSegment, throwFromArc, arcData);
    var toPose = poseAtArcDistance(boatSegment, restArc, arcData);
    var ballEntity = getBallEntity() || { type: 'ball' };
    var throwDuration = entityMoveDuration(fromPose, toPose, ballEntity);
    var throwStartTime = localTimeAtArcDistance(
      boatSegment,
      throwFromArc,
      holderEntity,
      motionOpts,
      segmentEndTime
    );
    var elapsed = localTime - throwStartTime;

    if (elapsed >= 0 && elapsed < throwDuration) {
      var throwFrac = elapsed / throwDuration;
      return {
        x: fromPose.x + (toPose.x - fromPose.x) * throwFrac,
        y: fromPose.y + (toPose.y - fromPose.y) * throwFrac,
        rotation: 0,
      };
    }

    return toPose;
  }

  function applyBallPoseOverrides(poses, routes, localTime, ballHolderId, motionOptsByEntity) {
    if (!poses) return;
    var ballSeg = routes && routes.ball;
    if (ballSeg && ballSeg.syncArcDistance != null && ballSeg.syncToEntityId) {
      var arrivalTime = (ballSeg.throwDelay || 0) + (ballSeg.travelDuration || 0);
      if (localTime >= arrivalTime - 1e-6) {
        var receiverId = ballSeg.syncToEntityId;
        var receiverSeg = routes[receiverId];
        var receiverEntity = state.tactic.entities.find(function (item) { return item.id === receiverId; });
        var motionOpts = motionOptsByEntity && motionOptsByEntity[receiverId];
        if (receiverSeg && receiverEntity && poses[receiverId]) {
          poses.ball = getDribbleBallPoseFromCatchArc(
            receiverSeg,
            poses[receiverId],
            localTime,
            receiverSeg.endTime,
            receiverEntity,
            motionOpts,
            ballSeg.syncArcDistance
          );
        }
        return;
      }
      return;
    }
    if (ballSeg && !isFreeBallRoute(ballSeg)) return;

    var claim = getBallClaimAtTime(routes, localTime, motionOptsByEntity);
    if (claim) {
      var claimMotionOpts = motionOptsByEntity && motionOptsByEntity[claim.entityId];
      poses.ball = getDribbleBallPoseFromCatchArc(
        claim.segment,
        poses[claim.entityId],
        localTime,
        claim.segment.endTime,
        claim.entity,
        claimMotionOpts,
        claim.claimArc
      );
      return;
    }

    if (ballSeg) return;

    if (isDribbleActive(ballHolderId, routes)) {
      var holderSeg = routes ? routes[ballHolderId] : getPrimarySegment(ballHolderId);
      var holderEntity = state.tactic.entities.find(function (item) { return item.id === ballHolderId; });
      if (!holderSeg || !holderEntity) return;
      var motionOpts = motionOptsByEntity && motionOptsByEntity[ballHolderId];
      poses.ball = getDribbleBallPose(
        holderSeg,
        poses[ballHolderId],
        localTime,
        holderSeg.endTime,
        holderEntity,
        motionOpts
      );
      return;
    }

    if (ballHolderId && poses[ballHolderId]) {
      poses.ball = clone(poses[ballHolderId]);
    }
  }

  function createBallRouteSegment(startPose, endPose, metadata) {
    if (!canEdit()) return;
    endPose = clampPoseToField(endPose);
    if (distanceMeters(startPose, endPose) < 0.35) {
      renderAll();
      return;
    }
    recordHistory();
    var track = getTrackForEntity('ball');
    track.segments = [{
      startTime: 0,
      endTime: 0,
      startPose: { x: startPose.x, y: startPose.y, rotation: 0 },
      endPose: { x: endPose.x, y: endPose.y, rotation: 0 },
      controlOut: null,
      controlIn: null,
      passType: metadata.passType || 'free',
      targetEntityId: metadata.targetEntityId || null,
      syncToEntityId: metadata.syncToEntityId || null,
      syncArcDistance: metadata.syncArcDistance != null ? metadata.syncArcDistance : null,
      syncPathProgress: metadata.syncPathProgress != null ? metadata.syncPathProgress : null,
    }];
    if (metadata.passType === 'free') {
      setBallHolderId(null);
    }
    recomputeAllSegmentDurations();
    if (isFreeBallRoute(track.segments[0])) refreshAllBoatBallClaims();
    state.tactic.updatedAt = new Date().toISOString();
    renderAll();
  }

  function getBallRouteStyle(segment) {
    if (!segment || !segment.passType || segment.passType === 'free') {
      return { color: 'rgba(226, 232, 240, 0.95)', dash: [] };
    }
    if (segment.passType === 'direct') {
      return { color: 'rgba(34, 211, 238, 0.92)', dash: [7, 5] };
    }
    if (segment.passType === 'route') {
      return { color: 'rgba(52, 211, 153, 0.92)', dash: [6, 4] };
    }
    if (segment.passType === 'space') {
      return { color: 'rgba(251, 191, 36, 0.92)', dash: [5, 5] };
    }
    return { color: 'rgba(226, 232, 240, 0.95)', dash: [] };
  }

  function getTrackForEntity(entityId) {
    var track = state.tactic.tracks.find(function (item) { return item.entityId === entityId; });
    if (track) return track;
    track = { entityId: entityId, segments: [] };
    state.tactic.tracks.push(track);
    return track;
  }

  function getPrimarySegment(entityId) {
    var track = state.tactic.tracks.find(function (item) { return item.entityId === entityId; });
    if (!track || !track.segments.length) return null;
    return track.segments[0];
  }

  function isStepDurationTiming() {
    return getSettings().motionTimingMode === 'stepDuration';
  }

  function isBoatSpeedSyncArrival() {
    var settings = getSettings();
    return settings.motionTimingMode !== 'stepDuration' && settings.boatSpeedSyncArrival !== false;
  }

  function usesSyncedArrivalTiming(entity) {
    if (!entity || entity.type === 'ball') return false;
    return isStepDurationTiming() || isBoatSpeedSyncArrival();
  }

  // Padlengte langs de curve (niet de koorde), zodat knikken via de diamond
  // handle de vaartijd en dribbel-ticks meenemen.
  function segmentTravelDistance(segment) {
    if (!segment || !segment.startPose || !segment.endPose) return 0;
    var arc = getSegmentArcData(segment).total;
    if (arc > 1e-6) return arc;
    return distanceMeters(segment.startPose, segment.endPose);
  }

  function entityMoveDuration(start, end, entity, travelDistance) {
    var settings = getSettings();
    var distance = travelDistance != null ? travelDistance : distanceMeters(start, end);
    var speedKmh = entity && entity.type === 'ball' ? settings.ballSpeed : settings.boatSpeed;
    var moveTime = distance / Math.max(0.1, kmhToMs(speedKmh));
    if (entity && entity.type === 'ball') {
      return Math.max(0.25, moveTime);
    }
    var turnTime = angleDeltaDegrees(start.rotation || 0, end.rotation || 0)
      / Math.max(1, settings.boatRotationSpeed);
    return Math.max(0.25, Math.max(moveTime, turnTime));
  }

  function boatSyncedStepDuration(routes) {
    var max = 0;
    if (!routes) return max;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (!entity || entity.type !== 'boat') return;
      var duration = entityMoveDuration(
        segment.startPose,
        segment.endPose,
        entity,
        segmentTravelDistance(segment)
      );
      if (duration > max) max = duration;
    });
    return max;
  }

  function segmentDuration(start, end, entity, syncedBoatDuration, travelDistance) {
    if (isStepDurationTiming()) {
      return Math.max(0.25, getSettings().stepDuration);
    }
    if (isBoatSpeedSyncArrival() && entity && entity.type === 'boat' && syncedBoatDuration > 0) {
      return Math.max(0.25, syncedBoatDuration);
    }
    return entityMoveDuration(start, end, entity, travelDistance);
  }

  function applyRouteDurations(routes, stepIndex) {
    if (!routes) return routes;
    if (stepIndex == null) stepIndex = state.tactic.currentStepIndex;
    var syncedBoatDuration = isBoatSpeedSyncArrival() ? boatSyncedStepDuration(routes) : 0;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      clearBoatCatchPace(segment);
      segment.startTime = segment.startTime || 0;
      var travelDist = entity && entity.type === 'boat'
        ? segmentTravelDistance(segment)
        : null;
      segment.endTime = segment.startTime + segmentDuration(
        segment.startPose,
        segment.endPose,
        entity,
        syncedBoatDuration,
        travelDist
      );
    });
    var ballSeg = routes.ball;
    if (ballSeg) {
      var ballEntity = state.tactic.entities.find(function (item) { return item.id === 'ball'; });
      var travelDuration = Math.max(0.25, entityMoveDuration(
        ballSeg.startPose,
        ballSeg.endPose,
        ballEntity
      ));
      ballSeg.travelDuration = travelDuration;
      ballSeg.throwDelay = 0;

      if (ballSeg.syncToEntityId) {
        var targetSeg = routes[ballSeg.syncToEntityId];
        if (targetSeg && targetSeg.endTime > 0) {
          var targetEntity = state.tactic.entities.find(function (item) {
            return item.id === ballSeg.syncToEntityId;
          });
          var meetArc = ballSeg.syncArcDistance != null
            ? ballSeg.syncArcDistance
            : getSegmentArcData(targetSeg).total;
          var entrySpeed = catchEntrySpeedForEntity(ballSeg.syncToEntityId, stepIndex);
          var continuesToNext = entityContinuesToNextStep(ballSeg.syncToEntityId, stepIndex);
          var continueOpts = entrySpeed > 1e-6
            ? { continuesFromPrev: true, continuesToNext: continuesToNext }
            : (continuesToNext ? { continuesFromPrev: false, continuesToNext: true } : null);
          var syncEnd = targetSeg.endTime;
          if (ballSeg.syncArcDistance != null) {
            syncEnd = localTimeAtArcDistance(
              targetSeg,
              ballSeg.syncArcDistance,
              targetEntity,
              continueOpts,
              targetSeg.endTime
            );
          }
          // Sync-arrival comprimeert soms het pad tot onder fysieke tijd.
          // Neem max(timeline, earliest met beginsnelheid uit vorige stap).
          var paceSettings = getSettings();
          var paceAccel = kmhToMs(paceSettings.boatAcceleration);
          var paceSpeed = Math.max(0.1, kmhToMs(paceSettings.boatSpeed));
          var earliestMeet = earliestBoatMeetTime(meetArc, paceSpeed, paceAccel, entrySpeed);
          var boatMeetTime = Math.max(syncEnd, earliestMeet);

          if (boatMeetTime > travelDuration + 1e-6) {
            // Speler is later op het meetpunt: bal wacht met gooien.
            ballSeg.throwDelay = boatMeetTime - travelDuration;
            ballSeg.endTime = boatMeetTime;
            if (earliestMeet > syncEnd + 1e-6) {
              // Timeline was te optimistisch; vaar met echte catch-pace naar het punt.
              applyBoatCatchPace(targetSeg, meetArc, boatMeetTime, entrySpeed, continuesToNext);
              ballSeg.throwDelay = Math.max(0, targetSeg.catchMeetTime - travelDuration);
              ballSeg.endTime = targetSeg.catchMeetTime;
            }
          } else if (travelDuration > boatMeetTime + 1e-6) {
            // Bal is later: speler vaart langzaam naar het punt, daarna op normaal tempo door.
            applyBoatCatchPace(targetSeg, meetArc, travelDuration, entrySpeed, continuesToNext);
            // Als catch-pace de meet-tijd moest oprekken, wacht de bal alsnog.
            ballSeg.throwDelay = Math.max(0, targetSeg.catchMeetTime - travelDuration);
            ballSeg.endTime = targetSeg.catchMeetTime;
          } else {
            ballSeg.endTime = travelDuration;
          }
        }
      }
    }
    stretchContinuingBoatDurations(routes, stepIndex);
    resyncSyncedBoatArrivals(routes);
    return routes;
  }

  function ballSegmentPathProgress(segment, localTime) {
    if (!segment) return 0;
    var travelDuration = segment.travelDuration;
    if (!travelDuration || travelDuration <= 0) {
      var ballEntity = getBallEntity();
      travelDuration = Math.max(0.25, entityMoveDuration(
        segment.startPose,
        segment.endPose,
        ballEntity
      ));
    }
    var throwDelay = segment.throwDelay || 0;
    if (localTime <= throwDelay) return 0;
    if (localTime >= throwDelay + travelDuration) return 1;
    return (localTime - throwDelay) / travelDuration;
  }

  function segmentPathProgress(segment, timeProgress, entity, motionOpts) {
    var progress = clamp(timeProgress, 0, 1);
    if (!entity || entity.type === 'ball') return progress;

    var continuesFromPrev = motionOpts && motionOpts.continuesFromPrev;
    var continuesToNext = motionOpts && motionOpts.continuesToNext;

    // Opeenvolgende stappen: geen vertragen/versnellen tussen stappen.
    if (continuesFromPrev && continuesToNext) {
      return hermiteProgress(progress, 2, 2);
    }
    if (!continuesFromPrev && continuesToNext) {
      return hermiteProgress(progress, 0, 2);
    }
    if (continuesFromPrev && !continuesToNext) {
      return hermiteProgress(progress, 2, 0);
    }

    // Sync arrival: zelfde journey-fractie voor elke boot (booglengte), anders
    // lopen scheve curves uit de pas terwijl de eindtijd wel gelijk is.
    if (usesSyncedArrivalTiming(entity)) {
      return hermiteProgress(progress, 0, 0);
    }

    var settings = getSettings();
    return motionPathProgress(
      progress,
      segmentTravelDistance(segment),
      kmhToMs(settings.boatSpeed),
      kmhToMs(settings.boatAcceleration)
    );
  }

  function recomputeAllSegmentDurations() {
    syncLinkedBallRouteGeometry();
    var routes = captureDraftRoutes();
    if (!Object.keys(routes).length) {
      invalidateTransportTimeline();
      return;
    }
    applyRouteDurations(routes);
    Object.keys(routes).forEach(function (entityId) {
      var segment = getPrimarySegment(entityId);
      if (!segment || !routes[entityId]) return;
      segment.startTime = routes[entityId].startTime;
      segment.endTime = routes[entityId].endTime;
      if (entityId === 'ball') {
        segment.throwDelay = routes[entityId].throwDelay || 0;
        segment.travelDuration = routes[entityId].travelDuration;
        clearBoatCatchPace(segment);
      } else if (routes[entityId].catchMeetTime != null) {
        segment.catchMeetArc = routes[entityId].catchMeetArc;
        segment.catchMeetTime = routes[entityId].catchMeetTime;
        segment.catchApproachSpeed = routes[entityId].catchApproachSpeed;
        segment.catchEntrySpeed = routes[entityId].catchEntrySpeed || 0;
        segment.catchAfterDuration = routes[entityId].catchAfterDuration;
        segment.catchContinuesToNext = !!routes[entityId].catchContinuesToNext;
      } else {
        clearBoatCatchPace(segment);
      }
    });
    invalidateTransportTimeline();
  }

  function getPosesAtTime() {
    syncLinkedBallRouteGeometry();
    var poses = {};
    state.tactic.entities.forEach(function (entity) {
      poses[entity.id] = clone(entity.initial);
      var track = state.tactic.tracks.find(function (item) { return item.entityId === entity.id; });
      if (!track || !track.segments.length) return;
      var time = state.currentTime;
      for (var i = 0; i < track.segments.length; i++) {
        var segment = track.segments[i];
        if (time < segment.startTime) break;
        if (time <= segment.endTime) {
          var localTime = time - (segment.startTime || 0);
          var pathT = entity.type === 'ball'
            ? ballSegmentPathProgress(segment, localTime)
            : boatPathProgressAtLocalTime(segment, localTime, entity);
          poses[entity.id] = poseAlongPathProgress(segment, pathT, entity);
          break;
        }
        poses[entity.id] = poseAlongSegment(segment, 1, entity);
      }
    });
    var routes = captureDraftRoutes();
    applyBallPoseOverrides(poses, routes, state.currentTime, getBallHolderId(), null);
    return poses;
  }

  function setMessage(text, options) {
    var opts = options || {};
    state.message = text;
    var el = document.getElementById('message');
    if (!text) {
      el.classList.remove('is-visible');
      el.classList.remove('is-emphasis');
      window.setTimeout(function () {
        if (state.message) return;
        el.classList.add('hidden');
        el.textContent = '';
        el.classList.remove('is-emphasis');
      }, 180);
      return;
    }
    el.textContent = text;
    el.classList.toggle('is-emphasis', !!opts.emphasis);
    el.classList.remove('hidden');
    // Force reflow so the enter transition runs when replacing text quickly.
    void el.offsetWidth;
    el.classList.add('is-visible');
    var duration = opts.duration != null ? opts.duration : 2600;
    window.setTimeout(function () {
      if (state.message === text) setMessage(null);
    }, duration);
  }

  function persistTactic() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tactic));
    } catch (err) {
      console.warn('Opslaan mislukt', err);
    }
  }

  function loadStoredTactic() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return migrateTactic(JSON.parse(raw));
    } catch (err) {
      return null;
    }
  }

  var EXPORT_FORMAT = 'flowboard-tactic';
  var EXPORT_VERSION = 1;
  var SHARE_HASH_PREFIX = 'fb2.';
  var SHARE_HASH_PREFIX_V1 = 'fb1.';
  // Soft limit so links stay usable in browsers and common messengers.
  var SHARE_URL_MAX_LENGTH = 4096;

  var shareLinkState = {
    key: null,
    url: null,
    usable: false,
    reason: 'pending',
    generation: 0,
  };
  var shareLinkRefreshTimer = null;

  function normalizeTacticName(value) {
    var name = String(value || '').trim();
    if (!name) name = t('tactic.defaultName');
    return name.slice(0, 120);
  }

  function tacticExportFilename(name) {
    var base = normalizeTacticName(name)
      .replace(/[^\w\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!base) base = 'tactic';
    return base + '.flowboard.json';
  }

  function buildTacticTransferPayload(name, options) {
    var opts = options || {};
    var normalized = normalizeTacticName(name || (state.tactic && state.tactic.name));
    var tactic = clone(state.tactic);
    tactic.name = normalized;
    // Settings are local preferences; transfer only the playable flow.
    delete tactic.settings;
    var payload = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      tactic: tactic,
    };
    if (opts.includeExportedAt) {
      payload.exportedAt = new Date().toISOString();
    }
    return payload;
  }

  function supportsShareCompression() {
    return typeof CompressionStream === 'function'
      && typeof DecompressionStream === 'function'
      && typeof TextEncoder === 'function'
      && typeof TextDecoder === 'function'
      && typeof btoa === 'function'
      && typeof atob === 'function';
  }

  function bytesToBase64Url(bytes) {
    var binary = '';
    var chunk = 0x8000;
    var i;
    for (i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    var str = String(value || '');
    var pad = str.length % 4 === 0 ? '' : new Array(5 - (str.length % 4)).join('=');
    var binary = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    var bytes = new Uint8Array(binary.length);
    var i;
    for (i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function compressBytes(bytes) {
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    ).arrayBuffer().then(function (buffer) {
      return new Uint8Array(buffer);
    });
  }

  function decompressBytes(bytes) {
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    ).arrayBuffer().then(function (buffer) {
      return new Uint8Array(buffer);
    });
  }

  function pageUrlWithoutHash() {
    return window.location.href.replace(/#.*$/, '');
  }

  function buildShareUrlFromPayloadJson(jsonText) {
    var bytes = new TextEncoder().encode(jsonText);
    return compressBytes(bytes).then(function (compressed) {
      return pageUrlWithoutHash() + '#' + SHARE_HASH_PREFIX + bytesToBase64Url(compressed);
    });
  }

  function parseShareHash(hash) {
    var raw = String(hash || '');
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    if (raw.indexOf(SHARE_HASH_PREFIX) === 0) {
      return { version: 2, encoded: raw.slice(SHARE_HASH_PREFIX.length) || null };
    }
    if (raw.indexOf(SHARE_HASH_PREFIX_V1) === 0) {
      return { version: 1, encoded: raw.slice(SHARE_HASH_PREFIX_V1.length) || null };
    }
    return null;
  }

  function roundShareNumber(value, digits) {
    var num = Number(value);
    if (!Number.isFinite(num)) return 0;
    var factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
  }

  function packSharePose(pose) {
    if (!pose) return null;
    var out = [roundShareNumber(pose.x, 3), roundShareNumber(pose.y, 3)];
    var rotation = roundShareNumber(pose.rotation || 0, 1);
    if (rotation) out.push(rotation);
    return out;
  }

  function unpackSharePose(value) {
    if (!value) return null;
    if (Array.isArray(value)) {
      return {
        x: Number(value[0]) || 0,
        y: Number(value[1]) || 0,
        rotation: Number(value[2]) || 0,
      };
    }
    if (typeof value === 'object') {
      return {
        x: Number(value.x) || 0,
        y: Number(value.y) || 0,
        rotation: Number(value.rotation) || 0,
      };
    }
    return null;
  }

  function shortShareEntityId(entityId) {
    if (entityId === 'ball') return 'b';
    var defense = /^boat-defense-(\d+)$/.exec(entityId);
    if (defense) return 'd' + defense[1];
    var attack = /^boat-attack-(\d+)$/.exec(entityId);
    if (attack) return 'a' + attack[1];
    return entityId;
  }

  function expandShareEntityId(shortId) {
    if (!shortId || shortId === 'b') return 'ball';
    if (shortId.charAt(0) === 'd' && /^\d+$/.test(shortId.slice(1))) {
      return 'boat-defense-' + shortId.slice(1);
    }
    if (shortId.charAt(0) === 'a' && /^\d+$/.test(shortId.slice(1))) {
      return 'boat-attack-' + shortId.slice(1);
    }
    return shortId;
  }

  function posesAlmostEqual(a, b) {
    if (!a || !b) return false;
    return Math.abs((a.x || 0) - (b.x || 0)) < 1e-6
      && Math.abs((a.y || 0) - (b.y || 0)) < 1e-6
      && Math.abs((a.rotation || 0) - (b.rotation || 0)) < 1e-3;
  }

  function packShareRoute(route, prevPose, stepPose) {
    if (!route || typeof route !== 'object') return null;
    var out = {};
    var startTime = Number(route.startTime) || 0;
    var endTime = route.endTime == null ? null : Number(route.endTime);
    if (startTime) out.a = roundShareNumber(startTime, 3);
    if (endTime != null) out.b = roundShareNumber(endTime, 3);
    if (route.startPose && !posesAlmostEqual(route.startPose, prevPose)) {
      out.s = packSharePose(route.startPose);
    }
    if (route.endPose && !posesAlmostEqual(route.endPose, stepPose)) {
      out.e = packSharePose(route.endPose);
    }
    if (route.controlOut) {
      out.o = [
        roundShareNumber(route.controlOut.x, 3),
        roundShareNumber(route.controlOut.y, 3),
      ];
    }
    if (route.controlIn) {
      out.i = [
        roundShareNumber(route.controlIn.x, 3),
        roundShareNumber(route.controlIn.y, 3),
      ];
    }
    if (route.passType) out.p = route.passType;
    if (route.targetEntityId) out.g = shortShareEntityId(route.targetEntityId);
    if (route.syncToEntityId) out.y = shortShareEntityId(route.syncToEntityId);
    if (route.syncArcDistance != null) out.A = roundShareNumber(route.syncArcDistance, 3);
    if (route.throwDelay) out.D = roundShareNumber(route.throwDelay, 3);
    if (route.travelDuration != null) {
      var expected = endTime == null ? null : Math.max(0, endTime - startTime);
      if (expected == null || Math.abs(Number(route.travelDuration) - expected) > 1e-6) {
        out.T = roundShareNumber(route.travelDuration, 3);
      }
    }
    return out;
  }

  function unpackShareRoute(packed, prevPose, stepPose) {
    if (!packed || typeof packed !== 'object') return null;
    var startTime = Number(packed.a) || 0;
    var endTime = packed.b == null ? startTime : Number(packed.b);
    var startPose = unpackSharePose(packed.s) || (prevPose ? clone(prevPose) : null);
    var endPose = unpackSharePose(packed.e) || (stepPose ? clone(stepPose) : null);
    if (!startPose || !endPose) return null;
    var route = {
      startTime: startTime,
      endTime: endTime,
      startPose: startPose,
      endPose: endPose,
      controlOut: null,
      controlIn: null,
    };
    if (Array.isArray(packed.o) && packed.o.length >= 2) {
      route.controlOut = { x: Number(packed.o[0]) || 0, y: Number(packed.o[1]) || 0 };
    }
    if (Array.isArray(packed.i) && packed.i.length >= 2) {
      route.controlIn = { x: Number(packed.i[0]) || 0, y: Number(packed.i[1]) || 0 };
    }
    if (packed.p || packed.g || packed.y || packed.A != null || packed.D || packed.T != null) {
      route.passType = packed.p || null;
      route.targetEntityId = packed.g ? expandShareEntityId(packed.g) : null;
      route.syncToEntityId = packed.y ? expandShareEntityId(packed.y) : null;
      route.syncArcDistance = packed.A == null ? null : Number(packed.A);
      route.throwDelay = Number(packed.D) || 0;
      route.travelDuration = packed.T != null
        ? Number(packed.T)
        : Math.max(0, endTime - startTime);
    }
    return route;
  }

  function packSharePoseMap(poses) {
    var out = {};
    if (!poses) return out;
    Object.keys(poses).forEach(function (entityId) {
      out[shortShareEntityId(entityId)] = packSharePose(poses[entityId]);
    });
    return out;
  }

  function unpackSharePoseMap(packed) {
    var out = {};
    if (!packed) return out;
    Object.keys(packed).forEach(function (shortId) {
      var pose = unpackSharePose(packed[shortId]);
      if (pose) out[expandShareEntityId(shortId)] = pose;
    });
    return out;
  }

  function packTacticForShare(tactic) {
    var source = tactic || state.tactic;
    var entities = [];
    (source.entities || []).forEach(function (entity) {
      if (!entity || entity.type !== 'boat') return;
      var teamCode = entity.team === 'attack' ? 1 : 0;
      var number = parseInt(entity.label, 10);
      if (!Number.isFinite(number)) {
        var match = /-(\d+)$/.exec(entity.id || '');
        number = match ? parseInt(match[1], 10) : entities.length + 1;
      }
      entities.push([teamCode, number]);
    });

    var prevPoses = {};
    var steps = (source.steps || []).map(function (step, index) {
      var poses = step.poses || {};
      var packedPoses = {};
      Object.keys(poses).forEach(function (entityId) {
        if (posesAlmostEqual(poses[entityId], prevPoses[entityId])) return;
        packedPoses[shortShareEntityId(entityId)] = packSharePose(poses[entityId]);
      });
      var packedRoutes = null;
      if (step.routes && typeof step.routes === 'object') {
        packedRoutes = {};
        Object.keys(step.routes).forEach(function (entityId) {
          var packedRoute = packShareRoute(step.routes[entityId], prevPoses[entityId], poses[entityId]);
          if (packedRoute) packedRoutes[shortShareEntityId(entityId)] = packedRoute;
        });
        if (!Object.keys(packedRoutes).length) packedRoutes = null;
      }
      var packedStep = {};
      if (Object.keys(packedPoses).length) packedStep.p = packedPoses;
      if (packedRoutes) packedStep.r = packedRoutes;
      if (step.name && !isDefaultStepName(step.name, index)) packedStep.n = step.name;
      if (step.ballHolderId) packedStep.h = shortShareEntityId(step.ballHolderId);
      prevPoses = poses;
      return packedStep;
    });

    var packed = {
      n: normalizeTacticName(source.name),
      e: entities,
      s: steps,
    };
    if (source.currentStepIndex) packed.c = source.currentStepIndex;
    if (source.startPositions && typeof source.startPositions === 'object') {
      packed.S = packSharePoseMap(source.startPositions);
    }
    return packed;
  }

  function unpackTacticFromShare(packed) {
    if (!packed || typeof packed !== 'object' || !Array.isArray(packed.s)) return null;
    var settings = defaultSettings();
    var defenseCount = 0;
    var attackCount = 0;
    var entities = [];
    (packed.e || []).forEach(function (entry) {
      if (!Array.isArray(entry) || entry.length < 2) return;
      var team = entry[0] === 1 ? 'attack' : 'defense';
      var number = parseInt(entry[1], 10);
      if (!Number.isFinite(number) || number < 1) return;
      if (team === 'attack') attackCount += 1;
      else defenseCount += 1;
      var colors = team === 'attack' ? settings.attack.colors.slice() : settings.defense.colors.slice();
      entities.push({
        id: team === 'attack' ? 'boat-attack-' + number : 'boat-defense-' + number,
        type: 'boat',
        team: team,
        label: String(number),
        color: colors[0],
        colors: colors,
        initial: { x: 0, y: 0, rotation: 0 },
      });
    });
    entities.push({
      id: 'ball',
      type: 'ball',
      team: 'neutral',
      label: t('entity.ball'),
      color: '#ffffff',
      colors: ['#ffffff'],
      initial: { x: HALF_LENGTH, y: FIELD_WIDTH / 2, rotation: 0 },
    });
    settings.defense.boatCount = Math.max(1, defenseCount || settings.defense.boatCount);
    settings.attack.boatCount = Math.max(1, attackCount || settings.attack.boatCount);
    settings.showDefense = defenseCount > 0;
    settings.showAttack = attackCount > 0;

    var prevPoses = {};
    var steps = packed.s.map(function (step, index) {
      var poses = {};
      Object.keys(prevPoses).forEach(function (entityId) {
        poses[entityId] = clone(prevPoses[entityId]);
      });
      var delta = unpackSharePoseMap(step && step.p);
      Object.keys(delta).forEach(function (entityId) {
        poses[entityId] = delta[entityId];
      });
      var routes = null;
      if (step && step.r && typeof step.r === 'object') {
        routes = {};
        Object.keys(step.r).forEach(function (shortId) {
          var entityId = expandShareEntityId(shortId);
          var route = unpackShareRoute(step.r[shortId], prevPoses[entityId], poses[entityId]);
          if (route) routes[entityId] = route;
        });
        if (!Object.keys(routes).length) routes = null;
      }
      prevPoses = poses;
      return {
        id: uuid(),
        name: (step && step.n) || stepNameForIndex(index),
        poses: poses,
        routes: routes,
        ballHolderId: step && step.h ? expandShareEntityId(step.h) : null,
      };
    });

    if (steps[0] && steps[0].poses) {
      entities.forEach(function (entity) {
        if (steps[0].poses[entity.id]) entity.initial = clone(steps[0].poses[entity.id]);
      });
    }

    var now = new Date().toISOString();
    return {
      id: uuid(),
      name: normalizeTacticName(packed.n),
      sport: 'canoe-polo',
      field: {
        sport: 'canoe-polo',
        width: FIELD_LENGTH,
        height: FIELD_WIDTH,
        goalWidth: GOAL_WIDTH,
      },
      settings: settings,
      entities: entities,
      tracks: entities.map(function (entity) {
        return { entityId: entity.id, segments: [] };
      }),
      interactions: [],
      duration: 12,
      createdAt: now,
      updatedAt: now,
      startPositions: packed.S ? unpackSharePoseMap(packed.S) : null,
      steps: steps,
      currentStepIndex: Number(packed.c) || 0,
    };
  }

  function decodeSharePayload(shareRef) {
    if (!shareRef || !shareRef.encoded || !supportsShareCompression()) {
      return Promise.resolve(null);
    }
    try {
      var compressed = base64UrlToBytes(shareRef.encoded);
      return decompressBytes(compressed).then(function (bytes) {
        var text = new TextDecoder().decode(bytes);
        var data = JSON.parse(text);
        if (shareRef.version === 2 || (data && Array.isArray(data.s) && Array.isArray(data.e))) {
          return unpackTacticFromShare(data);
        }
        return parseTacticImportPayload(data);
      }).catch(function () {
        return null;
      });
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  function shareLinkCacheKey() {
    if (!hasPlayableSteps()) return '';
    return JSON.stringify(packTacticForShare(state.tactic));
  }

  function updateShareCopyButton() {
    var copyBtn = document.getElementById('btn-share-copy-url');
    if (!copyBtn) return;
    var usable = !!shareLinkState.usable && !!shareLinkState.url;
    copyBtn.disabled = !usable;
    var label = t('share.copyUrl');
    var title = t('share.copyUrl.title');
    if (!usable) {
      if (shareLinkState.reason === 'unsupported') {
        label = t('settings.share.unsupported');
        title = label;
      } else if (shareLinkState.reason === 'tooLong') {
        label = t('settings.share.tooLong');
        title = label;
      } else if (shareLinkState.reason === 'pending') {
        label = t('share.copyUrl.pending');
        title = label;
      } else {
        title = label;
      }
    }
    copyBtn.textContent = label;
    copyBtn.title = title;
  }

  function updateShareButton() {
    var shareBtn = document.getElementById('btn-share-tactic');
    if (!shareBtn) return;
    var playable = hasPlayableSteps();
    shareBtn.classList.toggle('hidden', !playable);
    shareBtn.disabled = !playable;
    shareBtn.title = withShortcut(t('settings.share'), modShortcutLabel() + '+S');
    shareBtn.setAttribute('aria-label', shareBtn.title);
    updateShareCopyButton();
  }

  function applyShareLinkState(next) {
    shareLinkState.key = next.key;
    shareLinkState.url = next.url;
    shareLinkState.usable = !!next.usable;
    shareLinkState.reason = next.reason || 'pending';
    updateShareButton();
  }

  function refreshShareLink() {
    var key = shareLinkCacheKey();
    if (!key) {
      applyShareLinkState({ key: '', url: null, usable: false, reason: 'empty' });
      return;
    }
    if (shareLinkState.key === key && shareLinkState.reason !== 'pending') {
      updateShareButton();
      return;
    }
    if (!supportsShareCompression()) {
      applyShareLinkState({ key: key, url: null, usable: false, reason: 'unsupported' });
      return;
    }
    var generation = shareLinkState.generation + 1;
    shareLinkState.generation = generation;
    shareLinkState.key = key;
    shareLinkState.reason = 'pending';
    shareLinkState.usable = false;
    shareLinkState.url = null;
    updateShareButton();
    buildShareUrlFromPayloadJson(key).then(function (url) {
      if (generation !== shareLinkState.generation || shareLinkState.key !== key) return;
      if (url.length > SHARE_URL_MAX_LENGTH) {
        applyShareLinkState({ key: key, url: null, usable: false, reason: 'tooLong' });
        return;
      }
      applyShareLinkState({ key: key, url: url, usable: true, reason: 'ok' });
    }).catch(function () {
      if (generation !== shareLinkState.generation || shareLinkState.key !== key) return;
      applyShareLinkState({ key: key, url: null, usable: false, reason: 'unsupported' });
    });
  }

  function scheduleShareLinkRefresh() {
    if (shareLinkRefreshTimer) {
      window.clearTimeout(shareLinkRefreshTimer);
      shareLinkRefreshTimer = null;
    }
    shareLinkRefreshTimer = window.setTimeout(function () {
      shareLinkRefreshTimer = null;
      refreshShareLink();
    }, 40);
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      try {
        if (!document.execCommand('copy')) reject(new Error('copy failed'));
        else resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  function isShareDialogOpen() {
    var backdrop = document.getElementById('share-backdrop');
    return backdrop && !backdrop.classList.contains('hidden');
  }

  function closeShareDialog() {
    var backdrop = document.getElementById('share-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function openShareDialog() {
    if (!hasPlayableSteps()) return;
    closeExportDialog();
    closePredefinedDialog();
    closeShortcutsDialog();
    state.settingsOpen = false;
    renderSettings();
    var backdrop = document.getElementById('share-backdrop');
    if (!backdrop) return;
    scheduleShareLinkRefresh();
    updateShareCopyButton();
    backdrop.classList.remove('hidden');
  }

  function shareTacticLink() {
    if (!shareLinkState.usable || !shareLinkState.url) return;
    copyTextToClipboard(shareLinkState.url).then(function () {
      closeShareDialog();
      setMessage(t('message.shareSuccess'), { emphasis: true, duration: 4000 });
    }).catch(function () {
      setMessage(t('message.shareError'));
    });
  }

  function exportTacticFromShare() {
    closeShareDialog();
    exportTactic();
  }

  function consumeShareHashIfPresent() {
    var shareRef = parseShareHash(window.location.hash);
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (!shareRef || !shareRef.encoded) return;
    decodeSharePayload(shareRef).then(function (raw) {
      if (!raw) {
        setMessage(t('message.shareLoadError'));
        return;
      }
      if (!confirmReplaceTactic('confirm.shareOverwrite')) return;
      applyImportedTactic(raw);
      setMessage(t('message.shareLoaded', {
        name: (state.tactic && state.tactic.name) || t('tactic.defaultName'),
      }));
      renderAll();
    });
  }

  function isExportDialogOpen() {
    var backdrop = document.getElementById('export-backdrop');
    return backdrop && !backdrop.classList.contains('hidden');
  }

  function openExportDialog() {
    var backdrop = document.getElementById('export-backdrop');
    var input = document.getElementById('export-name-input');
    if (!backdrop || !input) return;
    closeShareDialog();
    closePredefinedDialog();
    input.value = state.tactic.name || t('tactic.defaultName');
    backdrop.classList.remove('hidden');
    window.setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  function closeExportDialog() {
    var backdrop = document.getElementById('export-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function confirmExportTactic() {
    var input = document.getElementById('export-name-input');
    if (!input) return;
    var name = normalizeTacticName(input.value);
    if (name !== state.tactic.name) {
      recordHistory();
      state.tactic.name = name;
      state.tactic.updatedAt = new Date().toISOString();
    }
    closeExportDialog();
    performExportTactic(name);
    setMessage(t('message.exportSuccess'));
    renderAll();
  }

  function performExportTactic(name) {
    var payload = buildTacticTransferPayload(name, { includeExportedAt: true });
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = tacticExportFilename(payload.tactic.name);
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportTactic() {
    if (!hasPlayableSteps()) return;
    openExportDialog();
  }

  function parseTacticImportPayload(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.tactic && typeof data.tactic === 'object') return data.tactic;
    if (Array.isArray(data.entities)) return data;
    return null;
  }

  function applyImportedTactic(raw) {
    stopPlayback();
    state.startPoseEdit = false;
    if (state.playbackMode) exitPlaybackMode();
    var previousSettings = state.tactic && state.tactic.settings
      ? clone(state.tactic.settings)
      : null;
    state.tactic = migrateTactic(raw);
    state.tactic.id = uuid();
    state.tactic.updatedAt = new Date().toISOString();
    // Keep local settings; imported files may omit them or carry legacy settings.
    if (previousSettings) {
      state.tactic.settings = previousSettings;
      applyTeamColors('attack');
      applyTeamColors('defense');
      recomputeAllSegmentDurations();
    }
    applyStepDiagram(state.tactic.currentStepIndex);
    state.currentTime = 0;
    state.history = { past: [], future: [] };
    state.stepRename = null;
    clearPointerInteraction();
    invalidateTransportTimeline();
  }

  function importTacticFromFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var raw = parseTacticImportPayload(data);
        if (!raw) {
          setMessage(t('message.importError'));
          return;
        }
        if (!window.confirm(t('confirm.importOverwrite'))) return;
        applyImportedTactic(raw);
        setMessage(t('message.importSuccess'));
        renderAll();
      } catch (err) {
        setMessage(t('message.importError'));
      }
    };
    reader.onerror = function () {
      setMessage(t('message.importError'));
    };
    reader.readAsText(file);
  }

  function listPredefinedFlows() {
    var list = window.FlowboardPredefinedFlows;
    return Array.isArray(list) ? list : [];
  }

  function predefinedFlowDisplayName(entry) {
    if (!entry) return '';
    if (entry.nameKey) {
      var translated = t(entry.nameKey);
      if (translated && translated !== entry.nameKey) return translated;
    }
    if (entry.payload && entry.payload.tactic && entry.payload.tactic.name) {
      return entry.payload.tactic.name;
    }
    return entry.id || '';
  }

  function tacticHasUserWork() {
    ensureSteps(state.tactic);
    if (hasStartPosition()) return true;
    if (state.tactic.steps.length > 1) return true;
    if (state.startPoseEdit) return true;
    var routes = captureDraftRoutes();
    if (Object.keys(routes).length) return true;
    var defaultName = t('tactic.defaultName');
    if (state.tactic.name && state.tactic.name !== defaultName) return true;
    return false;
  }

  function confirmReplaceTactic(messageKey) {
    if (!tacticHasUserWork()) return true;
    return window.confirm(t(messageKey || 'confirm.predefinedOverwrite'));
  }

  function isPredefinedDialogOpen() {
    var backdrop = document.getElementById('predefined-backdrop');
    return backdrop && !backdrop.classList.contains('hidden');
  }

  function closePredefinedDialog() {
    var backdrop = document.getElementById('predefined-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  function renderPredefinedList() {
    var list = document.getElementById('predefined-list');
    if (!list) return;
    list.innerHTML = '';

    listPredefinedFlows().forEach(function (entry) {
      if (!entry || !entry.id) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-toolbar predefined-item';
      button.setAttribute('data-predefined-id', entry.id);
      button.setAttribute('role', 'listitem');
      button.textContent = predefinedFlowDisplayName(entry);
      list.appendChild(button);
    });
  }

  function openPredefinedDialog() {
    if (!canEdit() || !isOnStartStep()) return;
    closeExportDialog();
    closeShortcutsDialog();
    state.settingsOpen = false;
    renderSettings();
    renderPredefinedList();
    var backdrop = document.getElementById('predefined-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('hidden');
    var closeBtn = document.getElementById('btn-close-predefined');
    if (closeBtn) {
      window.setTimeout(function () { closeBtn.focus(); }, 0);
    }
  }

  function loadPredefinedFlow(id) {
    if (!canEdit() || !id) return;
    var entry = listPredefinedFlows().find(function (item) { return item && item.id === id; });
    if (!entry) {
      setMessage(t('message.predefinedError'));
      return;
    }
    var raw = parseTacticImportPayload(entry.payload);
    if (!raw) {
      setMessage(t('message.predefinedError'));
      return;
    }
    if (!confirmReplaceTactic('confirm.predefinedOverwrite')) return;
    closePredefinedDialog();
    applyImportedTactic(raw);
    setMessage(t('message.predefinedLoaded', { name: predefinedFlowDisplayName(entry) }));
    renderAll();
  }

  function roundRect(context, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function traceRoundedPolygon(context, points, scale, radiusMeters) {
    var scaled = points.map(function (point) {
      return { x: point[0] * scale, y: point[1] * scale };
    });
    var count = scaled.length;
    if (count < 3) return;

    var radius = radiusMeters * scale;
    context.beginPath();

    for (var i = 0; i < count; i++) {
      var current = scaled[i];
      var previous = scaled[(i - 1 + count) % count];
      var next = scaled[(i + 1) % count];
      var prevEdgeX = previous.x - current.x;
      var prevEdgeY = previous.y - current.y;
      var nextEdgeX = next.x - current.x;
      var nextEdgeY = next.y - current.y;
      var prevLen = Math.hypot(prevEdgeX, prevEdgeY);
      var nextLen = Math.hypot(nextEdgeX, nextEdgeY);
      if (!prevLen || !nextLen) continue;

      var cornerRadius = Math.min(radius, prevLen * 0.48, nextLen * 0.48);
      var startX = current.x + (prevEdgeX / prevLen) * cornerRadius;
      var startY = current.y + (prevEdgeY / prevLen) * cornerRadius;
      var endX = current.x + (nextEdgeX / nextLen) * cornerRadius;
      var endY = current.y + (nextEdgeY / nextLen) * cornerRadius;

      if (i === 0) context.moveTo(startX, startY);
      else context.lineTo(startX, startY);
      context.quadraticCurveTo(current.x, current.y, endX, endY);
    }

    context.closePath();
  }

  function traceBoatHull(context) {
    traceRoundedPolygon(context, BOAT_HULL, fieldScale, BOAT_HULL_CORNER_RADIUS);
  }

  function traceBoatCockpit(context) {
    traceRoundedPolygon(context, BOAT_COCKPIT, fieldScale, BOAT_COCKPIT_CORNER_RADIUS);
  }

  function drawDashedMeterLine(xMeters) {
    var half = isHalfField();
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.lineWidth = Math.max(1, fieldScale * 0.04);
    ctx.setLineDash([fieldScale * 0.35, fieldScale * 0.28]);
    ctx.beginPath();
    if (half) {
      var y = canvasPadding() + xMeters * fieldScale;
      ctx.moveTo(canvasPadding(), y);
      ctx.lineTo(canvasPadding() + FIELD_WIDTH * fieldScale, y);
    } else {
      var x = canvasPadding() + xMeters * fieldScale;
      ctx.moveTo(x, canvasPadding());
      ctx.lineTo(x, canvasPadding() + FIELD_WIDTH * fieldScale);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawEdgeMarks(xMeters) {
    var tick = fieldScale * 0.45;
    var half = isHalfField();
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.75)';
    ctx.lineWidth = Math.max(1.5, fieldScale * 0.05);
    ctx.setLineDash([]);
    if (half) {
      var y = canvasPadding() + xMeters * fieldScale;
      var left = canvasPadding();
      var right = canvasPadding() + FIELD_WIDTH * fieldScale;
      ctx.beginPath();
      ctx.moveTo(left - tick * 0.15, y);
      ctx.lineTo(left + tick, y);
      ctx.moveTo(right + tick * 0.15, y);
      ctx.lineTo(right - tick, y);
      ctx.stroke();
    } else {
      var x = canvasPadding() + xMeters * fieldScale;
      var top = canvasPadding();
      var bottom = canvasPadding() + FIELD_WIDTH * fieldScale;
      ctx.beginPath();
      ctx.moveTo(x, top - tick * 0.15);
      ctx.lineTo(x, top + tick);
      ctx.moveTo(x, bottom + tick * 0.15);
      ctx.lineTo(x, bottom - tick);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGoal() {
    var goalSize = GOAL_WIDTH * fieldScale;
    var thickness = Math.max(8, fieldScale * 0.35);
    ctx.fillStyle = '#f8fafc';
    if (isHalfField()) {
      var goalX = canvasPadding() + (FIELD_WIDTH * fieldScale) / 2 - goalSize / 2;
      ctx.fillRect(goalX, canvasPadding() - thickness / 2, goalSize, thickness);
    } else {
      var goalY = canvasPadding() + (FIELD_WIDTH * fieldScale) / 2 - goalSize / 2;
      ctx.fillRect(canvasPadding() - thickness / 2, goalY, thickness, goalSize);
      ctx.fillRect(
        canvasPadding() + FIELD_LENGTH * fieldScale - thickness / 2,
        goalY,
        thickness,
        goalSize
      );
    }
  }

  function isBallInGoal(ballPose) {
    if (!ballPose) return null;
    var halfGoal = GOAL_WIDTH / 2;
    var centerY = FIELD_WIDTH / 2;
    if (Math.abs(ballPose.y - centerY) > halfGoal) return null;
    var radius = BALL_DIAMETER / 2;
    if (isHalfField()) {
      return ballPose.x <= radius ? 'attack' : null;
    }
    if (ballPose.x <= radius) return 'left';
    if (ballPose.x >= FIELD_LENGTH - radius) return 'right';
    return null;
  }

  function goalConfettiDirection(goalSide) {
    if (isHalfField()) return 'down';
    if (goalSide === 'right') return 'left';
    return 'right';
  }

  function goalConfettiOrigin(goalSide) {
    var centerY = FIELD_WIDTH / 2;
    var x = goalSide === 'right' ? FIELD_LENGTH : 0;
    return metersToCanvas({ x: x, y: centerY, rotation: 0 });
  }

  function createConfettiParticle(x, y, direction) {
    var baseAngle = direction === 'down' ? Math.PI / 2 : direction === 'right' ? 0 : Math.PI;
    var spread = Math.PI * 0.75;
    var angle = baseAngle + (Math.random() - 0.5) * spread;
    var speed = 70 + Math.random() * 130;
    return {
      x: x + (Math.random() - 0.5) * GOAL_WIDTH * fieldScale * 0.8,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 3 + Math.random() * 4,
      h: 5 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 10,
      life: 1.1 + Math.random() * 0.7,
      age: 0,
    };
  }

  function spawnGoalConfetti(goalSide) {
    var origin = goalConfettiOrigin(goalSide);
    var direction = goalConfettiDirection(goalSide);
    for (var i = 0; i < CONFETTI_COUNT; i++) {
      state.confetti.particles.push(createConfettiParticle(origin.x, origin.y, direction));
    }
    state.confetti.lastUpdateAt = null;
    ensureConfettiLoop();
  }

  function updateConfetti(dt) {
    var gravity = 280;
    var drag = 0.985;
    var alive = [];
    state.confetti.particles.forEach(function (particle) {
      particle.age += dt;
      if (particle.age >= particle.life) return;
      particle.vx *= drag;
      particle.vy = particle.vy * drag + gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.spin * dt;
      alive.push(particle);
    });
    state.confetti.particles = alive;
  }

  function drawConfetti() {
    if (!state.confetti.particles.length) return;
    state.confetti.particles.forEach(function (particle) {
      var alpha = 1 - particle.age / particle.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(particle.x, particle.y);
      ctx.rotate(particle.rotation);
      ctx.fillStyle = particle.color;
      ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function tickConfetti(now) {
    if (!state.confetti.particles.length) {
      state.confetti.lastUpdateAt = null;
      return false;
    }
    if (state.confetti.lastUpdateAt == null) {
      state.confetti.lastUpdateAt = now;
      return true;
    }
    var dt = Math.min(0.05, (now - state.confetti.lastUpdateAt) / 1000);
    state.confetti.lastUpdateAt = now;
    updateConfetti(dt);
    return true;
  }

  function stopConfettiLoop() {
    if (!state.confetti.raf) return;
    cancelAnimationFrame(state.confetti.raf);
    state.confetti.raf = null;
    state.confetti.lastUpdateAt = null;
  }

  function ensureConfettiLoop() {
    if (state.confetti.raf) return;
    function frame(now) {
      if (!tickConfetti(now)) {
        stopConfettiLoop();
        renderCanvas();
        return;
      }
      renderCanvas();
      state.confetti.raf = requestAnimationFrame(frame);
    }
    state.confetti.raf = requestAnimationFrame(frame);
  }

  function syncGoalTracking(triggerCelebration) {
    var poses = getDisplayPoses();
    var ballPose = poses.ball;
    var inGoal = isBallInGoal(ballPose);
    if (triggerCelebration && inGoal && !state.ballWasInGoal) {
      spawnGoalConfetti(inGoal);
    }
    state.ballWasInGoal = !!inGoal;
  }

  function resetGoalTracking() {
    // Sync huidige positie zonder te vieren, zodat een bal die al in het doel
    // ligt (bijv. bij een nieuwe stap) geen herhaalde confetti triggert.
    syncGoalTracking(false);
  }

  function drawBoat(pose, entity, selected) {
    var width = BOAT_WIDTH * fieldScale;
    var colors = entity.colors && entity.colors.length ? entity.colors : [entity.color || '#94a3b8'];
    var showNumbers = getSettings().showNumbers;

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate((pose.rotation * Math.PI) / 180);

    // colors[0]=primary/bow (or full hull); colors[1]=secondary/stern
    traceBoatHull(ctx);
    ctx.fillStyle = colors.length >= 2 ? colors[1] : colors[0];
    ctx.fill();
    if (colors.length >= 2) {
      ctx.save();
      traceBoatHull(ctx);
      ctx.clip();
      ctx.fillStyle = colors[0];
      ctx.fillRect(BOAT_COLOR_SPLIT_X * fieldScale, -width * 2, width * 4, width * 4);
      ctx.restore();
    }
    traceBoatHull(ctx);
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = selected ? 2.5 : 1.3;
    ctx.stroke();
    traceBoatCockpit(ctx);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.stroke();

    var arrowX = fieldScale * 0.95;
    var arrowSize = Math.max(4, width * 0.45);
    ctx.beginPath();
    ctx.moveTo(arrowX + arrowSize * 0.9, 0);
    ctx.lineTo(arrowX - arrowSize * 0.55, -arrowSize * 0.7);
    ctx.lineTo(arrowX - arrowSize * 0.55, arrowSize * 0.7);
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    if (showNumbers) {
      ctx.save();
      ctx.font = 'bold ' + Math.max(10, width * 0.85) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#000000';
      ctx.strokeText(entity.label, pose.x, pose.y);
      ctx.fillText(entity.label, pose.x, pose.y);
      ctx.restore();
    }
  }

  function drawBallPanelBand(x, y, radius, y0, y1, bulge0, bulge1, color) {
    var span0 = Math.sqrt(Math.max(0, 1 - y0 * y0)) * radius;
    var span1 = Math.sqrt(Math.max(0, 1 - y1 * y1)) * radius;
    var top = y + y0 * radius;
    var bottom = y + y1 * radius;
    ctx.beginPath();
    ctx.moveTo(x - span0, top);
    ctx.quadraticCurveTo(x, top + bulge0 * radius, x + span0, top);
    ctx.lineTo(x + span1, bottom);
    ctx.quadraticCurveTo(x, bottom + bulge1 * radius, x - span1, bottom);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawBallSeamCurve(x, y, radius, yNorm, bulge) {
    var yy = y + yNorm * radius;
    var span = Math.sqrt(Math.max(0, 1 - yNorm * yNorm)) * radius;
    ctx.beginPath();
    ctx.moveTo(x - span, yy);
    ctx.quadraticCurveTo(x, yy + bulge * radius, x + span, yy);
    ctx.stroke();
  }

  function drawBallFace(x, y, radius, selected) {
    var yellow = '#f0b429';
    var blue = '#1a3055';
    var seam = '#0b1220';
    var seams = [
      { y: -0.62, bulge: -0.06 },
      { y: -0.18, bulge: -0.02 },
      { y: 0.18, bulge: 0.02 },
      { y: 0.62, bulge: 0.06 },
    ];

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    // Geel als basis (polen + middenband); blauwe panelen ertussen.
    ctx.fillStyle = yellow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    drawBallPanelBand(x, y, radius, seams[0].y, seams[1].y, seams[0].bulge, seams[1].bulge, blue);
    drawBallPanelBand(x, y, radius, seams[2].y, seams[3].y, seams[2].bulge, seams[3].bulge, blue);

    if (radius >= 7) {
      ctx.strokeStyle = seam;
      ctx.lineWidth = Math.max(1.5, radius * 0.14);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      seams.forEach(function (s) {
        drawBallSeamCurve(x, y, radius, s.y, s.bulge);
      });
      // Verticale naden op polen en blauwe panelen.
      ctx.lineWidth = Math.max(1.25, radius * 0.11);
      [
        [-0.55, -1, -0.62], [0, -1, -0.62], [0.55, -1, -0.62],
        [-0.72, -0.62, -0.18], [0.72, -0.62, -0.18],
        [-0.72, 0.18, 0.62], [0.72, 0.18, 0.62],
        [-0.55, 0.62, 1], [0, 0.62, 1], [0.55, 0.62, 1],
      ].forEach(function (seg) {
        var x0 = x + seg[0] * radius;
        var y0 = y + seg[1] * radius;
        var y1 = y + seg[2] * radius;
        var midY = (y0 + y1) / 2;
        var bulge = Math.abs(seg[0]) > 0.6 ? -Math.sign(seg[0]) * radius * 0.06 : 0;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x0 + bulge, midY, x0, y1);
        ctx.stroke();
      });
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = selected ? '#38bdf8' : seam;
    ctx.lineWidth = selected ? Math.max(2.5, radius * 0.22) : Math.max(1.5, radius * 0.14);
    ctx.stroke();
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, radius + Math.max(3, radius * 0.28), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = Math.max(1.5, radius * 0.14);
      ctx.stroke();
    }
  }

  function drawBall(pose, selected) {
    drawBallFace(pose.x, pose.y, (BALL_DIAMETER * fieldScale) / 2, !!selected);
  }

  function pathLineWidth() {
    return Math.max(6, fieldScale * 0.28);
  }

  function drawRoutePath(start, end, controls, emphasized, style) {
    var from = metersToCanvas(start);
    var to = metersToCanvas(end);
    style = style || {};
    ctx.save();
    ctx.strokeStyle = style.color || (emphasized ? 'rgba(226, 232, 240, 0.95)' : 'rgba(203, 213, 225, 0.75)');
    ctx.lineWidth = pathLineWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (style.dash && style.dash.length) {
      ctx.setLineDash(style.dash);
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (controls && controls.controlOut && controls.controlIn) {
      var out = metersToCanvas({ x: controls.controlOut.x, y: controls.controlOut.y, rotation: 0 });
      var inn = metersToCanvas({ x: controls.controlIn.x, y: controls.controlIn.y, rotation: 0 });
      ctx.bezierCurveTo(out.x, out.y, inn.x, inn.y, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawSmallBallMarker(pose) {
    var canvasPose = metersToCanvas(pose);
    var radius = Math.max(4, fieldScale * 0.12);
    ctx.save();
    ctx.globalAlpha = 0.9;
    drawBallFace(canvasPose.x, canvasPose.y, radius, false);
    ctx.restore();
  }

  function drawDribbleMarkers(boatSegment, startArc) {
    startArc = Math.max(0, startArc || 0);
    var arcData = getSegmentArcData(boatSegment);
    var throwDistance = getDribbleThrowDistance(boatSegment);
    var remainingLength = arcData.total - startArc;
    if (remainingLength <= throwDistance) return;
    var driveStart = startArc + getDribbleDriveStart(remainingLength, throwDistance);
    var dist = startArc + throwDistance;
    while (dist <= driveStart + 1e-6) {
      drawSmallBallMarker(poseAtArcDistance(boatSegment, dist, arcData));
      dist += throwDistance;
    }
  }

  function drawPassTargetHighlights() {
    var highlightTool = state.tool && (
      state.tool.mode === 'pass'
      || (state.tool.mode === 'vaarlijn' && state.tool.phase === 'receiver')
    );
    var highlightDrag = state.drag && state.drag.mode === 'ball-route';
    if (!highlightTool && !highlightDrag) return;
    var poses = getPosesAtTime();
    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      var pose = poses[entity.id] || entity.initial;
      var canvasPose = metersToCanvas(pose);
      var isTarget = (state.tool && state.tool.targetEntityId === entity.id)
        || (state.drag && state.drag.passTarget && state.drag.passTarget.boatId === entity.id);
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvasPose.x, canvasPose.y, Math.max(14, fieldScale * 0.45), 0, Math.PI * 2);
      ctx.strokeStyle = isTarget ? 'rgba(34, 211, 238, 0.95)' : 'rgba(34, 211, 238, 0.35)';
      ctx.lineWidth = isTarget ? 2.5 : 1.5;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawControlHandle(point, active) {
    var canvasPoint = metersToCanvas({ x: point.x, y: point.y, rotation: 0 });
    var size = Math.max(8, fieldScale * 0.24);
    var x = canvasPoint.x;
    var y = canvasPoint.y;
    ctx.save();
    // Ruitvorm: duidelijk een handle, niet te verwarren met de bal.
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fillStyle = active ? '#e0f2fe' : '#94a3b8';
    ctx.fill();
    ctx.strokeStyle = active ? '#0ea5e9' : '#334155';
    ctx.lineWidth = active ? 2.25 : 1.75;
    ctx.stroke();
    // Kleine grip-kruis om “sleepbaar” te signaleren.
    var grip = size * 0.35;
    ctx.beginPath();
    ctx.moveTo(x - grip, y);
    ctx.lineTo(x + grip, y);
    ctx.moveTo(x, y - grip);
    ctx.lineTo(x, y + grip);
    ctx.strokeStyle = active ? 'rgba(14, 165, 233, 0.9)' : 'rgba(15, 23, 42, 0.45)';
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawGhostEntity(entity, pose, selected) {
    ctx.save();
    ctx.globalAlpha = selected ? 0.55 : 0.4;
    var canvasPose = metersToCanvas(pose);
    if (entity.type === 'ball') drawBall(canvasPose);
    else drawBoat(canvasPose, entity, !!selected);
    ctx.restore();
  }

  function getGhostPose(entityId) {
    if (state.tool && state.tool.entityId === entityId && state.tool.previewPose) {
      if (state.tool.mode === 'vaar') return state.tool.previewPose;
    }
    if (state.drag && state.drag.entityId === entityId && state.drag.previewPose) {
      if (state.drag.mode === 'route' || state.drag.mode === 'ghost') return state.drag.previewPose;
    }
    var segment = getPrimarySegment(entityId);
    if (!segment) return null;
    if (entityId === 'ball') return getEffectiveBallEndPose(segment);
    return segment.endPose;
  }

  function drawEntityRoutes() {
    if (state.playbackMode) return;
    var holderId = getBallHolderId();

    if (state.drag && state.drag.mode === 'ball-route' && state.drag.previewPose) {
      var dragPassTarget = null;
      if (state.drag.holderId || getBallHolderId()) {
        var passerId = resolveBallPasserId(state.drag.startPose, state.drag.holderId);
        var previewCanvas = metersToCanvas(state.drag.previewPose);
        dragPassTarget = resolveBallPassTargetAtCanvasPoint(
          previewCanvas.x,
          previewCanvas.y,
          getHolderTeam(passerId),
          passerId
        );
      }
      var previewEnd = dragPassTarget ? dragPassTarget.targetPose : state.drag.previewPose;
      var previewStyle = dragPassTarget
        ? getBallRouteStyle({ passType: dragPassTarget.passType || 'direct' })
        : getBallRouteStyle({ passType: 'free' });
      drawRoutePath(
        state.drag.startPose,
        previewEnd,
        null,
        true,
        previewStyle
      );
      if (dragPassTarget && dragPassTarget.passType === 'route') {
        drawSmallBallMarker(dragPassTarget.targetPose);
      }
    }

    state.tactic.entities.forEach(function (entity) {
      var selected = isEntityHighlighted(entity.id);
      var draggingRoute = state.drag && state.drag.mode === 'route' && state.drag.entityId === entity.id;
      var toolingVaar = state.tool && state.tool.mode === 'vaar' && state.tool.entityId === entity.id;
      var toolingPass = state.tool && (state.tool.mode === 'pass' || state.tool.mode === 'vaarlijn')
        && state.tool.entityId === entity.id;

      if (draggingRoute && state.drag.previewPose) {
        var dragControls = entity.type === 'boat'
          ? boatRouteControls(
            state.drag.startPose,
            state.drag.previewPose,
            state.drag.startPose.rotation,
            state.drag.previewPose.rotation
          )
          : null;
        drawRoutePath(state.drag.startPose, state.drag.previewPose, dragControls, true);
        return;
      }

      if (toolingVaar && state.tool.previewPose) {
        var toolControls = entity.type === 'boat'
          ? boatRouteControls(
            state.tool.startPose,
            state.tool.previewPose,
            state.tool.startPose.rotation,
            state.tool.previewPose.rotation
          )
          : null;
        drawRoutePath(state.tool.startPose, state.tool.previewPose, toolControls, true);
        if (!state.tool.hasSegment) return;
      }

      if (toolingPass && state.tool.previewPose) {
        var passStyle = state.tool.mode === 'pass'
          ? getBallRouteStyle({ passType: 'direct' })
          : getBallRouteStyle({ passType: 'space' });
        drawRoutePath(state.tool.startPose, state.tool.previewPose, null, true, passStyle);
        if (state.tool.mode === 'vaarlijn' && state.tool.phase === 'receiver') {
          drawSmallBallMarker(state.tool.previewPose);
        }
        return;
      }

      var segment = getPrimarySegment(entity.id);
      if (!segment) return;
      if (toolingVaar && state.tool.previewPose) return;
      var endPose = getGhostPose(entity.id) || segment.endPose;
      var controls = entity.type === 'boat' ? resolveRouteControls(segment) : null;
      var routeStyle = entity.type === 'ball' ? getBallRouteStyle(segment) : null;
      drawRoutePath(segment.startPose, endPose, controls, selected, routeStyle);

      if (entity.type === 'boat') {
        var dribbleStartArc = getDribbleStartArcForEntity(entity.id, segment);
        if (dribbleStartArc != null) {
          drawDribbleMarkers(segment, dribbleStartArc);
        }
      }

      var ballSegment = getPrimarySegment('ball');
      if (entity.type === 'boat' && ballSegment
        && ballSegment.syncToEntityId === entity.id
        && (ballSegment.syncPathProgress != null || ballSegment.syncArcDistance != null)) {
        var meetPose = getRoutePassMeetPose(ballSegment, segment);
        if (meetPose) drawSmallBallMarker(meetPose);
      }
    });
  }

  function drawPersistentGhosts() {
    if (state.playbackMode) return;
    state.tactic.entities.forEach(function (entity) {
      var selected = isEntityHighlighted(entity.id);
      var ghostPose = getGhostPose(entity.id);
      if (!ghostPose) return;
      if (state.drag && state.drag.mode === 'route' && state.drag.entityId === entity.id && !state.drag.previewPose) {
        return;
      }
      if (state.tool && state.tool.mode === 'vaar' && state.tool.entityId === entity.id && !state.tool.previewPose) {
        return;
      }
      drawGhostEntity(entity, ghostPose, selected);
    });
  }

  function drawSelectedControlHandles() {
    if (state.playbackMode) return;
    if (state.tool) return;
    state.tactic.entities.forEach(function (entity) {
      if (entity.type !== 'boat') return;
      if (state.drag && state.drag.mode === 'route' && state.drag.entityId === entity.id) return;
      var segment = getPrimarySegment(entity.id);
      if (!segment || !hasRouteControls(segment)) return;
      var bending = state.drag && state.drag.mode === 'bend' && state.drag.entityId === entity.id;
      drawControlHandle(getBendHandlePoint(segment), bending);
    });
  }

  function renderCanvas() {
    updateFieldScale();

    var size = viewSizeMeters();
    var pad = canvasPadding();
    var width = size.width * fieldScale + pad * 2;
    var height = size.height * fieldScale + pad * 2;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#082f49';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#0f766e';
    var pitchRadius = isPhoneLayout() ? 0 : 14;
    roundRect(ctx, pad, pad, size.width * fieldScale, size.height * fieldScale, pitchRadius);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = isPhoneLayout() ? 2 : 3;
    ctx.stroke();

    var settings = getSettings();
    drawEdgeMarks(LINE_4M);
    drawEdgeMarks(LINE_6M);
    if (settings.showLine4m) {
      drawDashedMeterLine(LINE_4M);
    }
    if (settings.showLine6m) {
      drawDashedMeterLine(LINE_6M);
    }

    if (isHalfField()) {
      ctx.fillStyle = 'rgba(203,213,225,0.55)';
      ctx.fillRect(
        canvasPadding(),
        canvasPadding() + HALF_LENGTH * fieldScale - 1,
        FIELD_WIDTH * fieldScale,
        2
      );
    } else {
      ctx.fillStyle = 'rgba(203,213,225,0.55)';
      ctx.fillRect(
        canvasPadding() + HALF_LENGTH * fieldScale - 1,
        canvasPadding(),
        2,
        FIELD_WIDTH * fieldScale
      );
    }

    drawGoal();
    drawEntityRoutes();
    drawPassTargetHighlights();

    var poses = getDisplayPoses();
    var holderId = getBallHolderId();
    state.tactic.entities.forEach(function (entity) {
      var sourcePose = poses[entity.id] || entity.initial;
      if (state.tool && state.tool.entityId === entity.id) {
        if (state.tool.mode === 'draai' && state.tool.previewRotation != null) {
          sourcePose = {
            x: sourcePose.x,
            y: sourcePose.y,
            rotation: state.tool.previewRotation,
          };
        }
      }
      var selected = isEntityHighlighted(entity.id);
      var pose = metersToCanvas(sourcePose);
      if (entity.type === 'ball') {
        drawBall(pose, selected);
      } else {
        drawBoat(pose, entity, selected);
      }
    });

    if (state.tool && state.tool.mode === 'teleport' && state.tool.previewPose) {
      var teleportEntity = state.tactic.entities.find(function (item) {
        return item.id === state.tool.entityId;
      });
      if (teleportEntity) {
        drawGhostEntity(teleportEntity, state.tool.previewPose, true);
      }
    }

    drawPersistentGhosts();
    drawSelectedControlHandles();

    if (state.isPlaying || state.transport.playing) {
      syncGoalTracking(true);
    }

    drawConfetti();
  }

  function createSelect(label, value, options, onChange) {
    var row = document.createElement('div');
    row.className = 'field-row';
    var lab = document.createElement('label');
    lab.textContent = label;
    var select = document.createElement('select');
    options.forEach(function (option) {
      var opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      if (String(option.value) === String(value)) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () { onChange(select.value); });
    row.appendChild(lab);
    row.appendChild(select);
    return row;
  }

  function createCheckbox(label, checked, onChange) {
    var row = document.createElement('div');
    row.className = 'field-row inline';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    var lab = document.createElement('label');
    lab.textContent = label;
    input.addEventListener('change', function () { onChange(input.checked); });
    lab.addEventListener('click', function () { input.click(); });
    row.appendChild(input);
    row.appendChild(lab);
    return row;
  }

  function createNumber(label, value, min, max, onChange, step) {
    var row = document.createElement('div');
    row.className = 'field-row';
    var lab = document.createElement('label');
    lab.textContent = label;
    var input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    if (step != null) input.step = String(step);
    input.value = String(value);
    input.addEventListener('change', function () {
      onChange(clamp(Number(input.value) || min, min, max));
    });
    row.appendChild(lab);
    row.appendChild(input);
    return row;
  }

  function createTeamSection(title, teamKey) {
    var section = document.createElement('section');
    section.className = 'settings-section';
    var settings = getSettings();
    var enabled = teamKey === 'attack' ? settings.showAttack : settings.showDefense;
    var team = settings[teamKey];

    var heading = document.createElement('div');
    heading.className = 'settings-section-heading';
    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!enabled;
    toggle.setAttribute('aria-label', title);
    var headingLabel = document.createElement('label');
    headingLabel.textContent = title;
    toggle.addEventListener('change', function () {
      clearHistory();
      if (teamKey === 'attack') {
        getSettings().showAttack = toggle.checked;
      } else {
        getSettings().showDefense = toggle.checked;
      }
      applyFormationReset(state.tactic);
      renderAll();
    });
    headingLabel.addEventListener('click', function () { toggle.click(); });
    heading.appendChild(toggle);
    heading.appendChild(headingLabel);
    section.appendChild(heading);

    if (!enabled) return section;

    if (teamKey === 'defense') {
      section.appendChild(createSelect(t('settings.formation'), settings.defenseFormation, [
        { value: '1-3-1', label: '1-3-1' },
        { value: '1-2-2', label: '1-2-2' },
      ], function (value) {
        clearHistory();
        getSettings().defenseFormation = value;
        applyFormationReset(state.tactic);
        renderAll();
      }));
    } else {
      section.appendChild(createSelect(t('settings.formation'), settings.attackFormation, [
        { value: 'midline', label: t('settings.formation.midline') },
        { value: 'fan', label: t('settings.formation.fan') },
      ], function (value) {
        clearHistory();
        getSettings().attackFormation = value;
        applyFormationReset(state.tactic);
        renderAll();
      }));
    }

    section.appendChild(createNumber(t('settings.boatCount'), team.boatCount, 1, 10, function (value) {
      clearHistory();
      getSettings()[teamKey].boatCount = value;
      applyFormationReset(state.tactic);
      renderAll();
    }));

    var colorLabel = document.createElement('div');
    colorLabel.className = 'field-row';
    colorLabel.innerHTML = '<label>' + t('settings.colors') + '</label>';
    section.appendChild(colorLabel);

    var colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    // Primary (bow) left, secondary (stern) right.
    team.colors.forEach(function (color, index) {
      var input = document.createElement('input');
      input.type = 'color';
      input.value = toColorInput(color);
      input.title = index === 0 ? t('settings.primaryColor') : t('settings.secondaryColor');
      input.addEventListener('input', function () {
        getSettings()[teamKey].colors[index] = input.value;
        applyTeamColors(teamKey);
        renderAll();
      });
      colorRow.appendChild(input);
    });

    if (team.colors.length < 2) {
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn';
      addBtn.textContent = t('settings.addColor');
      addBtn.addEventListener('click', function () {
        getSettings()[teamKey].colors.push(teamKey === 'attack' ? '#facc15' : '#f8fafc');
        applyTeamColors(teamKey);
        renderAll();
      });
      colorRow.appendChild(addBtn);
    } else {
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn';
      removeBtn.textContent = t('settings.removeColor');
      removeBtn.addEventListener('click', function () {
        getSettings()[teamKey].colors = [getSettings()[teamKey].colors[0]];
        applyTeamColors(teamKey);
        renderAll();
      });
      colorRow.appendChild(removeBtn);
    }

    section.appendChild(colorRow);
    return section;
  }

  function toColorInput(color) {
    if (!color) return '#94a3b8';
    if (color.length === 4 && color[0] === '#') {
      return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color;
  }

  function applyTeamColors(teamKey) {
    var colors = getSettings()[teamKey].colors.slice();
    state.tactic.entities.forEach(function (entity) {
      if (entity.team !== teamKey) return;
      entity.colors = colors.slice();
      entity.color = colors[0];
    });
    state.tactic.updatedAt = new Date().toISOString();
  }

  function renderSettings() {
    var backdrop = document.getElementById('settings-backdrop');
    if (!state.settingsOpen) {
      backdrop.classList.add('hidden');
      return;
    }
    backdrop.classList.remove('hidden');
    var body = document.getElementById('settings-body');
    body.innerHTML = '';
    var settings = getSettings();

    var langSection = document.createElement('section');
    langSection.className = 'settings-section';
    langSection.innerHTML = '<h3>' + t('settings.language') + '</h3>';
    langSection.appendChild(createSelect(t('settings.language'), FlowboardI18n.getLocalePreference(), [
      { value: FlowboardI18n.AUTO, label: t('lang.auto') },
      { value: 'en', label: t('lang.en') },
      { value: 'nl', label: t('lang.nl') },
      { value: 'de', label: t('lang.de') },
      { value: 'fr', label: t('lang.fr') },
      { value: 'it', label: t('lang.it') },
      { value: 'es', label: t('lang.es') },
    ], function (value) {
      FlowboardI18n.setLocale(value);
    }));
    body.appendChild(langSection);

    var fieldSection = document.createElement('section');
    fieldSection.className = 'settings-section';
    fieldSection.innerHTML = '<h3>' + t('settings.field') + '</h3>';
    fieldSection.appendChild(createSelect(t('settings.display'), settings.fieldMode, [
      { value: 'half', label: t('settings.field.half') },
      { value: 'full', label: t('settings.field.full') },
    ], function (value) {
      getSettings().fieldMode = value;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox(t('settings.line4m'), settings.showLine4m, function (checked) {
      getSettings().showLine4m = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox(t('settings.line6m'), settings.showLine6m, function (checked) {
      getSettings().showLine6m = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox(t('settings.showNumbers'), settings.showNumbers, function (checked) {
      getSettings().showNumbers = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    body.appendChild(fieldSection);
    body.appendChild(createTeamSection(t('settings.defenseTeam'), 'defense'));
    body.appendChild(createTeamSection(t('settings.attackTeam'), 'attack'));

    var motionSection = document.createElement('section');
    motionSection.className = 'settings-section';

    var motionHeading = document.createElement('div');
    motionHeading.className = 'settings-section-heading';
    var motionTitle = document.createElement('h3');
    motionTitle.className = 'settings-section-title';
    motionTitle.textContent = t('settings.advanced');
    motionHeading.appendChild(motionTitle);
    var restoreMotionBtn = document.createElement('button');
    restoreMotionBtn.type = 'button';
    restoreMotionBtn.className = 'btn';
    restoreMotionBtn.textContent = t('settings.restoreDefaults');
    restoreMotionBtn.addEventListener('click', function () {
      var defaults = defaultSettings();
      var next = getSettings();
      next.motionTimingMode = defaults.motionTimingMode;
      next.boatSpeedSyncArrival = defaults.boatSpeedSyncArrival;
      next.stepDuration = defaults.stepDuration;
      next.boatSpeed = defaults.boatSpeed;
      next.boatAcceleration = defaults.boatAcceleration;
      next.boatRotationSpeed = defaults.boatRotationSpeed;
      next.ballSpeed = defaults.ballSpeed;
      recomputeAllSegmentDurations();
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    });
    motionHeading.appendChild(restoreMotionBtn);
    motionSection.appendChild(motionHeading);

    function updateMotionSetting(key, value) {
      getSettings()[key] = value;
      recomputeAllSegmentDurations();
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }

    motionSection.appendChild(createSelect(t('settings.timing'), settings.motionTimingMode, [
      { value: 'boatSpeed', label: t('settings.boatSpeed') },
      { value: 'stepDuration', label: t('settings.stepDuration') },
    ], function (value) {
      updateMotionSetting('motionTimingMode', value === 'stepDuration' ? 'stepDuration' : 'boatSpeed');
    }));

    if (settings.motionTimingMode === 'stepDuration') {
      motionSection.appendChild(createNumber(
        t('settings.stepDurationSec'),
        settings.stepDuration,
        0.25,
        30,
        function (value) { updateMotionSetting('stepDuration', value); },
        0.25
      ));
      motionSection.appendChild(createNumber(
        t('settings.boatAccel'),
        settings.boatAcceleration,
        1,
        72,
        function (value) { updateMotionSetting('boatAcceleration', value); },
        0.5
      ));
    } else {
      motionSection.appendChild(createCheckbox(
        t('settings.syncArrival'),
        settings.boatSpeedSyncArrival !== false,
        function (checked) { updateMotionSetting('boatSpeedSyncArrival', checked); }
      ));
      motionSection.appendChild(createNumber(
        t('settings.boatSpeedKmh'),
        settings.boatSpeed,
        1,
        40,
        function (value) { updateMotionSetting('boatSpeed', value); },
        0.5
      ));
      motionSection.appendChild(createNumber(
        t('settings.boatAccel'),
        settings.boatAcceleration,
        1,
        72,
        function (value) { updateMotionSetting('boatAcceleration', value); },
        0.5
      ));
      motionSection.appendChild(createNumber(
        t('settings.rotationSpeed'),
        settings.boatRotationSpeed,
        15,
        360,
        function (value) { updateMotionSetting('boatRotationSpeed', value); },
        5
      ));
      motionSection.appendChild(createNumber(
        t('settings.ballSpeed'),
        settings.ballSpeed,
        1,
        80,
        function (value) { updateMotionSetting('ballSpeed', value); },
        0.5
      ));
    }
    body.appendChild(motionSection);
  }

  function renderAll() {
    persistTactic();
    renderCanvas();
    renderSettings();
    renderShortcutsDialog();
    updateToolbar();
  }

  function rotationTowardPoint(fromPose, metersPoint) {
    return rotationFromTangent(
      metersPoint.x - fromPose.x,
      metersPoint.y - fromPose.y,
      fromPose.rotation
    );
  }

  function startBoatTool(mode, entityId) {
    entityId = entityId || getFocusedEntityId();
    if (!canEdit() || !entityId) return;
    if (state.startPoseEdit && mode === 'vaar') return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity) return;
    if (mode === 'draai' && entity.type !== 'boat') return;
    if (mode === 'cancel') {
      clearEntityRoute(entityId);
      return;
    }
    collapseStepsSheet();

    var poses = getPosesAtTime();
    var livePose = clone(poses[entityId] || entity.initial);
    var segment = getPrimarySegment(entityId);

    if (mode === 'vaar') {
      state.tool = {
        mode: 'vaar',
        entityId: entityId,
        startPose: segment ? clone(segment.startPose) : livePose,
        previewPose: null,
        keptRotation: segment && entity.type === 'boat' ? segment.endPose.rotation : null,
        hasSegment: !!segment,
      };
    } else if (mode === 'pass') {
      if (entity.type !== 'ball') return;
      state.tool = {
        mode: 'pass',
        entityId: entityId,
        startPose: getBallStartPose(),
        previewPose: null,
        targetEntityId: null,
      };
      setMessage(t('message.passNoRoute'));
    } else if (mode === 'vaarlijn') {
      if (entity.type !== 'ball') return;
      state.tool = {
        mode: 'vaarlijn',
        entityId: entityId,
        phase: 'point',
        startPose: getBallStartPose(),
        previewPose: null,
        endPose: null,
        syncToEntityId: null,
        targetEntityId: null,
      };
    } else if (mode === 'draai') {
      state.tool = {
        mode: 'draai',
        entityId: entityId,
        basePose: livePose,
        previewRotation: livePose.rotation,
      };
    } else if (mode === 'teleport') {
      state.tool = {
        mode: 'teleport',
        entityId: entityId,
        previewPose: null,
        keptRotation: entity.initial.rotation,
      };
    } else {
      return;
    }

    canvas.classList.add('tool-active');
    renderAll();
  }

  function updateToolPreview(point) {
    var tool = state.tool;
    if (!tool) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === tool.entityId; });
    if (!entity) return;

    if (tool.mode === 'vaar') {
      var vaarMeters = canvasToMeters(point.x, point.y, tool.startPose.rotation);
      tool.previewPose = previewEndPose(entity, tool.startPose, vaarMeters, tool.keptRotation);
      renderCanvas();
      return;
    }

    if (tool.mode === 'pass') {
      var passBoatId = getBoatAtCanvasPoint(point.x, point.y);
      if (passBoatId) {
        var passTarget = getBoatTargetPose(passBoatId);
        tool.previewPose = { x: passTarget.x, y: passTarget.y, rotation: 0 };
        tool.targetEntityId = passBoatId;
      } else {
        tool.previewPose = null;
        tool.targetEntityId = null;
      }
      renderCanvas();
      return;
    }

    if (tool.mode === 'vaarlijn') {
      var vaarlijnMeters = canvasToMeters(point.x, point.y, 0);
      var clampedPoint = clampPoseToField({
        x: vaarlijnMeters.x,
        y: vaarlijnMeters.y,
        rotation: 0,
      });
      if (tool.phase === 'point') {
        tool.previewPose = clampedPoint;
      } else {
        tool.targetEntityId = getBoatAtCanvasPoint(point.x, point.y);
        if (tool.endPose) tool.previewPose = clone(tool.endPose);
      }
      renderCanvas();
      return;
    }

    if (tool.mode === 'draai') {
      var draaiMeters = canvasToMeters(point.x, point.y, tool.basePose.rotation);
      tool.previewRotation = rotationTowardPoint(tool.basePose, draaiMeters);
      renderCanvas();
      return;
    }

    if (tool.mode === 'teleport') {
      var teleMeters = canvasToMeters(point.x, point.y, tool.keptRotation);
      tool.previewPose = clampPoseToField({
        x: teleMeters.x,
        y: teleMeters.y,
        rotation: tool.keptRotation,
      });
      renderCanvas();
    }
  }

  function confirmToolAtPoint(point, options) {
    var tool = state.tool;
    if (!tool || !canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === tool.entityId; });
    if (!entity) {
      clearTool();
      renderAll();
      return;
    }

    if (!(options && options.keepPreview)) {
      updateToolPreview(point);
    }

    if (tool.mode === 'vaar') {
      var endPose = tool.previewPose;
      if (!endPose || distanceMeters(tool.startPose, endPose) < 0.35) {
        clearTool();
        renderAll();
        return;
      }
      if (entity.type === 'ball') {
        var ballStart = tool.startPose;
        clearTool();
        if (tool.hasSegment) {
          recordHistory();
          updateBallSegmentEndPose(endPose);
        } else {
          createBallRouteSegment(ballStart, endPose, { passType: 'free' });
        }
        renderAll();
        return;
      }
      if (tool.hasSegment) {
        recordHistory();
        updateSegmentEndPose(tool.entityId, endPose);
        clearTool();
        renderAll();
      } else {
        var startPose = tool.startPose;
        var entityId = tool.entityId;
        clearTool();
        createRouteSegment(entityId, startPose, endPose);
        renderAll();
      }
      return;
    }

    if (tool.mode === 'pass') {
      var passBoatId = getBoatAtCanvasPoint(point.x, point.y);
      if (!passBoatId) {
        setMessage(t('message.passNoRoute'));
        renderAll();
        return;
      }
      var passTargetPose = getBoatTargetPose(passBoatId);
      var passStart = tool.startPose;
      clearTool();
      createBallRouteSegment(passStart, passTargetPose, {
        passType: 'direct',
        targetEntityId: passBoatId,
        syncToEntityId: passBoatId,
      });
      if (!getPrimarySegment(passBoatId)) {
        setMessage(t('message.syncNoBoatRoute'));
      }
      return;
    }

    if (tool.mode === 'vaarlijn') {
      if (tool.phase === 'point') {
        var vaarlijnEnd = tool.previewPose;
        if (!vaarlijnEnd || distanceMeters(tool.startPose, vaarlijnEnd) < 0.35) {
          clearTool();
          renderAll();
          return;
        }
        tool.endPose = clone(vaarlijnEnd);
        tool.previewPose = clone(vaarlijnEnd);
        tool.phase = 'receiver';
        tool.targetEntityId = null;
        tool.syncToEntityId = null;
        setMessage(t('message.vaarlijnSelectReceiver'));
        renderAll();
        return;
      }

      var syncBoatId = getBoatAtCanvasPoint(point.x, point.y);
      var vaarlijnStart = tool.startPose;
      var vaarlijnTarget = tool.endPose;
      clearTool();
      createBallRouteSegment(vaarlijnStart, vaarlijnTarget, {
        passType: 'space',
        targetEntityId: syncBoatId,
        syncToEntityId: syncBoatId,
      });
      if (syncBoatId && !getPrimarySegment(syncBoatId)) {
        setMessage(t('message.syncNoBoatRoute'));
      }
      return;
    }

    if (tool.mode === 'draai') {
      var rotation = tool.previewRotation;
      if (rotation == null) rotation = entity.initial.rotation;
      recordHistory();
      entity.initial.rotation = rotation;
      var segment = getPrimarySegment(tool.entityId);
      if (segment) {
        segment.startPose.rotation = rotation;
        recomputeAllSegmentDurations();
      }
      syncCurrentStepPoses();
      state.tactic.updatedAt = new Date().toISOString();
      clearTool();
      renderAll();
      return;
    }

    if (tool.mode === 'teleport') {
      var dest = tool.previewPose;
      if (!dest) {
        clearTool();
        renderAll();
        return;
      }
      recordHistory();
      entity.initial.x = dest.x;
      entity.initial.y = dest.y;
      entity.initial.rotation = tool.keptRotation;
      var track = getTrackForEntity(tool.entityId);
      track.segments = [];
      if (entity.type === 'boat') retargetBallRouteForLinkedBoat(tool.entityId);
      syncCurrentStepPoses();
      recomputeAllSegmentDurations();
      state.tactic.updatedAt = new Date().toISOString();
      clearTool();
      renderAll();
    }
  }

  function hitTestPose(entity, pose, x, y) {
    var canvasPose = metersToCanvas(pose);
    var minHit = MIN_ENTITY_HIT_PX;
    if (entity.type === 'ball') {
      var ballHit = Math.max(minHit, (BALL_DIAMETER * fieldScale) / 2 + 4);
      return Math.hypot(x - canvasPose.x, y - canvasPose.y) <= ballHit;
    }
    var halfLength = Math.max(minHit, (BOAT_LENGTH * fieldScale) / 2 + 4);
    var halfWidth = Math.max(minHit * 0.55, (BOAT_WIDTH * fieldScale) / 2 + 4);
    var dx = x - canvasPose.x;
    var dy = y - canvasPose.y;
    var rad = (-canvasPose.rotation * Math.PI) / 180;
    var localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    var localY = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(localX) <= halfLength && Math.abs(localY) <= halfWidth;
  }

  function getGhostAtCanvasPoint(x, y) {
    for (var i = state.tactic.entities.length - 1; i >= 0; i--) {
      var entity = state.tactic.entities[i];
      var ghostPose = getGhostPose(entity.id);
      if (!ghostPose) continue;
      if (hitTestPose(entity, ghostPose, x, y)) return entity.id;
    }
    return null;
  }

  function getEntityAtCanvasPoint(x, y) {
    var poses = getPosesAtTime();
    for (var i = state.tactic.entities.length - 1; i >= 0; i--) {
      var entity = state.tactic.entities[i];
      var pose = poses[entity.id] || entity.initial;
      if (hitTestPose(entity, pose, x, y)) return entity.id;
    }
    return null;
  }

  function getBoatAtCanvasPoint(x, y) {
    var poses = getPosesAtTime();
    for (var i = state.tactic.entities.length - 1; i >= 0; i--) {
      var entity = state.tactic.entities[i];
      if (entity.type !== 'boat') continue;
      var pose = poses[entity.id] || entity.initial;
      if (hitTestPose(entity, pose, x, y)) return entity.id;
    }
    return null;
  }

  function updateBallSegmentEndPose(endPose, passTarget) {
    var segment = getPrimarySegment('ball');
    if (!segment) return;
    endPose = clampPoseToField(endPose);
    if (distanceMeters(segment.startPose, endPose) < 0.35) return;

    if (passTarget === undefined) {
      passTarget = resolveBallRetargetAtEndPose(segment, endPose);
    }

    if (passTarget) {
      var targetPose = clampPoseToField(passTarget.targetPose || endPose);
      segment.passType = passTarget.passType || 'direct';
      segment.targetEntityId = passTarget.boatId || null;
      segment.syncToEntityId = passTarget.syncToEntityId || null;
      segment.syncArcDistance = passTarget.syncArcDistance != null ? passTarget.syncArcDistance : null;
      segment.syncPathProgress = passTarget.syncPathProgress != null ? passTarget.syncPathProgress : null;
      segment.endPose = { x: targetPose.x, y: targetPose.y, rotation: 0 };
    } else {
      segment.passType = 'free';
      segment.targetEntityId = null;
      segment.syncToEntityId = null;
      segment.syncArcDistance = null;
      segment.syncPathProgress = null;
      segment.endPose = { x: endPose.x, y: endPose.y, rotation: 0 };
      setBallHolderId(null);
    }

    recomputeAllSegmentDurations();
    if (isFreeBallRoute(segment)) refreshAllBoatBallClaims();
    state.tactic.updatedAt = new Date().toISOString();
  }

  function resolveBallRetargetAtEndPose(segment, endPose, canvasPoint) {
    if (!segment || !endPose) return null;
    var canvas = canvasPoint || metersToCanvas(endPose);
    var passerId = resolveBallPasserId(segment.startPose, getBallHolderId());
    if (!passerId) return null;
    return resolveBallPassTargetAtCanvasPoint(
      canvas.x,
      canvas.y,
      getHolderTeam(passerId),
      passerId
    );
  }

  function resolveBallGhostDragTarget(drag, point, meters) {
    var freePose = clampPoseToField({
      x: meters.x,
      y: meters.y,
      rotation: 0,
    });
    var passerId = resolveBallPasserId(drag.startPose, getBallHolderId());
    var passTarget = passerId
      ? resolveBallPassTargetAtCanvasPoint(
        point.x,
        point.y,
        getHolderTeam(passerId),
        passerId
      )
      : null;
    return {
      previewPose: passTarget ? clone(passTarget.targetPose) : freePose,
      passTarget: passTarget,
    };
  }

  function getBallLinkedBoatId(ballSeg) {
    if (!ballSeg) return null;
    return ballSeg.targetEntityId || ballSeg.syncToEntityId || null;
  }

  function isRouteSyncedBallPass(ballSeg) {
    return !!(ballSeg
      && ballSeg.syncToEntityId
      && (ballSeg.syncPathProgress != null || ballSeg.syncArcDistance != null));
  }

  function getRoutePassMeetPose(ballSeg, boatSeg) {
    if (!ballSeg || !boatSeg) return null;
    if (ballSeg.syncPathProgress != null) {
      return poseAlongSegment(boatSeg, clamp(ballSeg.syncPathProgress, 0, 1), null);
    }
    if (ballSeg.syncArcDistance != null) {
      return poseAtArcDistance(boatSeg, ballSeg.syncArcDistance);
    }
    return null;
  }

  function refreshRoutePassArcDistance(ballSeg, boatSeg) {
    if (!ballSeg || !boatSeg || ballSeg.syncPathProgress == null) return;
    var arcData = getSegmentArcData(boatSeg);
    ballSeg.syncArcDistance = arcDistanceAtProgress(
      arcData,
      clamp(ballSeg.syncPathProgress, 0, 1)
    );
  }

  function getEffectiveBallEndPose(ballSeg) {
    if (!ballSeg) return null;
    if (ballSeg.passType === 'free' || ballSeg.passType === 'space') {
      return ballSeg.endPose;
    }
    var boatId = getBallLinkedBoatId(ballSeg);
    if (!boatId) return ballSeg.endPose;

    if (isRouteSyncedBallPass(ballSeg)) {
      var routeBoatSeg = getPrimarySegment(boatId);
      if (routeBoatSeg) {
        var meetPose = getRoutePassMeetPose(ballSeg, routeBoatSeg);
        if (meetPose) return clampPoseToField(meetPose);
      }
    }

    if (ballSeg.passType === 'direct' || ballSeg.targetEntityId || ballSeg.syncToEntityId) {
      return getBoatTargetPose(boatId);
    }
    return ballSeg.endPose;
  }

  function syncLinkedBallRouteGeometry() {
    var ballSeg = getPrimarySegment('ball');
    if (!ballSeg) return false;
    if (ballSeg.passType === 'free' || ballSeg.passType === 'space') return false;

    var boatId = getBallLinkedBoatId(ballSeg);
    if (!boatId) return false;

    if (isRouteSyncedBallPass(ballSeg)) {
      var boatSeg = getPrimarySegment(boatId);
      if (boatSeg) refreshRoutePassArcDistance(ballSeg, boatSeg);
    }

    var liveEnd = getEffectiveBallEndPose(ballSeg);
    if (!liveEnd) return false;
    if (ballSeg.endPose
      && Math.abs(ballSeg.endPose.x - liveEnd.x) < 1e-6
      && Math.abs(ballSeg.endPose.y - liveEnd.y) < 1e-6) {
      return false;
    }
    ballSeg.endPose = { x: liveEnd.x, y: liveEnd.y, rotation: 0 };
    return true;
  }

  function retargetBallRouteForLinkedBoat(boatId) {
    var ballSeg = getPrimarySegment('ball');
    if (!ballSeg || getBallLinkedBoatId(ballSeg) !== boatId) return false;
    return syncLinkedBallRouteGeometry();
  }

  function getControlHandleAtCanvasPoint(x, y) {
    var hitRadius = Math.max(isPhoneLayout() ? 18 : 10, fieldScale * 0.3);
    for (var i = state.tactic.entities.length - 1; i >= 0; i--) {
      var entity = state.tactic.entities[i];
      if (entity.type !== 'boat') continue;
      var segment = getPrimarySegment(entity.id);
      if (!segment || !hasRouteControls(segment)) continue;
      var handle = getBendHandlePoint(segment);
      var point = metersToCanvas({
        x: handle.x,
        y: handle.y,
        rotation: 0,
      });
      if (Math.hypot(x - point.x, y - point.y) <= hitRadius) return entity.id;
    }
    return null;
  }

  function updateSegmentEndPose(entityId, endPose, passTarget) {
    if (!canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    var segment = getPrimarySegment(entityId);
    if (!entity || !segment) return;

    if (entity.type === 'ball') {
      updateBallSegmentEndPose(endPose, passTarget);
      return;
    }

    endPose = clampPoseToField(endPose);
    if (distanceMeters(segment.startPose, endPose) < 0.35) return;

    var keptRotation = segment.endPose.rotation;

    // controlOut blijft staan (starttangent); controlIn schuift mee met het eindpunt
    // zodat de bochtvorm behouden blijft — niet herbouwen via boatRouteControls,
    // want na een vrije knik kan controlIn ver liggen en gaf max(μ,λ) een S-bocht.
    if (hasRouteControls(segment)) {
      var existing = resolveRouteControls(segment);
      if (existing) {
        var endDelta = posePositionDelta(endPose, segment.endPose);
        applyRouteControls(segment, {
          controlOut: existing.controlOut,
          controlIn: {
            x: existing.controlIn.x + endDelta.dx,
            y: existing.controlIn.y + endDelta.dy,
          },
        });
      }
    }

    segment.endPose.x = endPose.x;
    segment.endPose.y = endPose.y;
    segment.endPose.rotation = keptRotation;
    retargetBallRouteForLinkedBoat(entityId);
    recomputeAllSegmentDurations();
    updateBallClaimOnRoute(entityId, segment.endPose);
    state.tactic.updatedAt = new Date().toISOString();
  }

  function createRouteSegment(entityId, startPose, endPose) {
    if (!canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity) return;

    endPose = clampPoseToField(endPose);
    if (distanceMeters(startPose, endPose) < 0.35) {
      renderAll();
      return;
    }

    recordHistory();
    var controls = null;
    var endRotation = 0;
    if (entity.type === 'boat') {
      controls = boatRouteControls(
        startPose,
        endPose,
        startPose.rotation,
        null,
        distanceMeters(startPose, endPose) / 3
      );
      endRotation = arrivalRotation(
        startPose,
        endPose,
        controls.controlOut,
        controls.controlIn,
        startPose.rotation
      );
    }
    var endPoseFull = {
      x: endPose.x,
      y: endPose.y,
      rotation: endRotation,
    };
    var track = getTrackForEntity(entityId);
    track.segments = [{
      startTime: 0,
      endTime: 0,
      startPose: {
        x: startPose.x,
        y: startPose.y,
        rotation: startPose.rotation,
      },
      endPose: endPoseFull,
      controlOut: controls ? controls.controlOut : null,
      controlIn: controls ? controls.controlIn : null,
    }];
    if (entity.type === 'boat') retargetBallRouteForLinkedBoat(entityId);
    recomputeAllSegmentDurations();

    if (entity.type === 'boat') {
      updateBallClaimOnRoute(entityId, endPoseFull);
    }

    state.tactic.updatedAt = new Date().toISOString();
    renderAll();
  }

  function updateSegmentControlPoint(entityId, point) {
    if (!canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    var segment = getPrimarySegment(entityId);
    if (!entity || entity.type !== 'boat' || !segment) return;

    // Sleep-dot tot aan de veldrand; controlIn mag daarbuiten.
    // Wegvaar-richting blijft vast via controlOut; aankomsthoek volgt de bocht.
    var handle = clampPointToField(point);
    var controls = controlsFromBendHandle(
      segment.startPose,
      segment.endPose,
      segment.startPose.rotation,
      resolveRouteControls(segment),
      handle
    );
    applyRouteControls(segment, controls);
    segment.endPose.rotation = arrivalRotation(
      segment.startPose,
      segment.endPose,
      controls.controlOut,
      controls.controlIn,
      segment.startPose.rotation
    );
    retargetBallRouteForLinkedBoat(entityId);
    recomputeAllSegmentDurations();
    updateBallClaimOnRoute(entityId, segment.endPose);
    state.tactic.updatedAt = new Date().toISOString();
  }

  function resetSegmentBend(entityId) {
    if (!canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    var segment = getPrimarySegment(entityId);
    if (!entity || entity.type !== 'boat' || !segment) return;

    recordHistory();
    var controls = boatRouteControls(
      segment.startPose,
      segment.endPose,
      segment.startPose.rotation,
      null,
      distanceMeters(segment.startPose, segment.endPose) / 3
    );
    applyRouteControls(segment, controls);
    segment.endPose.rotation = arrivalRotation(
      segment.startPose,
      segment.endPose,
      controls.controlOut,
      controls.controlIn,
      segment.startPose.rotation
    );
    retargetBallRouteForLinkedBoat(entityId);
    recomputeAllSegmentDurations();
    updateBallClaimOnRoute(entityId, segment.endPose);
    state.tactic.updatedAt = new Date().toISOString();
    renderAll();
  }

  function previewEndPose(entity, startPose, meters, keptRotation) {
    var end = clampPoseToField({
      x: meters.x,
      y: meters.y,
      rotation: startPose.rotation,
    });
    if (entity && entity.type === 'boat') {
      if (keptRotation != null) {
        end.rotation = keptRotation;
      } else {
        var controls = boatRouteControls(
          startPose,
          end,
          startPose.rotation,
          null,
          distanceMeters(startPose, end) / 3
        );
        end.rotation = arrivalRotation(
          startPose,
          end,
          controls.controlOut,
          controls.controlIn,
          startPose.rotation
        );
      }
    } else {
      end.rotation = 0;
    }
    return end;
  }

  function pointerToCanvas(event) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function setupCanvasDrag() {
    // Double-tap/klik op de knik-handle reset de bocht (ook op touch, naast dblclick).
    var lastBendTap = null;
    var bendResetAt = 0;

    function releaseCapture(event) {
      canvas.classList.remove('dragging');
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { /* noop */ }
    }

    function promotePending(event) {
      var pending = state.pendingPointer;
      if (!pending || pending.kind === 'select') return false;

      collapseStepsSheet();
      state.pendingPointer = null;

      if (pending.kind === 'freestyle') {
        var freestyleEntity = state.tactic.entities.find(function (item) {
          return item.id === pending.entityId;
        });
        state.drag = {
          mode: 'freestyle',
          entityId: pending.entityId,
          offsetX: pending.offsetX,
          offsetY: pending.offsetY,
          rotation: pending.rotation,
          originPose: freestyleEntity ? clone(freestyleEntity.initial) : null,
          startX: pending.x,
          startY: pending.y,
          previousHolderId: getBallHolderId(),
          ballRefPose: clone(getBallStartPose()),
        };
        // Til de bal los van de holder zodat hij zichtbaar meesleept.
        if (freestyleEntity && freestyleEntity.type === 'ball') {
          setBallHolderId(null);
          freestyleEntity.initial.x = state.drag.ballRefPose.x;
          freestyleEntity.initial.y = state.drag.ballRefPose.y;
          freestyleEntity.initial.rotation = 0;
        }
      } else if (pending.kind === 'ghost') {
        recordHistory();
        state.drag = {
          mode: 'ghost',
          entityId: pending.entityId,
          startPose: clone(pending.startPose),
          previewPose: clone(pending.previewPose),
          keptRotation: pending.keptRotation,
        };
      } else if (pending.kind === 'route') {
        var routeEntity = state.tactic.entities.find(function (item) {
          return item.id === pending.entityId;
        });
        if (routeEntity && routeEntity.type === 'ball') {
          state.drag = {
            mode: 'ball-route',
            startPose: clone(pending.startPose),
            holderId: getBallHolderId(),
            previewPose: null,
          };
        } else {
          state.drag = {
            mode: 'route',
            entityId: pending.entityId,
            startPose: clone(pending.startPose),
          };
        }
      } else if (pending.kind === 'ball-route') {
        state.drag = {
          mode: 'ball-route',
          startPose: clone(pending.startPose),
          holderId: pending.holderId,
          previewPose: null,
        };
      } else {
        return false;
      }

      canvas.classList.add('dragging');
      applyDragMove(event);
      return true;
    }

    function applyDragMove(event) {
      if (!state.drag) return;
      var point = pointerToCanvas(event);
      var entity = state.tactic.entities.find(function (item) { return item.id === state.drag.entityId; });

      if (state.drag.mode === 'freestyle') {
        if (!entity) return;
        var freestyleMeters = canvasToMeters(point.x, point.y, state.drag.rotation);
        var freestylePose = clampPoseToField({
          x: freestyleMeters.x + state.drag.offsetX,
          y: freestyleMeters.y + state.drag.offsetY,
          rotation: state.drag.rotation,
        });
        entity.initial.x = freestylePose.x;
        entity.initial.y = freestylePose.y;
        entity.initial.rotation = freestylePose.rotation;
        if (entity.type === 'ball') {
          setBallHolderId(null);
          entity.initial.rotation = 0;
          renderCanvas();
          return;
        }
        if (entity.type === 'boat' && retargetBallRouteForLinkedBoat(state.drag.entityId)) {
          recomputeAllSegmentDurations();
        }
        previewFreestyleBallSnap(state.drag, state.drag.entityId, freestylePose);
        renderCanvas();
        return;
      }

      var meters = canvasToMeters(point.x, point.y, state.drag.startPose ? state.drag.startPose.rotation : 0);

      if (state.drag.mode === 'bend') {
        if (!state.drag.historyRecorded) {
          recordHistory();
          state.drag.historyRecorded = true;
        }
        updateSegmentControlPoint(state.drag.entityId, meters);
        renderCanvas();
        return;
      }

      if (state.drag.mode === 'ghost') {
        if (entity && entity.type === 'ball') {
          var ballGhostTarget = resolveBallGhostDragTarget(state.drag, point, meters);
          state.drag.previewPose = ballGhostTarget.previewPose;
          state.drag.passTarget = ballGhostTarget.passTarget;
          updateBallSegmentEndPose(state.drag.previewPose, state.drag.passTarget);
          renderCanvas();
          return;
        }
        state.drag.previewPose = previewEndPose(
          entity,
          state.drag.startPose,
          meters,
          state.drag.keptRotation
        );
        updateSegmentEndPose(state.drag.entityId, state.drag.previewPose);
        renderCanvas();
        return;
      }

      if (state.drag.mode === 'ball-route') {
        var freePose = clampPoseToField({
          x: meters.x,
          y: meters.y,
          rotation: 0,
        });
        var passerId = resolveBallPasserId(state.drag.startPose, state.drag.holderId);
        var passTarget = passerId
          ? resolveBallPassTargetAtCanvasPoint(
            point.x,
            point.y,
            getHolderTeam(passerId),
            passerId
          )
          : null;
        state.drag.previewPose = passTarget ? clone(passTarget.targetPose) : freePose;
        state.drag.passTarget = passTarget;
        renderCanvas();
        return;
      }

      state.drag.previewPose = previewEndPose(entity, state.drag.startPose, meters);
      renderCanvas();
    }

    function onPointerDown(event) {
      if (!canEdit()) return;
      var point = pointerToCanvas(event);
      var x = point.x;
      var y = point.y;

      if (state.tool) {
        collapseStepsSheet();
        if (state.startPoseEdit && state.tool.mode === 'draai') {
          state.tool.confirmOnUp = true;
          state.tool.aimStartX = point.x;
          state.tool.aimStartY = point.y;
          canvas.setPointerCapture(event.pointerId);
          return;
        }
        confirmToolAtPoint(point);
        return;
      }

      state.pendingPointer = null;

      if (!state.startPoseEdit) {
        var bendEntityId = getControlHandleAtCanvasPoint(x, y);
        if (bendEntityId) {
          clearTool();
          collapseStepsSheet();
          var now = Date.now();
          if (
            lastBendTap
            && lastBendTap.entityId === bendEntityId
            && now - lastBendTap.time <= DOUBLE_TAP_MS
            && Math.hypot(x - lastBendTap.x, y - lastBendTap.y) <= DOUBLE_TAP_SLOP_PX
          ) {
            lastBendTap = null;
            bendResetAt = now;
            state.drag = null;
            canvas.classList.remove('dragging');
            resetSegmentBend(bendEntityId);
            return;
          }
          state.drag = {
            mode: 'bend',
            entityId: bendEntityId,
            historyRecorded: false,
          };
          canvas.classList.add('dragging');
          canvas.setPointerCapture(event.pointerId);
          renderCanvas();
          return;
        }

        var ballPick = getBallPickAtCanvasPoint(x, y);
        if (ballPick) {
          clearTool();
          collapseStepsSheet();
          state.pendingPointer = {
            kind: 'ball-route',
            startPose: clone(ballPick.startPose),
            holderId: ballPick.holderId,
            x: x,
            y: y,
            pointerId: event.pointerId,
          };
          canvas.setPointerCapture(event.pointerId);
          renderCanvas();
          return;
        }

        var ghostEntityId = getGhostAtCanvasPoint(x, y);
        if (ghostEntityId) {
          var ghostSegment = getPrimarySegment(ghostEntityId);
          state.pendingPointer = {
            kind: 'ghost',
            entityId: ghostEntityId,
            x: x,
            y: y,
            startPose: clone(ghostSegment.startPose),
            previewPose: clone(ghostSegment.endPose),
            keptRotation: ghostSegment.endPose.rotation,
            pointerId: event.pointerId,
          };
          canvas.setPointerCapture(event.pointerId);
          renderCanvas();
          return;
        }
      }

      var entityId = getEntityAtCanvasPoint(x, y);
      if (!entityId) {
        clearTool();
        state.keyboardFocusEntityId = null;
        renderAll();
        return;
      }

      if (state.startPoseEdit) {
        var freestyleEntity = state.tactic.entities.find(function (item) { return item.id === entityId; });
        if (!freestyleEntity) return;
        var pose = freestyleEntity.type === 'ball'
          ? getBallStartPose()
          : freestyleEntity.initial;
        var grabMeters = canvasToMeters(x, y, pose.rotation);
        state.pendingPointer = {
          kind: 'freestyle',
          entityId: entityId,
          x: x,
          y: y,
          offsetX: pose.x - grabMeters.x,
          offsetY: pose.y - grabMeters.y,
          rotation: pose.rotation,
          pointerId: event.pointerId,
        };
        canvas.setPointerCapture(event.pointerId);
        renderCanvas();
        return;
      }

      if (getPrimarySegment(entityId)) {
        state.pendingPointer = {
          kind: 'select',
          entityId: entityId,
          x: x,
          y: y,
          pointerId: event.pointerId,
        };
        canvas.setPointerCapture(event.pointerId);
        renderCanvas();
        return;
      }

      var clickedEntity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      if (clickedEntity && clickedEntity.type === 'ball') {
        state.pendingPointer = {
          kind: 'ball-route',
          startPose: clone(getBallStartPose()),
          holderId: getBallHolderId(),
          x: x,
          y: y,
          pointerId: event.pointerId,
        };
        canvas.setPointerCapture(event.pointerId);
        renderCanvas();
        return;
      }

      var startPose = getPosesAtTime()[entityId];
      state.pendingPointer = {
        kind: 'route',
        entityId: entityId,
        x: x,
        y: y,
        startPose: clone(startPose),
        pointerId: event.pointerId,
      };
      canvas.setPointerCapture(event.pointerId);
      renderCanvas();
    }

    function onPointerMove(event) {
      if (state.tool) {
        updateToolPreview(pointerToCanvas(event));
        return;
      }

      if (state.pendingPointer) {
        var pending = state.pendingPointer;
        var point = pointerToCanvas(event);
        var dist = Math.hypot(point.x - pending.x, point.y - pending.y);
        var threshold = pending.kind === 'freestyle'
          ? START_POSE_DRAG_THRESHOLD_PX
          : DRAG_THRESHOLD_PX;
        if (dist >= threshold) {
          if (pending.kind === 'select') return;
          promotePending(event);
        }
        return;
      }

      if (!state.drag) return;
      applyDragMove(event);
    }

    function onPointerUp(event) {
      if (state.tool && state.tool.confirmOnUp) {
        var confirmPoint = pointerToCanvas(event);
        var aimMoved = state.tool.aimStartX != null
          && Math.hypot(confirmPoint.x - state.tool.aimStartX, confirmPoint.y - state.tool.aimStartY) >= DRAG_THRESHOLD_PX;
        state.tool.confirmOnUp = false;
        confirmToolAtPoint(confirmPoint, { keepPreview: !aimMoved });
        releaseCapture(event);
        return;
      }

      if (state.tool) return;

      if (state.pendingPointer) {
        var pending = state.pendingPointer;
        state.pendingPointer = null;
        releaseCapture(event);
        if (state.startPoseEdit && pending.kind === 'freestyle') {
          var pendingEntity = state.tactic.entities.find(function (item) {
            return item.id === pending.entityId;
          });
          if (pendingEntity && pendingEntity.type === 'ball') {
            setKeyboardFocus('ball');
            renderAll();
            return;
          }
          beginStartPoseRotate(pending.entityId);
          return;
        }
        if (pending.kind === 'ball-route') {
          setKeyboardFocus('ball');
        } else if (pending.entityId) {
          setKeyboardFocus(pending.entityId);
        }
        renderAll();
        return;
      }

      if (!state.drag) return;
      var drag = state.drag;
      var point = pointerToCanvas(event);
      var meters = canvasToMeters(point.x, point.y, drag.startPose ? drag.startPose.rotation : 0);
      var entity = state.tactic.entities.find(function (item) { return item.id === drag.entityId; });

      if (drag.mode === 'freestyle') {
        var moveDist = Math.hypot(point.x - drag.startX, point.y - drag.startY);
        if (moveDist < START_POSE_DRAG_THRESHOLD_PX) {
          if (entity && drag.originPose) {
            entity.initial.x = drag.originPose.x;
            entity.initial.y = drag.originPose.y;
            entity.initial.rotation = drag.originPose.rotation;
          }
          restoreBallSnapPreview(drag);
          state.drag = null;
          releaseCapture(event);
          if (entity && entity.type === 'ball') {
            setKeyboardFocus('ball');
            renderAll();
            return;
          }
          beginStartPoseRotate(drag.entityId);
          return;
        }

        if (entity) {
          var freestyleMeters = canvasToMeters(point.x, point.y, drag.rotation);
          var freestylePose = clampPoseToField({
            x: freestyleMeters.x + drag.offsetX,
            y: freestyleMeters.y + drag.offsetY,
            rotation: drag.rotation,
          });
          if (drag.originPose) {
            entity.initial.x = drag.originPose.x;
            entity.initial.y = drag.originPose.y;
            entity.initial.rotation = drag.originPose.rotation;
            restoreBallSnapPreview(drag);
            recordHistory();
          }
          if (entity.type === 'ball') {
            placeBallFreestyleAt(freestylePose);
          } else {
            entity.initial.x = freestylePose.x;
            entity.initial.y = freestylePose.y;
            entity.initial.rotation = freestylePose.rotation;
            if (entity.type === 'boat') retargetBallRouteForLinkedBoat(drag.entityId);
            if (!claimBallPossessionImmediate(drag.entityId, freestylePose, drag.ballRefPose)) {
              restoreBallSnapPreview(drag);
            }
          }
          syncCurrentStepPoses();
          recomputeAllSegmentDurations();
          state.tactic.updatedAt = new Date().toISOString();
        }
        state.drag = null;
        releaseCapture(event);
        renderAll();
        return;
      }

      if (drag.mode === 'bend') {
        var bendWasTap = !drag.historyRecorded;
        updateSegmentControlPoint(drag.entityId, meters);
        if (bendWasTap) {
          lastBendTap = {
            entityId: drag.entityId,
            x: point.x,
            y: point.y,
            time: Date.now(),
          };
        } else {
          lastBendTap = null;
        }
        state.drag = null;
        releaseCapture(event);
        renderAll();
        return;
      }

      if (drag.mode === 'ghost') {
        if (entity && entity.type === 'ball') {
          var ballGhostEnd = drag.previewPose;
          if (!ballGhostEnd) {
            var ballGhostTarget = resolveBallGhostDragTarget(drag, point, meters);
            ballGhostEnd = ballGhostTarget.previewPose;
            drag.passTarget = ballGhostTarget.passTarget;
          }
          updateBallSegmentEndPose(ballGhostEnd, drag.passTarget);
          state.drag = null;
          releaseCapture(event);
          renderAll();
          return;
        }
        var ghostEnd = drag.previewPose || previewEndPose(
          entity,
          drag.startPose,
          meters,
          drag.keptRotation
        );
        updateSegmentEndPose(drag.entityId, ghostEnd);
        updateBallClaimOnRoute(drag.entityId, ghostEnd);
        state.drag = null;
        releaseCapture(event);
        renderAll();
        return;
      }

      if (drag.mode === 'ball-route') {
        try {
          finishBallRouteDrag(drag, point);
        } finally {
          state.drag = null;
          releaseCapture(event);
        }
        renderAll();
        return;
      }

      var endPose = drag.previewPose || previewEndPose(entity, drag.startPose, meters);
      state.drag = null;
      releaseCapture(event);
      createRouteSegment(drag.entityId, drag.startPose, endPose);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', function (event) {
      if (!canEdit()) return;
      var point = pointerToCanvas(event);
      var bendEntityId = getControlHandleAtCanvasPoint(point.x, point.y);
      if (bendEntityId) {
        event.preventDefault();
        state.drag = null;
        state.pendingPointer = null;
        canvas.classList.remove('dragging');
        // Pointer double-tap heeft de reset al gedaan; voorkom dubbele history.
        if (bendResetAt && Date.now() - bendResetAt < 600) {
          bendResetAt = 0;
          return;
        }
        lastBendTap = null;
        resetSegmentBend(bendEntityId);
        return;
      }
      var ghostEntityId = getGhostAtCanvasPoint(point.x, point.y);
      if (!ghostEntityId || !getPrimarySegment(ghostEntityId)) return;
      event.preventDefault();
      state.drag = null;
      state.pendingPointer = null;
      canvas.classList.remove('dragging');
      clearEntityRoute(ghostEntityId);
    });
  }

  function setupStepsSheet() {
    var panel = document.getElementById('steps-panel');
    var toggle = document.getElementById('btn-steps-toggle');
    if (!panel || !toggle) return;

    var swipe = null;
    toggle.addEventListener('pointerdown', function (event) {
      if (!isPhoneLayout()) return;
      swipe = { y: event.clientY, pointerId: event.pointerId };
      try { toggle.setPointerCapture(event.pointerId); } catch (err) { /* noop */ }
    });
    toggle.addEventListener('pointerup', function (event) {
      if (!swipe || swipe.pointerId !== event.pointerId) return;
      var dy = event.clientY - swipe.y;
      var didSwipe = Math.abs(dy) >= 24;
      swipe = null;
      if (!didSwipe) return;
      event.preventDefault();
      toggle._suppressClick = true;
      setStepsSheetExpanded(dy < 0);
    });
    toggle.addEventListener('pointercancel', function () {
      swipe = null;
    });
    toggle.addEventListener('click', function (event) {
      if (toggle._suppressClick) {
        toggle._suppressClick = false;
        event.preventDefault();
        return;
      }
      if (!isPhoneLayout()) return;
      setStepsSheetExpanded(!panel.classList.contains('is-expanded'));
    });

    if (window.matchMedia) {
      var onLayoutChange = function () {
        syncStepsSheetLayout();
        renderCanvas();
      };
      var mq = window.matchMedia(PHONE_LAYOUT_MQ);
      if (mq.addEventListener) mq.addEventListener('change', onLayoutChange);
      else if (mq.addListener) mq.addListener(onLayoutChange);
      var landscapeMq = window.matchMedia(PHONE_LANDSCAPE_MQ);
      if (landscapeMq.addEventListener) landscapeMq.addEventListener('change', onLayoutChange);
      else if (landscapeMq.addListener) landscapeMq.addListener(onLayoutChange);
    }

    syncStepsSheetLayout();
  }

  function setupEvents() {
    setupStepsSheet();

    function on(id, eventName, handler) {
      var el = document.getElementById(id);
      if (!el) return null;
      el.addEventListener(eventName, handler);
      return el;
    }

    on('btn-settings', 'click', function () {
      closeShortcutsDialog();
      closePredefinedDialog();
      state.settingsOpen = true;
      renderSettings();
    });
    on('btn-shortcuts', 'click', function () {
      closePredefinedDialog();
      toggleShortcutsDialog();
    });
    on('btn-close-shortcuts', 'click', closeShortcutsDialog);
    on('shortcuts-backdrop', 'click', function (event) {
      if (event.target.id === 'shortcuts-backdrop') closeShortcutsDialog();
    });
    on('btn-undo', 'click', undo);
    on('btn-redo', 'click', redo);
    on('btn-set-start', 'click', toggleStartPoseEdit);
    on('btn-predefined-flows', 'click', openPredefinedDialog);
    on('btn-close-predefined', 'click', closePredefinedDialog);
    on('predefined-backdrop', 'click', function (event) {
      if (event.target.id === 'predefined-backdrop') closePredefinedDialog();
    });
    on('predefined-list', 'click', function (event) {
      var button = event.target.closest('[data-predefined-id]');
      if (!button) return;
      loadPredefinedFlow(button.getAttribute('data-predefined-id'));
    });
    on('btn-goto-start', 'click', gotoStartPosition);
    on('btn-share-tactic', 'click', openShareDialog);
    on('btn-close-share', 'click', closeShareDialog);
    on('btn-share-copy-url', 'click', shareTacticLink);
    on('btn-share-export', 'click', exportTacticFromShare);
    on('share-backdrop', 'click', function (event) {
      if (event.target.id === 'share-backdrop') closeShareDialog();
    });
    on('btn-export-cancel', 'click', closeExportDialog);
    on('btn-export-confirm', 'click', confirmExportTactic);
    on('export-name-input', 'keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmExportTactic();
      }
    });
    on('export-backdrop', 'click', function (event) {
      if (event.target.id === 'export-backdrop') closeExportDialog();
    });
    on('btn-import-tactic', 'click', function () {
      closePredefinedDialog();
      triggerImportDialog();
    });
    on('btn-reset-all', 'click', resetAll);
    (function setupImportInput() {
      var input = document.getElementById('import-tactic-input');
      if (!input) return;
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) importTacticFromFile(input.files[0]);
        input.value = '';
      });
    })();
    on('btn-go', 'click', runGoPlayback);
    on('btn-mode-edit', 'click', function () {
      if (!state.playbackMode) return;
      exitPlaybackMode();
    });
    on('btn-mode-play', 'click', function () {
      if (state.playbackMode) return;
      enterPlaybackMode();
    });
    on('btn-transport-play', 'click', toggleTransportPlay);
    on('btn-speed-down', 'click', function () {
      changeTransportSpeed(-1);
    });
    on('btn-speed-up', 'click', function () {
      changeTransportSpeed(1);
    });
    (function setupTransportScrubber() {
      var scrubber = document.getElementById('transport-scrubber');
      if (!scrubber) return;
      scrubber.addEventListener('pointerdown', function () {
        state.transport.scrubbing = true;
      });
      scrubber.addEventListener('input', function () {
        seekTransport(Number(scrubber.value) / 1000);
      });
      function endScrub() {
        state.transport.scrubbing = false;
        updateTransportBar();
      }
      scrubber.addEventListener('pointerup', endScrub);
      scrubber.addEventListener('change', endScrub);
    })();
    on('btn-close-settings', 'click', function () {
      state.settingsOpen = false;
      renderSettings();
    });
    on('settings-backdrop', 'click', function (event) {
      if (event.target.id === 'settings-backdrop') {
        state.settingsOpen = false;
        renderSettings();
      }
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isShortcutsDialogOpen()) {
        closeShortcutsDialog();
        return;
      }
      if (event.key === 'Escape' && isPredefinedDialogOpen()) {
        closePredefinedDialog();
        return;
      }
      if (event.key === 'Escape' && isShareDialogOpen()) {
        closeShareDialog();
        return;
      }
      if (event.key === 'Escape' && isExportDialogOpen()) {
        closeExportDialog();
        return;
      }
      if (event.key === 'Escape' && state.settingsOpen) {
        state.settingsOpen = false;
        renderSettings();
        return;
      }
      if (event.key === 'Escape' && state.playbackMode) {
        event.preventDefault();
        exitPlaybackMode();
        return;
      }
      if (event.key === 'Escape' && state.tool && state.tool.mode === 'vaarlijn' && state.tool.phase === 'receiver') {
        event.preventDefault();
        state.tool.phase = 'point';
        state.tool.endPose = null;
        state.tool.targetEntityId = null;
        setMessage(null);
        renderAll();
        return;
      }
      if (event.key === 'Escape' && state.tool) {
        event.preventDefault();
        clearTool();
        renderAll();
        return;
      }
      if (event.key === 'Escape' && state.startPoseEdit) {
        event.preventDefault();
        exitStartPoseEdit();
        setMessage(t('message.startEditClosed'));
        renderAll();
        return;
      }
      if (event.key === 'Escape' && state.keyboardFocusEntityId) {
        event.preventDefault();
        state.keyboardFocusEntityId = null;
        renderAll();
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (isExportDialogOpen() || isShareDialogOpen()) return;

      var key = event.key;
      var lower = key.length === 1 ? key.toLowerCase() : key;
      var mod = event.metaKey || event.ctrlKey;

      if (key === '?' || (key === '/' && event.shiftKey)) {
        event.preventDefault();
        toggleShortcutsDialog();
        return;
      }

      if (isShortcutsDialogOpen()) return;
      if (state.settingsOpen) {
        if (lower === 's' && !mod) {
          event.preventDefault();
          toggleSettingsPanel();
        }
        return;
      }
      if (state.isPlaying) return;

      if (mod && lower === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (canEdit()) undo();
        return;
      }
      if (mod && (lower === 'y' || (lower === 'z' && event.shiftKey))) {
        event.preventDefault();
        if (canEdit()) redo();
        return;
      }
      if (mod && lower === 's') {
        event.preventDefault();
        if (hasPlayableSteps()) openShareDialog();
        return;
      }
      if (mod && lower === 'o') {
        event.preventDefault();
        triggerImportDialog();
        return;
      }

      if (mod) return;

      if (key === ' ') {
        event.preventDefault();
        if (state.playbackMode) toggleTransportPlay();
        else if (canEdit() && hasDraftRoutes()) runGoPlayback();
        return;
      }

      if (lower === 'g') {
        if (canEdit() && hasDraftRoutes()) {
          event.preventDefault();
          runGoPlayback();
        }
        return;
      }

      if (lower === 'e') {
        event.preventDefault();
        if (state.playbackMode) exitPlaybackMode();
        return;
      }

      if (lower === 'p') {
        event.preventDefault();
        if (!state.playbackMode) enterPlaybackMode();
        return;
      }

      if (lower === 's') {
        event.preventDefault();
        toggleSettingsPanel();
        return;
      }

      if (lower === 'm') {
        event.preventDefault();
        toggleStepsSheet();
        return;
      }

      if (key === 'ArrowLeft') {
        event.preventDefault();
        selectAdjacentStep(-1);
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        selectAdjacentStep(1);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        if (state.playbackMode) seekTransport(0);
        else selectStep(0);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        ensureSteps(state.tactic);
        if (state.playbackMode) seekTransport(1);
        else selectStep(state.tactic.steps.length - 1);
        return;
      }

      if (state.playbackMode) {
        if (key === ',' || lower === 'j') {
          event.preventDefault();
          nudgeTransport(-0.05);
          return;
        }
        if (key === '.' || lower === 'l') {
          event.preventDefault();
          nudgeTransport(0.05);
          return;
        }
        if (key === '[' || key === '-' || key === '_') {
          event.preventDefault();
          changeTransportSpeed(-1);
          return;
        }
        if (key === ']' || key === '=' || key === '+') {
          event.preventDefault();
          changeTransportSpeed(1);
          return;
        }
      }

      if (!canEdit()) return;

      if (lower === 'h') {
        event.preventDefault();
        gotoStartPosition();
        return;
      }
      if (lower === 'l') {
        event.preventDefault();
        toggleStartPoseEdit();
        return;
      }
      if (lower === 'r') {
        event.preventDefault();
        beginStepRename(state.tactic.currentStepIndex);
        return;
      }
      if ((key === 'Backspace' || key === 'Delete') && event.shiftKey) {
        event.preventDefault();
        deleteLastStep();
        return;
      }
      if (key === 'Tab') {
        event.preventDefault();
        cycleKeyboardFocus(event.shiftKey ? -1 : 1);
        return;
      }
      if (lower === 'b' || key === '0') {
        event.preventDefault();
        focusBallEntity();
        return;
      }
      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        focusBoatByNumber(Number(key));
        return;
      }
      if (lower === 'v') {
        event.preventDefault();
        startToolOnFocused('vaar');
        return;
      }
      if (lower === 't') {
        event.preventDefault();
        startToolOnFocused('draai');
        return;
      }
      if (lower === 'f') {
        event.preventDefault();
        startToolOnFocused('pass');
        return;
      }
      if (lower === 'w') {
        event.preventDefault();
        startToolOnFocused('vaarlijn');
        return;
      }
      if (lower === 'x' || key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        clearFocusedEntityRoute();
        return;
      }
    });
    window.addEventListener('resize', function () {
      syncStepsSheetLayout();
      renderCanvas();
    });
  }

  function setupCanvasResizeObserver() {
    var wrap = canvas && canvas.parentElement;
    if (!wrap || typeof ResizeObserver !== 'function') return;
    var lastW = 0;
    var lastH = 0;
    var scheduled = false;
    var observer = new ResizeObserver(function () {
      var w = wrap.clientWidth;
      var h = wrap.clientHeight;
      if (w < 32 || h < 32) return;
      if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
      lastW = w;
      lastH = h;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        renderCanvas();
      });
    });
    observer.observe(wrap);
  }

  function init() {
    FlowboardI18n.onLocaleChange = function () {
      if (state.tactic && state.tactic.entities) {
        state.tactic.entities.forEach(function (entity) {
          if (entity.type === 'ball') entity.label = t('entity.ball');
        });
      }
      syncDefaultStepNames();
      if (isPredefinedDialogOpen()) renderPredefinedList();
      renderAll();
    };
    var stored = loadStoredTactic();
    if (stored) state.tactic = stored;
    else state.tactic = createInitialTactic();
    setupCanvasDrag();
    setupEvents();
    setupCanvasResizeObserver();
    syncStepsSheetLayout();
    renderAll();
    consumeShareHashIfPresent();
    // Second pass after flex/sheet layout so the canvas isn't stuck at 0×CSS size.
    requestAnimationFrame(function () {
      renderCanvas();
    });
  }

  init();
})();
