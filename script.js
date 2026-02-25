(function() {
  // --------------------------------------------------------------
  // LAP DETECTION + TERRITORY CAPTURE + GAMIFICATION
  // --------------------------------------------------------------
  const API_BASE = 'https://kadamclashbackend.onrender.com';
  const MOVEMENT_THRESHOLD = 5;
  const LAP_RADIUS = 50;                // meters from start to count a lap
  const LAP_COOLDOWN_MS = 15000;         // 15 seconds between laps
  const MIN_LOOP_DISTANCE = 50;           // reduced from 100 for better accuracy
  const LOOP_CLOSE_THRESHOLD = 30;        // max distance between start and end to consider loop closed

  let map;
  let currentPosition = null;
  let watchId = null;
  let isRunning = false;
  let selectedUserId = null;
  let selectedUsername = null;

  let runPath = [];
  let runStartTime = null;
  let runTimer = null;
  let lapCount = 0;
  let lastLapTime = 0;
  let maxDistFromStart = 0;
  let insideStartZone = false;

  let userMarker = null;
  let accuracyCircle = null;
  let pathLayer = L.layerGroup();
  let territoryLayer = L.layerGroup();

  // Sound toggle
  let soundEnabled = true;
  const sounds = {
    lap: new Howl({ src: ['https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3'], volume: 0.3 }),
    capture: new Howl({ src: ['https://www.soundjay.com/misc/sounds/fanfare-1.mp3'], volume: 0.3 }),
    defeat: new Howl({ src: ['https://www.soundjay.com/misc/sounds/sad-trombone-01.mp3'], volume: 0.3 }),
    start: new Howl({ src: ['https://www.soundjay.com/misc/sounds/beep-01a.mp3'], volume: 0.3 })
  };

  // UI elements
  const runBtn = document.getElementById('runBtn');
  const runCard = document.getElementById('runCard');
  const runnerDisplay = document.getElementById('runnerDisplay');
  const runHint = document.getElementById('runHint');
  const distanceEl = document.getElementById('distance');
  const handleDistance = document.getElementById('handleDistance');
  const handleDuration = document.getElementById('handleDuration');
  const handleSpeed = document.getElementById('handleSpeed');
  const durationEl = document.getElementById('duration');
  const lapsEl = document.getElementById('laps');
  const avgSpeedEl = document.getElementById('avgSpeed');
  const runLocationSpan = document.getElementById('runLocation');
  const runStatusSpan = document.getElementById('runStatus');
  const profileUsernameSpan = document.getElementById('profileUsername');
  const toast = document.getElementById('toast');
  const lapPopup = document.getElementById('lapPopup');
  const confettiCanvas = document.getElementById('confettiCanvas');
  const soundStatus = document.getElementById('soundStatus');

  // Leaderboard modal
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardList = document.getElementById('leaderboardList');
  const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

  // My Territories modal
  const myTerritoriesModal = document.getElementById('myTerritoriesModal');
  const myTerritoriesList = document.getElementById('myTerritoriesList');
  const closeMyTerritoriesBtn = document.getElementById('closeMyTerritoriesBtn');

  // Collapse state & swipe
  let isCardCollapsed = false;
  let touchStartY = 0;
  const cardHandle = document.getElementById('cardHandle');

  // Pull-to-refresh
  let pullStartY = 0;
  const pullIndicator = document.createElement('div');
  pullIndicator.className = 'pull-indicator';
  pullIndicator.innerText = '↓ Pull to refresh';
  document.body.appendChild(pullIndicator);

  // Confetti
  let confettiCtx = confettiCanvas.getContext('2d');
  let confettiParticles = [];

  // Helper: show gamified toast
  function showGamifiedToast(message, type = 'info', icon = '') {
    const icons = {
      success: '✅',
      error: '❌',
      info: 'ℹ️',
      lap: '🏁',
      capture: '⚔️',
      defeat: '😵'
    };
    const useIcon = icon || icons[type] || '';
    toast.innerHTML = `<span class="toast-icon">${useIcon}</span> ${message}`;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // Confetti
  function startConfetti() {
    confettiCanvas.style.display = 'block';
    for (let i = 0; i < 100; i++) {
      confettiParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: Math.random() * confettiCanvas.height,
        size: Math.random() * 5 + 2,
        speedY: Math.random() * 3 + 2,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
      });
    }
    if (!confettiInterval) {
      confettiInterval = setInterval(drawConfetti, 30);
    }
  }
  let confettiInterval;
  function drawConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles.forEach(p => {
      p.y += p.speedY;
      if (p.y > confettiCanvas.height) {
        p.y = 0;
        p.x = Math.random() * confettiCanvas.width;
      }
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(p.x, p.y, p.size, p.size);
    });
  }
  function stopConfetti() {
    clearInterval(confettiInterval);
    confettiInterval = null;
    confettiCanvas.style.display = 'none';
    confettiParticles = [];
  }

  // Lap celebration
  function celebrateLap(lapNum) {
    lapPopup.innerText = `LAP ${lapNum}!`;
    lapPopup.classList.add('show');
    setTimeout(() => lapPopup.classList.remove('show'), 1500);
    startConfetti();
    setTimeout(stopConfetti, 1500);
    if (soundEnabled) sounds.lap.play();
  }

  // Territory capture animation
  function animateCapture(layer) {
    if (!layer) return;
    const el = layer.getElement();
    if (el) {
      el.classList.add('territory-captured');
      setTimeout(() => el.classList.remove('territory-captured'), 1000);
    }
    if (soundEnabled) sounds.capture.play();
    startConfetti();
    setTimeout(stopConfetti, 2000);
  }

  // Territory defeat animation
  function animateDefeat(layer) {
    if (!layer) return;
    const el = layer.getElement();
    if (el) {
      el.classList.add('territory-defeated');
      setTimeout(() => {
        if (layer) territoryLayer.removeLayer(layer);
      }, 500);
    }
    if (soundEnabled) sounds.defeat.play();
  }

  // API health
  let lastOnline = false;
  async function checkAPI() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      const online = (data.database === 'connected');
      if (!online && lastOnline) {
        showGamifiedToast('⚠️ DB issue', 'error', '⚠️');
      } else if (!online) {
        showGamifiedToast('⚠️ DB issue', 'error', '⚠️');
      }
      lastOnline = online;
    } catch {
      if (lastOnline) {
        showGamifiedToast('❌ Server offline', 'error', '❌');
      } else {
        showGamifiedToast('❌ Server offline', 'error', '❌');
      }
      lastOnline = false;
    }
  }
  checkAPI();
  setInterval(checkAPI, 15000);

  // Update profile UI
  function updateProfileUI() {
    if (selectedUsername) {
      runnerDisplay.innerHTML = `${selectedUsername} <small>runner</small>`;
      profileUsernameSpan.innerText = `@${selectedUsername}`;
      runHint.innerText = 'ready to run';
    } else {
      runnerDisplay.innerHTML = 'Start <small>runner</small>';
      profileUsernameSpan.innerText = '(not logged in)';
    }
  }

  // Menu
  window.toggleMenu = function() {
    document.getElementById('sideMenu').classList.toggle('open');
    document.getElementById('menuOverlay').classList.toggle('visible');
  };
  window.closeMenu = function() {
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('menuOverlay').classList.remove('visible');
  };

  // Sound toggle
  document.getElementById('toggleSound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundStatus.innerText = soundEnabled ? 'ON' : 'OFF';
    showGamifiedToast(`Sound ${soundEnabled ? 'ON' : 'OFF'}`, 'info', '🔊');
    closeMenu();
  });

  // Leaderboard
  function showLeaderboard() {
    if (!territoryLayer || !territoryLayer.getLayers().length) {
      leaderboardList.innerHTML = '<div style="padding: 20px; color: #94a3b8;">No territories yet</div>';
      leaderboardModal.classList.add('show');
      return;
    }
    const ownerMap = new Map();
    territoryLayer.eachLayer(layer => {
      if (layer instanceof L.Polygon) {
        const owner = layer.options.ownerName || 'unknown';
        const area = layer.options.territoryArea || 0;
        if (!ownerMap.has(owner)) {
          ownerMap.set(owner, { count: 0, totalArea: 0 });
        }
        const stats = ownerMap.get(owner);
        stats.count += 1;
        stats.totalArea += area;
      }
    });

    const sorted = Array.from(ownerMap.entries())
      .map(([name, stats]) => ({ name, totalArea: stats.totalArea, count: stats.count }))
      .sort((a,b) => b.totalArea - a.totalArea)
      .slice(0, 10);

    if (sorted.length === 0) {
      leaderboardList.innerHTML = '<div style="padding: 20px; color: #94a3b8;">No territories</div>';
    } else {
      let html = '';
      sorted.forEach((u, idx) => {
        let rankClass = '';
        if (idx === 0) rankClass = 'rank-1';
        else if (idx === 1) rankClass = 'rank-2';
        else if (idx === 2) rankClass = 'rank-3';
        const isCurrent = u.name === selectedUsername;
        html += `
          <div class="leaderboard-item ${isCurrent ? 'current-user' : ''}">
            <span class="rank ${rankClass}">#${idx+1}</span>
            <span class="player-info">${u.name}</span>
            <span class="player-stats">${u.totalArea.toFixed(0)} m² · ${u.count} 🗺️</span>
          </div>
        `;
      });
      leaderboardList.innerHTML = html;
    }
    leaderboardModal.classList.add('show');
  }

  window.closeLeaderboard = function() {
    leaderboardModal.classList.remove('show');
  };
  closeLeaderboardBtn.addEventListener('click', closeLeaderboard);
  leaderboardModal.addEventListener('click', (e) => {
    if (e.target === leaderboardModal) closeLeaderboard();
  });

  // My Territories
  function showMyTerritories() {
    if (!selectedUserId) {
      showGamifiedToast('Select a profile first', 'error', '👤');
      return;
    }
    const myTerritories = [];
    territoryLayer.eachLayer(layer => {
      if (layer instanceof L.Polygon && layer.options.ownerId === selectedUserId) {
        myTerritories.push({
          name: layer.options.ownerName,
          area: layer.options.territoryArea || 0,
          avgSpeed: layer.options.avgSpeed || 0,
          laps: layer.options.laps || 1
        });
      }
    });
    if (myTerritories.length === 0) {
      myTerritoriesList.innerHTML = '<div style="padding: 20px; color: #94a3b8;">No territories yet</div>';
    } else {
      let html = '';
      myTerritories.forEach(t => {
        html += `
          <div class="territory-item">
            <div class="name">${t.name}</div>
            <div class="details">Area: ${t.area.toFixed(0)} m² · Avg speed: ${t.avgSpeed.toFixed(1)} km/h · Laps: ${t.laps}</div>
          </div>
        `;
      });
      myTerritoriesList.innerHTML = html;
    }
    myTerritoriesModal.classList.add('show');
  }
  closeMyTerritoriesBtn.addEventListener('click', () => myTerritoriesModal.classList.remove('show'));
  myTerritoriesModal.addEventListener('click', (e) => {
    if (e.target === myTerritoriesModal) myTerritoriesModal.classList.remove('show');
  });

  // Sidebar actions
  document.getElementById('menuRunToWin').addEventListener('click', ()=>{
    showGamifiedToast('🏆 Run to Win – start moving!', 'info', '🏆');
    closeMenu();
  });
  document.getElementById('menuMyTerritories').addEventListener('click', ()=>{
    showMyTerritories();
    closeMenu();
  });
  document.getElementById('menuLeaderboard').addEventListener('click', ()=>{
    showLeaderboard();
    closeMenu();
  });
  document.getElementById('menuMyProfile').addEventListener('click', ()=>{
    selectRunner();
    closeMenu();
  });

  // Select runner
  window.selectRunner = async function() {
    const name = prompt('Enter your runner name (new or existing):');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed })
      });
      const user = await res.json();
      selectedUserId = user.id || user._id;
      selectedUsername = user.username;

      updateProfileUI();
      runBtn.disabled = false;
      runHint.innerText = 'Ready to run';
      runStatusSpan.innerText = 'ready';
      showGamifiedToast(`Welcome, ${selectedUsername}!`, 'success', '👋');
      loadTerritories();
    } catch (e) {
      showGamifiedToast('User creation failed', 'error', '❌');
    }
  };

  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 55%)`;
  }

  // Load territories
  async function loadTerritories() {
    if (!selectedUserId) return;
    try {
      const res = await fetch(`${API_BASE}/api/territories`);
      const territories = await res.json();
      territoryLayer.clearLayers();
      territories.forEach(t => {
        if (!t.geometry || !t.geometry.coordinates) return;
        const coords = t.geometry.coordinates[0].map(c => [c[1], c[0]]);
        const ownerId = t.ownerId?._id || t.ownerId;
        const isOwn = (ownerId === selectedUserId);

        let area = t.area;
        if (!area && t.geometry) {
          try {
            area = turf.area(t.geometry);
          } catch (e) { area = 0; }
        }

        const avgSpeed = t.avgSpeed || 0;
        const laps = t.laps || 1;
        const ownerName = t.ownerId?.username || 'Unknown';

        const fillColor = isOwn ? '#22c55e' : stringToColor(ownerName);

        const polygon = L.polygon(coords, {
          color: fillColor,
          weight: 4,
          fillColor: fillColor,
          fillOpacity: 0.45,
          interactive: true,
          ownerName: ownerName,
          ownerId: ownerId,
          territoryArea: area || 0,
          avgSpeed: avgSpeed,
          laps: laps
        }).addTo(territoryLayer);

        polygon.bindPopup(`
          <b>${isOwn ? 'YOUR' : ownerName}'s TERRITORY</b><br>
          Owner: ${ownerName}<br>
          Area: ${area ? area.toFixed(0) : 'N/A'} m²<br>
          Avg speed: ${avgSpeed.toFixed(1)} km/h<br>
          Laps: ${laps}
        `);
      });
    } catch (e) {
      console.warn('Failed to load territories', e);
    }
  }

  // NEW: Simplified capture logic – only containment matters
 function evaluateRunAgainstTerritories(userPolygon, userAvgSpeed, userLaps) {
  let anyLoss = false;
  let lossMessage = '';
  const conqueredEnemies = [];

  const layers = territoryLayer.getLayers();
  for (let layer of layers) {
    if (!(layer instanceof L.Polygon)) continue;
    if (layer.options.ownerId === selectedUserId) continue;

    const enemyGeo = layer.toGeoJSON();
    const intersect = turf.intersect(userPolygon, enemyGeo);
    if (!intersect) continue; // no overlap

    const userContainsEnemy = turf.booleanContains(userPolygon, enemyGeo);
    const enemyContainsUser = turf.booleanContains(enemyGeo, userPolygon);

    if (userContainsEnemy) {
      conqueredEnemies.push(layer);
    } else if (enemyContainsUser) {
      anyLoss = true;
      lossMessage = `Your run is inside ${layer.options.ownerName}'s territory – no new territory.`;
      break;
    } else {
      anyLoss = true;
      lossMessage = `Your run overlaps ${layer.options.ownerName}'s territory but does not encircle it.`;
      break;
    }
  }

  if (anyLoss) {
    return { outcome: 'defended', message: lossMessage, conqueredEnemies: [] };
  } else if (conqueredEnemies.length > 0) {
    return {
      outcome: 'captured',
      message: conqueredEnemies.length > 1 ? '🔥 You conquered multiple territories!' : '⚔️ You defeated the enemy!',
      conqueredEnemies: conqueredEnemies
    };
  } else {
    return { outcome: 'created', message: '✨ New territory created!', conqueredEnemies: [] };
  }
}

  // Map init
  function initMap() {
    map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    pathLayer.addTo(map);
    territoryLayer.addTo(map);

    if (!navigator.geolocation) {
      runLocationSpan.innerText = '❌ GPS not supported';
      return;
    }
    navigator.geolocation.getCurrentPosition(initPosition, handleGeoError, {
      enableHighAccuracy: true,
      timeout: 10000
    });

    watchId = navigator.geolocation.watchPosition(updatePosition, handleGeoError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 5000
    });
  }

  function handleGeoError(err) {
    runLocationSpan.innerText = '❌ Location denied';
    showGamifiedToast('Please enable GPS', 'error', '📍');
  }

  function initPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    currentPosition = [latitude, longitude];
    map.setView(currentPosition, 18);

    userMarker = L.marker(currentPosition, {
      icon: L.divIcon({ className: 'user-marker', html: '<div></div>', iconSize: [22,22] })
    }).addTo(map);

    accuracyCircle = L.circle(currentPosition, {
      radius: accuracy,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);

    runLocationSpan.innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  }

  function updatePosition(pos) {
    const { latitude, longitude, accuracy, speed } = pos.coords;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;

    const newPos = [latitude, longitude];
    currentPosition = newPos;

    if (userMarker) userMarker.setLatLng(newPos);
    if (accuracyCircle) {
      accuracyCircle.setLatLng(newPos);
      accuracyCircle.setRadius(accuracy);
    }

    const speedKmh = speed ? (speed * 3.6).toFixed(1) : '?';
    runLocationSpan.innerText = `${latitude.toFixed(4)}, ${longitude.toFixed(4)} | ${speedKmh} km/h`;

    if (isRunning) {
      addPointToRun(newPos, speed);
    }
  }

  function addPointToRun(pos, speedMs) {
    const now = Date.now();
    if (!runPath.length) {
      runPath.push({ lat: pos[0], lng: pos[1], timestamp: now, speed: speedMs || 0 });
      insideStartZone = true;
      maxDistFromStart = 0;
      lastLapTime = now;
      drawRunPath();
      return;
    }

    const last = runPath[runPath.length-1];
    const lastPos = [last.lat, last.lng];
    const dist = calculateDistance(lastPos, pos);
    if (dist < MOVEMENT_THRESHOLD && (!speedMs || speedMs < 0.5)) return;

    runPath.push({ lat: pos[0], lng: pos[1], timestamp: now, speed: speedMs || 0 });

    if (runPath.length > 1) {
      const start = [runPath[0].lat, runPath[0].lng];
      const distToStart = calculateDistance(pos, start);

      if (distToStart > maxDistFromStart) {
        maxDistFromStart = distToStart;
      }

      const accuracy = accuracyCircle ? accuracyCircle.getRadius() : 20;
      const effectiveLapRadius = Math.max(LAP_RADIUS, accuracy * 1.5);
      const nowInside = (distToStart <= effectiveLapRadius);

      if (!insideStartZone && nowInside) {
        if (maxDistFromStart >= MIN_LOOP_DISTANCE && (now - lastLapTime) > LAP_COOLDOWN_MS) {
          lapCount++;
          lapsEl.innerText = lapCount;
          lastLapTime = now;
          celebrateLap(lapCount);
          maxDistFromStart = 0;
        }
      }

      insideStartZone = nowInside;
    }

    drawRunPath();
    updateRunStats();
  }

  function drawRunPath() {
    pathLayer.clearLayers();
    if (runPath.length < 2) return;
    const latlngs = runPath.map(p => [p.lat, p.lng]);
    L.polyline(latlngs, { color: '#3b82f6', weight: 5, opacity: 0.8, className: 'animated-path' }).addTo(pathLayer);
    L.circleMarker([runPath[0].lat, runPath[0].lng], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, className: 'pulsing-start' }).addTo(pathLayer);
    L.circleMarker([runPath[runPath.length-1].lat, runPath[runPath.length-1].lng], { radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1 }).addTo(pathLayer);
  }

  function updateRunStats() {
    if (runPath.length < 2 || !runStartTime) return;
    let totalM = 0;
    for (let i=1; i<runPath.length; i++) {
      totalM += calculateDistance([runPath[i-1].lat, runPath[i-1].lng], [runPath[i].lat, runPath[i].lng]);
    }
    const distKm = totalM / 1000;
    distanceEl.innerText = distKm.toFixed(2);
    handleDistance.innerText = distKm.toFixed(2);
    const secs = Math.floor((Date.now() - runStartTime) / 1000);
    const mins = Math.floor(secs/60);
    const remainingSecs = secs % 60;
    const durationStr = `${mins.toString().padStart(2,'0')}:${remainingSecs.toString().padStart(2,'0')}`;
    durationEl.innerText = durationStr;
    handleDuration.innerText = durationStr;
    const hours = secs / 3600;
    const avg = hours > 0 ? distKm / hours : 0;
    avgSpeedEl.innerText = avg.toFixed(1);
    handleSpeed.innerText = avg.toFixed(1);

    // Milestone confetti for 1km
    if (distKm >= 1 && distKm < 1.01) {
      startConfetti();
      setTimeout(stopConfetti, 2000);
    }
  }

  window.toggleRun = function() {
    if (!selectedUserId) {
      showGamifiedToast('Select a runner first', 'error', '👤');
      return;
    }
    if (!isRunning) startRun();
    else stopRun();
  };

  function startRun() {
    if (!currentPosition) {
      showGamifiedToast('Waiting for GPS', 'error', '📍');
      return;
    }
    isRunning = true;
    runStartTime = Date.now();
    runPath = [];
    lapCount = 0;
    lastLapTime = runStartTime;
    maxDistFromStart = 0;
    insideStartZone = true;
    pathLayer.clearLayers();
    runBtn.innerText = '⏹️ STOP RUN';
    runBtn.classList.add('running');
    runCard.classList.add('running');
    runHint.innerText = '🏃 moving – claim territory';
    runStatusSpan.innerText = 'running';
    runnerDisplay.innerHTML = `${selectedUsername} <small>running</small>`;
    addPointToRun(currentPosition, 0);
    runTimer = setInterval(() => { if (isRunning) updateRunStats(); }, 1000);
    showGamifiedToast('Run started!', 'info', '🏃');
    if (soundEnabled) sounds.start.play();
  }

