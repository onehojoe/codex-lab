const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");

/*
  Source map:
  - DOM/state/config live at the top.
  - Control handlers build route runs and per-route tuning.
  - Image import turns brightness regions into polygon obstacles.
  - Rendering is grouped before geometry/pathfinding helpers.
  - Pure geometry utilities are kept near the bottom for reuse.
*/

const startModeButton = document.querySelector("#startModeButton");
const endModeButton = document.querySelector("#endModeButton");
const obstacleModeButton = document.querySelector("#obstacleModeButton");
const shapeButtons = document.querySelectorAll(".shape-button");
const routeModeSelect = document.querySelector("#routeModeSelect");
const routeTunePanel = document.querySelector("#routeTunePanel");
const routePicker = document.querySelector("#routePicker");
const clothoidRadiusSlider = document.querySelector("#clothoidRadiusSlider");
const clothoidRadiusValue = document.querySelector("#clothoidRadiusValue");
const imageButton = document.querySelector("#imageButton");
const imageInput = document.querySelector("#imageInput");
const thresholdSlider = document.querySelector("#thresholdSlider");
const brightAreaToggle = document.querySelector("#brightAreaToggle");
const detectImageButton = document.querySelector("#detectImageButton");
const runButton = document.querySelector("#runButton");
const patternButton = document.querySelector("#patternButton");
const commitPatternButton = document.querySelector("#commitPatternButton");
const resetButton = document.querySelector("#resetButton");
const statusText = document.querySelector("#statusText");
const attemptText = document.querySelector("#attemptText");
const strategyText = document.querySelector("#strategyText");
const patternText = document.querySelector("#patternText");
const countText = document.querySelector("#countText");
const obstacleText = document.querySelector("#obstacleText");
const distanceText = document.querySelector("#distanceText");

const state = {
  mode: "start",
  obstacleShape: "circle",
  routeMode: "shortest-road",
  starts: [],
  ends: [],
  obstacles: [],
  attempt: 0,
  patternAttempt: 0,
  commitAttempt: 0,
  activeRun: null,
  pattern: null,
  createdPatterns: [],
  selectedRouteKey: null,
  routeSettings: {},
  draftObstacle: null,
  importedImage: null,
  imageThreshold: 128,
  detectBrightAreas: false,
  imageRecognizing: false,
  recognitionTimer: null,
  pointer: null,
  size: { width: 0, height: 0, dpr: 1 },
};

window.geometryState = state;

const palette = {
  ink: "#211f1d",
  muted: "#716b64",
  grid: "rgba(33, 31, 29, 0.07)",
  start: "#0f9b8e",
  end: "#e35b4f",
  amber: "#e9a93a",
};

const routeColors = ["#2f6df6", "#d94f86", "#0f9b8e", "#d88516", "#7d59d1", "#238273"];
const PATH_CLEARANCE = 0;
const ALTERNATIVE_TARGET_COUNT = 5;
const ALTERNATIVE_CLEARANCE = 5;
const ALTERNATIVE_MIN_GAP = 14;
const ALTERNATIVE_MIN_SHIFT = 13;
const IMAGE_OBSTACLE_LIMIT = 42;
const IMAGE_ANALYSIS_MAX_WIDTH = 460;
const IMAGE_COMPONENT_MIN_AREA = 70;

// Route strategies are intentionally data-driven so new line behaviors can be added here.
const shortestPathStrategy = {
  id: "shortest",
  name: "Shortest Graph",
};

const shortestRoadPathStrategy = {
  id: "shortest-road",
  name: "Shortest Road",
};

const patternStyles = [
  {
    name: "Curved Alternative",
    copies: 3,
    gap: 18,
    amplitude: 12,
    frequency: 1.2,
    speed: 0.65,
  },
  {
    name: "Side Alternative",
    copies: 4,
    gap: 14,
    amplitude: 8,
    frequency: 2.1,
    speed: 0.8,
  },
  {
    name: "Soft Alternative",
    copies: 2,
    gap: 28,
    amplitude: 16,
    frequency: 0.8,
    speed: 0.45,
  },
];

const pathStrategies = [
  {
    id: "straight",
    name: "Straight",
    build(start, end) {
      return makePath([start, end]);
    },
  },
  {
    id: "arc",
    name: "Arc",
    build(start, end, bounds, rng) {
      const mid = midpoint(start, end);
      const normal = unit(perpendicular(vector(start, end)));
      const bend = (rng() > 0.5 ? 1 : -1) * (90 + rng() * 160);
      const control = clampPoint(add(mid, scale(normal, bend)), bounds, 42);
      return makePath(sampleQuadratic(start, control, end, 44));
    },
  },
  {
    id: "dogleg",
    name: "Dogleg",
    build(start, end, bounds, rng) {
      const split = lerp(0.28, 0.72, rng());
      const offset = (rng() > 0.5 ? 1 : -1) * (70 + rng() * 140);
      const pivotX = lerp(start.x, end.x, split);
      const pivotY = lerp(start.y, end.y, 1 - split);
      const route = [
        start,
        clampPoint({ x: pivotX, y: start.y + offset * 0.35 }, bounds, 36),
        clampPoint({ x: pivotX, y: pivotY }, bounds, 36),
        clampPoint({ x: end.x - offset * 0.35, y: pivotY }, bounds, 36),
        end,
      ];
      return makePath(route);
    },
  },
  {
    id: "wave",
    name: "Wave",
    build(start, end, bounds, rng) {
      const along = vector(start, end);
      const normal = unit(perpendicular(along));
      const amp = 36 + rng() * 72;
      const frequency = 1.5 + Math.floor(rng() * 3);
      const phase = rng() * Math.PI * 2;
      const points = [];

      for (let i = 0; i <= 70; i += 1) {
        const t = i / 70;
        const base = mix(start, end, t);
        const fade = Math.sin(Math.PI * t);
        const wobble = Math.sin(t * Math.PI * 2 * frequency + phase) * amp * fade;
        points.push(clampPoint(add(base, scale(normal, wobble)), bounds, 28));
      }

      points[0] = start;
      points[points.length - 1] = end;
      return makePath(points);
    },
  },
  {
    id: "probe",
    name: "Probe",
    build(start, end, bounds, rng) {
      const route = [start];
      const probes = [];
      let current = { ...start };
      const step = 32;

      for (let i = 0; i < 90; i += 1) {
        if (distance(current, end) < step * 1.25) break;

        const toward = Math.atan2(end.y - current.y, end.x - current.x);
        const candidates = [];

        for (let j = 0; j < 5; j += 1) {
          const angle = toward + (j - 2) * 0.55 + (rng() - 0.5) * 0.6;
          const candidate = clampPoint(
            {
              x: current.x + Math.cos(angle) * step,
              y: current.y + Math.sin(angle) * step,
            },
            bounds,
            26,
          );
          const score =
            distance(candidate, end) +
            Math.abs(Math.sin(candidate.x * 0.012 + candidate.y * 0.009)) * 32 +
            rng() * 26;
          candidates.push({ point: candidate, score });
          probes.push({ from: current, to: candidate, score });
        }

        candidates.sort((a, b) => a.score - b.score);
        current = candidates[0].point;
        route.push(current);
      }

      route.push(end);
      return makePath(smoothCorners(route, 5), probes);
    },
  },
  {
    id: "orbit",
    name: "Orbit",
    build(start, end, bounds, rng) {
      const mid = midpoint(start, end);
      const baseRadius = Math.min(180, Math.max(64, distance(start, end) * 0.28));
      const turns = rng() > 0.5 ? 0.65 : -0.65;
      const points = [start];

      for (let i = 1; i < 48; i += 1) {
        const t = i / 48;
        const base = mix(start, end, t);
        const angle = t * Math.PI * 2 * turns + rng() * 0.08;
        const fade = Math.sin(Math.PI * t);
        const radius = baseRadius * fade;
        const orbit = {
          x: mid.x + Math.cos(angle) * radius * 0.72,
          y: mid.y + Math.sin(angle) * radius,
        };
        points.push(clampPoint(mix(base, orbit, 0.52 * fade), bounds, 30));
      }

      points.push(end);
      return makePath(points);
    },
  },
];

function setMode(mode) {
  state.mode = mode;
  startModeButton.classList.toggle("is-active", mode === "start");
  endModeButton.classList.toggle("is-active", mode === "end");
  obstacleModeButton.classList.toggle("is-active", mode === "obstacle");
  updateStatus();
}

function setObstacleShape(shape) {
  state.obstacleShape = shape;
  shapeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.shape === shape);
  });
  updateStatus();
}

function setRouteMode(routeMode) {
  state.routeMode = routeMode;
  routeModeSelect.value = routeMode;
  updateStatus();
}

function clearPatternState(label = "Idle") {
  state.pattern = null;
  patternText.textContent = label;
}

function invalidateRoutes({ clearSelection = true } = {}) {
  state.activeRun = null;
  if (clearSelection) state.selectedRouteKey = null;
  clearPatternState();
}

