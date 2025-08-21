/// MongoDB initialization script for event management database
/// Creates collections: users, events, rsvps, attendees
/// Applies JSON schema validation and creates indexes to support queries

/**
 PUBLIC_INTERFACE
 Run with:
   mongosh "mongodb://appuser:dbuser123@localhost:5000/myapp?authSource=admin" init_db.js

 This script is idempotent: it can be safely re-run; it uses createCollection with validators and creates indexes with createIndexes.
*/

(function () {
  const dbName = "myapp";
  const dbRef = db.getSiblingDB(dbName);

  function ensureCollection(name, options) {
    const exists = dbRef.getCollectionNames().includes(name);
    if (!exists) {
      dbRef.createCollection(name, options || {});
      print(`✓ Created collection: ${name}`);
    } else if (options && options.validator) {
      // Try to update validator if collection exists
      try {
        dbRef.runCommand({
          collMod: name,
          validator: options.validator,
          validationLevel: options.validationLevel || "moderate",
          validationAction: options.validationAction || "error",
        });
        print(`✓ Updated validator for: ${name}`);
      } catch (e) {
        print(`! Could not update validator for ${name}: ${e.message}`);
      }
    } else {
      print(`• Collection exists: ${name}`);
    }
  }

  // Users collection
  ensureCollection("users", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["email", "name", "passwordHash", "createdAt", "updatedAt"],
        additionalProperties: true,
        properties: {
          _id: { bsonType: "objectId" },
          email: {
            bsonType: "string",
            description: "User email (unique, lowercased)",
            pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
          },
          name: { bsonType: "string", minLength: 1, description: "Display name" },
          passwordHash: { bsonType: "string", description: "BCrypt/Argon2 hash" },
          avatarUrl: { bsonType: ["string", "null"] },
          roles: {
            bsonType: "array",
            items: { bsonType: "string" },
            description: "Roles like 'admin', 'organizer', 'user'",
          },
          status: { enum: ["active", "disabled"], description: "Account status" },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
          lastLoginAt: { bsonType: ["date", "null"] },
        },
      },
    },
    validationLevel: "moderate",
    validationAction: "error",
  });

  dbRef.users.createIndexes([
    { key: { email: 1 }, name: "uniq_email", unique: true },
    { key: { status: 1 }, name: "status_idx" },
    { key: { createdAt: -1 }, name: "users_createdAt_desc" },
  ]);

  // Events collection
  ensureCollection("events", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "title",
          "description",
          "startTime",
          "endTime",
          "organizerId",
          "visibility",
          "capacity",
          "createdAt",
          "updatedAt",
        ],
        additionalProperties: true,
        properties: {
          _id: { bsonType: "objectId" },
          title: { bsonType: "string", minLength: 1 },
          description: { bsonType: "string" },
          organizerId: { bsonType: "objectId", description: "Ref to users._id" },
          location: {
            bsonType: "object",
            additionalProperties: true,
            properties: {
              name: { bsonType: "string" },
              address: { bsonType: "string" },
              lat: { bsonType: ["double", "decimal", "int", "long"] },
              lng: { bsonType: ["double", "decimal", "int", "long"] },
            },
          },
          startTime: { bsonType: "date" },
          endTime: { bsonType: "date" },
          tags: { bsonType: "array", items: { bsonType: "string" } },
          visibility: { enum: ["public", "private", "unlisted"] },
          capacity: { bsonType: "int", minimum: 0 },
          status: { enum: ["draft", "published", "cancelled"] },
          coverImageUrl: { bsonType: ["string", "null"] },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
        },
      },
    },
    validationLevel: "moderate",
    validationAction: "error",
  });

  dbRef.events.createIndexes([
    { key: { organizerId: 1, startTime: -1 }, name: "organizer_startTime_idx" },
    { key: { startTime: 1 }, name: "startTime_asc" },
    { key: { endTime: 1 }, name: "endTime_asc" },
    { key: { visibility: 1, startTime: 1 }, name: "visibility_start_idx" },
    { key: { status: 1 }, name: "status_idx" },
    { key: { tags: 1 }, name: "tags_idx" },
    // Useful for text search on title/description
    { key: { title: "text", description: "text" }, name: "text_title_description" },
  ]);

  // RSVPs collection (user responses to event)
  ensureCollection("rsvps", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["eventId", "userId", "status", "createdAt", "updatedAt"],
        additionalProperties: true,
        properties: {
          _id: { bsonType: "objectId" },
          eventId: { bsonType: "objectId", description: "Ref to events._id" },
          userId: { bsonType: "objectId", description: "Ref to users._id" },
          status: { enum: ["yes", "no", "maybe", "waitlist"] },
          note: { bsonType: ["string", "null"] },
          guests: { bsonType: "int", minimum: 0, description: "Number of extra guests" },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
        },
      },
    },
    validationLevel: "moderate",
    validationAction: "error",
  });

  dbRef.rsvps.createIndexes([
    { key: { eventId: 1, userId: 1 }, name: "uniq_event_user", unique: true },
    { key: { eventId: 1, status: 1 }, name: "event_status_idx" },
    { key: { userId: 1, updatedAt: -1 }, name: "user_recent_idx" },
    { key: { createdAt: -1 }, name: "rsvp_createdAt_desc" },
  ]);

  // Attendees collection (materialized attendee list per event)
  // This allows faster attendee list queries and check-ins independent of RSVP updates.
  ensureCollection("attendees", {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["eventId", "userId", "attendeeStatus", "createdAt", "updatedAt"],
        additionalProperties: true,
        properties: {
          _id: { bsonType: "objectId" },
          eventId: { bsonType: "objectId", description: "Ref to events._id" },
          userId: { bsonType: "objectId", description: "Ref to users._id" },
          attendeeStatus: { enum: ["confirmed", "waitlisted", "checked_in", "cancelled"] },
          checkInAt: { bsonType: ["date", "null"] },
          // Snapshot fields to avoid joins for common UI
          userName: { bsonType: ["string", "null"] },
          userEmail: { bsonType: ["string", "null"] },
          createdAt: { bsonType: "date" },
          updatedAt: { bsonType: "date" },
        },
      },
    },
    validationLevel: "moderate",
    validationAction: "error",
  });

  dbRef.attendees.createIndexes([
    { key: { eventId: 1, userId: 1 }, name: "uniq_event_user", unique: true },
    { key: { eventId: 1, attendeeStatus: 1 }, name: "event_attendeeStatus_idx" },
    { key: { eventId: 1, checkInAt: -1 }, name: "event_checkIn_desc" },
    { key: { userId: 1, updatedAt: -1 }, name: "user_attendance_recent_idx" },
  ]);

  // Soft delete pattern indexes (if used later)
  // Example: { isDeleted: false }
  ["users", "events", "rsvps", "attendees"].forEach((col) => {
    try {
      dbRef[col].createIndex({ isDeleted: 1 }, { name: `${col}_isDeleted_idx` });
    } catch (e) {
      // ignore
    }
  });

  print("✓ MongoDB initialization complete.");
})();
