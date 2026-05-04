require("dotenv").config();

const bcrypt = require("bcryptjs");
const cors = require("cors");
const ExcelJS = require("exceljs");
const express = require("express");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const { all, get, initDb, run, transaction } = require("./db");

const app = express();
const port = Number(process.env.PORT || 5000);
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-me";
const taxRate = Number(process.env.TAX_RATE || 0.18);

app.use(cors());
app.use(express.json());

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

function auth(requiredRoles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    try {
      const user = jwt.verify(token, jwtSecret);
      if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
        return res.status(403).json({ error: "Not allowed" });
      }
      req.user = user;
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await get("SELECT * FROM users WHERE username = $1 AND active = TRUE", [username]);

    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ success: false, error: "Invalid login" });
    }

    res.json({
      success: true,
      token: tokenFor(user),
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/products", auth(), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "1" && req.user.role === "admin";
    const products = await all(
      `SELECT p.*, c.name as category_name, c.parent_id
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${includeInactive ? "" : "WHERE p.active = TRUE"} 
       ORDER BY c.name, p.name`
    );
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.post("/products", auth(), async (req, res, next) => {
  try {
    const { name, category_id, price, stock = 0, low_stock_threshold = 5, location = "" } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: "Product name and price are required" });
    }

    // Fallback if category_id is missing: try to find "General"
    let finalCategoryId = category_id;
    if (!finalCategoryId) {
      const general = await get("SELECT id FROM categories WHERE name = 'General' LIMIT 1");
      finalCategoryId = general ? general.id : null;
    }

    const result = await run(
      `INSERT INTO products (name, category_id, price, stock, low_stock_threshold, location)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name.trim(), finalCategoryId, Number(price), Number(stock), Number(low_stock_threshold), location.trim()]
    );

    const product = await get(
      `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1`, 
      [result.lastID]
    );
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

app.delete("/products/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const current = await get("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!current) return res.status(404).json({ error: "Product not found" });

    await run("UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/categories", auth(), async (req, res, next) => {
  try {
    const categories = await all("SELECT * FROM categories ORDER BY name");
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

app.post("/categories", auth(), async (req, res, next) => {
  try {
    const { name, parent_id = null } = req.body;
    if (!name) return res.status(400).json({ error: "Category name is required" });

    if (parent_id) {
      const parent = await get("SELECT id FROM categories WHERE id = $1", [parent_id]);
      if (!parent) return res.status(400).json({ error: "Parent category not found" });
    }

    const result = await run(
      "INSERT INTO categories (name, parent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
      [name.trim(), parent_id || null]
    );

    const category = result.lastID
      ? await get("SELECT * FROM categories WHERE id = $1", [result.lastID])
      : await get("SELECT * FROM categories WHERE name = $1 AND COALESCE(parent_id, 0) = $2", [name.trim(), parent_id || 0]);

    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

app.delete("/categories/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const current = await get("SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (!current) return res.status(404).json({ error: "Category not found" });

    const general = await get("SELECT id FROM categories WHERE name = 'General' LIMIT 1");
    const generalId = general ? general.id : null;

    // Cascade: reset products in all child categories to General
    const children = await all("SELECT id FROM categories WHERE parent_id = $1", [req.params.id]);
    for (const child of children) {
      await run("UPDATE products SET category_id = $1 WHERE category_id = $2", [generalId, child.id]);
    }
    // Delete child categories
    await run("DELETE FROM categories WHERE parent_id = $1", [req.params.id]);

    // Reset products directly in this category
    await run("UPDATE products SET category_id = $1 WHERE category_id = $2", [generalId, req.params.id]);
    await run("DELETE FROM categories WHERE id = $1", [req.params.id]);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Reassign an existing category to a different parent (or make it top-level)
app.patch("/categories/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const current = await get("SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (!current) return res.status(404).json({ error: "Category not found" });

    const parent_id = req.body.parent_id !== undefined ? req.body.parent_id : current.parent_id;

    if (parent_id) {
      const parent = await get("SELECT id FROM categories WHERE id = $1", [parent_id]);
      if (!parent) return res.status(400).json({ error: "Parent category not found" });
      // Prevent assigning a parent as its own child
      if (parent_id === current.id) return res.status(400).json({ error: "A category cannot be its own parent" });
    }

    await run("UPDATE categories SET parent_id = $1 WHERE id = $2", [parent_id || null, req.params.id]);
    const updated = await get("SELECT * FROM categories WHERE id = $1", [req.params.id]);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});



app.get("/users", auth(["admin"]), async (req, res, next) => {
  try {
    const users = await all("SELECT id, username, role, active, created_at FROM users ORDER BY username");
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post("/users", auth(["admin"]), async (req, res, next) => {
  try {
    const { username, password, role = "staff" } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    if (!["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Role must be admin or staff" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id", [
      username.trim(),
      passwordHash,
      role
    ]);
    const user = await get("SELECT id, username, role, active, created_at FROM users WHERE id = $1", [
      result.lastID
    ]);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

app.patch("/users/:id", auth(["admin"]), async (req, res, next) => {
  try {
    const current = await get("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (!current) return res.status(404).json({ error: "User not found" });

    const role = req.body.role ?? current.role;
    const active = req.body.active ?? current.active;
    if (!["admin", "staff"].includes(role)) {
      return res.status(400).json({ error: "Role must be admin or staff" });
    }

    await run("UPDATE users SET role = $1, active = $2 WHERE id = $3", [
      role,
      Boolean(active),
      req.params.id
    ]);

    if (req.body.password) {
      const passwordHash = await bcrypt.hash(req.body.password, 10);
      await run("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, req.params.id]);
    }

    const user = await get("SELECT id, username, role, active, created_at FROM users WHERE id = $1", [
      req.params.id
    ]);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.patch("/products/:id", auth(), async (req, res, next) => {
  try {
    const current = await get("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!current) return res.status(404).json({ error: "Product not found" });

    const nextProduct = {
      name: req.body.name ?? current.name,
      category_id: req.body.category_id ?? current.category_id,
      price: req.body.price ?? current.price,
      stock: req.body.stock ?? current.stock,
      low_stock_threshold: req.body.low_stock_threshold ?? current.low_stock_threshold,
      location: req.body.location ?? current.location ?? ""
    };

    await run(
      `UPDATE products
       SET name = $1, category_id = $2, price = $3, stock = $4, low_stock_threshold = $5, location = $6, updated_at = NOW()
       WHERE id = $7`,
      [
        nextProduct.name,
        nextProduct.category_id,
        Number(nextProduct.price),
        Number(nextProduct.stock),
        Number(nextProduct.low_stock_threshold),
        nextProduct.location,
        req.params.id
      ]
    );

    res.json(await get(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1`, [req.params.id]));
  } catch (error) {
    next(error);
  }
});