function updateStatus() {
  const startCount = state.starts.length;
  const endCount = state.ends.length;
  const obstacleCount = state.obstacles.length;
  const hasRoutes = Boolean(state.activeRun?.routes?.length);
  const createdCount = state.createdPatterns.length;

  if (state.imageRecognizing) {
    statusText.textContent = "Analyzing image tone";
  } else if (state.activeRun && !state.activeRun.done) {
    statusText.textContent = `${state.activeRun.routes.length} route${state.activeRun.routes.length === 1 ? "" : "s"} in motion`;
  } else if (state.pattern) {
    const alternativeCount = state.pattern.alternatives?.length || 0;
    const rejectedCount = state.pattern.rejectedCount || 0;
    statusText.textContent =
      alternativeCount > 0
        ? `${alternativeCount} clear alternative${alternativeCount === 1 ? "" : "s"} ready${rejectedCount ? ` - ${rejectedCount} rejected` : ""}`
        : "No clear alternatives found";
  } else if (createdCount > 0) {
    statusText.textContent = `${createdCount} committed alternative${createdCount === 1 ? "" : "s"}`;
  } else if (state.mode === "obstacle") {
    statusText.textContent = `Drawing ${obstacleLabel(state.obstacleShape)} obstacles - ${obstacleCount}`;
  } else if (state.mode === "start") {
    statusText.textContent = `Adding start points - Start ${startCount} / End ${endCount}`;
  } else {
    statusText.textContent = `Adding end points - Start ${startCount} / End ${endCount}`;
  }

  runButton.disabled = !(startCount > 0 && endCount > 0);
  patternButton.disabled = !hasRoutes;
  patternButton.textContent = state.pattern ? "Refresh Alt" : "Alternatives";
  commitPatternButton.disabled = !state.pattern || !(state.pattern.alternatives?.length);
  detectImageButton.disabled = !state.importedImage || state.imageRecognizing;
  countText.textContent = `${startCount} x ${endCount}`;
  obstacleText.textContent = String(obstacleCount);
  updateRouteTuning();
}

function reset() {
  state.starts = [];
  state.ends = [];
  state.obstacles = [];
  invalidateRoutes();
  state.createdPatterns = [];
  state.routeSettings = {};
  state.draftObstacle = null;
  state.importedImage = null;
  state.imageThreshold = 128;
  state.detectBrightAreas = false;
  state.imageRecognizing = false;
  clearTimeout(state.recognitionTimer);
  state.recognitionTimer = null;
  state.pointer = null;
  state.attempt = 0;
  state.patternAttempt = 0;
  state.commitAttempt = 0;
  imageInput.value = "";
  thresholdSlider.value = String(state.imageThreshold);
  brightAreaToggle.checked = state.detectBrightAreas;
  setRouteMode("shortest-road");
  setMode("start");
  attemptText.textContent = "00";
  strategyText.textContent = "Idle";
  countText.textContent = "0 x 0";
  obstacleText.textContent = "0";
  distanceText.textContent = "0 px";
}

function runAttempt() {
  if (state.starts.length === 0 || state.ends.length === 0) return;

  state.attempt += 1;
  clearPatternState();
  const strategy = selectedPathStrategy();
  const pairings = createAllPairings(state.starts, state.ends);
  const routes = pairings.map((pairing, index) => createRouteRecord(strategy, pairing, index));
  const totalDistance = routes.reduce((sum, route) => sum + route.distance, 0);
  const totalDuration = Math.max(...routes.map((route) => route.duration + route.delay));

  state.activeRun = {
    strategy,
    routes,
    startedAt: performance.now(),
    totalDistance,
    duration: totalDuration,
    done: false,
  };
  if (!routes.some((route) => route.key === state.selectedRouteKey)) {
    state.selectedRouteKey = routes[0]?.key || null;
  }

  attemptText.textContent = String(state.attempt).padStart(2, "0");
  strategyText.textContent = strategy.name;
  distanceText.textContent = `${Math.round(totalDistance)} px`;
  updateStatus();
}

function createRouteRecord(strategy, pairing, index) {
  const routeKey = routeKeyForPairing(pairing);
  const seed = hashSeed(`${strategy.id}-${state.attempt}-${index}-${pairing.start.x}-${pairing.end.y}`);
  const rng = mulberry32(seed);
  const path = buildRoutePath(
    strategy,
    pairing.start,
    pairing.end,
    state.size,
    state.obstacles,
    rng,
    routeSettingsFor(routeKey),
  );
  const total = pathLength(path.points);

  return {
    ...pairing,
    key: routeKey,
    label: routeLabel(pairing),
    seed,
    path,
    distance: total,
    duration: clamp(total * 4.6, 1300, 6400),
    delay: index * 90,
    color: routeColors[index % routeColors.length],
  };
}

function selectedPathStrategy() {
  if (state.routeMode === "shortest-road") return shortestRoadPathStrategy;
  if (state.routeMode === "shortest") return shortestPathStrategy;
  if (state.routeMode === "cycle") return pathStrategies[(state.attempt - 1) % pathStrategies.length];
  return pathStrategies.find((strategy) => strategy.id === state.routeMode) || shortestPathStrategy;
}

function buildRoutePath(strategy, start, end, bounds, obstacles, rng, settings = {}) {
  if (strategy.id === "shortest-road") {
    const roadPath = findRoadSafePath(start, end, obstacles, bounds, rng, settings);
    return makePath(roadPath.points, [], roadPath.guides);
  }

  if (strategy.id === "shortest") {
    return makePath(findSafePath(start, end, obstacles, bounds, rng));
  }

  return buildStyledPath(strategy, start, end, bounds, obstacles, rng);
}

function routeKeyForPairing(pairing) {
  return `${pairing.startIndex}:${pairing.endIndex}`;
}

function routeLabel(pairing) {
  return `S${pairing.startIndex + 1}-E${pairing.endIndex + 1}`;
}

function routeSettingsFor(routeKey) {
  if (!state.routeSettings[routeKey]) {
    state.routeSettings[routeKey] = { clothoidScale: 1 };
  }

  return state.routeSettings[routeKey];
}

function updateRouteTuning() {
  const routes = state.activeRun?.routes || [];
  const selectedRoute = routes.find((route) => route.key === state.selectedRouteKey) || routes[0];

  if (!routes.length || !selectedRoute) {
    routeTunePanel.hidden = true;
    routePicker.replaceChildren();
    return;
  }

  if (state.selectedRouteKey !== selectedRoute.key) {
    state.selectedRouteKey = selectedRoute.key;
  }

  routeTunePanel.hidden = false;
  renderRoutePicker(routes);

  const settings = routeSettingsFor(selectedRoute.key);
  const radiusPercent = Math.round(clamp(settings.clothoidScale, 0.4, 1.8) * 100);
  clothoidRadiusSlider.value = String(radiusPercent);
  clothoidRadiusValue.value = String(radiusPercent);

  const radiusDisabled = state.activeRun.strategy.id !== "shortest-road";
  clothoidRadiusSlider.disabled = radiusDisabled;
  clothoidRadiusValue.disabled = radiusDisabled;
}

function renderRoutePicker(routes) {
  const fragment = document.createDocumentFragment();

  for (const route of routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `route-chip${route.key === state.selectedRouteKey ? " is-active" : ""}`;
    button.textContent = route.label;
    button.style.setProperty("--route-color", route.color);
    button.addEventListener("click", () => selectRoute(route.key));
    fragment.append(button);
  }

  routePicker.replaceChildren(fragment);
}

function selectRoute(routeKey) {
  state.selectedRouteKey = routeKey;
  updateRouteTuning();
}

function setSelectedRouteClothoidRadius(value) {
  if (!state.selectedRouteKey || state.activeRun?.strategy.id !== "shortest-road") return;

  const percent = clamp(Number(value) || 100, 40, 180);
  const settings = routeSettingsFor(state.selectedRouteKey);
  settings.clothoidScale = percent / 100;
  clothoidRadiusSlider.value = String(Math.round(percent));
  clothoidRadiusValue.value = String(Math.round(percent));
  rebuildSelectedRoute();
}

function rebuildSelectedRoute() {
  const run = state.activeRun;
  if (!run || run.strategy.id !== "shortest-road") return;

  const route = run.routes.find((candidate) => candidate.key === state.selectedRouteKey);
  if (!route) return;

  const rng = mulberry32(route.seed);
  const path = buildRoutePath(
    run.strategy,
    route.start,
    route.end,
    state.size,
    state.obstacles,
    rng,
    routeSettingsFor(route.key),
  );

  route.path = path;
  route.distance = pathLength(path.points);
  route.duration = clamp(route.distance * 4.6, 1300, 6400);
  run.totalDistance = run.routes.reduce((sum, current) => sum + current.distance, 0);
  run.duration = Math.max(...run.routes.map((current) => current.duration + current.delay));
  distanceText.textContent = `${Math.round(run.totalDistance)} px`;

  if (state.pattern) clearPatternState();

  updateStatus();
}

