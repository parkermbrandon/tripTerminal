# Trip Terminal Data Model Overhaul — Design Spec

## Problem Statement

Trip Terminal's current data scheme uses a flat item array per trip stored in localStorage with optional Firestore sync. This creates practical limits:

- **No structured dates**: Free-text `time` field prevents chronological sorting, day grouping, and multi-day spans
- **localStorage ceiling**: 5-10 MB cap for all trips combined
- **Flat data model**: No relationships between items, no custom categories, no per-person assignment
- **String-based cost**: `"$50"` can't support multi-currency budgeting or numeric aggregation
- **Fragile sync**: Last-write-wins, only active trip syncs, no offline queue
- **No auth**: Can't scale to a public multi-user product

## Solution

Full rewrite as a Next.js monolith backed by PostgreSQL, replacing localStorage/Firestore with a proper relational data model. The terminal UI aesthetic is preserved as a React component.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 15 (App Router), TypeScript | SSR for SEO/sharing, API routes built in, largest ecosystem |
| Database | PostgreSQL via Neon | Serverless Postgres, generous free tier, proper relational model |
| ORM | Drizzle | Type-safe, lightweight, SQL-like syntax, good migration tooling |
| Auth | NextAuth v5 (Auth.js) | Google OAuth to start, database sessions for proper revocation |
| Maps | Google Maps JS API | Already integrated, Places API for rich details |
| AI | Claude via Cloudflare Worker proxy | Existing rate-limited proxy stays, tool calls hit new API routes |
| Deployment | Vercel (app) + Neon (db) + Cloudflare Worker (Claude proxy) | Free tiers for MVP, straightforward scaling path |

## Data Model

### User
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| email | VARCHAR UNIQUE | |
| name | VARCHAR | |
| avatarUrl | VARCHAR | Nullable |
| preferences | JSONB | Nullable, stores theme and other user settings (replaces localStorage settings) |
| createdAt | TIMESTAMPTZ | Default now() |
| updatedAt | TIMESTAMPTZ | Default now() |

### Trip
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR | Required |
| description | TEXT | Nullable |
| startDate | DATE | Nullable |
| endDate | DATE | Nullable |
| defaultCurrency | VARCHAR(3) | Default "USD", ISO 4217 — used when user omits currency on item cost |
| coverImageUrl | VARCHAR | Nullable |
| isPublic | BOOLEAN | Default false |
| createdAt | TIMESTAMPTZ | Default now() |
| updatedAt | TIMESTAMPTZ | Default now() |

### TripMember
| Column | Type | Notes |
|--------|------|-------|
| tripId | UUID FK → Trip | |
| userId | UUID FK → User | |
| role | ENUM('owner','viewer') | Editor role deferred to later phase |
| joinedAt | TIMESTAMPTZ | Default now() |
| PK | (tripId, userId) | Composite |

### Day
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tripId | UUID FK → Trip | |
| date | DATE | Nullable (null = "unscheduled" bucket) |
| label | VARCHAR | Nullable, e.g. "Arrival Day" |
| sortOrder | INTEGER | Tiebreaker only; days with dates sort chronologically first |
| createdAt | TIMESTAMPTZ | Default now() |
| updatedAt | TIMESTAMPTZ | Default now() |

**Ordering rule**: Days with a `date` sort chronologically. Days without a `date` (unscheduled) sort by `sortOrder` and appear at the end.

### Category
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tripId | UUID FK → Trip | Nullable — null = global default |
| slug | VARCHAR | e.g. "eats", "sleeps" |
| label | VARCHAR | e.g. "EATS", "SLEEPS" |
| color | VARCHAR | Hex color, e.g. "#ff6b6b" |
| updatedAt | TIMESTAMPTZ | Default now() |
| UNIQUE | (tripId, slug) | Prevents duplicate slugs within a trip or among globals |

