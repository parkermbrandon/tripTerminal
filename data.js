// data.js - localStorage CRUD layer + Firestore sync
const DB = (() => {
  const STORAGE_KEY = 'tripTerminal';

  const CATEGORIES = {
    eats:   { label: 'EATS',   color: '#ff6b6b' },
    sleeps: { label: 'SLEEPS', color: '#4ecdc4' },
    spots:  { label: 'SPOTS',  color: '#ffe66d' },
    events: { label: 'EVENTS', color: '#a855f7' },
  };

  // --- Firebase state ---
  let _db = null;          // Firestore instance
  let _unsub = null;       // active onSnapshot unsubscribe
  let _refreshCb = null;   // callback to refresh UI
  let _cloudReady = false; // true after initSync completes

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBt2gq7TgO00hv_n5eNz55XJ-CtZZiDFLU',
    authDomain: 'trip-terminal.firebaseapp.com',
    projectId: 'trip-terminal',
    storageBucket: 'trip-terminal.firebasestorage.app',
    messagingSenderId: '519611485043',
    appId: '1:519611485043:web:2606d4924bf21254669306',
  };

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
    } catch {
      return defaultState();
    }
  }

  function saveLocal(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function save(state) {
    saveLocal(state);
    if (_db && state.activeTrip && state.trips[state.activeTrip]) {
      _pushTrip(state.activeTrip, state.trips[state.activeTrip]);
    }
  }

  function defaultState() {
    return { trips: {}, activeTrip: null, settings: { theme: 'default' } };
  }

  // --- Firestore sync helpers ---
  function _pushTrip(id, tripData) {
    if (!_db) return;
    _db.collection('trips').doc(id).set({
      name: tripData.name,
      items: tripData.items,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.warn('Firestore push failed:', err));
  }

  function _listenToTrip(id) {
    if (_unsub) { _unsub(); _unsub = null; }
    if (!_db || !id) return;

    _unsub = _db.collection('trips').doc(id).onSnapshot(snap => {
      if (!snap.exists) {
        // Remote deletion — remove locally
        const state = load();
        if (state.trips[id]) {
          delete state.trips[id];
          if (state.activeTrip === id) state.activeTrip = null;
          saveLocal(state);
          if (_refreshCb) _refreshCb();
        }
        return;
      }

      const remote = snap.data();
      const state = load();
      const local = state.trips[id];

      // Deep compare to avoid echo loops
      if (local && JSON.stringify({ name: local.name, items: local.items }) ===
          JSON.stringify({ name: remote.name, items: remote.items })) {
        return;
      }

      state.trips[id] = { name: remote.name, items: remote.items || [] };
      saveLocal(state);
      if (_refreshCb) _refreshCb();
    }, err => console.warn('onSnapshot error:', err));
  }

  async function initSync(refreshCallback) {
    _refreshCb = refreshCallback;

    if (typeof firebase === 'undefined' || !firebase.firestore) {
      console.warn('Firebase SDK not loaded — running offline only');
      return;
    }

    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      _db = firebase.firestore();
      _db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      _cloudReady = true;
    } catch (err) {
      console.warn('Firebase init failed:', err);
      return;
    }

    // Migrate local trips: for each, pull remote if exists (remote wins), push if not
    const state = load();
    const ids = Object.keys(state.trips);
    for (const id of ids) {
      try {
        const snap = await _db.collection('trips').doc(id).get();
        if (snap.exists) {
          const remote = snap.data();
          state.trips[id] = { name: remote.name, items: remote.items || [] };
        } else {
          _pushTrip(id, state.trips[id]);
        }
      } catch {
        // offline — skip, local data is fine
      }
    }
    saveLocal(state);

    // Start listening to active trip
    if (state.activeTrip) {
      _listenToTrip(state.activeTrip);
    }
  }

  async function joinTrip(id) {
    if (!_db) return null;
    try {
      const snap = await _db.collection('trips').doc(id).get();
      if (!snap.exists) return null;
      const remote = snap.data();
      const state = load();
      state.trips[id] = { name: remote.name, items: remote.items || [] };
      state.activeTrip = id;
      saveLocal(state);
      _listenToTrip(id);
      return state.trips[id];
    } catch (err) {
      console.warn('joinTrip failed:', err);
      return null;
    }
  }

  function getShareUrl() {
    const state = load();
    if (!state.activeTrip) return null;
    const base = window.location.origin + window.location.pathname;
    return base + '?trip=' + state.activeTrip;
  }

  function isCloudEnabled() {
    return _cloudReady;
  }

  // --- Trips ---
  function createTrip(name) {
    const state = load();
    const id = uuid();
    state.trips[id] = { name, items: [] };
    state.activeTrip = id;
    save(state);
    _listenToTrip(id);
    return id;
  }

  function listTrips() {
    const state = load();
    return Object.entries(state.trips).map(([id, t]) => ({
      id, name: t.name, itemCount: t.items.length, active: id === state.activeTrip
    }));
  }

  function loadTrip(name) {
    const state = load();
    const entry = Object.entries(state.trips).find(
      ([, t]) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (!entry) return null;
    state.activeTrip = entry[0];
    saveLocal(state);
    _listenToTrip(entry[0]);
    return entry[1];
  }

  function deleteTrip(name) {
    const state = load();
    const entry = Object.entries(state.trips).find(
      ([, t]) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (!entry) return false;
    const id = entry[0];
    delete state.trips[id];
    if (state.activeTrip === id) state.activeTrip = null;
    saveLocal(state);
    if (_db) {
      _db.collection('trips').doc(id).delete().catch(err =>
        console.warn('Firestore delete failed:', err));
    }
    if (_unsub && state.activeTrip !== id) { _unsub(); _unsub = null; }
    return true;
  }

  function getActiveTrip() {
    const state = load();
    if (!state.activeTrip || !state.trips[state.activeTrip]) return null;
    return { id: state.activeTrip, ...state.trips[state.activeTrip] };
  }

  // --- Items ---
  function addItem(item) {
    const state = load();
    if (!state.activeTrip) return null;
    const entry = { id: uuid(), ...item };
    state.trips[state.activeTrip].items.push(entry);
    save(state);
    return entry;
  }

  function getItems(category) {
    const trip = getActiveTrip();
    if (!trip) return [];
    if (category) return trip.items.filter(i => i.category === category);
    return trip.items;
  }

  function findItem(query) {
    const items = getItems();
    const q = query.toLowerCase();
    let match = items.filter(i => i.name.toLowerCase() === q);
    if (match.length) return match;
    match = items.filter(i => i.name.toLowerCase().startsWith(q));
    if (match.length) return match;
    return items.filter(i => i.name.toLowerCase().includes(q));
  }

  function removeItem(name) {
    const state = load();
    if (!state.activeTrip) return false;
    const trip = state.trips[state.activeTrip];
    const q = name.toLowerCase();
    let idx = trip.items.findIndex(i => i.name.toLowerCase() === q);
    if (idx === -1) idx = trip.items.findIndex(i => i.name.toLowerCase().includes(q));
    if (idx === -1) return false;
    const removed = trip.items.splice(idx, 1)[0];
    save(state);
    return removed;
  }

  function editItem(name, field, value) {
    const state = load();
    if (!state.activeTrip) return null;
    const trip = state.trips[state.activeTrip];
    const q = name.toLowerCase();
    const item = trip.items.find(i => i.name.toLowerCase() === q)
      || trip.items.find(i => i.name.toLowerCase().includes(q));
    if (!item) return null;
    item[field] = value;
    save(state);
    return item;
  }

  // --- Settings ---
  function getSettings() {
    return load().settings;
  }

  function setSetting(key, value) {
    const state = load();
    state.settings[key] = value;
    saveLocal(state);
  }

  // --- Import / Export ---
  function exportData() {
    const trip = getActiveTrip();
    if (!trip) return null;
    return JSON.stringify({ name: trip.name, items: trip.items }, null, 2);
  }

  function importData(json) {
    try {
      const data = JSON.parse(json);
      if (!data.name || !Array.isArray(data.items)) throw new Error('Invalid format');
      const state = load();
      const id = uuid();
      state.trips[id] = { name: data.name, items: data.items };
      state.activeTrip = id;
      save(state);
      _listenToTrip(id);
      return data.name;
    } catch (e) {
      return null;
    }
  }

  function loadTripById(id) {
    const state = load();
    if (!state.trips[id]) return null;
    state.activeTrip = id;
    saveLocal(state);
    _listenToTrip(id);
    return state.trips[id];
  }

  function removeItemById(id) {
    const state = load();
    if (!state.activeTrip) return false;
    const trip = state.trips[state.activeTrip];
    const idx = trip.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    const removed = trip.items.splice(idx, 1)[0];
    save(state);
    return removed;
  }

  function editItemById(id, updates) {
    const state = load();
    if (!state.activeTrip) return null;
    const trip = state.trips[state.activeTrip];
    const item = trip.items.find(i => i.id === id);
    if (!item) return null;
    Object.assign(item, updates);
    save(state);
    return item;
  }

  return {
    CATEGORIES, uuid,
    createTrip, listTrips, loadTrip, loadTripById, deleteTrip, getActiveTrip,
    addItem, getItems, findItem, removeItem, removeItemById, editItem, editItemById,
    getSettings, setSetting,
    exportData, importData,
    initSync, joinTrip, getShareUrl, isCloudEnabled,
  };
})();