async function stopRun() {
  isRunning = false;
  clearInterval(runTimer);
  runBtn.innerText = '▶ START RUN';
  runBtn.classList.remove('running');
  runCard.classList.remove('running');
  runHint.innerText = 'Processing run...';
  runBtn.disabled = true;

  if (runPath.length < 5) {
    showGamifiedToast('Run too short (need more movement)', 'error', '⚠️');
    resetRunUI();
    return;
  }

  try {
    // Check if start and end are close enough to form a loop
    const first = runPath[0];
    const last = runPath[runPath.length - 1];
    const startEndDist = calculateDistance([first.lat, first.lng], [last.lat, last.lng]);
    console.log(`Start-end distance: ${startEndDist.toFixed(1)}m (threshold: ${LOOP_CLOSE_THRESHOLD}m)`);

    if (startEndDist > LOOP_CLOSE_THRESHOLD) {
      showGamifiedToast('Run must end near start to form a territory', 'error', '🔄');
      resetRunUI();
      return;
    }

    // Create a closed polygon from the path
    const points = runPath.map(p => [p.lng, p.lat]); // GeoJSON order: [lng, lat]
    // Ensure polygon is closed (add first point at the end if needed)
    if (points[0][0] !== points[points.length-1][0] || points[0][1] !== points[points.length-1][1]) {
      points.push(points[0]);
    }

    console.log(`Polygon has ${points.length} points`);

    // Validate minimum number of distinct points
    if (points.length < 4) {
      showGamifiedToast('Not enough points to form a polygon', 'error', '⚠️');
      resetRunUI();
      return;
    }

    let runPolygon;
    try {
      runPolygon = turf.polygon([points]);
    } catch (e) {
      console.error('Failed to create polygon:', e);
      showGamifiedToast('Invalid loop shape', 'error', '⚠️');
      resetRunUI();
      return;
    }

    const runArea = turf.area(runPolygon);
    console.log(`Run area: ${runArea.toFixed(1)} m²`);

    if (runArea < 1) {
      showGamifiedToast('Loop area too small to claim', 'error', '⚠️');
      resetRunUI();
      return;
    }

    const duration = Math.floor((Date.now() - runStartTime) / 1000);
    const totalDistM = runPath.slice(1).reduce((acc, _, i) => {
      return acc + calculateDistance([runPath[i].lat, runPath[i].lng], [runPath[i+1].lat, runPath[i+1].lng]);
    }, 0);
    const avgSpeed = (totalDistM/1000) / (duration/3600) || 0;
    const laps = lapCount || 1;

    console.log(`Run stats: duration=${duration}s, distance=${(totalDistM/1000).toFixed(2)}km, avgSpeed=${avgSpeed.toFixed(1)}km/h, laps=${laps}`);

    // Evaluate using simplified containment logic
    const evalResult = evaluateRunAgainstTerritories(runPolygon.geometry, avgSpeed, laps);
    console.log('Frontend evaluation result:', evalResult);

    // If defended, show message immediately and return
    if (evalResult.outcome === 'defended') {
      showGamifiedToast(evalResult.message, 'error');
      await loadTerritories(); // reload just in case (though no change)
      resetRunUI();
      return;
    }

    // For created or captured, send to backend
    if (evalResult.outcome === 'created' || evalResult.outcome === 'captured') {
      const payload = {
        userId: selectedUserId,
        polygon: runPolygon.geometry,
        duration: duration,
        laps: laps,
        avgSpeed: avgSpeed,
        outcome: evalResult.outcome  // optional hint
      };

      console.log('🚀 Submitting run to backend:', JSON.stringify(payload, null, 2));

      let res;
      try {
        res = await fetch(`${API_BASE}/api/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (fetchError) {
        console.error('Network error while submitting run:', fetchError);
        showGamifiedToast('Network error – please check your connection', 'error', '🌐');
        resetRunUI();
        return;
      }

      console.log('Response status:', res.status);

      if (!res.ok) {
        let errorText = `HTTP ${res.status}`;
        try {
          const errorData = await res.json();
          errorText = errorData.error || errorText;
        } catch (e) {
          // response not JSON
        }
        console.error('Server error:', errorText);
        showGamifiedToast(`Server error: ${errorText}`, 'error', '❌');
        resetRunUI();
        return;
      }

      let result;
      try {
        result = await res.json();
        console.log('📦 Server response:', result);
      } catch (jsonError) {
        console.error('Failed to parse server response:', jsonError);
        showGamifiedToast('Invalid server response', 'error', '❌');
        resetRunUI();
        return;
      }

      // Now show success message based on server response
      if (result.created) {
        showGamifiedToast('✨ New territory created!', 'success');
      } else if (result.captured) {
        const msg = result.previousOwner
          ? `⚔️ You defeated ${result.previousOwner}!`
          : '⚔️ Territory captured!';
        showGamifiedToast(msg, 'success');
      } else {
        showGamifiedToast('🏃 Run recorded (no change)', 'info');
      }

      // Reload territories to reflect changes
      await loadTerritories();

      // Animate newly acquired territory (the user's)
      territoryLayer.eachLayer(layer => {
        if (layer.options.ownerId === selectedUserId) {
          animateCapture(layer);
        }
      });

    } else {
      console.warn('Unexpected outcome:', evalResult);
      showGamifiedToast('Unexpected outcome', 'error');
    }

  } catch (err) {
    console.error('Unhandled error in stopRun:', err);
    showGamifiedToast('Unexpected error: ' + err.message, 'error', '❌');
  } finally {
    resetRunUI();
  }
}
  function resetRunUI() {
    runPath = [];
    pathLayer.clearLayers();
    distanceEl.innerText = '0.00';
    handleDistance.innerText = '0.00';
    durationEl.innerText = '00:00';
    handleDuration.innerText = '00:00';
    lapsEl.innerText = '0';
    avgSpeedEl.innerText = '0.0';
    handleSpeed.innerText = '0.0';
    runBtn.disabled = false;
    runHint.innerText = 'Ready';
    runStatusSpan.innerText = 'ready';
    if (selectedUsername) {
      runnerDisplay.innerHTML = `${selectedUsername} <small>runner</small>`;
    } else {
      runnerDisplay.innerHTML = 'Start <small>runner</small>';
    }
  }

  function calculateDistance(p1, p2) {
    const R = 6371e3;
    const φ1 = p1[0] * Math.PI / 180;
    const φ2 = p2[0] * Math.PI / 180;
    const Δφ = (p2[0] - p1[0]) * Math.PI / 180;
    const Δλ = (p2[1] - p1[1]) * Math.PI / 180;
    const a = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Swipe to collapse/expand
  cardHandle.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  });
  cardHandle.addEventListener('touchmove', (e) => {
    if (!touchStartY) return;
    const deltaY = e.touches[0].clientY - touchStartY;
    if (Math.abs(deltaY) > 30) {
      if (deltaY > 0 && !isCardCollapsed) {
        toggleCardCollapse();
      } else if (deltaY < 0 && isCardCollapsed) {
        toggleCardCollapse();
      }
      touchStartY = 0;
    }
  });

  window.toggleCardCollapse = function() {
    isCardCollapsed = !isCardCollapsed;
    if (isCardCollapsed) {
      runCard.classList.add('collapsed');
    } else {
      runCard.classList.remove('collapsed');
    }
  };

  // Pull-to-refresh
  document.addEventListener('touchstart', (e) => {
    if (window.scrollY === 0) {
      pullStartY = e.touches[0].clientY;
    }
  });
  document.addEventListener('touchmove', (e) => {
    if (pullStartY && e.touches[0].clientY - pullStartY > 80) {
      pullIndicator.classList.add('show');
    }
  });
  document.addEventListener('touchend', (e) => {
    if (pullIndicator.classList.contains('show')) {
      loadTerritories();
      showGamifiedToast('Territories refreshed', 'info', '🔄');
    }
    pullIndicator.classList.remove('show');
    pullStartY = 0;
  });

  // Fullscreen
  window.toggleFullscreen = function() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  window.addEventListener('beforeunload', () => {
    if (watchId) navigator.geolocation.clearWatch(watchId);
  });

  // Initialize
  initMap();
  updateProfileUI();
})();
