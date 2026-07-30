(function () {
  'use strict';

  var STORAGE_KEY = 'flowboard:tactic';
  var FIELD_LENGTH = 35;
  var FIELD_WIDTH = 23;
  var HALF_LENGTH = 17.5;
  var BOAT_LENGTH = 3;
  var BOAT_WIDTH = 0.6;
  var BALL_DIAMETER = 0.7;
  var GOAL_WIDTH = 1.5;
  var LINE_4M = 4;
  var LINE_6M = 6;
  var CANVAS_PADDING = 28;
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
      stepDuration: 2,
      boatSpeed: 10,
      boatAcceleration: 7.2,
      boatRotationSpeed: 90,
      ballSpeed: 25,
      defense: {
        boatCount: 5,
        colors: ['#ef4444'],
      },
      attack: {
        boatCount: 5,
        colors: ['#facc15', '#111111'],
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
    var ys = spacedYs(boatCount, 3.5);
    return ys.map(function (y) {
      return { role: 'attacker', x: HALF_LENGTH, y: y, rotation: 180 };
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
      label: 'Bal',
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

  function createStep(name, poses, routes) {
    return {
      id: uuid(),
      name: name,
      poses: poses || {},
      routes: routes || null,
    };
  }

  function stepNameForIndex(index) {
    return index === 0 ? 'Start' : 'Stap ' + index;
  }

  function legacyStepNameForIndex(index) {
    return index === 0 ? 'Start' : 'Stap ' + (index + 1);
  }

  function ensureSteps(tactic) {
    if (!Array.isArray(tactic.steps) || !tactic.steps.length) {
      var poses = captureEntityPoses(tactic.entities);
      if ((!poses || !Object.keys(poses).length) && tactic.startPositions) {
        poses = clone(tactic.startPositions);
      }
      tactic.steps = [createStep('Start', poses)];
    } else {
      tactic.steps.forEach(function (step, index) {
        if (!step || typeof step !== 'object') return;
        if (!step.id) step.id = uuid();
        if (!step.name || step.name === legacyStepNameForIndex(index)) {
          step.name = stepNameForIndex(index);
        }
        if (!step.poses || typeof step.poses !== 'object') step.poses = {};
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
    loadRoutesOntoTracks(routes);
  }

  function livePosesMatchStep(step) {
    if (!step || !step.poses) return false;
    var checked = 0;
    var match = 0;
    state.tactic.entities.forEach(function (entity) {
      var stepPose = step.poses[entity.id];
      var pose = entity.initial;
      if (!stepPose || !pose) return;
      checked += 1;
      if (distanceMeters(pose, stepPose) < 0.05
        && Math.abs((pose.rotation || 0) - (stepPose.rotation || 0)) < 1) {
        match += 1;
      }
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
      name: 'Nieuwe kanopolo-tactiek',
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
      steps: [createStep('Start', captureEntityPoses(entities))],
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
    settings.attackFormation = 'midline';
    var rawSettings = tactic.settings || {};
    if (rawSettings.motionUnits !== 'kmh') {
      if (rawSettings.boatSpeed != null) settings.boatSpeed = Number(rawSettings.boatSpeed) * KMH_PER_MS;
      if (rawSettings.boatAcceleration != null) {
        settings.boatAcceleration = Number(rawSettings.boatAcceleration) * KMH_PER_MS;
      }
      if (rawSettings.ballSpeed != null) settings.ballSpeed = Number(rawSettings.ballSpeed) * KMH_PER_MS;
    }
    settings.motionUnits = 'kmh';
    settings.motionTimingMode = settings.motionTimingMode === 'stepDuration' ? 'stepDuration' : 'boatSpeed';
    settings.stepDuration = clamp(Number(settings.stepDuration) || 2, 0.25, 30);
    settings.boatSpeed = clamp(Number(settings.boatSpeed) || 10, 1, 40);
    settings.boatAcceleration = clamp(Number(settings.boatAcceleration) || 7.2, 1, 72);
    settings.boatRotationSpeed = clamp(Number(settings.boatRotationSpeed) || 90, 15, 360);
    settings.ballSpeed = clamp(Number(settings.ballSpeed) || 25, 1, 80);
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
      rebuilt.steps = [createStep('Start', captureEntityPoses(rebuilt.entities))];
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
    tactic.steps = [createStep('Start', captureEntityPoses(entities))];
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
    isViewOnly: false,
    isPlaying: false,
    playMode: null,
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
    actionMenu: null,
    message: null,
    history: { past: [], future: [] },
    drag: null,
    pendingPointer: null,
    tool: null,
    startPoseEdit: false,
    settingsOpen: false,
    stepRename: null,
  };

  var DRAG_THRESHOLD_PX = 8;
  var START_POSE_DRAG_THRESHOLD_PX = 16;
  var PHONE_LAYOUT_MQ = '(max-width: 767px)';
  var SHEET_PEEK_PX = 92;
  var MIN_ENTITY_HIT_PX = 22;
  var LONG_PRESS_MS = 500;
  var LONG_PRESS_MOVE_PX = 10;

  function isPhoneLayout() {
    return !!(window.matchMedia && window.matchMedia(PHONE_LAYOUT_MQ).matches);
  }

  function getSafeInset(side) {
    var styles = window.getComputedStyle(document.documentElement);
    var raw = styles.getPropertyValue('--safe-' + side).trim();
    var value = parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function getSheetPeekReserve() {
    if (!isPhoneLayout()) return 0;
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
    panel.classList.toggle('is-expanded', !!expanded);
    panel.classList.toggle('is-peek', !expanded);
    if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
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

  function closeActionMenu() {
    state.actionMenu = null;
  }

  function clearPointerInteraction() {
    state.drag = null;
    state.pendingPointer = null;
    clearTool();
    canvas.classList.remove('dragging');
  }

  function getEntityActions(entity) {
    if (!entity) return [];
    if (entity.type === 'ball') return ['vaar'];
    if (entity.type === 'boat') return ['vaar', 'draai'];
    return [];
  }

  function isEntityHighlighted(entityId) {
    if (state.actionMenu && state.actionMenu.entityId === entityId) return true;
    if (state.tool && state.tool.entityId === entityId) return true;
    if (state.drag && state.drag.entityId === entityId) return true;
    return false;
  }

  function openEntityActions(entityId) {
    if (!canEdit() || state.startPoseEdit) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    var actions = getEntityActions(entity);
    if (actions.length === 0) return;
    if (actions.length === 1) {
      closeActionMenu();
      startBoatTool(actions[0], entityId);
      return;
    }
    state.actionMenu = { entityId: entityId };
    renderAll();
  }

  function canEdit() {
    return !state.isViewOnly && !state.isPlaying && !state.playbackMode;
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
      var duration = segmentDuration(startPose, endPose, entity);
      routes[entity.id] = {
        startTime: 0,
        endTime: duration,
        startPose: clone(startPose),
        endPose: clone(endPose),
        controlOut: controls ? controls.controlOut : null,
        controlIn: controls ? controls.controlIn : null,
      };
    });
    return routes;
  }

  function maxDurationOfRoutes(routes) {
    var max = 0;
    if (!routes) return 0;
    Object.keys(routes).forEach(function (entityId) {
      var segment = routes[entityId];
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      var duration = segmentDuration(segment.startPose, segment.endPose, entity);
      if (duration > max) max = duration;
    });
    return max;
  }

  function normalizeRoutes(routes) {
    var normalized = {};
    if (!routes) return normalized;
    Object.keys(routes).forEach(function (entityId) {
      var segment = clone(routes[entityId]);
      if (!segment) return;
      var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
      segment.startTime = 0;
      segment.endTime = segmentDuration(segment.startPose, segment.endPose, entity);
      normalized[entityId] = segment;
    });
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
      var routes = normalizeRoutes(rawRoutes);
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
      state.tactic.entities.forEach(function (entity) {
        var segment = transition.routes[entity.id];
        if (!segment) {
          if (transition.fromPoses[entity.id]) {
            poses[entity.id] = clone(transition.fromPoses[entity.id]);
          }
          return;
        }
        var progress = segment.endTime <= 0
          ? 1
          : clamp(localTime / segment.endTime, 0, 1);
        poses[entity.id] = poseAlongSegment(
          segment,
          segmentPathProgress(segment, progress, entity),
          entity
        );
      });
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
  }

  function enterPlaybackMode() {
    if (state.isPlaying || state.playbackMode) return;
    if (!hasPlayableSteps()) {
      setMessage('Nog geen stappen om af te spelen.');
      return;
    }
    exitStartPoseEdit();
    state.stepRename = null;
    ensureTransportTimeline();
    state.playbackMode = true;
    state.transport.time = 0;
    state.transport.playing = false;
    closeActionMenu();
    clearPointerInteraction();
    setMessage('Afspeelmodus.');
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
    setMessage('Bewerkmodus.');
    renderAll();
  }

  function togglePlaybackMode() {
    if (state.isPlaying) return;
    if (state.playbackMode) exitPlaybackMode();
    else enterPlaybackMode();
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
    var modeBtn = document.getElementById('btn-playback-mode');
    if (!bar) return;

    var playable = hasPlayableSteps();
    if (modeBtn) {
      modeBtn.disabled = state.isPlaying || (!playable && !state.playbackMode);
      modeBtn.classList.toggle('is-active', state.playbackMode);
      modeBtn.textContent = state.playbackMode ? 'Bewerken' : 'Afspelen';
      modeBtn.title = state.playbackMode
        ? 'Terug naar bewerken'
        : (playable ? 'Afspeelmodus openen' : 'Nog geen stappen om af te spelen');
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
    if (speedDown) speedDown.disabled = !playable;
    if (speedUp) speedUp.disabled = !playable;
    if (playBtn) {
      playBtn.disabled = !playable;
      playBtn.title = state.transport.playing ? 'Pauze' : 'Afspelen';
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
    state.playMode = null;
  }

  function animateCurrentRoutes(onComplete) {
    recomputeAllSegmentDurations();
    var duration = maxRouteEndTime();
    state.currentTime = 0;

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

  function commitPlaybackToNextStep() {
    var reviewing = isReviewingCompletedStep();
    var routes = captureDraftRoutes();
    var endPoses = getPosesAtTime();
    state.tactic.entities.forEach(function (entity) {
      if (!endPoses[entity.id]) return;
      entity.initial = clone(endPoses[entity.id]);
      var track = getTrackForEntity(entity.id);
      track.segments = [];
    });
    state.currentTime = 0;

    ensureSteps(state.tactic);
    if (reviewing) {
      var index = state.tactic.currentStepIndex;
      var step = state.tactic.steps[index];
      if (step) {
        step.poses = captureEntityPoses(state.tactic.entities);
        step.routes = routes;
      }
      state.tactic.steps = state.tactic.steps.slice(0, index + 1);
      state.tactic.updatedAt = new Date().toISOString();
      closeActionMenu();
      clearPointerInteraction();
      invalidateTransportTimeline();
      return;
    }

    var nextIndex = state.tactic.currentStepIndex + 1;
    var nextStep = createStep(
      stepNameForIndex(nextIndex),
      captureEntityPoses(state.tactic.entities),
      routes
    );
    state.tactic.steps = state.tactic.steps.slice(0, nextIndex);
    state.tactic.steps.push(nextStep);
    state.tactic.currentStepIndex = nextIndex;
    state.tactic.updatedAt = new Date().toISOString();
    closeActionMenu();
    clearPointerInteraction();
    invalidateTransportTimeline();
  }

  function finishGoPlayback() {
    stopPlayback();
    commitPlaybackToNextStep();
    setMessage(state.tactic.steps[state.tactic.currentStepIndex].name + ' opgeslagen.');
    renderAll();
  }

  function runGoPlayback() {
    if (!canEdit() || !hasDraftRoutes() || state.startPoseEdit) return;
    if (state.playbackMode) exitPlaybackMode();
    recordHistory();
    state.isPlaying = true;
    state.playMode = 'go';
    closeActionMenu();
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
    closeActionMenu();
    clearPointerInteraction();
    state.tactic.updatedAt = new Date().toISOString();
    setMessage(state.tactic.steps[index].name + ' geselecteerd.');
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
    setMessage('Stap hernoemd naar ' + value + '.');
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
        input.setAttribute('aria-label', 'Stapnaam');
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
          renameBtn.title = 'Hernoemen';
          renameBtn.setAttribute('aria-label', 'Hernoem ' + (step.name || stepNameForIndex(index)));
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
      }

      list.appendChild(item);
    });

    if (drafting && !state.isPlaying && !previewing) {
      var draftItem = document.createElement('li');
      draftItem.className = 'steps-list-item';
      var draftBtn = document.createElement('button');
      draftBtn.type = 'button';
      draftBtn.className = 'step-btn is-draft';
      draftBtn.textContent = stepNameForIndex(state.tactic.currentStepIndex + 1) + ' (concept)';
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
      goBtn.textContent = state.isPlaying && state.playMode === 'go' ? 'Bezig…' : 'Go';
    }
    if (hint) {
      if (state.startPoseEdit) {
        hint.textContent = 'Sleep om te verplaatsen, klik om te draaien. Daarna Vastzetten.';
      } else if (previewing) {
        hint.textContent = state.transport.playing
          ? 'Bezig met afspelen…'
          : 'Afspeelmodus — kies Bewerken in de kop om terug te gaan.';
      } else if (state.isPlaying) {
        hint.textContent = 'Boten verplaatsen…';
      } else if (reviewing) {
        hint.textContent = 'Eindresultaat van deze stap — pas aan of druk Go.';
      } else if (drafting) {
        hint.textContent = 'Go verplaatst alle boten en slaat de volgende stap op.';
      } else if (hasPlayableSteps()) {
        hint.textContent = 'Open Afspelen in de kop om de uitvoering te bekijken.';
      } else {
        hint.textContent = 'Sleep boten om ghosts te zetten, daarna Go.';
      }
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
    if (undoBtn) undoBtn.disabled = !editable || !state.history.past.length;
    if (redoBtn) redoBtn.disabled = !editable || !state.history.future.length;
    if (startActions) startActions.classList.toggle('hidden', !onStart);
    if (setStartBtn) {
      setStartBtn.disabled = !editable || !onStart;
      setStartBtn.classList.toggle('is-editing', editingStart);
      var label = setStartBtn.querySelector('.btn-toolbar-label');
      if (label) label.textContent = editingStart ? 'Vastzetten' : 'Zet startpositie';
      setStartBtn.title = editingStart
        ? 'Huidige posities als startpositie vastzetten'
        : 'Modus om startposities vrij te zetten';
    }
    if (gotoStartBtn) {
      gotoStartBtn.disabled = !editable || editingStart;
    }
    var resetBtn = document.getElementById('btn-reset-all');
    if (resetBtn) resetBtn.disabled = !editable;
    if (indicator) {
      var set = hasStartPosition();
      indicator.classList.toggle('is-set', set);
      indicator.title = set ? 'Startpositie is gezet' : 'Geen startpositie gezet';
    }
    renderStepsPanel();
  }

  function undo() {
    if (!canEdit() || !state.history.past.length) return;
    stopPlayback();
    invalidateTransportTimeline();
    state.startPoseEdit = false;
    state.history.future.push(clone(state.tactic));
    state.tactic = state.history.past.pop();
    ensureSteps(state.tactic);
    state.currentTime = 0;
    closeActionMenu();
    clearPointerInteraction();
    renderAll();
  }

  function redo() {
    if (!canEdit() || !state.history.future.length) return;
    stopPlayback();
    invalidateTransportTimeline();
    state.startPoseEdit = false;
    state.history.past.push(clone(state.tactic));
    state.tactic = state.history.future.pop();
    ensureSteps(state.tactic);
    state.currentTime = 0;
    closeActionMenu();
    clearPointerInteraction();
    renderAll();
  }

  function enterStartPoseEdit() {
    if (!canEdit() || !isOnStartStep()) return;
    clearPointerInteraction();
    clearDraftRoutes();
    syncCurrentStepPoses();
    state.startPoseEdit = true;
    closeActionMenu();
    setMessage('Sleep om te verplaatsen, klik om te draaien. Druk op Vastzetten om te bevestigen.');
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
    state.tactic.startPositions = snapshot;
    ensureSteps(state.tactic);
    state.tactic.steps[0].poses = clone(snapshot);
    state.tactic.updatedAt = new Date().toISOString();
    state.startPoseEdit = false;
    closeActionMenu();
    clearPointerInteraction();
    setMessage('Startpositie gezet.');
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
    setMessage('Beweeg om te draaien, klik om te bevestigen.');
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
    closeActionMenu();
    clearPointerInteraction();
    state.tactic.updatedAt = new Date().toISOString();
    setMessage('Terug naar begin van deze stap.');
    renderAll();
  }

  function resetAll() {
    if (!canEdit()) return;
    if (!window.confirm('Weet je het zeker? Alles wordt gereset, inclusief de startpositie.')) return;
    recordHistory();
    stopPlayback();
    state.startPoseEdit = false;
    if (state.playbackMode) exitPlaybackMode();
    applyFormationReset(state.tactic);
    state.tactic.startPositions = null;
    state.currentTime = 0;
    closeActionMenu();
    clearPointerInteraction();
    invalidateTransportTimeline();
    setMessage('Alles gereset, inclusief startpositie.');
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
    var header = document.querySelector('.header');
    var headerH = header ? header.getBoundingClientRect().height : 48;
    var appPad = isPhoneLayout() ? 16 : 32;
    var peekReserve = getSheetPeekReserve();
    var availW = Math.max(240, (wrap && wrap.clientWidth ? wrap.clientWidth : window.innerWidth) - 8);
    var availH = Math.max(
      180,
      window.innerHeight - headerH - appPad - peekReserve - getSafeInset('top') - (isPhoneLayout() ? 0 : getSafeInset('bottom'))
    );
    var scaleW = (availW - CANVAS_PADDING * 2) / size.width;
    var scaleH = (availH - CANVAS_PADDING * 2) / size.height;
    fieldScale = Math.max(10, Math.min(scaleW, scaleH));
  }

  function metersToCanvas(pose) {
    if (isHalfField()) {
      // (x,y)→(y,x) maps heading θ to 90°−θ (not θ+90).
      return {
        x: CANVAS_PADDING + pose.y * fieldScale,
        y: CANVAS_PADDING + pose.x * fieldScale,
        rotation: 90 - pose.rotation,
      };
    }
    return {
      x: CANVAS_PADDING + pose.x * fieldScale,
      y: CANVAS_PADDING + pose.y * fieldScale,
      rotation: pose.rotation,
    };
  }

  function canvasToMeters(x, y, rotation) {
    if (isHalfField()) {
      return {
        x: (y - CANVAS_PADDING) / fieldScale,
        y: (x - CANVAS_PADDING) / fieldScale,
        rotation: rotation == null ? 0 : rotation,
      };
    }
    return {
      x: (x - CANVAS_PADDING) / fieldScale,
      y: (y - CANVAS_PADDING) / fieldScale,
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

  function arrivalRotation(start, end, controlOut, controlIn, fallbackRotation) {
    var p0 = { x: start.x, y: start.y };
    var p3 = { x: end.x, y: end.y };
    var p1 = controlOut ? { x: controlOut.x, y: controlOut.y } : midpoint(p0, p3);
    var p2 = controlIn ? { x: controlIn.x, y: controlIn.y } : midpoint(p0, p3);
    var tangent = cubicTangent(p0, p1, p2, p3, 1);
    return rotationFromTangent(tangent.dx, tangent.dy, fallbackRotation);
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

  function segmentDuration(start, end, entity) {
    var settings = getSettings();
    if (isStepDurationTiming()) {
      // Alle entiteiten arriveren tegelijk; snelheid volgt uit afstand / stapduur.
      return Math.max(0.25, settings.stepDuration);
    }
    var distance = distanceMeters(start, end);
    // Wall-clock duur volgt de ingestelde kruissnelheid. Versnelling beïnvloedt
    // alleen het ease-profiel (segmentPathProgress), anders blijft topsnelheid
    // op korte stukken zonder effect omdat die nooit bereikt wordt.
    var speedKmh = entity && entity.type === 'ball' ? settings.ballSpeed : settings.boatSpeed;
    var moveTime = distance / Math.max(0.1, kmhToMs(speedKmh));
    if (entity && entity.type === 'ball') {
      return Math.max(0.25, moveTime);
    }
    var turnTime = angleDeltaDegrees(start.rotation || 0, end.rotation || 0)
      / Math.max(1, settings.boatRotationSpeed);
    return Math.max(0.25, Math.max(moveTime, turnTime));
  }

  function segmentPathProgress(segment, timeProgress, entity) {
    var progress = clamp(timeProgress, 0, 1);
    if (!entity || entity.type === 'ball') return progress;
    var settings = getSettings();
    var distance = distanceMeters(segment.startPose, segment.endPose);
    var cruiseSpeedMs;
    if (isStepDurationTiming()) {
      var duration = Math.max(0.25, settings.stepDuration);
      cruiseSpeedMs = distance / duration;
    } else {
      cruiseSpeedMs = kmhToMs(settings.boatSpeed);
    }
    return motionPathProgress(
      progress,
      distance,
      cruiseSpeedMs,
      kmhToMs(settings.boatAcceleration)
    );
  }

  function recomputeAllSegmentDurations() {
    state.tactic.entities.forEach(function (entity) {
      var segment = getPrimarySegment(entity.id);
      if (!segment) return;
      var duration = segmentDuration(segment.startPose, segment.endPose, entity);
      segment.endTime = segment.startTime + duration;
    });
    invalidateTransportTimeline();
  }

  function getPosesAtTime() {
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
          var progress = segment.endTime <= segment.startTime
            ? 1
            : (time - segment.startTime) / (segment.endTime - segment.startTime);
          poses[entity.id] = poseAlongSegment(
            segment,
            segmentPathProgress(segment, progress, entity),
            entity
          );
          break;
        }
        poses[entity.id] = poseAlongSegment(segment, 1, entity);
      }
    });
    return poses;
  }

  function setMessage(text) {
    state.message = text;
    var el = document.getElementById('message');
    if (!text) {
      el.classList.remove('is-visible');
      window.setTimeout(function () {
        if (state.message) return;
        el.classList.add('hidden');
        el.textContent = '';
      }, 180);
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
    // Force reflow so the enter transition runs when replacing text quickly.
    void el.offsetWidth;
    el.classList.add('is-visible');
    window.setTimeout(function () {
      if (state.message === text) setMessage(null);
    }, 2600);
  }

  function persistTactic() {
    if (state.isViewOnly) return;
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

  function drawDashedMeterLine(xMeters) {
    var half = isHalfField();
    ctx.save();
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.lineWidth = Math.max(1, fieldScale * 0.04);
    ctx.setLineDash([fieldScale * 0.35, fieldScale * 0.28]);
    ctx.beginPath();
    if (half) {
      var y = CANVAS_PADDING + xMeters * fieldScale;
      ctx.moveTo(CANVAS_PADDING, y);
      ctx.lineTo(CANVAS_PADDING + FIELD_WIDTH * fieldScale, y);
    } else {
      var x = CANVAS_PADDING + xMeters * fieldScale;
      ctx.moveTo(x, CANVAS_PADDING);
      ctx.lineTo(x, CANVAS_PADDING + FIELD_WIDTH * fieldScale);
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
      var y = CANVAS_PADDING + xMeters * fieldScale;
      var left = CANVAS_PADDING;
      var right = CANVAS_PADDING + FIELD_WIDTH * fieldScale;
      ctx.beginPath();
      ctx.moveTo(left - tick * 0.15, y);
      ctx.lineTo(left + tick, y);
      ctx.moveTo(right + tick * 0.15, y);
      ctx.lineTo(right - tick, y);
      ctx.stroke();
    } else {
      var x = CANVAS_PADDING + xMeters * fieldScale;
      var top = CANVAS_PADDING;
      var bottom = CANVAS_PADDING + FIELD_WIDTH * fieldScale;
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
      var goalX = CANVAS_PADDING + (FIELD_WIDTH * fieldScale) / 2 - goalSize / 2;
      ctx.fillRect(goalX, CANVAS_PADDING - thickness / 2, goalSize, thickness);
    } else {
      var goalY = CANVAS_PADDING + (FIELD_WIDTH * fieldScale) / 2 - goalSize / 2;
      ctx.fillRect(CANVAS_PADDING - thickness / 2, goalY, thickness, goalSize);
      ctx.fillRect(
        CANVAS_PADDING + FIELD_LENGTH * fieldScale - thickness / 2,
        goalY,
        thickness,
        goalSize
      );
    }
  }

  function drawBoat(pose, entity, selected) {
    var length = BOAT_LENGTH * fieldScale;
    var width = BOAT_WIDTH * fieldScale;
    var colors = entity.colors && entity.colors.length ? entity.colors : [entity.color || '#94a3b8'];
    var showNumbers = getSettings().showNumbers;

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate((pose.rotation * Math.PI) / 180);

    var radius = width / 2;
    roundRect(ctx, -length / 2, -width / 2, length, width, radius);
    ctx.fillStyle = colors[0];
    ctx.fill();
    if (colors.length >= 2) {
      ctx.save();
      roundRect(ctx, -length / 2, -width / 2, length, width, radius);
      ctx.clip();
      ctx.fillStyle = colors[1];
      ctx.fillRect(0, -width / 2, length / 2, width);
      ctx.restore();
    }
    roundRect(ctx, -length / 2, -width / 2, length, width, radius);
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.stroke();

    var arrowX = length * 0.28;
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

    if (showNumbers) {
      ctx.fillStyle = colors[0] === '#111111' || colors[0] === '#000000' ? '#f8fafc' : '#020617';
      if (colors.length >= 2) ctx.fillStyle = '#020617';
      ctx.font = 'bold ' + Math.max(10, width * 0.85) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(entity.label, -length * 0.12, 0);
    }

    ctx.restore();
  }

  function drawBall(pose) {
    var radius = (BALL_DIAMETER * fieldScale) / 2;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.5, fieldScale * 0.05);
    ctx.stroke();
  }

  function pathLineWidth() {
    return Math.max(6, fieldScale * 0.28);
  }

  function drawRoutePath(start, end, controls, emphasized) {
    var from = metersToCanvas(start);
    var to = metersToCanvas(end);
    ctx.save();
    ctx.strokeStyle = emphasized ? 'rgba(226, 232, 240, 0.95)' : 'rgba(203, 213, 225, 0.75)';
    ctx.lineWidth = pathLineWidth();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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

  function drawControlHandle(point, active) {
    var canvasPoint = metersToCanvas({ x: point.x, y: point.y, rotation: 0 });
    var radius = Math.max(7, fieldScale * 0.22);
    ctx.save();
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#f8fafc' : '#cbd5e1';
    ctx.fill();
    ctx.strokeStyle = active ? '#0f172a' : 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = active ? 2 : 1.5;
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
    return segment ? segment.endPose : null;
  }

  function drawEntityRoutes() {
    if (state.playbackMode) return;
    state.tactic.entities.forEach(function (entity) {
      var selected = isEntityHighlighted(entity.id);
      var draggingRoute = state.drag && state.drag.mode === 'route' && state.drag.entityId === entity.id;
      var toolingVaar = state.tool && state.tool.mode === 'vaar' && state.tool.entityId === entity.id;

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

      var segment = getPrimarySegment(entity.id);
      if (!segment) return;
      if (toolingVaar && state.tool.previewPose) return;
      var endPose = getGhostPose(entity.id) || segment.endPose;
      var controls = entity.type === 'boat' ? resolveRouteControls(segment) : null;
      drawRoutePath(segment.startPose, endPose, controls, selected);
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
    var width = size.width * fieldScale + CANVAS_PADDING * 2;
    var height = size.height * fieldScale + CANVAS_PADDING * 2;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#082f49';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#0f766e';
    roundRect(ctx, CANVAS_PADDING, CANVAS_PADDING, size.width * fieldScale, size.height * fieldScale, 14);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
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
        CANVAS_PADDING,
        CANVAS_PADDING + HALF_LENGTH * fieldScale - 1,
        FIELD_WIDTH * fieldScale,
        2
      );
    } else {
      ctx.fillStyle = 'rgba(203,213,225,0.55)';
      ctx.fillRect(
        CANVAS_PADDING + HALF_LENGTH * fieldScale - 1,
        CANVAS_PADDING,
        2,
        FIELD_WIDTH * fieldScale
      );
    }

    drawGoal();
    drawEntityRoutes();

    var poses = getDisplayPoses();
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
      if (entity.type === 'ball') drawBall(pose);
      else drawBoat(pose, entity, selected);
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
    select.disabled = state.isViewOnly;
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
    input.disabled = state.isViewOnly;
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
    input.disabled = state.isViewOnly;
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
    toggle.disabled = state.isViewOnly;
    toggle.setAttribute('aria-label', title);
    var headingLabel = document.createElement('label');
    headingLabel.textContent = title;
    toggle.addEventListener('change', function () {
      recordHistory();
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
      section.appendChild(createSelect('Basisopstelling', settings.defenseFormation, [
        { value: '1-3-1', label: '1-3-1' },
        { value: '1-2-2', label: '1-2-2' },
      ], function (value) {
        recordHistory();
        getSettings().defenseFormation = value;
        applyFormationReset(state.tactic);
        renderAll();
      }));
    } else {
      section.appendChild(createSelect('Basisopstelling', settings.attackFormation, [
        { value: 'midline', label: 'Op lijn op de middenlijn' },
      ], function (value) {
        recordHistory();
        getSettings().attackFormation = value;
        applyFormationReset(state.tactic);
        renderAll();
      }));
    }

    section.appendChild(createNumber('Aantal boten', team.boatCount, 1, 10, function (value) {
      recordHistory();
      getSettings()[teamKey].boatCount = value;
      applyFormationReset(state.tactic);
      renderAll();
    }));

    var colorLabel = document.createElement('div');
    colorLabel.className = 'field-row';
    colorLabel.innerHTML = '<label>Kleuren (1 of 2)</label>';
    section.appendChild(colorLabel);

    var colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    team.colors.forEach(function (color, index) {
      var input = document.createElement('input');
      input.type = 'color';
      input.value = toColorInput(color);
      input.disabled = state.isViewOnly;
      input.title = 'Kleur ' + (index + 1);
      input.addEventListener('input', function () {
        recordHistory();
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
      addBtn.textContent = 'Tweede kleur';
      addBtn.disabled = state.isViewOnly;
      addBtn.addEventListener('click', function () {
        recordHistory();
        getSettings()[teamKey].colors.push(teamKey === 'attack' ? '#facc15' : '#f8fafc');
        applyTeamColors(teamKey);
        renderAll();
      });
      colorRow.appendChild(addBtn);
    } else {
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn';
      removeBtn.textContent = 'Eén kleur';
      removeBtn.disabled = state.isViewOnly;
      removeBtn.addEventListener('click', function () {
        recordHistory();
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

    var fieldSection = document.createElement('section');
    fieldSection.className = 'settings-section';
    fieldSection.innerHTML = '<h3>Veld</h3>';
    fieldSection.appendChild(createSelect('Weergave', settings.fieldMode, [
      { value: 'half', label: 'Half veld' },
      { value: 'full', label: 'Volledig veld' },
    ], function (value) {
      recordHistory();
      getSettings().fieldMode = value;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox('4-meterlijn', settings.showLine4m, function (checked) {
      recordHistory();
      getSettings().showLine4m = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox('6-meterlijn', settings.showLine6m, function (checked) {
      recordHistory();
      getSettings().showLine6m = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    fieldSection.appendChild(createCheckbox('Bootnummers tonen', settings.showNumbers, function (checked) {
      recordHistory();
      getSettings().showNumbers = checked;
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }));
    body.appendChild(fieldSection);
    body.appendChild(createTeamSection('Verdedigend team', 'defense'));
    body.appendChild(createTeamSection('Aanvallend team', 'attack'));

    var motionSection = document.createElement('section');
    motionSection.className = 'settings-section';
    motionSection.innerHTML = '<h3>Geavanceerd</h3>';

    function updateMotionSetting(key, value) {
      recordHistory();
      getSettings()[key] = value;
      recomputeAllSegmentDurations();
      state.tactic.updatedAt = new Date().toISOString();
      renderAll();
    }

    motionSection.appendChild(createSelect('Timing', settings.motionTimingMode, [
      { value: 'boatSpeed', label: 'Bootsnelheid' },
      { value: 'stepDuration', label: 'Stapduur' },
    ], function (value) {
      updateMotionSetting('motionTimingMode', value === 'stepDuration' ? 'stepDuration' : 'boatSpeed');
    }));

    if (settings.motionTimingMode === 'stepDuration') {
      motionSection.appendChild(createNumber(
        'Stapduur (s)',
        settings.stepDuration,
        0.25,
        30,
        function (value) { updateMotionSetting('stepDuration', value); },
        0.25
      ));
      motionSection.appendChild(createNumber(
        'Bootversnelling (km/h/s)',
        settings.boatAcceleration,
        1,
        72,
        function (value) { updateMotionSetting('boatAcceleration', value); },
        0.5
      ));
    } else {
      motionSection.appendChild(createNumber(
        'Bootsnelheid (km/h)',
        settings.boatSpeed,
        1,
        40,
        function (value) { updateMotionSetting('boatSpeed', value); },
        0.5
      ));
      motionSection.appendChild(createNumber(
        'Bootversnelling (km/h/s)',
        settings.boatAcceleration,
        1,
        72,
        function (value) { updateMotionSetting('boatAcceleration', value); },
        0.5
      ));
      motionSection.appendChild(createNumber(
        'Draaisnelheid (°/s)',
        settings.boatRotationSpeed,
        15,
        360,
        function (value) { updateMotionSetting('boatRotationSpeed', value); },
        5
      ));
      motionSection.appendChild(createNumber(
        'Balsnelheid (km/h)',
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
    renderBoatActionMenu();
    renderSettings();
    updateToolbar();
  }

  function renderBoatActionMenu() {
    var menu = document.getElementById('boat-action-menu');
    if (!menu) return;

    var show = canEdit()
      && !state.startPoseEdit
      && state.actionMenu
      && !state.drag
      && !state.pendingPointer
      && !state.tool;

    if (!show) {
      menu.classList.add('hidden');
      return;
    }

    var entity = state.tactic.entities.find(function (item) {
      return item.id === state.actionMenu.entityId;
    });
    if (!entity || getEntityActions(entity).length < 2) {
      menu.classList.add('hidden');
      return;
    }

    var actions = getEntityActions(entity);
    var draaiBtn = menu.querySelector('[data-action="draai"]');
    if (draaiBtn) draaiBtn.classList.toggle('hidden', actions.indexOf('draai') === -1);

    var vaarBtn = menu.querySelector('[data-action="vaar"]');
    if (vaarBtn) {
      vaarBtn.classList.toggle('hidden', actions.indexOf('vaar') === -1);
      vaarBtn.textContent = entity.type === 'ball' ? 'Gooi' : 'Vaar';
    }

    var poses = getPosesAtTime();
    var sourcePose = poses[entity.id] || entity.initial;
    var canvasPose = metersToCanvas(sourcePose);
    var canvasRect = canvas.getBoundingClientRect();
    var wrap = canvas.parentElement;
    var wrapRect = wrap.getBoundingClientRect();
    var scaleX = canvasRect.width / canvas.width;
    var scaleY = canvasRect.height / canvas.height;
    var left = (canvasRect.left - wrapRect.left) + canvasPose.x * scaleX;
    var top = (canvasRect.top - wrapRect.top) + canvasPose.y * scaleY;

    menu.classList.remove('hidden');
    var menuWidth = menu.offsetWidth || 120;
    var menuHeight = menu.offsetHeight || 88;
    var pad = 8;
    var maxLeft = Math.max(pad, wrapRect.width - menuWidth - pad);
    var maxTop = Math.max(pad, wrapRect.height - menuHeight - pad);
    // Prefer right of boat; flip left if near edge.
    var preferredLeft = left + 12;
    if (preferredLeft > maxLeft) preferredLeft = left - menuWidth - 12;
    menu.style.left = clamp(preferredLeft, pad, maxLeft) + 'px';
    menu.style.top = clamp(top - menuHeight / 2, pad, maxTop) + 'px';
    menu.style.transform = 'none';
  }

  function rotationTowardPoint(fromPose, metersPoint) {
    return rotationFromTangent(
      metersPoint.x - fromPose.x,
      metersPoint.y - fromPose.y,
      fromPose.rotation
    );
  }

  function startBoatTool(mode, entityId) {
    entityId = entityId || (state.actionMenu && state.actionMenu.entityId);
    if (!canEdit() || !entityId) return;
    if (state.startPoseEdit && mode === 'vaar') return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    if (!entity) return;
    if (mode === 'draai' && entity.type !== 'boat') return;
    closeActionMenu();
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
      closeActionMenu();
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
        closeActionMenu();
        renderAll();
        return;
      }
      if (tool.hasSegment) {
        recordHistory();
        updateSegmentEndPose(tool.entityId, endPose);
        clearTool();
        closeActionMenu();
        renderAll();
      } else {
        var startPose = tool.startPose;
        var entityId = tool.entityId;
        clearTool();
        closeActionMenu();
        createRouteSegment(entityId, startPose, endPose);
        closeActionMenu();
        renderAll();
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
        segment.endTime = segment.startTime + segmentDuration(segment.startPose, segment.endPose, entity);
      }
      syncCurrentStepPoses();
      state.tactic.updatedAt = new Date().toISOString();
      clearTool();
      closeActionMenu();
      renderAll();
      return;
    }

    if (tool.mode === 'teleport') {
      var dest = tool.previewPose;
      if (!dest) {
        clearTool();
        closeActionMenu();
        renderAll();
        return;
      }
      recordHistory();
      entity.initial.x = dest.x;
      entity.initial.y = dest.y;
      entity.initial.rotation = tool.keptRotation;
      var track = getTrackForEntity(tool.entityId);
      track.segments = [];
      syncCurrentStepPoses();
      state.tactic.updatedAt = new Date().toISOString();
      clearTool();
      closeActionMenu();
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

  function updateSegmentEndPose(entityId, endPose) {
    if (!canEdit()) return;
    var entity = state.tactic.entities.find(function (item) { return item.id === entityId; });
    var segment = getPrimarySegment(entityId);
    if (!entity || !segment) return;

    endPose = clampPoseToField(endPose);
    if (distanceMeters(segment.startPose, endPose) < 0.35) return;

    var keptRotation = entity.type === 'ball' ? 0 : segment.endPose.rotation;

    if (entity.type === 'boat' && hasRouteControls(segment)) {
      // Start- én eindtangent vasthouden.
      var existing = resolveRouteControls(segment);
      var mu = existing
        ? distanceMeters(existing.controlOut, segment.startPose)
        : distanceMeters(segment.startPose, endPose) / 3;
      var lambda = existing
        ? distanceMeters(existing.controlIn, segment.endPose)
        : mu;
      var scale = Math.max(mu, lambda, 0.05);
      applyRouteControls(
        segment,
        boatRouteControls(
          segment.startPose,
          endPose,
          segment.startPose.rotation,
          keptRotation,
          scale
        )
      );
    }

    segment.endPose.x = endPose.x;
    segment.endPose.y = endPose.y;
    segment.endPose.rotation = keptRotation;
    segment.endTime = segment.startTime + segmentDuration(segment.startPose, segment.endPose, entity);
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
    var duration = segmentDuration(startPose, endPoseFull, entity);
    var track = getTrackForEntity(entityId);
    track.segments = [{
      startTime: 0,
      endTime: duration,
      startPose: {
        x: startPose.x,
        y: startPose.y,
        rotation: startPose.rotation,
      },
      endPose: endPoseFull,
      controlOut: controls ? controls.controlOut : null,
      controlIn: controls ? controls.controlIn : null,
    }];

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
    segment.endTime = segment.startTime + segmentDuration(segment.startPose, segment.endPose, entity);
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
    segment.endTime = segment.startTime + segmentDuration(segment.startPose, segment.endPose, entity);
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
    var longPressTimer = null;
    var longPress = null;

    function clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPress = null;
    }

    function releaseCapture(event) {
      canvas.classList.remove('dragging');
      try { canvas.releasePointerCapture(event.pointerId); } catch (err) { /* noop */ }
    }

    function promotePending(event) {
      var pending = state.pendingPointer;
      if (!pending || pending.kind === 'select') return false;

      clearLongPress();
      collapseStepsSheet();
      state.pendingPointer = null;
      closeActionMenu();

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
        };
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
        state.drag = {
          mode: 'route',
          entityId: pending.entityId,
          startPose: clone(pending.startPose),
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
        renderBoatActionMenu();
        return;
      }

      if (state.drag.mode === 'ghost') {
        state.drag.previewPose = previewEndPose(
          entity,
          state.drag.startPose,
          meters,
          state.drag.keptRotation
        );
        updateSegmentEndPose(state.drag.entityId, state.drag.previewPose);
        renderCanvas();
        renderBoatActionMenu();
        return;
      }

      state.drag.previewPose = previewEndPose(entity, state.drag.startPose, meters);
      renderCanvas();
      renderBoatActionMenu();
    }

    function onPointerDown(event) {
      if (!canEdit()) return;
      var point = pointerToCanvas(event);
      var x = point.x;
      var y = point.y;
      clearLongPress();

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
          closeActionMenu();
          collapseStepsSheet();
          state.drag = {
            mode: 'bend',
            entityId: bendEntityId,
            historyRecorded: false,
          };
          longPress = {
            entityId: bendEntityId,
            x: x,
            y: y,
            pointerId: event.pointerId,
          };
          longPressTimer = setTimeout(function () {
            if (!longPress || longPress.entityId !== bendEntityId) return;
            if (!state.drag || state.drag.mode !== 'bend' || state.drag.entityId !== bendEntityId) return;
            state.drag = null;
            canvas.classList.remove('dragging');
            try { canvas.releasePointerCapture(longPress.pointerId); } catch (err) { /* noop */ }
            clearLongPress();
            resetSegmentBend(bendEntityId);
          }, LONG_PRESS_MS);
          canvas.classList.add('dragging');
          canvas.setPointerCapture(event.pointerId);
          renderCanvas();
          renderBoatActionMenu();
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
          renderBoatActionMenu();
          return;
        }
      }

      var entityId = getEntityAtCanvasPoint(x, y);
      if (!entityId) {
        closeActionMenu();
        clearTool();
        renderAll();
        return;
      }

      if (state.startPoseEdit) {
        var freestyleEntity = state.tactic.entities.find(function (item) { return item.id === entityId; });
        if (!freestyleEntity) return;
        var pose = freestyleEntity.initial;
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
        renderBoatActionMenu();
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
      renderBoatActionMenu();
    }

    function onPointerMove(event) {
      if (longPress) {
        var lpPoint = pointerToCanvas(event);
        if (Math.hypot(lpPoint.x - longPress.x, lpPoint.y - longPress.y) >= LONG_PRESS_MOVE_PX) {
          clearLongPress();
        }
      }

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
      clearLongPress();
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
          beginStartPoseRotate(pending.entityId);
          return;
        }
        openEntityActions(pending.entityId);
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
          state.drag = null;
          releaseCapture(event);
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
            recordHistory();
          }
          entity.initial.x = freestylePose.x;
          entity.initial.y = freestylePose.y;
          entity.initial.rotation = freestylePose.rotation;
          syncCurrentStepPoses();
          state.tactic.updatedAt = new Date().toISOString();
        }
        state.drag = null;
        releaseCapture(event);
        renderAll();
        return;
      }

      if (drag.mode === 'bend') {
        updateSegmentControlPoint(drag.entityId, meters);
        state.drag = null;
        releaseCapture(event);
        renderAll();
        return;
      }

      if (drag.mode === 'ghost') {
        var ghostEnd = drag.previewPose || previewEndPose(
          entity,
          drag.startPose,
          meters,
          drag.keptRotation
        );
        updateSegmentEndPose(drag.entityId, ghostEnd);
        state.drag = null;
        releaseCapture(event);
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
      if (!bendEntityId) return;
      event.preventDefault();
      state.drag = null;
      state.pendingPointer = null;
      canvas.classList.remove('dragging');
      resetSegmentBend(bendEntityId);
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
      var mq = window.matchMedia(PHONE_LAYOUT_MQ);
      var onChange = function () {
        syncStepsSheetLayout();
        renderCanvas();
        renderBoatActionMenu();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    syncStepsSheetLayout();
  }

  function setupBoatActionMenu() {
    var menu = document.getElementById('boat-action-menu');
    if (!menu) return;
    menu.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (!button || !canEdit()) return;
      event.preventDefault();
      event.stopPropagation();
      startBoatTool(button.getAttribute('data-action'));
    });
  }

  function setupEvents() {
    setupBoatActionMenu();
    setupStepsSheet();
    document.getElementById('btn-settings').addEventListener('click', function () {
      state.settingsOpen = true;
      renderSettings();
    });
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-set-start').addEventListener('click', toggleStartPoseEdit);
    document.getElementById('btn-goto-start').addEventListener('click', gotoStartPosition);
    document.getElementById('btn-reset-all').addEventListener('click', resetAll);
    document.getElementById('btn-go').addEventListener('click', runGoPlayback);
    document.getElementById('btn-playback-mode').addEventListener('click', togglePlaybackMode);
    document.getElementById('btn-transport-play').addEventListener('click', toggleTransportPlay);
    document.getElementById('btn-speed-down').addEventListener('click', function () {
      changeTransportSpeed(-1);
    });
    document.getElementById('btn-speed-up').addEventListener('click', function () {
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
    document.getElementById('btn-close-settings').addEventListener('click', function () {
      state.settingsOpen = false;
      renderSettings();
    });
    document.getElementById('settings-backdrop').addEventListener('click', function (event) {
      if (event.target.id === 'settings-backdrop') {
        state.settingsOpen = false;
        renderSettings();
      }
    });
    window.addEventListener('keydown', function (event) {
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
      if (event.key === 'Escape' && state.tool) {
        event.preventDefault();
        clearTool();
        renderAll();
        return;
      }
      if (event.key === 'Escape' && state.startPoseEdit) {
        event.preventDefault();
        exitStartPoseEdit();
        setMessage('Startpositie-modus afgesloten.');
        renderAll();
        return;
      }
      if (event.key === 'Escape' && state.actionMenu) {
        event.preventDefault();
        closeActionMenu();
        clearPointerInteraction();
        renderAll();
        return;
      }
      if (state.settingsOpen || state.isPlaying) return;
      if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        if (state.playbackMode) toggleTransportPlay();
        else if (canEdit() && hasDraftRoutes()) runGoPlayback();
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        if (canEdit() && hasDraftRoutes()) {
          event.preventDefault();
          runGoPlayback();
        }
        return;
      }
      var mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      var key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    });
    window.addEventListener('resize', function () {
      syncStepsSheetLayout();
      renderCanvas();
      renderBoatActionMenu();
    });
  }

  function init() {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    var stored = loadStoredTactic();
    if (stored) state.tactic = stored;
    else state.tactic = createInitialTactic();
    setupCanvasDrag();
    setupEvents();
    syncStepsSheetLayout();
    renderAll();
  }

  init();
})();