function generatePattern() {
  if (!state.activeRun?.routes?.length) return;

  state.patternAttempt += 1;
  const style = patternStyles[(state.patternAttempt - 1) % patternStyles.length];
  const selectedRoute =
    state.activeRun.routes.find((route) => route.key === state.selectedRouteKey) ||
    state.activeRun.routes[0];
  const sourceRoutes = selectedRoute ? [selectedRoute] : state.activeRun.routes;
  const alternativeResult = selectedRoute
    ? buildRouteAlternatives(selectedRoute, style, state.patternAttempt)
    : { lines: [], rejectedCount: 0 };
  const routes = sourceRoutes.map((route) => ({
    color: route.color,
    distance: route.distance,
    path: makePath(resamplePolyline(route.path.points, 96)),
    key: route.key,
    label: route.label,
  }));

  state.pattern = {
    style,
    routes,
    alternatives: alternativeResult.lines,
    rejectedCount: alternativeResult.rejectedCount,
    center: routeCollectionCenter(routes),
    startedAt: performance.now(),
    seed: state.patternAttempt,
  };

  patternText.textContent = alternativeResult.lines.length
    ? `${alternativeResult.lines.length} alt${alternativeResult.lines.length === 1 ? "" : "s"}`
    : "No alternatives";
  updateStatus();
}

function buildRouteAlternatives(route, style, attempt) {
  const basePoints = resamplePolyline(route.path.points, 96);
  const rng = mulberry32(hashSeed(`${route.key}-${route.seed}-${attempt}-alternatives`));
  const specs = alternativeCandidateSpecs(style, attempt, rng);
  const accepted = [];
  let rejectedCount = 0;

  for (const spec of specs) {
    if (accepted.length >= ALTERNATIVE_TARGET_COUNT) break;

    const points = makeAlternativeCandidatePoints(basePoints, spec);
    const candidate = {
      points,
      color: route.color,
      label: route.label,
      offset: spec.offset,
      width: 1.45,
      alpha: 0.44,
      length: pathLength(points),
    };

    if (!alternativeCandidateIsUseful(candidate, basePoints, accepted)) {
      rejectedCount += 1;
      continue;
    }

    if (!alternativePathIsClear(candidate.points, state.obstacles, state.size)) {
      rejectedCount += 1;
      continue;
    }

    accepted.push(candidate);
  }

  return {
    lines: accepted,
    rejectedCount,
  };
}

function alternativeCandidateSpecs(style, attempt, rng) {
  const specs = [];
  const baseGap = Math.max(13, style.gap || 18);
  const sideOrder = attempt % 2 === 0 ? [1, -1] : [-1, 1];
  const spread = [1.05, 1.45, 1.9, 2.4, 3.05, 3.75, 4.55, 5.45, 6.4];

  for (let level = 0; level < spread.length; level += 1) {
    for (const side of sideOrder) {
      const phase = rng() * Math.PI * 2 + attempt * 0.31 + level * 0.19;
      specs.push({
        offset: side * baseGap * spread[level],
        wave: (style.amplitude || 10) * lerp(0.18, 0.44, rng()),
        shoulder: side * baseGap * lerp(0.04, 0.18, rng()),
        frequency: (style.frequency || 1) + level * 0.08 + rng() * 0.45,
        phase,
      });
    }
  }

  return specs;
}

function makeAlternativeCandidatePoints(basePoints, spec) {
  const rawPoints = basePoints.map((point, index) => {
    if (index === 0 || index === basePoints.length - 1) {
      return { ...point };
    }

    const previous = basePoints[Math.max(0, index - 1)];
    const next = basePoints[Math.min(basePoints.length - 1, index + 1)];
    const tangent = unit(vector(previous, next));
    const normal = perpendicular(tangent);
    const t = index / (basePoints.length - 1);
    const envelope = Math.pow(Math.sin(Math.PI * t), 0.78);
    const wave = Math.sin(t * Math.PI * 2 * spec.frequency + spec.phase) * spec.wave;
    const shoulder = Math.sin(t * Math.PI + spec.phase * 0.23) * spec.shoulder;
    const offset = (spec.offset + wave + shoulder) * envelope;

    return add(point, scale(normal, offset));
  });

  return resamplePolyline(removeNearDuplicatePoints(rawPoints), basePoints.length);
}

function alternativeCandidateIsUseful(candidate, basePoints, accepted) {
  if (polylineSelfIntersects(candidate.points)) return false;
  if (polylinesHaveInteriorIntersection(candidate.points, basePoints)) return false;

  const baseDistance = averageInteriorDistance(candidate.points, basePoints);
  const maxShift = maxInteriorDistance(candidate.points, basePoints);
  if (baseDistance < ALTERNATIVE_MIN_SHIFT || maxShift < ALTERNATIVE_MIN_SHIFT * 1.35) {
    return false;
  }

  return accepted.every((line) => {
    if (polylinesHaveInteriorIntersection(candidate.points, line.points)) return false;
    if (interiorCloseRatio(candidate.points, line.points, ALTERNATIVE_MIN_GAP) > 0.34) return false;
    return averageInteriorDistance(candidate.points, line.points) >= ALTERNATIVE_MIN_GAP;
  });
}

function alternativePathIsClear(points, obstacles, bounds) {
  if (points.length < 2) return false;

  for (let index = 1; index < points.length - 1; index += 1) {
    if (!pointWithinBounds(points[index], bounds, 8)) return false;
    if (obstacles.some((obstacle) => pointInsideObstacleSolid(points[index], obstacle, ALTERNATIVE_CLEARANCE))) {
      return false;
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];

    for (const obstacle of obstacles) {
      if (segmentHitsObstacle(a, b, obstacle, ALTERNATIVE_CLEARANCE)) {
        return false;
      }
    }
  }

  return true;
}

function commitPattern() {
  const pattern = state.pattern;
  if (!pattern) return;

  const lines = snapshotPatternLines(pattern);
  if (lines.length === 0) {
    patternText.textContent = "No alternatives";
    updateStatus();
    return;
  }

  const layer = {
    id: state.commitAttempt + 1,
    name: pattern.style.name,
    createdAt: performance.now(),
    center: pattern.center,
    lines,
  };

  state.commitAttempt += 1;
  state.createdPatterns.push(layer);
  if (state.createdPatterns.length > 8) {
    state.createdPatterns.shift();
  }

  clearPatternState(`Committed ${String(layer.id).padStart(2, "0")}`);
  updateStatus();
}

function buildStyledPath(strategy, start, end, bounds, obstacles, rng) {
  const rawPath = strategy.build(start, end, bounds, rng);
  return makePath(avoidObstacles(rawPath.points, obstacles, bounds, rng), rawPath.probes);
}

function createAllPairings(starts, ends) {
  const pairings = [];

  starts.forEach((start, startIndex) => {
    ends.forEach((end, endIndex) => {
      pairings.push({
        start,
        end,
        startIndex,
        endIndex,
      });
    });
  });

  return pairings;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, rect.width);
  const height = Math.max(320, rect.height);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.size = { width, height, dpr };

  if (state.importedImage) {
    scheduleImageRecognition(0);
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, state.size.width),
    y: clamp(event.clientY - rect.top, 0, state.size.height),
  };
}

function setPoint(point) {
  if (state.mode === "obstacle") return;

  const next = clampPoint(point, state.size, 24);
  if (state.obstacles.some((obstacle) => pointInsideObstacleSolid(next, obstacle, 10))) {
    updateStatus();
    return;
  }

  invalidateRoutes();

  if (state.mode === "start") {
    state.starts.push(next);
  } else {
    state.ends.push(next);
  }

  updateStatus();
}

function selectRouteAtPoint(point) {
  const route = findRouteNearPoint(point);
  if (!route) return false;

  selectRoute(route.key);
  return true;
}

function findRouteNearPoint(point) {
  const routes = state.activeRun?.routes || [];
  let bestRoute = null;
  let bestDistance = 14;

  for (const route of routes) {
    const currentDistance = distanceToPolyline(point, route.path.points);

    if (currentDistance < bestDistance) {
      bestDistance = currentDistance;
      bestRoute = route;
    }
  }

  return bestRoute;
}

function distanceToPolyline(point, points) {
  if (!points || points.length < 2) return Infinity;

  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
  }

  return best;
}

