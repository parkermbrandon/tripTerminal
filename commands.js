// commands.js - Command registry, parsing, all command handlers
const Commands = (() => {
  const registry = {};

  function register(name, handler, description) {
    registry[name] = { handler, description };
  }

  function parse(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parts = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (!inQuote && (ch === '"' || ch === "'")) {
        inQuote = true;
        quoteChar = ch;
      } else if (inQuote && ch === quoteChar) {
        inQuote = false;
      } else if (!inQuote && ch === ' ') {
        if (current) parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) parts.push(current);
    return { command: parts[0].toLowerCase(), args: parts.slice(1) };
  }

  async function execute(input, ctx) {
    const parsed = parse(input);
    if (!parsed) return;
    const { command, args } = parsed;

    if (command === 'trip' && args.length > 0) {
      const subCmd = `trip ${args[0].toLowerCase()}`;
      if (registry[subCmd]) {
        return registry[subCmd].handler(args.slice(1), ctx);
      }
    }

    if (registry[command]) {
      return registry[command].handler(args, ctx);
    }

    ctx.print(`Unknown command: ${command}`, 'error');
    ctx.print('Type "help" for available commands.', 'dim');
  }

  // === COMMANDS ===

  register('help', (args, ctx) => {
    ctx.print('');
    ctx.print('--- Trip Terminal Commands ---', 'info');
    ctx.print('');
    ctx.print('  help                      Show this help');
    ctx.print('  clear                     Clear terminal');
    ctx.print('  add <cat> <name>          Add item (search for places)');
    ctx.print('  search <query>            Search for a place');
    ctx.print('  list [category]           List items');
    ctx.print('  goto <name>               Pan map to pin');
    ctx.print('  rm <name>                 Remove an item');
    ctx.print('  edit <name> <field> <val> Edit item field');
    ctx.print('  trip new <name>           Create a new trip');
    ctx.print('  trip list                 List all trips');
    ctx.print('  trip load <name>          Switch to a trip');
    ctx.print('  trip delete <name>        Delete a trip');
    ctx.print('  itinerary                 Show trip timeline');
    ctx.print('  export                    Download trip as JSON');
    ctx.print('  import                    Upload JSON file');
    ctx.print('  satellite                 Toggle satellite view');
    ctx.print('  share                     Copy share link');
    ctx.print('  theme <default|ocean|sunset> Switch theme');
    ctx.print('');
    ctx.print('Categories: eats, sleeps, spots, events, transport', 'dim');
    ctx.print('');
  }, 'Show all commands');

  register('clear', (args, ctx) => {
    ctx.clear();
  }, 'Clear terminal');

  register('list', (args, ctx) => {
    const category = args[0]?.toLowerCase();
    if (category && !DB.CATEGORIES[category]) {
      ctx.print(`Unknown category: ${category}`, 'error');
      ctx.print('Categories: eats, sleeps, spots, events, transport', 'dim');
      return;
    }
    const trip = DB.getActiveTrip();
    if (!trip) {
      ctx.print('No active trip. Use "trip new <name>" to create one.', 'warning');
      return;
    }
    const items = DB.getItems(category);
    if (!items.length) {
      ctx.print(category ? `No ${category} items.` : 'No items yet.', 'dim');
      ctx.print('Use "add <category> <name>" to add one.', 'dim');
      return;
    }
    ctx.print('');
    ctx.print(`--- ${category ? category.toUpperCase() : 'ALL ITEMS'} (${items.length}) ---`, 'info');
    items.forEach(item => {
      const cat = DB.CATEGORIES[item.category];
      const prefix = `  [${cat.label}]`;
      let line = `${prefix} ${item.name}`;
      if (item.time) line += ` @ ${item.time}`;
      if (item.cost) line += ` [${item.cost}]`;
      ctx.print(line, `cat-${item.category}`);
      if (item.address) ctx.print(`         ${item.address}`, 'dim');
      if (item.notes) ctx.print(`         ${item.notes}`, 'dim');
    });
    ctx.print('');
  }, 'List items');

  // --- ADD with place search ---
  register('add', async (args, ctx) => {
    if (args.length < 2) {
      ctx.print('Usage: add <category> <name>', 'error');
      ctx.print('Categories: eats, sleeps, spots, events, transport', 'dim');
      return;
    }
    const category = args[0].toLowerCase();
    if (!DB.CATEGORIES[category]) {
      ctx.print(`Unknown category: ${category}`, 'error');
      ctx.print('Categories: eats, sleeps, spots, events, transport', 'dim');
      return;
    }
    if (!DB.getActiveTrip()) {
      ctx.print('No active trip. Use "trip new <name>" first.', 'warning');
      return;
    }

    const name = args.slice(1).join(' ');
    let lat = null, lng = null, address = '';

    // Search for the place automatically
    ctx.print(`Searching for "${name}"...`, 'dim');
    const results = await TripMap.searchPlaces(name);

    if (results.length > 0) {
      ctx.print('');
      ctx.print('--- Search Results ---', 'info');
      results.forEach(r => {
        const star = r.rating ? ` (${r.rating}★)` : '';
        ctx.print(`  ${r.index}. ${r.name}${star}`, 'success');
        ctx.print(`     ${r.display}`, 'dim');
      });
      ctx.print(`  0. None of these (enter address manually)`, 'dim');
      ctx.print('');

      const choice = await ctx.prompt('Pick a number:');
      const num = parseInt(choice);

      if (num > 0 && num <= results.length) {
        const picked = results[num - 1];
        lat = picked.lat;
        lng = picked.lng;
        address = picked.display;
        ctx.print(`Selected: ${picked.name}`, 'success');
      } else if (num === 0) {
        address = await ctx.prompt('Enter address:') || '';
        if (address) {
          ctx.print('Geocoding...', 'dim');
          const geo = await TripMap.geocode(address);
          if (geo) { lat = geo.lat; lng = geo.lng; }
          else ctx.print('Could not find location.', 'warning');
        }
      } else {
        // Treat invalid input as "pick #1" if they just pressed enter
        if (!choice.trim() && results.length > 0) {
          const picked = results[0];
          lat = picked.lat;
          lng = picked.lng;
          address = picked.display;
          ctx.print(`Selected: ${picked.name}`, 'success');
        } else {
          ctx.print('Invalid choice, skipping location.', 'warning');
        }
      }
    } else {
      ctx.print('No places found.', 'warning');
      address = await ctx.prompt('Enter address manually (or leave empty):') || '';
      if (address) {
        ctx.print('Geocoding...', 'dim');
        const geo = await TripMap.geocode(address);
        if (geo) { lat = geo.lat; lng = geo.lng; }
        else ctx.print('Could not find location.', 'warning');
      }
    }

    let time = '';
    if (category === 'events') {
      time = await ctx.prompt('Date/Time (e.g. "Mar 15 7pm"):') || '';
    } else {
      time = await ctx.prompt('Time (optional):') || '';
    }

    const notes = await ctx.prompt('Notes (optional):') || '';

    const item = DB.addItem({ name, category, address, lat, lng, time, notes });
    if (item) {
      const cat = DB.CATEGORIES[category];
      ctx.print(`+ Added "${name}" to ${cat.label}`, 'success');
      ctx.refresh();
    }
  }, 'Add an item');

  // --- Standalone search command ---
  register('search', async (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: search <query>', 'error');
      ctx.print('Example: search "sushi Tokyo"', 'dim');
      return;
    }
    const query = args.join(' ');
    ctx.print(`Searching for "${query}"...`, 'dim');
    const results = await TripMap.searchPlaces(query, 8);
    if (!results.length) {
      ctx.print('No results found.', 'warning');
      return;
    }
    ctx.print('');
    ctx.print('--- Search Results ---', 'info');
    results.forEach(r => {
      const star = r.rating ? ` (${r.rating}★)` : '';
      ctx.print(`  ${r.index}. ${r.name}${star}`, 'success');
      ctx.print(`     ${r.display}`, 'dim');
    });
    ctx.print('');
    ctx.print('Use "add <category> <name>" to add a place to your trip.', 'dim');
  }, 'Search for a place');

  register('goto', (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: goto <name>', 'error');
      return;
    }
    const query = args.join(' ');
    const matches = DB.findItem(query);
    if (!matches.length) {
      ctx.print(`No item matching "${query}"`, 'error');
      return;
    }
    if (matches.length > 1) {
      ctx.print('Multiple matches:', 'warning');
      matches.forEach(m => ctx.print(`  - ${m.name}`, 'dim'));
      ctx.print('Be more specific.', 'dim');
      return;
    }
    const item = matches[0];
    if (item.lat == null) {
      ctx.print(`"${item.name}" has no location data.`, 'warning');
      return;
    }
    ctx.print(`Flying to ${item.name}...`, 'info');
    TripMap.flyTo(item);
  }, 'Pan map to pin');

  register('rm', (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: rm <name>', 'error');
      return;
    }
    const query = args.join(' ');
    const matches = DB.findItem(query);
    if (!matches.length) {
      ctx.print(`No item matching "${query}"`, 'error');
      return;
    }
    if (matches.length > 1) {
      ctx.print('Multiple matches:', 'warning');
      matches.forEach(m => ctx.print(`  - ${m.name}`, 'dim'));
      ctx.print('Be more specific.', 'dim');
      return;
    }
    const removed = DB.removeItem(matches[0].name);
    if (removed) {
      ctx.print(`- Removed "${removed.name}"`, 'success');
      ctx.refresh();
    }
  }, 'Remove an item');

  register('edit', async (args, ctx) => {
    if (args.length < 3) {
      ctx.print('Usage: edit <name> <field> <value>', 'error');
      ctx.print('Fields: name, address, time, notes, category', 'dim');
      return;
    }
    let itemName = null;
    let field = null;
    let value = null;
    const validFields = ['name', 'address', 'time', 'notes', 'category'];

    for (let i = args.length - 2; i >= 1; i--) {
      if (validFields.includes(args[i].toLowerCase())) {
        itemName = args.slice(0, i).join(' ');
        field = args[i].toLowerCase();
        value = args.slice(i + 1).join(' ');
        break;
      }
    }

    if (!itemName || !field) {
      ctx.print('Could not parse. Usage: edit <name> <field> <value>', 'error');
      return;
    }

    let extra = {};
    if (field === 'address') {
      ctx.print('Geocoding new address...', 'dim');
      const result = await TripMap.geocode(value);
      if (result) {
        extra.lat = result.lat;
        extra.lng = result.lng;
        ctx.print(`Found: ${result.display}`, 'dim');
      } else {
        ctx.print('Could not geocode. Map pin not updated.', 'warning');
      }
    }

    const item = DB.editItem(itemName, field, value);
    if (!item) {
      ctx.print(`No item matching "${itemName}"`, 'error');
      return;
    }

    if (extra.lat != null) {
      DB.editItem(item.name, 'lat', extra.lat);
      DB.editItem(item.name, 'lng', extra.lng);
    }

    ctx.print(`Updated "${item.name}" ${field} = ${value}`, 'success');
    ctx.refresh();
  }, 'Edit an item field');

  // --- Trip commands ---
  register('trip new', (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: trip new <name>', 'error');
      return;
    }
    const name = args.join(' ');
    DB.createTrip(name);
    ctx.print(`Created trip "${name}"`, 'success');
    ctx.refresh();
  }, 'Create a new trip');

  register('trip list', (args, ctx) => {
    const trips = DB.listTrips();
    if (!trips.length) {
      ctx.print('No trips yet. Use "trip new <name>" to create one.', 'dim');
      return;
    }
    ctx.print('');
    ctx.print('--- Your Trips ---', 'info');
    trips.forEach(t => {
      const active = t.active ? ' << active' : '';
      ctx.print(`  ${t.name} (${t.itemCount} items)${active}`);
    });
    ctx.print('');
  }, 'List all trips');

  register('trip load', (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: trip load <name>', 'error');
      return;
    }
    const name = args.join(' ');
    const trip = DB.loadTrip(name);
    if (!trip) {
      ctx.print(`Trip "${name}" not found.`, 'error');
      return;
    }
    ctx.print(`Loaded trip "${trip.name}"`, 'success');
    ctx.refresh();
    TripMap.fitAll();
  }, 'Switch to a trip');

  register('trip delete', (args, ctx) => {
    if (!args.length) {
      ctx.print('Usage: trip delete <name>', 'error');
      return;
    }
    const name = args.join(' ');
    if (DB.deleteTrip(name)) {
      ctx.print(`Deleted trip "${name}"`, 'success');
      ctx.refresh();
    } else {
      ctx.print(`Trip "${name}" not found.`, 'error');
    }
  }, 'Delete a trip');

  register('export', (args, ctx) => {
    const json = DB.exportData();
    if (!json) {
      ctx.print('No active trip to export.', 'warning');
      return;
    }
    const trip = DB.getActiveTrip();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${trip.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ctx.print(`Exported "${trip.name}" as JSON.`, 'success');
  }, 'Download trip as JSON');

  register('import', (args, ctx) => {
    const fileInput = document.getElementById('file-import');
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const name = DB.importData(reader.result);
        if (name) {
          ctx.print(`Imported trip "${name}"`, 'success');
          ctx.refresh();
          TripMap.fitAll();
        } else {
          ctx.print('Invalid trip file.', 'error');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    };
    fileInput.click();
    ctx.print('Select a JSON file to import...', 'dim');
  }, 'Upload JSON file');

  register('satellite', (args, ctx) => {
    const type = TripMap.toggleMapType();
    ctx.print(`Map switched to ${type === 'hybrid' ? 'satellite' : 'roadmap'} view.`, 'success');
  }, 'Toggle satellite view');

  register('theme', (args, ctx) => {
    const valid = ['default', 'ocean', 'sunset'];
    if (!args.length || !valid.includes(args[0].toLowerCase())) {
      ctx.print('Usage: theme <default|ocean|sunset>', 'error');
      return;
    }
    const theme = args[0].toLowerCase();
    DB.setSetting('theme', theme);
    if (theme === 'default') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    ctx.print(`Theme set to ${theme}.`, 'success');
  }, 'Switch color theme');

  register('itinerary', (args, ctx) => {
    const trip = DB.getActiveTrip();
    if (!trip) {
      ctx.print('No active trip.', 'warning');
      return;
    }
    const itinerary = DB.getItinerary();
    const items = DB.getItems();

    // Same parseItemDate logic as app.js
    function parseDate(timeStr) {
      if (!timeStr) return null;
      const s = timeStr.trim();
      const direct = new Date(s);
      if (!isNaN(direct) && direct.getFullYear() > 2000) return direct.toISOString().slice(0, 10);
      const m = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
      if (m) {
        const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        const mon = months[m[1].toLowerCase().slice(0, 3)];
        const day = parseInt(m[2]);
        if (mon !== undefined && day >= 1 && day <= 31) {
          const d = new Date(new Date().getFullYear(), mon, day);
          return d.toISOString().slice(0, 10);
        }
      }
      return null;
    }

    function fmtDate(ds) {
      if (!ds) return 'No Date';
      const d = new Date(ds + 'T12:00:00');
      if (isNaN(d)) return ds;
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    const entries = [];
    itinerary.forEach(item => {
      let dk = item.type === 'flight' ? (item.departureDate || null) : (item.checkIn || null);
      entries.push({ item, dateKey: dk, source: 'itin' });
    });
    items.forEach(item => {
      entries.push({ item, dateKey: parseDate(item.time), source: 'place' });
    });

    const groups = {};
    entries.forEach(e => {
      const k = e.dateKey || '__none__';
      if (!groups[k]) groups[k] = [];
      groups[k].push(e);
    });

    const keys = Object.keys(groups).sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });

    if (!entries.length) {
      ctx.print('Itinerary is empty.', 'dim');
      return;
    }

    let totalCost = 0;
    ctx.print('');
    ctx.print('--- ITINERARY ---', 'info');
    keys.forEach(key => {
      ctx.print('');
      ctx.print(`── ${key === '__none__' ? 'No Date' : fmtDate(key)} ──`, 'info');
      groups[key].forEach(e => {
        const item = e.item;
        const cost = parseFloat(String(item.cost || '').replace(/[^0-9.\-]/g, '')) || 0;
        totalCost += cost;
        const costStr = cost > 0 ? `  $${cost}` : '';
        if (e.source === 'itin' && item.type === 'flight') {
          ctx.print(`  ✈  ${item.departureCity || '?'} → ${item.arrivalCity || '?'}${costStr}`, 'cat-transport');
          const parts = [];
          if (item.airline) parts.push(item.airline + (item.flightNumber ? ' ' + item.flightNumber : ''));
          if (item.departureTime || item.arrivalTime) parts.push((item.departureTime || '') + ' - ' + (item.arrivalTime || ''));
          if (parts.length) ctx.print(`     ${parts.join(' | ')}`, 'dim');
        } else if (e.source === 'itin' && item.type === 'hotel') {
          ctx.print(`  🏨 ${item.name || 'Hotel'}${costStr}`, 'cat-sleeps');
          const parts = [];
          if (item.checkIn && item.checkOut) {
            const nights = Math.round((new Date(item.checkOut + 'T12:00:00') - new Date(item.checkIn + 'T12:00:00')) / 86400000);
            if (nights > 0) parts.push(nights + ' night' + (nights !== 1 ? 's' : ''));
          }
          if (item.confirmationNumber) parts.push('Conf: ' + item.confirmationNumber);
          if (parts.length) ctx.print(`     ${parts.join(' | ')}`, 'dim');
        } else {
          const icons = { eats: '🍴', sleeps: '🛏️', spots: '📍', events: '📅', transport: '🚗' };
          const icon = icons[item.category] || '📌';
          ctx.print(`  ${icon} ${item.name}${costStr}`, `cat-${item.category}`);
          if (item.time) ctx.print(`     ${item.time}`, 'dim');
        }
      });
    });

    if (totalCost > 0) {
      ctx.print('');
      ctx.print(`  Total: $${totalCost.toLocaleString()}`, 'success');
    }
    ctx.print('');
  }, 'Show trip itinerary timeline');

  register('share', async (args, ctx) => {
    if (!DB.isCloudEnabled()) {
      ctx.print('Cloud sync is not active.', 'warning');
      return;
    }
    const url = DB.getShareUrl();
    if (!url) {
      ctx.print('No active trip to share.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      ctx.print('Share link copied to clipboard!', 'success');
    } catch {
      ctx.print('Could not copy automatically.', 'warning');
    }
    ctx.print(url, 'info');
  }, 'Copy share link for current trip');

  return { registry, parse, execute };
})();
