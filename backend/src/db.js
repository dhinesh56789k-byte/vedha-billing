const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const mobileProducts = require("./mobileProducts");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("DATABASE_URL is not set. Create a free Neon PostgreSQL database and add it to backend/.env.");
}

const needsSsl = databaseUrl && !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1") && !databaseUrl.includes("::1");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000, // 10s timeout
  idleTimeoutMillis: 30000,      // 30s idle timeout
  keepAlive: true                // Keep connection alive for cloud DBs
});


async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function run(sql, params = []) {
  const result = await query(sql, params);
  return {
    rowCount: result.rowCount,
    rows: result.rows,
    lastID: result.rows[0]?.id
  };
}

async function get(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','staff')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await run(`CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
  )`);

  // Remove old global unique constraint if it exists
  await run(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key`);
  
  // Add new unique constraints (Name + Parent must be unique)
  // This allows "Oppo" under "Battery" and "Oppo" under "Combo"
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS categories_name_parent_id_idx ON categories (name, parent_id) WHERE parent_id IS NOT NULL`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS categories_name_parent_null_idx ON categories (name) WHERE parent_id IS NULL`);

  // Add parent_id to existing installs that don't have it yet
  await run(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);

  // Ensure default categories and migrate existing
  await run("INSERT INTO categories (name) VALUES ('General') ON CONFLICT DO NOTHING");


  await run(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    price NUMERIC(12,2) NOT NULL CHECK(price >= 0),
    stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    location TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // Migration: Add category_id if it doesn't exist
  await ensureColumn("products", "category_id", "INTEGER REFERENCES categories(id) ON DELETE SET NULL");

  // Migration: Data mapping (Text category -> ID category)
  // 1. Ensure all text categories exist in categories table
  await run("INSERT INTO categories (name) SELECT DISTINCT category FROM products WHERE category IS NOT NULL ON CONFLICT DO NOTHING");
  // 2. Map existing category text to category_id
  await run(`
    UPDATE products 
    SET category_id = categories.id 
    FROM categories 
    WHERE products.category = categories.name 
      AND products.category_id IS NULL 
      AND categories.parent_id IS NULL
  `);

  await run(`CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    bill_number TEXT,
    customer TEXT,
    phone TEXT,
    subtotal NUMERIC(12,2) NOT NULL,
    tax NUMERIC(12,2) NOT NULL,
    total NUMERIC(12,2) NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await run(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS address TEXT`);
  await run(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS gst_number TEXT`);

  await run(`CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK(qty > 0),
    price NUMERIC(12,2) NOT NULL CHECK(price >= 0),
    line_total NUMERIC(12,2) NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  await ensureColumn("users", "active", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn("products", "active", "BOOLEAN NOT NULL DEFAULT TRUE");
  await ensureColumn("products", "location", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("sales", "bill_number", "TEXT");

  const existingAdmin = await get("SELECT id FROM users WHERE username = $1", ["admin"]);
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("1234", 10);
    await run("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)", [
      "admin",
      passwordHash,
      "admin"
    ]);
  }

  const productCount = await get("SELECT COUNT(*)::int as count FROM products");
  if (productCount.count === 0) {
    for (const item of mobileProducts) {
      await run("INSERT INTO products (name, category, price, stock) VALUES ($1, $2, $3, $4)", item);
    }
  }

  // Ensure any categories from existing products are synced
  await run("INSERT INTO categories (name) SELECT DISTINCT category FROM products WHERE category IS NOT NULL ON CONFLICT DO NOTHING");
}

async function ensureColumn(table, column, definition) {
  const existing = await get(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  if (!existing) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const helpers = {
      run: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return { rowCount: result.rowCount, rows: result.rows, lastID: result.rows[0]?.id };
      },
      get: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows[0];
      },
      all: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows;
      }
    };
    const value = await callback(helpers);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  run,
  get,
  all,
  initDb,
  transaction
};