function averageInteriorDistance(points, targetPoints) {
  const distances = sampledInteriorDistances(points, targetPoints);
  if (distances.length === 0) return Infinity;
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function maxInteriorDistance(points, targetPoints) {
  const distances = sampledInteriorDistances(points, targetPoints);
  if (distances.length === 0) return 0;
  return Math.max(...distances);
}

function interiorCloseRatio(points, targetPoints, threshold) {
  const distances = sampledInteriorDistances(points, targetPoints);
  if (distances.length === 0) return 0;
  const closeCount = distances.filter((value) => value < threshold).length;
  return closeCount / distances.length;
}

function sampledInteriorDistances(points, targetPoints) {
  if (!points || points.length < 3 || !targetPoints || targetPoints.length < 2) return [];

  const step = Math.max(1, Math.floor(points.length / 34));
  const distances = [];

  for (let index = 1; index < points.length - 1; index += step) {
    const t = index / (points.length - 1);
    if (t < 0.08 || t > 0.92) continue;
    distances.push(distanceToPolyline(points[index], targetPoints));
  }

  return distances;
}

function polylinesHaveInteriorIntersection(points, targetPoints) {
  if (!points || !targetPoints || points.length < 2 || targetPoints.length < 2) return false;

  for (let i = 1; i < points.length; i += 1) {
    for (let j = 1; j < targetPoints.length; j += 1) {
      if (Math.abs(i - j) <= 1 && points === targetPoints) continue;

      const a = points[i - 1];
      const b = points[i];
      const c = targetPoints[j - 1];
      const d = targetPoints[j];

      if (!segmentsIntersect(a, b, c, d)) continue;
      if (intersectionOnlyAtSharedEndpoint(a, b, c, d)) continue;
      return true;
    }
  }

  return false;
}

function polylineSelfIntersects(points) {
  if (!points || points.length < 4) return false;

  for (let i = 1; i < points.length; i += 1) {
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 1 && j === points.length - 1) continue;

      const a = points[i - 1];
      const b = points[i];
      const c = points[j - 1];
      const d = points[j];

      if (!segmentsIntersect(a, b, c, d)) continue;
      if (intersectionOnlyAtSharedEndpoint(a, b, c, d)) continue;
      return true;
    }
  }

  return false;
}

function openImagePicker() {
  imageInput.click();
}

function handleImageInputChange(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    loadImportedImageFromDataUrl(reader.result, file.name);
  });
  reader.readAsDataURL(file);
}

function loadImportedImageFromDataUrl(source, name = "image") {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => {
      state.importedImage = {
        image,
        name,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      };
      invalidateRoutes();
      recognizeImageObstacles();
      resolve(state.importedImage);
    });

    image.addEventListener("error", reject);
    image.src = source;
  });
}

function updateImageThreshold() {
  state.imageThreshold = Number(thresholdSlider.value);
  scheduleImageRecognition();
}

function updateImagePolarity() {
  state.detectBrightAreas = brightAreaToggle.checked;
  scheduleImageRecognition(0);
}

function scheduleImageRecognition(delay = 160) {
  if (!state.importedImage) return;

  clearTimeout(state.recognitionTimer);
  state.recognitionTimer = setTimeout(() => {
    state.recognitionTimer = null;
    recognizeImageObstacles();
  }, delay);
}

function recognizeImageObstacles() {
  if (!state.importedImage) return [];

  state.imageRecognizing = true;
  updateStatus();

  const detected = detectObstaclesFromImage();
  const placedPoints = [...state.starts, ...state.ends];
  const usableDetected = detected.filter(
    (obstacle) => !placedPoints.some((point) => pointInsideObstacleSolid(point, obstacle, 8)),
  );

  state.obstacles = [
    ...state.obstacles.filter((obstacle) => obstacle.source !== "image"),
    ...usableDetected,
  ];
  invalidateRoutes();
  state.imageRecognizing = false;
  updateStatus();

  return usableDetected;
}

function detectObstaclesFromImage() {
  const imageState = state.importedImage;
  if (!imageState) return [];

  const fit = imageFitRect(imageState.image, state.size);
  if (fit.width <= 0 || fit.height <= 0) return [];

  const analysisScale = Math.min(1, IMAGE_ANALYSIS_MAX_WIDTH / fit.width);
  const width = Math.max(1, Math.round(fit.width * analysisScale));
  const height = Math.max(1, Math.round(fit.height * analysisScale));
  const analysisCanvas = document.createElement("canvas");
  const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });

  analysisCanvas.width = width;
  analysisCanvas.height = height;
  analysisContext.drawImage(imageState.image, 0, 0, width, height);

  const pixels = analysisContext.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const threshold = state.imageThreshold;

  for (let index = 0; index < mask.length; index += 1) {
    const pixelIndex = index * 4;
    const alpha = pixels[pixelIndex + 3];
    if (alpha < 30) continue;

    const brightness =
      pixels[pixelIndex] * 0.2126 + pixels[pixelIndex + 1] * 0.7152 + pixels[pixelIndex + 2] * 0.0722;
    mask[index] = state.detectBrightAreas ? brightness >= threshold : brightness <= threshold;
  }

  const queue = new Int32Array(width * height);
  const components = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;

    const component = traceImageComponent(index, mask, visited, queue, width, height, fit);
    if (component) components.push(component);
  }

  return components
    .map((component) => componentToImageObstacle(component))
    .filter(Boolean)
    .sort((a, b) => polygonAreaValue(b.vertices) - polygonAreaValue(a.vertices))
    .slice(0, IMAGE_OBSTACLE_LIMIT);
}

function traceImageComponent(startIndex, mask, visited, queue, width, height, fit) {
  let head = 0;
  let tail = 0;
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const boundary = [];

  queue[tail] = startIndex;
  tail += 1;
  visited[startIndex] = 1;

  while (head < tail) {
    const index = queue[head];
    head += 1;

    const x = index % width;
    const y = Math.floor(index / width);
    count += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    if (isImageBoundaryPixel(x, y, mask, width, height) && boundary.length < 800 && count % 3 === 0) {
      boundary.push(mapAnalysisPointToStage(x, y, width, height, fit));
    }

    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
      const nextX = next % width;
      if (Math.abs(nextX - x) > 1) continue;
      visited[next] = 1;
      queue[tail] = next;
      tail += 1;
    }
  }

  const widthStage = ((maxX - minX + 1) / width) * fit.width;
  const heightStage = ((maxY - minY + 1) / height) * fit.height;
  const componentAreaRatio = count / (width * height);
  const stageArea = widthStage * heightStage;

  if (
    count < IMAGE_COMPONENT_MIN_AREA ||
    componentAreaRatio > 0.86 ||
    stageArea < 260 ||
    (widthStage < 16 && heightStage < 16)
  ) {
    return null;
  }

  return { boundary, minX, minY, maxX, maxY, width, height, fit };
}

function componentToImageObstacle(component) {
  const rectangle = analysisRectToStagePolygon(component);
  const sourcePoints = component.boundary.length >= 3 ? component.boundary : rectangle;
  const hull = convexHull(sourcePoints);
  const vertices = simplifyPolygonByArea(hull.length >= 3 ? hull : rectangle, 10);

  if (vertices.length < 3 || polygonAreaValue(vertices) < 220) return null;

  const center = polygonCenter(vertices);
  return {
    shape: "polygon",
    center,
    radius: Math.max(...vertices.map((vertex) => distance(center, vertex))),
    angle: 0,
    vertices,
    source: "image",
  };
}

function drawImportedImage() {
  if (!state.importedImage) return;

  const fit = imageFitRect(state.importedImage.image, state.size);

  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.drawImage(state.importedImage.image, fit.x, fit.y, fit.width, fit.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(33, 31, 29, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(fit.x, fit.y, fit.width, fit.height);
  ctx.restore();
}

function imageFitRect(image, bounds) {
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (bounds.width - width) * 0.5,
    y: (bounds.height - height) * 0.5,
    width,
    height,
  };
}

function isImageBoundaryPixel(x, y, mask, width, height) {
  if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return true;

  const index = y * width + x;
  return !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width];
}

function mapAnalysisPointToStage(x, y, width, height, fit) {
  return {
    x: fit.x + (x / Math.max(1, width - 1)) * fit.width,
    y: fit.y + (y / Math.max(1, height - 1)) * fit.height,
  };
}

function analysisRectToStagePolygon(component) {
  const a = mapAnalysisPointToStage(component.minX, component.minY, component.width, component.height, component.fit);
  const b = mapAnalysisPointToStage(component.maxX, component.minY, component.width, component.height, component.fit);
  const c = mapAnalysisPointToStage(component.maxX, component.maxY, component.width, component.height, component.fit);
  const d = mapAnalysisPointToStage(component.minX, component.maxY, component.width, component.height, component.fit);

  return [a, b, c, d];
}

function draw(now) {
  ctx.clearRect(0, 0, state.size.width, state.size.height);
  drawImportedImage();
  drawGrid();
  drawCreatedPatterns(now);
  drawPattern(now);
  drawCurrentRun(now);
  drawObstacles();
  drawDraftObstacle();
  drawPoints(state.starts, palette.start, "S");
  drawPoints(state.ends, palette.end, "E");
  drawPointer();
  requestAnimationFrame(draw);
}

function drawPattern(now) {
  const pattern = state.pattern;
  if (!pattern?.alternatives?.length) return;

  const age = (now - pattern.startedAt) * 0.001;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  for (let index = 0; index < pattern.alternatives.length; index += 1) {
    const line = pattern.alternatives[index];
    const pulse = 0.92 + Math.sin(age * 1.4 + index * 0.7) * 0.04;

    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.globalAlpha = line.alpha * pulse;
    ctx.lineWidth = line.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (index % 2 === 1) ctx.setLineDash([10, 8]);
    strokePolyline(line.points);
    ctx.restore();
  }

  ctx.restore();
}