app.get("/low-stock", auth(), async (req, res, next) => {
  try {
    const products = await all(
      "SELECT * FROM products WHERE active = TRUE AND low_stock_threshold > 0 AND stock <= low_stock_threshold ORDER BY stock ASC, name ASC"
    );
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.post("/sales", auth(), async (req, res, next) => {
  const { items = [], customer = "", phone = "", address = "", gstNumber = "", payment_method = "cash" } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  try {
    const sale = await transaction(async (tx) => {
      const saleItems = [];
      for (const item of items) {
        const qty = Number(item.qty);
        if (!Number.isInteger(qty) || qty <= 0) {
          throw new Error(`Invalid quantity for ${item.name || "item"}`);
        }

        const product = item.product_id
          ? await tx.get("SELECT * FROM products WHERE id = $1 AND active = TRUE FOR UPDATE", [item.product_id])
          : await tx.get("SELECT * FROM products WHERE name = $1 AND active = TRUE FOR UPDATE", [item.name]);

        if (!product) {
          throw new Error(`Product not found: ${item.name}`);
        }
        if (product.stock < qty) {
          throw new Error(`Not enough stock for ${product.name}`);
        }

        const discount = Math.max(0, Math.min(Number(item.discount || 0), Number(product.price)));
        const effectivePrice = Number(product.price) - discount;
        saleItems.push({
          product_id: product.id,
          name: product.name,
          qty,
          price: Number(product.price), // Save original base price
          line_total: effectivePrice * qty,
          description: item.description || null,
          cgst: item.cgst !== undefined ? item.cgst : null,
          sgst: item.sgst !== undefined ? item.sgst : null,
          discount: discount
        });
      }

      const cart_sum = saleItems.reduce((sum, item) => sum + item.line_total, 0);
      let subtotal = cart_sum;
      let tax = 0;
      let total = cart_sum;

      if (req.body.tax_mode === "exclusive") {
        tax = Number((cart_sum * 0.18).toFixed(2));
        total = Number((cart_sum + tax).toFixed(2));
      } else if (req.body.tax_mode === "inclusive") {
        const base = cart_sum / 1.18;
        tax = Number((cart_sum - base).toFixed(2));
        total = cart_sum;
      }

      const year = new Date().getFullYear();
      const countRes = await tx.get(
        "SELECT COUNT(*) as count FROM sales WHERE EXTRACT(YEAR FROM created_at) = $1",
        [year]
      );
      const nextNum = parseInt(countRes.count || 0) + 1;
      const bill_number = String(nextNum).padStart(3, '0');

      const saleResult = await tx.run(
        `INSERT INTO sales (bill_number, customer, phone, address, gst_number, subtotal, tax, total, payment_method, tax_mode, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, bill_number`,
        [bill_number, customer.trim(), phone.trim(), address.trim(), gstNumber.trim(), subtotal, tax, total, payment_method, req.body.tax_mode || 'no-tax', req.user.id]
      );

      for (const item of saleItems) {
        await tx.run(
          `INSERT INTO sale_items (sale_id, product_id, name, qty, price, line_total, description, cgst, sgst, discount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [saleResult.lastID, item.product_id, item.name, item.qty, item.price, item.line_total, item.description, item.cgst, item.sgst, item.discount]
        );
        await tx.run("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [
          item.qty,
          item.product_id
        ]);
      }

      return {
        id: saleResult.lastID,
        bill_number: saleResult.rows[0].bill_number,
        customer,
        phone,
        subtotal,
        tax,
        total,
        payment_method,
        items: saleItems
      };
    });

    res.status(201).json({ success: true, sale });
  } catch (error) {
    next(error);
  }
});

app.get("/sales/:id", auth(), async (req, res, next) => {
  try {
    const sale = await get("SELECT * FROM sales WHERE id = $1", [req.params.id]);
    if (!sale) return res.status(404).json({ error: "Sale not found" });

    sale.items = await all("SELECT * FROM sale_items WHERE sale_id = $1", [req.params.id]);
    res.json(sale);
  } catch (error) {
    next(error);
  }
});

app.delete("/sales/:id", auth(["admin"]), async (req, res, next) => {
  try {
    await run("DELETE FROM sales WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/customers/:phone", auth(["admin"]), async (req, res, next) => {
  try {
    const phone = req.params.phone === "-" ? "" : req.params.phone;
    await run("DELETE FROM sales WHERE COALESCE(phone, '') = $1", [phone]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/customers", auth(), async (req, res, next) => {
  try {
    const search = `%${(req.query.search || "").trim()}%`;
    const customers = await all(
      `SELECT
        COALESCE(NULLIF(customer, ''), 'Walk-in') as customer,
        COALESCE(NULLIF(phone, ''), '-') as phone,
        COUNT(*) as visits,
        ROUND(SUM(total), 2) as spend,
        MAX(created_at) as last_visit
       FROM sales
       WHERE created_at >= NOW() - INTERVAL '1 year'
         AND (customer ILIKE $1 OR phone ILIKE $2)
       GROUP BY COALESCE(NULLIF(customer, ''), 'Walk-in'), COALESCE(NULLIF(phone, ''), '-')
       ORDER BY last_visit DESC
       LIMIT 100`,
      [search, search]
    );
    res.json(customers);
  } catch (error) {
    next(error);
  }
});

app.get("/customers/:phone/history", auth(), async (req, res, next) => {
  try {
    const sales = await all(
      `SELECT id, bill_number, customer, phone, subtotal, tax, total, payment_method, tax_mode, created_at
       FROM sales
       WHERE phone = $1 AND created_at >= NOW() - INTERVAL '1 year'
       ORDER BY created_at DESC`,
      [req.params.phone]
    );

    for (const sale of sales) {
      sale.items = await all("SELECT name, qty, price, line_total FROM sale_items WHERE sale_id = $1", [
        sale.id
      ]);
    }

    res.json(sales);
  } catch (error) {
    next(error);
  }
});

// Full transaction detail with items per sale — used by Reports page transaction table
app.get("/reports/transactions", auth(), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const sales = await all(
      `SELECT s.id, s.bill_number, s.customer, s.phone, s.address, s.gst_number,
              s.subtotal, s.tax, s.total, s.payment_method, s.created_at,
              u.username as cashier
       FROM sales s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.created_at::date BETWEEN $1::date AND $2::date
       ORDER BY s.created_at DESC`,
      [from, to]
    );
    if (sales.length > 0) {
      const saleIds = sales.map(s => s.id);
      const items = await all(
        `SELECT sale_id, name, qty, price, line_total
         FROM sale_items WHERE sale_id = ANY($1) ORDER BY sale_id, id`,
        [saleIds]
      );
      const byId = {};
      for (const item of items) {
        if (!byId[item.sale_id]) byId[item.sale_id] = [];
        byId[item.sale_id].push(item);
      }
      for (const sale of sales) sale.items = byId[sale.id] || [];
    }
    res.json(sales);
  } catch (error) {
    next(error);
  }
});

app.get("/expenses", auth(["admin"]), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const expenses = await all(
      `SELECT e.*, u.username as created_by_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.expense_date BETWEEN $1::date AND $2::date
       ORDER BY e.expense_date DESC, e.id DESC`,
      [from, to]
    );
    res.json(expenses);
  } catch (error) {
    next(error);
  }
});

app.post("/expenses", auth(["admin"]), async (req, res, next) => {
  try {
    const { description, category = "General", amount, expense_date } = req.body;
    if (!description || amount === undefined) {
      return res.status(400).json({ error: "Description and amount are required" });
    }

    const result = await run(
      `INSERT INTO expenses (description, category, amount, expense_date, created_by)
       VALUES ($1, $2, $3, $4::date, $5)
       RETURNING id`,
      [description.trim(), category.trim(), Number(amount), expense_date || new Date(), req.user.id]
    );
    res.status(201).json(await get("SELECT * FROM expenses WHERE id = $1", [result.lastID]));
  } catch (error) {
    next(error);
  }
});

app.delete("/expenses/:id", auth(["admin"]), async (req, res, next) => {
  try {
    await run("DELETE FROM expenses WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/reports/daily", auth(), async (req, res, next) => {
  try {
    res.json(await buildReport(req.query));
  } catch (error) {
    next(error);
  }
});

app.get("/exports/:format", auth(["admin"]), async (req, res, next) => {
  try {
    const report = await buildReport(req.query);
    if (req.params.format === "xlsx") {
      return sendExcel(res, report);
    }
    if (req.params.format === "pdf") {
      return sendPdf(res, report);
    }
    return res.status(404).json({ error: "Export format must be xlsx or pdf" });
  } catch (error) {
    next(error);
  }
});

app.get("/dashboard", auth(), async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to = req.query.to || today;

    const dailySales = await all(
      `SELECT to_char(created_at, 'YYYY-MM-DD') as day, ROUND(SUM(total), 2) as total, COUNT(*) as orders
       FROM sales
       WHERE created_at::date BETWEEN $1::date AND $2::date
       GROUP BY to_char(created_at, 'YYYY-MM-DD')
       ORDER BY day ASC`,
      [from, to]
    );

    const summary = await get(
      `SELECT
        COALESCE(ROUND(SUM(total), 2), 0) as revenue,
        COUNT(*) as orders,
        COALESCE(ROUND(AVG(total), 2), 0) as average_order
       FROM sales
       WHERE created_at::date BETWEEN $1::date AND $2::date`,
      [from, to]
    );

    const productsSold = await get(
      `SELECT COALESCE(SUM(si.qty), 0) as total_products
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at::date BETWEEN $1::date AND $2::date`,
      [from, to]
    );
    summary.total_products = productsSold.total_products;

    const paymentSplitRaw = await all(
      `SELECT payment_method, ROUND(SUM(total), 2) as total
       FROM sales
       WHERE created_at::date BETWEEN $1::date AND $2::date
       GROUP BY payment_method`,
      [from, to]
    );
    const paymentSplit = { cash: 0, card: 0, upi: 0 };
    for (const row of paymentSplitRaw) {
      if (paymentSplit[row.payment_method] !== undefined) {
        paymentSplit[row.payment_method] = Number(row.total);
      }
    }

    const lowStock = await all(
      "SELECT * FROM products WHERE active = TRUE AND low_stock_threshold > 0 AND stock <= low_stock_threshold ORDER BY stock ASC LIMIT 8"
    );

    res.json({ summary, paymentSplit, dailySales, lowStock });
  } catch (error) {
    next(error);
  }
});

function dateRange(query) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 30);
  const from = query.from || start.toISOString().slice(0, 10);
  const to = query.to || today.toISOString().slice(0, 10);
  return { from, to };
}

async function buildReport(query) {
  const { from, to } = dateRange(query);
  const sales = await all(
    `SELECT s.*, u.username as cashier
     FROM sales s
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.created_at::date BETWEEN $1::date AND $2::date
     ORDER BY s.created_at DESC`,
    [from, to]
  );

  // Attach items to each sale (single batch query)
  if (sales.length > 0) {
    const saleIds = sales.map(s => s.id);
    const items = await all(
      `SELECT sale_id, name, qty, price, line_total
       FROM sale_items WHERE sale_id = ANY($1) ORDER BY sale_id, id`,
      [saleIds]
    );
    const byId = {};
    for (const item of items) {
      if (!byId[item.sale_id]) byId[item.sale_id] = [];
      byId[item.sale_id].push(item);
    }
    for (const sale of sales) sale.items = byId[sale.id] || [];
  }

  const daily = await all(
    `SELECT created_at::date as day, COUNT(*) as orders, ROUND(SUM(total), 2) as revenue
     FROM sales
     WHERE created_at::date BETWEEN $1::date AND $2::date
     GROUP BY created_at::date
     ORDER BY day`,
    [from, to]
  );
  const expenses = await all(
    `SELECT expense_date, category, description, amount
     FROM expenses
     WHERE expense_date BETWEEN $1::date AND $2::date
     ORDER BY expense_date DESC`,
    [from, to]
  );
  const products = await all(
    `SELECT si.name, SUM(si.qty) as qty, ROUND(SUM(si.line_total), 2) as revenue
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.created_at::date BETWEEN $1::date AND $2::date
     GROUP BY si.name
     ORDER BY revenue DESC`,
    [from, to]
  );

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

  return {
    from,
    to,
    summary: {
      orders: sales.length,
      revenue: Number(revenue.toFixed(2)),
      expenses: Number(expenseTotal.toFixed(2)),
      net: Number((revenue - expenseTotal).toFixed(2))
    },
    daily,
    sales,
    expenses,
    products
  };
}

async function sendExcel(res, report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "POS System";
  workbook.created = new Date();

  // --- Summary tab ---
  const sumSheet = workbook.addWorksheet("Summary");
  [["Report Period", `${report.from} to ${report.to}`],["Total Orders", report.summary.orders],["Total Revenue", report.summary.revenue],["Total Expenses", report.summary.expenses],["Net Profit", report.summary.net]]
    .forEach(([l, v]) => {
      const r = sumSheet.addRow([l, v]);
      r.getCell(1).font = { bold: true, size: 11 };
      if (typeof v === "number") r.getCell(2).numFmt = "\u20b9#,##0.00";
    });
  sumSheet.getColumn(1).width = 20; sumSheet.getColumn(2).width = 22;

  // --- Transaction Details tab (matches on-screen table: one row per bill) ---
  const tx = workbook.addWorksheet("Transaction Details");
  tx.columns = [
    { header: "Invoice #",   key: "bill",     width: 12 },
    { header: "Date & Time", key: "dt",       width: 24 },
    { header: "Customer",    key: "customer", width: 20 },
    { header: "Phone",       key: "phone",    width: 15 },
    { header: "Products",    key: "products", width: 40 },
    { header: "Subtotal",    key: "subtotal", width: 13 },
    { header: "Tax (GST)",   key: "tax",      width: 13 },
    { header: "Total",       key: "total",    width: 13 },
    { header: "Payment",     key: "payment",  width: 12 }
  ];
  // Header row style
  const hdr = tx.getRow(1);
  hdr.height = 26;
  hdr.eachCell(cell => {
    cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FF1E3A5F" } };
    cell.font = { bold:true, color:{ argb:"FFFFFFFF" }, size:10 };
    cell.alignment = { vertical:"middle", horizontal:"center", wrapText:true };
    cell.border = { bottom:{ style:"medium", color:{ argb:"FF2563EB" } } };
  });
  // Data rows
  report.sales.forEach((s, i) => {
    const products = (s.items || []).map(it => `${it.name} x${it.qty}  @  Rs.${Number(it.price).toFixed(2)}`).join("\n");
    const row = tx.addRow({
      bill: `#${s.bill_number || s.id}`,
      dt: new Date(s.created_at).toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:true }),
      customer: s.customer || "Walk-in",
      phone: s.phone || "-",
      products,
      subtotal: Number(s.subtotal),
      tax: Number(s.tax),
      total: Number(s.total),
      payment: s.payment_method
    });
    row.height = Math.max(20, (s.items || []).length * 16);
    const bg = i % 2 === 0 ? "FFF0F4FF" : "FFFFFFFF";
    row.eachCell(cell => {
      cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:bg } };
      cell.font = { size:9 };
      cell.alignment = { vertical:"top", wrapText:true };
      cell.border = { bottom:{ style:"thin", color:{ argb:"FFD1D5DB" } }, right:{ style:"thin", color:{ argb:"FFD1D5DB" } } };
    });
    ["subtotal","tax","total"].forEach(k => {
      const c = row.getCell(k); c.numFmt = "\u20b9#,##0.00"; c.alignment = { horizontal:"right", vertical:"top" };
    });
    row.getCell("bill").font  = { bold:true, color:{ argb:"FF1D4ED8" }, size:9 };
    row.getCell("total").font = { bold:true, color:{ argb:"FF16A34A" }, size:9 };
  });
  tx.views = [{ state:"frozen", ySplit:1 }];

  // --- Supporting tabs ---
  addSheet(workbook, "Daily Sales",     [["Day","Orders","Revenue"], ...report.daily.map(r=>[r.day,r.orders,r.revenue])]);
  addSheet(workbook, "Product Summary", [["Product","Qty Sold","Revenue"], ...report.products.map(p=>[p.name,p.qty,p.revenue])]);
  addSheet(workbook, "Expenses",        [["Date","Category","Description","Amount"], ...report.expenses.map(e=>[e.expense_date,e.category,e.description,e.amount])]);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="pos-report-${report.from}-to-${report.to}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

function addSheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => {
    column.width = 18;
  });
}

