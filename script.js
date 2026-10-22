/* ============================================================
   НорВэ — Тансаг үнэртний дэлгүүр
   Нэгдсэн скрипт (бүх хуудас хуваалцана)
   Хуудас танилт: body[data-page] шошго ашиглана
   ============================================================ */
"use strict";

/* ---------- 1. Туслагч функцууд ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = str => String(str).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

/* Мөнгө форматла: 150000 → "150 000 ₮" */
const fmtMNT = n => new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " \u20AE";

/* Огноо: 2026.01.05 */
const fmtDate = iso => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const debounce = (fn, ms = 180) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* Детермин PRNG (mulberry32) — үр тогтмол бол ижил дүн дахин үүснэ */
const rand = seed => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* Стрин хэш (FNV-1a) — бүтээгдэхүүний нэрээс тогтвортой үр гаргана */
const strHash = str => {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/* Жинтэй санамсаргүй сонголт: [[утга, жин], ...] */
const pickWeighted = (rng, pairs) => {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  let r = rng() * total;
  for (const [val, w] of pairs) { r -= w; if (r <= 0) return val; }
  return pairs[pairs.length - 1][0];
};

const pickSome = (rng, arr, n) => {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
};

const roundTo = (n, step) => Math.round(n / step) * step;

/* URL параметр унших */
const getParam = name => new URLSearchParams(window.location.search).get(name);

/* ---------- 2. localStorage товч давалгаа ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* сав багтаамж хамгаалалт */ } }
};

const KEYS = {
  cart:   "norve_cart",     /* [{id, size, qty}] */
  wish:   "norve_wishlist", /* [id, ...]         */
  user:   "norve_user",     /* нэвтэрсэн сешн    */
  users:  "norve_users",    /* бүртгэлтэй дансууд (нууц үг хэштэй хадгалагдана) */
  orders: "norve_orders",   /* захиалгын түүх    */
  recent: "norve_recent",   /* сүүлд үзсэн id-ууд */
  seq:    "norve_order_seq",/* локал захиалгын дугаар өсөгч */
  settings:"norve_settings",/* хүргэлтийн үнэ, төлбөрийн аргууд */
  audit:  "norve_audit",    /* локал горимын өөрчлөлтийн бүртгэл */
  brandsInfo:"norve_brands_info", /* брэндийн нэмэлт мэдээлэл */
  pOver:  "norve_product_overrides", /* админы бүтээгдэхүүний засварууд {id: {name...}} */
  pCustom:"norve_custom_products"    /* админ шинээр нэмсэн бүтээгдэхүүнүүд */
};

/* ---------- 2.5 Бодит өгөгдлийн давалгаа (сервер ↔ localStorage) ----------
   node server.js ажиллаж байвал бүх захиалга, бүртгэл серверийн data/db.json
   өгөгдлийн санд хадгалагдана (олон төхөөрөмжөөс хуваалцана).
   Сервер байхгүй бол localStorage горим — өгөгдөл зөвхөн энэ төхөөрөмжид. */

/* Захиалгын 8 төлөв */
const ORDER_STATUS_LABELS = [
  "Шинэ захиалга", "Баталгаажуулах хүлээлттэй", "Баталгаажсан", "Бэлтгэж байгаа",
  "Хүргэлтэд гарсан", "Хүргэгдсэн", "Цуцлагдсан", "Буцаалт хийгдсэн"
];
/* Төлбөрийн төлөвүүд — бодит төлбөрийн үйлчилгээ холбогдоогүй бол
   браузерын товч дарсан мэдээллийг "төлөгдсөн" гэж тэмдэглэхгүй;
   баталгаажуулалтыг сервер талд админ гүйцэтгэнэ. */
const PAYMENT_STATUS_LABELS = ["Төлбөр хүлээж байна", "Төлбөр баталгаажсан", "Хүргэлтэд төлнө", "Төлбөр буцаагдсан"];
/* Биелэгдэж буй/дуссан төлөвтэй захиалгууд (орлого, ширхгийн тоонд тооцогдохоор) */
const FULFILLED_STATUS_SET = ["Баталгаажсан", "Бэлтгэж байгаа", "Хүргэлтэд гарсан", "Хүргэгдсэн"];

/* Захиалгын нэгдсэн шүүлтүүрд тохирсон: e.orderNo || e.id */
const orderId = o => o.orderNo || o.id || "";
const custName = o => {
  const f = o.customer && o.customer.firstName;
  const l = o.customer && o.customer.lastName;
  if (f || l) return ((l || "") + " " + (f || "")).trim();
  return (o.delivery && o.delivery.name) || "Мэдэгдэхгүй";
};
const custPhone = o => (o.customer && o.customer.phone) || (o.delivery && o.delivery.phone) || "";
const custEmail = o => (o.customer && o.customer.email) || o.email || "";

const Data = {
  server: false,
  token: "",
  async init() {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); this.server = !!j.backend; }
    } catch { this.server = false; }
    this.token = sessionStorage.getItem("norve_token") || "";
    if (!this.server) migrateLegacyOrders();
  },
  note() { return this.server ? "Серверийн горим — бүх төхөөрөмжийн нэг өгөгдлийн сан (data/db.json)" : "Локал горим — өгөгдөл зөвхөн энэ төхөөрөмжид хадгалагдана"; },
  async req(method, path, body) {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (this.token) headers["Authorization"] = "Bearer " + this.token;
    const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 401) this.token = ""; throw new Error(j.error || ("Серверийн алдаа: " + r.status)); }
    return j;
  }
};

/* Нууц үг хэшлэх — локал горим (энгийн текстээр хэзээ ч хадгалахгүй, админд харуулахгүй) */
async function hashPassword(pass, salt) {
  salt = salt || Math.random().toString(36).slice(2, 12);
  try {
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "::" + pass));
      return { salt, passHash: Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("") };
    }
  } catch { /* subtle байхгүй (file://) — доорх fallback */ }
  const s = salt + "::" + pass;
  let h1 = 2166136261, h2 = 842275253;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 48611) >>> 0;
  }
  for (let i = 0; i < 12; i++) { h1 = (h1 ^ h2) >>> 0; h2 = (h2 + 0x9E3779B9) >>> 0; }
  return { salt, passHash: h1.toString(16) + "-" + h2.toString(16) };
}

/* Хуучин захиалгуудыг шинэ 8-төлөв/pyramide төлөв рүү нүүж бичих (авто төлвөөс хамгаалах) */
function migrateLegacyOrders() {
  const orders = store.get(KEYS.orders, []);
  let changed = false;
  for (const o of orders) {
    if (!o || typeof o !== "object") continue;
    if (!ORDER_STATUS_LABELS.includes(o.status)) {
      const map = { "Баталгаажсан": "Баталгаажсан", "Хүргэлтэнд гарсан": "Хүргэлтэд гарсан", "Хүргэгдсэн": "Хүргэгдсэн", "Хүлээж байна": "Шинэ захиалга" };
      o.status = map[o.status] || (o.status ? "Шинэ захиалга" : "Шинэ захиалга");
      o.statusHistory = o.statusHistory || [{ status: o.status, at: o.date || new Date().toISOString(), by: "импорт" }];
      changed = true;
    }
    if (!o.paymentStatus) {
      o.paymentStatus = o.payment === "Хүргэлтээр бэлнээр" ? "Хүргэлтэд төлнө" : "Төлбөр хүлээж байна";
      changed = true;
    }
  }
  if (changed) store.set(KEYS.orders, orders);
}

/* Захиалгын объект бүтээх — items доторх нэр, хэмжээ, тоо, үнэ хугацааны хуулбар байдлаар
   snapshot болон хадгалагдана; дараа бүтээгдэхүүний үнэ өөрчлөгдсөн ч захиалгын үнэ хэвээр. */
function snapshotItems() {
  return cart.map(it => {
    const p = byId(it.id);
    if (!p) return null;
    const unitPrice = sizePrice(p, it.size);
    return {
      productId: p.id, name: p.name, brand: p.brand,
      size: it.size, qty: it.qty,
      unitPrice, lineTotal: unitPrice * it.qty,
      image: p.image || ""
    };
  }).filter(Boolean);
}

const PAY_METHOD_KEY_BY_LABEL = { "QPay": "qpay", "Банкны карт": "card", "Дансаар шилжүүлэх": "bank", "Хүргэлтээр бэлнээр": "cash" };

/* Захиалга хадгалах — серверийн захиалгийн дугаар давхард тэмдэглэл, давхар баталагдсан биш */
async function createOrder(payload) {
  if (Data.server) {
    const j = await Data.req("POST", "/api/orders", payload);
    return { orderNo: j.order.orderNo, paymentStatus: j.order.paymentStatus, status: j.order.status };
  }
  /* Локал горим: давтагдашгүй дугаар */
  const orders = store.get(KEYS.orders, []);
  const seq = store.get(KEYS.seq, 0) + 1;
  store.set(KEYS.seq, seq);
  let orderNo = "NRV-" + String(100000 + seq).slice(-6);
  while (orders.some(o => (o.orderNo || o.id) === orderNo)) {
    orderNo = "NRV-" + String(100000 + seq).slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
  }
  const now = new Date().toISOString();
  const method = PAY_METHOD_KEY_BY_LABEL[payload.paymentMethod] || payload.paymentMethod || "bank";
  const paymentStatus = method === "cash" ? "Хүргэлтэд төлнө" : "Төлбөр хүлээж байна";
  const order = {
    orderNo, createdAt: now,
    userId: null,
    customer: { ...payload.customer },
    items: payload.items,
    subtotal: payload.subtotal,
    shippingFee: payload.shippingFee,
    total: payload.total,
    delivery: { ...payload.delivery },
    customerNote: payload.customerNote || "",
    paymentMethod: method,
    paymentMethodLabel: payload.paymentMethod,
    paymentStatus,
    payments: [{ at: now, status: paymentStatus, source: "web", note: "Захиалга үүсгэгдлээ" }],
    status: "Шинэ захиалга",
    statusHistory: [{ status: "Шинэ захиалга", at: now, by: "систем" }]
  };
  /* Email-тай давхрассан хэрэглэгч байвал холбоно */
  if (order.customer.email) {
    const u = store.get(KEYS.users, []).find(x => (x.email || "").toLowerCase() === order.customer.email.toLowerCase());
    if (u) order.userId = u.id || ("legacy-" + u.email);
  }
  orders.unshift(order);
  store.set(KEYS.orders, orders);
  localAudit("захиалга үүсгэх", `${orderNo} · ${order.customer.phone}`);
  return { orderNo, paymentStatus, status: order.status };
}

/* Локал горимын өөрчлөлтийн бүртгэл (сервер байхгүй үед админ үйлдлүүд бүртгэгдэнэ) */
function localAudit(action, detail) {
  const arr = store.get(KEYS.audit, []);
  arr.push({ at: new Date().toISOString(), actor: (currentUser && currentUser.name) || "систем", action, detail: detail || "" });
  store.set(KEYS.audit, arr.slice(-500));
}

/* Бүтээгдэхүүний админ засварыг сервер лүү хадгалах (сервер горимд) */
async function pushProductPatch(id, patch) {
  if (!Data.server) return;
  try { await Data.req("PATCH", "/api/products/" + encodeURIComponent(id), patch); }
  catch (e) { console.warn("Серверт бүтээгдэхүүний засвар дамжсангүй:", e.message); }
}


/* Санамж: basePrice нь 30мл-ийн үнэ (₮). Бусад хэмжээ дараах хувааритгаар тооцоологдоно. */
const SIZE_FACTOR = { 30: 1, 50: 1.5, 100: 2.4, 150: 3.2 };
const sizePrice = (p, ml) => roundTo(p.basePrice * (SIZE_FACTOR[ml] || 1), 1000);
const minPrice = p => sizePrice(p, Math.min(...p.sizes));

/* Зургийн сан (Unsplash — тансаг лонхны зургууд) */
const _I = id => `https://images.unsplash.com/${id}?q=80&w=900&auto=format&fit=crop`;
const IMAGE_POOL = [
  "photo-1541643600914-78b084683601", "photo-1592945403244-b3fbafd7f539",
  "photo-1523293182086-7651a899d37f", "photo-1595425970377-c9703cf48b6d",
  "photo-1587017539504-67cfbddac569", "photo-1594035910387-fea47794261f",
  "photo-1585386959984-a4155224a1ad", "photo-1563170351-be82bc888aa4",
  "photo-1615529182904-14819c35db37", "photo-1613966802194-d46a163af70f",
  "photo-1608528577891-eb055944f2e7", "photo-1600612253971-422e7f7faeb6",
  "photo-1610461888750-10bfc601b874", "photo-1616604425736-1eb7cb2a56ee",
  "photo-1590736969955-71cc94901144", "photo-1588405748880-12d1d2a59f75",
  "photo-1557170334-a9632e77c6e4",   "photo-1586928363864-70d2818b98e1",
  "photo-1592914610354-fd354454b476", "photo-1622618991746-fe6004db3a47",
  "photo-1615634260167-c8cdede054de", "photo-1571781926291-c477ebfd024b",
  "photo-1615629498233-64df1687e6c6"
];

/* --- 3.1 Гараар бичсэн 20 БҮРЭН бүтээгдэхүүн --- */
const SEED_PRODUCTS = [
  {
    id: 1, name: "Блю де Шанель", brand: "Шанель", gender: "Эрэгтэй",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [30, 50, 100], basePrice: 165000,
    scentFamily: "Модлог", image: _I(IMAGE_POOL[0]), rating: 4.8, reviews: 4120, isNew: false,
    notes: { top: ["Грейпфрут", "Нимбэг", "Кардамон"], middle: ["Жасмин", "Лаванда"], base: ["Сандал", "Амбра", "Кедр"] },
    description: "Шанелийн эрхэм уламжлалд тулгуурласан эрчүүдийн тансаг үнэртэн. Эхний мөчид грейпфрут, нимбэгийн шинэлэг илч цэлмэж, зүрхэнд нь жасмины зөөлөн сэвгээр тоглож, сууриндаа сандал ба амбрагийн гүн үнэр байрлана. Өдөр болон шөнийн орчинд аль алинд ээлтэй, итгэл төрүүлэм байдлаар таны гарын үсэг болно."
  },
  {
    id: 2, name: "Саваж", brand: "Диор", gender: "Эрэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100], basePrice: 118000,
    scentFamily: "Дорнын", image: _I(IMAGE_POOL[1]), rating: 4.7, reviews: 5230, isNew: false,
    notes: { top: ["Бэргамот", "Хар перец"], middle: ["Лаванда", "Кардамон"], base: ["Амбра", "Уд Мод"] },
    description: "Диорийн шинэ зууны бэлгэдэл бүхий эрчүүдийн хамгийн эрэлт үнэртэн. Бэргамот ба халуун хар перецний эхний давалгаа эрч хүчийг бадрааж, амбра ба уд модны суурь гүн урт мэдрэмжийг үлдээнэ. Хотод болон байгальд, өдөр шөнө ялгахгүй тохирох төгс сонголт."
  },
  {
    id: 3, name: "Блэк Опиум", brand: "Ив Сен Лоран", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 128000,
    scentFamily: "Дорнын", image: _I(IMAGE_POOL[2]), rating: 4.9, reviews: 6020, isNew: false,
    notes: { top: ["Гүзээлзгэнэ", "Кассис"], middle: ["Сарнай", "Жасмин"], base: ["Ваниль", "Тамхи", "Пачули"] },
    description: "Ив Сен Лораны эмэгтэйчүүдийн шөнийн бэлгэдэл. Амтлаг гүзээлзгэнэ хар сарнай, жасмины зүрхэнд нийлж, ваниль ба тамхин навчийн гүн суурь хүртэл урт хугацаанд үнэрлэгдсээр байдаг. Үдшийн арга хэмжээнд онцгой тоглолт үзүүлнэ."
  },
  {
    id: 4, name: "Авентус", brand: "Крид", gender: "Эрэгтэй",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [30, 50, 100], basePrice: 235000,
    scentFamily: "Цитрус", image: _I(IMAGE_POOL[3]), rating: 5.0, reviews: 3100, isNew: false,
    notes: { top: ["Нимбэг", "Бэргамот", "Кассис"], middle: ["Иланг-иланг", "Сарнай"], base: ["Амбра", "Мускус", "Ветивер"] },
    description: "Кридийн дэлхий даяараа хүндлэгдсэн эрчүүдийн парфюм. Цэвэр нимбэг, бэргамотын эхний илч нь эрхэм иланг-илангийн зүрхэнд шилжсээр амбра, мускусын гүн суурьтай төгсдөг. Тусгай арга хэмжээ бүрд таныг ялгаруулна."
  },
  {
    id: 5, name: "Аква ди Жио", brand: "Армани", gender: "Юнисекс",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100, 150], basePrice: 89000,
    scentFamily: "Усны сэнгэнэсэн", image: _I(IMAGE_POOL[4]), rating: 4.7, reviews: 4800, isNew: false,
    notes: { top: ["Нимбэг", "Бэргамот", "Нероли"], middle: ["Жасмин", "Сарнай"], base: ["Ветивер", "Пачули", "Мускус"] },
    description: "Арманий далайн сүлдтэй юниверсес үнэртэн. Нимбэг, бэргамотын цитрусын эхлэл нь далайн салхинд нийлж, жасмин, сарнайн зөөлөн зүрх, ветиверийн суурь гарч ирнэ. Зуны өдрүүдэд хамгийн ээлтэй, хүн бүрт тохирох хөнгөн сонголт."
  },
  {
    id: 6, name: "Эрос", brand: "Версаче", gender: "Эрэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100], basePrice: 78000,
    scentFamily: "Амтлаг", image: _I(IMAGE_POOL[5]), rating: 4.6, reviews: 3900, isNew: false,
    notes: { top: ["Алим", "Кардамон"], middle: ["Жасмин", "Орхидея"], base: ["Ваниль", "Тонка", "Кедр"] },
    description: "Версачийн хүч чадлын бэлгэдэл. Алим ба кардамоны амтлаг эхлэл, орхидея, жасмины зүрх, ваниль ба тонкийн эрчимтэй суурь нь хүчтэй бөгөөд урт үнэрлэх чадвартай. Залуу үеийн шөнө үдшийн онцгой сонголт."
  },
  {
    id: 7, name: "Гүүд Гёрл", brand: "Каролина Эррера", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 105000,
    scentFamily: "Амтлаг", image: _I(IMAGE_POOL[6]), rating: 4.8, reviews: 4500, isNew: false,
    notes: { top: ["Кардамон", "Гүзээлзгэнэ"], middle: ["Тубероза", "Жасмин"], base: ["Ваниль", "Тонка", "Пачули"] },
    description: "Каролина Эррерагийн ирвэс хэлбэрийн лонхонд сүлдэрсэн тансаг үнэртэн. Кардамон ба гүзээлзгэний эхний амт, тубероза, жасминаас бүтсэн зүрх, ваниль ба тонкийн гүн суурь нь шөнийн тансаг орчинд ялгаран мэдрэгдэнэ."
  },
  {
    id: 8, name: "Ла Нуит де Л'Ом", brand: "Ив Сен Лоран", gender: "Эрэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100], basePrice: 108000,
    scentFamily: "Дорнын", image: _I(IMAGE_POOL[7]), rating: 4.7, reviews: 2700, isNew: false,
    notes: { top: ["Кардамон", "Хар перец"], middle: ["Лаванда", "Сарнай"], base: ["Ваниль", "Амбра"] },
    description: "Ив Сен Лораны шөнийн эрчүүдийн үнэртэн. Кардамон ба хар перецний халуун эхлэл, лаванда ба сарнайн зүрх, ваниль ба амбрагийн гүн суурь нь шөнийн хотын орчинд тансаг тоглолт үзүүлнэ. Хүйтэн сэрүүнд онцгой хүчирхэг."
  },
  {
    id: 9, name: "Мисс Диор", brand: "Диор", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 112000,
    scentFamily: "Цэцгийн", image: _I(IMAGE_POOL[8]), rating: 4.8, reviews: 3600, isNew: false,
    notes: { top: ["Алим", "Бэргамот"], middle: ["Жасмин", "Сарнай", "Пиони"], base: ["Мускус", "Ветивер"] },
    description: "Диорийн эмэгтэйчүүдийн үе үеийн дурлал. Алим ба бэргамотын шинэлэг эхлэл нь жасмин, сарнай, пионы баяр баясгалантай зүрхэнд нийлж, мускус ба ветиверийн зөөлөн суурьтай төгсдөг. Өдөр тутмын эрхэмсэг сонголт."
  },
  {
    id: 10, name: "Уд Вуд", brand: "Том Форд", gender: "Юнисекс",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [50, 100], basePrice: 178000,
    scentFamily: "Модлог", image: _I(IMAGE_POOL[9]), rating: 4.9, reviews: 2200, isNew: false,
    notes: { top: ["Кардамон", "Бэргамот"], middle: ["Сарнай", "Иланг-иланг"], base: ["Уд Мод", "Сандал", "Амбра"] },
    description: "Том Фордын эрэлт ховор уд модны тансаг бүтээл. Кардамон, бэргамотын эхний амтыг сарнай, иланг-илангийн зүрх дагуулж, уд, сандал, амбрагийн гүн суурь үлдээнэ. Эр, эм аль алинд ээлтэй тансаг сонголт."
  },
  {
    id: 11, name: "Тобако Ванила", brand: "Том Форд", gender: "Юнисекс",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [50, 100], basePrice: 185000,
    scentFamily: "Дорнын", image: _I(IMAGE_POOL[10]), rating: 4.8, reviews: 1800, isNew: false,
    notes: { top: ["Хар перец", "Кардамон"], middle: ["Пиони", "Тубероза"], base: ["Тамхи", "Ваниль", "Уд Мод"] },
    description: "Том Фордын хамгийн тансаг гэгдэх дорнын үнэртэн. Халуун хар перецний эхлэл, пион, туберозагийн зүрхний дараа тамхин навч, ваниль, уд модны гүн амтлаг суурь урт үнэрлэнэ. Хүйтэн улиралд онцгой хүчирхэг."
  },
  {
    id: 12, name: "Вүд Сэйж ба Си Солт", brand: "Жо Малон", gender: "Юнисекс",
    concentration: "Хөнгөн сэнгэнэсэн (2–5%)", sizes: [30, 50, 100], basePrice: 125000,
    scentFamily: "Усны сэнгэнэсэн", image: _I(IMAGE_POOL[11]), rating: 4.5, reviews: 1500, isNew: false,
    notes: { top: ["Кассис", "Гүзээлзгэнэ"], middle: ["Жасмин"], base: ["Ветивер", "Мускус", "Сандал"] },
    description: "Жо Малонгийн далайн эргийн сүлдтэй үнэртэн. Гүзээлзгэнэ ба кассисын шинэлэг эхлэл нь ветивер, мускусын модлог-усан суурьтай нийлж, хөнгөн аяллын мэдрэмж төрүүлнэ. Одеколон түвшний хөнгөн, цэвэрхэн үнэр."
  },
  {
    id: 13, name: "Брайт Кристал", brand: "Версаче", gender: "Эмэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100], basePrice: 82000,
    scentFamily: "Цэцгийн", image: _I(IMAGE_POOL[12]), rating: 4.5, reviews: 2100, isNew: false,
    notes: { top: ["Гүзээлзгэнэ", "Бэргамот"], middle: ["Пиони", "Орхидея", "Сарнай"], base: ["Мускус", "Амбра"] },
    description: "Версачийн гялгар бриллиантын бэлгэдэл. Гүзээлзгэнэ ба бэргамотын эхний илч, пион, орхидея, сарнайн цэцгийн зүрх, мускус, амбрагийн зөөлөн суурь нь зөөлөн эрхэмсэг эмэгтэй үнэр бүтээнэ. Өдрийн гэрэлд онцгой сайхан."
  },
  {
    id: 14, name: "Сильвер Маунтин Уотер", brand: "Крид", gender: "Эрэгтэй",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [30, 50, 100], basePrice: 225000,
    scentFamily: "Усны сэнгэнэсэн", image: _I(IMAGE_POOL[13]), rating: 4.7, reviews: 1300, isNew: false,
    notes: { top: ["Бэргамот", "Нимбэг"], middle: ["Жасмин", "Иланг-иланг"], base: ["Мускус", "Амбра", "Сандал"] },
    description: "Кридийн цаст уулсын цэвэр агаарын сүлд. Бэргамот, нимбэгийн хүйтэн шинэлэг эхлэл, жасмин, иланг-илангийн зүрх, мускус ба амбрагийн суурь нь тайван бөгөөд тодорхой тансаг үнэр бүтээнэ."
  },
  {
    id: 15, name: "Аква ди Жио Профумо", brand: "Армани", gender: "Эрэгтэй",
    concentration: "Маш гүн тогтоцтой (20–30%)", sizes: [30, 50, 100], basePrice: 138000,
    scentFamily: "Усны сэнгэнэсэн", image: _I(IMAGE_POOL[14]), rating: 4.8, reviews: 1400, isNew: false,
    notes: { top: ["Бэргамот", "Нероли", "Кардамон"], middle: ["Лаванда", "Жасмин"], base: ["Сандал", "Пачули", "Амбра"] },
    description: "Арманий далайн үнэрийн парфюм түвшний хувилбар. Нероли ба бэргамотын эхний илч, лаванда ба жасмины зүрх, сандал ба амбрагийн гүн суурь нь далайн сэвгэлийг урт хугацаанд хадгална."
  },
  {
    id: 16, name: "Гуччи Блум", brand: "Гуччи", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 95000,
    scentFamily: "Цэцгийн", image: _I(IMAGE_POOL[15]), rating: 4.6, reviews: 2500, isNew: false,
    notes: { top: ["Бэргамот", "Гүзээлзгэнэ"], middle: ["Жасмин", "Тубероза", "Сарнай"], base: ["Мускус", "Сандал"] },
    description: "Гуччийн цэцэг нээгдэх мөчийг дүрсэлсэн эмэгтэйчүүдийн үнэртэн. Нероли, гүзээлзгэний эхний амт, жасмин, тубероза, сарнайн бүрэн зүрх, мускус ба сандалын зөөлөн суурь нь эмэгтэйлэг орчин үеийн романтик төрхийг бүтээнэ."
  },
  {
    id: 17, name: "Ла Ви Э Бель", brand: "Ланком", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 98000,
    scentFamily: "Цэцгийн", image: _I(IMAGE_POOL[16]), rating: 4.7, reviews: 3300, isNew: false,
    notes: { top: ["Кассис", "Бэргамот"], middle: ["Жасмин", "Сарнай"], base: ["Ваниль", "Пачули", "Мускус"] },
    description: "Ланкомын аз жаргалын бэлгэдэл. Кассис ба бэргамотын шинэлэг эхлэл, жасмин ба сарнайн цэцгийн зүрх, ваниль ба пачулийн амтлаг суурь нь эерэг мэдрэмжийг өдөөнө. Өдөр тутмын эерэг энергийн эх үүсвэр."
  },
  {
    id: 18, name: "Инвиктус", brand: "Пако Рабан", gender: "Эрэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [30, 50, 100, 150], basePrice: 86000,
    scentFamily: "Цитрус", image: _I(IMAGE_POOL[17]), rating: 4.5, reviews: 2900, isNew: false,
    notes: { top: ["Грейпфрут", "Бэргамот"], middle: ["Лаванда", "Жасмин"], base: ["Амбра", "Кедр", "Мускус"] },
    description: "Пако Рабаны ялалтын бэлгэдэлтэй лонх. Грейпфрут ба бэргамотын эхний довтолгоо, лаванда ба жасмины зүрх, амбра ба кедрийн суурьтай золголсноор хүчтэй шинэлэг эрчүүдийн үнэр бүтнэ. Спорт болон өдрийн хэрэглээнд ээлтэй."
  },
  {
    id: 19, name: "Парадокс", brand: "Прада", gender: "Эмэгтэй",
    concentration: "Өндөр тогтоцтой (15–20%)", sizes: [30, 50, 100], basePrice: 102000,
    scentFamily: "Цэцгийн", image: _I(IMAGE_POOL[18]), rating: 4.6, reviews: 1100, isNew: true,
    notes: { top: ["Бэргамот", "Кардамон"], middle: ["Жасмин", "Орхидея"], base: ["Мускус", "Ваниль", "Сандал"] },
    description: "Прадагийн орчин үеийн эмэгтэйчүүдийн үнэртэн. Бэргамот ба кардамоны шинэлэг эхлэл, жасмин ба орхидея цэцгийн зүрх, мускус ба ванилийн зөөлөн суурь нь дэгжин, ялгаатай төрхийг бүтээнэ."
  },
  {
    id: 20, name: "Мистер Бюрберри", brand: "Бюрберри", gender: "Эрэгтэй",
    concentration: "Дундаж тогтоцтой (5–15%)", sizes: [50, 100], basePrice: 92000,
    scentFamily: "Модлог", image: _I(IMAGE_POOL[19]), rating: 4.4, reviews: 900, isNew: false,
    notes: { top: ["Бэргамот", "Грейпфрут"], middle: ["Лаванда"], base: ["Ветивер", "Кедр", "Амбра"] },
    description: "Бюрберригийн Лондоны орчин үеийн эрчүүдийн үнэртэн. Бэргамот ба грейпфрутын эхний амт, лавандын эрхэм зүрх, ветивер ба кедрийн модлог суурь нь албан ёсны болон албан бус орчинд адилхан тохирно."
  }
];

