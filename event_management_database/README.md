# Event Management Database (MongoDB)

This folder contains the MongoDB setup for the Event Management application, including a database viewer and an initialization script that creates collections, validators, and indexes.

## Connection

See db_connection.txt for an example connection command. The startup.sh script also writes db_visualizer/mongodb.env with useful variables:
- MONGODB_URL
- MONGODB_DB

## Initialize Collections and Indexes

After MongoDB is running (startup.sh or an existing instance), run:

```bash
# Using the app user and default values written by startup.sh
mongosh "mongodb://appuser:dbuser123@localhost:5000/myapp?authSource=admin" init_db.js
```

This creates or updates these collections with JSON schema validation and indexes:
- users
- events
- rsvps
- attendees

The script is idempotent and safe to re-run.

## Collections Overview

- users
  - Unique email index, status and createdAt indexes.
  - Fields: email, name, passwordHash, roles, status, timestamps, avatarUrl.

- events
  - Organizer and time-based indexes, visibility and status indexes, text index on title/description.
  - Fields: title, description, organizerId, location, startTime, endTime, tags, visibility, capacity, status, timestamps.

- rsvps
  - Unique per (eventId, userId), status filter and recency.
  - Fields: eventId, userId, status (yes|no|maybe|waitlist), guests, note, timestamps.

- attendees
  - Materialized attendee list for fast retrieval and check-ins, unique per (eventId, userId).
  - Fields: eventId, userId, attendeeStatus (confirmed|waitlisted|checked_in|cancelled), checkInAt, snapshot name/email, timestamps.

## Notes

- Do not hardcode secrets in code; use environment variables as provided by startup.sh.
- The backend container should use env vars MONGODB_URL and MONGODB_DB to connect.
