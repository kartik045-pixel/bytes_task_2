# MatTime — Gym Slot Booking

A JavaScript full-stack demo for hourly gym sessions, with 20 mats per session, booking codes, a waitlist, automatic promotion after cancellation, live updates, and a staff check-in view.

## Requirements
- Node.js 18+ (20+ recommended)
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (usually http://localhost:5173). The Express API runs on http://localhost:4000.

For a production-style local build:

```bash
npm run build
npm start
```

Then open http://localhost:4000.

## Features
- 12 hourly sessions are created from the current hour.
- Each session has a hard capacity of 20 occupied mats.
- A member can only hold one active booking or waitlist entry per session.
- Confirmed bookings receive an 8-character booking code.
- Full sessions accept waitlist entries and show queue positions.
- Cancelling a confirmed booking promotes the earliest waitlisted member inside a database transaction and assigns a code.
- Socket.IO pushes session changes to connected browsers.
- Staff check-in validates a code and can only use a confirmed booking once.
- SQLite stores bookings in `server/gym.sqlite`.

## Important production work still needed
- Staff authentication and authorization for the check-in endpoints.
- Member authentication or verified ownership for cancellation and booking lookup. The demo identifies a member by email and is not suitable for public deployment as-is.
- Rate limiting, request logging, CSRF/origin policy as appropriate, privacy controls, backup strategy, and deployment configuration.
- Add tests for simultaneous requests and transactional edge cases.

## API
- `GET /api/health`
- `GET /api/sessions`
- `GET /api/members/:email/bookings`
- `POST /api/bookings` with `{ "sessionId", "memberName", "memberEmail" }`
- `POST /api/bookings/:id/cancel`
- `POST /api/check-in` with `{ "code": "A1B2C3D4" }`
- `GET /api/staff/sessions/:id`

## Booking rules
The server is the source of truth. Capacity is computed from bookings in `confirmed` or `checked_in` state. The booking and cancellation endpoints use SQLite transactions; waitlist promotion is part of the same cancellation transaction. The client never decides whether a mat is available.