/* --- 3.2 Нэмэлт сан: брэнд бүрийн загварууд (Монгол кирилл үсгээрээ) ---
   [брэнд, загварнээс, хүйс | null] — хүйс тодорхойгүй бол генератор шийднэ */
const CURATED_PAIRS = [
  /* Шанель — 6 */
  ["Шанель", "Шанель №5", "Эмэгтэй"],   ["Шанель", "Коко Мадемуазель", "Эмэгтэй"],
  ["Шанель", "Шанс", "Эмэгтэй"],        ["Шанель", "Габриэль", "Эмэгтэй"],
  ["Шанель", "Антиёз", "Эмэгтэй"],      ["Шанель", "Аллюр Омм", "Эрэгтэй"],
  /* Диор — 6 */
  ["Диор", "Саваж Парфюм", "Эрэгтэй"],  ["Диор", "Диор Омм", "Эрэгтэй"],
  ["Диор", "Фаренгайт", "Эрэгтэй"],     ["Диор", "Мисс Диор Блуминг", "Эмэгтэй"],
  ["Диор", "Жадор", "Эмэгтэй"],         ["Диор", "Пуассон", "Эмэгтэй"],
  /* Том Форд — 6 */
  ["Том Форд", "Блэк Орхид", "Эмэгтэй"], ["Том Форд", "Нероли Портофино", "Юнисекс"],
  ["Том Форд", "Солеил Блан", "Юнисекс"],["Том Форд", "Омбр Леатер", "Юнисекс"],
  ["Том Форд", "Тобакко Оуд", "Юнисекс"],["Том Форд", "Ваниль Фаталь", "Юнисекс"],
  /* Ив Сен Лоран — 5 */
  ["Ив Сен Лоран", "Мон Пари", "Эмэгтэй"],["Ив Сен Лоран", "Бэйб Кэт", "Эмэгтэй"],
  ["Ив Сен Лоран", "Л'Ом", "Эрэгтэй"],   ["Ив Сен Лоран", "Блэк Опиум Интенс", "Эмэгтэй"],
  ["Ив Сен Лоран", "Либр", "Эмэгтэй"],
  /* Версаче — 4 */
  ["Версаче", "Дилан Блю", "Эрэгтэй"],   ["Версаче", "Эрос Флэйм", "Эрэгтэй"],
  ["Версаче", "Брайт Кристал Абсолю", "Эмэгтэй"], ["Версаче", "Эрос Парфюм", "Эрэгтэй"],
  /* Жо Малон — 4 */
  ["Жо Малон", "Лайм Бэзил ба Мандарин", "Эмэгтэй"], ["Жо Малон", "Инглиш Пир ба Фрезиа", "Эмэгтэй"],
  ["Жо Малон", "Пиони ба Блаш Суэд", "Эмэгтэй"],     ["Жо Малон", "Амбра ба Лаванда", "Юнисекс"],
  /* Крид — 4 */
  ["Крид", "Миллесиме Империал", "Юнисекс"], ["Крид", "Грин Айриш Твид", "Эрэгтэй"],
  ["Крид", "Викинг", "Эрэгтэй"],             ["Крид", "Роял Оуд", "Юнисекс"],
  /* Армани — 5 */
  ["Армани", "Си", "Эмэгтэй"], ["Армани", "Си Интенс", "Эмэгтэй"],
  ["Армани", "Армани Код", "Эрэгтэй"], ["Армани", "Си Пассионе", "Эмэгтэй"],
  ["Армани", "Стронджер Вит Ю", "Эрэгтэй"],
  /* Гуччи — 5 */
  ["Гуччи", "Гуччи Гилти", "Юнисекс"],
  ["Гуччи", "Гуччи Флора", "Эмэгтэй"], ["Гуччи", "Флора Гардениа", "Эмэгтэй"],
  ["Гуччи", "Гуччи Бамбу", "Юнисекс"], ["Гуччи", "Гилти Парфюм", "Юнисекс"],
  /* Прада — 3 */
  ["Прада", "Ла Фём", "Эмэгтэй"], ["Прада", "Л'Ом де Прада", "Эрэгтэй"], ["Прада", "Прада Канди", "Эмэгтэй"],
  /* Валентино — 4 */
  ["Валентино", "Валентина", "Эмэгтэй"], ["Валентино", "Воче Вива", "Эмэгтэй"],
  ["Валентино", "Донна Борн Ин Рома", "Эмэгтэй"], ["Валентино", "Уоммо Борн Ин Рома", "Эрэгтэй"],
  /* Бюрберри — 3 */
  ["Бюрберри", "Бюрберри Брит", "Эмэгтэй"], ["Бюрберри", "Ми Бюрберри", "Эмэгтэй"],
  ["Бюрберри", "Бюрберри Хёр", "Эмэгтэй"],
  /* Каролина Эррера — 4 */
  ["Каролина Эррера", "212 ВИП", "Эмэгтэй"], ["Каролина Эррера", "Ч Мэн", "Эрэгтэй"],
  ["Каролина Эррера", "Гүүд Гёрл Лежер", "Эмэгтэй"], ["Каролина Эррера", "Гүүд Гёрл Супер", "Эмэгтэй"],
  /* Пако Рабан — 4 */
  ["Пако Рабан", "1 Миллион", "Эрэгтэй"], ["Пако Рабан", "Леди Миллион", "Эмэгтэй"],
  ["Пако Рабан", "Фантом", "Эрэгтэй"], ["Пако Рабан", "1 Миллион Парфюм", "Эрэгтэй"],
  /* Долче Габбана — 4 */
  ["Долче Габбана", "Лайт Блю", "Эмэгтэй"], ["Долче Габбана", "Зэ Ван", "Юнисекс"],
  ["Долче Габбана", "Интенсо", "Эрэгтэй"], ["Долче Габбана", "Лайт Блю Интенс", "Эмэгтэй"],
  /* Герлен — 4 */
  ["Герлен", "Л'Ом Идеал", "Эрэгтэй"], ["Герлен", "Мон Герлен", "Эмэгтэй"],
  ["Герлен", "Шалимар", "Эмэгтэй"], ["Герлен", "Ла Пти Роб Нуар", "Эмэгтэй"],
  /* Живанши — 5 */
  ["Живанши", "Вери Иррезистибл", "Эмэгтэй"], ["Живанши", "Джентльмен", "Эрэгтэй"],
  ["Живанши", "Джентльмен Сосиэти", "Эрэгтэй"], ["Живанши", "Интердит", "Эмэгтэй"],
  ["Живанши", "Пи", "Эрэгтэй"],
  /* Ланком — 2 */
  ["Ланком", "Идол", "Эмэгтэй"], ["Ланком", "Трезор", "Эмэгтэй"],
  /* Хьюго Босс — 2 */
  ["Хьюго Босс", "Босс Ботл", "Эрэгтэй"], ["Хьюго Босс", "Босс Нюи", "Эмэгтэй"]
];

/* --- 3.3 Детермин генератор --- */
const CONCENTRATIONS = ["Маш гүн тогтоцтой (20–30%)", "Өндөр тогтоцтой (15–20%)", "Дундаж тогтоцтой (5–15%)", "Хөнгөн сэнгэнэсэн (2–5%)"];
const FAMILIES = ["Модлог", "Цэцгийн", "Дорнын", "Цитрус", "Амтлаг", "Усны сэнгэнэсэн"];

/* Үнэрийн гэр бүл бүрийн ноотууд */
const FAM_NOTES = {
  "Модлог":          { top: ["Бэргамот", "Кардамон", "Хар перец", "Алим"], middle: ["Лаванда", "Жасмин", "Сарнай"], base: ["Сандал", "Кедр", "Ветивер", "Пачули", "Уд Мод"] },
  "Цэцгийн":         { top: ["Бэргамот", "Нероли", "Гүзээлзгэнэ"], middle: ["Жасмин", "Сарнай", "Пиони", "Тубероза", "Орхидея", "Фрезиа"], base: ["Мускус", "Сандал", "Ваниль"] },
  "Дорнын":          { top: ["Кардамон", "Хар перец", "Бэргамот"], middle: ["Сарнай", "Иланг-иланг", "Лаванда"], base: ["Ваниль", "Амбра", "Тонка", "Уд Мод", "Тамхи"] },
  "Цитрус":          { top: ["Нимбэг", "Мандарин", "Грейпфрут", "Бэргамот"], middle: ["Нероли", "Лаванда", "Жасмин"], base: ["Мускус", "Кедр", "Ветивер"] },
  "Амтлаг":          { top: ["Гүзээлзгэнэ", "Кассис", "Алим"], middle: ["Иланг-иланг", "Сарнай", "Орхидея"], base: ["Ваниль", "Тонка", "Пачули", "Мускус"] },
  "Усны сэнгэнэсэн": { top: ["Грейпфрут", "Бэргамот", "Нимбэг", "Нероли"], middle: ["Жасмин", "Лаванда", "Фрезиа"], base: ["Мускус", "Амбра", "Ветивер", "Кедр"] }
};

/* Брэнд бүрийн үнийн зэрэглэл — [их бага bund?] хоёр зааг: 30мл үнэ, мянган ₮ */
const BRAND_TIER = {
  "Крид": [200, 290], "Том Форд": [165, 240], "Шанель": [125, 205], "Герлен": [115, 175],
  "Жо Малон": [115, 150], "Ив Сен Лоран": [105, 160], "Диор": [110, 170], "Ланком": [80, 115],
  "Армани": [85, 125], "Гуччи": [88, 135], "Прада": [90, 130], "Версаче": [52, 85],
  "Пако Рабан": [70, 105], "Долче Габбана": [60, 100], "Бюрберри": [58, 92],
  "Валентино": [65, 100], "Каролина Эррера": [68, 105], "Живанши": [65, 100], "Хьюго Босс": [48, 75]
};

/* Загваруудын онцгой концентрацийн шийдвэр */
const CONC_HINTS = { "Омбр Леатер": "Маш гүн тогтоцтой (20–30%)", "Тобакко Оуд": "Маш гүн тогтоцтой (20–30%)", "Ваниль Фаталь": "Маш гүн тогтоцтой (20–30%)", "Роял Оуд": "Маш гүн тогтоцтой (20–30%)" };
const SIZE_PATTERNS = [[30, 50, 100], [50, 100], [30, 50], [100], [30, 50, 100, 150], [30, 100]];

/* Тайлбар бүтээх хэвүүд (генератор ашиглана) */
const DESC_TEMPLATES = [
  "{BN} брэндийн {F} гэр бүлийн {C} түвшний үнэртэн. Эхний мөчид {T} сэтгэлийг бадрааж, зүрхэнд {M} тоглосоор, {B} гүн суурьтай төгсдөг.",
  "{N} нь {BN} брэндийн {F} сэдэвт үнэртэн бөгөөд {T} хосолсон нээлт, {M} зүрх, {B} сууритай. Аливаа улиралд ээлтэй бөгөөд урт хугацаанд үнэрлэнэ.",
  "Эрхэмсэг {BN} брэндийн бүтээл болох {N} нь {T} эхний илчтэй, {M} зүрх, {B} сууритай, {F} гэр бүлийн {C} үнэртэн. Хотод, аялалд, баяр ёслолд аль ч нөхцөлд жигд тоглодог.",
  "{BN} брэндийн {N} нь {T} ба {M} хослолоор эхлэн {B} суурьтай, {F} хэв маягийн {C}. Өдрийн гэрэлд эрхэмсэг, үдшийн дурсамжид тансаг мэдрэмжийг үлдээнэ."
];
const DESC_TAILS = [
  " Хэрэглэгчид үнэлгээндээ урт хугацааны үнэрлэлтийг онцолж байна.",
  " Албан ёсны болон албан бус орчинд ялгаагүй тэнцвэртэй."
];

function toTierPrice(rng, tier) { return (tier[0] + rng() * (tier[1] - tier[0])) * 1000; }

/* Нэг загварын бичилalta бүтээгдэхүүний объект бүтээх */
function makeGenerated(id, brand, name, genderHint) {
  const rng = rand(strHash(brand + "|" + name));
  const gender = genderHint || pickWeighted(rng, [["Эрэгтэй", 38], ["Эмэгтэй", 40], ["Юнисекс", 22]]);
  const concentration = CONC_HINTS[name] || pickWeighted(rng, [["Дундаж тогтоцтой (5–15%)", 34], ["Өндөр тогтоцтой (15–20%)", 38], ["Маш гүн тогтоцтой (20–30%)", 16], ["Хөнгөн сэнгэнэсэн (2–5%)", 12]]);
  const sizes = pickWeighted(rng, [
    [SIZE_PATTERNS[0], 45], [SIZE_PATTERNS[1], 18], [SIZE_PATTERNS[2], 15],
    [SIZE_PATTERNS[3], 7], [SIZE_PATTERNS[4], 10], [SIZE_PATTERNS[5], 5]
  ]);
  const fam = pickWeighted(rng, [
    ["Цэцгийн", 24], ["Дорнын", 20], ["Модлог", 18],
    ["Цитрус", 15], ["Амтлаг", 13], ["Усны сэнгэнэсэн", 10]
  ]);
  const np = FAM_NOTES[fam];
  const notes = {
    top: pickSome(rng, np.top, rng() < 0.6 ? 3 : 2),
    middle: pickSome(rng, np.middle, rng() < 0.7 ? 2 : 1),
    base: pickSome(rng, np.base, rng() < 0.7 ? 3 : 2)
  };
  const tier = BRAND_TIER[brand] || [70, 120];
  const basePrice = roundTo(toTierPrice(rng, tier), 1000);
  const rating = Math.min(5, (39 + Math.floor(rng() * 12)) / 10);
  const reviews = 120 + Math.floor(rng() * 4300);
  const image = _I(IMAGE_POOL[strHash(name + brand) % IMAGE_POOL.length]);
  const jlist = arr => arr.join(", ");
  const tpl = DESC_TEMPLATES[Math.floor(rng() * DESC_TEMPLATES.length)];
  const description = tpl
    .replace("{BN}", brand).replace("{N}", name)
    .replace("{F}", fam.toLowerCase()).replace("{C}", concentration.toLowerCase())
    .replace("{T}", jlist(notes.top)).replace("{M}", jlist(notes.middle)).replace("{B}", jlist(notes.base))
    + (rng() < 0.5 ? DESC_TAILS[0] : DESC_TAILS[1]);
  return {
    id, name, brand, gender, concentration, sizes, basePrice,
    scentFamily: fam, notes, rating, reviews, image, description,
    isNew: rng() < 0.13, generated: true
  };
}

/* --- 3.4 Нийт каталог: 20 гараар бичсэн + 80 generated = шууд 100 ---
   Админы засвар (localStorage) шууд байнгын дата дээр нэгтгэгдэнэ. */
function buildCatalog() {
  const out = [...SEED_PRODUCTS];
  let nextId = SEED_PRODUCTS.length + 1;
  for (const [brand, name, g] of CURATED_PAIRS) {
    if (out.length >= 100) break;
    out.push(makeGenerated(nextId++, brand, name, g === null || g === undefined ? null : g));
  }
  /* Хэрэв 100 дүүрээгүй бол flanker иж бүрдэлээр дүүргэнэ (ихэнхдээ хэрэггүй) */
  const FLANKERS = ["Интенс", "Абсолют", "Лайт", "Империал", "Ноир"];
  let i = 0;
  while (out.length < 100) {
    const src = out[i % out.length];
    const nm = src.name + " " + FLANKERS[(i + 1) % FLANKERS.length];
    out.push(makeGenerated(nextId++, src.brand, nm, src.gender));
    i++;
  }
  return out.slice(0, 100);
}

function loadProducts() {
  const base = buildCatalog();
  const over = store.get(KEYS.pOver, {});
  base.forEach(p => { if (over[p.id]) { Object.assign(p, over[p.id]); p.edited = true; } });
  const custom = store.get(KEYS.pCustom, []);
  return custom.slice().reverse().concat(base); /* шинээр нэмсэнүүд хамгийн урд */
}

let PRODUCTS = loadProducts();
let ALL_BRANDS = Array.from(new Set(PRODUCTS.map(p => p.brand))).sort((a, b) => a.localeCompare(b, "mn"));
console.info("НорВэ каталог: " + PRODUCTS.length + " бүтээгдэхүүн ачаалагдалаа.");

function computeAllBrands() {
  ALL_BRANDS = Array.from(new Set(PRODUCTS.map(p => p.brand))).sort((a, b) => a.localeCompare(b, "mn"));
}
function nextCustomId() {
  return Math.max(100, ...PRODUCTS.map(p => Number(p.id) || 0)) + 1;
}
/* Сүүлд хийсэн админ засварыг PRODUCTS хувьсагчид шууд хэрэгжүүлэх */
function applyProductData(id, patch) {
  const p = PRODUCTS.find(x => x.id === Number(id));
  if (p) Object.assign(p, patch, { edited: true });
  return p;
}
/* id-гаар бүтээгдэхүүн олох */
const byId = id => PRODUCTS.find(p => p.id === Number(id));

/* --- 3.6 Виллийн дуртгал: тогтоц, түгэлт, улирал, найрлагын түүх ---
   Бүтээгдэхүүн бүр өөрийн тогтвортой seed-ээс тулгуур бодогддог тул
   хуудас бүрд яг ижил үзүүлэлт гарна. */
const LONG_LEVEL = pct =>
  pct >= 88 ? { label: "Маш өндөр", time: "8–12 цаг" } :
  pct >= 72 ? { label: "Өндөр",      time: "6–8 цаг"  } :
  pct >= 52 ? { label: "Дунд зэрэг", time: "4–6 цаг"  } :
              { label: "Хөнгөн",     time: "2–4 цаг"  };

const SIL_LLAGE_LABEL = pct =>
  pct >= 80 ? "Гүнзгий, анхаарал татахуйц" :
  pct >= 58 ? "Тод, эргэн тойронд мэдрэгдэх" :
  pct >= 36 ? "Зөөлөн, арьсан дээр ойрхон" :
              "Хувийн, маш ойрхон";

const SEASON_BASE = {
  "Дорнын":          ["Өвөл", "Намар"],
  "Модлог":          ["Намар", "Өвөл"],
  "Амтлаг":          ["Өвөл", "Намар"],
  "Цэцгийн":         ["Хавар", "Зун"],
  "Цитрус":          ["Зун", "Хавар"],
  "Усны сэнгэнэсэн": ["Зун", "Хавар"]
};

const _fragCache = new Map();

function buildStory(p, day, rng) {
  const T = p.notes.top.join(", ");
  const M = p.notes.middle.join(", ");
  const B = p.notes.base.join(", ");
  const openLine = day
    ? `Энэхүү бүтээл нь гэрэлт өдрийн ауринд хамгийн сайн илэрдэг.`
    : `Энэхүү бүтээл нь оройн гэрэлт орчинд онцгой гүнзгий цацрагтай.`;
  const body = `Лонхны сийлбэр нээгдэх мөчийн урвал: баатор байгалийн ${T} хурц сэнгэнэсэн давалгаагаар толгойг сургадаг бол 2–4 цагийн дотор ${M} зүрхэн ноот наядаж, үнэртний гол амин сүнс таны арьсны халуунд уусан түгдэг. Эцэст нь ${B}-ийн бодисууд аажуухан уумлан, 6–12+ цагийн гүн урт мөр үлдээнэ. Хамгийн анхны мөчөөс сүүлийн амьсгал хүртэл эдгээр байгалийн нэрс эргэн ороход «${p.name}» танай илрэх аур болж, ойр орчмоо тансаг тоглолтонд татдаг.`;
  return `${openLine} ${body}`;
}

function fragData(p) {
  const key = [p.id, p.name, p.brand, p.scentFamily, p.concentration].join("|");
  if (_fragCache.has(key)) return _fragCache.get(key);
  const rng = rand(strHash(p.brand + "ноот" + p.name));
  const concBoost = { "Маш гүн тогтоцтой (20–30%)": 24, "Өндөр тогтоцтой (15–20%)": 13, "Дундаж тогтоцтой (5–15%)": 3, "Хөнгөн сэнгэнэсэн (2–5%)": -12 }[p.concentration] || 0;
  const famBoost  = { "Дорнын": 14, "Модлог": 10, "Амтлаг": 6, "Цэцгийн": 1, "Цитрус": -9, "Усны сэнгэнэсэн": -7 }[p.scentFamily] || 0;
  const longevity = clamp(50 + concBoost + famBoost + Math.round(rng() * 16 - 8), 22, 98);
  const sillage   = clamp(46 + concBoost * 0.85 + famBoost + Math.round(rng() * 18 - 9), 18, 96);
  const seasons = (SEASON_BASE[p.scentFamily] || ["Хавар", "Зун"]).slice();
  const rest = ["Өвөл", "Хавар", "Зун", "Намар"].filter(s => !seasons.includes(s));
  if (rng() < 0.38 && rest.length) seasons.push(rest[Math.floor(rng() * rest.length)]);
  const dd = { "Цитрус": 0.92, "Усны сэнгэнэсэн": 0.88, "Цэцгийн": 0.76, "Модлог": 0.6, "Амтлаг": 0.48, "Дорнын": 0.4 }[p.scentFamily] ?? 0.7;
  const dayBias = clamp(dd + concBoost / 100 + (rng() * 0.14 - 0.07), 0.12, 0.95);
  const day = dayBias >= 0.5;
  const data = {
    longevity,
    longevityLabel: LONG_LEVEL(longevity),
    sillage,
    sillageLabel: SIL_LLAGE_LABEL(sillage),
    seasons,
    day,
    evening: !day,
    story: buildStory(p, day, rng)
  };
  _fragCache.set(key, data);
  return data;
}

/* ---------- 4. Гол төлөв: сагс, хүслийн жагсаалт, хэрэглэгч ---------- */
let cart        = store.get(KEYS.cart, []);
let wishlist    = store.get(KEYS.wish, []);
let currentUser = store.get(KEYS.user, null);

const saveCart = () => store.set(KEYS.cart, cart);
const saveWish = () => store.set(KEYS.wish, wishlist);
const saveUser = () => store.set(KEYS.user, currentUser);

/* Нэр бүтээх: Овог + Нэр (хуучин бүртгэлтэй нийцүүлэн) */
const fullName = u => {
  if (!u) return "Хэрэглэгч";
  if (u.firstName || u.lastName) return (u.lastName ? u.lastName + " " : "") + (u.firstName || "");
  return u.name || "Хэрэглэгч";
};

const cartCount = () => cart.reduce((a, it) => a + it.qty, 0);
const cartTotal = () => cart.reduce((sum, it) => {
  const p = byId(it.id);
  return sum + (p ? sizePrice(p, it.size) * it.qty : 0);
}, 0);

/* Сагс нэм/тоо өөрчил/устгах */
function addToCart(id, size, qty = 1, silent = false) {
  const p = byId(id);
  if (!p) return;
  const chosen = p.sizes.includes(Number(size)) ? Number(size) : p.sizes[Math.floor(p.sizes.length / 2)];
  const line = cart.find(it => it.id === p.id && it.size === chosen);
  if (line) line.qty = clamp(line.qty + qty, 1, 99);
  else cart.push({ id: p.id, size: chosen, qty: clamp(qty, 1, 99) });
  saveCart(); updateCartBadge();
  if (!silent) toast(`“${p.name}” сагсанд амжилттай нэмэгдлээ`);
}

function changeCartQty(id, size, delta) {
  const line = cart.find(it => it.id === Number(id) && it.size === Number(size));
  if (!line) return;
  line.qty = clamp(line.qty + delta, 1, 99);
  saveCart(); updateCartBadge(); renderCartDrawer();
}

function removeFromCart(id, size) {
  cart = cart.filter(it => !(it.id === Number(id) && it.size === Number(size)));
  saveCart(); updateCartBadge(); renderCartDrawer();
  toast("Сагслалгаас хасагдлаа");
}

/* Хүслийн жагсаалт */
function toggleWish(id) {
  const n = Number(id);
  const i = wishlist.indexOf(n);
  if (i < 0) { wishlist.push(n); toast("Хадгалсан үнэртэнд нэмэгдлээ"); }
  else { wishlist.splice(i, 1); toast("Хадгалсан үнэртэнээс хасагдлаа"); }
  saveWish(); refreshWishHearts();
  if (document.body.dataset.page === "account" && window.__renderWish) window.__renderWish();
}

