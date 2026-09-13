/**
 * Netlify Serverless Function for Neon PostgreSQL Database Persistence
 * High-performance, serverless SQL persistence with authoritative monotonic revision timestamps.
 * Endpoint: /.netlify/functions/db
 */

const DEFAULT_DATABASE_URL = "postgresql://neondb_owner:npg_gDlG7ZTdrXy3@ep-fragrant-block-ayw6rbp2-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || DEFAULT_DATABASE_URL;

let neon = null;
let sql = null;

try {
  const neonPkg = require("@neondatabase/serverless");
  neon = neonPkg.neon;
  if (DATABASE_URL) {
    sql = neon(DATABASE_URL);
  }
} catch (e) {
  console.warn("@neondatabase/serverless not loaded in current environment, using fallback cache:", e.message);
}

// In-memory fallback cache for local dev / offline testing
let localMemoryCache = null;
let tablesInitialized = false;

async function ensureTables() {
  if (!sql || tablesInitialized) return;
  try {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS portal_records (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        data JSONB NOT NULL,
        last_updated BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS portal_meta (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT,
        last_updated BIGINT NOT NULL
      );
    `);
    await sql.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_records_type ON portal_records(type);
    `);
    tablesInitialized = true;
  } catch (err) {
    console.error("Neon table initialization error:", err.message);
  }
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ status: "OK" }) };
  }

  try {
    // --- GET Request: Retrieve all database records ---
    if (event.httpMethod === "GET") {
      let records = null;
      let lastUpdated = 0;
      let storageType = "memory-cache";

      if (sql) {
        try {
          await ensureTables();
          const rows = await sql.query("SELECT data FROM portal_records ORDER BY created_at DESC;");
          records = rows.map(r => r.data);

          const metaRows = await sql.query("SELECT last_updated FROM portal_meta WHERE key = 'db_last_updated';");
          if (metaRows.length > 0 && metaRows[0].last_updated) {
            lastUpdated = parseInt(metaRows[0].last_updated, 10) || 0;
          }
          storageType = "neon-postgres";
        } catch (readErr) {
          console.warn("Could not read from Neon PostgreSQL, checking fallback cache:", readErr.message);
        }
      }

      if (records === null) {
        records = localMemoryCache ? (localMemoryCache.records || []) : [];
        lastUpdated = localMemoryCache ? (localMemoryCache.lastUpdated || 0) : 0;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          records: records || [],
          lastUpdated: lastUpdated || 0,
          storage: storageType,
          timestamp: new Date().toISOString()
        })
      };
    }

    // --- POST Request: Save / Update database records ---
    if (event.httpMethod === "POST") {
      let payload = null;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (parseErr) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid JSON body" })
        };
      }

      let records = [];
      let lastUpdated = Date.now();

      if (Array.isArray(payload)) {
        records = payload;
      } else if (payload && Array.isArray(payload.records)) {
        records = payload.records;
        lastUpdated = payload.lastUpdated || Date.now();
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Expected JSON array of records" })
        };
      }

      const savePayload = {
        records: records,
        lastUpdated: lastUpdated,
        timestamp: new Date().toISOString()
      };

      // Update in-memory fallback cache
      localMemoryCache = savePayload;

      let dbSuccess = false;
      if (sql) {
        try {
          await ensureTables();

          if (records.length === 0) {
            await sql.query("DELETE FROM portal_records;");
          } else {
            const activeIds = records.map(r => r.id);

            // Upsert in batches of 50
            const CHUNK_SIZE = 50;
            for (let i = 0; i < records.length; i += CHUNK_SIZE) {
              const chunk = records.slice(i, i + CHUNK_SIZE);
              const placeholders = [];
              const values = [];
              chunk.forEach((r, idx) => {
                const base = idx * 4;
                placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
                values.push(r.id, r.type || "trainee", JSON.stringify(r), lastUpdated);
              });

              const query = `
                INSERT INTO portal_records (id, type, data, last_updated)
                VALUES ${placeholders.join(", ")}
                ON CONFLICT (id) DO UPDATE
                SET type = EXCLUDED.type, data = EXCLUDED.data, last_updated = EXCLUDED.last_updated, updated_at = NOW();
              `;
              await sql.query(query, values);
            }

            // Remove any records deleted by the user
            if (activeIds.length > 0) {
              await sql.query("DELETE FROM portal_records WHERE id != ALL($1::varchar[]);", [activeIds]);
            }
          }

          // Authoritative timestamp update
          await sql.query(`
            INSERT INTO portal_meta (key, value, last_updated)
            VALUES ('db_last_updated', $1, $2)
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, last_updated = EXCLUDED.last_updated;
          `, [String(lastUpdated), lastUpdated]);

          dbSuccess = true;
        } catch (writeErr) {
          console.error("Could not write to Neon PostgreSQL:", writeErr.message);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          count: records.length,
          lastUpdated: lastUpdated,
          storage: dbSuccess ? "neon-postgres" : "memory-cache",
          timestamp: new Date().toISOString()
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  } catch (err) {
    console.error("Neon Serverless DB Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Internal Server Error" })
    };
  }
};
