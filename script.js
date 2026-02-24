(function() {
  // --------------------------------------------------------------
  // FINAL FIXES: buffer 100m, lap radius 50m with time cooldown
  // --------------------------------------------------------------
  const API_BASE = 'https://kadamclashbackend.onrender.com';
  const MOVEMENT_THRESHOLD = 5;
  const LAP_RADIUS = 50;          // meters from start to count a lap
  const LAP_COOLDOWN_MS = 15000;   // 15 seconds between laps
  const TERRITORY_BUFFER = 100;    // 100 meters to guarantee overlap

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
  let lastLapTime = 0;             // timestamp of last lap

  let userMarker = null;
  let accuracyCircle = null;
  let pathLayer = L.layerGroup();
  let territoryLayer = L.layerGroup();

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

  // Leaderboard modal
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardList = document.getElementById('leaderboardList');
  const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');

  // Collapse state
  let isCardCollapsed = false;
  window.toggleCardCollapse = function() {
    isCardCollapsed = !isCardCollapsed;
    if (isCardCollapsed) {
      runCard.classList.add('collapsed');
    } else {
      runCard.classList.remove('collapsed');
    }
  };

  // Helper: show toast (with types)
  function showToast(message, type = 'info') {
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    toast.style.display = 'flex';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }

  // API health – only show errors
  let lastOnline = false;
  async function checkAPI() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      const online = (data.database === 'connected');
      if (!online && lastOnline) {
        showToast('⚠️ DB issue', 'error');
      } else if (!online) {
        showToast('⚠️ DB issue', 'error');
      }
      lastOnline = online;
    } catch {
      if (lastOnline) {
        showToast('❌ Server offline', 'error');
      } else {
        showToast('❌ Server offline', 'error');
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

  // Menu functions
  window.toggleMenu = function() {
    document.getElementById('sideMenu').classList.toggle('open');
    document.getElementById('menuOverlay').classList.toggle('visible');
  };
  window.closeMenu = function() {
    document.getElementById('sideMenu').classList.remove('open');
    document.getElementById('menuOverlay').classList.remove('visible');
  };

  // Leaderboard function – gamified modal
  function showLeaderboard() {
    if (!territoryLayer || !territoryLayer.getLayers().length) {
      leaderboardList.innerHTML = '<div style="padding: 20px; color: #94a3b8;">No territories yet</div>';
      leaderboardModal.classList.add('show');
      return;
    }
    const ownerMap = new Map(); // ownerName -> { count, totalArea }
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
        html += `
          <div class="leaderboard-item">
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

  // Close leaderboard
  window.closeLeaderboard = function() {
    leaderboardModal.classList.remove('show');
  };
  closeLeaderboardBtn.addEventListener('click', closeLeaderboard);
  leaderboardModal.addEventListener('click', (e) => {
    if (e.target === leaderboardModal) closeLeaderboard();
  });

  // Sidebar actions
  document.getElementById('menuRunToWin').addEventListener('click', ()=>{
    showToast('🏆 Run to Win – start moving!', 'info');
    closeMenu();
  });
  document.getElementById('menuMyTerritories').addEventListener('click', ()=>{
    if(selectedUserId) {
      loadTerritories();
      showToast('🗺 Territories refreshed', 'info');
    } else {
      showToast('👤 Select a profile first', 'error');
    }
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
      showToast(`Welcome, ${selectedUsername}!`, 'success');
      loadTerritories();
    } catch (e) {
      showToast('User creation failed', 'error');
    }
  };

  // Generate color from username (hash)
  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 55%)`;
  }

  // Load territories – compute area if missing, assign colors, show avg speed
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
        
        // Use avgSpeed if available, otherwise bestTime (lap time)
        const avgSpeed = t.avgSpeed ? t.avgSpeed.toFixed(1) : 'N/A';
        const ownerName = t.ownerId?.username || 'Unknown';
        
        const fillColor = isOwn ? '#22c55e' : stringToColor(ownerName);
        
        const polygon = L.polygon(coords, {
          color: fillColor,
          weight: 4,
          fillColor: fillColor,
          fillOpacity: 0.45,
          interactive: true,
          ownerName: ownerName,
          territoryArea: area || 0
        }).addTo(territoryLayer);
        
        polygon.bindPopup(`
          <b>${isOwn ? 'YOUR' : ownerName}'s TERRITORY</b><br>
          Owner: ${ownerName}<br>
          Area: ${area ? area.toFixed(0) : 'N/A'} m²<br>
          Avg speed: ${avgSpeed} km/h
        `);
      });
    } catch (e) {
      console.warn('Failed to load territories', e);
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
    showToast('Please enable GPS', 'error');
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

  // Run logic – simplified lap counting
  function addPointToRun(pos, speedMs) {
    const now = Date.now();
    if (!runPath.length) {
      runPath.push({ lat: pos[0], lng: pos[1], timestamp: now, speed: speedMs || 0 });
      lastLapTime = now; // first point counts as lap start
      drawRunPath();
      return;
    }

    const last = runPath[runPath.length-1];
    const lastPos = [last.lat, last.lng];
    const dist = calculateDistance(lastPos, pos);
    if (dist < MOVEMENT_THRESHOLD && (!speedMs || speedMs < 0.5)) return; // ignore drift

    runPath.push({ lat: pos[0], lng: pos[1], timestamp: now, speed: speedMs || 0 });

    // Lap detection: if near start and enough time passed
    if (runPath.length > 5) {
      const start = [runPath[0].lat, runPath[0].lng];
      const distToStart = calculateDistance(pos, start);
      if (distToStart <= LAP_RADIUS && (now - lastLapTime) > LAP_COOLDOWN_MS) {
        lapCount++;
        lapsEl.innerText = lapCount;
        lastLapTime = now;
        showToast(`🏁 Lap ${lapCount}!`, 'info');
      }
    }

    drawRunPath();
    updateRunStats();
  }

  function drawRunPath() {
    pathLayer.clearLayers();
    if (runPath.length < 2) return;
    const latlngs = runPath.map(p => [p.lat, p.lng]);
    L.polyline(latlngs, { color: '#3b82f6', weight: 5, opacity: 0.8 }).addTo(pathLayer);
    L.circleMarker([runPath[0].lat, runPath[0].lng], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).addTo(pathLayer);
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
  }

  window.toggleRun = function() {
    if (!selectedUserId) {
      showToast('Select a runner first', 'error');
      return;
    }
    if (!isRunning) startRun();
    else stopRun();
  };

  function startRun() {
    if (!currentPosition) {
      showToast('Waiting for GPS', 'error');
      return;
    }
    isRunning = true;
    runStartTime = Date.now();
    runPath = [];
    lapCount = 0;
    lastLapTime = runStartTime;
    pathLayer.clearLayers();
    runBtn.innerText = '⏹️ STOP RUN';
    runBtn.classList.add('running');
    runCard.classList.add('running');
    runHint.innerText = '🏃 moving – claim territory';
    runStatusSpan.innerText = 'running';
    runnerDisplay.innerHTML = `${selectedUsername} <small>running</small>`;
    addPointToRun(currentPosition, 0);
    runTimer = setInterval(() => { if (isRunning) updateRunStats(); }, 1000);
    showToast('Run started!', 'info');
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
      showToast('Run too short (need more movement)', 'error');
      resetRunUI();
      return;
    }

    try {
      const lineCoords = runPath.map(p => [p.lng, p.lat]);
      const line = turf.lineString(lineCoords);
      // Buffer 100m for reliable overlap
      const buffered = turf.buffer(line, TERRITORY_BUFFER, { units: 'meters' });
      if (!buffered || !buffered.geometry) throw new Error('Buffer failed');
      
      const area = turf.area(buffered);
      if (area < 1) throw new Error('Buffered area too small');

      const duration = Math.floor((Date.now() - runStartTime) / 1000);
      const totalDistM = runPath.slice(1).reduce((acc, _, i) => {
        return acc + calculateDistance([runPath[i].lat, runPath[i].lng], [runPath[i+1].lat, runPath[i+1].lng]);
      }, 0);
      const avgSpeed = (totalDistM/1000) / (duration/3600);
      const payload = {
        userId: selectedUserId,
        polygon: buffered.geometry,
        duration: duration,
        laps: lapCount || 1,  // ensure at least 1
        avgSpeed: avgSpeed || 0
      };

      console.log('🚀 Submitting run:', JSON.stringify(payload, null, 2));

      const res = await fetch(`${API_BASE}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      console.log('📦 Server response:', result);

      if (result.created) {
        showToast('✨ New territory created!', 'success');
      } else if (result.captured) {
        if (result.previousOwner) {
          showToast(`⚔️ You defeated ${result.previousOwner}!`, 'success');
        } else {
          showToast('⚔️ Territory captured!', 'success');
        }
      } else if (result.defended) {
        if (result.defender) {
          showToast(`😵 You were defeated by ${result.defender}`, 'error');
        } else {
          showToast('😵 Your attack failed', 'error');
        }
      } else {
        showToast('🏃 Run recorded (no battle)', 'info');
      }

      await loadTerritories();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      console.error(err);
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

  window.addEventListener('beforeunload', () => {
    if (watchId) navigator.geolocation.clearWatch(watchId);
  });

  // Initialize
  initMap();
  updateProfileUI();
})();