/* ---------- 5. Гадна бүрдэл — SVG тэмдэгүүд & жижиг рендерүүд ---------- */
const svgWrap = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
  bag:   svgWrap('<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  plusBag: svgWrap('<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M12 11v5M9.5 13.5h5"/>'),
  heart: svgWrap('<path d="M12 20s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 7.6 5.2 5.2 0 0 1 21.3 11C19.5 15.4 12 20 12 20z"/>'),
  trash: svgWrap('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  x:     svgWrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svgWrap('<path d="M4 12.5l5 5L20 6.5"/>'),
  search: svgWrap('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  user:  svgWrap('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5S18.5 17 20 21"/>'),
  truck: svgWrap('<path d="M2 6h13v11H2zM15 10h4l3 3v4h-7z"/><circle cx="6.5" cy="17" r="1.6"/><circle cx="17.5" cy="17" r="1.6"/>'),
  shield: svgWrap('<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
  gem:   svgWrap('<path d="M6 4h12l3 6-9 10L3 10l3-6z"/><path d="M3 10h18M9 4l3 16M15 4l-3 16"/>'),
  copy:  svgWrap('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  wallet: svgWrap('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>'),
  mapPin: svgWrap('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  qr:    svgWrap('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h3v3h-3zM20 14v6M14 20h3"/>'),
  bank:  svgWrap('<path d="M3 10l9-6 9 6M5 10v9M9.5 10v9M14.5 10v9M19 10v9M3 19h18"/>'),
  cash:  svgWrap('<rect x="2" y="7" width="20" height="11" rx="2"/><circle cx="12" cy="12.5" r="2.6"/><path d="M5 10h.01M19 15h.01"/>'),
  mail:  svgWrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  send:  svgWrap('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>'),
  leaf:  svgWrap('<path d="M5 19C5 9 13 5 20 5c-1 8-5 14-13 14h-2z"/><path d="M5 19c3-6 7-9 11-11"/>'),
  arrow: svgWrap('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  chevD: svgWrap('<path d="M6 9l6 6 6-6"/>'),
  gift:  svgWrap('<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 9h18M12 9v11M6 9c-2-2-1-5 1-4.5S12 9 12 9s3.5-2 5-2.5S17 9 15 9"/>'),
  info:  svgWrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  /* --- Шинэ тэмдэгүүд (пирамид, түргэн үзэх, админ) --- */
  sun:     svgWrap('<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>'),
  heartFull: svgWrap('<path d="M12 20s-7.5-4.6-9.3-9A5.2 5.2 0 0 1 12 7.6 5.2 5.2 0 0 1 21.3 11C19.5 15.4 12 20 12 20z"/>'),
  drop:    svgWrap('<path d="M12 3c3.6 4.2 5.6 7 5.6 9.8a5.6 5.6 0 0 1-11.2 0C6.4 10 8.4 7.2 12 3z"/>'),
  sparkle: svgWrap('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>'),
  moon:    svgWrap('<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"/>'),
  eye:     svgWrap('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  pencil:  svgWrap('<path d="M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z"/><path d="M14.5 6l3.5 3.5"/>'),
  crown:   svgWrap('<path d="M3 8l4.5 4L12 6l4.5 6L21 8l-2 11H5L3 8z"/>'),
  clock:   svgWrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
  gear:    svgWrap('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>'),
  plus:    svgWrap('<path d="M12 5v14M5 12h14"/>'),
  reset:   svgWrap('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>')
};

/* 5 одтой үнэлгээний rendering */
function starsHTML(rating) {
  const pct = clamp(rating / 5 * 100, 0, 100);
  return `<span class="stars" aria-label="${rating} оноо"><span aria-hidden="true">★★★★★</span><span class="fill" style="width:${pct}%;" aria-hidden="true">★★★★★</span></span>`;
}

/* Бүтээгдэхүүний карт (нүүр, каталог, займ? — бүх хуудас хамт ашиглана) */
function productCardHTML(p) {
  const wished = wishlist.includes(p.id);
  const isAdminUser = isAdmin();
  return `
  <article class="product-card reveal" data-id="${p.id}">
    <a class="card-media" href="product.html?id=${p.id}" aria-label="${esc(p.brand)} ${esc(p.name)}">
      <img src="${p.image}" alt="${esc(p.brand)} ${esc(p.name)} — үнэртний лонх" loading="lazy">
      ${p.isNew ? '<span class="badge-new">Шинэ</span>' : ''}
      ${p.edited && isAdminUser ? '<span class="badge-edit">Админ засварласан</span>' : ''}
    </a>
    <button class="card-qv" data-qv="${p.id}" aria-label="Түргэн үзэх">${ICONS.eye}</button>
    ${isAdminUser ? `<button class="card-edit" data-edit="${p.id}" aria-label="Бүтээгдэхүүн засах">${ICONS.pencil}</button>` : ""}
    <button class="card-heart${wished ? " active" : ""}" data-wish="${p.id}" aria-label="Хүслийн жагсаалт">${ICONS.heart}</button>
    <div class="card-body">
      <p class="card-brand">${esc(p.brand)}</p>
      <h3 class="card-name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
      <div class="card-meta">${starsHTML(p.rating)}<span>${p.rating.toFixed(1)}</span><span>· ${p.reviews.toLocaleString("ru-RU")} үнэлгээ</span></div>
      <div class="card-foot">
        <p class="card-price">${fmtMNT(minPrice(p))}<small>${Math.min(...p.sizes)}мл-ээс</small></p>
        <button class="card-add" data-add="${p.id}" aria-label="${esc(p.name)} сагслах">${ICONS.plusBag}</button>
      </div>
    </div>
  </article>`;
}

function refreshWishHearts() {
  $$("[data-wish]").forEach(btn => btn.classList.toggle("active", wishlist.includes(Number(btn.dataset.wish))));
}

/* ---------- 6. Toast давалгаа ---------- */
function toast(msg, type = "ok") {
  const stack = $("#toastStack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.innerHTML = `<span class="t-icon">${type === "error" ? ICONS.info : ICONS.check}</span><span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 380); }, 2700);
}
window.norveToast = toast;

/* ---------- 6.5 Зөөлөн хуудас шилжилт (SPA горим) ----------
   Дотоод холбоос товших бүрт фейд/слайд-ап шилжилт хийгдэж,
   SPA шиг тансаг мэдрэмж өгнө. */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function nvNav(url, delay = 430) {
  const t = new URL(url, location.href);
  /* Зөвхөн hash өөрчлөгдөх тохиолдолд корвин хэрэггүй — шууд шилжүүлнэ */
  if (t.origin === location.origin &&
      t.pathname === location.pathname &&
      t.search === location.search &&
      t.hash && t.hash !== location.hash) {
    location.hash = t.hash;
    return;
  }
  const cur = $("#nvCurtain");
  if (!REDUCED_MOTION && cur) {
    cur.classList.add("nv-cover");
    requestAnimationFrame(() => requestAnimationFrame(() => cur.classList.add("nv-slide")));
    setTimeout(() => location.href = url, delay);
    return;
  }
  location.href = url;
}

/* Бүх дотоод .html холбоосыг нэвтрэгч маягийн загрузкаас хамгаалах;
   бүрэн дүрч 1 SPA шиг зөөлөн шилжилт үүсгэнэ. */
function initLinkInterceptor() {
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("data:")) return;
    if (/^(https?:)?\/\//i.test(href)) return;
    if (!/\.html(#|\?|$)/.test(href)) return;
    const resolved = new URL(href, location.href);
    if (resolved.origin !== location.origin) return;
    /* Ижил хуур дээрх зөвхөн #давхаргал — анхны гүйлгэлтэд хэвээр үлдээ */
    if (resolved.pathname === location.pathname && resolved.search === location.search && resolved.hash) return;
    e.preventDefault();
    nvNav(resolved.href);
  }, true);
}

/* Арын зочинд хуудас уншихад жижиг бэлгэдэл ахиулт */
window.addEventListener("pageshow", () => {
  const cur = $("#nvCurtain");
  if (cur) { cur.classList.remove("nv-cover", "nv-slide"); }
});

/* ---------- 6.7 Динами тансаг арын орчин (aura + оёг цэвэрлэгч) ---------- */
function initAmbientLux() {
  if (REDUCED_MOTION) return;
  /* 1. Алтан/обсидиан аура зурвасууд (CSS хөдөлгөөнт) */
  if (!$("#luxAura")) {
    document.body.insertAdjacentHTML("afterbegin", `
      <div id="luxAura" aria-hidden="true">
        <span class="aura-blob b1"></span><span class="aura-blob b2"></span><span class="aura-blob b3"></span>
      </div>`);
  }
  /* 2. Хөвөгч алтан микро бөөмс — Canvas ба хулс/гүйлгэлтийн зөөлөн хариулт */
  const cv = document.createElement("canvas");
  cv.id = "luxParticles";
  cv.setAttribute("aria-hidden", "true");
  document.body.insertAdjacentHTML("afterbegin", cv.outerHTML);
  const canvas = $("#luxParticles");
  const ctx = canvas.getContext("2d");
  let W, H, parts = [], mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5, scrollY = 0, raf;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const n = Math.min(90, Math.max(36, Math.round(W * H / 26000)));
    parts = Array.from({ length: n }, () => spawn());
  }
  function spawn(p) {
    p = p || {};
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    p.r  = 0.7 + Math.random() * 2.6;
    p.vy = 0.12 + Math.random() * 0.34;      /* аажим урсах хурд */
    p.vx = (Math.random() - 0.5) * 0.16;
    p.dt = Math.random() * Math.PI * 2;       /* гялалзах үе */
    p.ds = 0.006 + Math.random() * 0.013;
    p.depth = 0.35 + Math.random() * 0.65;    /* параллакс гүн */
    p.warm = Math.random() < 0.72;            /* алтан vs цагаан */
    return p;
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    tmx += (mx - tmx) * 0.03; tmy += (my - tmy) * 0.03;
    ctx.clearRect(0, 0, W, H);
    const sy = scrollY * 0.05;
    for (const p of parts) {
      p.dt += p.ds;
      p.x += p.vx + Math.sin(p.dt) * 0.12;
      p.y -= p.vy;
      if (p.y < -10) spawn(p), p.y = H + 8;
      if (p.x < -10) p.x = W + 8;
      if (p.x > W + 10) p.x = -8;
      const tw = 0.5 + Math.sin(p.dt * 2.2) * 0.5;
      const px = p.x + (tmx - 0.5) * 34 * p.depth;
      const py = p.y - sy * p.depth + (tmy - 0.5) * 22 * p.depth;
      ctx.beginPath();
      const alpha = (0.1 + tw * 0.24) * p.depth;
      ctx.fillStyle = p.warm ? `rgba(212, 175, 55, ${alpha.toFixed(3)})` : `rgba(245, 242, 235, ${(alpha * 0.7).toFixed(3)})`;
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  window.addEventListener("resize", resize);
  resize();
  window.addEventListener("mousemove", e => { mx = e.clientX / W; my = e.clientY / H; }, { passive: true });
  window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else frame();
  });
  frame();
}

/* ---------- 6.6 Админ данс, бүтээгдэхүүний засварлагч, дашборд ----------
   Хатуу тогтоосон админ: admin@norve.mn / NorveAdmin2026!          */
const ADMIN_AUTH = { email: "admin@norve.mn", pass: "NorveAdmin2026!" };

function makeAdminUser() {
  return { name: "НорВэ Админ", firstName: "Админ", lastName: "НорВэ", email: ADMIN_AUTH.email, phone: "7701-2020", joined: "2024-01-01T09:00:00.000Z", addresses: [], avatar: "", notif: { deals: true, drops: true, status: true }, scentFav: [], role: "admin" };
}

const isAdmin = () => !!currentUser && currentUser.role === "admin";

function applyAdminState() {
  document.body.classList.toggle("admin-on", isAdmin());
  const editBtn = $("#pvAdminEdit");
  if (editBtn) editBtn.style.display = isAdmin() ? "inline-flex" : "none";
}

/* --- 6.6.1 Автомат нийлэг хавчуурга (админ бэдж + цэс, редактор, түргэн үзэх модал) --- */
function ensureOverlays() {
  /* Ажилтны бэдж — бүх хуудаснаас шууд портал руу орох */
  if (!$("#adminBadge")) {
    document.body.insertAdjacentHTML("beforeend", `
      <button class="admin-badge" id="adminBadge" type="button" aria-label="Админ удирдлага">
        <span class="ab-dot"></span>Админ удирдлага
      </button>`);
  }
  /* Түргэн үзэх модал */
  if (!$("#qvModal")) {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="modal qv-modal" id="qvModal" aria-hidden="true">
        <div class="modal-backdrop" data-close="qv"></div>
        <div class="modal-card qv-card" id="qvCard"></div>
        <button class="icon-btn modal-x" data-close="qv" aria-label="Хаах">${ICONS.x}</button>
      </div>`);
  }
  /* Бүтээгдэхүүний засварлагч модал (админ) */
  if (!$("#amModal")) {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="modal am-modal" id="amModal" aria-hidden="true">
        <div class="modal-backdrop" data-close="am"></div>
        <div class="modal-card am-card">
          <button class="icon-btn modal-x" data-close="am" aria-label="Хаах">${ICONS.x}</button>
          <p class="eyebrow" style="margin-bottom:6px;">Ажлын орчин</p>
          <h3 id="amTitle">Бүтээгдэхүүн засах</h3>
          <form id="amForm" novalidate>
            <div class="am-media-row">
              <div class="am-preview"><img id="amImgPrev" src="${_I(IMAGE_POOL[0])}" alt="Зөгнөж буй зураг">
                <span class="badge-edit" id="amEditFlag" style="display:none;">Админ засварласан</span>
              </div>
              <div class="am-media-ctl">
                <label for="amImgFile" class="btn btn-dark am-file-btn">${ICONS.plus} Локал зураг СОНГОХ
                  <input type="file" id="amImgFile" accept="image/*" hidden>
                </label>
                <div class="field"><label for="amImgUrl">Эсвэл зураг URL холбоос</label>
                  <input type="text" id="amImgUrl" placeholder="https://...">
                </div>
              </div>
            </div>
            <div class="form-grid">
              <div class="field"><label for="amBrand">Брэнд</label><input type="text" id="amBrand" list="amBrandList">
                <datalist id="amBrandList">${ALL_BRANDS.map(b => `<option value="${esc(b)}">`).join("")}</datalist>
              </div>
              <div class="field"><label for="amGender">Төрөл / Хүйс</label>
                <select id="amGender"><option>Эрэгтэй</option><option>Эмэгтэй</option><option>Юнисекс</option></select>
              </div>
              <div class="field full"><label for="amName">Нэр</label><input type="text" id="amName"></div>
              <div class="field"><label for="amPrice">Үнэ (30мл суурь үнэ ₮)</label><input type="number" id="amPrice" min="1000" step="1000"></div>
              <div class="field"><label for="amConc">Концентраци</label>
                <select id="amConc">${CONCENTRATIONS.map(c => `<option>${c}</option>`).join("")}</select>
              </div>
              <div class="field"><label for="amFam">Үнэрийн гэр бүл</label>
                <select id="amFam">${FAMILIES.map(c => `<option>${c}</option>`).join("")}</select>
              </div>
              <div class="field full"><label>Хэмжээнүүд</label>
                <div class="chip-row" id="amSizes">
                  ${[30, 50, 100, 150].map(s => `<label class="chip"><input type="checkbox" value="${s}"><span>${s}мл</span></label>`).join("")}
                </div>
              </div>
              <div class="field"><label for="amNotesTop">Толгой ноот (таслалаар)</label><input type="text" id="amNotesTop" placeholder="Бэргамот, Нимбэг"></div>
              <div class="field"><label for="amNotesMid">Зүрхэн ноот (таслалаар)</label><input type="text" id="amNotesMid" placeholder="Жасмин, Роза"></div>
              <div class="field full"><label for="amNotesBase">Суурь ноот (таслалаар)</label><input type="text" id="amNotesBase" placeholder="Амбра, Мускус"></div>
              <div class="field full"><label for="amDesc">Тайлбар</label><textarea id="amDesc" rows="4"></textarea></div>
            </div>
            <div class="am-actions">
              <button type="submit" class="btn btn-gold">${ICONS.check} Хадгалах</button>
              <button type="button" class="btn btn-ghost" data-close="am">Цуцлах</button>
            </div>
          </form>
        </div>
      </div>`);
  }
}

/* --- 6.6.2 Ажилтны бэдж — шууд admin.html руу орох --- */
function initAdminBadge() {
  const badge = $("#adminBadge");
  if (!badge) return;
  badge.addEventListener("click", () => nvNav("admin.html"));
}

/* --- 6.6.3 Зураг оролт: файл → тийм багассан DataURL --- */
function fileToDataURL(file, maxSide = 320) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Зургийн файл биш байна"));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/webp", 0.86));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Файл уншихад алдаа гарлаа"));
    reader.readAsDataURL(file);
  });
}

/* --- 6.6.4 Редактор нээх / хадгалах --- */
const saveCustom    = list => store.set(KEYS.pCustom, list);
const saveOverrides = map  => store.set(KEYS.pOver, map);

const AM_STATE = { id: null, imageData: "" };

function openProductEditor(id) {
  ensureOverlays();
  const isNew = id === "new";
  const p = isNew ? null : byId(id);
  const title = $("#amTitle");
  $("#amEditFlag").style.display = (!isNew && p?.edited) ? "" : "none";
  title.textContent = isNew ? "Шинэ бүтээгдэхүүн нэмэх" : "Бүтээгдэхүүн засах — " + (p ? p.name : "");

  const fill = (sel, val) => { $(sel).value = val; };
  $("#amForm").reset();
  if (isNew || !p) {
    AM_STATE.id = "new";
    fill("#amName", ""); fill("#amBrand", ""); fill("#amPrice", "");
    fill("#amConc", "Өндөр тогтоцтой (15–20%)"); fill("#amFam", "Цэцгийн"); fill("#amGender", "Юнисекс");
    fill("#amDesc", ""); fill("#amNotesTop", ""); fill("#amNotesMid", ""); fill("#amNotesBase", "");
    $("#amSizes").querySelectorAll("input").forEach(cb => cb.checked = cb.value === "50" || cb.value === "100");
    AM_STATE.imageData = "";
    $("#amImgPrev").src = _I(IMAGE_POOL[0]);
    $("#amImgUrl").value = "";
  } else {
    AM_STATE.id = p.id;
    fill("#amName", p.name || ""); fill("#amBrand", p.brand || "");
    fill("#amPrice", Math.round(p.basePrice) || 0);
    $("#amConc").value = p.concentration || "Өндөр тогтоцтой (15–20%)";
    $("#amFam").value = p.scentFamily || "Цэцгийн";
    $("#amGender").value = p.gender || "Юнисекс";
    fill("#amDesc", p.description || "");
    fill("#amNotesTop", (p.notes?.top || []).join(", "));
    fill("#amNotesMid", (p.notes?.middle || []).join(", "));
    fill("#amNotesBase", (p.notes?.base || []).join(", "));
    $("#amSizes").querySelectorAll("input").forEach(cb => cb.checked = p.sizes?.includes(Number(cb.value)));
    AM_STATE.imageData = p.image?.startsWith("data:") ? p.image : "";
    $("#amImgUrl").value = AM_STATE.imageData ? "" : (p.image || "");
    $("#amImgPrev").src = p.image || _I(IMAGE_POOL[0]);
  }
  $("#amModal").classList.add("open");
  document.body.classList.add("no-scroll");
  setTimeout(() => $("#amName")?.focus(), 120);
}

function closeProductEditor() {
  $("#amModal").classList.remove("open");
  document.body.classList.remove("no-scroll");
}

function saveProductFromEditor() {
  const name = $("#amName").value.trim();
  const brand = $("#amBrand").value.trim();
  const price = Number($("#amPrice").value);
  if (!name || !brand || !price || price < 1000) {
    toast("Нэр, брэнд болон 1000₮-с дээш үнэ шаардлагатай", "error");
    return;
  }
  const sizes = $("#amSizes").querySelectorAll("input:checked");
  const patch = {
    name, brand,
    basePrice: roundTo(price, 1000),
    concentration: $("#amConc").value,
    scentFamily: $("#amFam").value,
    gender: $("#amGender").value,
    description: $("#amDesc").value.trim(),
    notes: {
      top: $("#amNotesTop").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 4),
      middle: $("#amNotesMid").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 4),
      base: $("#amNotesBase").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 4)
    },
    sizes: sizes.length ? Array.from(sizes).map(cb => Number(cb.value)).sort((a, b) => a - b) : [50]
  };
  const url = $("#amImgUrl").value.trim();
  patch.image = AM_STATE.imageData || url || _I(IMAGE_POOL[0]);

  if (AM_STATE.id === "new") {
    const custom = store.get(KEYS.pCustom, []);
    custom.push(patchToProduct(patch, nextCustomId()));
    saveCustom(custom);
    toast("Шинэ бүтээгдэхүүн амжилттай нэмэгдлээ");
  } else {
    const over = store.get(KEYS.pOver, {});
    const p = byId(AM_STATE.id);
    if (customList().some(c => c.id === Number(AM_STATE.id))) {
      /* Шинээр нэмсэн(product-ыг засах: custom list-д шууд шинэчлэгдэнэ) */
      const list = customList().map(c => c.id === Number(AM_STATE.id) ? { ...c, ...patch } : c);
      saveCustom(list);
    } else {
      over[AM_STATE.id] = { ...(over[AM_STATE.id] || {}), ...patch };
      saveOverrides(over);
    }
    applyProductData(AM_STATE.id, patch);
    if (p) p.edited = true;
    toast(`«${name}» амжилттай хадгалагдлаа`);
  }
  computeAllBrands();
  closeProductEditor();
  refreshAfterProductEdit();
}

const customList = () => store.get(KEYS.pCustom, []);

/* Шинэ бүтээгдэхүүний бүтэц дүүргэгч */
function patchToProduct(patch, id) {
  const rng = rand(strHash(patch.brand + "шинэ" + patch.name));
  return {
    id,
    ...patch,
    rating: Math.min(5, (43 + Math.floor(rng() * 9)) / 10),
    reviews: 50 + Math.floor(rng() * 800),
    isNew: true,
    custom: true
  };
}

/* --- 6.6.5 Харагдах бүх бүтээгдэхүүний хэсгийг шууд шинэчлэх --- */
function refreshVisibleGrids() {
  const page = document.body.dataset.page;
  if (page === "home") pageHome();
  if (page === "catalog") renderCatalog();
  if (page === "product") fillProductPyramidAndFrag();
  if (page === "account" && window.__renderWish) window.__renderWish();
  if (page === "admin" && window.__renderAdminPortal) window.__renderAdminPortal();
  const table = $("#adminTableBody");
  if (table) renderAdminTable();
}

/* Админ засварын дараах зөөлөн байршилт: бүх бүрдлийг шууд шинэчилж,
   бүтээгдэхүүний хуудасд (зураг/нэр байгаа) аялж шалгах нь илүү тул — тэр нь local шинэчлэлтээр бодите бүртгэлд хийгдэнэ */
function refreshAfterProductEdit() {
  _soldCache.clear();           /* худалдааны статистик дахин тооцогдоно */
  refreshVisibleGrids();
  /* product хуудсан дээр үндсэн мэдээллийг шууд дахин дүүргэх */
  if (document.body.dataset.page === "product") {
    const p = byId(getParam("id"));
    if (p) fillProductHeader(p);
  }
}

