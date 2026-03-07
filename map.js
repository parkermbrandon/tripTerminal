// map.js - Google Maps, markers, Places search
const TripMap = (() => {
  let map = null;
  let markers = {};
  let infoWindow = null;
  let placesService = null;
  let currentMapType = 'roadmap';
  const detailsCache = new Map();

  function init() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: 35.6762, lng: 139.6503 },
      zoom: 3,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: [
        { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
      ],
    });

    infoWindow = new google.maps.InfoWindow();
    placesService = new google.maps.places.PlacesService(map);

    return map;
  }

  // SVG pin marker URL with color
  function pinUrl(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.3 21.7 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="6" fill="white" opacity="0.9"/>
    </svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // --- Place Details with cache ---
  function getPlaceDetails(placeId) {
    if (detailsCache.has(placeId)) {
      return Promise.resolve(detailsCache.get(placeId));
    }
    return new Promise((resolve) => {
      if (!placesService) { resolve(null); return; }
      placesService.getDetails({
        placeId,
        fields: ['name', 'formatted_phone_number', 'website', 'opening_hours', 'photos', 'rating', 'user_ratings_total', 'url']
      }, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
          detailsCache.set(placeId, place);
          resolve(place);
        } else {
          resolve(null);
        }
      });
    });
  }

  // --- Directions URL ---
  function directionsUrl(item) {
    let url = 'https://www.google.com/maps/dir/?api=1';
    if (item.lat != null && item.lng != null) {
      url += `&destination=${item.lat},${item.lng}`;
    }
    if (item.place_id) {
      url += `&destination_place_id=${item.place_id}`;
    }
    return url;
  }

  // --- Star rating HTML ---
  function starsHtml(rating, count) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.3;
    let s = '';
    for (let i = 0; i < 5; i++) {
      if (i < full) s += '<span class="star full">&#9733;</span>';
      else if (i === full && half) s += '<span class="star half">&#9733;</span>';
      else s += '<span class="star empty">&#9734;</span>';
    }
    s += `<span class="popup-rating-num">${rating}</span>`;
    if (count) s += `<span class="popup-rating-count">(${count.toLocaleString()})</span>`;
    return s;
  }

  // --- Today's hours ---
  function todayHoursHtml(openingHours) {
    if (!openingHours) return '';
    const isOpen = openingHours.isOpen();
    const dayIndex = new Date().getDay();
    const periods = openingHours.periods;
    if (isOpen && periods) {
      // Find today's closing time
      const todayPeriod = periods.find(p => p.open && p.open.day === dayIndex && p.close);
      if (todayPeriod && todayPeriod.close) {
        const h = todayPeriod.close.hours;
        const m = todayPeriod.close.minutes;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const timeStr = m > 0 ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
        return `<div class="popup-hours open">Open · Closes ${timeStr}</div>`;
      }
      return `<div class="popup-hours open">Open now</div>`;
    }
    return `<div class="popup-hours closed">Closed</div>`;
  }

  // --- Build popup HTML ---
  function buildPopupHtml(item, details) {
    const cat = DB.CATEGORIES[item.category] || { label: 'UNKNOWN', color: '#888' };
    let html = '<div class="popup-card">';

    // Photo
    if (details && details.photos && details.photos.length) {
      const photoUrl = details.photos[0].getUrl({ maxWidth: 300 });
      html += `<img class="popup-photo" src="${photoUrl}" alt="">`;
    }

    html += '<div class="popup-body">';

    // Category + Name
    html += `<div class="popup-category" style="color:${cat.color}">${cat.label}</div>`;
    html += `<div class="popup-name">${escHtml(item.name)}</div>`;

    // Rating
    const rating = (details && details.rating) || item.rating;
    const ratingCount = details && details.user_ratings_total;
    if (rating) {
      html += `<div class="popup-rating">${starsHtml(rating, ratingCount)}</div>`;
    }

    // Address
    if (item.address) {
      html += `<div class="popup-detail">${escHtml(item.address)}</div>`;
    }

    // Phone, Website, Hours from details
    if (details) {
      html += '<div class="popup-meta">';
      if (details.formatted_phone_number) {
        html += `<div class="popup-meta-row"><span class="popup-meta-icon">&#9743;</span><a href="tel:${escHtml(details.formatted_phone_number)}">${escHtml(details.formatted_phone_number)}</a></div>`;
      }
      if (details.website) {
        let hostname;
        try { hostname = new URL(details.website).hostname.replace(/^www\./, ''); } catch { hostname = details.website; }
        html += `<div class="popup-meta-row"><span class="popup-meta-icon">&#127760;</span><a href="${escHtml(details.website)}" target="_blank" rel="noopener">${escHtml(hostname)}</a></div>`;
      }
      if (details.opening_hours) {
        html += todayHoursHtml(details.opening_hours);
      }
      html += '</div>';
    }

    // Divider + our item data
    const hasItemData = item.time || item.cost || item.notes;
    if (hasItemData) {
      html += '<div class="popup-divider"></div>';
      if (item.time) html += `<div class="popup-detail">${escHtml(item.time)}</div>`;
      if (item.cost) html += `<div class="popup-detail">${escHtml(item.cost)}</div>`;
      if (item.notes) html += `<div class="popup-detail popup-notes">${escHtml(item.notes)}</div>`;
    }

    // Action buttons
    html += '<div class="popup-actions">';
    html += `<button class="popup-edit" onclick="App.openEditModal(DB.getItems().find(i=>i.id==='${item.id}'))">Edit</button>`;
    html += `<a class="popup-directions" href="${directionsUrl(item)}" target="_blank" rel="noopener">Get Directions</a>`;
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  // --- Look up place_id for items that don't have one ---
  function findPlaceId(item) {
    return new Promise((resolve) => {
      if (!placesService || !item.name) { resolve(null); return; }
      const query = item.name + (item.address ? ' ' + item.address : '');
      placesService.findPlaceFromQuery({
        query,
        fields: ['place_id'],
        locationBias: item.lat != null ? { lat: item.lat, lng: item.lng } : undefined
      }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length) {
          resolve(results[0].place_id);
        } else {
          resolve(null);
        }
      });
    });
  }

  // --- Async popup open ---
  function openPopup(item, marker) {
    // Show basic popup immediately
    infoWindow.setContent(buildPopupHtml(item, detailsCache.get(item.place_id) || null));
    infoWindow.open(map, marker);

    if (item.place_id) {
      // Fetch details if not cached
      if (!detailsCache.has(item.place_id)) {
        getPlaceDetails(item.place_id).then(details => {
          if (details) infoWindow.setContent(buildPopupHtml(item, details));
        });
      }
    } else if (item.name) {
      // Backfill: look up place_id, save it, then fetch details
      findPlaceId(item).then(placeId => {
        if (!placeId) return;
        item.place_id = placeId;
        DB.editItemById(item.id, { place_id: placeId });
        return getPlaceDetails(placeId);
      }).then(details => {
        if (details) infoWindow.setContent(buildPopupHtml(item, details));
      });
    }
  }

  function syncMarkers() {
    // Remove old markers
    Object.values(markers).forEach(m => m.setMap(null));
    markers = {};

    const items = DB.getItems();
    items.forEach(item => {
      if (item.lat == null || item.lng == null) return;
      const cat = DB.CATEGORIES[item.category] || { label: 'UNKNOWN', color: '#888' };
      const marker = new google.maps.Marker({
        position: { lat: item.lat, lng: item.lng },
        map: map,
        icon: {
          url: pinUrl(cat.color),
          scaledSize: new google.maps.Size(28, 38),
          anchor: new google.maps.Point(14, 38),
        },
        title: item.name,
      });

      marker.addListener('click', () => {
        openPopup(item, marker);
      });

      markers[item.id] = marker;
    });
  }

  function flyTo(item) {
    if (!map || item.lat == null) return;
    map.panTo({ lat: item.lat, lng: item.lng });
    map.setZoom(15);
    if (markers[item.id]) {
      setTimeout(() => {
        openPopup(item, markers[item.id]);
      }, 500);
    }
  }

  function fitAll() {
    const items = DB.getItems().filter(i => i.lat != null);
    if (!items.length) return;
    const bounds = new google.maps.LatLngBounds();
    items.forEach(i => bounds.extend({ lat: i.lat, lng: i.lng }));
    map.fitBounds(bounds, 40);
  }

  // --- Google Places text search ---
  function searchPlaces(query, limit = 5) {
    return new Promise((resolve) => {
      if (!placesService) { resolve([]); return; }

      placesService.textSearch({ query }, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
          resolve([]);
          return;
        }
        const mapped = results.slice(0, limit).map((r, i) => ({
          index: i + 1,
          name: r.name,
          display: r.formatted_address,
          lat: r.geometry.location.lat(),
          lng: r.geometry.location.lng(),
          rating: r.rating,
          types: r.types,
          place_id: r.place_id,
        }));
        resolve(mapped);
      });
    });
  }

  // --- Google Geocoder for address lookup ---
  function geocode(address) {
    return new Promise((resolve) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          resolve({
            lat: results[0].geometry.location.lat(),
            lng: results[0].geometry.location.lng(),
            display: results[0].formatted_address,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  function highlightMarker(itemId) {
    const marker = markers[itemId];
    if (!marker) return;
    marker._origIcon = marker.getIcon();
    marker.setIcon({
      url: pinUrl('#FFD700'),
      scaledSize: new google.maps.Size(36, 48),
      anchor: new google.maps.Point(18, 48),
    });
    marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
  }

  function unhighlightMarker(itemId) {
    const marker = markers[itemId];
    if (!marker || !marker._origIcon) return;
    marker.setIcon(marker._origIcon);
    marker.setZIndex(undefined);
    delete marker._origIcon;
  }

  function toggleMapType() {
    if (!map) return;
    currentMapType = currentMapType === 'roadmap' ? 'hybrid' : 'roadmap';
    map.setMapTypeId(currentMapType);
    return currentMapType;
  }

  return { init, syncMarkers, flyTo, fitAll, geocode, searchPlaces, toggleMapType, highlightMarker, unhighlightMarker };
})();