function drawCreatedPatterns(now) {
  if (state.createdPatterns.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";

  for (const layer of state.createdPatterns) {
    const age = (now - layer.createdAt) * 0.001;
    const reveal = easeOutCubic(clamp(age / 0.9, 0, 1));

    for (const line of layer.lines) {
      drawCommittedLine(line.points, line, reveal);
    }
  }

  ctx.restore();
}

function drawCommittedLine(points, line, reveal) {
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = line.color;
  ctx.globalAlpha = line.alpha * (0.35 + reveal * 0.65);
  ctx.lineWidth = line.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = line.color;
  ctx.shadowBlur = 8 * reveal;

  if (reveal < 1) {
    strokePolylineUntil(points, line.length * reveal);
  } else {
    strokePolyline(points);
  }

  ctx.restore();
}

function snapshotPatternLines(pattern) {
  const lines = [];
  const alternatives = pattern.alternatives || [];

  for (const line of alternatives) {
    lines.push({
      points: line.points.map((point) => ({ ...point })),
      color: line.color,
      alpha: line.alpha,
      width: line.width,
      length: line.length,
    });
  }

  return lines;
}

function beginObstacle(point) {
  state.draftObstacle = {
    shape: state.obstacleShape,
    origin: point,
    current: point,
  };
  state.pointer = point;
}

function updateDraftObstacle(point) {
  if (!state.draftObstacle) return;

  state.draftObstacle.current = point;
  state.pointer = point;
}

function commitDraftObstacle() {
  if (!state.draftObstacle) return;

  const obstacle = obstacleFromDraft(state.draftObstacle);
  state.draftObstacle = null;

  if (!obstacle) {
    updateStatus();
    return;
  }

  const placedPoints = [...state.starts, ...state.ends];
  if (placedPoints.some((point) => pointInsideObstacleSolid(point, obstacle, 10))) {
    updateStatus();
    return;
  }

  state.obstacles.push(obstacle);
  invalidateRoutes();
  updateStatus();
}

function obstacleFromDraft(draft) {
  const maxRadius = Math.max(34, Math.min(state.size.width, state.size.height) * 0.34);
  const radius = clamp(distance(draft.origin, draft.current), 26, maxRadius);
  const angle = Math.atan2(draft.current.y - draft.origin.y, draft.current.x - draft.origin.x);
  const center = clampPoint(draft.origin, state.size, radius + 10);

  return {
    shape: draft.shape,
    center,
    radius,
    angle,
  };
}

function drawObstacles() {
  for (let index = 0; index < state.obstacles.length; index += 1) {
    drawObstacle(state.obstacles[index], index + 1, false);
  }
}

function drawDraftObstacle() {
  if (!state.draftObstacle) return;
  drawObstacle(obstacleFromDraft(state.draftObstacle), null, true);
}

function drawObstacle(obstacle, index, isDraft) {
  if (!obstacle) return;

  ctx.save();
  ctx.fillStyle =
    obstacle.source === "image" && !isDraft ? "rgba(33, 31, 29, 0.15)" : "rgba(33, 31, 29, 0.18)";
  ctx.strokeStyle =
    obstacle.source === "image" && !isDraft ? "rgba(33, 31, 29, 0.52)" : "rgba(33, 31, 29, 0.64)";
  if (isDraft) {
    ctx.fillStyle = "rgba(33, 31, 29, 0.12)";
    ctx.strokeStyle = "rgba(33, 31, 29, 0.46)";
  }
  ctx.lineWidth = isDraft ? 2 : 2.5;
  ctx.setLineDash(isDraft ? [7, 6] : []);

  ctx.beginPath();
  if (obstacle.shape === "circle") {
    ctx.arc(obstacle.center.x, obstacle.center.y, obstacle.radius, 0, Math.PI * 2);
  } else {
    const vertices = obstacleVertices(obstacle);
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i += 1) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  if (index) {
    ctx.fillStyle = "#fffaf2";
    ctx.strokeStyle = "rgba(33, 31, 29, 0.64)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(obstacle.center.x, obstacle.center.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = palette.ink;
    ctx.font = "800 10px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`O${index}`, obstacle.center.x, obstacle.center.y + 0.5);
  }

  ctx.restore();
}

function obstacleVertices(obstacle) {
  if (obstacle.shape === "polygon") {
    return obstacle.vertices || [];
  }

  const sidesByShape = {
    triangle: 3,
    square: 4,
    pentagon: 5,
  };
  const sides = sidesByShape[obstacle.shape] || 4;
  const startAngle = obstacle.angle - Math.PI / 2;
  const vertices = [];

  for (let i = 0; i < sides; i += 1) {
    const angle = startAngle + (Math.PI * 2 * i) / sides;
    vertices.push({
      x: obstacle.center.x + Math.cos(angle) * obstacle.radius,
      y: obstacle.center.y + Math.sin(angle) * obstacle.radius,
    });
  }

  return vertices;
}

function obstacleLabel(shape) {
  const labels = {
    circle: "circle",
    triangle: "triangle",
    square: "square",
    pentagon: "pentagon",
    polygon: "detected",
  };
  return labels[shape] || "shape";
}

function drawGrid() {
  const { width, height } = state.size;
  const gap = 32;

  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;

  for (let x = 0; x <= width; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y <= height; y += gap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCurrentRun(now) {
  const run = state.activeRun;
  if (!run) return;

  const elapsed = now - run.startedAt;
  let finishedRoutes = 0;
  const routes = routesWithSelectedLast(run.routes);

  for (const route of routes) {
    const progress = routeProgress(elapsed, route);
    drawProbes(route.path.probes, route.color, progress);
    drawPath(route.path.points, route.color, 1, true, route.key === state.selectedRouteKey);
  }

  for (const route of routes) {
    const progress = routeProgress(elapsed, route);
    const traveled = route.distance * easeInOutCubic(progress);
    drawPartialPath(route.path.points, route.color, traveled, route.key === state.selectedRouteKey);

    if (progress >= 1) {
      finishedRoutes += 1;
    } else if (progress > 0) {
      drawAgent(pointAtDistance(route.path.points, traveled), route.color, now);
    }
  }

  const selectedRoute = run.routes.find((route) => route.key === state.selectedRouteKey);
  if (selectedRoute) {
    drawRouteGuides(selectedRoute.path.guides, selectedRoute.color);
  }

  if (finishedRoutes === run.routes.length && !run.done) {
    run.done = true;
    updateStatus();
  }
}

function routesWithSelectedLast(routes) {
  if (!state.selectedRouteKey) return routes;

  return [...routes].sort((a, b) => {
    if (a.key === state.selectedRouteKey) return 1;
    if (b.key === state.selectedRouteKey) return -1;
    return 0;
  });
}

function routeProgress(elapsed, route) {
  return clamp((elapsed - route.delay) / route.duration, 0, 1);
}

function drawProbes(probes, color, progress) {
  if (!probes || probes.length === 0) return;

  const visible = Math.floor(probes.length * clamp(progress + 0.16, 0, 1));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = 1;

  for (let i = 0; i < visible; i += 1) {
    const probe = probes[i];
    ctx.beginPath();
    ctx.moveTo(probe.from.x, probe.from.y);
    ctx.lineTo(probe.to.x, probe.to.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPath(points, color, alpha, dashed, selected = false) {
  if (!points || points.length < 2) return;

  ctx.save();

  if (selected) {
    ctx.strokeStyle = "#fffaf2";
    ctx.globalAlpha = 0.62;
    ctx.lineWidth = 5.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokePolyline(points);
  }

  ctx.strokeStyle = color;
  ctx.globalAlpha = selected ? alpha * 0.36 : alpha * 0.16;
  ctx.lineWidth = selected ? 2.4 : 1.6;
  if (dashed) ctx.setLineDash([7, 10]);
  strokePolyline(points);
  ctx.restore();
}

function drawPartialPath(points, color, length, selected = false) {
  if (!points || points.length < 2) return;

  ctx.save();

  if (selected) {
    ctx.strokeStyle = "#fffaf2";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.72;
    strokePolylineUntil(points, length);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3.8 : 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = selected ? 9 : 6;

  ctx.beginPath();
  let remaining = length;
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);

    if (remaining >= segmentLength) {
      ctx.lineTo(b.x, b.y);
      remaining -= segmentLength;
    } else {
      const partial = mix(a, b, segmentLength === 0 ? 0 : remaining / segmentLength);
      ctx.lineTo(partial.x, partial.y);
      break;
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawPoints(points, color, prefix) {
  points.forEach((point, index) => {
    drawPoint(point, color, `${prefix}${index + 1}`);
  });
}

function drawPoint(point, color, label) {
  if (!point) return;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fffaf2";
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fffaf2";
  ctx.font = "800 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, point.x, point.y + 0.5);
  ctx.restore();
}

function drawAgent(point, color, now) {
  if (!point) return;

  const pulse = Math.sin(now * 0.01) * 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#211f1d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 7 + pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPointer() {
  if (!state.pointer) return;

  ctx.save();
  ctx.strokeStyle = "rgba(33, 31, 29, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(state.pointer.x - 12, state.pointer.y);
  ctx.lineTo(state.pointer.x + 12, state.pointer.y);
  ctx.moveTo(state.pointer.x, state.pointer.y - 12);
  ctx.lineTo(state.pointer.x, state.pointer.y + 12);
  ctx.stroke();
  ctx.restore();
}

function strokePolyline(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawRouteGuides(guides, color) {
  if (!guides || guides.length === 0) return;

  const visibleGuides = guides.filter((guide, index) => {
    return index === 0 || distance(guide.point, guides[index - 1].point) > 7;
  });

  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = "800 9px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  visibleGuides.forEach((guide, index) => {
    const { point } = guide;
    const isCorner = guide.type === "corner";

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = "#fffaf2";
    ctx.strokeStyle = isCorner ? palette.ink : color;

    if (isCorner) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-5, -5, 10, 10);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    if (index < 9) {
      ctx.fillStyle = isCorner ? palette.ink : color;
      ctx.fillText(String(index + 1), point.x, point.y + 0.3);
    }
  });

  ctx.restore();
}

function strokePolylineUntil(points, target) {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  let remaining = target;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);

    if (remaining >= segmentLength) {
      ctx.lineTo(b.x, b.y);
      remaining -= segmentLength;
    } else {
      const partial = mix(a, b, segmentLength === 0 ? 0 : remaining / segmentLength);
      ctx.lineTo(partial.x, partial.y);
      break;
    }
  }

  ctx.stroke();
}

function makePath(points, probes = [], guides = []) {
  return {
    points: points.map((point) => ({ x: point.x, y: point.y })),
    probes,
    guides: guides.map((guide) => ({
      type: guide.type || "node",
      point: { x: guide.point.x, y: guide.point.y },
    })),
  };
}

function sampleQuadratic(start, control, end, steps) {
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const oneMinus = 1 - t;
    points.push({
      x: oneMinus * oneMinus * start.x + 2 * oneMinus * t * control.x + t * t * end.x,
      y: oneMinus * oneMinus * start.y + 2 * oneMinus * t * control.y + t * t * end.y,
    });
  }

  return points;
}

function smoothCorners(points, samples) {
  if (points.length < 3) return points;

  const result = [points[0]];

  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];

    for (let j = 1; j <= samples; j += 1) {
      const t = j / samples;
      const a = mix(previous, current, t);
      const b = mix(current, next, t);
      result.push(mix(a, b, t));
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function avoidObstacles(points, obstacles, bounds, rng) {
  if (!obstacles.length || points.length < 2) {
    return points.map((point) => ({ ...point }));
  }

  const cleanPoints = points.filter((point, index) => {
    const isEndpoint = index === 0 || index === points.length - 1;
    return isEndpoint || !pointInsideAnyObstacleCollision(point, obstacles);
  });
  const route = [cleanPoints[0]];

  for (let i = 1; i < cleanPoints.length; i += 1) {
    const current = route[route.length - 1];
    const target = cleanPoints[i];

    if (segmentClearOfObstacles(current, target, obstacles)) {
      route.push(target);
      continue;
    }

    const safeSegment = findSafePath(current, target, obstacles, bounds, rng);
    if (safeSegment.length > 1) {
      route.push(...safeSegment.slice(1));
    } else if (segmentClearOfObstacles(current, target, obstacles)) {
      route.push(target);
    }
  }

  return removeNearDuplicatePoints(route);
}

function pointInsideObstacleCollision(point, obstacle) {
  return pointInsideObstacleSolid(point, obstacle, PATH_CLEARANCE);
}

function pointInsideAnyObstacleCollision(point, obstacles) {
  return obstacles.some((obstacle) => pointInsideObstacleCollision(point, obstacle));
}

function pointInsideObstacleSolid(point, obstacle, padding = 0) {
  if (obstacle.shape === "circle") {
    return distance(point, obstacle.center) <= obstacle.radius + padding;
  }

  const vertices = obstacleVertices(obstacle);
  if (pointInPolygon(point, vertices)) return true;

  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (distanceToSegment(point, a, b) <= padding) return true;
  }

  return false;
}

function pointInPolygon(point, vertices) {
  let inside = false;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function distanceToSegment(point, a, b) {
  return distance(point, segmentProjection(a, b, point).point);
}

function segmentToSegmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;

  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;

  return false;
}

function intersectionOnlyAtSharedEndpoint(a, b, c, d) {
  return (
    pointsAlmostEqual(a, c) ||
    pointsAlmostEqual(a, d) ||
    pointsAlmostEqual(b, c) ||
    pointsAlmostEqual(b, d)
  );
}

function orientation(a, b, c) {
  const value = cross(vector(a, b), vector(a, c));
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(point, a, b) {
  return (
    point.x <= Math.max(a.x, b.x) + 0.0001 &&
    point.x >= Math.min(a.x, b.x) - 0.0001 &&
    point.y <= Math.max(a.y, b.y) + 0.0001 &&
    point.y >= Math.min(a.y, b.y) - 0.0001
  );
}

function pointsAlmostEqual(a, b) {
  return distance(a, b) < 0.001;
}

function midpointOfSegment(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function findSafePath(start, end, obstacles, bounds, rng) {
  return routeNodesToPathPoints(findSafeRouteNodes(start, end, obstacles, bounds, rng), obstacles);
}

function findRoadSafePath(start, end, obstacles, bounds, rng, settings = {}) {
  const routeNodes = findSafeRouteNodes(start, end, obstacles, bounds, rng, roadRadiusOffset(settings));
  const seedPath = routeNodesToPathPoints(routeNodes, obstacles);
  const roadPath = buildRoadGeometryPath(seedPath, obstacles, bounds, settings);
  const guides = mergeGuideMarkers([...routeNodesToGuideMarkers(routeNodes), ...roadPath.guides]);

  return {
    points: roadPath.points,
    guides,
  };
}

function roadRadiusOffset(settings = {}) {
  return Math.max(0, (clamp(settings.clothoidScale || 1, 0.4, 1.8) - 1) * 72);
}

function findSafeRouteNodes(start, end, obstacles, bounds, rng, pathClearance = PATH_CLEARANCE) {
  const nodes = buildPathNodes(start, end, obstacles, bounds, rng, pathClearance);
  const graph = buildVisibilityGraph(nodes, obstacles);
  const pathIndexes = shortestPathIndexes(graph, 0, 1);

  if (!pathIndexes.length) {
    return segmentClearOfObstacles(start, end, obstacles) ? [nodes[0], nodes[1]] : [nodes[0]];
  }

  return pathIndexes.map((index) => nodes[index]);
}

function routeNodesToPathPoints(routeNodes, obstacles) {
  if (!routeNodes.length) return [];

  const points = [routeNodes[0].point];

  for (let i = 1; i < routeNodes.length; i += 1) {
    const previous = routeNodes[i - 1];
    const current = routeNodes[i];
    const circleArc = sameObstacleAdjacent(previous, current) && obstacles[previous.obstacleIndex]?.shape === "circle";

    if (circleArc) {
      points.push(...sampleObstacleCircleArc(obstacles[previous.obstacleIndex], previous.point, current.point).slice(1));
    } else {
      points.push(current.point);
    }
  }

  return removeNearDuplicatePoints(points);
}

function routeNodesToGuideMarkers(routeNodes) {
  const guides = [];

  for (let i = 1; i < routeNodes.length - 1; i += 1) {
    const previous = routeNodes[i - 1];
    const current = routeNodes[i];
    const next = routeNodes[i + 1];

    if (current.obstacleIndex >= 0) {
      const continuesSameArc =
        previous.obstacleIndex === current.obstacleIndex &&
        next.obstacleIndex === current.obstacleIndex &&
        angleIndexesAreAdjacent(previous.angleIndex, current.angleIndex, current.sampleCount) &&
        angleIndexesAreAdjacent(current.angleIndex, next.angleIndex, current.sampleCount);

      if (!continuesSameArc) {
        guides.push({ point: current.point, type: "tangent" });
      }
    } else {
      guides.push({ point: current.point, type: "corner" });
    }
  }

  return guides;
}

function mergeGuideMarkers(guides) {
  const merged = [];

  for (const guide of guides) {
    if (!guide?.point) continue;
    const duplicate = merged.some((existing) => distance(existing.point, guide.point) < 9);
    if (!duplicate) merged.push(guide);
  }

  return merged;
}

function sampleObstacleCircleArc(obstacle, from, to) {
  const startAngle = Math.atan2(from.y - obstacle.center.y, from.x - obstacle.center.x);
  const angleDelta = circleArcDelta(obstacle, from, to);
  const radius = circleArcRadius(obstacle, from, to);
  const steps = Math.max(4, Math.ceil((Math.abs(angleDelta) * radius) / 9));
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    const angle = startAngle + angleDelta * (i / steps);
    points.push({
      x: obstacle.center.x + Math.cos(angle) * radius,
      y: obstacle.center.y + Math.sin(angle) * radius,
    });
  }

  return points;
}

function circleArcLength(obstacle, from, to) {
  return Math.abs(circleArcDelta(obstacle, from, to)) * circleArcRadius(obstacle, from, to);
}

function circleArcRadius(obstacle, from, to) {
  return Math.max(obstacle.radius, (distance(obstacle.center, from) + distance(obstacle.center, to)) * 0.5);
}

function circleArcDelta(obstacle, from, to) {
  const startAngle = Math.atan2(from.y - obstacle.center.y, from.x - obstacle.center.x);
  const endAngle = Math.atan2(to.y - obstacle.center.y, to.x - obstacle.center.x);

  return normalizeAngle(endAngle - startAngle);
}

function buildRoadGeometryPath(points, obstacles, bounds, settings = {}) {
  const cleanPoints = removeNearDuplicatePoints(points);
  if (cleanPoints.length < 3) return { points: cleanPoints, guides: [] };

  const road = [cleanPoints[0]];
  const guides = [];

  for (let i = 1; i < cleanPoints.length - 1; i += 1) {
    const previous = cleanPoints[i - 1];
    const current = cleanPoints[i];
    const next = cleanPoints[i + 1];
    const corner = roadCornerTransition(previous, current, next, obstacles, bounds, settings);

    if (!corner) {
      road.push(current);
      continue;
    }

    if (distance(road[road.length - 1], corner[0]) > 1) {
      road.push(corner[0]);
    }

    road.push(...corner.slice(1));
    guides.push({ point: corner[0], type: "tangent" });
    guides.push({ point: corner[corner.length - 1], type: "tangent" });
    guides.push({ point: current, type: "corner" });
  }

  road.push(cleanPoints[cleanPoints.length - 1]);
  return {
    points: removeNearDuplicatePoints(road),
    guides: mergeGuideMarkers(guides),
  };
}

function roadCornerTransition(previous, current, next, obstacles, bounds, settings = {}) {
  const incomingLength = distance(previous, current);
  const outgoingLength = distance(current, next);
  if (incomingLength < 7 || outgoingLength < 7) return null;

  const incomingDirection = unit(vector(previous, current));
  const outgoingDirection = unit(vector(current, next));
  const turnAngle = Math.acos(clamp(dot(incomingDirection, outgoingDirection), -1, 1));
  if (turnAngle < 0.12 || turnAngle > Math.PI - 0.08) return null;

  const radiusScale = clamp(settings.clothoidScale || 1, 0.4, 1.8);
  const maxTrim = Math.min(incomingLength, outgoingLength) * 0.46;
  const minTrim = Math.min(7, maxTrim);
  const baseTrim = clamp(maxTrim * (0.58 + turnAngle / Math.PI) * radiusScale, minTrim, Math.min(132, maxTrim));
  const trimAttempts = [baseTrim, baseTrim * 0.82, baseTrim * 0.62, baseTrim * 0.42, baseTrim * 0.25];

  for (const trim of trimAttempts) {
    if (trim < minTrim || trim > maxTrim) continue;

    const entry = add(current, scale(incomingDirection, -trim));
    const exit = add(current, scale(outgoingDirection, trim));
    const transition = sampleClothoidTransition(entry, exit, incomingDirection, outgoingDirection, trim, turnAngle);

    if (roadCandidateIsClear(transition, obstacles, bounds)) {
      return transition;
    }
  }

  return null;
}

function sampleClothoidTransition(entry, exit, incomingDirection, outgoingDirection, trim, turnAngle) {
  const handle = trim * clamp(0.48 + turnAngle * 0.08, 0.5, 0.76);
  const controlA = add(entry, scale(incomingDirection, handle));
  const controlB = add(exit, scale(outgoingDirection, -handle));
  const steps = Math.ceil(clamp(10 + turnAngle * 7 + trim * 0.1, 12, 26));
  const points = [];

  for (let i = 0; i <= steps; i += 1) {
    points.push(cubicBezierPoint(entry, controlA, controlB, exit, i / steps));
  }

  return points;
}

function roadCandidateIsClear(points, obstacles, bounds) {
  if (!points.every((point) => pointWithinBounds(point, bounds, 8))) return false;

  for (let i = 1; i < points.length; i += 1) {
    if (!segmentClearOfObstacles(points[i - 1], points[i], obstacles)) return false;
  }

  return true;
}

function cubicBezierPoint(a, b, c, d, t) {
  const oneMinus = 1 - t;
  const aa = oneMinus * oneMinus * oneMinus;
  const bb = 3 * oneMinus * oneMinus * t;
  const cc = 3 * oneMinus * t * t;
  const dd = t * t * t;

  return {
    x: aa * a.x + bb * b.x + cc * c.x + dd * d.x,
    y: aa * a.y + bb * b.y + cc * c.y + dd * d.y,
  };
}

function buildPathNodes(start, end, obstacles, bounds, rng, pathClearance = PATH_CLEARANCE) {
  const nodes = [
    { point: start, obstacleIndex: -1, angleIndex: -1 },
    { point: end, obstacleIndex: -1, angleIndex: -1 },
  ];
  const baseAngle = Math.atan2(end.y - start.y, end.x - start.x);

  obstacles.forEach((obstacle, obstacleIndex) => {
    nodes.push(...obstaclePathNodes(obstacle, obstacleIndex, bounds, baseAngle, rng, pathClearance));
  });

  addBoundaryPathNodes(nodes, obstacles, bounds);

  return nodes;
}

function obstaclePathNodes(obstacle, obstacleIndex, bounds, baseAngle, rng, pathClearance = PATH_CLEARANCE) {
  if (obstacle.shape === "circle") {
    return circlePathNodes(obstacle, obstacleIndex, bounds, baseAngle, rng, pathClearance);
  }

  return polygonPathNodes(obstacle, obstacleIndex, bounds, pathClearance);
}

function circlePathNodes(obstacle, obstacleIndex, bounds, baseAngle, rng, pathClearance = PATH_CLEARANCE) {
  const sampleCount = 96;
  const radius = obstacle.radius + pathClearance;
  const jitter = 0;
  const nodes = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const angle = baseAngle + jitter + (Math.PI * 2 * i) / sampleCount;
    nodes.push({
      point: clampPoint(
        {
          x: obstacle.center.x + Math.cos(angle) * radius,
          y: obstacle.center.y + Math.sin(angle) * radius,
        },
        bounds,
        12,
      ),
      obstacleIndex,
      angleIndex: i,
      sampleCount,
    });
  }

  return nodes;
}

function polygonPathNodes(obstacle, obstacleIndex, bounds, pathClearance = PATH_CLEARANCE) {
  const vertices = obstacleVertices(obstacle);
  const sampleCount = vertices.length;

  return vertices.map((vertex, index) => ({
    point: clampPoint(pushAwayFromCenter(vertex, obstacle.center, pathClearance), bounds, 12),
    obstacleIndex,
    angleIndex: index,
    sampleCount,
  }));
}

function pushAwayFromCenter(point, center, amount) {
  return add(point, scale(unit(vector(center, point)), amount));
}

function addBoundaryPathNodes(nodes, obstacles, bounds) {
  const margin = 26;
  const gap = 96;
  const xCount = Math.max(2, Math.floor((bounds.width - margin * 2) / gap));
  const yCount = Math.max(2, Math.floor((bounds.height - margin * 2) / gap));

  for (let i = 0; i <= xCount; i += 1) {
    const x = lerp(margin, bounds.width - margin, i / xCount);
    pushBoundaryNode(nodes, { x, y: margin }, obstacles);
    pushBoundaryNode(nodes, { x, y: bounds.height - margin }, obstacles);
  }

  for (let i = 1; i < yCount; i += 1) {
    const y = lerp(margin, bounds.height - margin, i / yCount);
    pushBoundaryNode(nodes, { x: margin, y }, obstacles);
    pushBoundaryNode(nodes, { x: bounds.width - margin, y }, obstacles);
  }
}

function pushBoundaryNode(nodes, point, obstacles) {
  if (pointInsideAnyObstacleCollision(point, obstacles)) return;

  nodes.push({
    point,
    obstacleIndex: -2,
    angleIndex: -1,
  });
}

function buildVisibilityGraph(nodes, obstacles) {
  const graph = nodes.map(() => []);

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (!nodesCanConnect(nodes[i], nodes[j], obstacles)) continue;

      const weight = visibilityEdgeWeight(nodes[i], nodes[j], obstacles);
      graph[i].push({ index: j, weight });
      graph[j].push({ index: i, weight });
    }
  }

  return graph;
}

function nodesCanConnect(a, b, obstacles) {
  if (sameObstacleAdjacent(a, b)) {
    return segmentClearOfObstacles(a.point, b.point, obstacles, a.obstacleIndex);
  }

  const usesEndpoint = a.obstacleIndex === -1 || b.obstacleIndex === -1;
  return segmentClearOfObstacles(a.point, b.point, obstacles, -1, usesEndpoint);
}

function visibilityEdgeWeight(a, b, obstacles) {
  if (sameObstacleAdjacent(a, b) && obstacles[a.obstacleIndex]?.shape === "circle") {
    return circleArcLength(obstacles[a.obstacleIndex], a.point, b.point);
  }

  return distance(a.point, b.point);
}

function sameObstacleAdjacent(a, b) {
  return (
    a.obstacleIndex >= 0 &&
    a.obstacleIndex === b.obstacleIndex &&
    angleIndexesAreAdjacent(a.angleIndex, b.angleIndex, a.sampleCount)
  );
}

function angleIndexesAreAdjacent(a, b, sampleCount) {
  const diff = Math.abs(a - b);
  return diff === 1 || diff === sampleCount - 1;
}

function segmentClearOfObstacles(a, b, obstacles, ignoredObstacleIndex = -1, relaxedEndpoint = false) {
  return obstacles.every((obstacle, index) => {
    if (index === ignoredObstacleIndex) return true;
    const clearance = relaxedEndpoint ? 0 : PATH_CLEARANCE;
    return !segmentHitsObstacle(a, b, obstacle, clearance);
  });
}

function segmentHitsObstacle(a, b, obstacle, clearance) {
  if (obstacle.shape === "circle") {
    const projection = segmentInteriorProjection(a, b, obstacle.center);
    return distance(projection.point, obstacle.center) < obstacle.radius + clearance;
  }

  return segmentHitsPolygon(a, b, obstacleVertices(obstacle), clearance);
}

function segmentHitsPolygon(a, b, vertices, clearance) {
  const midpoint = midpointOfSegment(a, b);
  if (pointInPolygon(midpoint, vertices)) return true;

  for (let i = 0; i < vertices.length; i += 1) {
    const c = vertices[i];
    const d = vertices[(i + 1) % vertices.length];

    if (segmentsIntersect(a, b, c, d) && !intersectionOnlyAtSharedEndpoint(a, b, c, d)) {
      return true;
    }

    if (clearance > 0 && segmentToSegmentDistance(a, b, c, d) < clearance) {
      return true;
    }
  }

  return false;
}

function shortestPathIndexes(graph, startIndex, endIndex) {
  const distances = Array(graph.length).fill(Infinity);
  const previous = Array(graph.length).fill(-1);
  const visited = Array(graph.length).fill(false);
  distances[startIndex] = 0;

  for (let step = 0; step < graph.length; step += 1) {
    let current = -1;
    let best = Infinity;

    for (let i = 0; i < graph.length; i += 1) {
      if (!visited[i] && distances[i] < best) {
        best = distances[i];
        current = i;
      }
    }

    if (current === -1 || current === endIndex) break;
    visited[current] = true;

    for (const edge of graph[current]) {
      const nextDistance = distances[current] + edge.weight;
      if (nextDistance < distances[edge.index]) {
        distances[edge.index] = nextDistance;
        previous[edge.index] = current;
      }
    }
  }

  if (!Number.isFinite(distances[endIndex])) return [];

  const path = [];
  for (let current = endIndex; current !== -1; current = previous[current]) {
    path.push(current);
  }

  return path.reverse();
}

function segmentProjection(a, b, point) {
  const ab = vector(a, b);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y || 1;
  const t = clamp(((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSquared, 0, 1);

  return {
    t,
    point: {
      x: a.x + ab.x * t,
      y: a.y + ab.y * t,
    },
  };
}

function segmentInteriorProjection(a, b, point) {
  const ab = vector(a, b);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y || 1;
  const rawT = ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSquared;
  const t = clamp(rawT, 0.02, 0.98);

  return {
    t,
    point: {
      x: a.x + ab.x * t,
      y: a.y + ab.y * t,
    },
  };
}

function removeNearDuplicatePoints(points) {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 1);
}

function resamplePolyline(points, count) {
  if (!points || points.length < 2) return points || [];

  const total = pathLength(points);
  if (total === 0) return points.map((point) => ({ ...point }));

  const samples = [];
  for (let i = 0; i < count; i += 1) {
    const t = count <= 1 ? 0 : i / (count - 1);
    samples.push(pointAtDistance(points, total * t));
  }

  return samples;
}

function routeCollectionCenter(routes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const route of routes) {
    for (const point of route.path.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX)) {
    return { x: state.size.width * 0.5, y: state.size.height * 0.5 };
  }

  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
  };
}

