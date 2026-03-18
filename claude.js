// claude.js - Claude AI client: conversation history, API calls, tool execution
const ClaudeClient = (() => {
  const API_URL = 'https://api.tripterminal.net';
  const MAX_MESSAGES = 20;

  let conversationHistory = [];
  let lastSuggestions = [];
  let _sending = false;

  // --- Conversation management ---
  function addMessage(role, content) {
    conversationHistory.push({ role, content });
    trimHistory();
  }

  // Trim history safely: drop oldest user+assistant pairs,
  // never orphan tool_use/tool_result sequences, keep first message as user role
  function trimHistory() {
    while (conversationHistory.length > MAX_MESSAGES) {
      // Drop first two messages (a user+assistant pair)
      if (conversationHistory.length >= 2) {
        conversationHistory.splice(0, 2);
      } else {
        conversationHistory.shift();
      }
      // If the new first message is not role 'user', keep dropping until it is
      while (conversationHistory.length > 0 && conversationHistory[0].role !== 'user') {
        conversationHistory.shift();
      }
    }
  }

  function resetConversation() {
    conversationHistory = [];
    lastSuggestions = [];
  }

  // --- Trip context ---
  function getTripContext() {
    const trip = DB.getActiveTrip();
    if (!trip) return { name: null, items: [] };
    return { name: trip.name, items: trip.items };
  }

  // --- Compute trip summary for get_trip_summary tool ---
  function computeTripSummary() {
    const items = DB.getItems();
    const categoryCounts = {};
    let totalCost = 0;
    const dates = [];

    items.forEach(item => {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      const cost = parseFloat(String(item.cost || '').replace(/[^0-9.\-]/g, '')) || 0;
      totalCost += cost;
      if (item.time) dates.push(item.time);
    });

    return {
      itemCount: items.length,
      categoryCounts,
      totalCost: `$${totalCost.toLocaleString()}`,
      dates,
    };
  }

  // --- Execute a single tool call, return tool_result content ---
  async function executeTool(toolName, toolInput) {
    switch (toolName) {
      case 'add_item': {
        const item = DB.addItem({
          name: toolInput.name,
          category: toolInput.category,
          address: toolInput.address || '',
          time: toolInput.time || '',
          cost: toolInput.cost || '',
          notes: toolInput.notes || '',
        });
        if (!item) return { success: false, error: 'No active trip' };

        // Geocode address if provided
        if (toolInput.address && item.lat == null) {
          const geo = await TripMap.geocode(toolInput.address);
          if (geo) {
            DB.editItemById(item.id, { lat: geo.lat, lng: geo.lng });
          }
        }

        App.refresh(); // Show marker immediately (without place_id)

        // Backfill place_id, then refresh again for full Google Places data
        const updatedItem = DB.getItems().find(i => i.id === item.id);
        if (updatedItem) {
          const placeId = await TripMap.findPlaceId(updatedItem);
          if (placeId) {
            DB.editItemById(item.id, { place_id: placeId });
            App.refresh(); // Second refresh with place_id
          }
        }
        return { success: true, item: { id: item.id, name: item.name, category: item.category } };
      }

      case 'suggest_items': {
        lastSuggestions = toolInput.items || [];
        return { success: true, suggestions: lastSuggestions };
      }

      case 'get_trip_summary': {
        return computeTripSummary();
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  // --- Process Claude's response: extract text + handle tool calls ---
  async function processResponse(response) {
    const textParts = [];
    const toolUses = [];

    // Separate text and tool_use content blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUses.push(block);
      }
    }

    // Check for truncation
    let truncated = response.stop_reason === 'max_tokens';

    // If no tool calls, add assistant message to history and we're done
    if (toolUses.length === 0) {
      addMessage('assistant', response.content);
      let text = textParts.join('\n');
      if (truncated) text += '...';
      return { text, suggestions: null, done: true };
    }

    // Execute tool calls and collect results
    const toolResults = [];
    let suggestions = null;

    for (const toolUse of toolUses) {
      const result = await executeTool(toolUse.name, toolUse.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
      if (toolUse.name === 'suggest_items') {
        suggestions = result.suggestions;
      }
    }

    // Add assistant message (with tool_use) to history
    addMessage('assistant', response.content);

    // Add tool results as user message
    addMessage('user', toolResults);

    // Make follow-up API call for Claude's response after tool execution
    const followUp = await callAPI();
    if (followUp.error) {
      return {
        text: textParts.join('\n') || 'Tool executed, but follow-up failed.',
        suggestions,
        done: true,
      };
    }

    // Process follow-up (could have more tool calls, recursively)
    const followUpResult = await processResponse(followUp);
    return {
      text: [textParts.join('\n'), followUpResult.text].filter(Boolean).join('\n'),
      suggestions: suggestions || followUpResult.suggestions,
      done: true,
    };
  }

  // --- Raw API call to the worker ---
  async function callAPI() {
    const payload = {
      messages: conversationHistory,
      tripContext: getTripContext(),
    };

    try {
      const res = await fetch(API_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          return { error: err.error || 'Rate limited. Wait a moment and try again.' };
        }
        return { error: err.error || 'Something went wrong.' };
      }

      return await res.json();
    } catch (err) {
      if (!navigator.onLine) {
        return { error: "You're offline." };
      }
      return { error: 'Could not reach the server.' };
    }
  }

  // --- Main entry point ---
  async function send(userMessage) {
    if (_sending) return { error: 'Already processing a message.' };
    if (!userMessage.trim()) return { error: 'Empty message.' };

    _sending = true;

    try {
      // Add user message to history
      addMessage('user', userMessage);

      // Call API
      const response = await callAPI();

      if (response.error) {
        // Remove the user message we just added since the call failed
        conversationHistory.pop();
        return { error: response.error };
      }

      // Process response (handles tool calls + follow-ups)
      // processResponse() adds assistant messages to history internally
      const result = await processResponse(response);

      return result;
    } finally {
      _sending = false;
    }
  }

  // --- Add a confirmed suggestion as a real item ---
  async function addSuggestion(index) {
    if (index < 0 || index >= lastSuggestions.length) return null;
    const suggestion = lastSuggestions[index];
    const result = await executeTool('add_item', suggestion);
    return result;
  }

  function getLastSuggestions() {
    return lastSuggestions;
  }

  function isSending() {
    return _sending;
  }

  return { send, addSuggestion, getLastSuggestions, resetConversation, isSending };
})();
