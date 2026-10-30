import os
import uuid
import sqlite3
import datetime
import urllib.parse
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import (
    BASE_DIR,
    UPLOADS_DIR,
    SEED_XLSX_PATH,
    init_db,
    get_conn,
    compute_disponibilidad,
    build_whatsapp_product_link,
    next_id,
    export_db_to_xlsx,
)

init_db()

app = FastAPI(title="Tienda WhatsApp - Catálogo, Apartados y Admin")

STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _today_str() -> str:
    return datetime.date(2026, 10, 30).strftime("%Y-%m-%d")


def _clean_phone(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 10:
        return digits
    if len(digits) == 12 and digits.startswith("52"):
        return digits[2:]
    return digits


def _wa_phone(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 10:
        return "52" + digits
    return digits


def _enrich_product(row: sqlite3.Row | dict, wa_num: str) -> Dict[str, Any]:
    p = dict(row)
    p["disponibilidad"] = compute_disponibilidad(int(p["cantidad"]), str(p["estado"]))
    p["whatsapp_link"] = build_whatsapp_product_link(wa_num, p)
    return p


def _get_config_map(conn) -> Dict[str, str]:
    return {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM config").fetchall()}


# ========================== PYDANTIC MODELS ==========================

class CartItemIn(BaseModel):
    producto_id: str
    cantidad: int = 1


class CheckoutIn(BaseModel):
    nombre: str
    apellidos: Optional[str] = ""
    telefono: str
    email: Optional[str] = ""
    modo: str = "apartar"  # "apartar" | "comprar"
    metodo_pago: str = "Transferencia SPEI"
    comprobante_url: Optional[str] = ""
    notas: Optional[str] = ""
    items: List[CartItemIn]


class ReceiptSubmitIn(BaseModel):
    nombre: str
    telefono: str
    order_id: Optional[str] = ""
    producto_nombre: Optional[str] = ""
    monto: Optional[float] = 0.0
    metodo_pago: str = "Transferencia SPEI"
    comprobante_url: str
    notas: Optional[str] = ""


class AdminLoginIn(BaseModel):
    credential: str  # PIN or Email


class ProductIn(BaseModel):
    nombre: str
    categoria: str
    precio: float
    cantidad: int
    talla: Optional[str] = ""
    color: Optional[str] = ""
    marca: Optional[str] = ""
    descripcion: Optional[str] = ""
    foto_url: Optional[str] = ""
    video_url: Optional[str] = ""
    condicion: Optional[str] = "Nuevo"
    estado: Optional[str] = "Disponible"
    destacado: Optional[str] = "No"
    publicado_wa: Optional[str] = "No"


class StockAdjustIn(BaseModel):
    cambio: int
    tipo: str = "Ajuste de Inventario"
    motivo: Optional[str] = ""


class OrderUpdateIn(BaseModel):
    accion: Optional[str] = None  # "aprobar_pago" | "rechazar_pago" | "marcar_listo" | "marcar_entregado" | "cancelar"
    estado_pago: Optional[str] = None
    estado_pedido: Optional[str] = None
    notas: Optional[str] = None


class ConfigUpdateIn(BaseModel):
    store_name: Optional[str] = None
    whatsapp_number: Optional[str] = None
    glide_url: Optional[str] = None
    bank_name: Optional[str] = None
    bank_holder: Optional[str] = None
    bank_clabe: Optional[str] = None
    oxxo_card: Optional[str] = None
    pickup_info: Optional[str] = None
    admin_pin: Optional[str] = None


class CategoryIn(BaseModel):
    nombre: str
    imagen_url: Optional[str] = ""
    activa: Optional[str] = "Sí"


class UserIn(BaseModel):
    nombre: str
    email: str
    rol: str = "Vendedor"
    whatsapp: Optional[str] = ""
    activo: str = "Sí"
    permisos: Optional[str] = ""


# ========================== PUBLIC ENDPOINTS ==========================

@app.get("/")
def serve_spa():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/bootstrap")
def api_bootstrap():
    conn = get_conn()
    cfg = _get_config_map(conn)
    wa_num = cfg.get("whatsapp_number", "525512345678")

    # Public config (omit admin_pin)
    pub_cfg = {k: v for k, v in cfg.items() if k != "admin_pin"}

    raw_prods = conn.execute("SELECT * FROM products ORDER BY destacado DESC, fecha_alta DESC, id ASC").fetchall()
    all_prods = [_enrich_product(r, wa_num) for r in raw_prods]
    public_prods = [p for p in all_prods if p["disponibilidad"] != "Oculto"]

    raw_cats = conn.execute("SELECT * FROM categories ORDER BY orden ASC, id ASC").fetchall()
    categories = []
    for c in raw_cats:
        cd = dict(c)
        cname = cd["nombre"]
        cat_prods = [p for p in public_prods if p["categoria"] == cname]
        cd["productos_registrados"] = len(cat_prods)
        cd["unidades_disponibles"] = sum(int(p["cantidad"]) for p in cat_prods if p["disponibilidad"] == "Disponible")
        categories.append(cd)

    pending_count = conn.execute("SELECT COUNT(*) FROM orders WHERE estado_pago = 'Pendiente'").fetchone()[0]
    conn.close()

    return {
        "config": pub_cfg,
        "categories": categories,
        "products": public_prods,
        "pending_orders_badge": pending_count,
    }


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".mp4", ".webm", ".mov"}
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Formato no permitido ({ext}). Usa imagen (JPG, PNG, WEBP), PDF o video MP4.")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo supera el límite de 25 MB.")

    safe_name = f"{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(UPLOADS_DIR, safe_name)
    with open(dest, "wb") as f:
        f.write(content)

    return {"url": f"/uploads/{safe_name}", "filename": safe_name}


@app.post("/api/orders/checkout")
def api_checkout(payload: CheckoutIn):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Tu carrito de compra/apartado está vacío.")
    nombre_clean = payload.nombre.strip()
    tel_clean = _clean_phone(payload.telefono)
    if not nombre_clean or len(tel_clean) < 8:
        raise HTTPException(status_code=400, detail="Ingresa tu nombre y un teléfono / WhatsApp válido (10 dígitos).")

    conn = get_conn()
    try:
        cfg = _get_config_map(conn)
        wa_num = cfg.get("whatsapp_number", "525512345678")
        today = _today_str()

        # Validate all items first
        validated_items = []
        cats_bought = set()
        for item in payload.items:
            row = conn.execute("SELECT * FROM products WHERE id = ?", (item.producto_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no encontrado.")
            prod = dict(row)
            disp = compute_disponibilidad(prod["cantidad"], prod["estado"])
            if disp != "Disponible" or prod["cantidad"] < item.cantidad or item.cantidad <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Lo sentimos, '{prod['nombre']}' solo tiene {prod['cantidad']} pieza(s) disponible(s) en este momento."
                )
            validated_items.append((prod, item.cantidad))
            cats_bought.add(prod["categoria"])

        # Upsert Customer
        cust_row = conn.execute(
            "SELECT * FROM customers WHERE telefono = ? OR whatsapp = ?",
            (tel_clean, _wa_phone(tel_clean))
        ).fetchone()

        full_name = f"{nombre_clean} {(payload.apellidos or '').strip()}".strip()
        if cust_row:
            cid = cust_row["id"]
            existing_cats = set(x.strip() for x in (cust_row["categorias_interes"] or "").split(",") if x.strip())
            merged_cats = ", ".join(sorted(existing_cats | cats_bought))
            conn.execute(
                "UPDATE customers SET ultimo_pedido = ?, categorias_interes = ? WHERE id = ?",
                (today, merged_cats, cid)
            )
        else:
            cid = next_id(conn, "customers", "C", 3)
            parts = nombre_clean.split(" ", 1)
            f_name = parts[0]
            l_name = (payload.apellidos or "").strip() or (parts[1] if len(parts) > 1 else "")
            full_name = f"{f_name} {l_name}".strip()
            conn.execute(
                """
                INSERT INTO customers
                (id, nombre, apellidos, telefono, whatsapp, email, categorias_interes, fecha_registro, ultimo_pedido, estado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo')
                """,
                (cid, f_name, l_name, tel_clean, _wa_phone(tel_clean), (payload.email or "").strip(),
                 ", ".join(sorted(cats_bought)), today, today)
            )

        created_orders = []
        grand_total = 0.0

        for prod, qty in validated_items:
            oid = next_id(conn, "orders", "PED-", 3)
            unit_price = float(prod["precio"])
            line_total = unit_price * qty
            grand_total += line_total

            has_receipt = bool((payload.comprobante_url or "").strip())
            est_pago = "Pendiente"
            est_pedido = "Nuevo" if (payload.modo == "comprar" and has_receipt) else "Apartado"
            nota_txt = (payload.notas or "").strip() or (
                "Comprobante adjunto al crear pedido" if has_receipt else "Apartado desde la tienda web, pendiente de comprobante"
            )

            conn.execute(
                """
                INSERT INTO orders
                (id, fecha, cliente_id, cliente_nombre, telefono, producto_id, producto_nombre,
                 cantidad, precio_unitario, total, metodo_pago, comprobante_url, estado_pago, estado_pedido, notas, stock_deducted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    oid, today, cid, full_name, tel_clean, prod["id"], prod["nombre"],
                    qty, unit_price, line_total, payload.metodo_pago,
                    (payload.comprobante_url or "").strip(), est_pago, est_pedido, nota_txt
                )
            )

            # Deduct stock & update product state if last unit reserved
            prev_qty = int(prod["cantidad"])
            new_qty = prev_qty - qty
            new_estado = "Apartado" if new_qty == 0 else prod["estado"]
            conn.execute(
                "UPDATE products SET cantidad = ?, estado = ? WHERE id = ?",
                (new_qty, new_estado, prod["id"])
            )

            # Log Inventory Movement
            mid = next_id(conn, "movements", "M", 3)
            mov_tipo = "Apartado" if not has_receipt else "Venta"
            conn.execute(
                """
                INSERT INTO movements
                (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (mid, today, prod["id"], prod["nombre"], mov_tipo, -qty, prev_qty, new_qty, f"Orden web ({oid})")
            )

            created_orders.append({
                "id": oid,
                "producto_id": prod["id"],
                "producto_nombre": prod["nombre"],
                "cantidad": qty,
                "precio_unitario": unit_price,
                "total": line_total,
                "estado_pago": est_pago,
                "estado_pedido": est_pedido,
                "comprobante_url": (payload.comprobante_url or "").strip(),
            })

        conn.commit()

        folios_str = ", ".join(o["id"] for o in created_orders)
        items_summary = ", ".join(f"{o['cantidad']}x {o['producto_nombre']}" for o in created_orders)
        wa_msg = (
            f"¡Hola! Soy {full_name}. Acabo de registrar mi pedido ({folios_str}): "
            f"{items_summary} por un total de ${grand_total:,.2f} MXN ({payload.metodo_pago})."
        )
        wa_confirm_url = f"https://wa.me/{_wa_phone(wa_num)}?text={urllib.parse.quote(wa_msg)}"

        return {
            "success": True,
            "orders": created_orders,
            "grand_total": grand_total,
            "whatsapp_confirm_url": wa_confirm_url,
            "customer_id": cid,
        }
    finally:
        conn.close()


@app.get("/api/orders/lookup")
def api_lookup_orders(q: str = Query(..., min_length=2)):
    term = q.strip()
    tel_digits = _clean_phone(term)
    conn = get_conn()
    if term.upper().startswith("PED") or term.upper().startswith("O"):
        rows = conn.execute(
            "SELECT * FROM orders WHERE UPPER(id) = UPPER(?) ORDER BY fecha DESC, id DESC",
            (term,)
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT * FROM orders
            WHERE telefono LIKE ? OR UPPER(id) = UPPER(?) OR LOWER(cliente_nombre) LIKE LOWER(?)
            ORDER BY id DESC
            """,
            (f"%{tel_digits if len(tel_digits) >= 4 else term}%", term, f"%{term}%")
        ).fetchall()
    conn.close()
    return {"orders": [dict(r) for r in rows]}


@app.post("/api/receipts/submit")
def api_submit_receipt(payload: ReceiptSubmitIn):
    if not payload.comprobante_url.strip():
        raise HTTPException(status_code=400, detail="Por favor sube la imagen o captura de tu comprobante de pago.")
    tel_clean = _clean_phone(payload.telefono)
    if not payload.nombre.strip() or len(tel_clean) < 8:
        raise HTTPException(status_code=400, detail="Ingresa tu nombre y teléfono a 10 dígitos.")

    conn = get_conn()
    try:
        today = _today_str()
        oid_input = (payload.order_id or "").strip().upper()
        existing = None
        if oid_input:
            existing = conn.execute("SELECT * FROM orders WHERE UPPER(id) = ?", (oid_input,)).fetchone()

        if existing:
            oid = existing["id"]
            new_note = (payload.notas or "").strip()
            merged_note = f"{existing['notas']} | Comprobante subido ({today}) {new_note}".strip(" |")
            conn.execute(
                """
                UPDATE orders
                SET comprobante_url = ?, metodo_pago = ?, estado_pago = 'Pendiente', notas = ?
                WHERE id = ?
                """,
                (payload.comprobante_url.strip(), payload.metodo_pago, merged_note, oid)
            )
            conn.commit()
            updated = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (oid,)).fetchone())
            return {"success": True, "mode": "updated", "order": updated}
        else:
            # Create a new order record for receipts from direct WhatsApp chats
            oid = next_id(conn, "orders", "PED-", 3)
            cust = conn.execute("SELECT id FROM customers WHERE telefono = ?", (tel_clean,)).fetchone()
            cid = cust["id"] if cust else next_id(conn, "customers", "C", 3)
            if not cust:
                conn.execute(
                    """
                    INSERT INTO customers (id, nombre, apellidos, telefono, whatsapp, fecha_registro, ultimo_pedido, estado)
                    VALUES (?, ?, '', ?, ?, ?, ?, 'Activo')
                    """,
                    (cid, payload.nombre.strip(), tel_clean, _wa_phone(tel_clean), today, today)
                )

            p_name = (payload.producto_nombre or "Compra directa por WhatsApp").strip()
            amt = float(payload.monto or 0)
            conn.execute(
                """
                INSERT INTO orders
                (id, fecha, cliente_id, cliente_nombre, telefono, producto_id, producto_nombre,
                 cantidad, precio_unitario, total, metodo_pago, comprobante_url, estado_pago, estado_pedido, notas, stock_deducted)
                VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?, ?, ?, 'Pendiente', 'Nuevo', ?, 0)
                """,
                (
                    oid, today, cid, payload.nombre.strip(), tel_clean, p_name,
                    amt, amt, payload.metodo_pago, payload.comprobante_url.strip(),
                    (payload.notas or "Comprobante enviado desde formulario directo").strip()
                )
            )
            conn.commit()
            created = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (oid,)).fetchone())
            return {"success": True, "mode": "created", "order": created}
    finally:
        conn.close()


# ========================== ADMIN ENDPOINTS ==========================

@app.post("/api/admin/login")
def api_admin_login(payload: AdminLoginIn):
    cred = payload.credential.strip()
    conn = get_conn()
    cfg = _get_config_map(conn)
    pin = cfg.get("admin_pin", "1234")

    if cred == pin:
        conn.close()
        return {"success": True, "user": {"nombre": "Administrador Principal", "rol": "Admin", "email": "admin@mitienda.com"}}

    u = conn.execute(
        "SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND activo = 'Sí'",
        (cred,)
    ).fetchone()
    conn.close()
    if u and u["rol"] in ("Admin", "Vendedor"):
        return {"success": True, "user": dict(u)}

    raise HTTPException(status_code=401, detail="PIN o correo de administrador incorrecto.")


@app.get("/api/admin/overview")
def api_admin_overview():
    conn = get_conn()
    cfg = _get_config_map(conn)
    wa_num = cfg.get("whatsapp_number", "525512345678")

    products = [_enrich_product(r, wa_num) for r in conn.execute("SELECT * FROM products ORDER BY id DESC").fetchall()]
    orders = [dict(r) for r in conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()]
    movements = [dict(r) for r in conn.execute("SELECT * FROM movements ORDER BY id DESC").fetchall()]
    categories = [dict(r) for r in conn.execute("SELECT * FROM categories ORDER BY orden ASC, id ASC").fetchall()]
    users = [dict(r) for r in conn.execute("SELECT * FROM users ORDER BY id ASC").fetchall()]

    # Customers with live aggregated totals
    raw_custs = conn.execute("SELECT * FROM customers ORDER BY id DESC").fetchall()
    customers = []
    for c in raw_custs:
        cd = dict(c)
        cid = cd["id"]
        cust_orders = [o for o in orders if o["cliente_id"] == cid or o["telefono"] == cd["telefono"]]
        cd["nombre_completo"] = f"{cd['nombre']} {cd['apellidos']}".strip()
        cd["total_pedidos"] = len(cust_orders)
        cd["total_comprado"] = sum(float(o["total"]) for o in cust_orders if o["estado_pago"] == "Aprobado")
        cd["chat_wa"] = f"https://wa.me/{_wa_phone(cd['whatsapp'] or cd['telefono'])}"
        customers.append(cd)

    # Category enrichment
    for cat in categories:
        cname = cat["nombre"]
        c_prods = [p for p in products if p["categoria"] == cname]
        cat["productos_registrados"] = len(c_prods)
        cat["unidades_disponibles"] = sum(int(p["cantidad"]) for p in c_prods if p["disponibilidad"] == "Disponible")
        cat["valor_stock"] = sum(float(p["precio"]) * int(p["cantidad"]) for p in c_prods if p["disponibilidad"] == "Disponible")

    # Executive KPIs (exact match to Dashboard sheet)
    kpis = {
        "total_productos": len(products),
        "disponibles": sum(1 for p in products if p["disponibilidad"] == "Disponible"),
        "apartados": sum(1 for p in products if p["disponibilidad"] == "Apartado"),
        "agotados": sum(1 for p in products if p["disponibilidad"] == "Agotado"),
        "ocultos": sum(1 for p in products if p["disponibilidad"] == "Oculto"),
        "unidades_stock": sum(int(p["cantidad"]) for p in products if p["disponibilidad"] == "Disponible"),
        "valor_inventario": sum(float(p["precio"]) * int(p["cantidad"]) for p in products if p["disponibilidad"] == "Disponible"),
        "pendientes_wa_status": sum(1 for p in products if p["publicado_wa"] == "No" and p["disponibilidad"] == "Disponible"),
        "pagos_pendientes": sum(1 for o in orders if o["estado_pago"] == "Pendiente"),
        "monto_pendiente": sum(float(o["total"]) for o in orders if o["estado_pago"] == "Pendiente"),
        "ventas_aprobadas": sum(float(o["total"]) for o in orders if o["estado_pago"] == "Aprobado"),
        "total_pedidos": len(orders),
        "total_clientes": len(customers),
    }

    conn.close()
    return {
        "config": cfg,
        "kpis": kpis,
        "products": products,
        "orders": orders,
        "customers": customers,
        "movements": movements,
        "categories": categories,
        "users": users,
    }


@app.post("/api/admin/products")
def api_create_product(payload: ProductIn):
    conn = get_conn()
    pid = next_id(conn, "products", "P", 3)
    today = _today_str()
    qty = max(0, int(payload.cantidad))
    estado = payload.estado or ("Agotado" if qty == 0 else "Disponible")
    if estado == "Agotado":
        estado = "Vendido"

    conn.execute(
        """
        INSERT INTO products
        (id, nombre, categoria, precio, cantidad, talla, color, marca, descripcion,
         foto_url, video_url, condicion, estado, fecha_alta, destacado, publicado_wa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid, payload.nombre.strip(), payload.categoria.strip(), float(payload.precio), qty,
            (payload.talla or "").strip(), (payload.color or "").strip(), (payload.marca or "").strip(),
            (payload.descripcion or "").strip(), (payload.foto_url or "").strip(), (payload.video_url or "").strip(),
            payload.condicion or "Nuevo", estado, today, payload.destacado or "No", payload.publicado_wa or "No"
        )
    )

    if qty > 0:
        mid = next_id(conn, "movements", "M", 3)
        conn.execute(
            """
            INSERT INTO movements (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
            VALUES (?, ?, ?, ?, 'Entrada de Mercancía', ?, 0, ?, 'Alta inicial de producto')
            """,
            (mid, today, pid, payload.nombre.strip(), qty, qty)
        )

    conn.commit()
    cfg = _get_config_map(conn)
    row = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return {"success": True, "product": _enrich_product(row, cfg.get("whatsapp_number", ""))}


@app.put("/api/admin/products/{product_id}")
def api_update_product(product_id: str, payload: ProductIn):
    conn = get_conn()
    old = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if not old:
        conn.close()
        raise HTTPException(status_code=404, detail="Producto no encontrado.")

    prev_qty = int(old["cantidad"])
    new_qty = max(0, int(payload.cantidad))
    diff = new_qty - prev_qty

    conn.execute(
        """
        UPDATE products
        SET nombre=?, categoria=?, precio=?, cantidad=?, talla=?, color=?, marca=?, descripcion=?,
            foto_url=?, video_url=?, condicion=?, estado=?, destacado=?, publicado_wa=?
        WHERE id=?
        """,
        (
            payload.nombre.strip(), payload.categoria.strip(), float(payload.precio), new_qty,
            (payload.talla or "").strip(), (payload.color or "").strip(), (payload.marca or "").strip(),
            (payload.descripcion or "").strip(), (payload.foto_url or "").strip(), (payload.video_url or "").strip(),
            payload.condicion or "Nuevo", payload.estado or "Disponible",
            payload.destacado or "No", payload.publicado_wa or "No", product_id
        )
    )

    if diff != 0:
        mid = next_id(conn, "movements", "M", 3)
        mov_tipo = "Entrada de Mercancía" if diff > 0 else "Ajuste de Inventario"
        conn.execute(
            """
            INSERT INTO movements (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Edición desde Panel Admin')
            """,
            (mid, _today_str(), product_id, payload.nombre.strip(), mov_tipo, diff, prev_qty, new_qty)
        )

    conn.commit()
    cfg = _get_config_map(conn)
    row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    conn.close()
    return {"success": True, "product": _enrich_product(row, cfg.get("whatsapp_number", ""))}


@app.post("/api/admin/products/{product_id}/stock")
def api_adjust_stock(product_id: str, payload: StockAdjustIn):
    conn = get_conn()
    prod = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if not prod:
        conn.close()
        raise HTTPException(status_code=404, detail="Producto no encontrado.")

    prev_qty = int(prod["cantidad"])
    new_qty = max(0, prev_qty + int(payload.cambio))
    actual_diff = new_qty - prev_qty

    new_estado = prod["estado"]
    if new_qty == 0 and new_estado == "Disponible":
        new_estado = "Vendido"
    elif new_qty > 0 and new_estado in ("Vendido", "Apartado"):
        new_estado = "Disponible"

    conn.execute("UPDATE products SET cantidad = ?, estado = ? WHERE id = ?", (new_qty, new_estado, product_id))

    if actual_diff != 0:
        mid = next_id(conn, "movements", "M", 3)
        conn.execute(
            """
            INSERT INTO movements (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mid, _today_str(), product_id, prod["nombre"],
                payload.tipo or ("Entrada de Mercancía" if actual_diff > 0 else "Venta"),
                actual_diff, prev_qty, new_qty,
                (payload.motivo or "Ajuste rápido de stock en Panel Admin").strip()
            )
        )
    conn.commit()
    cfg = _get_config_map(conn)
    updated = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    conn.close()
    return {"success": True, "product": _enrich_product(updated, cfg.get("whatsapp_number", ""))}


@app.patch("/api/admin/products/{product_id}/toggle-wa")
def api_toggle_wa_posted(product_id: str):
    conn = get_conn()
    prod = conn.execute("SELECT publicado_wa FROM products WHERE id = ?", (product_id,)).fetchone()
    if not prod:
        conn.close()
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    new_val = "No" if prod["publicado_wa"] == "Sí" else "Sí"
    conn.execute("UPDATE products SET publicado_wa = ? WHERE id = ?", (new_val, product_id))
    conn.commit()
    conn.close()
    return {"success": True, "publicado_wa": new_val}


@app.delete("/api/admin/products/{product_id}")
def api_delete_product(product_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.patch("/api/admin/orders/{order_id}")
def api_update_order(order_id: str, payload: OrderUpdateIn):
    conn = get_conn()
    ord_row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not ord_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Pedido no encontrado.")

    o = dict(ord_row)
    today = _today_str()
    est_pago = payload.estado_pago or o["estado_pago"]
    est_ped = payload.estado_pedido or o["estado_pedido"]
    notas = payload.notas if payload.notas is not None else o["notas"]
    stock_deducted = int(o["stock_deducted"])
    pid = o["producto_id"]
    qty = int(o["cantidad"])

    if payload.accion == "aprobar_pago":
        est_pago = "Aprobado"
        if est_ped in ("Nuevo", "Apartado"):
            est_ped = "Pagado"
        # Finalize product inventory
        if pid:
            prod = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            if prod:
                prev_q = int(prod["cantidad"])
                if stock_deducted == 0:
                    new_q = max(0, prev_q - qty)
                    new_est = "Vendido" if new_q == 0 else "Disponible"
                    conn.execute("UPDATE products SET cantidad = ?, estado = ? WHERE id = ?", (new_q, new_est, pid))
                    mid = next_id(conn, "movements", "M", 3)
                    conn.execute(
                        """
                        INSERT INTO movements (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
                        VALUES (?, ?, ?, ?, 'Venta', ?, ?, ?, ?)
                        """,
                        (mid, today, pid, prod["nombre"], -qty, prev_q, new_q, f"Pago aprobado ({order_id})")
                    )
                    stock_deducted = 1
                else:
                    # Already deducted when reserved; flip Apartado -> Vendido if 0 left
                    if prev_q == 0 and prod["estado"] == "Apartado":
                        conn.execute("UPDATE products SET estado = 'Vendido' WHERE id = ?", (pid,))

    elif payload.accion in ("rechazar_pago", "cancelar"):
        est_pago = "Rechazado" if payload.accion == "rechazar_pago" else o["estado_pago"]
        est_ped = "Cancelado"
        # Restore stock if previously deducted or reserved
        if pid:
            prod = conn.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
            if prod:
                prev_q = int(prod["cantidad"])
                if stock_deducted == 1:
                    new_q = prev_q + qty
                    conn.execute("UPDATE products SET cantidad = ?, estado = 'Disponible' WHERE id = ?", (new_q, pid))
                    mid = next_id(conn, "movements", "M", 3)
                    conn.execute(
                        """
                        INSERT INTO movements (id, fecha, producto_id, producto_nombre, tipo, cambio, cantidad_anterior, nueva_cantidad, motivo)
                        VALUES (?, ?, ?, ?, 'Devolución', ?, ?, ?, ?)
                        """,
                        (mid, today, pid, prod["nombre"], qty, prev_q, new_q, f"Liberación de apartado ({order_id})")
                    )
                    stock_deducted = 0
                elif prod["estado"] == "Apartado":
                    conn.execute("UPDATE products SET estado = 'Disponible' WHERE id = ?", (pid,))

    elif payload.accion == "marcar_listo":
        est_ped = "Listo para Entrega"
    elif payload.accion == "marcar_entregado":
        est_ped = "Entregado"

    conn.execute(
        """
        UPDATE orders
        SET estado_pago = ?, estado_pedido = ?, notas = ?, stock_deducted = ?
        WHERE id = ?
        """,
        (est_pago, est_ped, notas, stock_deducted, order_id)
    )
    conn.commit()
    updated = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
    conn.close()
    return {"success": True, "order": updated}


@app.post("/api/admin/categories")
def api_create_category(payload: CategoryIn):
    conn = get_conn()
    cid = next_id(conn, "categories", "CAT", 3)
    max_ord = conn.execute("SELECT COALESCE(MAX(orden), 0) FROM categories").fetchone()[0]
    try:
        conn.execute(
            "INSERT INTO categories (id, nombre, imagen_url, activa, orden) VALUES (?, ?, ?, ?, ?)",
            (cid, payload.nombre.strip(), (payload.imagen_url or "").strip(), payload.activa or "Sí", max_ord + 1)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Esa categoría ya existe.")
    conn.close()
    return {"success": True}


@app.put("/api/admin/categories/{cat_id}")
def api_update_category(cat_id: str, payload: CategoryIn):
    conn = get_conn()
    conn.execute(
        "UPDATE categories SET nombre = ?, imagen_url = ?, activa = ? WHERE id = ?",
        (payload.nombre.strip(), (payload.imagen_url or "").strip(), payload.activa or "Sí", cat_id)
    )
    conn.commit()
    conn.close()
    return {"success": True}


@app.put("/api/admin/config")
def api_update_config(payload: ConfigUpdateIn):
    conn = get_conn()
    updates = payload.model_dump(exclude_none=True)
    for k, v in updates.items():
        val = str(v).strip()
        if k == "whatsapp_number":
            val = "".join(ch for ch in val if ch.isdigit())
        conn.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (k, val))
    conn.commit()
    cfg = _get_config_map(conn)
    conn.close()
    return {"success": True, "config": cfg}


@app.post("/api/admin/users")
def api_create_user(payload: UserIn):
    conn = get_conn()
    uid = next_id(conn, "users", "U", 3)
    try:
        conn.execute(
            "INSERT INTO users (id, nombre, email, rol, whatsapp, activo, permisos) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, payload.nombre.strip(), payload.email.strip(), payload.rol,
             (payload.whatsapp or "").strip(), payload.activo, (payload.permisos or "").strip())
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Ese correo ya está registrado.")
    conn.close()
    return {"success": True}


@app.delete("/api/admin/users/{user_id}")
def api_delete_user(user_id: str):
    conn = get_conn()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.get("/api/export/xlsx")
def api_export_xlsx():
    out_file = os.path.join(BASE_DIR, "Inventario_Exportado.xlsx")
    export_db_to_xlsx(out_file)
    return FileResponse(
        out_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="Inventario_Tienda_WhatsApp.xlsx",
    )