/* --- 6.6.6 Анхны төлөвт буцаах --- */
function resetAllProducts() {
  if (!confirm("АНХНЫ ТӨЛӨВТ БУЦААХ — бүх админ засвар болон шинээр нэмсэн бүтээгдэхүүн устгагдах болно. Үргэлжлүүлэх үү?")) return;
  store.set(KEYS.pOver, {});
  store.set(KEYS.pCustom, []);
  PRODUCTS = loadProducts();
  computeAllBrands();
  toast("Бүтээгдэхүүнүүд анхны төлөвт буцлаа");
  setTimeout(() => nvNav(location.pathname.replace(/.*\//, "") + location.search + location.hash, 300), 340);
}

/* --- 6.6.7 Админ дашбордын хүснэгт (account хуудас) --- */
let __adminQuery = "";
function renderAdminTable() {
  const body = $("#adminTableBody");
  if (!body) return;
  const q = __adminQuery.trim().toLowerCase();
  const list = PRODUCTS.filter(p => !q || (p.name + " " + p.brand).toLowerCase().includes(q));
  body.innerHTML = list.slice(0, 110).map(p => {
    const sd = soldData(p);
    return `
    <div class="admin-row${p.custom ? " is-custom" : ""}${p.edited ? " is-edited" : ""}">
      <img class="ar-img" src="${p.image}" alt="${esc(p.name)}">
      <div class="ar-t">
        <b>${esc(p.name)}${p.custom ? '<i class="ar-tag">Шинэ</i>' : ""}${p.edited ? '<i class="ar-tag edited">Засварласан</i>' : ""}</b>
        <span>${esc(p.brand)} · ${esc(p.scentFamily)} · ${p.sizes.join(", ")}мл</span>
      </div>
      <b class="ar-price">${fmtMNT(p.basePrice)}</b>
      <div class="ar-sold"><b>${sd.units.toLocaleString("ru-RU")}</b><small>ширхэг</small></div>
      <button class="ar-btn" data-edit="${p.id}" type="button">${ICONS.pencil} Засах</button>
    </div>`;
  }).join("") || `<div class="empty-state"><p>Тохирох бүтээгдэхүүн олдсонгүй.</p></div>`;
  $("#adminCount") && ($("#adminCount").textContent = PRODUCTS.length);
  $("#adminEditedCount") && ($("#adminEditedCount").textContent = PRODUCTS.filter(p => p.edited).length);
  $("#adminAddedCount") && ($("#adminAddedCount").textContent = customList().length);
}

/* --- Жинхэнэ статистик: ЗӨВХӨН бодит хадгалагдсан захиалгаас тооцоолно ---
   Зохиомол тоо, хуурамч захиалга, жишээ борлуулалт байхгүй. */
const _soldCache = new Map();

/* Бүтээгдэхүүн бүрийн захиалагдсан ширхэг (цaцлагдсанд тооцохгүй;
   буцаалтын захиалгын ширхэг/орлогоос хасана) */
function soldData(p) {
  if (_soldCache.has(p.id)) return _soldCache.get(p.id);
  let units = 0, revenue = 0;
  for (const o of allOrders()) {
    if (o.status === "Цуцлагдсан") continue;
    for (const it of o.items || []) {
      if (Number(it.productId) !== Number(p.id)) continue;
      const q = Number(it.qty) || 0;
      units += q;
      if (o.status !== "Буцаалт хийгдсэн") revenue += (Number(it.unitPrice) || 0) * q;
    }
  }
  const rec = { units, revenue };
  _soldCache.set(p.id, rec);
  return rec;
}

/* Нэгж бүрийн бүтээгдэхүүний бодит статистик */
function computeSales() {
  const rows = [];
  const rowOf = id => {
    let r = rows.find(x => Number(x.id) === Number(id));
    if (!r) { r = { id, units: 0, revenue: 0 }; rows.push(r); }
    return r;
  };
  const orders = allOrders();
  orders.forEach(o => {
    if (o.status === "Цуцлагдсан") return;
    const refundFactor = o.status === "Буцаалт хийгдсэн" ? -1 : 1;
    (o.items || []).forEach(it => {
      const r = rowOf(Number(it.productId));
      r.units += refundFactor * (Number(it.qty) || 0);
      r.revenue += refundFactor * (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
    });
  });
  const totalUnits = rows.reduce((a, r) => a + r.units, 0);
  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const brands = new Map();
  rows.forEach(r => {
    const p = byId(r.id); if (!p) return;
    const b = brands.get(p.brand) || { brand: p.brand, units: 0, revenue: 0 };
    b.units += r.units; b.revenue += r.revenue;
    brands.set(p.brand, b);
  });
  const brandList = Array.from(brands.values()).sort((a, b) => b.revenue - a.revenue);
  const fulfilledCount = orders.filter(o => FULFILLED_STATUS_SET.includes(o.status)).length;
  return {
    rows: rows.slice().sort((a, b) => b.units - a.units),
    totalUnits, totalRevenue,
    totalOrders: orders.length,     /* ← зөвхөн бодит захиалгын тоо */
    avgOrder: fulfilledCount ? totalRevenue / fulfilledCount : 0,
    brandList, realOrders: orders
  };
}

/* ============================================================
   АДМИН ПОРТАЛ — бүрэн ажиллагаатай, бодит өгөгдөл дээр суурилсан
   Хяналтын самбар · Захиалга · Хэрэглэгчид · Брэндүүд · Бүтээгдэхүүн · Тайлан · Тохиргоо
   ============================================================ */

/* Бүх захиалгын эх үүсвэр: сервер байвал серверээс, байхгүй бол localStorage-оос.
   Server response → orderNo бүхий бүрэн шинэ хэлбэр; local → яг ижил хэлбэртэй. */
async function adminLoadOrders() {
  if (Data.server) {
    try { const j = await Data.req("GET", "/api/orders"); serverOrdersCache = j.orders || []; return serverOrdersCache; }
    catch (e) { toast(e.message, "error"); return serverOrdersCache; }
  }
  return store.get(KEYS.orders, []);
}
let serverOrdersCache = [];   /* серверийн захиалга — soldData/computeSales-д хурдан уншлага */
const allOrders = () => (Data.server ? serverOrdersCache : store.get(KEYS.orders, []));

/* Хуучин хэлбэрийн захиалгыг шинэ нэгдсэн бүтэц рүү хувиргана (өгөгдөл алдалгүй, зохиомол мэдээлэл нэмэхгүй) */
function normalizeOrder(o) {
  if (o.orderNo) {
    return {
      orderNo: o.orderNo, createdAt: o.createdAt, userId: o.userId || null,
      customer: o.customer || {}, items: o.items || [],
      subtotal: o.subtotal || 0, shippingFee: o.shippingFee || 0, total: o.total || 0,
      delivery: { type: o.delivery?.type || "normal", city: o.delivery?.city || "", district: o.delivery?.district || "", khoroo: o.delivery?.khoroo || "", apartment: o.delivery?.apartment || "" },
      customerNote: o.customerNote || "",
      paymentMethod: o.paymentMethod || "bank", paymentMethodLabel: o.paymentMethodLabel || "Мэдэгдэхгүй",
      paymentStatus: o.paymentStatus || "Төлбөр хүлээж байна",
      payments: o.payments || [],
      status: ORDER_STATUS_LABELS.includes(o.status) ? o.status : "Шинэ захиалга",
      statusHistory: o.statusHistory || []
    };
  }
  /* Легаси (хуучин localStorage): id / items[].price / delivery.name... */
  return {
    orderNo: String(o.id || "LEGACY"), createdAt: o.date || "",
    userId: null,
    customer: {
      firstName: String(o.delivery?.name || "").split(" ").slice(-1)[0] || "",
      lastName: String(o.delivery?.name || "").split(" ").slice(0, -1).join(" "),
      phone: o.delivery?.phone || "", email: o.email || ""
    },
    items: (o.items || []).map(it => ({ productId: it.id, name: it.name, brand: it.brand || "", size: it.size, qty: it.qty, unitPrice: Number(it.price) || 0, image: (byId(it.id) || {}).image || "" })),
    subtotal: o.subtotal || 0, shippingFee: o.shipping || 0, total: o.total || 0,
    delivery: { type: String(o.deliveryType || "").includes("Шуурхай") ? "express" : "normal", city: o.delivery?.city || "", district: o.delivery?.district || "", khoroo: o.delivery?.khoroo || "", apartment: o.delivery?.apartment || "" },
    customerNote: o.delivery?.note || "",
    paymentMethod: o.payment ? (PAY_METHOD_KEY_BY_LABEL[o.payment] || "bank") : "bank",
    paymentMethodLabel: o.payment || "Мэдэгдэхгүй",
    paymentStatus: o.paymentStatus || (o.payment === "Хүргэлтээр бэлнээр" ? "Хүргэлтэд төлнө" : "Төлбөр хүлээж байна"),
    payments: o.payments || [],
    status: ORDER_STATUS_LABELS.includes(o.status) ? o.status : "Шинэ захиалга",
    statusHistory: o.statusHistory || [{ status: o.status || "Шинэ захиалга", at: o.date || "", by: "импорт" }]
  };
}
const normAll = list => (list || []).map(normalizeOrder).filter(o => o.orderNo);

/* Хугацааны шүүлт */
function periodRange(period) {
  const now = new Date();
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  if (period === "today") return { from: startOfDay(now), to: now, label: "Өнөөдөр" };
  if (period === "week") return { from: new Date(startOfDay(now).getTime() - 6 * 86400000), to: now, label: "Сүүлийн 7 хоног" };
  if (period === "month") return { from: new Date(startOfDay(now).getTime() - 29 * 86400000), to: now, label: "Сүүлийн 30 хоног" };
  if (period === "thisMonth") { const d = new Date(now.getFullYear(), now.getMonth(), 1); return { from: d, to: now, label: "Энэ сар" }; }
  return null;
}
const inRange = (iso, from, to) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (from && t < from.getTime()) return false;
  if (to && to.getTime && t > to.getTime() + 60000) return false;
  return true;
};

/* --- ҮНДЭСЭН СТАТИСТИК — зөвхөн бодит захиалгаас --- */
function computeStats(orders) {
  const st = {
    total: 0, pending: 0, confirmed: 0, preparing: 0, shippingOut: 0, delivered: 0, cancelled: 0, refunded: 0,
    revenue: 0, units: 0, fulfilled: 0, unpaid: 0
  };
  st.total = orders.length;
  for (const o of orders) {
    if (o.status === "Шинэ захиалга" || o.status === "Баталгаажуулах хүлээлттэй") st.pending++;
    else if (o.status === "Баталгаажсан") st.confirmed++;
    else if (o.status === "Бэлтгэж байгаа") { st.preparing++; st.confirmed++; }
    else if (o.status === "Хүргэлтэд гарсан") { st.shippingOut++; st.confirmed++; }
    else if (o.status === "Хүргэгдсэн") { st.delivered++; st.confirmed++; }
    else if (o.status === "Цуцлагдсан") st.cancelled++;
    else if (o.status === "Буцаалт хийгдсэн") st.refunded++;

    const active = FULFILLED_STATUS_SET.includes(o.status);
    if (active) st.fulfilled++;
    /* Орлого: зөвхөн төлбөр нь СЕРВЕР талд баталгаажсан захиалга;
       Цуцлагдсан/буцаалтын захиалгыг орлогоос хасдаг */
    if (o.paymentStatus === "Төлбөр баталгаажсан") {
      if (active) st.revenue += Number(o.total) || 0;
      else if (o.status === "Буцаалт хийгдсэн") st.revenue -= Number(o.total) || 0;
      else if (o.status === "Цуцлагдсан") st.revenue -= Number(o.total) || 0;
    }
    if (o.paymentStatus === "Төлбөр хүлээж байна" || o.paymentStatus === "Хүргэлтэд төлнө") st.unpaid++;
    if (active) for (const it of o.items) st.units += Number(it.qty) || 0;
  }
  return st;
}

/* --- Туслах: пунк форматлол --- */
const PAY_ICON = { "Төлбөр хүлээж байна": "clock", "Төлбөр баталгаажсан": "check", "Хүргэлтэд төлнө": "cash", "Төлбөр буцаагдсан": "reset" };
function statusPillHTML(status) {
  const i = ORDER_STATUS_LABELS.indexOf(status);
  return `<span class="oq-pill st-${i >= 0 ? i : 0}">${esc(status)}</span>`;
}
const payStatusPill = ps => `<span class="oq-pill pay-${PAYMENT_STATUS_LABELS.indexOf(ps) >= 0 ? PAYMENT_STATUS_LABELS.indexOf(ps) : 0}">${esc(ps)}</span>`;
const fmtDT = iso => { if (!iso) return "—"; const d = new Date(iso); return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/* --- Хоосон jagsaalt бүхий модал (KPI товчны жагсаалт, тухайн категорийн захиалгууд) --- */
function openListModal(title, orders, emptyMsg = "Тохирох захиалга одоогоор байхгүй байна.") {
  const card = $("#nvListModalCard");
  $("#nvListModalTitle").textContent = title;
  $("#nvListModalCount").textContent = orders.length;
  const body = $("#nvListModalBody");
  body.innerHTML = orders.length ? orders.map(o => `
    <div class="nvl-row" data-open-order="${esc(orderId(o))}">
      <b>${esc(orderId(o))}</b>
      <span>${esc(custName(o))} · ${esc(custPhone(o))}</span>
      <small>${fmtDT(o.createdAt)} · ${esc(o.paymentMethodLabel)} · ${esc(o.paymentStatus)}</small>
      <b class="nvl-total">${fmtMNT(o.total)}</b>
      ${statusPillHTML(o.status)}
    </div>`).join("") : `<div class="empty-state"><p>${esc(emptyMsg)}</p></div>`;
  $("#nvListModal").classList.add("open");
  document.body.classList.add("no-scroll");
}
function closeListModal() { $("#nvListModal")?.classList.remove("open"); document.body.classList.remove("no-scroll"); }

/* --- Захиалгын дэлгэрэнгүй харах --- */
function openOrderDetail(orderNo, orders) {
  const o = (orders || normAll(allOrders())).find(x => orderId(x) === orderNo);
  if (!o) return;
  const card = $("#orderDetailContent");
  const hist = (o.statusHistory || []).map(h => `
    <div class="od-hist"><b>${esc(h.status)}</b><span>${fmtDT(h.at)}</span><small>${esc(h.by || "")}</small></div>`).join("") ;
  const pays = (o.payments || []).map(p => `
    <div class="od-hist"><b>${esc(p.status)}</b><span>${fmtDT(p.at)}</span><small>${esc(p.note || p.source || "")}</small></div>`).join("");
  card.innerHTML = `
    <p class="eyebrow">Захиалгын дэлгэрэнгүй</p>
    <h3 class="od-no">${esc(orderId(o))}<span>${fmtDT(o.createdAt)}</span></h3>
    <div class="od-grid">
      <div>
        <h4>Харилцагч</h4>
        <p><b>${esc(custName(o))}</b></p>
        <p>Утас: <b>${esc(custPhone(o) || "—")}</b></p>
        <p>И-мэйл: <b>${esc(custEmail(o) || "—")}</b></p>
        <p>${o.userId ? "Бүртгэлтэй хэрэглэгч" : "Зочин захиалагч"}</p>
      </div>
      <div>
        <h4>Хүргэлт</h4>
        <p>${esc(o.delivery.city)} · ${esc(o.delivery.district)} · ${esc(o.delivery.khoroo)} хороо</p>
        ${o.delivery.apartment ? `<p>${esc(o.delivery.apartment)}</p>` : ""}
        <p>${esc(o.delivery.type === "express" ? "Шуурхай хүргэлт" : "Энгийн хүргэлт")}</p>
        ${o.customerNote ? `<p class="od-note">«${esc(o.customerNote)}»</p>` : ""}
      </div>
    </div>
    <h4>Захиалсан бүтээгдэхүүнүүд</h4>
    <div class="od-items">
      ${o.items.map(it => `
        <div class="od-item">
          ${it.image ? `<img src="${it.image}" alt="${esc(it.name)}">` : ""}
          <span><b>${esc(it.name)}</b><small>${esc(it.brand)} · ${it.size}мл × ${it.qty}</small></span>
          <b>${fmtMNT((Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}</b>
          <small>${fmtMNT(Number(it.unitPrice) || 0)}/ш</small>
        </div>`).join("")}
    </div>
    <div class="od-sum">
      <span>Сагслалтын дүн</span><b>${fmtMNT(o.subtotal)}</b>
      <span>Хүргэлт</span><b>${fmtMNT(o.shippingFee)}</b>
      <span class="gold">Нийт</span><b class="gold">${fmtMNT(o.total)}</b>
      <span>Төлбөрийн хэлбэр</span><b>${esc(o.paymentMethodLabel)}</b>
      <span>Төлбөрийн төлөв</span>${payStatusPill(o.paymentStatus)}
      <span>Захиалгын төлөв</span>${statusPillHTML(o.status)}
    </div>
    <div class="od-cols">
      <div>
        <h4>Төлөвийн түүх</h4>
        <div class="od-timeline">${hist || "<p>Бүртгэгдээгүй</p>"}</div>
      </div>
      <div>
        <h4>Төлбөрийн түүх</h4>
        <div class="od-timeline">${pays || "<p>Бүртгэгдээгүй</p>"}</div>
      </div>
    </div>
    <div class="od-actions">
      <button class="btn btn-ghost" data-od-status="Цуцлагдсан" data-od-no="${esc(orderId(o))}">Цуцлах</button>
      <button class="btn btn-ghost" data-od-status="Буцаалт хийгдсэн" data-od-no="${esc(orderId(o))}">Буцаалт</button>
      <button class="btn btn-ghost" data-od-print="${esc(orderId(o))}">Хэвлэх</button>
      <select data-od-set="${esc(orderId(o))}" aria-label="Төлөв сонгох">
        ${ORDER_STATUS_LABELS.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <select data-od-pay="${esc(orderId(o))}" aria-label="Төлбөрийн төлөв сонгох">
        ${PAYMENT_STATUS_LABELS.map(s => `<option ${s === o.paymentStatus ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>`;
  $("#orderDetailModal").classList.add("open");
  document.body.classList.add("no-scroll");
}

/* --- Захиалгын төлөв/төлбөр шинэчлэх (сервер эсвэл локал) --- */
async function updateOrderByNo(orderNo, patch) {
  if (Data.server) {
    const clean = { ...patch };
    delete clean.orderNo;
    try { await Data.req("PATCH", "/api/orders/" + encodeURIComponent(orderNo), clean); _soldCache.clear(); return true; }
    catch (e) { toast(e.message, "error"); return false; }
  }
  const orders = store.get(KEYS.orders, []);
  const o = orders.find(x => orderId(x) === orderNo);
  if (!o) return false;
  const now = new Date().toISOString();
  if (patch.status && o.status !== patch.status) {
    o.status = patch.status;
    o.statusHistory = o.statusHistory || [];
    o.statusHistory.push({ status: patch.status, at: now, by: (currentUser && currentUser.name) || "админ" });
    if (patch.status === "Буцаалт хийгдсэн" && o.paymentStatus === "Төлбөр баталгаажсан") {
      o.paymentStatus = "Төлбөр буцаагдсан";
      o.payments = o.payments || [];
      o.payments.push({ at: now, status: o.paymentStatus, source: "server", note: "Буцаалтын дагуу" });
    }
    localAudit("төлөв өөрчлөх", `${orderNo} → ${patch.status}`);
  }
  if (patch.paymentStatus && o.paymentStatus !== patch.paymentStatus) {
    o.paymentStatus = patch.paymentStatus;
    o.payments = o.payments || [];
    o.payments.push({ at: now, status: patch.paymentStatus, source: "server", note: patch.note || "" });
    localAudit("төлбөрийн төлөв", `${orderNo} → ${patch.paymentStatus}`);
  }
  store.set(KEYS.orders, orders);
  _soldCache.clear();
  return true;
}

/* --- Захиалгуудыг CSV болгон татах --- */
function csvEscape(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function downloadOrdersCSV(orders, filename) {
  const head = ["Дугаар", "Огноо", "Овог нэр", "Утас", "И-мэйл", "Бүтээгдэхүүн", "Ширхэг", "Нэгж үнэ", "Хүргэлт", "Нийт", "Төлбөрийн хэлбэр", "Төлбөрийн төлөв", "Төлөв"];
  const lines = [head.join(";")];
  for (const o of orders) {
    for (const it of o.items) {
      lines.push([orderId(o), fmtDT(o.createdAt), custName(o), custPhone(o), custEmail(o),
        it.name, it.qty, Number(it.unitPrice) || 0, "", "", o.paymentMethodLabel, o.paymentStatus, o.status].map(csvEscape).join(";"));
    }
    lines.push(["", "", "", "", "", "", "", "", o.shippingFee, o.total, "", "", ""].map(csvEscape).join(";"));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv; charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* --- Захиалгыг хэвлэх --- */
function printOrder(orderNo) {
  const o = normAll(allOrders()).find(x => orderId(x) === orderNo);
  if (!o) return;
  const w = window.open("", "_blank", "width=760,height=900");
  if (!w) { toast("Хэвлэх цонх нээгдсэнгүй — хаалттай цонхнуудыг шалгана уу", "error"); return; }
  w.document.write(`<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8"><title>${esc(orderId(o))} — НорВэ</title>
    <style>body{font-family:sans-serif;padding:24px;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #bbb;padding:6px 8px;font-size:13px;text-align:left}th{background:#f2f2f2}.r{text-align:right}.muted{color:#666;font-size:12px}</style></head><body>
    <h1>НорВэ — Захиалга ${esc(orderId(o))}</h1>
    <p class="muted">${fmtDT(o.createdAt)} · Төлбөрийн хэлбэр: ${esc(o.paymentMethodLabel)} · Төлбөрийн төлөв: ${esc(o.paymentStatus)}</p>
    <p><b>${esc(custName(o))}</b> · Утас: ${esc(custPhone(o))} · И-мэйл: ${esc(custEmail(o) || "—")}</p>
    <p>Хаяг: ${esc(o.delivery.city)}, ${esc(o.delivery.district)}, ${esc(o.delivery.khoroo)} хороо${o.delivery.apartment ? ", " + esc(o.delivery.apartment) : ""}</p>
    <table><tr><th>Бүтээгдэхүүн</th><th>Хэмжээ</th><th class="r">Тоо</th><th class="r">Нэгж үнэ</th><th class="r">Нийт</th></tr>
    ${o.items.map(it => `<tr><td>${esc(it.name)}<br><span class="muted">${esc(it.brand)}</span></td><td>${it.size}мл</td><td class="r">${it.qty}</td><td class="r">${fmtMNT(Number(it.unitPrice) || 0)}</td><td class="r">${fmtMNT((Number(it.unitPrice) || 0) * (Number(it.qty) || 0))}</td></tr>`).join("")}
    <tr><td colspan="4" class="r"><b>Сагслалтын дүн</b></td><td class="r">${fmtMNT(o.subtotal)}</td></tr>
    <tr><td colspan="4" class="r"><b>Хүргэлт</b></td><td class="r">${fmtMNT(o.shippingFee)}</td></tr>
    <tr><td colspan="4" class="r"><b>НИЙТ</b></td><td class="r"><b>${fmtMNT(o.total)}</b></td></tr></table>
    ${o.customerNote ? `<p>Тэмдэглэл: ${esc(o.customerNote)}</p>` : ""}
    <script>window.onload = () => window.print();<\/script></body></html>`);
  w.document.close();
}

/* --- Портал (admin.html): нэвтрэлт, шинжилгэ, захиалга, бүтээгдэхүүн --- */
const ADMIN_STATE = {
  orderSearch: "", orderStatus: "", orderDate: "", orderPay: "",
  userSearch: "", usersSort: "joined",
  reportPeriod: "week", reportFrom: null, reportTo: null,
  productsQuery: ""
};

function pageAdmin() {
  const loginWrap = $("#adminLoginWrap");
  const portal = $("#adminPortal");
  if (!loginWrap || !portal) return;

  async function renderAdminPortal() {
    const logged = isAdmin();
    loginWrap.style.display = logged ? "none" : "";
    portal.style.display = logged ? "" : "none";
    $("#adminHeader").style.display = logged ? "" : "none";
    document.title = "Админ удирдлага — НорВэ";
    $(".al-note").innerHTML = `<b>Статус:</b> ${esc(Data.note())} <br><small>Сервер бол node server.js ажиллуул. Порт 8787.</small>`;
    if (!logged) return;
    await Data.init();
    await syncCatalogToServer();
    await renderDashboard();
    renderOrdersSection();
    renderUsersSection();
    renderBrandsSection();
    renderReportsSection();
    fillAdminSettingsUI();
  }
  window.__renderAdminPortal = renderAdminPortal;

  /* Нэвтрэх — сервер байвал сервер эрх шалгана; байхгүй бол локал ADMIN_AUTH */
  $("#adminLoginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#alEmail").value.trim().toLowerCase();
    const pass = $("#alPass").value;
    const tryLocal = () => {
      if (email === ADMIN_AUTH.email && pass === ADMIN_AUTH.pass) {
        currentUser = makeAdminUser(); saveUser(); applyAdminState();
        toast("Админ горим нээгдлээ (локал горим)"); showPortal(); return true;
      }
      return false;
    };
    const showPortal = () => renderAdminPortal();
    if (Data.server) {
      try {
        const j = await Data.req("POST", "/api/admin/login", { email, pass });
        Data.token = j.token;
        sessionStorage.setItem("norve_token", j.token);
        currentUser = makeAdminUser(); saveUser(); applyAdminState();
        toast("Админ горим нээгдлээ — " + (j.actor || "Админ"));
        renderAdminPortal();
        return;
      } catch (e2) {
        /* Серверийн нэвтрэлт амжилтгүй — локал данс байгаа эсэхийг шалгах (file горимыг дэмждэггүй хэрэглэгчийн алдааг хэлнэ) */
        if (!tryLocal()) toast(e2.message, "error");
        return;
      }
    }
    if (!tryLocal()) toast("Админ нэвтрэх мэдээлэл буруу байна", "error");
  });

  $("#alLogoutBtn")?.addEventListener("click", adminLogout);
  function adminLogout() {
    if (Data.server && Data.token) {
      Data.req("POST", "/api/admin/logout", {}).catch(() => {});
      Data.token = ""; sessionStorage.removeItem("norve_token");
    }
    currentUser = null; saveUser(); applyAdminState();
    nvNav("admin.html");
  }
  window.adminLogout = adminLogout;
  $("#adminLogoutBtn")?.addEventListener("click", adminLogout);

  /* ======= ХЯНАЛТЫН САМБАР ======= */
  async function renderDashboard() {
    const kpiGrid = $("#kpiGrid");
    if (!kpiGrid) return;
    const orders = Data.server ? await adminLoadOrders() : allOrders();
    const st = computeStats(orders);
    const usersCount = Data.server
      ? (await Data.req("GET", "/api/users").catch(() => ({ users: [] }))).users.length
      : store.get(KEYS.users, []).length;
    const kpis = [
      { key: "total", name: "Нийт захиалга", val: st.total, hint: "системд бодитоор үүссэн дугаа" },
      { key: "pending", name: "Хүлээгдэж буй", val: st.pending, hint: "Баталгаажуулалт хүлээж байгаа" },
      { key: "confirmed", name: "Баталгаажсан", val: st.confirmed, hint: "Баталгаасан төлөвтэй захиалга" },
      { key: "shippingOut", name: "Хүргэлтэд гарсан", val: st.shippingOut, hint: "Захиалга дамжилттай" },
      { key: "delivered", name: "Хүргэгдсэн", val: st.delivered, hint: "Хэрэглэгч хүргэгдсэнд тэмдэглэгдсэн" },
      { key: "cancelled", name: "Цуцлагдсан", val: st.cancelled, hint: "Баталгаажсангүй" },
      { key: "refund", name: "Буцаалт", val: st.refunded, hint: "Борлуулалтаас хасахыг хүсэн" },
      { key: "revenue", name: "Борлуулалтын орлого", val: fmtMNT(st.revenue), hint: "Төлбөр баталгаажсан бэлэн төлбөртэй захиалгууд" },
      { key: "units", name: "Борлуулсан ширхэг", val: st.units.toLocaleString("ru-RU"), hint: "Биелсэн захиалгын нийт ширхэг" },
      { key: "users", name: "Бүртгэлтэй хэрэглэгчид", val: usersCount, hint: "Давхардалгүй бүртгүүлсэн дансууд" },
      { key: "products", name: "Нийт бүтээгдэхүүн", val: PRODUCTS.length, hint: "Бүтээгдэхүүний сан" }
    ];
    kpiGrid.innerHTML = kpis.map(k => `
      <button type="button" class="kpi-card" data-kpi="${k.key}" title="${esc(k.hint)}">
        <b>${typeof k.val === "number" ? k.val.toLocaleString("ru-RU") : k.val}</b>
        <small>${esc(k.name)}</small>
      </button>`).join("");
    /* KPI товд дарвал: тухайн үзүүлэлтийн захиалгын жагсаалтыг нээнэ */
    kpiGrid.onclick = e => {
      const b = e.target.closest("[data-kpi]");
      if (!b) return;
      const k = b.dataset.kpi;
      const norm = orders;
      const map = {
        total:       () => openListModal("Бүх захиалга", norm),
        pending:     () => openListModal("Хүлээгдэж буй захиалга", norm.filter(o => o.status === "Шинэ захиалга" || o.status === "Баталгаажуулах хүлээлттэй")),
        confirmed:   () => openListModal("Баталгаажсан захиалга", norm.filter(o => ["Баталгаажсан","Бэлтгэж байгаа","Хүргэлтэд гарсан","Хүргэгдсэн"].includes(o.status))),
        shippingOut: () => openListModal("Хүргэлтэд гарсан захиалга", norm.filter(o => o.status === "Хүргэлтэд гарсан")),
        delivered:   () => openListModal("Хүргэгдсэн захиалга", norm.filter(o => o.status === "Хүргэгдсэн")),
        cancelled:   () => openListModal("Цуцлагдсан захиалга", norm.filter(o => o.status === "Цуцлагдсан")),
        refund:      () => openListModal("Буцаалт хийгдсэн захиалга", norm.filter(o => o.status === "Буцаалт хийгдсэн")),
        revenue:     () => openListModal("Төлбөр баталгаажсан захиалга", norm.filter(o => o.paymentStatus === "Төлбөр баталгаажсан" && FULFILLED_STATUS_SET.includes(o.status))),
        units:       () => openListModal("Биелсэн захиалгууд (ширхгийн эх үүсвэр)", norm.filter(o => FULFILLED_STATUS_SET.includes(o.status)))
      };
      if (map[k]) map[k]();
      else if (k === "users") window.__gotoSection && window.__gotoSection("users");
      else if (k === "products") window.__gotoSection && window.__gotoSection("products");
    };

    /* Бодит шилдэг зарагч тэй (хэрэв захиалга байхгүй бол хоосон тoлор) */
    const s = computeSales();
    const top = s.rows.filter(r => r.units > 0).slice(0, 10);
    const listEl = $("#topSellersList");
    if (listEl) listEl.innerHTML = top.length ? top.map((r, i) => {
      const p = byId(r.id); if (!p) return "";
      return `
      <div class="bs-row">
        <span class="bs-rank"${i < 3 ? ' data-medal="gold"' : ""}>${i + 1}</span>
        <img class="bs-img" src="${p.image}" alt="${esc(p.name)}">
        <div class="bs-info"><b>${esc(p.name)}</b><span>${esc(p.brand)}</span></div>
        <div class="bs-units"><b>${r.units.toLocaleString("ru-RU")}</b><small>ширхэг</small></div>
        <b class="bs-rev">${fmtMNT(r.revenue)}</b>
        <div class="bs-bar"><i data-w="${Math.round(r.units / (top[0].units || 1) * 100)}%"></i></div>
      </div>`;
    }).join("") : `<div class="empty-state"><p>Одоогоор захиалга бүртгэлжигдээгүй тул шилдэг зарагчийн жагсаалт хоосон байна.</p></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $$("#topSellersList .bs-bar i").forEach(el => el.style.width = el.dataset.w)));

    /* Брэндийн бодит борлуулалт */
    const bEl = $("#brandBreakdown");
    if (bEl) {
      const maxRev = s.brandList[0]?.revenue || 1;
      bEl.innerHTML = s.brandList.filter(b => b.units > 0).slice(0, 8).map(b => `
        <div class="br-row">
          <b class="br-name">${esc(b.brand)}</b>
          <div class="br-bar"><i data-w="${Math.round(b.revenue / maxRev * 100)}%"></i></div>
          <b>${fmtMNT(b.revenue)}</b>
          <small>${b.units} ш</small>
        </div>`).join("") || `<div class="empty-state"><p>Борлуулалт (ширхэг=0) байхгүй байна</p></div>`;
      requestAnimationFrame(() => requestAnimationFrame(() =>
        $$("#brandBreakdown .br-bar i").forEach(el => el.style.width = el.dataset.w)));
    }

    /* Сүүлчийн захиалгууд */
    const rEl = $("#recentOrdersList");
    if (rEl) {
      const sorted = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
      rEl.innerHTML = sorted.length ? sorted.map(o => `
        <div class="nvl-row" data-open-order="${esc(orderId(o))}">
          <b>${esc(orderId(o))}</b><span>${esc(custName(o))}</span>
          <small>${fmtDT(o.createdAt)}</small><b class="nvl-total">${fmtMNT(o.total)}</b>
          ${statusPillHTML(o.status)}
        </div>`).join("") : `<div class="empty-state"><p>Одоогоор захиалга бүртгэгдээгүй байна.</p></div>`;
    }
  }

  /* Сервер байвал каталогыг бодит байдлаар синхрончлох (эхний удаа) */
  async function syncCatalogToServer() {
    if (!Data.server) return;
    try {
      const j = await Data.req("GET", "/api/products");
      if (!j.synced) {
        await Data.req("POST", "/api/products/sync", { products: PRODUCTS.map(p => ({
          id: p.id, name: p.name, brand: p.brand, gender: p.gender, concentration: p.concentration,
          sizes: p.sizes, basePrice: p.basePrice, scentFamily: p.scentFamily, image: p.image,
          rating: p.rating, reviews: p.reviews, description: p.description
        })) });
        console.info("Каталог сервер лүү синхрончлогдлоо");
      }
      /* Серверийн засварууд браузерын catalog-д бүртгэх (уул нь сервер засвартай ат нэм) */
    } catch (e) { console.warn("Каталог синхрончлол амжилтгүй:", e.message); }
  }

  /* ======= ЗАХИАЛГА ======= */
  function renderOrdersSection() {
    const body = $("#ordersTableBody");
    if (!body) return;
    const val = $("#orderStatusFilter");
    if (val && !val.options.length) {
      val.innerHTML = `<option value="">Бүх төлөв</option>` + ORDER_STATUS_LABELS.map(s => `<option>${s}</option>`).join("");
    }
    const paySel = $("#orderPayFilter");
    if (paySel && !paySel.options.length) {
      paySel.innerHTML = `<option value="">Бүх төлбөрийн төлөв</option>` + PAYMENT_STATUS_LABELS.map(s => `<option>${s}</option>`).join("");
    }
    const q = ADMIN_STATE.orderSearch.trim().toLowerCase();
    adminLoadOrders().then(list => {
      let view = normAll(list);
      if (q) {
        view = view.filter(o => {
          const hay = `${orderId(o)} ${custName(o)} ${custPhone(o)} ${custEmail(o)}`.toLowerCase();
          if (hay.includes(q)) return true;
          return (o.items || []).some(it => (it.name + " " + it.brand).toLowerCase().includes(q));
        });
      }
      if (ADMIN_STATE.orderStatus) view = view.filter(o => o.status === ADMIN_STATE.orderStatus);
      if (ADMIN_STATE.orderPay) view = view.filter(o => o.paymentStatus === ADMIN_STATE.orderPay);
      if (ADMIN_STATE.orderDate) {
        const r = periodRange(ADMIN_STATE.orderDate);
        if (r) view = view.filter(o => inRange(o.createdAt, r.from, r.to));
      }
      view.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      body.innerHTML = view.length ? view.map(o => `
        <div class="at-row order-row" data-open-order="${esc(orderId(o))}">
          <span><b>${esc(orderId(o))}</b><small>${fmtDT(o.createdAt)}</small></span>
          <span><b>${esc(custName(o))}</b><small>${esc(custPhone(o))} · ${o.userId ? "Бүртгэлтэй" : "Зочин"}</small></span>
          <span><small>${o.items.slice(0, 2).map(it => esc(it.name) + " ×" + it.qty).join(", ")}${o.items.length > 2 ? " …" : ""}</small><small>${o.items.length} ширхэг</small></span>
          <span><b>${fmtMNT(o.total)}</b><small>${esc(o.paymentMethodLabel)}</small></span>
          ${payStatusPill(o.paymentStatus)}
          ${statusPillHTML(o.status)}
        </div>`).join("") : `<div class="empty-state"><p>Захиалга олдсонгүй — шүүлтүүрүудыг өөрчилж үзээрэй.</p></div>`;
    });
  }

  /* Дэлгэрэнгүй mod үйлдлүүд — глобал click delegate */
  document.addEventListener("click", async e => {
    const open = e.target.closest("[data-open-order]");
    if (open) { openOrderDetail(open.dataset.openOrder); return; }

    /* orderDetailModal үйлдлүүд */
    const st = e.target.closest("[data-od-status]");
    if (st) {
      const ok = await updateOrderByNo(st.dataset.odNo, { status: st.dataset.odStatus });
      if (ok) { toast(`Захиалгын төлөв «${st.dataset.odStatus}» боллоо`); $("#orderDetailModal").classList.remove("open"); document.body.classList.remove("no-scroll"); refreshAdminData(); }
      return;
    }
    const pr = e.target.closest("[data-od-print]");
    if (pr) { printOrder(pr.dataset.odPrint); return; }

    /* Модал хаалт */
    if (e.target.closest("[data-close='orderDetail']")) { $("#orderDetailModal")?.classList.remove("open"); document.body.classList.remove("no-scroll"); return; }
    if (e.target.closest("[data-close='userDetail']")) { $("#userDetailModal")?.classList.remove("open"); document.body.classList.remove("no-scroll"); return; }
    if (e.target.closest("[data-close='nvl']")) { closeListModal(); return; }
    if (e.target.closest("[data-close='brandEdit']")) { $("#brandEditModal")?.classList.remove("open"); document.body.classList.remove("no-scroll"); return; }
  });

  /* select үйлдлүүд (төлөв/төлбөрийн төлөв шууд солих) */
  document.addEventListener("change", async e => {
    const set = e.target.closest("[data-od-set]");
    if (set) { const ok = await updateOrderByNo(set.dataset.odSet, { status: set.value }); if (ok) { toast(`Төлөв «${set.value}» боллоо`); refreshAdminData(); } return; }
    const pay = e.target.closest("[data-od-pay]");
    if (pay) { const ok = await updateOrderByNo(pay.dataset.odPay, { paymentStatus: pay.value }); if (ok) { toast(`Төлбөрийн төлөв «${pay.value}» боллоо`); refreshAdminData(); } return; }
  });

  /* Шүүлтүүрүүд */
  $("#orderSearch")?.addEventListener("input", debounce(e => { ADMIN_STATE.orderSearch = e.target.value; renderOrdersSection(); }, 160));
  $("#orderStatusFilter")?.addEventListener("change", e => { ADMIN_STATE.orderStatus = e.target.value; renderOrdersSection(); });
  $("#orderPayFilter")?.addEventListener("change", e => { ADMIN_STATE.orderPay = e.target.value; renderOrdersSection(); });
  $("#orderDateFilter")?.addEventListener("change", e => { ADMIN_STATE.orderDate = e.target.value; renderOrdersSection(); });
  $("#ordersCsvBtn")?.addEventListener("click", async () => {
    const all = normAll(await adminLoadOrders());
    if (!all.length) return toast("Татах захиалга байхгүй байна", "error");
    downloadOrdersCSV(all, `norve_orders_${new Date().toISOString().slice(0, 10)}.csv`);
    toast("CSV файл татагдлаа");
  });

  /* ======= ХЭРЭГЛЭГЧИД ======= */
  async function renderUsersSection() {
    const body = $("#usersTableBody");
    if (!body) return;
    const users = Data.server ? (await Data.req("GET", "/api/users").catch(() => ({ users: store.get(KEYS.users, []).map(({ pass, ...rest }) => rest) }))).users : store.get(KEYS.users, []);
    const orders = normAll(await adminLoadOrders());
    const q = ADMIN_STATE.userSearch.trim().toLowerCase();
    let view = users.slice();
    if (q) view = view.filter(u => (`${u.name || ""} ${u.firstName || ""} ${u.lastName || ""} ${u.email || ""} ${u.phone || ""}`).toLowerCase().includes(q));
    /* зочин (бүртгэлгүй) захиалагчид — давхардгүй утас/и-мэйл дайралтаар */
    const registeredKeys = new Set(users.map(u => (u.email || "").toLowerCase() || u.phone || ""));
    const guests = new Map();
    orders.forEach(o => {
      const email = custEmail(o).toLowerCase(), phone = custPhone(o);
      const key = email || phone;
      if (!key || registeredKeys.has(email || phone)) return;
      if (guests.has(key)) { const g = guests.get(key); g.orders++; g.total += Number(o.total) || 0; if (new Date(o.createdAt) > new Date(g.last)) g.last = o.createdAt; }
      else guests.set(key, { guest: true, name: custName(o), email: custEmail(o), phone, orders: 1, total: Number(o.total) || 0, last: o.createdAt, id: "guest:" + key });
    });

    const userRow = u => {
      const uo = orders.filter(o => custEmail(o).toLowerCase() === (u.email || "").toLowerCase());
      const total = uo.reduce((a, o) => a + (Number(o.total) || 0), 0);
      const done = uo.filter(o => FULFILLED_STATUS_SET.includes(o.status)).length;
      const last = uo.length ? uo.map(o => o.createdAt).sort().slice(-1)[0] : null;
      return `
      <div class="at-row user-row" data-uid="${esc(u.id)}">
        <span><b>${esc(fullName(u))}</b><small>ID: ${esc(u.id)}</small></span>
        <span><small>${esc(u.email || "—")}</small><small>${esc(u.phone || "—")}</small></span>
        <span><small>${u.joinedAt ? fmtDate(u.joinedAt) : (u.joined ? fmtDate(u.joined) : "—")}</small></span>
        <span><small>${uo.length}</small></span>
        <span><small>${done}</small></span>
        <span><b>${fmtMNT(total)}</b></span>
        <span><small>${last ? fmtDate(last) : "—"}</small></span>
      </div>`;
    };
    const guestRow = g => `
      <div class="at-row user-row is-guest" data-uid="${esc(g.id)}">
        <span><b>${esc(g.name)}</b><small class="guest-tag">Зочин</small></span>
        <span><small>${esc(g.email || "—")}</small><small>${esc(g.phone || "—")}</small></span>
        <span><small>Бүртгэлгүй</small></span>
        <span><small>${g.orders}</small></span>
        <span><small>${g.orders}</small></span>
        <span><b>${fmtMNT(g.total)}</b></span>
        <span><small>${g.last ? fmtDate(g.last) : "—"}</small></span>
      </div>`;

    /* Эрэмбэлэх */
    if (ADMIN_STATE.usersSort === "count") view.sort((a, b) => usersOrderCount(b) - usersOrderCount(a));
    if (ADMIN_STATE.usersSort === "date") view.sort((a, b) => new Date(b.joinedAt || b.joined || 0) - new Date(a.joinedAt || a.joined || 0));
    function usersOrderCount(u) { return orders.filter(o => custEmail(o).toLowerCase() === (u.email || "").toLowerCase()).length; }

    const guestList = Array.from(guests.values());
    body.innerHTML = (view.length || guestList.length) ?
      [...view.map(userRow), ...guestList.map(guestRow)].join("") :
      `<div class="empty-state"><p>Бүртгэлтэй хэрэглэгч болон зочин захиалагч одоогоор байхгүй байна.</p></div>`;

    body.onclick = e => {
      const row = e.target.closest("[data-uid]");
      if (!row) return;
      const uid = row.dataset.uid;
      if (uid.startsWith("guest:")) { showGuestDetail(uid.slice("guest:".length), guestList); return; }
      showUserDetail(uid, users, orders);
    };
  }
  $("#userSearch")?.addEventListener("input", debounce(e => { ADMIN_STATE.userSearch = e.target.value; renderUsersSection(); }, 180));
  window.__setUsersSort = s => { ADMIN_STATE.usersSort = s; renderUsersSection(); };

  function showGuestDetail(key, guestList) {
    const g = guestList.find(x => (x.email || "").toLowerCase() === key || x.phone === key);
    if (!g) return;
    $("#userDetailContent").innerHTML = `
      <p class="eyebrow">Зочин захиалагч</p>
      <h3>${esc(g.name)}</h3>
      <p>Утас: <b>${esc(g.phone || "—")}</b> · И-мэйл: <b>${esc(g.email || "—")}</b></p>
      <p>Захиалгын тоо: <b>${g.orders}</b> · Нийт дүн: <b>${fmtMNT(g.total)}</b></p>
      <p class="cb-sub">Зочин захиалагчийн мэдээлэл зөвхөн түүний захиалгаас автамаар үндсэн мэдээлэл байна; зохиомол нэр, утас, и-мэйл хэрэглэхгүй.</p>`;
    $("#userDetailModal").classList.add("open");
    document.body.classList.add("no-scroll");
  }

  function showUserDetail(uid, users, orders) {
    const u = users.find(x => x.id === uid);
    if (!u) return;
    const uo = orders.filter(o => custEmail(o).toLowerCase() === (u.email || "").toLowerCase());
    const total = uo.reduce((a, o) => a + (Number(o.total) || 0), 0);
    $("#userDetailContent").innerHTML = `
      <p class="eyebrow">Хэрэглэгчийн мэдээлэл</p>
      <h3>${esc(fullName(u))}</h3>
      <div class="od-grid">
        <div>
          <p><b>ID:</b> ${esc(u.id)}</p>
          <p><b>Бүртгүүлсэн:</b> ${u.joinedAt ? fmtDate(u.joinedAt) : (u.joined ? fmtDate(u.joined) : "—")}</p>
          <p><b>Нийт захиалга:</b> ${uo.length}</p>
          <p><b>Биелсэн захиалга:</b> ${uo.filter(o => FULFILLED_STATUS_SET.includes(o.status)).length}</p>
          <p><b>Нийт дүн:</b> ${fmtMNT(total)}</p>
        </div>
        <div>
          <form id="userEditForm" novalidate>
            <div class="field"><label for="uEditLast">Овог</label><input type="text" id="uEditLast" value="${esc(u.lastName || "")}"></div>
            <div class="field"><label for="uEditFirst">Нэр</label><input type="text" id="uEditFirst" value="${esc(u.firstName || "")}"></div>
            <div class="field"><label for="uEditEmail">И-мэйл</label><input type="email" id="uEditEmail" value="${esc(u.email || "")}"></div>
            <div class="field"><label for="uEditPhone">Утас</label><input type="text" id="uEditPhone" value="${esc(u.phone || "")}"></div>
            <div class="am-actions">
              <button type="submit" class="btn btn-gold">Хадгалах</button>
              <button type="button" id="userDeleteBtn" class="btn btn-ghost">Хэрэглэгч устгах</button>
            </div>
          </form>
        </div>
      </div>
      <h4>Захиалгууд (${uo.length})</h4>
      <div class="nv-scroll-box">
        ${uo.length ? uo.map(o => `
          <div class="nvl-row" data-open-order="${esc(orderId(o))}">
            <b>${esc(orderId(o))}</b><span>${fmtDT(o.createdAt)}</span>
            <small>${fmtMNT(o.total)} · ${esc(o.status)}</small>
          </div>`).join("") : "<p>Захиалга байхгүй байна.</p>"}
      </div>`;
    $("#userDetailForm")?.addEventListener("submit", e2 => e2.preventDefault());
    $("#userEditForm")?.addEventListener("submit", async e2 => {
      e2.preventDefault();
      const patch = {
        firstName: $("#uEditFirst").value.trim(),
        lastName: $("#uEditLast").value.trim(),
        email: $("#uEditEmail").value.trim().toLowerCase(),
        phone: $("#uEditPhone").value.trim()
      };
      if (Data.server) {
        try { await Data.req("PATCH", "/api/users/" + encodeURIComponent(uid), patch); toast("Хэрэглэгчийн мэдээлэл шинэчлэгдлээ"); $("#userDetailModal").classList.remove("open"); document.body.classList.remove("no-scroll"); refreshAdminData(); }
        catch (e3) { toast(e3.message, "error"); }
      } else {
        const users = store.get(KEYS.users, []);
        const uu = users.find(x => x.id === uid);
        if (!uu) return;
        if (patch.email && users.some(x => x.email === patch.email && x.id !== uid)) return toast("И-мэйл давхардсан байна", "error");
        Object.assign(uu, patch);
        store.set(KEYS.users, users);
        localAudit("хэрэглэгч засах", uu.email);
        toast("Хэрэглэгчийн мэдээлэл шинэчлэгдлээ");
        $("#userDetailModal").classList.remove("open"); document.body.classList.remove("no-scroll");
        refreshAdminData();
      }
    });
    $("#userDeleteBtn")?.addEventListener("click", cooldownDeleteUser);
    async function cooldownDeleteUser() {
      if (!confirm("АНХААРУУЛГА: «${esc(fullName(u))}» хэрэглэгчийг устгах гэж байна. Энэ үйлдэл буцаагдахгүй. Устгах уу?".replace("${esc(fullName(u))}", fullName(u)))) return;
      if (Data.server) {
        try { await Data.req("DELETE", "/api/users/" + encodeURIComponent(uid)); toast("Хэрэглэгч устгагдлаа"); $("#userDetailModal").classList.remove("open"); document.body.classList.remove("no-scroll"); refreshAdminData(); }
        catch (e3) { toast(e3.message, "error"); }
      } else {
        let users = store.get(KEYS.users, []).filter(x => x.id !== uid);
        store.set(KEYS.users, users);
        localAudit("хэрэглэгч устгах", uid);
        toast("Хэрэглэгч устгагдлаа");
        $("#userDetailModal").classList.remove("open"); document.body.classList.remove("no-scroll");
        refreshAdminData();
      }
    }
  }

  /* ======= БРЭНДҮҮД ======= */
  async function renderBrandsSection() {
    const body = $("#brandsTableBody");
    if (!body) return;
    const info = Data.server ? (await Data.req("GET", "/api/brands/info").catch(() => ({ brands: store.get(KEYS.brandsInfo, []) }))).brands : store.get(KEYS.brandsInfo, []);
    body.innerHTML = ALL_BRANDS.map(brand => {
      const products = PRODUCTS.filter(p => p.brand === brand);
      let units = 0, revenue = 0;
      for (const o of normAll(allOrders())) {
        if (o.status === "Цуцлагдсан") continue;
        const f = o.status === "Буцаалт хийгдсэн" ? -1 : 1;
        for (const it of o.items) if (it.brand === brand) { units += f * (Number(it.qty) || 0); revenue += f * (Number(it.unitPrice) || 0) * (Number(it.qty) || 0); }
      }
      const b = info.find(x => x.name === brand) || {};
      return `
      <div class="at-row brand-row" data-open-brand="${esc(brand)}">
        <span><b>${esc(brand)}</b>${b.description ? "<small>" + esc(b.description.slice(0, 60)) + "</small>" : ""}</span>
        <span><small>${products.length}</small></span>
        <span><b>${units}</b><small>ширхэг</small></span>
        <span><b>${fmtMNT(revenue)}</b></span>
        <button type="button" class="ar-btn" data-brand-edit="${esc(brand)}">${ICONS.pencil} Засах</button>
      </div>`;
    }).join("");
    body.onclick = e => {
      const edit = e.target.closest("[data-brand-edit]");
      if (edit) { openBrandEditor(edit.dataset.brandEdit, info); return; }
      const open = e.target.closest("[data-open-brand]");
      if (open) {
        const brand = open.dataset.openBrand;
        const products = PRODUCTS.filter(p => p.brand === brand);
        openListModal(brand + " — бүтээгдэхүүнүүд", [], products.length ? "" : "Энэ брэндийн бүтээгдэхүүн одоогоор байхгүй байна.");
        $("#nvListModalBody").innerHTML = products.map(p => {
          const sd = soldData(p);
          return `<div class="nvl-row"><b>${esc(p.name)}</b><span>${esc(p.scentFamily)} · ${p.sizes.join(", ")}мл</span><small>${fmtMNT(p.basePrice)}</small><b class="nvl-total">${sd.units} ш</b><small>${fmtMNT(sd.revenue)}</small></div>`;
        }).join("");
      }
    };
  }
  $("#brandAddBtn")?.addEventListener("click", () => {
    openListModal("Шинэ брэнд — үйлдүүд", [], "");
    $("#nvListModalBody").innerHTML = `
      <form id="brandAddForm">
        <div class="field"><label for="nbName">Брэндийн нэр</label><input type="text" id="nbName" placeholder="Жишээ нь: Нийтлэлийн брэнд" required></div>
        <div class="field"><label for="nbDesc">Тайлбар</label><textarea id="nbDesc" rows="3"></textarea></div>
        <div class="am-actions"><button type="submit" class="btn btn-gold">Нэмэх</button></div>
      </form>`;
    $("#brandAddForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("#nbName").value.trim();
      if (!name) return toast("Брэндийн нэр шаардлагатай", "error");
      if (ALL_BRANDS.includes(name)) return toast("Тийм нэртэй брэнд аль хэдийн байна", "error");
      if (Data.server) { try { await Data.req("PATCH", "/api/brands/" + encodeURIComponent(name), { description: $("#nbDesc").value.trim() }); } catch (e2) { return toast(e2.message, "error"); } }
      else {
        const list = store.get(KEYS.brandsInfo, []);
        list.push({ name, description: $("#nbDesc").value.trim() });
        store.set(KEYS.brandsInfo, list);
        localAudit("брэнд нэмэх", name);
      }
      ALL_BRANDS.push(name);
      ALL_BRANDS.sort((a, b) => a.localeCompare(b, "mn"));
      toast(`«${name}» брэнд нэмэгдлээ (бүтээгдэхүүн нэмж бүртгэхэд ашиглана)`);
      closeListModal();
      renderBrandsSection();
    });
  });

  function openBrandEditor(brand, info) {
    const b = info.find(x => x.name === brand) || {};
    $("#brandEditTitle").textContent = "Брэнд: " + brand;
    $("#brandName").value = b.name || brand;
    $("#brandDescription").value = b.description || "";
    $("#brandLogo").value = b.logo || "";
    $("#brandWebsite").value = b.website || "";
    $("#brandEditModal").classList.add("open");
    document.body.classList.add("no-scroll");
    $("#brandEditForm").onsubmit = async e => {
      e.preventDefault();
      const patch = {
        description: $("#brandDescription").value.trim(),
        logo: $("#brandLogo").value.trim(),
        website: $("#brandWebsite").value.trim()
      };
      if (Data.server) { try { await Data.req("PATCH", "/api/brands/" + encodeURIComponent(brand), patch); } catch (e2) { return toast(e2.message, "error"); } }
      else {
        const list = store.get(KEYS.brandsInfo, []);
        const i = list.findIndex(x => x.name === brand);
        if (i >= 0) Object.assign(list[i], patch); else list.push({ ...patch, name: brand });
        store.set(KEYS.brandsInfo, list);
        localAudit("брэнд засах", brand);
      }
      toast("Брэндийн мэдээлэл хадгалагдлаа");
      $("#brandEditModal").classList.remove("open"); document.body.classList.remove("no-scroll");
      renderBrandsSection();
    };
  }

  /* ======= ТАЙЛАН ======= */
  function renderReportsSection() {
    const sum = $("#reportSummary");
    if (!sum) return;
    const period = $("#reportPeriod")?.value || ADMIN_STATE.reportPeriod;
    ADMIN_STATE.reportPeriod = period;
    const custom = period === "custom";
    $(".custom-date-range") && ($(".custom-date-range").style.display = custom ? "" : "none");
    let from = null, to = null, label = "—";
    if (custom) {
      const s = $("#reportStartDate")?.value, e = $("#reportEndDate")?.value;
      from = s ? new Date(s + "T00:00:00") : null;
      to = e ? new Date(e + "T23:59:59") : new Date();
      label = "Өөрийн огнооны хүрээ";
    } else { const r = periodRange(period); if (r) { from = r.from; to = r.to; label = r.label; } }

    adminLoadOrders().then(allList => {
      const norm = normAll(allList);
      const cur = norm.filter(o => inRange(o.createdAt, from, to));
      const st = computeStats(cur);
      /* Өмнөх ижил хугацаа (хувь харьцуулалт) */
      let prevLabel = "Өмнөх үе", prev = null;
      if (from && to && !custom) {
        const days = Math.round((to - from) / 86400000) || 1;
        prev = norm.filter(o => { const t = new Date(o.createdAt).getTime(); return t >= new Date(from.getTime() - days * 86400000).getTime() && t < from.getTime(); });
        prevLabel = "Өмнөх " + days + " хоног";
      } else if (custom && from) {
        prev = norm.filter(o => new Date(o.createdAt) < from);
        prevLabel = "Тус хугацаанаас өмнөх бүс (харьцуулалтын эталон: бүх зарим бүс)";
      }
      const prevSt = prev ? computeStats(prev) : null;
      const delta = (cur_, prev_) => {
        if (!prev_) return "—";
        if ((prev_ || 0) === 0) return cur_ > 0 ? "Шинэ орлого" : "0%";
        const d = ((cur_ - prev_) / prev_) * 100;
        return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
      };
      /* top бүтээгдэхүүн/брэнд — энэ хугацааны биелсэн захиалгаас */
      const itemAgg = new Map(), brandAgg = new Map();
      for (const o of cur) {
        if (!FULFILLED_STATUS_SET.includes(o.status)) continue;
        for (const it of o.items) {
          const k = String(it.productId);
          const a = itemAgg.get(k) || { id: k, name: it.name, brand: it.brand, units: 0, revenue: 0 };
          a.units += Number(it.qty) || 0; a.revenue += (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
          itemAgg.set(k, a);
          const b = brandAgg.get(it.brand) || { name: it.brand || "Мэдэгдэхгүй", units: 0, revenue: 0 };
          b.units += Number(it.qty) || 0; b.revenue += (Number(it.unitPrice) || 0) * (Number(it.qty) || 0);
          brandAgg.set(it.brand, b);
        }
      }
      const topItems = Array.from(itemAgg.values()).sort((a, b) => b.units - a.units).slice(0, 8);
      const topBrands = Array.from(brandAgg.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
      const maxUnits = topItems[0]?.units || 1;

      /* Өдөр бүрийн орлого — бодит тулд (орлого: төлбөр баталгаажсан, биелсэн) */
      const daily = {};
      for (const o of cur) {
        if (!FULFILLED_STATUS_SET.includes(o.status)) continue;
        const key = fmtDate(o.createdAt);
        const d = daily[key] = daily[key] || { orders: 0, revenue: 0, paid: 0 };
        d.orders++;
        if (o.paymentStatus === "Төлбөр баталгаажсан") d.paid += Number(o.total) || 0;
      }
      const dayKeys = Object.keys(daily).sort();
      const maxPaid = Math.max(1, ...dayKeys.map(k => daily[k].paid));

      sum.innerHTML = `
        <div class="rep-head"><b>${esc(label)}</b><small>${from ? fmtDate(from) : "—"}-ээс ${fmtDate(to || new Date())} хүртэл</small></div>
        <div class="kpi-grid">
          <div class="kpi-card"><b>${st.total}</b><small>Захиалга (${esc(delta(st.total, prevSt?.total))} ${esc(prevLabel)})</small></div>
          <div class="kpi-card"><b>${st.confirmed}</b><small>Баталгаажсан (${esc(delta(st.confirmed, prevSt?.confirmed))})</small></div>
          <div class="kpi-card"><b>${st.delivered}</b><small>Хүргэгдсэн (${esc(delta(st.delivered, prevSt?.delivered))})</small></div>
          <div class="kpi-card gold"><b>${fmtMNT(st.revenue)}</b><small>Борлуулалтын орлого (${esc(delta(Math.round(st.revenue), prevSt ? Math.round(prevSt.revenue) : null))})</small></div>
          <div class="kpi-card"><b>${st.units}</b><small>Борлуулсан ширхэг (${esc(delta(st.units, prevSt?.units))})</small></div>
          <div class="kpi-card"><b>${st.unpaid}</b><small>Төлбөр хүлээж буй</small></div>
        </div>
        <div class="rep-cols">
          <div class="rep-card">
            <h4>Хамгийн их зарагдсан бүтээгдэхүүн</h4>
            ${topItems.length ? topItems.map((r, i) => `
              <div class="bs-row"><span class="bs-rank">${i + 1}</span><div class="bs-info"><b>${esc(r.name)}</b><span>${esc(r.brand)}</span></div>
              <div class="bs-units"><b>${r.units}</b><small>ширхэг</small></div><b class="bs-rev">${fmtMNT(r.revenue)}</b>
              <div class="bs-bar"><i data-w="${Math.round(r.units / maxUnits * 100)}%"></i></div></div>`).join("") : "<p class='empty-note'>Энэ хугацаанд захиалга байхгүй байна</p>"}
          </div>
          <div class="rep-card">
            <h4>Борлуулалтаар тэргүүлэх брэндүүд</h4>
            ${topBrands.length ? topBrands.map(b => `
              <div class="br-row"><b class="br-name">${esc(b.name)}</b><div class="br-bar"><i data-w="${Math.round(b.revenue / (topBrands[0].revenue || 1) * 100)}%"></i></div><b>${fmtMNT(b.revenue)}</b><small>${b.units} ш</small></div>`).join("") : "<p class='empty-note'>Борлуулалтын брэндийн тоо байхгүй байна</p>"}
          </div>
        </div>
        <div class="rep-card">
          <h4>Өдөр бүрээр (орлого: төлбөр баталгаажсан захиалгууд)</h4>
          ${dayKeys.length ? `<div class="chart">${dayKeys.map(k => `
            <div class="chart-col" title="${esc(k)} — ${fmtMNT(daily[k].paid)}">
              <i style="--h:${Math.round(daily[k].paid / maxPaid * 100)}%"></i><small>${k.slice(-5)}</small>
            </div>`).join("")}</div>` : "<p class='empty-note'>Хугацаанд бодит захиалга байхгүй байна.</p>"}
        </div>
        <div class="admin-table" id="reportOrdersTable">
          <div class="at-row at-head"><span>Дугаар</span><span>Огноо</span><span>Харилцагч</span><span>Бүтээгдэхүүн</span><span>Төлбөр</span><span>Төлөв</span><span>Нийт дүн</span></div>
          <div class="report-table-body">
            ${(() => {
              const rows = cur.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
              if (!rows.length) return `<div class="empty-state"><p>Хугацаанд захиалга бүртгэгдээгүй байна.</p></div>`;
              return rows.map(o => `
                <div class="at-row order-row" data-open-order="${esc(orderId(o))}">
                  <span><b>${esc(orderId(o))}</b></span><span><small>${fmtDT(o.createdAt)}</small></span>
                  <span><small>${esc(custName(o))}</small></span><span><small>${o.items.map(it => esc(it.name)).join(", ")}</small></span>
                  <span><small>${esc(o.paymentMethodLabel)} · ${esc(o.paymentStatus)}</small></span>
                  ${statusPillHTML(o.status)}
                  <b>${fmtMNT(o.total)}</b></div>`).join("");
            })()}
          </div>
        </div>`;
      requestAnimationFrame(() => requestAnimationFrame(() =>
        $$("#reportSummary .bs-bar i, #reportSummary .br-bar i").forEach(el => el.style.width = el.dataset.w)));
    });
  }
  $("#reportPeriod")?.addEventListener("change", renderReportsSection);
  $("#reportGenerateBtn")?.addEventListener("click", renderReportsSection);
  $("#reportExportBtn")?.addEventListener("click", async () => {
    const norm = normAll(await adminLoadOrders());
    const period = $("#reportPeriod")?.value;
    let from = null, to = null;
    if (period === "custom") { const s = $("#reportStartDate")?.value, e2 = $("#reportEndDate")?.value; from = s ? new Date(s) : null; to = e2 ? new Date(e2 + "T23:59:59") : null; }
    else { const r = periodRange(period); if (r) { from = r.from; to = r.to; } }
    downloadOrdersCSV(norm.filter(o => inRange(o.createdAt, from, to)), `norve_report_${new Date().toISOString().slice(0, 10)}.csv`);
    toast("Тайлангийн CSV татагдлаа");
  });

  /* ======= ТОХИРГОО ======= */
  function fillAdminSettingsUI() {
    const settingsFromLocal = Data.server ? null : store.get(KEYS.settings, null);
    if (Data.server) {
      Data.req("GET", "/api/settings").then(j => applySettingsToForm(j.settings)).catch(() => {});
    } else if (settingsFromLocal) {
      applySettingsToForm(settingsFromLocal);
    }
  }
  function applySettingsToForm(s) {
    $("#settingOrderPrefix").value = s.orderPrefix || "NRV-";
    $("#settingOrderStart").value = s.orderNext ? String(s.orderNext) : "100001";
    $("#settingShipNormal").value = s.shipping?.normal ?? 10000;
    $("#settingShipExpress").value = s.shipping?.express ?? 15000;
    $("#payQpay").checked = (s.paymentMethods || []).includes("qpay");
    $("#payCard").checked = (s.paymentMethods || []).includes("card");
    $("#payBank").checked = (s.paymentMethods || []).includes("bank");
    $("#payCash").checked = (s.paymentMethods || []).includes("cash");
    if (Data.server) {
      $("#bankKhaan").value = s.banks?.khaan || "5014 6623 (₮ данс)";
      $("#bankGolomt").value = s.banks?.golomt || "24 1101 6794 (₮ данс)";
      $("#bankHas").value = s.banks?.has || "500 123 4567 (₮ данс)";
      $("#bankReceiver").value = s.banks?.receiver || "«НорВэ» ХХК";
    }
  }
  $("#settingsSaveBtn")?.addEventListener("click", async () => {
    const patch = {
      orderPrefix: $("#settingOrderPrefix").value.trim() || "NRV-",
      orderNext: Math.max(1, Number($("#settingOrderStart").value) || 100001),
      shipping: {
        normal: Math.max(0, Number($("#settingShipNormal").value) || 0),
        express: Math.max(0, Number($("#settingShipExpress").value) || 0)
      },
      paymentMethods: [
        $("#payQpay").checked ? "qpay" : null,
        $("#payCard").checked ? "card" : null,
        $("#payBank").checked ? "bank" : null,
        $("#payCash").checked ? "cash" : null
      ].filter(Boolean)
    };
    if (Data.server) patch.banks = {
      khaan: $("#bankKhaan")?.value.trim() || "", golomt: $("#bankGolomt")?.value.trim() || "",
      has: $("#bankHas")?.value.trim() || "", receiver: $("#bankReceiver")?.value.trim() || ""
    };
    if (Data.server) { await Data.req("PATCH", "/api/settings", patch); }
    else {
      store.set(KEYS.settings, patch);
      localAudit("тохиргоо хадгалах", "хүргэлт/төлбөрийн тохиргоо");
    }
    toast("Тохиргоо хадгалагдлаа");
  });

  /* Хуучин локаль захиалгыг сервер рүү нүүх (сервер горимд давхар устрануулалт) */
  async function importLegacy() {
    const orders = store.get(KEYS.orders, []).filter(o => o && o.items?.length);
    const users = store.get(KEYS.users, []);
    if (!orders.length && !users.length) return toast("Нүүлэх өгөгдөл байхгүй байна", "error");
    if (!confirm(`${orders.length} захиалга, ${users.length} хэрэглэгчийг серверийн өгөгдлийн санд нүүх гэж байна. Үргэлжлүүлэх үү?`)) return;
    for (const o of orders) if (!ORDER_STATUS_LABELS.includes(o.status) || !o.paymentStatus) { /* migrate before send */ }
    migrateLegacyOrders();
    try {
      const j = await Data.req("POST", "/api/import", { orders: store.get(KEYS.orders, []), users: store.get(KEYS.users, []) });
      toast(`Импортон дууслаа: ${j.movedOrders} захиалга, ${j.movedUsers} хэрэглэгч шилжлээ`);
      refreshAdminData();
    } catch (e) { toast(e.message, "error"); }
  }
  $("#importLegacyBtn")?.addEventListener("click", importLegacy);
  if (Data.server) {
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost"; btn.id = "importLegacyBtn";
    btn.innerHTML = ICONS.reset + " Сервер рүү нүүлэх (localStorage → DB)";
    btn.addEventListener("click", importLegacy);
    $("#section-settings")?.querySelector(".settings-grid")?.appendChild(btn);
  }

  async function refreshAdminData() {
    await renderDashboard();
    renderOrdersSection();
    renderUsersSection();
    renderBrandsSection();
    renderReportsSection();
  }
  window.__renderAdminPortal = renderAdminPortal;
  window.__gotoSection = sectionId => {
    const link = document.querySelector(`.sidebar-nav a[data-section='${sectionId}']`);
    if (link) link.click();
  };

  /* Цэсний товчид ажиллах үйлдэлүүд — тусдаа бүтцийн дахин render */
  window.adminSectionRenderers = {
    dashboard: renderDashboard,
    products: () => {},
    orders: renderOrdersSection,
    brands: renderBrandsSection,
    users: renderUsersSection,
    reports: renderReportsSection,
    settings: fillAdminSettingsUI
  };

  renderAdminPortal();
}

/* ---------- 6.8 Санаандгүй натуургүй зүгээр "Түргэн үзэх" (Quick-view модал) ---------- */
function openQuickView(id) {
  ensureOverlays();
  const p = byId(id);
  if (!p) return;
  const fd = fragData(p);
  const tierChip = (ns) => ns.map(n => `<span class="qv-note">${esc(n)}</span>`).join("");
  $("#qvCard").innerHTML = `
    <div class="qv-grid">
      <div class="qv-media"><img src="${p.image}" alt="${esc(p.brand)} ${esc(p.name)}">
        ${p.isNew ? '<span class="badge-new">Шинэ</span>' : ''}
      </div>
      <div class="qv-body">
        <p class="card-brand">${esc(p.brand)}</p>
        <h3 class="qv-name">${esc(p.name)}</h3>
        <div class="card-meta">${starsHTML(p.rating)}<span>${p.rating.toFixed(1)} · ${p.reviews.toLocaleString("ru-RU")} үнэлгээ</span></div>
        <p class="qv-price">${fmtMNT(minPrice(p))}<small>${Math.min(...p.sizes)}мл-ээс</small></p>
        <div class="qv-tiers">
          <div class="qv-tier"><span>${ICONS.sun}Толгой</span>${tierChip(p.notes.top.slice(0, 3))}</div>
          <div class="qv-tier"><span>${ICONS.heartFull}Зүрхэн</span>${tierChip(p.notes.middle.slice(0, 3))}</div>
          <div class="qv-tier"><span>${ICONS.drop}Суурь</span>${tierChip(p.notes.base.slice(0, 3))}</div>
        </div>
        <div class="qv-accords">
          <div class="accord-row mini"><span class="al">Тогтоц</span><div class="track"><i style="width:${fd.longevity}%"></i></div><b>${fd.longevityLabel.label}</b></div>
          <div class="accord-row mini"><span class="al">Түгэлт</span><div class="track"><i style="width:${fd.sillage}%"></i></div><b>${fd.sillageLabel}</b></div>
        </div>
        <p class="qv-desc">${esc((p.description || "").slice(0, 150))}${(p.description || "").length > 150 ? "…" : ""}</p>
        <div class="qv-actions">
          <button class="btn btn-gold" data-add="${p.id}" type="button">${ICONS.plusBag} Сагсанд нэмэх</button>
          <a class="btn btn-ghost" href="product.html?id=${p.id}">Дэлгэрэнгүй үзэх</a>
        </div>
      </div>
    </div>`;
  $("#qvModal").classList.add("open");
  document.body.classList.add("no-scroll");
}
function closeQuickView() {
  $("#qvModal")?.classList.remove("open");
  document.body.classList.remove("no-scroll");
}

/* ---------- 7. Сагсны drawer ---------- */
function renderCartDrawer() {
  const wrap = $("#cartItems");
  const foot = $("#cartFooter");
  if (!wrap) return;
  if (!cart.length) {
    wrap.innerHTML = `
      <div class="cd-empty">
        ${ICONS.bag}
        <p>Сагсан дотор одоогоор бүтээгдэхүүн байхгүй байна.</p>
        <a class="btn btn-gold" href="catalog.html">Үнэртэн сонгох</a>
      </div>`;
    foot.innerHTML = "";
    return;
  }
  wrap.innerHTML = cart.map(it => {
    const p = byId(it.id);
    if (!p) return "";
    return `
    <div class="cd-item">
      <a href="product.html?id=${p.id}"><img src="${p.image}" alt="${esc(p.name)}"></a>
      <div class="cd-info">
        <p class="cb">${esc(p.brand)}</p>
        <h4>${esc(p.name)}</h4>
        <p class="cs">${it.size}мл · ${esc(p.concentration)}</p>
        <div class="cd-qty">
          <button data-cq="${p.id}|${it.size}|-1" aria-label="Хасах тоо">−</button>
          <b>${it.qty}</b>
          <button data-cq="${p.id}|${it.size}|1" aria-label="Нэмэх тоо">+</button>
        </div>
      </div>
      <div class="cd-side">
        <span class="cprice">${fmtMNT(sizePrice(p, it.size) * it.qty)}</span>
        <button class="cd-remove" data-cd="${p.id}|${it.size}" aria-label="Хасах">${ICONS.trash}</button>
      </div>
    </div>`;
  }).join("");
  foot.innerHTML = `
    <div class="cd-total"><span>Нийт дүн</span><b>${fmtMNT(cartTotal())}</b></div>
    <a class="btn btn-gold" href="checkout.html" id="goCheckout">Захиалга хийх</a>
    <p class="cd-note">Хүргэлт болон төлбөрийн дэлгэрэнгүйг дараа сонгоно.</p>`;
}

function openCart() {
  renderCartDrawer();
  $("#cartDrawer")?.classList.add("open");
  $("#drawerOverlay")?.classList.add("show");
  document.body.classList.add("no-scroll");
}
function closeCart() {
  $("#cartDrawer")?.classList.remove("open");
  $("#drawerOverlay")?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}
function closeMobileNav() { document.body.classList.remove("nav-open"); }

/* Сагслалтын тоолуур шинэчлэх */
function updateCartBadge() {
  $$("#cartCount").forEach(el => {
    el.textContent = cartCount();
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  });
}

/* ---------- 8. Глобал үйл явдал (бүх хуудас) ---------- */
document.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { e.preventDefault(); addToCart(add.dataset.add); return; }

  const heart = e.target.closest("[data-wish]");
  if (heart) { e.preventDefault(); toggleWish(heart.dataset.wish); return; }

  const cq = e.target.closest("[data-cq]");
  if (cq) {
    const [id, size, d] = cq.dataset.cq.split("|");
    changeCartQty(id, size, Number(d));
    return;
  }

  const rm = e.target.closest("[data-cd]");
  if (rm) { const [id, size] = rm.dataset.cd.split("|"); removeFromCart(id, size); return; }

  /* Түргэн үзэх — бүтээгдэхүүний карт дээрх нүдэнд нь тусгай товч */
  const qv = e.target.closest("[data-qv]");
  if (qv) { e.preventDefault(); openQuickView(Number(qv.dataset.qv)); return; }

  /* Админ: бүтээгдэхүүн засах */
  const ed = e.target.closest("[data-edit]");
  if (ed) { e.preventDefault(); openProductEditor(Number(ed.dataset.edit)); return; }

  /* Модал хаажуулалт */
  const cl = e.target.closest("[data-close]");
  if (cl) {
    if (cl.dataset.close === "qv") closeQuickView();
    if (cl.dataset.close === "am") closeProductEditor();
    return;
  }

  /* Админ цэсийн арга хэмжээнүүд (legacy хавчуурга) */
  const ag = e.target.closest("[data-admin-go]");
  if (ag) {
    const act = ag.dataset.adminGo;
    if (act === "dash") nvNav("admin.html");
    if (act === "new")  openProductEditor("new");
    if (act === "reset") resetAllProducts();
    return;
  }

  /* Копи товч — данс/утас зэрэг мэдээлэл */
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    navigator.clipboard?.writeText(cp.dataset.copy).then(
      () => toast("Амжилттай хуулагдлаа"),
      () => toast("Хуулахад алдаа гарлаа", "error")
    );
    if (!navigator.clipboard) toast("Амжилттай хуулагдлаа");
    return;
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeCart(); closeMobileNav(); closeQuickView(); closeProductEditor(); }
});

/* Толгойны гүйлгэлтийн төлөв */
function initHeader() {
  const header = $("#siteHeader");
  const onScroll = () => header?.classList.toggle("scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* Өнөөгийн хуудсанд nav холбоос идэвхжүүлэх */
  const page = document.body.dataset.page;
  const linkMap = { home: "index.html", catalog: "catalog.html", product: "catalog.html", checkout: "", account: "account.html" };
  $$(".main-nav a").forEach(a => {
    if (a.getAttribute("href") === linkMap[page]) a.classList.add("active");
  });

  /* Мобайл цэс */
  $("#navToggle")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $$(".main-nav a").forEach(a => a.addEventListener("click", closeMobileNav));
  /* Гадна талд дарахад мобайл цэс хаагдана */
  document.addEventListener("click", e => {
    if (!document.body.classList.contains("nav-open")) return;
    if (e.target.closest("#navToggle") || e.target.closest(".main-nav")) return;
    closeMobileNav();
  });

  /* Сагс */
  $("#cartOpenBtn")?.addEventListener("click", openCart);
  $("#cartCloseBtn")?.addEventListener("click", closeCart);
  $("#drawerOverlay")?.addEventListener("click", () => { closeCart(); document.body.classList.remove("filters-open"); });
  window.addEventListener("pageshow", () => updateCartBadge());
  updateCartBadge();

  /* Хайлтын форм — бүх хуудас */
  $("#navSearchForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const q = $("#navSearchInput").value.trim();
    nvNav("catalog.html" + (q ? `?q=${encodeURIComponent(q)}` : ""));
  });

  /* Мэдээний бүртгэл (footer) */
  $("#newsletterForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const v = $("#newsletterInput").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast("Зөв и-мэйл хаяг оруулна уу", "error");
    $("#newsletterInput").value = "";
    toast("Мэдээний бүртгэл амжилттай хийгдлээ");
  });

  /* Админ: редактор доторх зургийн файл сонгогч + URL шууд урьдчилан харах */
  $("#amImgFile")?.addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      AM_STATE.imageData = await fileToDataURL(f);
      $("#amImgPrev").src = AM_STATE.imageData;
      $("#amImgUrl").value = "";
      toast("Локал зураг амжилттай оруулагдлаа");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#amImgUrl")?.addEventListener("change", () => {
    const v = $("#amImgUrl").value.trim();
    if (v) { $("#amImgPrev").src = v; AM_STATE.imageData = ""; }
  });
}