function sendPdf(res, report) {
  var doc = new PDFDocument({ margin: 20, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="pos-report-' + report.from + '-to-' + report.to + '.pdf"');
  doc.pipe(res);

  var COLS  = [48, 92, 78, 68, 188, 56, 46, 60, 50];
  var HEADS = ["Invoice #","Date & Time","Customer","Phone","Products","Subtotal","Tax","Total","Payment"];
  var PW    = doc.page.width - 40;

  function tableRow(y, cells, opts) {
    opts = opts || {};
    var H = opts.h || 18;
    if (opts.bg) { doc.rect(20, y, PW, H).fill(opts.bg); }
    doc.strokeColor("#c8d3de").lineWidth(0.3);
    doc.moveTo(20, y).lineTo(20 + PW, y).stroke();
    var x = 20;
    cells.forEach(function(txt, ci) {
      var cw = COLS[ci];
      if (ci > 0) doc.moveTo(x, y).lineTo(x, y + H).stroke();
      var clr = (opts.cc && opts.cc[ci]) ? opts.cc[ci] : (opts.color || "#1e293b");
      doc.fillColor(clr).fontSize(opts.fs || 7.5)
         .text(String(txt || "-"), x + 3, y + 3, {
           width: cw - 6, height: H - 4, ellipsis: true,
           align: ci >= 5 ? "right" : "left"
         });
      x += cw;
    });
    doc.moveTo(20 + PW, y).lineTo(20 + PW, y + H).stroke();
    return y + H;
  }

  doc.fontSize(13).fillColor("#1e293b")
     .text("Transaction Report  |  " + report.from + "  to  " + report.to, 20, 20, { width: PW });
  doc.fontSize(8.5).fillColor("#475569")
     .text("Orders: " + report.summary.orders + "   Revenue: Rs." + Number(report.summary.revenue).toFixed(2) + "   Net: Rs." + Number(report.summary.net).toFixed(2), 20, 36, { width: PW });

  var y = 50;
  y = tableRow(y, HEADS, { bg: "#1e3a5f", color: "#ffffff", fs: 8, h: 20 });

  report.sales.forEach(function(sale, i) {
    var products = (sale.items || [])
      .map(function(it) { return it.name + " x" + it.qty + " @Rs." + Number(it.price).toFixed(2); })
      .join("  |  ");
    var lineH = Math.max(16, Math.ceil(products.length / 26) * 11);

    if (y + lineH > doc.page.height - 25) {
      doc.addPage({ margin: 20, size: "A4", layout: "landscape" });
      y = 20;
      y = tableRow(y, HEADS, { bg: "#1e3a5f", color: "#ffffff", fs: 8, h: 20 });
    }

    var bg = i % 2 === 0 ? "#eef2ff" : "#ffffff";
    var dt = new Date(sale.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
    y = tableRow(y, [
      "#" + (sale.bill_number || sale.id), dt,
      sale.customer || "Walk-in", sale.phone || "-", products,
      "Rs." + Number(sale.subtotal).toFixed(2),
      "Rs." + Number(sale.tax).toFixed(2),
      "Rs." + Number(sale.total).toFixed(2),
      sale.payment_method
    ], { bg: bg, h: lineH, color: "#111827", cc: { 0: "#1d4ed8", 7: "#16a34a" } });
  });

  doc.moveTo(20, y).lineTo(20 + PW, y).lineWidth(0.5).strokeColor("#94a3b8").stroke();
  doc.end();
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Something went wrong" });
});

async function start() {
  await initDb();
  app.listen(port, () => {
    console.log(`Backend running on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = app;
