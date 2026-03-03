// map.js - Google Maps, markers, Places search
const TripMap = (() => {
  let map = null;
  let markers = {};
  let infoWindow = null;
  let placesService = null;
  let currentMapType = 'roadmap';

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

  function buildPopupHtml(item) {
    const cat = DB.CATEGORIES[item.category] || { label: 'UNKNOWN', color: '#888' };
    let html = `<div class="popup-category" style="color:${cat.color}">${cat.label}</div>`;
    html += `<div class="popup-name">${escHtml(item.name)}</div>`;
    if (item.address) html += `<div class="popup-detail">${escHtml(item.address)}</div>`;
    if (item.time) html += `<div class="popup-detail">${escHtml(item.time)}</div>`;
    if (item.notes) html += `<div class="popup-detail">${escHtml(item.notes)}</div>`;
    return html;
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
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
        infoWindow.setContent(buildPopupHtml(item));
        infoWindow.open(map, marker);
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
        infoWindow.setContent(buildPopupHtml(item));
        infoWindow.open(map, markers[item.id]);
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

  function toggleMapType() {
    if (!map) return;
    currentMapType = currentMapType === 'roadmap' ? 'hybrid' : 'roadmap';
    map.setMapTypeId(currentMapType);
    return currentMapType;
  }

  return { init, syncMarkers, flyTo, fitAll, geocode, searchPlaces, toggleMapType };
})();