/* Зураг тасарванаар орлуулах — бүх зураг унасан үед fallback */
document.addEventListener("error", e => {
  const t = e.target;
  if (t?.tagName === "IMG" && !t.dataset.fbk) {
    t.dataset.fbk = "1";
    t.src = _I(IMAGE_POOL[0]);
  }
}, true);

/* Гүйлгэлт дээр алслан гаргах (reveal) ажиглагч */
const revealObserver = (() => {
  let obs;
  const ensure = () => obs || (obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" }));
  return {
    watch(root = document) { $$(".reveal", root).forEach(el => ensure().observe(el)); }
  };
})();

/* ---------- 9. Хуудас бүрийн эхлүүлэгч ---------- */

/* === 9.1 Нүүр хуудас === */
function pageHome() {
  /* Шилдэг борлуулалт — үнэлгээ × тоо эрэмблэсэн 8 */
  const grid = $("#bestGrid");
  if (grid) {
    const best = [...PRODUCTS].sort((a, b) => b.rating * b.reviews - a.rating * a.reviews).slice(0, 8);
    grid.innerHTML = best.map(productCardHTML).join("");
    revealObserver.watch(grid);
  }
  /* Ангилал бүрийн эзлэх тоог бодит өгөгдлөөр дүүргэх */
  const catCount = (g) => PRODUCTS.filter(p => p.gender === g).length;
  $$("[data-cat-count]").forEach(el => { el.textContent = catCount(el.dataset.catCount) + " үнэртэн"; });

  /* Брэндүүдийн хөвөгч тасралтгүй мөр */
  const mar = $("#brandMarquee");
  if (mar) mar.innerHTML = ALL_BRANDS.concat(ALL_BRANDS).map(b => `<span>${esc(b)}</span>`).join("");
}

/* === 9.2 Каталог хуудас === */
const CATALOG_STATE = {
  q: "", brands: [], genders: [], concs: [], sizes: [], fams: [],
  priceMin: 0, priceMax: 900000, sort: "popular", shown: 12
};
const PAGE_SIZE = 12;
const PRICE_FLOOR = 30000, PRICE_CEIL = 900000;

function applyUrlToFilters() {
  const q = getParam("q");       if (q) { CATALOG_STATE.q = q; }
  const brand = getParam("brand");  if (brand) { CATALOG_STATE.brands = [brand]; }
  const gender = getParam("gender"); if (gender) { CATALOG_STATE.genders = [gender]; }
}

function matchesFilters(p) {
  const s = CATALOG_STATE;
  const hay = (p.name + " " + p.brand).toLowerCase();
  if (s.q && !hay.includes(s.q.toLowerCase())) return false;
  if (s.brands.length && !s.brands.includes(p.brand)) return false;
  if (s.genders.length && !s.genders.includes(p.gender)) return false;
  if (s.concs.length && !s.concs.includes(p.concentration)) return false;
  if (s.sizes.length && !p.sizes.some(x => s.sizes.includes(x))) return false;
  if (s.fams.length && !s.fams.includes(p.scentFamily)) return false;
  const price = minPrice(p);
  if (price < s.priceMin || price > s.priceMax) return false;
  return true;
}

function sortedCatalog(list) {
  const s = CATALOG_STATE;
  const arr = list.slice();
  if (s.sort === "priceAsc")  arr.sort((a, b) => minPrice(a) - minPrice(b));
  if (s.sort === "priceDesc") arr.sort((a, b) => minPrice(b) - minPrice(a));
  if (s.sort === "rating")    arr.sort((a, b) => b.rating * b.reviews - a.rating * a.reviews);
  if (s.sort === "new")       arr.sort((a, b) => (b.isNew - a.isNew) || (b.id - a.id));
  return arr;
}

function renderCatalog(updateShown) {
  const grid = $("#catalogGrid");
  if (!grid) return;
  const list = sortedCatalog(PRODUCTS.filter(matchesFilters));
  const n = CATALOG_STATE.shown;
  grid.innerHTML = list.slice(0, n).map(productCardHTML).join("");
  revealObserver.watch(grid);
  refreshWishHearts();

  /* Хайлтын дүнгийн мэдэгдэл */
  const info = $("#resultCount");
  if (info) info.textContent = `Нийт ${list.length} бүтээгдэхүүн`;

  /* Хэдэн нэгж үзүүлж буй */
  const pageInfo = $("#shownInfo");
  if (pageInfo) pageInfo.textContent = list.length
    ? `${Math.min(n, list.length)} нэгж үзүүлэгдсэн · нийт ${list.length}`
    : "";

  /* Цааш үзэх товч */
  const more = $("#loadMoreBtn");
  if (more) {
    if (list.length > n) { more.style.display = ""; more.innerHTML = `Цааш үзэх <span class="gold">↓</span>`; }
    else { more.style.display = "none"; }
  }

  /* Хоосон төлөв */
  const empty = $("#catalogEmpty");
  if (empty) empty.style.display = list.length ? "none" : "";
  if (empty && !list.length) revealObserver.watch(empty);

  /* Шүүлтүүрийн нийт актив тоог мобайл товчин дээр харуулах */
  const activeCount = CATALOG_STATE.brands.length + CATALOG_STATE.genders.length
    + CATALOG_STATE.concs.length + CATALOG_STATE.sizes.length + CATALOG_STATE.fams.length
    + ((CATALOG_STATE.priceMin > PRICE_FLOOR || CATALOG_STATE.priceMax < PRICE_CEIL) ? 1 : 0);
  $("#mfbCount").textContent = activeCount;
  $("#mfbCount").style.display = activeCount ? "grid" : "none";
}

/* Шүүлтүүрийн бүх checkbox/chip бүтцийг дата дээр үүсгэх */
function buildFilterUI() {
  const mkCheck = (val, name, cnt) => `
    <label class="check"><input type="checkbox" data-f="${name}" value="${esc(val)}"><span class="box"></span><span class="txt">${esc(val)}</span>${cnt ? `<span class="cnt">${cnt}</span>` : ""}</label>`;

  const brandBox = $("#fgBrand .fg-body");
  if (brandBox) {
    brandBox.innerHTML = `<div class="fg-scroll">` + ALL_BRANDS.map(b => mkCheck(b, "brand", PRODUCTS.filter(p => p.brand === b).length)).join("") + `</div>`;
  }
  const mkGroup = (sel, values, key, countKey) => {
    const box = $(sel + " .fg-body");
    if (box) box.innerHTML = values.map(v => mkCheck(v, key, countKey ? PRODUCTS.filter(p => p[countKey] === v).length : 0)).join("");
  };
  mkGroup("#fgGender", ["Эрэгтэй", "Эмэгтэй", "Юнисекс"], "gender", "gender");
  mkGroup("#fgConc", CONCENTRATIONS, "conc", "concentration");
  mkGroup("#fgFamily", FAMILIES, "fam", "scentFamily");

  const sizeBox = $("#fgSizes .fg-body");
  if (sizeBox) sizeBox.outerHTML = `<div class="chip-row">` + [30, 50, 100, 150].map(s => `
    <label class="chip"><input type="checkbox" data-f="size" value="${s}"><span>${s}мл</span></label>`).join("") + `</div>`;

  /* Үнийн давхар slider */
  const min = $("#priceMinRange"), max = $("#priceMaxRange");
  if (min && max) {
    min.min = PRICE_FLOOR; min.max = PRICE_CEIL; min.value = PRICE_FLOOR; min.step = 5000;
    max.min = PRICE_FLOOR; max.max = PRICE_CEIL; max.value = PRICE_CEIL; max.step = 5000;
    min.addEventListener("input", () => {
      if (Number(min.value) > Number(max.value)) min.value = max.value;
      CATALOG_STATE.priceMin = Number(min.value);
      $("#priceMinInput").value = min.value;
      drawRange(); renderCatalog(); CATALOG_STATE.shown = 12;
    });
    max.addEventListener("input", () => {
      if (Number(max.value) < Number(min.value)) max.value = min.value;
      CATALOG_STATE.priceMax = Number(max.value);
      $("#priceMaxInput").value = max.value;
      drawRange(); CATALOG_STATE.shown = 12; renderCatalog();
    });
    $("#priceMinInput").addEventListener("change", e => {
      const v = clamp(Number(e.target.value) || PRICE_FLOOR, PRICE_FLOOR, CATALOG_STATE.priceMax);
      min.value = v; CATALOG_STATE.priceMin = v; drawRange(); CATALOG_STATE.shown = 12; renderCatalog();
    });
    $("#priceMaxInput").addEventListener("change", e => {
      const v = clamp(Number(e.target.value) || PRICE_CEIL, CATALOG_STATE.priceMin, PRICE_CEIL);
      max.value = v; CATALOG_STATE.priceMax = v; drawRange(); CATALOG_STATE.shown = 12; renderCatalog();
    });
    drawRange();
  }

  /* Бүх checkbox/chip listener — делегат байдлаар */
  $("#filtersPanel")?.addEventListener("change", e => {
    const cb = e.target.closest("[data-f]");
    if (!cb) return;
    const key = { brand: "brands", gender: "genders", conc: "concs", size: "sizes", fam: "fams" }[cb.dataset.f];
    const val = cb.dataset.f === "size" ? Number(cb.value) : cb.value;
    const arr = CATALOG_STATE[key];
    const i = arr.indexOf(val);
    if (cb.checked && i < 0) arr.push(val);
    if (!cb.checked && i >= 0) arr.splice(i, 1);
    CATALOG_STATE.shown = PAGE_SIZE;
    renderCatalog();
  });

  /* Бүлэг нээх/хаах */
  $$(".filter-group h3").forEach(h => h.addEventListener("click", () => h.parentElement.classList.toggle("closed")));

  /* Цэвэрлэх */
  $("#clearFiltersBtn")?.addEventListener("click", () => {
    Object.assign(CATALOG_STATE, { q: "", brands: [], genders: [], concs: [], sizes: [], fams: [], priceMin: PRICE_FLOOR, priceMax: PRICE_CEIL, shown: PAGE_SIZE });
    const min = $("#priceMinRange"), max = $("#priceMaxRange");
    if (min) min.value = PRICE_FLOOR;
    if (max) max.value = PRICE_CEIL;
    $("#priceMinInput").value = PRICE_FLOOR; $("#priceMaxInput").value = PRICE_CEIL;
    drawRange();
    $("#catalogSearch").value = "";
    $$("#filtersPanel input[type=checkbox]").forEach(cb => cb.checked = false);
    renderCatalog();
    toast("Шүүлтүүр цэвэрлэгдлээ");
  });

  /* Мобайл нээлт */
  $("#mobileFilterBtn")?.addEventListener("click", () => {
    document.body.classList.add("filters-open");
    $("#drawerOverlay")?.classList.add("show");
  });
  /* Шүүлтүүрийн drawer хаах товч */
  $("#filtersClose")?.addEventListener("click", () => {
    document.body.classList.remove("filters-open");
    $("#drawerOverlay")?.classList.remove("show");
  });
}

function drawRange() {
  const min = $("#priceMinRange"), max = $("#priceMaxRange");
  if (!min || !max) return;
  const p = ((min.value - PRICE_FLOOR) / (PRICE_CEIL - PRICE_FLOOR)) * 100;
  const q = ((max.value - PRICE_FLOOR) / (PRICE_CEIL - PRICE_FLOOR)) * 100;
  const fill = $("#rangeFill");
  fill.style.left = p + "%";
  fill.style.right = (100 - q) + "%";
}

function pageCatalog() {
  applyUrlToFilters();
  $("#catalogSearch").value = CATALOG_STATE.q;
  buildFilterUI();

  /* Хайлт */
  $("#catalogSearch").addEventListener("input", debounce(e => {
    CATALOG_STATE.q = e.target.value.trim();
    CATALOG_STATE.shown = PAGE_SIZE;
    renderCatalog();
  }, 160));

  /* Эрэмблэх */
  $("#sortSelect").addEventListener("change", e => {
    CATALOG_STATE.sort = e.target.value;
    CATALOG_STATE.shown = PAGE_SIZE;
    renderCatalog();
  });

  /* Цааш үзэх */
  $("#loadMoreBtn").addEventListener("click", () => {
    CATALOG_STATE.shown += PAGE_SIZE;
    renderCatalog();
    toast("Дараагийн бүтээгдэхүүнүүд ачаалагдлаа");
  });

  /* URL-аас ирсэн брэнд/хүйст checkbox-оор тэмдэглэгээ тавих */
  $$("#filtersPanel input[type=checkbox]").forEach(cb => {
    if (cb.dataset.f === "brand") cb.checked = CATALOG_STATE.brands.includes(cb.value);
    if (cb.dataset.f === "gender") cb.checked = CATALOG_STATE.genders.includes(cb.value);
  });

  renderCatalog();
}
/* === 9.3 Бүтээгдэхүүний дэлгэрэнгүй === */

/* Толгой бүрдэл (админ засварын дараа дахин дуудаж болно) */
function fillProductHeader(p) {
  $("#pvBreadBrand").textContent = p.brand;
  document.title = `${p.brand} — ${p.name} | НорВэ`;
  $("#pvBrand").innerHTML = `<a href="catalog.html?brand=${encodeURIComponent(p.brand)}">${esc(p.brand)}</a>`;
  $("#pvName").textContent = p.name;
  $("#pvStars").innerHTML = starsHTML(p.rating);
  $("#pvRatingText").innerHTML = `${p.rating.toFixed(1)} <small>· ${p.reviews.toLocaleString("ru-RU")} үнэлгээ</small>`;
  $("#pvImg").src = p.image;
  $("#pvImg").alt = `${p.brand} ${p.name} үнэртний лонх`;
  if (p.isNew) { $("#pvBadge").style.display = ""; } else { $("#pvBadge").style.display = "none"; }
  $("#pvDesc").textContent = p.description;
  $("#pvMetaCode").textContent = "NRV-" + String(p.id).padStart(3, "0");
  $("#pvMetaConc").textContent = p.concentration;
  $("#pvMetaFam").textContent = p.scentFamily;
  $("#pvMetaGender").textContent = p.gender;
}

/* Вилли болон үзүүлэлтийн бүрдэл (document бываал mandatory залгаа) */
function fillProductPyramidAndFrag() {
  const p = byId(getParam("id"));
  if (!p || !$("#pyrTop")) return;
  const fd = fragData(p);

  /* Пирамид: талбар бүр тайлбар tooltip-тэй электра-ялат "чарах areal" */
  const TIPS = {
    top:   "Эхний 15 минутанд үнэртэх сэнгэнэсэн үнэр",
    mid:   "Үнэртний гол амин сүнс — 2–4 цагийн турш",
    base:  "Амьсгаад орой нь арьсан дээр 6–12+ цаг үлдэх гүн үнэр"
  };
  $("#pyrTop").innerHTML    = p.notes.top.map(n => `<span class="pyr-note" data-tip="${TIPS.top}">${esc(n)}</span>`).join("");
  $("#pyrMid").innerHTML    = p.notes.middle.map(n => `<span class="pyr-note" data-tip="${TIPS.mid}">${esc(n)}</span>`).join("");
  $("#pyrBase").innerHTML   = p.notes.base.map(n => `<span class="pyr-note" data-tip="${TIPS.base}">${esc(n)}</span>`).join("");

  /* Тогтоц ба түгэлтийн бар */
  const longF = $("#accLongF"), silF = $("#accSilF");
  if (longF) { longF.style.width = "0%"; requestAnimationFrame(() => requestAnimationFrame(() => longF.style.width = fd.longevity + "%")); }
  if (silF)  { silF.style.width = "0%";  requestAnimationFrame(() => requestAnimationFrame(() => silF.style.width = fd.sillage + "%")); }
  const longT = $("#accLong"), silT = $("#accSil");
  if (longT) longT.innerHTML = `<b>${fd.longevityLabel.label}</b><small>${fd.longevityLabel.time}</small>`;
  if (silT)  silT.textContent = fd.sillageLabel;

  /* Улирал ба цагийн индикатор */
  $$("#seasonRow .season-chip").forEach(ch => ch.classList.toggle("on", fd.seasons.includes(ch.dataset.season)));
  $$("#occRow .season-chip").forEach(ch => ch.classList.toggle("on", (ch.dataset.occ === "Өдөр") === fd.day));

  /* Найрлагын түүх */
  const story = $("#storyText");
  if (story) story.textContent = fd.story;

  /* Баруун багана бүрдлийн харалдаа */
  revealObserver.watch($("#pyramidWrap") || document);
}

function pageProduct() {
  const p = byId(getParam("id"));
  const box = $("#productView");
  if (!box) return;

  if (!p) {
    $("#productNotFound").style.display = "";
    box.style.display = "none";
    $("#pyramidWrap").style.display = "none";
    $("#relatedWrap").style.display = "none";
    return;
  }

  /* Сүүлд үзсэн түүхэнд бүртгэх */
  const recent = store.get(KEYS.recent, []).filter(id => id !== p.id);
  recent.unshift(p.id);
  store.set(KEYS.recent, recent.slice(0, 10));

  fillProductHeader(p);
  fillProductPyramidAndFrag();

  /* Төлөв: сонгосон хэмжээ (50мл, байхгүй бол дундах), тоо, хүслэд байгаа эсэх */
  const state = { size: p.sizes.includes(50) ? 50 : p.sizes[Math.floor(p.sizes.length / 2)], qty: 1, wished: wishlist.includes(p.id) };
  const sizeRow = $("#pvSizes");
  sizeRow.innerHTML = p.sizes.map(ml => `
    <button type="button" class="size-btn${ml === state.size ? " active" : ""}" data-size="${ml}">
      <b>${ml}мл</b><i>${fmtMNT(sizePrice(p, ml))}</i>
    </button>`).join("");
  sizeRow.addEventListener("click", e => {
    const btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.size = Number(btn.dataset.size);
    $$(".size-btn", sizeRow).forEach(b => b.classList.toggle("active", b === btn));
    $("#pvPriceMain").textContent = fmtMNT(sizePrice(p, state.size) * state.qty);
    $("#pvPriceSize").textContent = state.size + "мл төлөвт";
  });

  /* Тоо ширхэг */
  $("#qtyDec").addEventListener("click", () => { state.qty = clamp(state.qty - 1, 1, 99); $("#qtyValue").textContent = state.qty; $("#pvPriceMain").textContent = fmtMNT(sizePrice(p, state.size) * state.qty); });
  $("#qtyInc").addEventListener("click", () => { state.qty = clamp(state.qty + 1, 1, 99); $("#qtyValue").textContent = state.qty; $("#pvPriceMain").textContent = fmtMNT(sizePrice(p, state.size) * state.qty); });

  /* Үнэ анхнаасаа */
  $("#pvPriceMain").textContent = fmtMNT(sizePrice(p, state.size) * state.qty);
  $("#pvPriceSize").textContent = state.size + "мл төлөвт";

  /* Сагслах */
  $("#pvAddCart").addEventListener("click", () => addToCart(p.id, state.size, state.qty));

  /* Хүслэд хадгалах */
  const wishBtn = $("#pvWish");
  wishBtn.classList.toggle("active", state.wished);
  wishBtn.addEventListener("click", () => {
    toggleWish(p.id);
    state.wished = !state.wished;
    wishBtn.classList.toggle("active", state.wished);
  });

  /* Админ: бүтээгдэхүүний хуудас дээр шууд засах */
  const adminEdit = $("#pvAdminEdit");
  if (adminEdit) {
    adminEdit.style.display = isAdmin() ? "inline-flex" : "none";
    adminEdit.addEventListener("click", () => openProductEditor(p.id));
  }

  /* Ижил төстэй үнэртэн — нэг брэнд / нэг гэр бүлээс 4 */
  const related = PRODUCTS
    .filter(x => x.id !== p.id && (x.brand === p.brand || x.scentFamily === p.scentFamily))
    .sort((a, b) => (b.brand === p.brand) - (a.brand === p.brand) || b.rating - a.rating)
    .slice(0, 4);
  $("#relatedGrid").innerHTML = related.map(productCardHTML).join("");
  revealObserver.watch($("#relatedGrid"));
  refreshWishHearts();
}
/* === 9.4 Төлбөр ба хүргэлт === */

/* Хот/аймаг бүрийн дүүрэг/сум */
const REGION_DISTRICTS = {
  "Улаанбаатар": ["Баянзүрх", "Чингэлтэй", "Сүхбаатар", "Баянгол", "Хан-Уул", "Сонгинохайрхан", "Багануур", "Багахангай", "Налайх"],
  "Дархан-Уул": ["Дархан сум", "Хонгор сум", "Шарын Гол"],
  "Орхон": ["Баян-Өндөр", "Жаргалант"],
  "Архангай": ["Цэцэрлэг", "Цэнхэр", "Ихтамир"],
  "Баян-Өлгий": ["Өлгий", "Толбо"],
  "Баянхонгор": ["Баянхонгор", "Галуут", "Шинэжинст"],
  "Булган": ["Булган", "Гурванбулаг", "Хутаг-Өндөр"],
  "Дорноговь": ["Сайншанд", "Замын-Үүд", "Зүүнбаян"],
  "Дорно": ["Дорно", "Хорол", "Айраг"],
  "Дундговь": ["Дэлгэрцогт", "Хужирт"],
  "Говь-Алтай": ["Алтай", "Халиун"],
  "Говьсүмбэр": ["Чойр", "Баянговь"],
  "Завхан": ["Улиастай", "Алдархан"],
  "Өвөрхангай": ["Арвайхээр", "Хархорин", "Өлзийт"],
  "Өмнөговь": ["Даланзадгад", "Ханбогд", "Булган"],
  "Сэлэнгэ": ["Сүхбаатар", "Шаамар", "Алтанбулаг"],
  "Сүхбаатар": ["Баруун-Урт", "Дарьганга", "Мөнххаан"],
  "Төв": ["Зуунмод", "Бор-Өндөр", "Лүн"],
  "Увс": ["Улаангом", "Давст", "Наранбулаг"],
  "Ховд": ["Ховд", "Манхан", "Дарви"],
  "Хөвсгөл": ["Мөрөн", "Хатгал", "Тос"],
  "Хэнтий": ["Өндөрхаан", "Дадал", "Хэрлэн"]
};

/* Төлбөрийн аргууд */
const PAY_METHODS = {
  qpay:  "QPay",
  card:  "Банкны карт",
  bank:  "Дансаар шилжүүлэх",
  cash:  "Хүргэлтээр бэлнээр"
};

/* Хүргэлтийн тохиргоо */
const SHIP_COST = { normal: 10000, express: 15000 };
const SHIP_LABEL = { normal: "Энгийн хүргэлт (2–3 хоног)", express: "Шуурхай хүргэлт (24 цагийн дотор)" };

/* Хаалтын QR код з utilizing зурах — симуляци (QPay бренд стайл) */
function drawQPayQR(canvas, seedStr) {
  const ctx = canvas.getContext("2d");
  const N = 21, cell = Math.floor(canvas.width / N);
  ctx.fillStyle = "#f6f5f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rng = rand(strHash(seedStr));
  const inFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
  /* Finder хэвүүд: гур? буланд */
  ctx.fillStyle = "#0b0b0e";
  const finder = (fr, fc) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (edge || core) ctx.fillRect((fc + c) * cell, (fr + r) * cell, cell, cell);
    }
  };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  /* Тайминг мөр */
  for (let i = 8; i < N - 8; i++) {
    if (i % 2 === 0) { ctx.fillRect(cell * i, 6 * cell, cell, cell); ctx.fillRect(6 * cell, cell * i, cell, cell); }
  }
  /* Бусад модулиуд */
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (inFinder(r, c) || r === 6 || c === 6) continue;
    if (rng() > 0.52) { ctx.fillStyle = "#0b0b0e"; ctx.fillRect(c * cell, r * cell, cell, cell); }
  }
  /* QPay бенчмарк? — төв дэвсгэр */
  ctx.fillStyle = "#f6f5f0";
  ctx.fillRect(N * cell * 0.3, N * cell * 0.3, N * cell * 0.4, N * cell * 0.18);
  ctx.fillStyle = "#d43737";
  ctx.font = `bold ${Math.floor(canvas.width / 15)}px Montserrat, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("QPay", canvas.width / 2, N * cell * 0.39);
}

function pageCheckout() {
  const layout = $("#checkoutLayout");
  const emptyBox = $("#checkoutEmpty");
  if (!layout) return;

  if (!cart.length) {
    emptyBox.style.display = "";
    layout.style.display = "none";
    revealObserver.watch(emptyBox);
    return;
  }

  /* Хот/а? дүүрэг сонголтууд */
  const citySel = $("#fCity");
  citySel.innerHTML = Object.keys(REGION_DISTRICTS)
    .map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  citySel.value = "Улаанбаатар";
  const fillDistricts = () => {
    const distSel = $("#fDistrict");
    distSel.innerHTML = REGION_DISTRICTS[citySel.value]
      .map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  };
  fillDistricts();
  citySel.addEventListener("change", fillDistricts);

  /* Нэвтэрсэн бол урьдчилан мөэ? нэр/утас бөглөх + хаягуудын чип */
  if (currentUser) {
    $("#fName").value = currentUser.name || "";
    $("#fPhone").value = currentUser.phone || "";
  }
  const addrBox = $("#savedAddresses");
  if (addrBox && currentUser?.addresses?.length) {
    addrBox.style.display = "";
    addrBox.innerHTML = (`<p class="sc-sub" style="margin:0 0 10px;">Хадгалсан хаягаас сонгох:</p>` +
      currentUser.addresses.map((a, i) => `
        <span class="addr-chip" data-fill-addr="${i}">${ICONS.mapPin}${esc(a.label)} <small>— ${esc(a.city)}, ${esc(a.district)}</small></span>`).join("")
    );
  }
  addrBox?.addEventListener("click", e => {
    const chip = e.target.closest("[data-fill-addr]");
    if (!chip) return;
    const a = currentUser.addresses[Number(chip.dataset.fillAddr)];
    if (!a) return;
    if (REGION_DISTRICTS[a.city]) { $("#fCity").value = a.city; fillDistricts(); }
    if (REGION_DISTRICTS[a.city]?.includes(a.district)) $("#fDistrict").value = a.district;
    $("#fKhoroo").value = a.khoroo || "";
    $("#fApartment").value = a.detail || "";
    toast("Хадгалсан хаягаар дүүргэлээ");
  });

  /* Хүргэлтийн төрөл */
  let ship = "normal";
  $$("input[name=shipType]").forEach(inp => inp.addEventListener("change", () => {
    ship = inp.value;
    renderSummary();
  }));

  /* Төлбөрийн таб */
  $$(".pay-tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".pay-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    $$(".pay-panel").forEach(p => p.classList.remove("active"));
    const panel = `#pay-${tab.dataset.pay}`;
    $(panel)?.classList.add("active");
    /* QPay QR зурах */
    if (tab.dataset.pay === "qpay") {
      drawQPayQR($("#qrCanvas"), "NRV-" + Date.now() + cartTotal());
    }
  }));
  /* анхдагч актив QPay QR зуруулах? — эхний таб картыг онцlogen? — Картыг анхдагч болгоё */
  drawQPayQR($("#qrCanvas"), "NRV-INIT");
  $("#qpayAmount").textContent = fmtMNT(cartTotal()); /* дүн? дараа шинэчилнэ */

  /* Картын оролтын формат */
  const cardNum = $("#fCardNum");
  cardNum.addEventListener("input", () => {
    cardNum.value = cardNum.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
    $("#cvNum").textContent = cardNum.value || "0000 0000 0000 0000";
  });
  $("#fCardExp").addEventListener("input", () => {
    let v = $("#fCardExp").value.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    $("#fCardExp").value = v;
    $("#cvExp").textContent = v || "MM/YY";
  });
  $("#fCardCvv").addEventListener("input", () => {
    $("#fCardCvv").value = $("#fCardCvv").value.replace(/\D/g, "").slice(0, 3);
  });
  /* Картын нэр */
  $("#fCardName").addEventListener("input", () => {
    $("#cvName").textContent = $("#fCardName").value.toUpperCase() || "НЭР ОВОГ";
  });

  /* Хураангуй ба нийт дүн */
  const summaryItems = $("#sumItems");
  function renderSummary() {
    summaryItems.innerHTML = cart.map(it => {
      const p = byId(it.id);
      if (!p) return "";
      return `
      <div class="os-item">
        <img src="${p.image}" alt="${esc(p.name)}">
        <div class="osi-t"><h4>${esc(p.name)}</h4><small>${esc(p.brand)} · ${it.size}мл · ${it.qty} ширхэг</small></div>
        <span class="osi-p">${fmtMNT(sizePrice(p, it.size) * it.qty)}</span>
      </div>`;
    }).join("");
    const subtotal = cartTotal();
    const total = subtotal + SHIP_COST[ship];
    $("#sumSub").textContent = fmtMNT(subtotal);
    $("#sumShip").textContent = fmtMNT(SHIP_COST[ship]);
    $("#sumTotal").textContent = fmtMNT(total);
    $("#qpayAmount").textContent = fmtMNT(total);
  }
  renderSummary();

  /* Захиалга бүртгэүүлэх — сервер (data/db.json) эсвэл локал горим;
     давхар илгээлтээс хамгаалж, бодит бүртгэл үүсэхээс өмнө хуурамчаар "амжилттай" хэлэхгүй */
  $("#checkoutForm").addEventListener("submit", async e => {
    e.preventDefault();
    const form = $("#checkoutForm");
    const submitBtn = $("#placeOrder");
    if (form.dataset.submitting === "1") return;
    const pay = $$(".pay-tab.active")[0].dataset.pay;
    const total = cartTotal() + SHIP_COST[ship];

    /* Талбар шалгалт: нэр, утас */
    const mark = (el, bad) => el.classList.toggle("invalid", !!bad);
    const nameEl = $("#fName"), phoneEl = $("#fPhone");
    const firstName = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    let bad = false;
    if (!firstName) { mark(nameEl, true); bad = true; } else mark(nameEl, false);
    if (!/^\d{8}$/.test(phone)) { mark(phoneEl, true); bad = true; } else mark(phoneEl, false);
    if (pay === "card") {
      const cnum = $("#fCardNum").value.replace(/\s/g, "");
      const cexp = $("#fCardExp").value;
      const ccvv = $("#fCardCvv").value;
      const cname = $("#fCardName").value.trim();
      if (cnum.length !== 16 || cexp.length !== 5 || ccvv.length !== 3 || !cname) {
        bad = true;
        toast("Картын мэдээллийг бүрэн зөв оруулна уу", "error");
      }
    }

    if (bad) {
      toast("Шаардлагатай талбаруудыг шалгана уу", "error");
      const firstBad = $(".invalid", $("#checkoutForm")) || $("#checkoutForm");
      firstBad?.focus();
      return;
    }

    try {
      await Data.init();
      form.dataset.submitting = "1";
      submitBtn.disabled = true;
      const origBtnTxt = submitBtn.textContent;
      submitBtn.textContent = "Илгээж байна...";

      /* Бүтээгдэхүүний нэр/үнэ хугацааны хуулбар (snapshot) байдлаар илгээнэ —
         дараа үнэ өөрчлөгдсөн ч эзэлсэн захиалгын үнэ өөрчлөгдөхгүй */
      const items = snapshotItems();
      if (!items.length) { toast("Сагс хоосон байна", "error"); return; }

      const email = currentUser ? (currentUser.email || "") : "";
      /* Овог/нэр хуваах: хэрэглэгчийг тогтоох нэг талбарын тулд нэр талбарыг ашиглана */
      const parts = firstName.split(" ");
      const lastName = currentUser ? (currentUser.lastName || "") : "";
      const given = currentUser ? (currentUser.firstName || firstName) : firstName.replace(lastName, "").trim() || firstName;

      const result = await createOrder({
        customer: { firstName: given, lastName, phone, email },
        items,
        shippingFee: SHIP_COST[ship],
        delivery: {
          type: ship,
          city: $("#fCity").value,
          district: $("#fDistrict").value,
          khoroo: $("#fKhoroo").value.trim(),
          apartment: $("#fApartment").value.trim()
        },
        customerNote: $("#fNote").value.trim(),
        paymentMethod: pay,
        paymentMethodLabel: PAY_METHODS[pay]
      });

      /* Сагс ба үзүүлэлт цэвэрлэх */
      cart = [];
      saveCart(); updateCartBadge();
      layout.style.display = "none";

      /* Баталгааны modal — бодит бүртгэл үүссэний дараа */
      $("#mOrderId").textContent = result.orderNo;
      $("#mRows").innerHTML = `
        <div><span>Нийт дүн</span><b>${fmtMNT(result.total || total)}</b></div>
        <div><span>Төлбөрийн арга</span><b>${esc(PAY_METHODS[pay])}</b></div>
        <div><span>Төлбөрийн төлөв</span><b>${esc(result.paymentStatus)}</b></div>
        <div><span>Хүргэлт</span><b>${esc(SHIP_LABEL[ship])}</b></div>
        <div><span>Хаяг</span><b>${esc($("#fCity").value)} · ${esc($("#fDistrict").value)} · ${esc($("#fKhoroo").value.trim())} хороо</b></div>
      `;
      $("#orderModal").classList.add("open");
      document.body.classList.add("no-scroll");
      toast("Захиалга амжилттай бүртгэгдлээ");
    } catch (err) {
      toast(err && err.message ? err.message : "Захиалга бүртгэхэд алдаа гарлаа — дахин оролдоно уу", "error");
    } finally {
      form.dataset.submitting = "0";
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origBtnTxt || "Илгээх"; }
    }
  });

  /* Modal хаах */
  $("#orderModalClose")?.addEventListener("click", () => {
    $("#orderModal").classList.remove("open");
    emptyBox.style.display = "";
    document.body.classList.remove("no-scroll");
    revealObserver.watch(emptyBox);
  });
}
/* === 9.5 Хэрэглэгчийн булан ===
   Захиалгын төлөвийг хийсвэрээр дэвшүүлдэг хиймэл симуляци биш — захиалга бүр
   өөрийн бодит статусаар (админ/серверээс тогтоосон) харагдана. */

