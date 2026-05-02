# POS System

A practical POS starter that runs as:

- Backend: Node.js, Express, PostgreSQL
- Shared UI: React + Vite
- Desktop shell: Electron
- Android path: Capacitor can wrap the same frontend build
- Server database: PostgreSQL, recommended free host is Neon

## Quick Start

Prerequisite: install Node.js LTS, which includes `npm`.

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run dev:desktop
```

Default login:

- Username: `admin`
- Password: `1234`

## Product Features

- Billing with GST, customer phone, payment mode, and print support.
- Product add, edit, and delete from the admin Products screen.
- Admin/staff permissions:
  - Admin: billing, dashboard, products, staff, customers, reports, expenses, exports.
  - Staff: billing, dashboard, customer lookup.
- Customer purchase history for the last six months.
- Daily sales reports with revenue, expenses, net total, and top products.
- Expense tracking with date/category/amount.
- Export reports to Excel `.xlsx` and PDF.

## Environment

Create `backend/.env`:

```env
PORT=5000
JWT_SECRET=change-this-in-production
TAX_RATE=0.18
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
```

Recommended free provider: Neon PostgreSQL.

1. Create a free account at `https://neon.com`.
2. Create a new project.
3. Copy the pooled connection string if Neon shows one, or the normal connection string for small usage.
4. Paste it as `DATABASE_URL` in `backend/.env`.
5. Start the backend once; it will create the POS tables and default admin automatically.

Supabase is also a good free PostgreSQL provider, but Neon is simpler for this app because we only need a database server, not a full backend-as-a-service stack.

## Android

```bash
cd frontend
npm run build
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init pos com.pos.app --web-dir dist
npx cap add android
npx cap copy android
npx cap open android
```

For a real Android deployment, point `VITE_API_URL` at a reachable backend URL instead of `localhost`.

## Windows Installer

After dependencies are installed:

```bash
npm run build:windows
```

The installer will be created under:

```text
electron/dist
```

## Android APK

First build the frontend and create/copy the Android project:

```bash
npm run android:copy
npm run android:open
```

Then in Android Studio:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

For phone testing on the same Wi-Fi, set the backend URL before building:

```env
VITE_API_URL=http://YOUR_PC_IP:5000
```

Put that in `frontend/.env`, then rerun:

```bash
npm run android:copy
```

## Next Production Steps

- Replace demo credentials immediately.
- Add printer-specific receipt templates for 80mm thermal output.
- Add barcode scanner support.
- Add backup/export and restore.
- Add role-based permissions for voids, discounts, and inventory changes.
