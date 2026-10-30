(() => {
  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#f1f5f9"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="16" font-weight="600">Sin imagen</text>
      </svg>`
    );

  const state = {
    config: {},
    categories: [],
    products: [],
    pendingBadge: 0,

    // Storefront UI state
    activeTab: "home",
    searchQuery: "",
    quickFilter: "disponibles", // disponibles | todos | destacados | apartados
    selectedCategory: "",
    sortBy: "featured",

    // Cart state
    cart: JSON.parse(localStorage.getItem("tw_cart") || "[]"),
    checkoutMode: "apartar", // apartar | comprar
    checkoutReceiptUrl: "",
    checkoutReceiptName: "",
    lastCheckoutSuccess: null,

    // Customer Orders Lookup & Direct Receipt
    lookedUpOrders: [],
    directReceiptUrl: "",
    directReceiptName: "",

    // Admin state
    isAdminView: false,
    adminUser: JSON.parse(localStorage.getItem("tw_admin_user") || "null"),
    adminTab: "dashboard",
    adminData: null,
    adminOrderFilter: "todos",
    adminProductFilter: "todos",
    adminProductSearch: "",
  };

  // ==================== UTILITIES ====================
  const fmtMXN = (n) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
    }).format(Number(n || 0));

  const esc = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const statusClass = (st) => {
    if (!st) return "status-Oculto";
    if (st.startsWith("Listo")) return "status-Listo";
    return `status-${st.replace(/\s+/g, "")}`;
  };

  function toast(msg, type = "default") {
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: opts.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Ocurrió un error al procesar la solicitud.");
    }
    return data;
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);
    return api("/api/upload", { method: "POST", body: fd });
  }

  function saveCart() {
    localStorage.setItem("tw_cart", JSON.stringify(state.cart));
    updateCartBadge();
  }

  function updateCartBadge() {
    const count = state.cart.reduce((acc, it) => acc + it.cantidad, 0);
    document.getElementById("cartCountBadge").textContent = String(count);
  }

  function copyText(txt, label = "Texto") {
    navigator.clipboard.writeText(txt).then(
      () => toast(`${label} copiado al portapapeles`, "success"),
      () => toast(`No se pudo copiar automáticamente: ${txt}`)
    );
  }

  // ==================== BOOTSTRAP ====================
  async function loadBootstrap() {
    try {
      const data = await api("/api/bootstrap");
      state.config = data.config || {};
      state.categories = data.categories || [];
      state.products = data.products || [];
      state.pendingBadge = data.pending_orders_badge || 0;

      // Sync cart quantities against current stock
      state.cart = state.cart
        .map((c) => {
          const p = state.products.find((x) => x.id === c.id);
          if (!p || p.disponibilidad !== "Disponible" || p.cantidad <= 0) return null;
          return { ...c, cantidad: Math.min(c.cantidad, p.cantidad), precio: p.precio, nombre: p.nombre, foto_url: p.foto_url, max: p.cantidad, talla: p.talla };
        })
        .filter(Boolean);
      saveCart();

      renderHeader();
      renderStorefront();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderHeader() {
    document.getElementById("headerStoreName").textContent = state.config.store_name || "Mi Tienda WhatsApp";
    document.title = `${state.config.store_name || "Mi Tienda WhatsApp"} — Catálogo y Apartados`;

    const badge = document.getElementById("adminPendingBadge");
    if (state.pendingBadge > 0) {
      badge.textContent = String(state.pendingBadge);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }

    const adminBtn = document.getElementById("toggleAdminBtn");
    const adminTxt = document.getElementById("adminBtnText");
    if (state.isAdminView) {
      adminBtn.classList.add("active-mode");
      adminTxt.textContent = "Ver Tienda";
    } else {
      adminBtn.classList.remove("active-mode");
      adminTxt.textContent = "Panel Admin";
    }
  }

  // ==================== STOREFRONT RENDERING ====================
  function renderStorefront() {
    renderHomeCategoryStrip();
    renderHomeProducts();
    renderCategoriesTab();
    renderArrivalsTab();
    renderOrdersBankBox();
    renderContactTab();
  }

  function getFilteredHomeProducts() {
    let list = [...state.products];

    if (state.selectedCategory) {
      list = list.filter((p) => p.categoria === state.selectedCategory);
    }

    if (state.quickFilter === "disponibles") {
      list = list.filter((p) => p.disponibilidad === "Disponible");
    } else if (state.quickFilter === "destacados") {
      list = list.filter((p) => p.destacado === "Sí");
    } else if (state.quickFilter === "apartados") {
      list = list.filter((p) => p.disponibilidad === "Apartado");
    }

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          (p.marca || "").toLowerCase().includes(q) ||
          (p.categoria || "").toLowerCase().includes(q) ||
          (p.talla || "").toLowerCase().includes(q) ||
          (p.descripcion || "").toLowerCase().includes(q)
      );
    }

    if (state.sortBy === "price_asc") {
      list.sort((a, b) => a.precio - b.precio);
    } else if (state.sortBy === "price_desc") {
      list.sort((a, b) => b.precio - a.precio);
    } else if (state.sortBy === "newest") {
      list.sort((a, b) => (b.fecha_alta + b.id).localeCompare(a.fecha_alta + a.id));
    } else {
      // featured first, then available first
      list.sort((a, b) => {
        const fa = a.destacado === "Sí" ? 1 : 0;
        const fb = b.destacado === "Sí" ? 1 : 0;
        if (fb !== fa) return fb - fa;
        const da = a.disponibilidad === "Disponible" ? 1 : 0;
        const db = b.disponibilidad === "Disponible" ? 1 : 0;
        return db - da;
      });
    }

    return list;
  }

  function renderHomeCategoryStrip() {
    const strip = document.getElementById("homeCategoryStrip");
    const activeCats = state.categories.filter((c) => c.activa === "Sí");
    const totalAvail = state.products.filter((p) => p.disponibilidad === "Disponible").length;

    let html = `<button type="button" class="cat-pill ${!state.selectedCategory ? "active" : ""}" data-cat="">
      Todas <span class="cat-pill-count">${totalAvail}</span>
    </button>`;

    for (const c of activeCats) {
      html += `<button type="button" class="cat-pill ${state.selectedCategory === c.nombre ? "active" : ""}" data-cat="${esc(c.nombre)}">
        ${esc(c.nombre)} <span class="cat-pill-count">${c.unidades_disponibles}</span>
      </button>`;
    }
    strip.innerHTML = html;

    strip.querySelectorAll(".cat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedCategory = btn.dataset.cat || "";
        renderHomeCategoryStrip();
        renderHomeProducts();
      });
    });

    const banner = document.getElementById("activeCategoryBanner");
    if (state.selectedCategory) {
      document.getElementById("activeCategoryTitle").textContent = state.selectedCategory;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  function productCardHTML(p) {
    const isAvail = p.disponibilidad === "Disponible" && p.cantidad > 0;
    const stockLabel = isAvail
      ? p.cantidad === 1
        ? "¡Última pieza!"
        : `${p.cantidad} disponibles`
      : p.disponibilidad;

    const specs = [p.talla ? `Talla ${p.talla}` : "", p.color || ""].filter(Boolean).join(" · ");
    const hasVideo = Boolean(p.video_url && p.video_url.trim());

    return `
      <article class="product-card" data-pid="${esc(p.id)}">
        <div class="product-media" data-open-detail="${esc(p.id)}">
          <img src="${esc(p.foto_url || FALLBACK_IMG)}" alt="${esc(p.nombre)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" />
          <div class="media-badges-top">
            <span class="status-badge ${statusClass(p.disponibilidad)}">${esc(p.disponibilidad)}</span>
            ${p.destacado === "Sí" ? `<span class="featured-tag">Destacado</span>` : ""}
          </div>
          ${
            hasVideo
              ? `<span class="video-pill">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Video
                </span>`
              : ""
          }
        </div>
        <div class="product-body">
          <div class="product-meta-line">
            <span>${esc(p.categoria)}</span>
            <span class="num">${esc(p.id)}</span>
          </div>
          <h3 class="product-title" data-open-detail="${esc(p.id)}">${esc(p.nombre)}</h3>
          ${specs ? `<div class="product-specs">${esc(specs)}</div>` : ""}
          <div class="product-price-row">
            <span class="product-price">${fmtMXN(p.precio)}</span>
            <span class="product-stock-hint">${esc(stockLabel)}</span>
          </div>
          <div class="product-actions">
            <button type="button" class="btn-card-reserve" data-add-cart="${esc(p.id)}" ${!isAvail ? "disabled" : ""}>
              ${isAvail ? "Apartar / Agregar" : p.disponibilidad === "Apartado" ? "Apartado" : "Agotado"}
            </button>
            <a href="${esc(p.whatsapp_link)}" target="_blank" rel="noopener" class="btn-card-wa" title="Preguntar por WhatsApp" aria-label="Enviar WhatsApp">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              </svg>
            </a>
          </div>
        </div>
      </article>
    `;
  }

  function bindProductGridEvents(container) {
    container.querySelectorAll("[data-open-detail]").forEach((el) => {
      el.addEventListener("click", () => openProductDetailModal(el.dataset.openDetail));
    });
    container.querySelectorAll("[data-add-cart]").forEach((btn) => {
      btn.addEventListener("click", () => addToCart(btn.dataset.addCart, 1));
    });
  }

  function renderHomeProducts() {
    const grid = document.getElementById("homeProductsGrid");
    const items = getFilteredHomeProducts();
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <h3>No encontramos productos con ese filtro</h3>
        <p>Prueba cambiando el filtro a "Todo el catálogo" o seleccionando otra categoría.</p>
      </div>`;
      return;
    }
    grid.innerHTML = items.map(productCardHTML).join("");
    bindProductGridEvents(grid);
  }

  function renderCategoriesTab() {
    const grid = document.getElementById("categoriesCardsGrid");
    const activeCats = state.categories.filter((c) => c.activa === "Sí");
    grid.innerHTML = activeCats
      .map(
        (c) => `
      <div class="category-card" data-pick-cat="${esc(c.nombre)}">
        <img src="${esc(c.imagen_url || FALLBACK_IMG)}" alt="${esc(c.nombre)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" />
        <div class="category-card-overlay">
          <h3>${esc(c.nombre)}</h3>
          <span>${c.unidades_disponibles} pza(s) disponible(s) · ${c.productos_registrados} modelo(s)</span>
        </div>
      </div>
    `
      )
      .join("");

    grid.querySelectorAll("[data-pick-cat]").forEach((card) => {
      card.addEventListener("click", () => {
        state.selectedCategory = card.dataset.pickCat;
        state.quickFilter = "todos";
        syncQuickFilterChips();
        switchCustomerTab("home");
        renderHomeCategoryStrip();
        renderHomeProducts();
      });
    });
  }

  function renderArrivalsTab() {
    const grid = document.getElementById("arrivalsProductsGrid");
    const sorted = [...state.products].sort((a, b) => (b.fecha_alta + b.id).localeCompare(a.fecha_alta + a.id));
    grid.innerHTML = sorted.map(productCardHTML).join("");
    bindProductGridEvents(grid);
  }

  function renderOrdersBankBox() {
    const box = document.getElementById("ordersBankSummary");
    const clabe = state.config.bank_clabe || "012180001234567890";
    const oxxo = state.config.oxxo_card || "4152 3138 9900 1234";
    const bank = state.config.bank_name || "BBVA México";
    box.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;color:var(--brand-dark)">Datos para Transferencia o Depósito (${esc(bank)}):</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px">
        <span><strong>CLABE SPEI:</strong> <span class="num">${esc(clabe)}</span></span>
        <button type="button" class="btn-ghost-sm" id="copyClabeQuickBtn">Copiar CLABE</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin-top:4px">
        <span><strong>Tarjeta OXXO:</strong> <span class="num">${esc(oxxo)}</span></span>
        <button type="button" class="btn-ghost-sm" id="copyOxxoQuickBtn">Copiar Tarjeta</button>
      </div>
    `;
    box.querySelector("#copyClabeQuickBtn")?.addEventListener("click", () => copyText(clabe, "CLABE"));
    box.querySelector("#copyOxxoQuickBtn")?.addEventListener("click", () => copyText(oxxo, "Tarjeta OXXO"));
  }

  function renderContactTab() {
    const el = document.getElementById("contactSectionContent");
    const wa = (state.config.whatsapp_number || "525512345678").replace(/\D/g, "");
    const waUrl = `https://wa.me/${wa}?text=${encodeURIComponent("¡Hola! Quiero pedir informes sobre el catálogo de la tienda.")}`;
    const clabe = state.config.bank_clabe || "012180001234567890";
    const oxxo = state.config.oxxo_card || "4152 3138 9900 1234";

    el.innerHTML = `
      <div class="panel-card">
        <div class="card-head">
          <h2>Atención Directa por WhatsApp</h2>
          <p>¿Tienes dudas sobre tallas, medidas o envíos? Escríbenos directo y te atendemos de inmediato.</p>
        </div>
        <p style="font-size:0.9rem;color:var(--text-secondary)">
          <strong>Entregas y envíos:</strong><br/>
          ${esc(state.config.pickup_info || "Entregas personales y envíos a todo México.")}
        </p>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
          <a href="${waUrl}" target="_blank" rel="noopener" class="btn-wa btn-block">
            Enviar Mensaje por WhatsApp (+${esc(wa)})
          </a>
          <button type="button" class="btn-outline btn-block" id="shareStoreLinkBtn">
            Copiar Enlace de la Tienda para Compartir
          </button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-head">
          <h2>Cuentas Oficiales de Pago</h2>
          <p>Al realizar tu pago, conserva tu captura o ticket y súbelo en la pestaña <strong>Mis Pedidos</strong>.</p>
        </div>
        <div style="font-size:0.86rem;color:var(--text-secondary);margin-bottom:8px">
          <strong>Banco:</strong> ${esc(state.config.bank_name || "BBVA México")} ·
          <strong>Titular:</strong> ${esc(state.config.bank_holder || "Mi Tienda Retail")}
        </div>
        <div class="copy-row">
          <div>
            <div style="font-size:0.74rem;color:var(--text-muted)">CLABE Interbancaria (SPEI)</div>
            <strong class="num">${esc(clabe)}</strong>
          </div>
          <button type="button" class="btn-ghost-sm" data-copy="${esc(clabe)}">Copiar</button>
        </div>
        <div class="copy-row">
          <div>
            <div style="font-size:0.74rem;color:var(--text-muted)">Número de Tarjeta (Depósito OXXO)</div>
            <strong class="num">${esc(oxxo)}</strong>
          </div>
          <button type="button" class="btn-ghost-sm" data-copy="${esc(oxxo)}">Copiar</button>
        </div>
      </div>
    `;

    el.querySelector("#shareStoreLinkBtn")?.addEventListener("click", () =>
      copyText(window.location.href, "Enlace de la tienda")
    );
    el.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", () => copyText(btn.dataset.copy, "Dato bancario"));
    });
  }

  // ==================== PRODUCT DETAIL MODAL (STEP 7 & 8) ====================
  function openProductDetailModal(pid) {

  // FLIP-style morph – animate from product card if available
  const cardEl = document.getElementById(`product-${pid}`); // assume card id pattern
  // later in function we will call morphFromCard after creating modal

    const p = state.products.find((x) => x.id === pid);
    if (!p) return;

    const isAvail = p.disponibilidad === "Disponible" && p.cantidad > 0;
    const hasVideo = Boolean(p.video_url && p.video_url.trim());
    const isDirectVideo = hasVideo && /\.(mp4|webm|mov)(\?|$)/i.test(p.video_url);

    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="status-badge ${statusClass(p.disponibilidad)}">${esc(p.disponibilidad)}</span>
          <span style="font-size:0.8rem;color:var(--text-muted)" class="num">${esc(p.id)} · ${esc(p.categoria)}</span>
        </div>
        <button type="button" class="icon-close" data-close-modal>&times;</button>
      </div>
      <h2 id="modalTitle" style="margin:16px 18px 0;font-size:1.28rem;font-weight:800">${esc(p.nombre)}</h2>

      <div class="detail-grid">
        <div class="detail-media">
          <div id="detailMediaViewport">
            <img src="${esc(p.foto_url || FALLBACK_IMG)}" alt="${esc(p.nombre)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" />
          </div>
          ${
            hasVideo
              ? `<div style="display:flex;gap:8px">
                  <button type="button" class="btn-ghost-sm" id="showPhotoMediaBtn">Ver Foto</button>
                  ${
                    isDirectVideo
                      ? `<button type="button" class="btn-ghost-sm" id="showVideoMediaBtn">Reproducir Video</button>`
                      : `<a href="${esc(p.video_url)}" target="_blank" rel="noopener" class="btn-ghost-sm" style="text-decoration:none">Abrir Video Demostrativo ↗</a>`
                  }
                </div>`
              : ""
          }
        </div>

        <div class="detail-info">
          <div>
            <h2 style="margin:0;font-size:1.28rem">${esc(p.nombre)}</h2>
            <div style="font-size:1.45rem;font-weight:800;color:var(--brand-dark);margin-top:6px" class="num">
              ${fmtMXN(p.precio)} <span style="font-size:0.8rem;font-weight:600;color:var(--text-muted)">MXN</span>
            </div>
          </div>

          <p style="margin:0;font-size:0.9rem;color:var(--text-secondary)">
            ${esc(p.descripcion || "Producto verificado en inventario.")}
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--bg-subtle);padding:12px;border-radius:10px;font-size:0.82rem">
            <div><strong>Talla / Medida:</strong> ${esc(p.talla || "Única")}</div>
            <div><strong>Color:</strong> ${esc(p.color || "Estándar")}</div>
            <div><strong>Marca:</strong> ${esc(p.marca || "Importado")}</div>
            <div><strong>Condición:</strong> ${esc(p.condicion || "Nuevo")}</div>
            <div><strong>En stock:</strong> <span class="num">${p.cantidad}</span> pza(s)</div>
            <div><strong>Alta:</strong> <span class="num">${esc(p.fecha_alta)}</span></div>
          </div>

          ${
            isAvail
              ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:4px">
                  <label style="font-size:0.84rem;font-weight:700">Cantidad a pedir:</label>
                  <div class="stock-stepper">
                    <button type="button" class="step-btn" id="detQtyMinus">-</button>
                    <span id="detQtyVal" class="num" style="min-width:24px;text-align:center;font-weight:700">1</span>
                    <button type="button" class="step-btn" id="detQtyPlus">+</button>
                  </div>
                </div>`
              : ""
          }

          <div style="display:flex;flex-direction:column;gap:8px;margin-top:auto;padding-top:8px">
            <button type="button" class="btn-primary btn-block" id="detReserveBtn" ${!isAvail ? "disabled" : ""}>
              ${isAvail ? "Apartar Producto (Agregar al Carrito)" : "No disponible para apartar"}
            </button>
            ${
              isAvail
                ? `<button type="button" class="btn-outline btn-block" id="detBuyNowBtn">
                    Comprar Ahora y Subir Comprobante
                  </button>`
                : ""
            }
            <a href="${esc(p.whatsapp_link)}" target="_blank" rel="noopener" class="btn-wa btn-block">
              Enviar WhatsApp por este Producto
            </a>
          </div>
        </div>
      </div>
    `;

    openModal(html);
    const modal = document.getElementById("modalContent");
    let qty = 1;

  // FLIP-style morph animation helper
  function morphFromCard(cardEl, targetEl) {
    const start = cardEl.getBoundingClientRect();
    const target = targetEl.getBoundingClientRect();
    const clone = cardEl.cloneNode(true);
    clone.style.position = 'fixed';
    clone.style.top = start.top + 'px';
    clone.style.left = start.left + 'px';
    clone.style.width = start.width + 'px';
    clone.style.height = start.height + 'px';
    clone.style.margin = 0;
    clone.style.transition = 'all 500ms ease';
    document.body.appendChild(clone);
    requestAnimationFrame(() => {
      clone.style.top = target.top + 'px';
      clone.style.left = target.left + 'px';
      clone.style.width = target.width + 'px';
      clone.style.height = target.height + 'px';
    });
    clone.addEventListener('transitionend', () => {
      clone.remove();
    });
  }

  const cardElement = document.getElementById(`product-${pid}`);
  if (cardElement) {
    const modalTarget = document.getElementById("modalContent");
    morphFromCard(cardElement, modalTarget);
  }

    modal.querySelector("#detQtyMinus")?.addEventListener("click", () => {
      qty = Math.max(1, qty - 1);
      modal.querySelector("#detQtyVal").textContent = String(qty);
    });
    modal.querySelector("#detQtyPlus")?.addEventListener("click", () => {
      qty = Math.min(p.cantidad, qty + 1);
      modal.querySelector("#detQtyVal").textContent = String(qty);
    });

    modal.querySelector("#showPhotoMediaBtn")?.addEventListener("click", () => {
      modal.querySelector("#detailMediaViewport").innerHTML = `<img src="${esc(p.foto_url || FALLBACK_IMG)}" alt="${esc(p.nombre)}" />`;
    });
    modal.querySelector("#showVideoMediaBtn")?.addEventListener("click", () => {
      modal.querySelector("#detailMediaViewport").innerHTML = `<video src="${esc(p.video_url)}" controls autoplay playsinline></video>`;
    });

    modal.querySelector("#detReserveBtn")?.addEventListener("click", () => {
      addToCart(p.id, qty);
      closeModal();
      openCartDrawer("apartar");
    });

    modal.querySelector("#detBuyNowBtn")?.addEventListener("click", () => {
      addToCart(p.id, qty);
      closeModal();
      openCartDrawer("comprar");
    });
  }

  // ==================== CART & APARTADOS DRAWER ====================
  function addToCart(pid, qty = 1) {
    const p = state.products.find((x) => x.id === pid);
    if (!p || p.disponibilidad !== "Disponible" || p.cantidad <= 0) {
      toast("Este producto no está disponible en este momento.", "error");
      return;
    }

    const existing = state.cart.find((c) => c.id === pid);
    if (existing) {
      if (existing.cantidad + qty > p.cantidad) {
        toast(`Solo hay ${p.cantidad} pieza(s) disponible(s) de ${p.nombre}.`, "error");
        existing.cantidad = p.cantidad;
      } else {
        existing.cantidad += qty;
        toast(`Se actualizó ${p.nombre} en tus apartados`, "success");
      }
    } else {
      state.cart.push({
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        cantidad: Math.min(qty, p.cantidad),
        max: p.cantidad,
        foto_url: p.foto_url,
        talla: p.talla,
      });
      toast(`${p.nombre} agregado a tus apartados`, "success");
    }
    state.lastCheckoutSuccess = null;
    saveCart();
  }

  function openCartDrawer(preferredMode = null) {
    if (preferredMode) state.checkoutMode = preferredMode;
    document.getElementById("cartBackdrop").classList.remove("hidden");
    document.getElementById("cartDrawer").classList.remove("hidden");
    renderCartDrawer();
  }

  function closeCartDrawer() {
    document.getElementById("cartBackdrop").classList.add("hidden");
    document.getElementById("cartDrawer").classList.add("hidden");
  }

  function renderCartDrawer() {
    const body = document.getElementById("cartDrawerBody");

    if (state.lastCheckoutSuccess) {
      const res = state.lastCheckoutSuccess;
      const folios = res.orders.map((o) => o.id).join(", ");
      body.innerHTML = `
        <div style="text-align:center;padding:18px 8px">
          <div style="width:52px;height:52px;border-radius:999px;background:var(--ok-bg);color:var(--ok-fg);display:grid;place-items:center;margin:0 auto 12px;font-size:1.5rem;font-weight:800">✓</div>
          <h3 style="margin:0 0 6px;font-size:1.18rem">¡Pedido Registrado con Éxito!</h3>
          <p style="margin:0 0 14px;font-size:0.86rem;color:var(--text-secondary)">
            Tu mercancía ya quedó reservada a tu nombre. Guarda tu folio para consultar estatus o subir comprobante:
          </p>
          <div style="background:var(--brand-tint);border:1px solid var(--brand-tint-strong);padding:12px;border-radius:10px;margin-bottom:14px">
            <div style="font-size:0.75rem;color:var(--text-secondary)">Folio(s) generado(s)</div>
            <div style="font-size:1.22rem;font-weight:800;color:var(--brand-dark)" class="num">${esc(folios)}</div>
            <div style="font-size:0.88rem;font-weight:700;margin-top:4px" class="num">Total: ${fmtMXN(res.grand_total)} MXN</div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="${esc(res.whatsapp_confirm_url)}" target="_blank" rel="noopener" class="btn-wa btn-block">
              Confirmar mi Apartado por WhatsApp
            </a>
            <button type="button" class="btn-outline btn-block" id="goMyOrdersFromSuccessBtn">
              Ver en Mis Pedidos / Subir Comprobante
            </button>
            <button type="button" class="btn-ghost btn-block" id="closeSuccessDrawerBtn">
              Seguir viendo el catálogo
            </button>
          </div>
        </div>
      `;

      body.querySelector("#goMyOrdersFromSuccessBtn")?.addEventListener("click", () => {
        const savedPhone = localStorage.getItem("tw_recent_phone") || res.orders[0]?.id || "";
        state.lastCheckoutSuccess = null;
        closeCartDrawer();
        switchCustomerTab("orders");
        if (savedPhone) {
          document.getElementById("orderLookupInput").value = savedPhone;
          runOrderLookup(savedPhone);
        }
      });
      body.querySelector("#closeSuccessDrawerBtn")?.addEventListener("click", () => {
        state.lastCheckoutSuccess = null;
        closeCartDrawer();
      });
      return;
    }

    if (!state.cart.length) {
      body.innerHTML = `
        <div class="empty-state">
          <h3 style="margin-top:0">Tu lista de apartados está vacía</h3>
          <p style="font-size:0.86rem">Explora el catálogo y toca <strong>Apartar / Agregar</strong> en los productos que te gusten.</p>
        </div>
      `;
      return;
    }

    const total = state.cart.reduce((s, it) => s + it.precio * it.cantidad, 0);
    const savedName = localStorage.getItem("tw_recent_name") || "";
    const savedPhone = localStorage.getItem("tw_recent_phone") || "";
    const clabe = state.config.bank_clabe || "012180001234567890";
    const oxxo = state.config.oxxo_card || "4152 3138 9900 1234";

    body.innerHTML = `
      <div>
        ${state.cart
          .map(
            (it) => `
          <div class="cart-line">
            <img src="${esc(it.foto_url || FALLBACK_IMG)}" alt="${esc(it.nombre)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" />
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:0.88rem">${esc(it.nombre)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${it.talla ? `Talla ${esc(it.talla)} · ` : ""}${fmtMXN(it.precio)} c/u</div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
                <div class="stock-stepper">
                  <button type="button" class="step-btn" data-cminus="${esc(it.id)}">-</button>
                  <span class="num" style="min-width:20px;text-align:center;font-weight:700">${it.cantidad}</span>
                  <button type="button" class="step-btn" data-cplus="${esc(it.id)}">+</button>
                </div>
                <strong class="num" style="font-size:0.9rem">${fmtMXN(it.precio * it.cantidad)}</strong>
              </div>
            </div>
            <button type="button" class="btn-ghost-sm" data-cremove="${esc(it.id)}" title="Quitar">&times;</button>
          </div>
        `
          )
          .join("")}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:1.05rem;font-weight:800">
        <span>Total a Pagar</span>
        <span class="num" style="color:var(--brand-dark)">${fmtMXN(total)} MXN</span>
      </div>

      <div class="mode-switch">
        <button type="button" class="mode-btn ${state.checkoutMode === "apartar" ? "active" : ""}" data-chmode="apartar">
          1. Solo Apartar Ahora
        </button>
        <button type="button" class="mode-btn ${state.checkoutMode === "comprar" ? "active" : ""}" data-chmode="comprar">
          2. Subir Comprobante
        </button>
      </div>

      <form id="checkoutDrawerForm" class="stacked-form">
        <div class="field">
          <label>Tu Nombre Completo *</label>
          <input type="text" id="chkName" value="${esc(savedName)}" placeholder="Ej. Fernanda Martínez" required />
        </div>
        <div class="field">
          <label>Tu WhatsApp / Teléfono (10 dígitos) *</label>
          <input type="tel" id="chkPhone" value="${esc(savedPhone)}" placeholder="Ej. 7223456789" required />
        </div>
        <div class="field">
          <label>Método de Pago Previsto</label>
          <select id="chkMethod">
            <option value="Transferencia SPEI">Transferencia SPEI</option>
            <option value="Depósito OXXO">Depósito OXXO</option>
            <option value="Efectivo Contra Entrega">Efectivo Contra Entrega</option>
            <option value="Tarjeta / Link de Pago">Tarjeta / Link de Pago</option>
          </select>
        </div>

        ${
          state.checkoutMode === "comprar"
            ? `
          <div class="bank-mini-box" style="margin-bottom:4px">
            <div><strong>CLABE SPEI:</strong> <span class="num">${esc(clabe)}</span></div>
            <div><strong>Tarjeta OXXO:</strong> <span class="num">${esc(oxxo)}</span></div>
          </div>
          <div class="field">
            <label>Adjuntar Captura de Pago *</label>
            <label class="upload-dropzone">
              <input type="file" id="chkReceiptFile" accept="image/*,.pdf" hidden />
              ${
                state.checkoutReceiptUrl
                  ? `<div style="font-size:0.82rem;color:var(--ok-fg);font-weight:700">✓ Comprobante cargado (${esc(state.checkoutReceiptName)}) — Toca para cambiar</div>`
                  : `<div class="upload-prompt"><span>Toca aquí para subir captura de transferencia o ticket</span></div>`
              }
            </label>
          </div>
        `
            : `<div style="font-size:0.78rem;color:var(--text-secondary);background:var(--bg-subtle);padding:9px 11px;border-radius:8px">
                Apartaremos las piezas de inmediato y podrás subir tu captura de pago después desde <strong>Mis Pedidos</strong>.
              </div>`
        }

        <div class="field">
          <label>Notas (opcional)</label>
          <input type="text" id="chkNotes" placeholder="Ej. Paso mañana por la tarde / Envío a domicilio" />
        </div>

        <button type="submit" class="btn-primary btn-block" id="chkSubmitBtn">
          ${state.checkoutMode === "comprar" ? "Confirmar Compra con Comprobante" : "Confirmar Apartado de Mercancía"}
        </button>
      </form>
    `;

    body.querySelectorAll("[data-cminus]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = state.cart.find((x) => x.id === b.dataset.cminus);
        if (!item) return;
        if (item.cantidad <= 1) {
          state.cart = state.cart.filter((x) => x.id !== item.id);
        } else {
          item.cantidad -= 1;
        }
        saveCart();
        renderCartDrawer();
      })
    );

    body.querySelectorAll("[data-cplus]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = state.cart.find((x) => x.id === b.dataset.cplus);
        if (!item) return;
        if (item.cantidad < item.max) {
          item.cantidad += 1;
          saveCart();
          renderCartDrawer();
        } else {
          toast(`Solo hay ${item.max} unidad(es) en existencia.`, "error");
        }
      })
    );

    body.querySelectorAll("[data-cremove]").forEach((b) =>
      b.addEventListener("click", () => {
        state.cart = state.cart.filter((x) => x.id !== b.dataset.cremove);
        saveCart();
        renderCartDrawer();
      })
    );

    body.querySelectorAll("[data-chmode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.checkoutMode = b.dataset.chmode;
        renderCartDrawer();
      })
    );

    body.querySelector("#chkReceiptFile")?.addEventListener("change", async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      try {
        toast("Subiendo comprobante...");
        const up = await uploadFile(f);
        state.checkoutReceiptUrl = up.url;
        state.checkoutReceiptName = f.name;
        toast("Comprobante adjuntado", "success");
        renderCartDrawer();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    body.querySelector("#checkoutDrawerForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const nombre = body.querySelector("#chkName").value.trim();
      const telefono = body.querySelector("#chkPhone").value.trim();
      const metodo_pago = body.querySelector("#chkMethod").value;
      const notas = body.querySelector("#chkNotes").value.trim();

      if (state.checkoutMode === "comprar" && !state.checkoutReceiptUrl) {
        toast("Por favor adjunta la captura de tu comprobante de pago, o elige 'Solo Apartar Ahora'.", "error");
        return;
      }

      const btn = body.querySelector("#chkSubmitBtn");
      btn.disabled = true;
      btn.textContent = "Procesando pedido...";

      try {
        localStorage.setItem("tw_recent_name", nombre);
        localStorage.setItem("tw_recent_phone", telefono);

        const res = await api("/api/orders/checkout", {
          method: "POST",
          body: JSON.stringify({
            nombre,
            telefono,
            modo: state.checkoutMode,
            metodo_pago,
            comprobante_url: state.checkoutMode === "comprar" ? state.checkoutReceiptUrl : "",
            notas,
            items: state.cart.map((it) => ({ producto_id: it.id, cantidad: it.cantidad })),
          }),
        });

        state.cart = [];
        state.checkoutReceiptUrl = "";
        state.checkoutReceiptName = "";
        state.lastCheckoutSuccess = res;
        saveCart();
        await loadBootstrap();
        renderCartDrawer();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
        btn.textContent = "Reintentar";
      }
    });
  }

  // ==================== CUSTOMER ORDERS & RECEIPT UPLOAD (STEP 9) ====================
  async function runOrderLookup(query) {
    const listEl = document.getElementById("customerOrdersList");
    listEl.innerHTML = `<div style="font-size:0.85rem;color:var(--text-muted)">Buscando pedidos...</div>`;
    try {
      const data = await api(`/api/orders/lookup?q=${encodeURIComponent(query)}`);
      state.lookedUpOrders = data.orders || [];
      renderCustomerOrdersList();
    } catch (err) {
      listEl.innerHTML = `<div style="font-size:0.85rem;color:var(--err-fg)">${esc(err.message)}</div>`;
    }
  }

  function renderCustomerOrdersList() {
    const listEl = document.getElementById("customerOrdersList");
    if (!state.lookedUpOrders.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:24px 14px">
        <strong>No encontramos pedidos con ese dato</strong>
        <p style="margin:4px 0 0;font-size:0.82rem">Verifica tu teléfono a 10 dígitos o tu folio (ej. PED-003).</p>
      </div>`;
      return;
    }

    const waStore = (state.config.whatsapp_number || "525512345678").replace(/\D/g, "");

    listEl.innerHTML = state.lookedUpOrders
      .map((o) => {
        const askWa = `https://wa.me/${waStore}?text=${encodeURIComponent(
          `Hola, consulto el estatus de mi pedido ${o.id} (${o.producto_nombre}).`
        )}`;
        return `
        <div class="order-item-card">
          <div class="order-item-top">
            <span class="order-folio">${esc(o.id)} · ${esc(o.fecha)}</span>
            <div style="display:flex;gap:5px">
              <span class="status-badge ${statusClass(o.estado_pago)}">Pago: ${esc(o.estado_pago)}</span>
              <span class="status-badge ${statusClass(o.estado_pedido)}">${esc(o.estado_pedido)}</span>
            </div>
          </div>
          <div style="font-weight:700;font-size:0.92rem">${o.cantidad}x ${esc(o.producto_nombre)}</div>
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-secondary);margin-top:4px">
            <span>Cliente: ${esc(o.cliente_nombre)}</span>
            <strong class="num" style="color:var(--text-main)">${fmtMXN(o.total)} MXN</strong>
          </div>
          ${o.notas ? `<div style="font-size:0.76rem;color:var(--text-muted);margin-top:5px">${esc(o.notas)}</div>` : ""}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
            ${
              o.estado_pago !== "Aprobado"
                ? `<button type="button" class="btn-primary" style="padding:6px 11px;font-size:0.78rem" data-fill-receipt="${esc(o.id)}">
                    ${o.comprobante_url ? "Actualizar Comprobante" : "Subir Comprobante"}
                  </button>`
                : ""
            }
            ${
              o.comprobante_url
                ? `<button type="button" class="btn-ghost-sm" data-view-receipt="${esc(o.comprobante_url)}" data-view-title="${esc(o.id)}">
                    Ver mi comprobante
                  </button>`
                : ""
            }
            <a href="${askWa}" target="_blank" rel="noopener" class="btn-ghost-sm" style="text-decoration:none">
              WhatsApp Tienda
            </a>
          </div>
        </div>
      `;
      })
      .join("");

    listEl.querySelectorAll("[data-fill-receipt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ord = state.lookedUpOrders.find((x) => x.id === btn.dataset.fillReceipt);
        if (!ord) return;
        document.getElementById("recName").value = ord.cliente_nombre;
        document.getElementById("recPhone").value = ord.telefono;
        document.getElementById("recOrderId").value = ord.id;
        document.getElementById("recProdName").value = ord.producto_nombre;
        document.getElementById("recAmount").value = ord.total;
        document.getElementById("recOrderId").focus();
        toast(`Folio ${ord.id} cargado en el formulario de comprobante`, "success");
      });
    });

    listEl.querySelectorAll("[data-view-receipt]").forEach((btn) => {
      btn.addEventListener("click", () => openReceiptLightbox(btn.dataset.viewReceipt, `Comprobante ${btn.dataset.viewTitle}`));
    });
  }

  function openReceiptLightbox(url, title = "Comprobante de Pago") {
    const isPdf = /\.pdf(\?|$)/i.test(url);
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
        <strong>${esc(title)}</strong>
        <button type="button" class="icon-close" data-close-modal>&times;</button>
      </div>
      <div style="padding:18px;text-align:center;background:var(--bg-subtle)">
        ${
          isPdf
            ? `<iframe src="${esc(url)}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>`
            : `<img src="${esc(url)}" alt="${esc(title)}" style="max-width:100%;max-height:72vh;border-radius:10px;box-shadow:var(--shadow-md)" />`
        }
      </div>
    `);
  }

  // ==================== ADMIN MODE & LOGIN (STEP 12) ====================
  function handleToggleAdmin() {
    if (state.isAdminView) {
      state.isAdminView = false;
      document.getElementById("adminView").classList.add("hidden");
      document.getElementById("storefrontView").classList.remove("hidden");
      document.getElementById("customerDesktopNav").classList.remove("hidden");
      document.getElementById("mobileBottomNav").classList.remove("hidden");
      renderHeader();
      loadBootstrap();
      return;
    }

    if (state.adminUser) {
      enterAdminWorkspace();
    } else {
      openAdminLoginModal();
    }
  }

  function openAdminLoginModal() {
    openModal(`
      <div style="padding:22px;max-width:440px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h2 style="margin:0;font-size:1.2rem">Acceso al Panel Administrador</h2>
          <button type="button" class="icon-close" data-close-modal>&times;</button>
        </div>
        <p style="font-size:0.86rem;color:var(--text-secondary);margin-top:0">
          Ingresa tu PIN de tienda o tu correo con rol <strong>Admin / Vendedor</strong> registrado en la pestaña Usuarios.
        </p>
        <form id="adminLoginForm" class="stacked-form">
          <div class="field">
            <label>PIN o Correo de Administrador</label>
            <input type="text" id="adminCredInput" value="1234" placeholder="PIN (1234) o admin@mitienda.com" required />
          </div>
          <button type="submit" class="btn-primary btn-block">Entrar al Panel Admin</button>
          <div style="font-size:0.76rem;color:var(--text-muted);text-align:center">
            PIN predeterminado de demostración: <strong>1234</strong> (puedes cambiarlo en Configuración)
          </div>
        </form>
      </div>
    `);

    document.getElementById("adminLoginForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const credential = document.getElementById("adminCredInput").value.trim();
      try {
        const res = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ credential }),
        });
        state.adminUser = res.user;
        localStorage.setItem("tw_admin_user", JSON.stringify(res.user));
        closeModal();
        enterAdminWorkspace();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  async function enterAdminWorkspace() {
    state.isAdminView = true;
    document.getElementById("storefrontView").classList.add("hidden");
    document.getElementById("customerDesktopNav").classList.add("hidden");
    document.getElementById("mobileBottomNav").classList.add("hidden");
    document.getElementById("adminView").classList.remove("hidden");
    renderHeader();
    await refreshAdminData();
  }

  async function refreshAdminData() {
    try {
      const data = await api("/api/admin/overview");
      state.adminData = data;
      state.pendingBadge = data.kpis.pagos_pendientes || 0;
      document.getElementById("adminTabOrdersCount").textContent = String(state.pendingBadge);
      renderHeader();
      renderAdminActiveTab();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderAdminActiveTab() {
    if (!state.adminData) return;
    document.querySelectorAll(".admin-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.admintab === state.adminTab);
    });

    const area = document.getElementById("adminContentArea");
    if (state.adminTab === "dashboard") renderAdminDashboard(area);
    else if (state.adminTab === "orders") renderAdminOrders(area);
    else if (state.adminTab === "products") renderAdminProducts(area);
    else if (state.adminTab === "movements") renderAdminMovements(area);
    else if (state.adminTab === "customers") renderAdminCustomers(area);
    else if (state.adminTab === "settings") renderAdminSettings(area);
  }

  // --- ADMIN 1: DASHBOARD ---
  function renderAdminDashboard(area) {
    const k = state.adminData.kpis;
    const cats = state.adminData.categories;

    area.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Ventas Cobradas (Aprobadas)</div>
          <div class="kpi-number" style="color:var(--brand-dark)">${fmtMXN(k.ventas_aprobadas)}</div>
          <div class="kpi-sub">${k.total_pedidos} pedidos totales registrados</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;border-color:${k.pagos_pendientes > 0 ? "var(--warn-strong)" : "var(--border)"}" id="kpiJumpPendingOrders">
          <div class="kpi-label">Pagos Pendientes por Verificar</div>
          <div class="kpi-number" style="color:${k.pagos_pendientes > 0 ? "var(--warn-fg)" : "inherit"}">${k.pagos_pendientes}</div>
          <div class="kpi-sub">Por validar: ${fmtMXN(k.monto_pendiente)} MXN → Revisar</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Valor Stock Disponible</div>
          <div class="kpi-number">${fmtMXN(k.valor_inventario)}</div>
          <div class="kpi-sub">${k.disponibles} modelos disponibles (${k.unidades_stock} piezas)</div>
        </div>
        <div class="kpi-card" style="cursor:pointer" id="kpiJumpWaUnposted">
          <div class="kpi-label">Sin Publicar en Estado WhatsApp</div>
          <div class="kpi-number">${k.pendientes_wa_status}</div>
          <div class="kpi-sub">${k.apartados} apartados · ${k.agotados} agotados → Filtrar</div>
        </div>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <strong>Resumen de Inventario por Categoría</strong>
          <span style="font-size:0.8rem;color:var(--text-muted)">Sincronizado con Clientes (${k.total_clientes}) y Catálogo (${k.total_productos})</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Categoría</th>
                <th>Modelos</th>
                <th>Piezas Disponibles</th>
                <th>Valor en Stock (MXN)</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${cats
                .map(
                  (c) => `
                <tr>
                  <td class="num">${esc(c.id)}</td>
                  <td><strong>${esc(c.nombre)}</strong></td>
                  <td class="num">${c.productos_registrados}</td>
                  <td class="num">${c.unidades_disponibles}</td>
                  <td class="num"><strong>${fmtMXN(c.valor_stock)}</strong></td>
                  <td><span class="status-badge ${c.activa === "Sí" ? "status-Disponible" : "status-Oculto"}">${c.activa === "Sí" ? "Activa" : "Inactiva"}</span></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    area.querySelector("#kpiJumpPendingOrders")?.addEventListener("click", () => {
      state.adminTab = "orders";
      state.adminOrderFilter = "pendientes";
      renderAdminActiveTab();
    });
    area.querySelector("#kpiJumpWaUnposted")?.addEventListener("click", () => {
      state.adminTab = "products";
      state.adminProductFilter = "no_wa";
      renderAdminActiveTab();
    });
  }

  // --- ADMIN 2: PEDIDOS Y COMPROBANTES ---
  function renderAdminOrders(area) {
    let orders = [...state.adminData.orders];
    if (state.adminOrderFilter === "pendientes") orders = orders.filter((o) => o.estado_pago === "Pendiente");
    else if (state.adminOrderFilter === "apartados") orders = orders.filter((o) => o.estado_pedido === "Apartado");
    else if (state.adminOrderFilter === "aprobados") orders = orders.filter((o) => o.estado_pago === "Aprobado");
    else if (state.adminOrderFilter === "entregados") orders = orders.filter((o) => o.estado_pedido === "Entregado");

    area.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <div class="filter-chips">
            <button type="button" class="chip ${state.adminOrderFilter === "todos" ? "active" : ""}" data-aof="todos">Todos (${state.adminData.orders.length})</button>
            <button type="button" class="chip ${state.adminOrderFilter === "pendientes" ? "active" : ""}" data-aof="pendientes">Por Verificar Pago</button>
            <button type="button" class="chip ${state.adminOrderFilter === "apartados" ? "active" : ""}" data-aof="apartados">Apartados</button>
            <button type="button" class="chip ${state.adminOrderFilter === "aprobados" ? "active" : ""}" data-aof="aprobados">Pagos Aprobados</button>
            <button type="button" class="chip ${state.adminOrderFilter === "entregados" ? "active" : ""}" data-aof="entregados">Entregados</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Folio / Fecha</th>
                <th>Cliente</th>
                <th>Producto</th>
                <th>Total</th>
                <th>Método / Comprobante</th>
                <th>Pago</th>
                <th>Pedido</th>
                <th>Acciones Rápidas</th>
              </tr>
            </thead>
            <tbody>
              ${
                !orders.length
                  ? `<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--text-muted)">No hay pedidos en este filtro.</td></tr>`
                  : orders
                      .map((o) => {
                        const cleanTel = (o.telefono || "").replace(/\D/g, "");
                        const waCust = cleanTel.length === 10 ? "52" + cleanTel : cleanTel;
                        const waMsg = `¡Hola ${o.cliente_nombre}! Te escribimos de ${state.adminData.config.store_name || "la tienda"} sobre tu pedido ${o.id} (${o.producto_nombre}) — Estatus: Pago ${o.estado_pago} / ${o.estado_pedido}.`;
                        const waHref = `https://wa.me/${waCust}?text=${encodeURIComponent(waMsg)}`;
                        return `
                    <tr>
                      <td>
                        <strong class="num">${esc(o.id)}</strong>
                        <div style="font-size:0.74rem;color:var(--text-muted)" class="num">${esc(o.fecha)}</div>
                      </td>
                      <td>
                        <strong>${esc(o.cliente_nombre)}</strong>
                        <div style="font-size:0.75rem"><a href="${waHref}" target="_blank" rel="noopener" style="color:var(--brand-dark);font-weight:600">WA: ${esc(o.telefono)} ↗</a></div>
                      </td>
                      <td>
                        <div>${o.cantidad}x <strong>${esc(o.producto_nombre)}</strong></div>
                        <div style="font-size:0.73rem;color:var(--text-muted)">${esc(o.notas || "")}</div>
                      </td>
                      <td class="num"><strong>${fmtMXN(o.total)}</strong></td>
                      <td>
                        <div style="font-size:0.78rem">${esc(o.metodo_pago)}</div>
                        ${
                          o.comprobante_url
                            ? `<button type="button" class="btn-ghost-sm" style="margin-top:4px;color:var(--brand-dark);border-color:var(--brand-tint-strong);background:var(--brand-tint)" data-adm-receipt="${esc(o.comprobante_url)}" data-adm-oid="${esc(o.id)}">
                                Ver Comprobante
                              </button>`
                            : `<span style="font-size:0.74rem;color:var(--text-muted)">Sin captura aún</span>`
                        }
                      </td>
                      <td><span class="status-badge ${statusClass(o.estado_pago)}">${esc(o.estado_pago)}</span></td>
                      <td><span class="status-badge ${statusClass(o.estado_pedido)}">${esc(o.estado_pedido)}</span></td>
                      <td>
                        <div style="display:flex;flex-wrap:wrap;gap:5px">
                          ${
                            o.estado_pago === "Pendiente"
                              ? `<button type="button" class="btn-ok-sm" data-ord-act="aprobar_pago" data-oid="${esc(o.id)}">Aprobar Pago</button>
                                 <button type="button" class="btn-danger-sm" data-ord-act="rechazar_pago" data-oid="${esc(o.id)}">Rechazar</button>`
                              : ""
                          }
                          ${
                            o.estado_pago === "Aprobado" && o.estado_pedido !== "Listo para Entrega" && o.estado_pedido !== "Entregado"
                              ? `<button type="button" class="btn-ghost-sm" data-ord-act="marcar_listo" data-oid="${esc(o.id)}">Marcar Listo</button>`
                              : ""
                          }
                          ${
                            o.estado_pedido !== "Entregado" && o.estado_pedido !== "Cancelado"
                              ? `<button type="button" class="btn-ghost-sm" data-ord-act="marcar_entregado" data-oid="${esc(o.id)}">Entregado</button>`
                              : ""
                          }
                        </div>
                      </td>
                    </tr>
                  `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    area.querySelectorAll("[data-aof]").forEach((b) =>
      b.addEventListener("click", () => {
        state.adminOrderFilter = b.dataset.aof;
        renderAdminOrders(area);
      })
    );

    area.querySelectorAll("[data-adm-receipt]").forEach((b) =>
      b.addEventListener("click", () =>
        openReceiptLightbox(b.dataset.admReceipt, `Comprobante del Pedido ${b.dataset.admOid}`)
      )
    );

    area.querySelectorAll("[data-ord-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const oid = b.dataset.oid;
        const accion = b.dataset.ordAct;
        try {
          await api(`/api/admin/orders/${encodeURIComponent(oid)}`, {
            method: "PATCH",
            body: JSON.stringify({ accion }),
          });
          toast(`Pedido ${oid} actualizado`, "success");
          await refreshAdminData();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  // --- ADMIN 3: PRODUCTOS E INVENTARIO (STEP 12 & 13) ---
  function renderAdminProducts(area) {
    let prods = [...state.adminData.products];
    if (state.adminProductFilter === "disponibles") prods = prods.filter((p) => p.disponibilidad === "Disponible");
    else if (state.adminProductFilter === "agotados") prods = prods.filter((p) => p.disponibilidad === "Agotado");
    else if (state.adminProductFilter === "no_wa") prods = prods.filter((p) => p.publicado_wa === "No" && p.disponibilidad === "Disponible");

    if (state.adminProductSearch.trim()) {
      const q = state.adminProductSearch.trim().toLowerCase();
      prods = prods.filter((p) => p.nombre.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q));
    }

    area.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <div class="filter-chips">
            <button type="button" class="chip ${state.adminProductFilter === "todos" ? "active" : ""}" data-apf="todos">Todos (${state.adminData.products.length})</button>
            <button type="button" class="chip ${state.adminProductFilter === "disponibles" ? "active" : ""}" data-apf="disponibles">Disponibles</button>
            <button type="button" class="chip ${state.adminProductFilter === "agotados" ? "active" : ""}" data-apf="agotados">Agotados</button>
            <button type="button" class="chip ${state.adminProductFilter === "no_wa" ? "active" : ""}" data-apf="no_wa">Falta subir a Estado WA</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="search" id="admProdSearchInput" value="${esc(state.adminProductSearch)}" placeholder="Filtrar ID o nombre..." style="padding:7px 11px;border:1px solid var(--border-strong);border-radius:8px;font-family:inherit;font-size:0.83rem" />
            <button type="button" class="btn-primary" id="admAddProdBtn">+ Agregar</button>
          </div>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Foto</th>
                <th>ID / Producto</th>
                <th>Categoría</th>
                <th>Precio MXN</th>
                <th>Stock Rápido</th>
                <th>Disponibilidad</th>
                <th>Estado WA</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${prods
                .map(
                  (p) => `
                <tr>
                  <td><img src="${esc(p.foto_url || FALLBACK_IMG)}" class="thumb-sm" alt="" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'" /></td>
                  <td>
                    <div><strong class="num">${esc(p.id)}</strong> · <strong>${esc(p.nombre)}</strong></div>
                    <div style="font-size:0.74rem;color:var(--text-muted)">${esc([p.talla, p.color, p.marca].filter(Boolean).join(" · "))}</div>
                  </td>
                  <td>${esc(p.categoria)}</td>
                  <td class="num"><strong>${fmtMXN(p.precio)}</strong></td>
                  <td>
                    <div class="stock-stepper">
                      <button type="button" class="step-btn" data-st-adj="-1" data-pid="${esc(p.id)}">-</button>
                      <span class="num" style="min-width:22px;text-align:center;font-weight:800">${p.cantidad}</span>
                      <button type="button" class="step-btn" data-st-adj="1" data-pid="${esc(p.id)}">+</button>
                    </div>
                  </td>
                  <td><span class="status-badge ${statusClass(p.disponibilidad)}">${esc(p.disponibilidad)}</span></td>
                  <td>
                    <button type="button" class="btn-ghost-sm" data-toggle-wa="${esc(p.id)}" style="${p.publicado_wa === "Sí" ? "background:var(--ok-bg);color:var(--ok-fg);border-color:var(--ok-tint-strong)" : ""}">
                      ${p.publicado_wa === "Sí" ? "Publicado ✓" : "Pendiente"}
                    </button>
                  </td>
                  <td>
                    <div style="display:flex;gap:5px">
                      <button type="button" class="btn-ghost-sm" data-copy-promo="${esc(p.id)}" title="Copiar texto para Estado de WhatsApp">Texto WA</button>
                      <button type="button" class="btn-ghost-sm" data-edit-prod="${esc(p.id)}">Editar</button>
                      <button type="button" class="btn-danger-sm" data-del-prod="${esc(p.id)}">Borrar</button>
                    </div>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    area.querySelectorAll("[data-apf]").forEach((b) =>
      b.addEventListener("click", () => {
        state.adminProductFilter = b.dataset.apf;
        renderAdminProducts(area);
      })
    );

    area.querySelector("#admProdSearchInput")?.addEventListener("input", (e) => {
      state.adminProductSearch = e.target.value;
      renderAdminProducts(area);
      const inp = area.querySelector("#admProdSearchInput");
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    });

    area.querySelector("#admAddProdBtn")?.addEventListener("click", () => openProductEditorModal(null));

    area.querySelectorAll("[data-st-adj]").forEach((b) =>
      b.addEventListener("click", async () => {
        const pid = b.dataset.pid;
        const cambio = parseInt(b.dataset.stAdj, 10);
        try {
          await api(`/api/admin/products/${encodeURIComponent(pid)}/stock`, {
            method: "POST",
            body: JSON.stringify({
              cambio,
              tipo: cambio > 0 ? "Entrada de Mercancía" : "Ajuste de Inventario",
              motivo: "Ajuste rápido desde tabla de inventario",
            }),
          });
          await refreshAdminData();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );

    area.querySelectorAll("[data-toggle-wa]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api(`/api/admin/products/${encodeURIComponent(b.dataset.toggleWa)}/toggle-wa`, { method: "PATCH" });
          await refreshAdminData();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );

    area.querySelectorAll("[data-copy-promo]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = state.adminData.products.find((x) => x.id === b.dataset.copyPromo);
        if (!p) return;
        const txt = `¡Nuevo en inventario! ${p.nombre} ${p.talla ? `(Talla ${p.talla})` : ""} — ${fmtMXN(p.precio)} MXN (${p.cantidad} disp.). Apártalo aquí: ${window.location.origin}`;
        copyText(txt, "Texto promocional para WhatsApp");
      })
    );

    area.querySelectorAll("[data-edit-prod]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = state.adminData.products.find((x) => x.id === b.dataset.editProd);
        if (p) openProductEditorModal(p);
      })
    );

    area.querySelectorAll("[data-del-prod]").forEach((b) =>
      b.addEventListener("click", async () => {
        const pid = b.dataset.delProd;
        try {
          await api(`/api/admin/products/${encodeURIComponent(pid)}`, { method: "DELETE" });
          toast(`Producto ${pid} eliminado`, "success");
          await refreshAdminData();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  function openProductEditorModal(prod = null) {
    const isEdit = Boolean(prod);
    const cats = state.adminData?.categories || state.categories;

    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)">
        <h2 style="margin:0;font-size:1.15rem">${isEdit ? `Editar Producto (${esc(prod.id)})` : "Alta Rápida de Nuevo Producto"}</h2>
        <button type="button" class="icon-close" data-close-modal>&times;</button>
      </div>
      <form id="productEditorForm" class="stacked-form" style="padding:20px">
        <div class="form-row-2">
          <div class="field">
            <label>Nombre del Producto *</label>
            <input type="text" id="peNombre" value="${esc(prod?.nombre || "")}" placeholder="Ej. Tenis Adidas Forum Low" required />
          </div>
          <div class="field">
            <label>Categoría *</label>
            <select id="peCategoria">
              ${cats
                .map(
                  (c) => `<option value="${esc(c.nombre)}" ${prod?.categoria === c.nombre ? "selected" : ""}>${esc(c.nombre)}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Precio de Venta (MXN) *</label>
            <input type="number" step="0.01" min="0" id="pePrecio" value="${prod ? prod.precio : ""}" placeholder="Ej. 850" required />
          </div>
          <div class="field">
            <label>Cantidad en Existencia *</label>
            <input type="number" step="1" min="0" id="peCantidad" value="${prod ? prod.cantidad : 1}" required />
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Talla / Medida</label>
            <input type="text" id="peTalla" value="${esc(prod?.talla || "")}" placeholder="Ej. Mediana / 26 MX" />
          </div>
          <div class="field">
            <label>Color / Marca</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input type="text" id="peColor" value="${esc(prod?.color || "")}" placeholder="Color" />
              <input type="text" id="peMarca" value="${esc(prod?.marca || "")}" placeholder="Marca" />
            </div>
          </div>
        </div>

        <div class="field">
          <label>Descripción</label>
          <textarea id="peDesc" rows="2" placeholder="Detalles de la prenda o artículo...">${esc(prod?.descripcion || "")}</textarea>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Foto del Producto (Subir archivo o pegar URL)</label>
            <input type="text" id="peFotoUrl" value="${esc(prod?.foto_url || "")}" placeholder="https://... o sube foto abajo" />
            <input type="file" id="peFotoFile" accept="image/*" style="font-size:0.78rem;margin-top:4px" />
          </div>
          <div class="field">
            <label>Video del Producto (Subir MP4 o pegar URL)</label>
            <input type="text" id="peVideoUrl" value="${esc(prod?.video_url || "")}" placeholder="https://... o sube MP4 abajo" />
            <input type="file" id="peVideoFile" accept="video/mp4,video/webm,video/quicktime" style="font-size:0.78rem;margin-top:4px" />
          </div>
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Estado Manual y Condición</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <select id="peEstado">
                ${["Disponible", "Apartado", "Vendido", "Oculto"]
                  .map((s) => `<option value="${s}" ${prod?.estado === s ? "selected" : ""}>${s}</option>`)
                  .join("")}
              </select>
              <select id="peCondicion">
                ${["Nuevo", "Seminuevo", "Outlet"]
                  .map((s) => `<option value="${s}" ${prod?.condicion === s ? "selected" : ""}>${s}</option>`)
                  .join("")}
              </select>
            </div>
          </div>
          <div class="field">
            <label>Destacado / Estado WhatsApp</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <select id="peDestacado">
                <option value="No" ${prod?.destacado === "No" ? "selected" : ""}>Normal</option>
                <option value="Sí" ${prod?.destacado === "Sí" ? "selected" : ""}>Destacado ★</option>
              </select>
              <select id="pePubWa">
                <option value="No" ${prod?.publicado_wa === "No" ? "selected" : ""}>WA: No publicado</option>
                <option value="Sí" ${prod?.publicado_wa === "Sí" ? "selected" : ""}>WA: Ya publicado</option>
              </select>
            </div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:8px">
          <button type="button" class="btn-outline" data-close-modal>Cancelar</button>
          <button type="submit" class="btn-primary" id="peSaveBtn">${isEdit ? "Guardar Cambios" : "Publicar en Tienda"}</button>
        </div>
      </form>
    `);

    const m = document.getElementById("modalContent");

    m.querySelector("#peFotoFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        toast("Subiendo foto...");
        const up = await uploadFile(f);
        m.querySelector("#peFotoUrl").value = up.url;
        toast("Foto cargada correctamente", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    m.querySelector("#peVideoFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        toast("Subiendo video...");
        const up = await uploadFile(f);
        m.querySelector("#peVideoUrl").value = up.url;
        toast("Video cargado correctamente", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    m.querySelector("#productEditorForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = {
        nombre: m.querySelector("#peNombre").value,
        categoria: m.querySelector("#peCategoria").value,
        precio: parseFloat(m.querySelector("#pePrecio").value || "0"),
        cantidad: parseInt(m.querySelector("#peCantidad").value || "0", 10),
        talla: m.querySelector("#peTalla").value,
        color: m.querySelector("#peColor").value,
        marca: m.querySelector("#peMarca").value,
        descripcion: m.querySelector("#peDesc").value,
        foto_url: m.querySelector("#peFotoUrl").value,
        video_url: m.querySelector("#peVideoUrl").value,
        estado: m.querySelector("#peEstado").value,
        condicion: m.querySelector("#peCondicion").value,
        destacado: m.querySelector("#peDestacado").value,
        publicado_wa: m.querySelector("#pePubWa").value,
      };
      try {
        if (isEdit) {
          await api(`/api/admin/products/${encodeURIComponent(prod.id)}`, { method: "PUT", body: JSON.stringify(body) });
          toast(`Producto ${prod.id} actualizado`, "success");
        } else {
          await api("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
          toast("Nuevo producto publicado en el catálogo", "success");
        }
        closeModal();
        await refreshAdminData();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // --- ADMIN 4: MOVIMIENTOS DE INVENTARIO ---
  function renderAdminMovements(area) {
    const movs = state.adminData.movements;
    area.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <strong>Bitácora de Movimientos de Inventario (${movs.length})</strong>
          <span style="font-size:0.8rem;color:var(--text-muted)">Se registra automáticamente en cada apartado, venta, devolución o alta</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Fecha</th>
                <th>Producto</th>
                <th>Tipo de Movimiento</th>
                <th>Cambio</th>
                <th>Stock Anterior</th>
                <th>Nuevo Stock</th>
                <th>Motivo / Referencia</th>
              </tr>
            </thead>
            <tbody>
              ${movs
                .map(
                  (m) => `
                <tr>
                  <td class="num"><strong>${esc(m.id)}</strong></td>
                  <td class="num">${esc(m.fecha)}</td>
                  <td><span class="num">${esc(m.producto_id)}</span> · <strong>${esc(m.producto_nombre)}</strong></td>
                  <td>${esc(m.tipo)}</td>
                  <td class="num" style="font-weight:800;color:${m.cambio > 0 ? "var(--ok-fg)" : m.cambio < 0 ? "var(--err-fg)" : "inherit"}">
                    ${m.cambio > 0 ? `+${m.cambio}` : m.cambio}
                  </td>
                  <td class="num">${m.cantidad_anterior}</td>
                  <td class="num"><strong>${m.nueva_cantidad}</strong></td>
                  <td style="color:var(--text-secondary)">${esc(m.motivo)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- ADMIN 5: CLIENTES WHATSAPP ---
  function renderAdminCustomers(area) {
    const custs = state.adminData.customers;
    area.innerHTML = `
      <div class="table-card">
        <div class="table-toolbar">
          <strong>Cartera de Clientes (${custs.length})</strong>
          <span style="font-size:0.8rem;color:var(--text-muted)">Se agregan automáticamente al apartar o enviar comprobante</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Teléfono / WhatsApp</th>
                <th>Categorías de Interés</th>
                <th>Último Pedido</th>
                <th>Pedidos</th>
                <th>Total Aprobado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${custs
                .map(
                  (c) => `
                <tr>
                  <td class="num"><strong>${esc(c.id)}</strong></td>
                  <td>
                    <strong>${esc(c.nombre_completo)}</strong>
                    ${c.email ? `<div style="font-size:0.74rem;color:var(--text-muted)">${esc(c.email)}</div>` : ""}
                  </td>
                  <td>
                    <a href="${esc(c.chat_wa)}" target="_blank" rel="noopener" style="color:var(--brand-dark);font-weight:700" class="num">
                      ${esc(c.telefono)} ↗
                    </a>
                  </td>
                  <td>${esc(c.categorias_interes || "—")}</td>
                  <td class="num">${esc(c.ultimo_pedido || "—")}</td>
                  <td class="num">${c.total_pedidos}</td>
                  <td class="num"><strong>${fmtMXN(c.total_comprado)}</strong></td>
                  <td><span class="status-badge ${statusClass(c.estado)}">${esc(c.estado)}</span></td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- ADMIN 6: CONFIGURACIÓN Y USUARIOS ---
  function renderAdminSettings(area) {
    const cfg = state.adminData.config;
    const users = state.adminData.users;

    area.innerHTML = `
      <div class="orders-layout">
        <div class="panel-card">
          <div class="card-head">
            <h2>Configuración General y Datos Bancarios</h2>
            <p>Al actualizar el número de WhatsApp aquí, todos los enlaces de productos se actualizan de inmediato.</p>
          </div>
          <form id="adminSettingsForm" class="stacked-form">
            <div class="form-row-2">
              <div class="field">
                <label>Nombre de la Tienda</label>
                <input type="text" id="cfgStoreName" value="${esc(cfg.store_name || "")}" required />
              </div>
              <div class="field">
                <label>WhatsApp de Ventas (con clave 52)</label>
                <input type="text" id="cfgWa" value="${esc(cfg.whatsapp_number || "")}" placeholder="525512345678" required />
              </div>
            </div>
            <div class="form-row-2">
              <div class="field">
                <label>Banco</label>
                <input type="text" id="cfgBank" value="${esc(cfg.bank_name || "")}" />
              </div>
              <div class="field">
                <label>Titular de la Cuenta</label>
                <input type="text" id="cfgHolder" value="${esc(cfg.bank_holder || "")}" />
              </div>
            </div>
            <div class="form-row-2">
              <div class="field">
                <label>CLABE Interbancaria (SPEI)</label>
                <input type="text" id="cfgClabe" value="${esc(cfg.bank_clabe || "")}" />
              </div>
              <div class="field">
                <label>Tarjeta para Depósito OXXO</label>
                <input type="text" id="cfgOxxo" value="${esc(cfg.oxxo_card || "")}" />
              </div>
            </div>
            <div class="field">
              <label>Información de Entregas y Envíos</label>
              <input type="text" id="cfgPickup" value="${esc(cfg.pickup_info || "")}" />
            </div>
            <div class="field">
              <label>PIN de Acceso Administrador</label>
              <input type="text" id="cfgPin" value="${esc(cfg.admin_pin || "1234")}" required />
            </div>
            <button type="submit" class="btn-primary">Guardar Configuración de Tienda</button>
          </form>
        </div>

        <div class="panel-card">
          <div class="card-head">
            <h2>Usuarios y Roles (Admin / Vendedor)</h2>
            <p>Correos autorizados para entrar al Panel Admin (equivalente a la pestaña Usuarios de Glide).</p>
          </div>

          <div class="customer-orders-list" style="margin-bottom:16px">
            ${users
              .map(
                (u) => `
              <div class="order-item-card" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <strong>${esc(u.nombre)}</strong> <span class="status-badge status-Disponible">${esc(u.rol)}</span>
                  <div style="font-size:0.78rem;color:var(--text-secondary)">${esc(u.email)}</div>
                </div>
                <button type="button" class="btn-danger-sm" data-del-usr="${esc(u.id)}">Quitar</button>
              </div>
            `
              )
              .join("")}
          </div>

          <form id="addUserForm" class="stacked-form">
            <div class="form-row-2">
              <div class="field">
                <label>Nombre</label>
                <input type="text" id="uNom" placeholder="Ej. Ana Ventas" required />
              </div>
              <div class="field">
                <label>Correo Electrónico</label>
                <input type="email" id="uEmail" placeholder="ana@mitienda.com" required />
              </div>
            </div>
            <div class="form-row-2">
              <div class="field">
                <label>Rol</label>
                <select id="uRol">
                  <option value="Admin">Admin</option>
                  <option value="Vendedor">Vendedor</option>
                </select>
              </div>
              <div class="field">
                <label>WhatsApp</label>
                <input type="text" id="uWa" placeholder="5255..." />
              </div>
            </div>
            <button type="submit" class="btn-outline">+ Agregar Usuario Autorizado</button>
          </form>
        </div>
      </div>
    `;

    area.querySelector("#adminSettingsForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api("/api/admin/config", {
          method: "PUT",
          body: JSON.stringify({
            store_name: area.querySelector("#cfgStoreName").value,
            whatsapp_number: area.querySelector("#cfgWa").value,
            bank_name: area.querySelector("#cfgBank").value,
            bank_holder: area.querySelector("#cfgHolder").value,
            bank_clabe: area.querySelector("#cfgClabe").value,
            oxxo_card: area.querySelector("#cfgOxxo").value,
            pickup_info: area.querySelector("#cfgPickup").value,
            admin_pin: area.querySelector("#cfgPin").value,
          }),
        });
        toast("Configuración de tienda actualizada", "success");
        await refreshAdminData();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    area.querySelector("#addUserForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            nombre: area.querySelector("#uNom").value,
            email: area.querySelector("#uEmail").value,
            rol: area.querySelector("#uRol").value,
            whatsapp: area.querySelector("#uWa").value,
            activo: "Sí",
            permisos: "Acceso autorizado",
          }),
        });
        toast("Usuario agregado", "success");
        await refreshAdminData();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    area.querySelectorAll("[data-del-usr]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api(`/api/admin/users/${encodeURIComponent(b.dataset.delUsr)}`, { method: "DELETE" });
          await refreshAdminData();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  // ==================== MODAL HELPERS & GLOBAL LISTENERS ====================
  function openModal(html) {
    const content = document.getElementById("modalContent");
    content.innerHTML = html;
    document.getElementById("modalBackdrop").classList.remove("hidden");
    content.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModal));
    // Give the dialog an accessible name from its first heading so screen
    // readers announce it instead of an unnamed dialog.
    const titleEl = document.getElementById("modalTitle");
    const heading = content.querySelector("h1, h2, h3");
    if (titleEl) titleEl.textContent = heading ? heading.textContent.trim() : "";
  }

  function closeModal() {
    document.getElementById("modalBackdrop").classList.add("hidden");
    document.getElementById("modalContent").innerHTML = "";
  }

  function switchCustomerTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-panel").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `tab-${tabName}`);
    });
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function syncQuickFilterChips() {
    document.querySelectorAll("#homeQuickFilters .chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.filter === state.quickFilter);
    });
  }

  function bindGlobalEvents() {
    // Customer nav tabs
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => switchCustomerTab(btn.dataset.tab));
    });

    document.getElementById("brandHomeBtn")?.addEventListener("click", () => {
      if (state.isAdminView) handleToggleAdmin();
      state.selectedCategory = "";
      switchCustomerTab("home");
      renderHomeCategoryStrip();
      renderHomeProducts();
    });

    // Search & quick filters
    const sInput = document.getElementById("searchInput");
    const clearBtn = document.getElementById("clearSearchBtn");
    sInput?.addEventListener("input", () => {
      state.searchQuery = sInput.value;
      clearBtn.classList.toggle("hidden", !state.searchQuery);
      renderHomeProducts();
    });
    clearBtn?.addEventListener("click", () => {
      sInput.value = "";
      state.searchQuery = "";
      clearBtn.classList.add("hidden");
      renderHomeProducts();
    });

    document.querySelectorAll("#homeQuickFilters .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.quickFilter = chip.dataset.filter;
        syncQuickFilterChips();
        renderHomeProducts();
      });
    });

    document.getElementById("sortSelect")?.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      renderHomeProducts();
    });

    document.getElementById("resetCategoryFilterBtn")?.addEventListener("click", () => {
      state.selectedCategory = "";
      renderHomeCategoryStrip();
      renderHomeProducts();
    });

    // Cart Drawer
    document.getElementById("openCartBtn")?.addEventListener("click", () => openCartDrawer());
    document.getElementById("closeCartBtn")?.addEventListener("click", closeCartDrawer);
    document.getElementById("cartBackdrop")?.addEventListener("click", closeCartDrawer);

    // Modal backdrop click & ESC
    document.getElementById("modalBackdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "modalBackdrop") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeCartDrawer();
      }
    });

    // Order Lookup
    document.getElementById("orderLookupForm")?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const q = document.getElementById("orderLookupInput").value.trim();
      if (q) runOrderLookup(q);
    });
    document.querySelectorAll("[data-demo-q]").forEach((b) =>
      b.addEventListener("click", () => {
        const q = b.dataset.demoQ;
        document.getElementById("orderLookupInput").value = q;
        runOrderLookup(q);
      })
    );

    // Step 9 Direct Receipt Upload Form
    document.getElementById("recFileInput")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        toast("Subiendo imagen del comprobante...");
        const up = await uploadFile(f);
        state.directReceiptUrl = up.url;
        state.directReceiptName = f.name;
        document.getElementById("recUploadPrompt").classList.add("hidden");
        const prev = document.getElementById("recUploadPreview");
        prev.classList.remove("hidden");
        prev.innerHTML = `
          ${/\.pdf$/i.test(up.url) ? `<div class="thumb-sm" style="display:grid;place-items:center;font-weight:800">PDF</div>` : `<img src="${esc(up.url)}" alt="Vista previa" />`}
          <div>
            <div style="font-weight:700;font-size:0.84rem;color:var(--ok-fg)">✓ Archivo listo: ${esc(f.name)}</div>
            <div style="font-size:0.74rem;color:var(--text-muted)">Toca para elegir otro archivo</div>
          </div>
        `;
        toast("Captura cargada, lista para enviar", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    document.getElementById("directReceiptForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!state.directReceiptUrl) {
        toast("Primero selecciona la foto o captura de tu comprobante de pago.", "error");
        return;
      }
      const btn = document.getElementById("submitDirectReceiptBtn");
      btn.disabled = true;
      btn.textContent = "Enviando comprobante...";

      try {
        const tel = document.getElementById("recPhone").value.trim();
        const res = await api("/api/receipts/submit", {
          method: "POST",
          body: JSON.stringify({
            nombre: document.getElementById("recName").value.trim(),
            telefono: tel,
            order_id: document.getElementById("recOrderId").value.trim(),
            producto_nombre: document.getElementById("recProdName").value.trim(),
            monto: parseFloat(document.getElementById("recAmount").value || "0"),
            metodo_pago: document.getElementById("recMethod").value,
            comprobante_url: state.directReceiptUrl,
            notas: document.getElementById("recNotes").value.trim(),
          }),
        });

        toast(`¡Comprobante registrado en el folio ${res.order.id}!`, "success");
        state.directReceiptUrl = "";
        state.directReceiptName = "";
        document.getElementById("directReceiptForm").reset();
        document.getElementById("recUploadPreview").classList.add("hidden");
        document.getElementById("recUploadPrompt").classList.remove("hidden");

        document.getElementById("orderLookupInput").value = res.order.id;
        await runOrderLookup(res.order.id);
        await loadBootstrap();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Enviar Comprobante a Revisión";
      }
    });

    // Admin Switching & Subtabs
    document.getElementById("toggleAdminBtn")?.addEventListener("click", handleToggleAdmin);
    document.getElementById("exitAdminBtn")?.addEventListener("click", handleToggleAdmin);
    document.getElementById("adminNewProductQuickBtn")?.addEventListener("click", () => {
      state.adminTab = "products";
      renderAdminActiveTab();
      openProductEditorModal(null);
    });

    document.querySelectorAll(".admin-tab").forEach((b) => {
      b.addEventListener("click", () => {
        state.adminTab = b.dataset.admintab;
        renderAdminActiveTab();
      });
    });
  }

  // Init
  bindGlobalEvents();
  updateCartBadge();
  loadBootstrap();
})();