/* Визуал дэвшилтийн алхмууд — бодит төлөвөөс гардана */
const ACCOUNT_STEPS = ["Шинэ захиалга", "Баталгаажсан", "Бэлтгэж байгаа", "Хүргэлтэд гарсан", "Хүргэгдсэн"];

/* Төлөв → дэвшилтийн алхмын тоо (Цуцлагдсан/Буцаалт = -1 — шугам үзүүлэхгүй) */
function progressForStatus(status) {
  if (status === "Цуцлагдсан" || status === "Буцаалт хийгдсэн") return -1;
  return Math.max(0, ACCOUNT_STEPS.indexOf(status));
}

function userOrders() {
  return myOrderList;
}

/* Миний захиалгууд — сервер горимд /api/me/orders, локал горимд localStorage */
let myOrderList = [];
async function loadMyOrders() {
  if (!currentUser) { myOrderList = []; return myOrderList; }
  if (!Data.server) migrateLegacyOrders();
  if (Data.server && Data.token) {
    try {
      const j = await Data.req("GET", "/api/me/orders");
      myOrderList = (j.orders || []).slice().reverse();  /* шинэ нь дээр */
      return myOrderList;
    } catch {
      myOrderList = [];
      return myOrderList;
    }
  }
  myOrderList = store.get(KEYS.orders, []).filter(o => currentUser && custEmail(o) === currentUser.email).reverse();
  return myOrderList;
}

