import './style.css';
import { firebaseReady, saveSessionSummary } from './firebase.js';

const $ = (selector) => document.querySelector(selector);
const video = $('#camera');
const canvas = $('#overlay');
const ctx = canvas.getContext('2d');
const stage = $('#cameraStage');
const startButton = $('#startButton');
const gestureLabels = ['Open', 'Close', 'Pointer', 'OK'];
const movementLabels = ['Stop', 'Clockwise', 'Counter Clockwise', 'Move'];
const handConnections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const recentSigns = [];
const movementHistory = [];
const fingertipHistory = [];
const gestureCounts = Object.fromEntries(gestureLabels.map((label) => [label, 0]));
let landmarker;
let poseModel;
let movementModel;
let tf;
let HandLandmarker;
let FilesetResolver;
let tfliteRuntimePromise;
let stream;
let animationId;
let sessionStartedAt = 0;
let lastFrameAt = 0;
let lastVideoTime = -1;
let isRunning = false;
let lastCountedLabel = '';

$('#saveHistory').checked = localStorage.getItem('gesture-lab-save-history') === 'true';
$('#saveHistory').addEventListener('change', (event) => {
  localStorage.setItem('gesture-lab-save-history', String(event.target.checked));
  $('#historyText').textContent = event.target.checked
    ? (firebaseReady ? 'Session summaries are saved to your private Firebase account when you stop tracking.' : 'Firebase needs to be configured before session summaries can be saved.')
    : 'Session summaries are not saved. Camera frames and landmarks stay on this device.';
});
$('#historyText').textContent = $('#saveHistory').checked && firebaseReady
  ? 'Session summaries are saved to your private Firebase account when you stop tracking.'
  : 'Your camera feed and landmark data stay on this device. Session saving is optional.';

function setStatus(active, label) {
  $('#statusPill').classList.toggle('active', active);
  $('#statusText').textContent = label;
}

function setButton(label, icon, disabled = false) {
  $('#buttonText').textContent = label;
  $('#buttonIcon').textContent = icon;
  startButton.disabled = disabled;
}

function normalizeLandmarks(landmarks) {
  const points = landmarks.map(({ x, y }) => [Math.floor(x * video.videoWidth), Math.floor(y * video.videoHeight)]);
  const [baseX, baseY] = points[0];
  const relative = points.flatMap(([x, y]) => [x - baseX, y - baseY]);
  const scale = Math.max(...relative.map(Math.abs));
  return scale === 0 ? relative : relative.map((value) => value / scale);
}

function prepareMovementHistory() {
  const baseX = fingertipHistory[0]?.[0] ?? 0;
  const baseY = fingertipHistory[0]?.[1] ?? 0;
  return fingertipHistory.flatMap(([x, y]) => [(x - baseX) / video.videoWidth, (y - baseY) / video.videoHeight]);
}

function classify(model, values) {
  const input = tf.tensor2d([values], [1, values.length], 'float32');
  let output;
  try {
    output = model.predict(input);
    const scores = Array.from(output.dataSync());
    let bestIndex = 0;
    for (let index = 1; index < scores.length; index += 1) if (scores[index] > scores[bestIndex]) bestIndex = index;
    return { index: bestIndex, confidence: scores[bestIndex] };
  } finally {
    input.dispose();
    output?.dispose();
  }
}

function drawHand(landmarks) {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = Math.max(2, width / 360);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#c6ff61';
  ctx.shadowColor = '#c6ff6190';
  ctx.shadowBlur = 7;
  for (const [from, to] of handConnections) {
    ctx.beginPath();
    ctx.moveTo(landmarks[from].x * width, landmarks[from].y * height);
    ctx.lineTo(landmarks[to].x * width, landmarks[to].y * height);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const point of landmarks) {
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(2, width / 180), 0, Math.PI * 2);
    ctx.fillStyle = '#f0f8dc';
    ctx.fill();
  }
}

function showHandResult(result) {
  const scores = result.categories;
  recentSigns.push({ index: result.index, confidence: result.confidence });
  if (recentSigns.length > 5) recentSigns.shift();
  const winner = recentSigns.reduce((best, item, _, list) => {
    const same = list.filter((other) => other.index === item.index);
    return same.length > best.count ? { index: item.index, confidence: same.reduce((sum, x) => sum + x.confidence, 0) / same.length, count: same.length } : best;
  }, { index: result.index, confidence: result.confidence, count: 0 });
  const label = gestureLabels[winner.index] ?? 'Unknown';
  $('#gestureValue').textContent = label;
  $('#confidenceValue').textContent = `${Math.round(winner.confidence * 100)}%`;
  $('#confidenceBar').style.width = `${Math.max(0, Math.min(100, winner.confidence * 100))}%`;
  $('#gestureIcon').innerHTML = `<span>${({ Open: '◯', Close: '●', Pointer: '☝', OK: '◎' })[label] ?? '✳'}</span>`;
  $('#handednessValue').textContent = scores?.[0]?.categoryName ?? 'Detected';
  if (label !== 'Unknown' && winner.confidence > 0.35 && label !== lastCountedLabel) {
    gestureCounts[label] += 1;
    lastCountedLabel = label;
  }
}

function showMovementResult(prediction) {
  movementHistory.push(prediction.index);
  if (movementHistory.length > 5) movementHistory.shift();
  const counts = new Map();
  movementHistory.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
  const index = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? prediction.index;
  const label = movementLabels[index] ?? 'Stop';
  $('#movementValue').textContent = label;
  $('#movementSymbol').textContent = ({ Stop: '·', Clockwise: '↻', 'Counter Clockwise': '↺', Move: '↗' })[label] ?? '↗';
}