Global defaults (seeded, tripId=null): eats (#ff6b6b), sleeps (#4ecdc4), spots (#ffe66d), events (#a855f7), transport (#4a9ef5).

**Custom category override**: When a trip has a custom category with the same slug as a global default, the trip-level category takes precedence. Resolution: query with `WHERE tripId = :tripId OR tripId IS NULL`, ordered by `tripId NULLS LAST`, deduplicated by slug.

### Item
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| tripId | UUID FK → Trip | |
| dayId | UUID FK → Day | Nullable — null = unscheduled |
| categoryId | UUID FK → Category | |
| name | VARCHAR | Required |
| sortOrder | INTEGER | Within a day |
| address | VARCHAR | Nullable |
| lat | DECIMAL(10,7) | Nullable |
| lng | DECIMAL(10,7) | Nullable |
| placeId | VARCHAR | Nullable, Google Places ID — populated when adding via Places search |
| startTime | TIMESTAMPTZ | Nullable |
| endTime | TIMESTAMPTZ | Nullable, for multi-hour/multi-day spans |
| costAmount | INTEGER | Nullable, stored in cents |
| costCurrency | VARCHAR(3) | Nullable, ISO 4217 — falls back to Trip.defaultCurrency if null |
| notes | TEXT | Nullable |
| createdBy | UUID FK → User | |
| assignedTo | UUID FK → User | Nullable, single assignment for MVP. Multi-person assignment (join table) deferred to later phase. |
| createdAt | TIMESTAMPTZ | Default now() |
| updatedAt | TIMESTAMPTZ | Default now() |

### Key Relationships
- Trip 1→N Day, Trip 1→N Item, Trip 1→N Category
- Day 1→N Item
- User N↔N Trip (via TripMember)
- Category 1→N Item
- User 1→N Item (createdBy), User 1→N Item (assignedTo)

### Indexes
- `Item(tripId, dayId)` — loading a trip's itinerary grouped by day
- `Item(tripId, categoryId)` — category filtering
- `TripMember(userId)` — dashboard "my trips" query
- `Day(tripId, sortOrder)` — ordered day loading
- `Category(tripId, slug)` — category lookup (covered by UNIQUE constraint)

## Architecture

### File Structure
```
src/
  app/
    (auth)/               # Login, signup pages
    dashboard/            # Trip list (authenticated)
    trip/[tripId]/        # Trip view — terminal, map, itinerary
    api/
      trips/              # Trip CRUD
      trips/[tripId]/
        days/             # Day CRUD
        items/            # Item CRUD
        categories/       # Category CRUD
        members/          # Membership management
      auth/               # NextAuth routes
  components/
    terminal/             # Terminal UI — command input, output rendering
    map/                  # Google Maps wrapper
    trip/                 # Trip cards, day view, item cards
  db/
    schema.ts             # Drizzle schema definitions
    migrations/           # SQL migration files
    index.ts              # DB client singleton
  lib/
    auth.ts               # NextAuth v5 config
    claude.ts             # Claude API client
    commands.ts           # Terminal command registry + handlers
    validation.ts         # Zod schemas for API request/response validation
```

### API Conventions
- All API routes use Zod for input validation
- Standard error shape: `{ error: string, code: string, details?: object }`
- Auth check via NextAuth session on every route (except public trip view)
- Rate limiting on write operations via middleware

### Terminal Preservation
- The terminal becomes a `<Terminal />` React component with the same visual style
- `commands.ts` maps the existing command syntax to API-backed handlers
- Commands are async (API calls) with loading indicators
- CSS carries over: monospace font, green-on-black, scanline effects, blinking cursor

#### Preserved Commands
All current commands carry forward:
- **CRUD**: `add`, `rm`, `edit`, `ls`
- **Trip management**: `trip`, `switch`, `share`
- **Data**: `export`, `import`, `itinerary`
- **Map**: `goto`, `search`, `satellite`
- **Utility**: `help`, `clear`, `theme`
- **AI**: `ask` (Claude chat)

### New UI Surfaces
- **Dashboard**: Trip cards with summary stats (item count, date range, collaborator avatars)
- **Day-by-day view**: Visual itinerary alongside the terminal, read-oriented
- **Share page**: Public read-only trip view, SSR for SEO and link previews

## Auth & Multi-tenancy

### Authentication
- Google OAuth via NextAuth v5 (MVP)
- Database-backed sessions in Postgres
- Unauthenticated users can view public/shared trips (read-only)

### Authorization
- Every API route checks TripMember for the authenticated user
- Roles: owner (full control), viewer (read-only). Editor role deferred.
- Share links: `/trip/[tripId]?invite=[token]` — clicking joins as viewer
- Public trips: `/trip/[tripId]` — viewable by anyone

### Data Isolation
- All queries scoped by tripId + membership check
- Row-level filtering in Drizzle queries

## Migration Strategy

### Field Mapping (current → new)
| Current field | New column | Transformation |
|---------------|-----------|----------------|
| item.name | Item.name | Direct copy |
| item.category | Item.categoryId | Look up global default Category by slug |
| item.address | Item.address | Direct copy |
| item.lat | Item.lat | Direct copy |
| item.lng | Item.lng | Direct copy |
| item.time | Item.startTime | Best-effort parse to TIMESTAMPTZ, null on failure |
| item.cost | Item.costAmount + Item.costCurrency | Parse "$50" → 5000 + "USD", null on failure |
| item.notes | Item.notes | Direct copy |
| item.place_id | Item.placeId | Direct copy (field exists in current data, populated by geocoding) |
| item.id | — | New UUID generated; old ID not preserved |
| settings.theme | User.preferences.theme | Stored in JSONB preferences column |

### Migration Flow
A one-time migration page that:

1. Reads the `tripTerminal` localStorage blob
2. User signs in / creates account on the new system
3. Uploads each trip to Postgres via API:
   - Creates a single "Unscheduled" day per trip (date=null), assigns all items there
   - Parses cost strings ("$50") → costAmount: 5000, costCurrency: "USD"
   - Best-effort parses time strings into startTime timestamps (fallback to null)
   - Maps existing 5 categories to global default Category rows
   - Copies placeId if present (null otherwise)
4. Fetches Firestore data if connected — same transformation
5. Shows success/failure per trip with retry

Old site stays live during transition with a banner pointing to the new version.

## MVP Scope

### In
- Postgres schema (all entities defined above)
- Google OAuth
- Trip CRUD via terminal + API
- Day entity + assign items to days
- Structured cost (integer cents + ISO currency code + per-trip default currency)
- Custom categories per trip (with global default override)
- Google Maps with markers
- Claude chat via existing Cloudflare Worker proxy
- Share link (viewer role)
- Migration page from localStorage/Firestore
- Dashboard (trip list)
- Day-by-day read view
- User preferences (theme) stored in database
- Zod validation on all API routes
- All existing terminal commands preserved

### Out (Later Phases)
- Real-time collaborative editing (SSE / Liveblocks)
- Email magic link + additional auth providers
- Drag-and-drop day/item reordering
- Multi-day span items (endTime usage)
- Budget dashboards and currency conversion
- Category icons/emoji
- Route planning between map markers
- Claude writing directly to Postgres via tool calls
- Editor role and granular permissions
- Multi-person item assignment (ItemAssignment join table)
- Trip search, filtering, sorting on dashboard
- Visual timeline/calendar view
- Soft delete (deletedAt) on Trip and Item