/* Хүмүүний дурлалын тохиргоо → бэдж бичээс */
function scentBadgeText(favs) {
  const f = Array.isArray(favs) ? favs.filter(Boolean) : [];
  if (!f.length) return "Үнэрийн профайл сонгоогүй";
  if (f.length === 1) return `${f[0]} үнэрт дурлагч`;
  if (f.length === 2) return `${f[0]} ба ${f[1]} үнэрт дурлагч`;
  return `${f.slice(0, 2).join(", ")} болон бусад үнэрт дурлагч`;
}

function userOrders() {
  return store.get(KEYS.orders, []).filter(o => currentUser && o.email === currentUser.email);
}

function pageAccount() {
  const authWrap = $("#authWrap");
  const profileWrap = $("#profileLayout");
  if (!authWrap || !profileWrap) return;

  /* Админ дансаар нэвтэрсэн бол — зорилтот админ портал руу автоматаар шилжүүлнэ */
  if (isAdmin()) { nvNav("admin.html"); return; }

  /* --- Таб переключ --- */
  $$(".auth-tabs button").forEach(btn => btn.addEventListener("click", () => {
    $$(".auth-tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".auth-form").forEach(f => f.classList.remove("active"));
    $(`#loginForm`).classList.toggle("active", btn.dataset.tab === "login");
    $(`#registerForm`).classList.toggle("active", btn.dataset.tab === "register");
  }));

  /* --- Бүртгүүлэх (Овог, Нэр, Утас, и-мэйл) — сервер байвал серверийн санд,
     байхгүй бол локал. Нууц үг ямар ч горимд ил тод (plaintext)-аар хадгалагдахгүй. --- */
  $("#registerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const last = $("#rLast")?.value.trim() || "";
    const first = $("#rFirst")?.value.trim() || "";
    const email = $("#rEmail").value.trim().toLowerCase();
    const phone = $("#rPhone").value.trim();
    const pass = $("#rPass").value;
    const pass2 = $("#rPass2").value;
    const agree = $("#rAgree").checked;

    const bad = (sel, ok) => $(sel)?.classList.toggle("invalid", !ok);
    let ok = true;
    if (!last) { ok = false; bad("#rLast", false); } else bad("#rLast", true);
    if (!first) { ok = false; bad("#rFirst", false); } else bad("#rFirst", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ok = false; bad("#rEmail", false); } else bad("#rEmail", true);
    if (!/^\d{8}$/.test(phone)) { ok = false; bad("#rPhone", false); } else bad("#rPhone", true);
    if (pass.length < 6) { ok = false; bad("#rPass", false); } else bad("#rPass", true);
    if (pass !== pass2) { ok = false; bad("#rPass2", false); } else bad("#rPass2", true);
    if (!agree) { toast("Үйлчилгээний нөхцөлөөс зөвшөөрнө үү", "error"); ok = false; }
    if (!ok) { toast("Талбаруудыг зөв бөглөнө үү", "error"); return; }

    try {
      await Data.init();
      if (Data.server) {
        /* Серверийн бүртгэл — хэш (scrypt) сервер талд */
        const j = await Data.req("POST", "/api/users/register", { firstName: first, lastName: last, email, phone, pass });
        Data.token = j.token || "";
        if (Data.token) sessionStorage.setItem("norve_token", Data.token);
        currentUser = j.user || null;
        if (currentUser) {
          currentUser.notif = currentUser.notif || { deals: true, drops: true, status: true };
          currentUser.scentFav = currentUser.scentFav || [];
          currentUser.addresses = currentUser.addresses || [];
        }
        saveUser();
        toast("Бүртгүүлэлт амжилттай! Тавтай морил.");
        renderProfileView();
        return;
      }
      /* Локал горим — SHA-256 хэштэй хадгална, ил тод pass-г хэзээ ч хадгалахгүй */
      const users = store.get(KEYS.users, []);
      if (users.some(u => u.email === email)) {
        $("#rEmail").classList.add("invalid");
        toast("Энэ и-мэйл хаягтай данс аль хэдийн бүртгэгдсэн байна", "error");
        return;
      }
      const { salt, passHash } = await hashPassword(pass);
      const rec = {
        id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: (last + " " + first).trim(), firstName: first, lastName: last,
        email, phone, salt, passHash,
        joined: new Date().toISOString(), addresses: [], avatar: "",
        notif: { deals: true, drops: true, status: true }, scentFav: []
      };
      users.push(rec);
      store.set(KEYS.users, users);
      currentUser = { id: rec.id, name: rec.name, firstName: first, lastName: last, email, phone, joined: rec.joined, addresses: [], avatar: "", notif: rec.notif, scentFav: [] };
      saveUser();
      toast("Бүртгүүлэлт амжилттай! Тавтай морил.");
      renderProfileView();
    } catch (err) {
      const msg = (err && err.message) || "Бүртгүүлж чадсангүй";
      if (msg.includes("аль хэдийн")) $("#rEmail").classList.add("invalid");
      toast(msg, "error");
    }
  });

  /* --- Нэвтрэх — админ данс (сервер байвал Bearer token), эсвэл энгийн хэрэглэгч --- */
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#lEmail").value.trim().toLowerCase();
    const pass = $("#lPass").value;
    $$("#loginForm .invalid").forEach(el => el.classList.remove("invalid"));

    try {
      await Data.init();
      /* Хатуу бүртгэгдсэн админ данс — зориулалтын портал руу шилжинэ */
      if (email === ADMIN_AUTH.email) {
        if (Data.server) {
          const j = await Data.req("POST", "/api/admin/login", { email, pass });
          Data.token = j.token || "";
          if (Data.token) sessionStorage.setItem("norve_token", Data.token);
          else sessionStorage.removeItem("norve_token");
          currentUser = makeAdminUser();
          if (j.actor) currentUser.name = j.actor;
          saveUser();
          applyAdminState();
          toast("Админ горим нээгдлээ — тавтай морил!");
          nvNav("admin.html");
          return;
        }
        if (pass === ADMIN_AUTH.pass) {
          currentUser = makeAdminUser();
          saveUser();
          applyAdminState();
          toast("Админ горим нээгдлээ — тавтай морил!");
          nvNav("admin.html");
          return;
        }
        $("#lEmail").classList.add("invalid");
        $("#lPass").classList.add("invalid");
        toast("И-мэйл эсвэл нууц үг буруу байна", "error");
        return;
      }

      if (Data.server) {
        const j = await Data.req("POST", "/api/users/login", { email, pass });
        Data.token = j.token || "";
        if (Data.token) sessionStorage.setItem("norve_token", Data.token);
        else sessionStorage.removeItem("norve_token");
        currentUser = j.user || null;
        if (currentUser) {
          currentUser.notif = currentUser.notif || { deals: true, drops: true, status: true };
          currentUser.scentFav = currentUser.scentFav || [];
          currentUser.addresses = currentUser.addresses || [];
        }
        saveUser();
        toast(`Тавтай морил, ${currentUser.firstName || ""}!`.trim());
        renderProfileView();
        return;
      }

      /* Локал горим — хэш-тай харьцуулна; хуучин ил тод нууц үгтэй бүртгэлийг
         нэвтрэх үед хэш рүү нүүнэ (ил тод pass-г устгана) */
      const users = store.get(KEYS.users, []);
      const user = users.find(u => u.email === email);
      if (!user) {
        $("#lEmail").classList.add("invalid");
        $("#lPass").classList.add("invalid");
        toast("И-мэйл эсвэл нууц үг буруу байна", "error");
        return;
      }
      let ok = false, upgraded = false;
      if (user.passHash) {
        ok = (await hashPassword(pass, user.salt)).passHash === user.passHash;
      } else if (user.pass) {
        ok = user.pass === pass;
        if (ok) {
          const h = await hashPassword(pass);
          user.salt = h.salt; user.passHash = h.passHash;
          delete user.pass;
          upgraded = true;
        }
      }
      if (!ok) {
        $("#lEmail").classList.add("invalid");
        $("#lPass").classList.add("invalid");
        toast("И-мэйл эсвэл нууц үг буруу байна", "error");
        return;
      }
      if (upgraded) store.set(KEYS.users, users);
      /* Хуучинчилсан бүртгэлтэй нийцүүлэх талбар */
      if (!user.firstName) { user.firstName = (user.name || "").split(" ").slice(-1)[0] || user.email.split("@")[0]; user.lastName = (user.name || "").split(" ").slice(0, -1).join(" "); }
      user.notif = user.notif || { deals: true, drops: true, status: true };
      user.scentFav = user.scentFav || [];
      currentUser = { ...user, pass: undefined, passHash: undefined, salt: undefined };
      delete currentUser.pass; delete currentUser.passHash; delete currentUser.salt;
      saveUser();
      toast(`Тавтай морил, ${user.firstName}!`);
      renderProfileView();
    } catch (err) {
      $("#lEmail").classList.add("invalid");
      $("#lPass").classList.add("invalid");
      toast((err && err.message) || "Нэвтрэхэд алдаа гарлаа", "error");
    }
  });

  $("#forgotBtn")?.addEventListener("click", () => toast("Нууц үг сэргээх зааварчилгаа и-мэйл хаяг дээр тань илгээгдлээ"));

  /* --- Зүүн талын таб сан (smooth pane switch) --- */
  function setPane(name) {
    $$(".p-nav button[data-pane]").forEach(b => b.classList.toggle("active", b.dataset.pane === name));
    $$(".profile-pane").forEach(p => p.classList.remove("active"));
    const pane = $(`#pane-${name}`);
    if (pane) pane.classList.add("active");
    /* Зөөлөн height/opacity шилжилт: шинэ панель бага зэрэг дэвшинэ орно */
    if (typeof pane?.animate === "function") {
      pane.animate(
        [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
        { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      );
    }
  }
  $$(".p-nav button[data-pane]").forEach(btn => btn.addEventListener("click", () => setPane(btn.dataset.pane)));

  /* Мобайл дээр зүүн цэсийг товчоор нээх/хаах (dropdown загвар) */
  $("#pNavToggle")?.addEventListener("click", () => {
    const side = $("#pNavToggle")?.closest(".profile-side");
    if (!side) return;
    const open = side.classList.toggle("open");
    $("#pNavToggle").classList.toggle("open", open);
    $("#pNavToggle").setAttribute("aria-expanded", String(open));
    $("#pNavToggle").textContent = open ? "Профайлын цэс хаах" : "Профайлын цэс нээх";
  });
  /* Панель сонгосны дараа моб цэсийг хаана */
  $$(".p-nav button").forEach(btn => btn.addEventListener("click", () => {
    const toggle = $("#pNavToggle");
    toggle?.closest(".profile-side")?.classList.remove("open");
    if (toggle) {
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Профайлын цэс нээх";
    }
  }));

  /* Гарах */
  $("#logoutBtn")?.addEventListener("click", () => {
    if (isAdmin() && Data.token) {
      Data.req("POST", "/api/admin/logout").catch(() => {});   /* сешнийг серверээс ч цэвэрлэе */
    }
    currentUser = null; saveUser();
    sessionStorage.removeItem("norve_token");
    Data.token = "";
    nvNav("account.html");
  });

  /* Хаягийн хот/аймгийн сонголт */
  const aCity = $("#aCity");
  if (aCity) {
    aCity.innerHTML = Object.keys(REGION_DISTRICTS).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    aCity.value = "Улаанбаатар";
  }

  /* Нэвтрэх ↔ Бүртгүүлэх шилжүүлгийн холбоосууд */
  $("#goRegister")?.addEventListener("click", () => $$(".auth-tabs button")[1].click());
  $("#goLogin")?.addEventListener("click", () => $$(".auth-tabs button")[0].click());

  /* --- Аватар импорт (локал файл эсвэл URL) --- */
  function renderAvatar() {
    const letter = fullName(currentUser).charAt(0).toUpperCase();
    [$("#pAvatar"), $("#avPreview")].forEach(av => {
      if (!av) return;
      if (currentUser.avatar) {
        av.innerHTML = `<img src="${currentUser.avatar}" alt="Профайл зураг">`;
      } else {
        av.textContent = letter;
      }
    });
  }
  /* Өөрийн профиль бичлэгийг серверийн санд мөн хадгалах (best-effort) */
  async function pushSelfPatch(patch) {
    if (Data.server && Data.token && !isAdmin()) {
      try { await Data.req("PATCH", "/api/me", patch); } catch { /* локал хадгалалтад үлдэнэ */ }
    }
  }
  function pushAvatarToServer() { return pushSelfPatch({ avatar: currentUser.avatar }); }
  $("#avFile")?.addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const durl = await fileToDataURL(f, 320);
      currentUser.avatar = durl;
      saveUser(); syncUserStore(); pushAvatarToServer();
      renderAvatar();
      toast("Профайл зураг шинэчлэгдлээ");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#avUrlSave")?.addEventListener("click", () => {
    const u = $("#avUrl")?.value.trim();
    if (!u || !/^https?:\/\//.test(u)) { toast("Зөв http(s) холбоос оруулна уу", "error"); return; }
    currentUser.avatar = u;
    saveUser(); syncUserStore(); pushAvatarToServer();
    renderAvatar();
    $("#avUrl").value = "";
    toast("Профайл зураг холбоосоор шинэчлэгдлээ");
  });

  /* --- Профайл панельүүд (Овог, Нэр, Утас, и-мэйл) — сервер горимд серверийн санад --- */
  $("#profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!currentUser) return;
    if (isAdmin()) { toast("Админ дансны профайл засах боломжгүй", "error"); return; }
    const last = $("#pLast")?.value.trim();
    const first = $("#pFirst")?.value.trim();
    const phone = $("#pPhone").value.trim();
    const newEmail = $("#pEmail").value.trim().toLowerCase();
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { $("#pEmail").classList.add("invalid"); toast("И-мэйл хаяг буруу байна", "error"); return; }

    /* Аватар retained: currentUser.avatar */
    if (Data.server && Data.token) {
      try {
        const patch = {};
        if (first !== undefined) patch.firstName = first || currentUser.firstName || "";
        if (last !== undefined) patch.lastName = last || currentUser.lastName || "";
        patch.phone = phone || currentUser.phone || "";
        patch.email = newEmail || currentUser.email;
        const j = await Data.req("PATCH", "/api/me", patch);
        currentUser = { ...currentUser, ...(j.user || {}), joined: (j.user && j.user.joinedAt) || currentUser.joined };
        saveUser();
        renderProfileView();
        toast("Профайлын мэдээлэл шинэчлэгдлээ");
      } catch (err) {
        if ((err && err.message || "").includes("ашиглагдсан")) $("#pEmail").classList.add("invalid");
        toast((err && err.message) || "Профайл шинэчилж чадсангүй", "error");
      }
      return;
    }

    const users = store.get(KEYS.users, []);
    const u = users.find(x => x.email === currentUser.email);
    const patch = {
      firstName: first || currentUser.firstName || "",
      lastName: last || currentUser.lastName || "",
      phone: phone || currentUser.phone || "",
      email: newEmail || currentUser.email,
      name: ""
    };
    if (u && patch.email !== currentUser.email && users.some(x => x.email === patch.email && x.email !== currentUser.email)) {
      $("#pEmail").classList.add("invalid");
      toast("Энэ и-мэйл ашиглагдсан байна", "error");
      return;
    }
    patch.name = fullName(patch).trim();
    const oldEmail = currentUser.email;
    if (u) {
      Object.assign(u, patch);
      store.set(KEYS.users, users);
    }
    /* И-мэйл солигдсон бол локалын захиалгын түүхтэй харьцах */
    if (patch.email !== oldEmail) {
      const orders = store.get(KEYS.orders, []).map(o =>
        o.email === oldEmail
          ? { ...o, customer: { ...(o.customer || {}), email: patch.email } }
          : o
      );
      store.set(KEYS.orders, orders);
    }
    Object.assign(currentUser, patch);
    saveUser();
    toast("Профайлын мэдээлэл шинэчлэгдлээ");
    renderProfileView();
  });

  /* --- Тохиргоо: нууц үг солих (сервер горимд сервер талд, локалд хэштэй) --- */
  $("#passForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    if (isAdmin()) { toast("Админ дансны нууц үг солих боломжгүй", "error"); return; }
    const cur = $("#sCurPass").value, nw = $("#sNewPass").value, nw2 = $("#sNewPass2").value;
    if (nw.length < 6) { $("#sNewPass").classList.add("invalid"); toast("Шинэ нууц үг хамгийн багадаа 6 тэмдэгт байх шаардлагатай", "error"); return; }
    if (nw !== nw2) { $("#sNewPass2").classList.add("invalid"); toast("Нууц үгс хоорондоо таарахгүй байна", "error"); return; }
    if (Data.server && Data.token) {
      try {
        await Data.req("PATCH", "/api/me", { currentPass: cur, pass: nw });
        $("#passForm").reset();
        toast("Нууц үг амжилттай солигдлоо");
      } catch (err) {
        $("#sCurPass").classList.add("invalid");
        toast((err && err.message) || "Нууц үг солиж чадсангүй", "error");
      }
      return;
    }
    /* Локал горим */
    const users = store.get(KEYS.users, []);
    const u = users.find(x => x.email === currentUser.email);
    if (!u) { $("#sCurPass").classList.add("invalid"); toast("Данс олдсонгүй", "error"); return; }
    let okCur = false;
    if (u.passHash) okCur = (await hashPassword(cur, u.salt)).passHash === u.passHash;
    else if (u.pass) okCur = u.pass === cur;
    if (!okCur) { $("#sCurPass").classList.add("invalid"); toast("Одоогийн нууц үг буруу байна", "error"); return; }
    const h = await hashPassword(nw);
    u.salt = h.salt; u.passHash = h.passHash;
    delete u.pass;
    store.set(KEYS.users, users);
    $("#passForm").reset();
    toast("Нууц үг амжилттай солигдлоо");
  });

  /* --- Тохиргоо: мэдэгдлийн хослолууд --- */
  const NOTIF_LABELS = { deals: "Хямдралын мэдээлэл авах", drops: "Шинэ үнэртний мэдэгдэл", status: "Захиалгын төлөв мессежээр авах" };
  function renderNotifToggles() {
    const user = currentUser || {};
    const notif = { deals: true, drops: true, status: true, ...(user.notif || {}) };
    const wrap = $("#notifToggles");
    if (!wrap) return;
    wrap.innerHTML = Object.entries(NOTIF_LABELS).map(([k, lab]) => `
      <label class="switch-row">
        <span class="sw-txt">${lab}</span>
        <span class="switch"><input type="checkbox" data-notif="${k}" ${notif[k] ? "checked" : ""}><i></i></span>
      </label>`).join("");
    wrap.onclick = e => {
      const cb = e.target?.closest("[data-notif]");
      if (!cb) return;
      user.notif = { ...notif, [cb.dataset.notif]: cb.checked };
      currentUser.notif = user.notif;
      saveUser(); syncUserStore(); pushSelfPatch({ notif: currentUser.notif });
      toast(cb.checked ? `${NOTIF_LABELS[cb.dataset.notif]} — идэвхжүүлэгдлээ` : `${NOTIF_LABELS[cb.dataset.notif]} — унтраагдлаа`);
    };
  }

  /* --- Тохиргоо: үнэртний хувийн тохиргоо (badge) --- */
  function renderScentSettings() {
    const pick = $("#scentPick");
    const badge = $("#scentBadgeTxt");
    if (!pick) return;
    const favs = currentUser.scentFav || [];
    badge.textContent = scentBadgeText(favs.length ? favs : deriveScentFav());
    pick.innerHTML = FAMILIES.map(f => `
      <label class="chip scent-chip"><input type="checkbox" value="${esc(f)}" ${favs.includes(f) ? "checked" : ""}><span>${esc(f)}</span></label>`).join("");
    pick.onchange = () => {
      const trusted = Array.from(pick.querySelectorAll("input:checked")).map(cb => cb.value);
      currentUser.scentFav = trusted;
      saveUser(); syncUserStore(); pushSelfPatch({ scentFav: trusted });
      badge.textContent = scentBadgeText(trusted.length ? trusted : deriveScentFav());
      renderProfileBadge();
      toast("Үнэртний хувийн тохиргоо хадгалагдлаа");
    };
  }
  /* Хэрэглэгч тогтоогоогүй бол хадгалсан үнэртнүүдийн статистикээс шийднэ */
  function deriveScentFav() {
    const famCount = {};
    wishlist.forEach(id => { const p = byId(id); if (p) famCount[p.scentFamily] = (famCount[p.scentFamily] || 0) + 1; });
    return Object.entries(famCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  }

  /* --- Хаягууд: нэмэх / ӨӨРЧЛӨХ / устгах --- */
  let addrEditMode = -1;
  $("#addrAddForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const label = $("#aLabel").value.trim() || "Хаяг";
    const city = $("#aCity").value;
    const district = $("#aDistrict").value.trim();
    const khoroo = $("#aKhoroo").value.trim();
    if (!district || !khoroo) { toast("Дүүрэг болон хороог бөглөнө үү", "error"); return; }
    const addr = { label, city, district, khoroo, detail: $("#aDetail").value.trim() };
    currentUser.addresses = currentUser.addresses || [];
    if (addrEditMode >= 0) {
      currentUser.addresses[addrEditMode] = addr;
      toast("Хаяг амжилттай шинэчлэгдлээ");
    } else {
      currentUser.addresses.push(addr);
      toast("Хаяг амжилттай хадгалагдлаа");
    }
    addrEditMode = -1;
    $("#addrTitle").textContent = "Шинэ хаяг нэмэх";
    $("#addrCancelBtn")?.classList.add("hidden");
    saveUser(); syncUserStore(); pushSelfPatch({ addresses: currentUser.addresses });
    $("#addrAddForm").reset();
    renderAddressList();
  });
  $("#addrCancelBtn")?.addEventListener("click", () => {
    addrEditMode = -1;
    $("#addrAddForm").reset();
    $("#addrTitle").textContent = "Шинэ хаяг нэмэх";
    $("#addrCancelBtn").classList.add("hidden");
  });

  $("#addrList")?.addEventListener("click", e => {
    const del = e.target.closest("[data-del-addr]");
    if (del) {
      currentUser.addresses.splice(Number(del.dataset.delAddr), 1);
      saveUser(); syncUserStore(); pushSelfPatch({ addresses: currentUser.addresses });
      toast("Хаяг хасагдлаа");
      renderAddressList();
      return;
    }
    const edit = e.target.closest("[data-edit-addr]");
    if (edit) {
      const a = currentUser.addresses[Number(edit.dataset.editAddr)];
      if (!a) return;
      addrEditMode = Number(edit.dataset.editAddr);
      $("#aLabel").value = a.label; $("#aCity").value = a.city;
      $("#aDistrict").value = a.district || ""; $("#aKhoroo").value = a.khoroo || "";
      $("#aDetail").value = a.detail || "";
      $("#addrTitle").textContent = "Хаяг өөрчлөх";
      $("#addrCancelBtn")?.classList.remove("hidden");
      $("#addrAddForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  function renderAddressList() {
    const list = $("#addrList");
    if (!list) return;
    if (!currentUser.addresses?.length) {
      list.innerHTML = `<div class="empty-state">${ICONS.mapPin}<p>Одоогоор хадгалагдсан хаяг байхгүй. Доорх формоор шинэ хаяг нэмнэ үү.</p></div>`;
      return;
    }
    list.innerHTML = currentUser.addresses.map((a, i) => `
      <div class="addr-card">
        <div class="ac-t">
          <b>${esc(a.label)}</b>
          <span>${esc(a.city)} · ${esc(a.district)} · ${esc(a.khoroo)} хороо${a.detail ? " · " + esc(a.detail) : ""}</span>
        </div>
        <div class="ac-actions">
          <button class="ac-x edit" data-edit-addr="${i}" aria-label="Хаяг өөрчлөх">${ICONS.pencil}</button>
          <button class="ac-x" data-del-addr="${i}" aria-label="Хаяг хасах">${ICONS.trash}</button>
        </div>
      </div>`).join("");
  }

  /* --- Хадгалсан үнэртэн зурах --- */
  window.__renderWish = function () {
    const grid = $("#wishGrid");
    if (!grid) return;
    if (!wishlist.length) {
      grid.innerHTML = `<div class="empty-state">${ICONS.heart}<p>Танд одоогоор хадгалагдсан үнэртэн байхгүй.</p><a class="btn btn-gold" href="catalog.html">Үнэртэн сонгох</a></div>`;
      return;
    }
    grid.innerHTML = wishlist.map(id => {
      const p = byId(id);
      if (!p) return "";
      return `
      <article class="product-card reveal">
        <a class="card-media" href="product.html?id=${p.id}">
          <img src="${p.image}" alt="${esc(p.name)}" loading="lazy">
          ${p.isNew ? '<span class="badge-new">Шинэ</span>' : ''}
        </a>
        <button class="card-qv" data-qv="${p.id}" aria-label="Түргэн үзэх">${ICONS.eye}</button>
        ${isAdmin() ? `<button class="card-edit" data-edit="${p.id}" aria-label="Засах">${ICONS.pencil}</button>` : ""}
        <button class="card-heart active" data-wish="${p.id}" aria-label="Хасах">${ICONS.heart}</button>
        <div class="card-body">
          <p class="card-brand">${esc(p.brand)}</p>
          <h3 class="card-name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
          <div class="card-meta">${starsHTML(p.rating)}<span>${p.rating.toFixed(1)}</span></div>
          <div class="card-foot">
            <p class="card-price">${fmtMNT(minPrice(p))}<small>${Math.min(...p.sizes)}мл-ээс</small></p>
          </div>
          <div class="wl-actions">
            <button class="btn btn-gold" data-add="${p.id}" type="button">Сагслах</button>
          </div>
        </div>
      </article>`;
    }).join("");
    revealObserver.watch(grid);
  };

  /* --- Захиалгын түүх зурах — захиалга бүр бодит статусаараа (хиймэл дэвшүүлэлтгүй) --- */
  function renderOrders() {
    const list = $("#ordersList");
    const orders = userOrders();
    if (!list) return;
    if (!orders.length) {
      list.innerHTML = `<div class="empty-state">${ICONS.bag}<p>Одоогоор захиалга хийгээгүй байна.</p><a class="btn btn-gold" href="catalog.html">Дэлгүүр рүү очих</a></div>`;
      return;
    }
    list.innerHTML = orders.map(o => {
      const st = ORDER_STATUS_LABELS.includes(o.status) ? o.status : "Шинэ захиалга";
      const prog = progressForStatus(st);
      const steps = prog >= 0
        ? `<div class="oc-steps">${ACCOUNT_STEPS.map((s, i) => `<span class="ostep${i <= prog ? " done" : ""}"><i></i>${s}</span>`).join("")}</div>`
        : "";
      const pay = o.paymentMethodLabel || o.payment || "";
      const payStatus = o.paymentStatus ? payStatusPill(o.paymentStatus) : "";
      const d = o.delivery || {};
      return `
      <div class="order-card rich">
        <div class="oc-head">
          <span class="oid">${esc(orderId(o))}</span>
          ${statusPillHTML(st)}
        </div>
        <p class="odate">${fmtDate(o.createdAt || o.date)}</p>
        <div class="oc-thumbs">${(o.items || []).slice(0, 4).map(it => {
          const p = byId(it.productId || it.id);
          return `<a href="product.html?id=${it.productId || it.id}" title="${esc(it.name)}"><img src="${p ? p.image : (it.image || "")}" alt="${esc(it.name)}"></a>`;
        }).join("")}</div>
        <p class="oc-items">${(o.items || []).map(it => `${esc(it.name)} · ${it.size}мл × ${it.qty}`).join("<br>")}</p>
        ${steps}
        <div class="oc-total"><span>${esc(pay)}${payStatus}</span><b>${fmtMNT(o.total)}</b></div>
        <div class="oc-meta">${esc([d.city, d.district, d.khoroo ? d.khoroo + " хороо" : ""].filter(Boolean).join(", "))}</div>
      </div>`;
    }).join("");
  }

  /* --- Бетцкий харвах (бэдж: үнэртний хувийн тохиргоо) --- */
  function renderProfileBadge() {
    const el = $("#pScentBadge");
    if (!el) return;
    el.textContent = scentBadgeText((currentUser.scentFav && currentUser.scentFav.length) ? currentUser.scentFav : deriveScentFav());
  }

  /* users store-той нийлж байнга шинэчлэх */
  function syncUserStore() {
    if (!currentUser || currentUser.role === "admin") return;
    const users = store.get(KEYS.users, []);
    const i = users.findIndex(x => x.email === currentUser.email);
    if (i >= 0) {
      const { role, pass, ...copy } = currentUser;
      users[i] = { ...users[i], ...copy };
      store.set(KEYS.users, users);
    }
  }

  /* --- Профайл үзүүлэлт (нэвтэрсэн/нэвтрээгүй байдлаар шилжүүлэх) --- */
  async function renderProfileView() {
    const logged = !!currentUser;
    const admin = isAdmin();
    authWrap.style.display = logged ? "none" : "";
    profileWrap.style.display = logged ? "" : "none";
    if (!logged) return;

    $("#pfName").textContent = fullName(currentUser);
    $("#pfMail").textContent = currentUser.email;
    $("#pAvatar") && renderAvatar();
    $("#pLast").value = currentUser.lastName || fullName(currentUser).split(" ")[0] || "";
    $("#pFirst").value = currentUser.firstName || "";
    $("#pPhone").value = currentUser.phone || "";
    $("#pEmail").value = currentUser.email;
    $("#pfJoined").textContent = fmtDate(currentUser.joined || new Date().toISOString());
    $("#pfEmail").textContent = currentUser.email;
    if (isAdmin()) { $("#pEmail").disabled = true; }

    $$("[data-pane='settings']").forEach(b => b.style.display = "");

    renderProfileBadge();
    renderNotifToggles();
    renderScentSettings();
    renderAddressList();
    window.__renderWish();
    await loadMyOrders();
    renderOrders();
    revealObserver.watch(profileWrap);

    /* Анхдагч панель */
    setPane("profile");
  }

  renderProfileView();
}






/* ---------- 10. Эхлүүлэгч (boot) — хуудас танилт бүхий нэг цэгээс ---------- */
document.addEventListener("DOMContentLoaded", () => {
  ensureOverlays();          /* админ бэдж, редактор, түргэн үзэх модал (нэг удаа) */
  initAmbientLux();          /* тансаг арын орчин — аура + хөвөгч бөөмс */
  initHeader();
  initLinkInterceptor();     /* Бүх дотоод холбоос → SPA загварын зөөлөн шилжилт */
  applyAdminState();
  initAdminBadge();
  revealObserver.watch();

  switch (document.body.dataset.page) {
    case "home":     pageHome();     break;
    case "catalog":  pageCatalog();  break;
    case "product":  pageProduct();  break;
    case "checkout": pageCheckout(); break;
    case "account":  pageAccount();  break;
    case "admin":    pageAdmin();    break;
  }
});