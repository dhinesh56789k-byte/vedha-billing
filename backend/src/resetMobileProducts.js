require("dotenv").config();

const { initDb, run, pool } = require("./db");
const mobileProducts = require("./mobileProducts");

async function resetProducts() {
  await initDb();
  await run("DELETE FROM sale_items");
  await run("DELETE FROM sales");
  await run("DELETE FROM products");

  for (const item of mobileProducts) {
    await run("INSERT INTO products (name, category, price, stock) VALUES ($1, $2, $3, $4)", item);
  }

  console.log("Mobile shop products loaded. Sales history was cleared.");
  await pool.end();
}

resetProducts().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
