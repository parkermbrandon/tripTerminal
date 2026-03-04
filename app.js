// app.js - Modal system, GUI handlers, terminal I/O, side panel, boot
const App = (() => {
  const output = document.getElementById('terminal-output');
  const input = document.getElementById('terminal-input');
  const mirror = document.getElementById('input-mirror');
  const cursor = document.getElementById('cursor');
  const terminalEl = document.getElementById('terminal');
  const terminalToggle = document.getElementById('terminal-toggle');
  const panelList = document.getElementById('panel-list');
  const panelTabs = document.getElementById('panel-tabs');
  const tripNameEl = document.getElementById('trip-name');
  const addItemBtn = document.getElementById('add-item-btn');
  const satelliteToggle = document.getElementById('satellite-toggle');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const shareBtn = document.getElementById('share-btn');
  const panelViewToggle = document.getElementById('panel-view-toggle');
  const itinCostSummary = document.getElementById('itin-cost-summary');

  let history = [];
  let historyIdx = -1;
  let promptMode = null;
  let activeTab = 'all';
  let activeView = 'locations';
  let searchDebounceTimer = null;

  // === Helpers ===
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // === Modal Controller ===
  let modalActionHandler = null;

  const modal = {
    open(html, actionHandler) {
      modalContent.innerHTML = html;
      modalActionHandler = actionHandler || null;
      modalOverlay.classList.remove('hidden');
    },
    close() {
      modalOverlay.classList.add('hidden');
      modalContent.innerHTML = '';
      modalActionHandler = null;
    }
  };

  // Close on overlay click (not content)
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modal.close();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      modal.close();
    }
  });

  // Delegate data-action clicks inside modal
  modalContent.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl && modalActionHandler) {
      e.stopPropagation();
      modalActionHandler(actionEl.dataset.action, actionEl);
    }
  });

  // === Terminal Toggle ===
  terminalToggle.addEventListener('click', () => {
    const collapsed = terminalEl.classList.toggle('collapsed');
    terminalToggle.classList.toggle('open', !collapsed);
    if (!collapsed) {
      input.focus();
      output.scrollTop = output.scrollHeight;
    }
  });

  // === Satellite Toggle ===
  satelliteToggle.addEventListener('click', () => {
    TripMap.toggleMapType();
  });

  // === Terminal Output ===
  function print(text, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function printHtml(html) {
    const line = document.createElement('div');
    line.innerHTML = html;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function clear() {
    output.innerHTML = '';
  }

  // === Prompt Mechanism ===
  function prompt(question) {
    print(question, 'info');
    return new Promise(resolve => {
      promptMode = { resolve };
    });
  }

  // === Refresh All ===
  function refresh() {
    TripMap.syncMarkers();
    renderPanel();
  }

  const ctx = { print, printHtml, clear, prompt, refresh };

  // === Terminal Input Handling ===
  function handleEnter() {
    const val = input.value;
    input.value = '';
    mirror.textContent = '';

    if (promptMode) {
      print(`> ${val}`);
      const resolve = promptMode.resolve;
      promptMode = null;
      resolve(val);
      return;
    }

    if (!val.trim()) return;

    print(`> ${val}`);
    history.unshift(val);
    if (history.length > 100) history.pop();
    historyIdx = -1;

    Commands.execute(val, ctx);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEnter();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIdx < history.length - 1) {
        historyIdx++;
        input.value = history[historyIdx];
        mirror.textContent = input.value;
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        historyIdx--;
        input.value = history[historyIdx];
        mirror.textContent = input.value;
      } else {
        historyIdx = -1;
        input.value = '';
        mirror.textContent = '';
      }
    }
  });

  input.addEventListener('input', () => {
    mirror.textContent = input.value;
  });

  terminalEl.addEventListener('click', (e) => {
    if (e.target === terminalEl || e.target.closest('#terminal-output') || e.target.closest('#terminal-input-line')) {
      input.focus();
    }
  });

  // Global keydown: focus terminal input only when terminal is open and modal is closed
  document.addEventListener('keydown', (e) => {
    if (!modalOverlay.classList.contains('hidden')) return;
    if (terminalEl.classList.contains('collapsed')) return;
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      input.focus();
    }
  });

  // === Trip Selector Modal ===
  function openTripSelector() {
    const trips = DB.listTrips();
    const activeTrip = DB.getActiveTrip();
    const activeId = activeTrip ? activeTrip.id : null;

    let html = `
      <div class="modal-header">
        <span class="modal-title">Your Trips</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">`;

    if (trips.length === 0) {
      html += `<div class="search-status">No trips yet. Create one below!</div>`;
    } else {
      trips.forEach(t => {
        html += `
          <div class="trip-list-item${t.id === activeId ? ' active-trip' : ''}" data-action="load-trip" data-id="${escAttr(t.id)}">
            <div class="trip-list-info">
              <div class="trip-list-name">${escHtml(t.name)}</div>
              <div class="trip-list-count">${t.itemCount} item${t.itemCount !== 1 ? 's' : ''}${t.active ? ' — active' : ''}</div>
            </div>
            <button class="trip-list-delete" data-action="delete-trip" data-id="${escAttr(t.id)}" data-name="${escAttr(t.name)}" title="Delete trip">&times;</button>
          </div>`;
      });
    }

    html += `
        <div class="modal-actions">
          <button class="btn btn-primary" data-action="new-trip">+ New Trip</button>
        </div>
      </div>`;

    modal.open(html, (action, el) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'load-trip') {
        const id = el.dataset.id;
        DB.loadTripById(id);
        refresh();
        TripMap.fitAll();
        modal.close();
      } else if (action === 'delete-trip') {
        const id = el.dataset.id;
        const name = el.dataset.name;
        openDeleteTripConfirm(id, name);
      } else if (action === 'new-trip') {
        openNewTripModal();
      }
    });
  }

  // === New Trip Sub-Modal ===
  function openNewTripModal() {
    const html = `
      <div class="modal-header">
        <span class="modal-title">New Trip</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Trip Name</label>
          <input type="text" id="new-trip-name" placeholder='e.g. "Hawaii 2026"' autofocus>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="back">Back</button>
          <button class="btn btn-primary" data-action="create">Create Trip</button>
        </div>
      </div>`;

    modal.open(html, (action) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'back') {
        openTripSelector();
      } else if (action === 'create') {
        const nameInput = document.getElementById('new-trip-name');
        const name = nameInput.value.trim();
        if (!name) return;
        DB.createTrip(name);
        refresh();
        modal.close();
      }
    });

    // Submit on Enter
    setTimeout(() => {
      const nameInput = document.getElementById('new-trip-name');
      if (nameInput) {
        nameInput.focus();
        nameInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const name = nameInput.value.trim();
            if (!name) return;
            DB.createTrip(name);
            refresh();
            modal.close();
          }
        });
      }
    }, 50);
  }

  // === Delete Trip Confirmation ===
  function openDeleteTripConfirm(tripId, tripName) {
    const html = `
      <div class="modal-header">
        <span class="modal-title">Delete Trip</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:8px;">Are you sure you want to delete <strong>${escHtml(tripName)}</strong>?</p>
        <p style="color:var(--text-dim);font-size:12px;margin-bottom:16px;">This cannot be undone. All items in this trip will be lost.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="back">Cancel</button>
          <button class="btn btn-danger" data-action="confirm-delete">Delete Trip</button>
        </div>
      </div>`;

    modal.open(html, (action) => {
      if (action === 'close' || action === 'back') {
        openTripSelector();
      } else if (action === 'confirm-delete') {
        DB.deleteTrip(tripName);
        refresh();
        openTripSelector();
      }
    });
  }

  // === Add Place Flow (2-step) ===
  function openAddPlaceModal() {
    const trip = DB.getActiveTrip();
    if (!trip) {
      openNewTripModal();
      return;
    }

    let selectedCategory = (activeTab !== 'all') ? activeTab : 'eats';

    const html = `
      <div class="modal-header">
        <span class="modal-title">Add Place</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="category-pills">
          <button class="cat-pill${selectedCategory === 'eats' ? ' active' : ''}" data-action="set-cat" data-cat="eats">Eats</button>
          <button class="cat-pill${selectedCategory === 'sleeps' ? ' active' : ''}" data-action="set-cat" data-cat="sleeps">Sleeps</button>
          <button class="cat-pill${selectedCategory === 'spots' ? ' active' : ''}" data-action="set-cat" data-cat="spots">Spots</button>
          <button class="cat-pill${selectedCategory === 'events' ? ' active' : ''}" data-action="set-cat" data-cat="events">Events</button>
          <button class="cat-pill${selectedCategory === 'transport' ? ' active' : ''}" data-action="set-cat" data-cat="transport">Transport</button>
        </div>
        <div class="modal-field">
          <label>Search for a place</label>
          <input type="text" id="place-search-input" placeholder='e.g. "sushi tokyo"' autofocus>
        </div>
        <div id="search-results">
          <div class="search-status">Type to search for places</div>
        </div>
      </div>`;

    modal.open(html, (action, el) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'set-cat') {
        selectedCategory = el.dataset.cat;
        modalContent.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
      } else if (action === 'pick-result') {
        const data = JSON.parse(el.dataset.place);
        openPlaceDetailForm(selectedCategory, data);
      }
    });

    // Set up search with debounce
    setTimeout(() => {
      const searchInput = document.getElementById('place-search-input');
      if (!searchInput) return;
      searchInput.focus();

      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        const query = searchInput.value.trim();
        if (!query) {
          document.getElementById('search-results').innerHTML =
            '<div class="search-status">Type to search for places</div>';
          return;
        }
        document.getElementById('search-results').innerHTML =
          '<div class="search-status">Searching...</div>';

        searchDebounceTimer = setTimeout(async () => {
          const results = await TripMap.searchPlaces(query, 8);
          const container = document.getElementById('search-results');
          if (!container) return;

          if (!results.length) {
            container.innerHTML = '<div class="search-status">No results found</div>';
            return;
          }

          container.innerHTML = results.map(r => {
            const ratingHtml = r.rating ? `<div class="search-result-rating">${r.rating} &#9733;</div>` : '';
            const placeData = escAttr(JSON.stringify({
              name: r.name,
              address: r.display,
              lat: r.lat,
              lng: r.lng,
              rating: r.rating
            }));
            return `
              <div class="search-result" data-action="pick-result" data-place="${placeData}">
                <div class="search-result-name">${escHtml(r.name)}</div>
                <div class="search-result-address">${escHtml(r.display)}</div>
                ${ratingHtml}
              </div>`;
          }).join('');
        }, 400);
      });

      // Allow pressing Enter on empty input to skip search
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = searchInput.value.trim();
          if (!query) {
            // Open detail form with empty data for manual entry
            openPlaceDetailForm(selectedCategory, { name: '', address: '', lat: null, lng: null });
          }
        }
      });
    }, 50);
  }

  // === Place Detail Form (step 2) ===
  function openPlaceDetailForm(category, placeData) {
    const html = `
      <div class="modal-header">
        <span class="modal-title">Add to ${escHtml(DB.CATEGORIES[category].label)}</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Name</label>
          <input type="text" id="detail-name" value="${escAttr(placeData.name)}">
        </div>
        <div class="modal-field">
          <label>Address</label>
          <input type="text" id="detail-address" value="${escAttr(placeData.address)}" ${placeData.lat != null ? 'readonly' : ''}>
        </div>
        <div id="detail-datetime-container">
          ${buildDateTimeFields(category, '')}
        </div>
        <div class="modal-field">
          <label>Cost</label>
          <input type="text" id="detail-cost" placeholder="e.g. $50 (optional)">
        </div>
        <div class="modal-field">
          <label>Notes</label>
          <textarea id="detail-notes" placeholder="Optional notes..."></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="back">Back</button>
          <button class="btn btn-primary" data-action="save">Add Place</button>
        </div>
      </div>`;

    modal.open(html, async (action) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'back') {
        openAddPlaceModal();
      } else if (action === 'save') {
        const name = document.getElementById('detail-name').value.trim();
        if (!name) return;
        const address = document.getElementById('detail-address').value.trim();
        const dtValues = readDateTimeFromForm();
        const time = formatDateTime(category, dtValues.startDate, dtValues.endDate, dtValues.time);
        const cost = document.getElementById('detail-cost').value.trim();
        const notes = document.getElementById('detail-notes').value.trim();

        let lat = placeData.lat;
        let lng = placeData.lng;

        // If address changed and we don't have coords, geocode
        if (address && lat == null) {
          const geo = await TripMap.geocode(address);
          if (geo) {
            lat = geo.lat;
            lng = geo.lng;
          }
        }

        const item = DB.addItem({ name, category, address, lat, lng, time, cost, notes });
        if (item) {
          refresh();
          if (lat != null) TripMap.flyTo(item);
          modal.close();
        }
      }
    });

    setTimeout(() => {
      const nameInput = document.getElementById('detail-name');
      if (nameInput) nameInput.focus();
    }, 50);
  }

  // === Edit Item Modal ===
  function openEditModal(item) {
    const cats = Object.entries(DB.CATEGORIES);
    const catOptions = cats.map(([key, val]) =>
      `<option value="${key}" ${item.category === key ? 'selected' : ''}>${val.label}</option>`
    ).join('');

    const html = `
      <div class="modal-header">
        <span class="modal-title">Edit Item</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Category</label>
          <select id="edit-category">${catOptions}</select>
        </div>
        <div class="modal-field">
          <label>Name</label>
          <input type="text" id="edit-name" value="${escAttr(item.name)}">
        </div>
        <div class="modal-field">
          <label>Address</label>
          <input type="text" id="edit-address" value="${escAttr(item.address || '')}">
        </div>
        <div id="edit-datetime-container">
          ${buildDateTimeFields(item.category, item.time)}
        </div>
        <div class="modal-field">
          <label>Cost</label>
          <input type="text" id="edit-cost" value="${escAttr(item.cost || '')}">
        </div>
        <div class="modal-field">
          <label>Notes</label>
          <textarea id="edit-notes">${escHtml(item.notes || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="close">Cancel</button>
          <button class="btn btn-primary" data-action="save">Save Changes</button>
        </div>
      </div>`;

    modal.open(html, async (action) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'save') {
        const category = document.getElementById('edit-category').value;
        const name = document.getElementById('edit-name').value.trim();
        if (!name) return;
        const address = document.getElementById('edit-address').value.trim();
        const dtValues = readDateTimeFromForm();
        const time = formatDateTime(category, dtValues.startDate, dtValues.endDate, dtValues.time);
        const cost = document.getElementById('edit-cost').value.trim();
        const notes = document.getElementById('edit-notes').value.trim();

        const updates = { category, name, address, time, cost, notes };

        // Re-geocode if address changed
        if (address !== (item.address || '')) {
          if (address) {
            const geo = await TripMap.geocode(address);
            if (geo) {
              updates.lat = geo.lat;
              updates.lng = geo.lng;
            }
          } else {
            updates.lat = null;
            updates.lng = null;
          }
        }

        DB.editItemById(item.id, updates);
        refresh();
        modal.close();
      }
    });

    // Re-render date fields when category changes
    setTimeout(() => {
      const catSelect = document.getElementById('edit-category');
      if (catSelect) {
        catSelect.addEventListener('change', () => {
          const container = document.getElementById('edit-datetime-container');
          if (!container) return;
          const dtValues = readDateTimeFromForm();
          const currentTime = formatDateTime(catSelect.value, dtValues.startDate, dtValues.endDate, dtValues.time);
          container.innerHTML = buildDateTimeFields(catSelect.value, currentTime);
        });
      }
    }, 50);
  }

  // === Delete Item Confirmation ===
  function openDeleteItemConfirm(item) {
    const html = `
      <div class="modal-header">
        <span class="modal-title">Delete Item</span>
        <button class="modal-close" data-action="close">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom:8px;">Are you sure you want to delete <strong>${escHtml(item.name)}</strong>?</p>
        <p style="color:var(--text-dim);font-size:12px;margin-bottom:16px;">This cannot be undone.</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-action="close">Cancel</button>
          <button class="btn btn-danger" data-action="confirm-delete">Delete</button>
        </div>
      </div>`;

    modal.open(html, (action) => {
      if (action === 'close') {
        modal.close();
      } else if (action === 'confirm-delete') {
        DB.removeItemById(item.id);
        refresh();
        modal.close();
      }
    });
  }

  // === Itinerary: Date Parsing ===
  function parseItemDate(timeStr) {
    if (!timeStr) return null;
    const s = timeStr.trim();
    // Try direct Date parse first (handles ISO, "March 15, 2026", etc.)
    const direct = new Date(s);
    if (!isNaN(direct) && direct.getFullYear() > 2000) {
      return direct.toISOString().slice(0, 10);
    }
    // Try "Mon DD" patterns like "Mar 15", "Mar 15 7pm", "March 15"
    const monthMatch = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
    if (monthMatch) {
      const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
      const mon = months[monthMatch[1].toLowerCase().slice(0, 3)];
      const day = parseInt(monthMatch[2]);
      if (mon !== undefined && day >= 1 && day <= 31) {
        const year = new Date().getFullYear();
        const d = new Date(year, mon, day);
        return d.toISOString().slice(0, 10);
      }
    }
    return null;
  }

  // === Itinerary Icons ===
  const ITIN_ICONS = {
    flight: '\u2708\uFE0F',
    hotel: '\uD83C\uDFE8',
    eats: '\uD83C\uDF74',
    sleeps: '\uD83D\uDECF\uFE0F',
    spots: '\uD83D\uDCCD',
    events: '\uD83D\uDCC5',
    transport: '\uD83D\uDE97',
  };

  // === Parse city from address ===
  function parseCity(address) {
    if (!address) return null;
    const parts = address.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return parts[0] || null;

    if (parts.length >= 3) {
      const penult = parts[parts.length - 2].trim();
      // US-style: "City, STATE ZIP, Country" — "NY 10118"
      if (/^[A-Z]{2}\s+\d/.test(penult)) {
        return parts[parts.length - 3].trim() || null;
      }
      // Standalone postal code segment: "540-0002", "75007", etc.
      if (/^[\d\s-]+$/.test(penult)) {
        const city = parts[parts.length - 3];
        if (city) {
          const cleaned = city.replace(/\b\S*\d\S*\b/g, '').replace(/\s{2,}/g, ' ').trim();
          return cleaned || city.trim();
        }
      }
    }

    // Others: 2nd-to-last, strip tokens containing digits
    const raw = parts[parts.length - 2];
    const cleaned = raw.replace(/\b\S*\d\S*\b/g, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned || null;
  }

  // === Date/Time Picker Helpers ===
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function monthDayToISO(str) {
    if (!str) return '';
    const m = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?/i);
    if (!m) return '';
    const mon = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[1].toLowerCase().slice(0, 3));
    if (mon < 0) return '';
    const day = parseInt(m[2]);
    const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    return `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseTimeToInput(str) {
    if (!str) return '';
    const m = str.match(/(\d{1,2}):(\d{2})\s*(am|pm|a|p)?/i);
    if (!m) return '';
    let h = parseInt(m[1]);
    const min = m[2];
    const ampm = (m[3] || '').toLowerCase();
    if (ampm.startsWith('p') && h < 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  function parseDateTimeFromString(timeStr) {
    if (!timeStr) return { startDate: '', endDate: '', time: '' };
    const s = timeStr.trim();
    // Range: "Mar 14 - Mar 19" or "Mar 14 2026 - Mar 19 2026"
    const rangeMatch = s.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?)\s*[-–]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?)\s*(.*)/i);
    if (rangeMatch) {
      return {
        startDate: monthDayToISO(rangeMatch[1]),
        endDate: monthDayToISO(rangeMatch[2]),
        time: parseTimeToInput(rangeMatch[3])
      };
    }
    // Single date: "Mar 15 2:30 PM" or "Mar 15"
    const singleMatch = s.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?)\s*(.*)/i);
    if (singleMatch) {
      return {
        startDate: monthDayToISO(singleMatch[1]),
        endDate: '',
        time: parseTimeToInput(singleMatch[2])
      };
    }
    // Just a time: "2:30 PM"
    const timeOnly = parseTimeToInput(s);
    if (timeOnly) return { startDate: '', endDate: '', time: timeOnly };
    return { startDate: '', endDate: '', time: '' };
  }

  function formatDateTime(category, startDate, endDate, time) {
    const parts = [];
    const fmtDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso + 'T12:00:00');
      if (isNaN(d)) return iso;
      return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
    };
    const fmtTime = (t) => {
      if (!t) return '';
      const [hStr, mStr] = t.split(':');
      let h = parseInt(hStr);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'PM' : 'AM';
      if (h === 0) h = 12;
      else if (h > 12) h -= 12;
      return `${h}:${m} ${ampm}`;
    };

    if (category === 'sleeps' || category === 'transport') {
      if (startDate && endDate) {
        parts.push(fmtDate(startDate) + ' - ' + fmtDate(endDate));
      } else if (startDate) {
        parts.push(fmtDate(startDate));
      }
    } else {
      if (startDate) parts.push(fmtDate(startDate));
    }
    if (time) parts.push(fmtTime(time));
    return parts.join(' ');
  }

  function buildDateTimeFields(category, timeStr) {
    const parsed = parseDateTimeFromString(timeStr);
    const isRange = category === 'sleeps' || category === 'transport';

    if (isRange) {
      return `
        <div class="modal-field">
          <label>Start Date</label>
          <input type="date" id="dt-start-date" value="${parsed.startDate}">
        </div>
        <div class="modal-field">
          <label>End Date</label>
          <input type="date" id="dt-end-date" value="${parsed.endDate}">
        </div>
        <div class="modal-field">
          <label>Time (optional)</label>
          <input type="time" id="dt-time" value="${parsed.time}">
        </div>`;
    }
    return `
      <div class="modal-field">
        <label>Date</label>
        <input type="date" id="dt-start-date" value="${parsed.startDate}">
      </div>
      <div class="modal-field">
        <label>Time (optional)</label>
        <input type="time" id="dt-time" value="${parsed.time}">
      </div>`;
  }

  function readDateTimeFromForm() {
    const startDate = (document.getElementById('dt-start-date') || {}).value || '';
    const endDate = (document.getElementById('dt-end-date') || {}).value || '';
    const time = (document.getElementById('dt-time') || {}).value || '';
    return { startDate, endDate, time };
  }

  // === Parse cost string to number ===
  function parseCost(costStr) {
    if (!costStr) return 0;
    const num = parseFloat(String(costStr).replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  // === Format date for display ===
  function formatDateHeading(dateStr) {
    if (!dateStr) return 'No Date';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // === Render Itinerary Timeline (into panelList) ===
  function renderItineraryView() {
    const trip = DB.getActiveTrip();
    if (!trip) {
      panelList.innerHTML = '<div class="itin-empty">No trip loaded.</div>';
      itinCostSummary.innerHTML = '';
      return;
    }

    const allItems = DB.getItems();
    const items = activeTab === 'all' ? allItems : allItems.filter(i => i.category === activeTab);
    const entries = [];

    items.forEach(item => {
      const dateKey = parseItemDate(item.time);
      let sortTime = '';
      if (item.time) {
        const tMatch = item.time.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
        if (tMatch) {
          let h = parseInt(tMatch[1]);
          const m = tMatch[2] ? parseInt(tMatch[2]) : 0;
          const ampm = (tMatch[3] || '').toLowerCase();
          if (ampm.startsWith('p') && h < 12) h += 12;
          if (ampm.startsWith('a') && h === 12) h = 0;
          sortTime = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        }
      }
      entries.push({ item, dateKey, sortTime, type: item.category });
    });

    // Group by dateKey
    const groups = {};
    entries.forEach(e => {
      const key = e.dateKey || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });

    sortedKeys.forEach(key => {
      groups[key].sort((a, b) => (a.sortTime || '').localeCompare(b.sortTime || ''));
    });

    panelList.innerHTML = '';

    if (!entries.length) {
      panelList.innerHTML = '<div class="itin-empty">No items yet.<br>Add flights, sleeps, or places with dates.</div>';
      itinCostSummary.innerHTML = '';
      return;
    }

    sortedKeys.forEach(key => {
      const header = document.createElement('div');
      header.className = 'itin-date-group';
      header.textContent = key === '__none__' ? 'No Date' : formatDateHeading(key);
      panelList.appendChild(header);

      groups[key].forEach(entry => {
        const el = document.createElement('div');
        el.className = `itin-item type-${entry.type}`;

        const icon = document.createElement('span');
        icon.className = 'itin-icon';
        icon.textContent = ITIN_ICONS[entry.type] || '\uD83D\uDCCC';

        const info = document.createElement('div');
        info.className = 'itin-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'itin-name';
        nameEl.textContent = entry.item.name;

        const subEl = document.createElement('div');
        subEl.className = 'itin-sub';
        const parts = [];
        if (entry.item.time) {
          const timeOnly = entry.item.time.replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s*/i, '').trim();
          if (timeOnly) parts.push(timeOnly);
          else parts.push(entry.item.time);
        }
        if (entry.item.address) parts.push(entry.item.address);
        subEl.textContent = parts.join(' | ');

        info.appendChild(nameEl);
        if (subEl.textContent) info.appendChild(subEl);

        el.appendChild(icon);
        el.appendChild(info);

        const costVal = parseCost(entry.item.cost);
        if (costVal > 0) {
          const costEl = document.createElement('span');
          costEl.className = 'itin-cost';
          costEl.textContent = '$' + costVal.toLocaleString();
          el.appendChild(costEl);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'itin-item-delete';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Delete';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          DB.removeItemById(entry.item.id);
          refresh();
        });
        el.appendChild(delBtn);

        el.addEventListener('click', (e) => {
          if (e.target.closest('.itin-item-delete')) return;
          openEditModal(entry.item);
        });

        panelList.appendChild(el);
      });
    });

    // Cost summary
    let total = 0;
    entries.forEach(e => { total += parseCost(e.item.cost); });
    if (total > 0) {
      itinCostSummary.innerHTML = `<span>Total</span><span style="color:#2a9d5c">$${total.toLocaleString()}</span>`;
    } else {
      itinCostSummary.innerHTML = '';
    }
  }

  // === Side Panel ===
  function renderPanel() {
    const trip = DB.getActiveTrip();
    // Update trip name button text
    tripNameEl.innerHTML = escHtml(trip ? trip.name : 'NO TRIP LOADED') +
      ' <span class="dropdown-arrow">&#9662;</span>';

    // Show/hide share button
    if (DB.isCloudEnabled() && trip) {
      shareBtn.classList.remove('hidden');
    } else {
      shareBtn.classList.add('hidden');
    }

    // Render itinerary (By Date) view
    if (activeView === 'itinerary') {
      itinCostSummary.style.display = '';
      renderItineraryView();
      return;
    }

    // Locations view
    itinCostSummary.innerHTML = '';

    const items = DB.getItems();
    const filtered = activeTab === 'all' ? items : items.filter(i => i.category === activeTab);

    panelList.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = trip
        ? 'No items yet.\nClick "+ Add Place" above to get started!'
        : 'Create a trip to get started!\nClick the trip name above.';
      panelList.appendChild(empty);
      return;
    }

    // Group items by city
    const cityGroups = {};
    filtered.forEach(item => {
      const city = parseCity(item.address) || 'Other';
      if (!cityGroups[city]) cityGroups[city] = [];
      cityGroups[city].push(item);
    });

    const cityKeys = Object.keys(cityGroups).sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });

    cityKeys.forEach(city => {
      const header = document.createElement('div');
      header.className = 'itin-date-group';
      header.textContent = city;
      panelList.appendChild(header);

      cityGroups[city].forEach(item => {
        const el = document.createElement('div');
        el.className = 'panel-item';

        el.addEventListener('click', (e) => {
          if (e.target.closest('.panel-item-delete')) return;
          if (item.lat != null) TripMap.flyTo(item);
        });

        el.addEventListener('dblclick', (e) => {
          e.preventDefault();
          openEditModal(item);
        });

        const dot = document.createElement('span');
        dot.className = 'panel-dot';
        const cat = DB.CATEGORIES[item.category] || { color: '#888' };
        dot.style.background = cat.color;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'panel-item-name';
        nameSpan.textContent = item.name;

        el.appendChild(dot);
        el.appendChild(nameSpan);

        if (item.cost) {
          const costSpan = document.createElement('span');
          costSpan.className = 'panel-item-cost';
          costSpan.textContent = item.cost;
          el.appendChild(costSpan);
        }

        if (item.time) {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'panel-item-time';
          timeSpan.textContent = item.time;
          el.appendChild(timeSpan);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'panel-item-delete';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Delete item';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openDeleteItemConfirm(item);
        });
        el.appendChild(deleteBtn);

        panelList.appendChild(el);
      });
    });
  }

  // Tab clicks
  panelTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    panelTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.cat;
    renderPanel();
  });

  // Trip name click → trip selector
  tripNameEl.addEventListener('click', () => {
    openTripSelector();
  });

  // Add Place button
  addItemBtn.addEventListener('click', () => {
    openAddPlaceModal();
  });

  // View toggle
  panelViewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    panelViewToggle.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeView = btn.dataset.view;
    renderPanel();
  });

  // Share button
  shareBtn.addEventListener('click', async () => {
    const url = DB.getShareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = '\u2713';
      setTimeout(() => { shareBtn.textContent = '\uD83D\uDD17'; }, 1500);
    } catch {
      window.prompt('Copy this share link:', url);
    }
  });

  // === Apply Theme ===
  function applyTheme() {
    const settings = DB.getSettings();
    if (settings.theme && settings.theme !== 'default') {
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  }

  // === Boot Sequence ===
  async function boot() {
    applyTheme();
    TripMap.init();

    // Instant print (no typewriter since terminal starts hidden)
    print('');
    print('  TRIP TERMINAL', 'info');
    print('  Plan your next adventure!', 'info');
    print('');
    print('  Type "help" for commands.', 'dim');
    print('');

    // Initialize cloud sync
    await DB.initSync(refresh);
    if (DB.isCloudEnabled()) {
      print('  Cloud sync active.', 'success');
    }

    // Handle ?trip= share link
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('trip');
    if (joinId) {
      print(`  Joining shared trip...`, 'dim');
      const joined = await DB.joinTrip(joinId);
      if (joined) {
        print(`  Joined trip: ${joined.name}`, 'success');
      } else {
        print('  Could not find shared trip.', 'warning');
      }
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }

    const trip = DB.getActiveTrip();
    if (trip) {
      print(`  Active trip: ${trip.name}`, 'success');
      print(`  ${trip.items.length} item${trip.items.length !== 1 ? 's' : ''} loaded.`, 'dim');
      TripMap.syncMarkers();
      TripMap.fitAll();
    } else {
      print('  No trip loaded.', 'dim');
    }
    print('');

    renderPanel();
  }

  document.addEventListener('DOMContentLoaded', boot);

  return { print, clear, refresh, ctx };
})();
