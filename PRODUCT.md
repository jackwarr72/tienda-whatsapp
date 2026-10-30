# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

FastAPI (Python) backend + static HTML/CSS/JS frontend, SQLite store, uvicorn server on port 3000. Existing; no change requested.

## Users

Store owner (me). Operates the catalog, inventory, orders, and admin panel. Customers are reached through WhatsApp — the storefront is a customer-facing catalog, but the product is the owner's control surface.

## Product Purpose

Tienda WhatsApp: an online storefront for a small retail business. Lets customers browse a product catalog, reserve items ("apartados"), and submit payment receipts (SPEI/OXXO/etc.) for approval. The owner manages inventory, categories, stock movements, orders, payment approvals, customers, roles/permissions, and exports the full store to a 7-tab Excel workbook matching the existing Google Sheet structure.

Success = accurate stock, payments approved quickly, and a catalog that stays publishable to WhatsApp without manual spreadsheet juggling.

## Positioning

A single app that replaces the spreadsheet: catalog, reservations, receipt review, and Excel export in one place, with WhatsApp links generated per product so the owner never hand-builds a sales message.

## Operating Context

- Runs locally via `start.sh` (`python -m uvicorn app:app --host 0.0.0.0 --port 3000`).
- Data lives in `store.db` (SQLite); seeded from `Inventario_Tienda_WhatsApp.xlsx` if present, else defaults.
- Receipts uploaded to `uploads/`; sample receipts generated as PNG on seed.
- Admin access is PIN-based (`admin_pin` config, default `1234`) with optional email credential.
- Export endpoint `/api/export/xlsx` regenerates the 7-tab workbook.

## Capabilities and Constraints

- Catalog: products with id, name, category, price, quantity, size, color, brand, description, photo/video URLs, condition, status, featured, WhatsApp-published flag.
- Availability computed automatically: Oculto > Apartado > (cantidad<=0 or Vendido) > Agotado > Disponible.
- Customer cart and checkout with mode "apartar" (reserve) or "comprar".
- Direct receipt upload form (Step 9) for customers who paid without reserving.
- Admin dashboard, orders/receipts, product editor, stock movement log, customer WhatsApp list, settings and roles.
- Stock deducted on approval; movements logged per change.
- Undecided: whether customers should be able to create accounts / persist carts across sessions.

## Brand Commitments

- Store name: "Mi Tienda WhatsApp" (configurable via `store_name`).
- WhatsApp number: `525512345678` (configurable).
- Brand color: WhatsApp green `#075E54` used as the header/accent throughout.
- Voice: Spanish (es-MX), direct and transactional.

## Evidence on Hand

- `app.py` — FastAPI routes and Pydantic models.
- `database.py` — schema, seeding, availability logic, receipt image generation, Excel export.
- `static/index.html` / `static/app.js` / `static/styles.css` — storefront + admin panel.
- `store.db` — live data.
- `uploads/comprobante_ped001..004.png` — sample receipts.
- Absence: no PRODUCT.md, no DESIGN.md, no analytics, no real customer data.

## Product Principles

- Stock truth is single-source: one availability function, every caller routes through it.
- Keep the spreadsheet export format identical — it is the bridge to the owner's existing workflow.
- Default to the owner's current tooling; don't add frameworks or services without cause.
- Receipts are evidence: approval is a state change with a logged movement, never silent.

## Accessibility & Inclusion

Mobile-first responsive layout with bottom navigation and `viewport-fit=cover`. No formal WCAG commitment established yet.