function processFrame(now) {
  if (!isRunning) return;
  animationId = requestAnimationFrame(processFrame);
  if (!video.videoWidth || video.currentTime === lastVideoTime || now - lastFrameAt < 40) return;
  lastVideoTime = video.currentTime;
  lastFrameAt = now;
  const result = landmarker.detectForVideo(video, now);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fingertipHistory.push([0, 0]);
    if (fingertipHistory.length > 16) fingertipHistory.shift();
    $('#cameraState').textContent = 'Looking for a hand…';
    $('#gestureValue').textContent = 'No hand';
    $('#confidenceValue').textContent = '—';
    $('#confidenceBar').style.width = '0%';
    $('#handednessValue').textContent = '—';
    $('#movementValue').textContent = '—';
    lastCountedLabel = '';
    return;
  }
  drawHand(landmarks);
  $('#cameraState').textContent = 'Hand detected';
  $('#trackingBadge').hidden = false;
  const pose = classify(poseModel, normalizeLandmarks(landmarks));
  showHandResult({ ...pose, categories: result.handednesses?.[0] });
  const tip = pose.index === 2 ? [Math.floor(landmarks[8].x * video.videoWidth), Math.floor(landmarks[8].y * video.videoHeight)] : [0, 0];
  fingertipHistory.push(tip);
  if (fingertipHistory.length > 16) fingertipHistory.shift();
  if (fingertipHistory.length === 16) {
    const motion = classify(movementModel, prepareMovementHistory());
    showMovementResult(motion.confidence >= 0.5 ? motion : { index: 0, confidence: motion.confidence });
  }
}

async function loadModels() {
  setStatus(false, 'LOADING MODELS');
  $('#cameraState').textContent = 'Loading hand and gesture models…';
  [{ FilesetResolver, HandLandmarker }, tf] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    Promise.all([import('@tensorflow/tfjs-backend-cpu'), import('@tensorflow/tfjs-core')]).then(([, core]) => core),
  ]);
  await tf.setBackend('cpu');
  await tf.ready();
  globalThis.tf = tf;
  tfliteRuntimePromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/tf-tflite.js';
    script.onload = () => resolve(globalThis.tflite);
    script.onerror = () => reject(new Error('Could not load the TensorFlow Lite browser runtime.'));
    document.head.append(script);
  });
  const tflite = await tfliteRuntimePromise;
  tflite.setWasmPath('/wasm/');
  const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
  [landmarker, poseModel, movementModel] = await Promise.all([
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
      runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.5,
    }),
    tflite.loadTFLiteModel('/model/keypoint_classifier/keypoint_classifier.tflite'),
    tflite.loadTFLiteModel('/model/point_history_classifier/point_history_classifier.tflite'),
  ]);
}

async function startTracking() {
  $('#cameraError').hidden = true;
  setButton('Loading models…', '⋯', true);
  try {
    if (!landmarker || !poseModel || !movementModel) await loadModels();
    setStatus(false, 'CAMERA ACCESS');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires a modern browser and a secure HTTPS connection.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } } });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    stage.classList.add('is-live');
    isRunning = true;
    sessionStartedAt = Date.now();
    for (const label of gestureLabels) gestureCounts[label] = 0;
    lastVideoTime = -1;
    setStatus(true, 'LIVE');
    $('#cameraState').textContent = 'Camera is live';
    $('#trackingBadge').hidden = true;
    setButton('Stop camera', '■');
    animationId = requestAnimationFrame(processFrame);
  } catch (error) {
    await stopCamera(false);
    setStatus(false, 'STANDBY');
    $('#cameraState').textContent = 'Camera is off';
    $('#cameraError').textContent = error.name === 'NotAllowedError'
      ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
      : error.name === 'NotFoundError'
        ? 'No camera was found. Connect a camera and try again.'
        : `Could not start the tracker: ${error.message}`;
    $('#cameraError').hidden = false;
    setButton('Try again', '↻');
  }
}

async function stopCamera(saveSummary = true) {
  isRunning = false;
  if (animationId) cancelAnimationFrame(animationId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  stage.classList.remove('is-live');
  $('#trackingBadge').hidden = true;
  setStatus(false, 'STANDBY');
  $('#cameraState').textContent = 'Camera is off';
  setButton('Start camera', '▶');
  $('#gestureValue').textContent = 'Waiting';
  $('#movementValue').textContent = '—';
  $('#handednessValue').textContent = '—';
  $('#confidenceValue').textContent = '—';
  $('#confidenceBar').style.width = '0%';
  if (saveSummary && sessionStartedAt && $('#saveHistory').checked) {
    if (!firebaseReady) {
      $('#historyText').textContent = 'Firebase is not configured yet; your session was not uploaded.';
    } else {
      const summary = {
        durationSeconds: Math.floor((Date.now() - sessionStartedAt) / 1000),
        gestureCounts: { ...gestureCounts },
      };
      try {
        await saveSessionSummary(summary);
        $('#historyText').textContent = 'Your session summary was saved to your private Firebase account.';
      } catch (error) {
        $('#historyText').textContent = `Session could not be saved: ${error.message}`;
      }
    }
  }
  sessionStartedAt = 0;
  recentSigns.length = 0;
  movementHistory.length = 0;
  fingertipHistory.length = 0;
  lastCountedLabel = '';
}

startButton.addEventListener('click', () => isRunning ? stopCamera() : startTracking());
window.addEventListener('pagehide', () => {
  isRunning = false;
  stream?.getTracks().forEach((track) => track.stop());
});