function pointAtDistance(points, target) {
  if (points.length === 0) return null;
  if (target <= 0) return points[0];

  let remaining = target;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);

    if (remaining <= segmentLength) {
      return mix(a, b, segmentLength === 0 ? 0 : remaining / segmentLength);
    }

    remaining -= segmentLength;
  }

  return points[points.length - 1];
}

function convexHull(points) {
  const sorted = [...points]
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    .filter((point, index, list) => index === 0 || !pointsAlmostEqual(point, list[index - 1]));

  if (sorted.length <= 3) return sorted;

  const lower = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(vector(lower[lower.length - 2], lower[lower.length - 1]), vector(lower[lower.length - 2], point)) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(vector(upper[upper.length - 2], upper[upper.length - 1]), vector(upper[upper.length - 2], point)) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function simplifyPolygonByArea(points, maxPoints) {
  const simplified = points.map((point) => ({ ...point }));

  while (simplified.length > maxPoints && simplified.length > 3) {
    let removeIndex = 0;
    let smallestArea = Infinity;

    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length];
      const current = simplified[index];
      const next = simplified[(index + 1) % simplified.length];
      const area = triangleAreaValue(previous, current, next);

      if (area < smallestArea) {
        smallestArea = area;
        removeIndex = index;
      }
    }

    simplified.splice(removeIndex, 1);
  }

  return simplified;
}

function triangleAreaValue(a, b, c) {
  return Math.abs(cross(vector(a, b), vector(a, c))) * 0.5;
}

function polygonAreaValue(vertices) {
  if (!vertices || vertices.length < 3) return 0;

  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) * 0.5;
}

function polygonCenter(vertices) {
  if (!vertices || vertices.length === 0) return { x: 0, y: 0 };

  let signedArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const factor = current.x * next.y - next.x * current.y;

    signedArea += factor;
    x += (current.x + next.x) * factor;
    y += (current.y + next.y) * factor;
  }

  if (Math.abs(signedArea) < 0.0001) {
    return {
      x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length,
      y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length,
    };
  }

  return {
    x: x / (3 * signedArea),
    y: y / (3 * signedArea),
  };
}

function mix(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

function midpoint(a, b) {
  return mix(a, b, 0.5);
}

function vector(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

function perpendicular(point) {
  return { x: -point.y, y: point.x };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function unit(point) {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(point, amount) {
  return { x: point.x * amount, y: point.y * amount };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPoint(point, bounds, margin) {
  return {
    x: clamp(point.x, margin, bounds.width - margin),
    y: clamp(point.y, margin, bounds.height - margin),
  };
}

function pointWithinBounds(point, bounds, margin = 0) {
  return (
    point.x >= margin &&
    point.x <= bounds.width - margin &&
    point.y >= margin &&
    point.y <= bounds.height - margin
  );
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function hashSeed(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

startModeButton.addEventListener("click", () => setMode("start"));
endModeButton.addEventListener("click", () => setMode("end"));
obstacleModeButton.addEventListener("click", () => setMode("obstacle"));
shapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setObstacleShape(button.dataset.shape);
    setMode("obstacle");
  });
});
routeModeSelect.addEventListener("change", () => setRouteMode(routeModeSelect.value));
clothoidRadiusSlider.addEventListener("input", () =>
  setSelectedRouteClothoidRadius(clothoidRadiusSlider.value),
);
clothoidRadiusValue.addEventListener("input", () =>
  setSelectedRouteClothoidRadius(clothoidRadiusValue.value),
);
clothoidRadiusValue.addEventListener("change", () =>
  setSelectedRouteClothoidRadius(clothoidRadiusValue.value),
);
imageButton.addEventListener("click", openImagePicker);
imageInput.addEventListener("change", handleImageInputChange);
thresholdSlider.addEventListener("input", updateImageThreshold);
brightAreaToggle.addEventListener("change", updateImagePolarity);
detectImageButton.addEventListener("click", () => recognizeImageObstacles());
runButton.addEventListener("click", runAttempt);
patternButton.addEventListener("click", generatePattern);
commitPatternButton.addEventListener("click", commitPattern);
resetButton.addEventListener("click", reset);

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  if (state.mode === "obstacle" && state.draftObstacle) {
    updateDraftObstacle(point);
  } else {
    state.pointer = point;
    canvas.style.cursor = state.mode !== "obstacle" && findRouteNearPoint(point) ? "pointer" : "crosshair";
  }
});

canvas.addEventListener("pointerleave", () => {
  if (!state.draftObstacle) {
    state.pointer = null;
    canvas.style.cursor = "crosshair";
  }
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const point = canvasPoint(event);
  if (state.mode === "obstacle") {
    beginObstacle(point);
  } else if (selectRouteAtPoint(point)) {
    return;
  } else {
    setPoint(point);
  }
});

canvas.addEventListener("pointerup", () => {
  commitDraftObstacle();
});

canvas.addEventListener("pointercancel", () => {
  state.draftObstacle = null;
  updateStatus();
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateStatus();
requestAnimationFrame(draw);

window.geometryTools = {
  loadImportedImageFromDataUrl,
  recognizeImageObstacles,
};
