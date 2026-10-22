/* ============================================================
   НорВэ — Backend сервер (Node.js, нэмэлт савгүй / zero-dependency)
   Ажиллуулалт:  node server.js
   Орчинг хувьсагч (заавал биш): PORT, ADMIN_EMAIL, ADMIN_PASSWORD, ORDER_PREFIX
   Хаяг:         http://localhost:8787
   --------------------------------------------------------------------------
   Өгөгдлийн сан: data/db.json — атомик бичилт (түр файл бичээд rename).
   Бүтэц:
     users                   — бүртгэлтэй хэрэглэгчид (нууц үг scrypt хэш + salt)
     orders                  — захиалгууд (бодит худалдааны систем)
     orders[].items          — order_items шиг: захиалгын үеийн нэр, хэмжээ, тоо,
                               нэгж үнэ (дараа үнэ өөрчлөгдсөн ч хуучин захиалгын үнэ хэвээр)
     orders[].payments       — төлбөрийн төлөвийн түүх (_SERVER талд админ баталгаажуулна)
     orders[].statusHistory  — төлөв өөрчлөлтийн түүх (хэзээ, хэн өөрчилсөн)
     _base + productOverrides + customProducts — бүтээгдэхүүний сан
     brandsInfo              — брэндийн нэмэлт мэдээлэл (тайлбар, лого, вэбсайт)
     audit                   — бүх өөрчлөлтийн бүртгэл (хэн, хэзээ, юу хийсэн)
   --------------------------------------------------------------------------
   API:
     Нээлттэй (шалгалтгүй):
       GET  /api/health
       POST /api/users/register        POST /api/users/login
       POST /api/orders                (checkout — захиалга үүсгэх)
       POST /api/admin/login
     Администратор (Bearer токен шаардлагатай — сервер талд шалгана):
       GET  /api/admin/me              POST /api/admin/logout
       GET  /api/orders                PATCH /api/orders/:orderNo
       GET  /api/users                 PATCH /api/users/:id   DELETE /api/users/:id
       POST /api/products/sync         POST /api/products     PATCH /api/products/:id
       GET  /api/settings              PATCH /api/settings
       GET  /api/brands/info           PATCH /api/brands/:name
       GET  /api/audit                 POST /api/import (localStorage → сервер нүүлэх)
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const BACKUP_DIR = path.join(DATA_DIR, "backup");

const PROD = {
  STATUSES: ["Шинэ захиалга", "Баталгаажуулах хүлээлттэй", "Баталгаажсан", "Бэлтгэж байгаа", "Хүргэлтэд гарсан", "Хүргэгдсэн", "Цуцлагдсан", "Буцаалт хийгдсэн"],
  PAY_STATUSES: ["Төлбөр хүлээж байна", "Төлбөр баталгаажсан", "Хүргэлтэд төлнө", "Төлбөр буцаагдсан"],
  PAY_METHODS: { qpay: "QPay", card: "Банкны карт", bank: "Дансаар шилжүүлэх", cash: "Хүргэлтээр бэлнээр" }
};

/* ---------- Туслах ---------- */
const err = (status, message) => Object.assign(new Error(message), { status });
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "", size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) { reject(err(413, "Хэт том хүсэлт")); req.destroy(); return; }
    raw += chunk;
  });
  req.on("end", () => {
    if (!raw) return resolve({});
    try { resolve(JSON.parse(raw)); } catch { reject(err(400, "JSON формат буруу")); }
  });
  req.on("error", reject);
});

function atomicWrite(file, obj) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/* ---------- Өгөгдлийн сан ---------- */
let DB = null;

function defaultDB() {
  const adminSeed = hashPass(process.env.ADMIN_PASSWORD || "NorveAdmin2026!");
  return {
    meta: { createdAt: new Date().toISOString(), version: 2 },
    settings: {
      orderPrefix: process.env.ORDER_PREFIX || "NRV-",
      orderNext: 100001,
      shipping: { normal: 10000, express: 15000 },
      paymentMethods: ["qpay", "card", "bank", "cash"]
    },
    admins: [{
      id: "admin-1",
      email: (process.env.ADMIN_EMAIL || "admin@norve.mn").toLowerCase(),
      name: "НорВэ Админ",
      role: "admin",
      joinedAt: new Date().toISOString(),
      ...adminSeed
    }],
    users: [],
    orders: [],
    _base: [],
    catalogSynced: false,
    productOverrides: {},
    customProducts: [],
    brandsInfo: [],
    audit: []
  };
}

let writeQueue = Promise.resolve();
function saveDB() { atomicWrite(DB_FILE, DB); }
function safeSave() {
  writeQueue = writeQueue.then(() => { try { saveDB(); } catch (e) { console.error("Бичих алдаа:", e.message); } });
  return writeQueue;
}

function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      const dflt = defaultDB();
      if (!DB.settings) DB.settings = dflt.settings;
      for (const k of Object.keys(dflt.settings)) if (DB.settings[k] === undefined) DB.settings[k] = dflt.settings[k];
      if (!Array.isArray(DB.admins) || !DB.admins.length) DB.admins = dflt.admins;
      for (const k of ["users", "orders", "customProducts", "brandsInfo", "audit", "_base"]) if (!Array.isArray(DB[k])) DB[k] = [];
      if (!DB.productOverrides || typeof DB.productOverrides !== "object") DB.productOverrides = {};
      if (DB.meta === undefined) DB.meta = dflt.meta;
      console.log(`Өгөгдлийн сан ачаалагдлаа: ${DB.orders.length} захиалга, ${DB.users.length} хэрэглэгч, ${DB.productOverrides ? Object.keys(DB.productOverrides).length : 0} засвар, ${DB.customProducts.length} шинэ бүтээгдэхүүн`);
      return;
    } catch (e) {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, "corrupted-" + Date.now() + ".json"));
      console.error("db.json уншихад алдаа — нөөц болгож шинээр үүсгэлээ:", e.message);
    }
  }
  DB = defaultDB();
  saveDB();
  console.log("Шинэ өгөгдлийн сан үүсгэгдлээ:", DB_FILE);
}

function backupDB(tag) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  atomicWrite(path.join(BACKUP_DIR, `${tag}-${Date.now()}.json`), DB);
}

function audit(actor, action, detail) {
  DB.audit.push({ at: new Date().toISOString(), actor: actor || "систем", action, detail: detail || "" });
  if (DB.audit.length > 5000) DB.audit = DB.audit.slice(-4000);
}

/* ---------- Нууц үг ---------- */
function hashPass(pass, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return { salt, passHash: crypto.scryptSync(String(pass), salt, 32).toString("hex") };
}
function verifyPassword(pass, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pass), salt, 32);
    const t = Buffer.from(hash, "hex");
    return h.length === t.length && crypto.timingSafeEqual(h, t);
  } catch { return false; }
}
function publicUser(u) {
  const { passHash: _h, salt: _s, legacy: _l, ...pub } = u;
  return pub;
}

/* ---------- Сешн (memory) — эрх (role) дагалдана: admin / user ---------- */
const SESSIONS = new Map();
const SESSION_TTL = 24 * 3600 * 1000;
function createSession(actor, role, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  SESSIONS.set(token, { actor, exp: Date.now() + SESSION_TTL, role: role || "user", userId: userId || null });
  return token;
}
function getSession(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const s = SESSIONS.get(m[1]);
  if (!s) return null;
  if (Date.now() > s.exp) { SESSIONS.delete(m[1]); return null; }
  return { token: m[1], actor: s.actor, role: s.role, userId: s.userId };
}
const requireAuth = (req) => {
  const s = getSession(req);
  if (!s || s.role !== "admin") throw err(401, "Админ эрх шаардлагатай — эхлээд нэвтэрнэ үү");
  return s;
};
/* Хэрэглэгчийн өөрийн мэдээлэл бүхий сешн шаардана */
const requireSelf = (req) => {
  const s = getSession(req);
  if (!s) throw err(401, "Нэвтрэх шаардлагатай");
  return s;
};

/* ---------- Захиалгын логик ---------- */
function sanitizeCustomer(c) {
  if (!c || typeof c !== "object") return null;
  const firstName = String(c.firstName || "").trim().slice(0, 80);
  const lastName = String(c.lastName || "").trim().slice(0, 80);
  const phone = String(c.phone || "").replace(/[\s-]/g, "").slice(0, 20);
  const email = String(c.email || "").trim().toLowerCase().slice(0, 120);
  if (!firstName && !lastName) return null;
  if (!/^\+?\d{8,16}$/.test(phone)) return null;
  return { firstName, lastName, phone, email };
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const good = [];
  for (const it of items) {
    const qty = Number(it.qty), unitPrice = Number(it.unitPrice), size = Number(it.size);
    const name = String(it.name || "").trim();
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) return null;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
    if (!Number.isFinite(size)) return null;
    if (!name) return null;
    good.push({
      productId: Number(it.productId) || 0,
      name: name.slice(0, 160),
      brand: String(it.brand || "").trim().slice(0, 80),
      size, qty, unitPrice,
      image: String(it.image || "").slice(0, 500),
      lineTotal: qty * unitPrice
    });
  }
  return good;
}

function nextOrderNo() {
  const s = DB.settings;
  let n = Number(s.orderNext) || 100001;
  let orderNo;
  do {
    orderNo = `${s.orderPrefix || "NRV-"}${String(n).padStart(6, "0")}`;
    n++;
  } while (DB.orders.some(o => o.orderNo === orderNo));
  s.orderNext = n;
  return orderNo;
}

function createOrder(payload) {
  const customer = sanitizeCustomer(payload.customer);
  if (!customer) throw err(400, "Харилцагчийн нэр эсвэл утасны дугаар буруу байна");
  const items = validateItems(payload.items);
  if (!items) throw err(400, "Захиалсан бүтээгдэхүүний мэдээлэл буруу байна");
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  if (!String(delivery.city || "").trim() || !String(delivery.district || "").trim()) {
    throw err(400, "Хүргэлтийн хот болон дүүрэг шаардлагатай");
  }
  const subtotal = items.reduce((a, it) => a + it.lineTotal, 0);
  const shippingFee = Math.max(0, Number(payload.shippingFee) || 0);
  const paymentMethod = PROD.PAY_METHODS[payload.paymentMethod] ? payload.paymentMethod : "bank";
  /* Төлбөр бүртгэгдээгүй байхад "төлөгдсөн" гэж тэмдэглэхгүй;
     бэлнээр (cash) — хүргэлтэд төлнө, бусад — хүлээж байна.
     Төлбөрийг сервер талд админ оруулж л баталгаажуулна. */
  const paymentStatus = paymentMethod === "cash" ? "Хүргэлтэд төлнө" : "Төлбөр хүлээж байна";
  const orderNo = nextOrderNo();
  const now = new Date().toISOString();
  let userId = null;
  if (customer.email) {
    const u = DB.users.find(x => (x.email || "").toLowerCase() === customer.email);
    if (u) userId = u.id;
  }
  const order = {
    orderNo, createdAt: now, userId, customer, items,
    subtotal, shippingFee, total: subtotal + shippingFee,
    delivery: {
      type: delivery.type === "express" ? "express" : "normal",
      city: String(delivery.city || "").trim().slice(0, 60),
      district: String(delivery.district || "").trim().slice(0, 60),
      khoroo: String(delivery.khoroo || "").trim().slice(0, 60),
      apartment: String(delivery.apartment || "").trim().slice(0, 160)
    },
    customerNote: String(payload.customerNote || "").slice(0, 500),
    paymentMethod,
    paymentMethodLabel: PROD.PAY_METHODS[paymentMethod],
    paymentStatus,
    payments: [{ at: now, status: paymentStatus, source: "web", note: "Захиалга үүсгэгдлээ" }],
    status: "Шинэ захиалга",
    statusHistory: [{ status: "Шинэ захиалга", at: now, by: "систем" }]
  };
  DB.orders.push(order);
  audit("систем", "захиалга үүсгэх", `${orderNo} · ${items.length} бүтээгдэхүүн · ${customer.phone}`);
  safeSave();
  return order;
}

function changeOrder(orderNo, patch, actor) {
  const o = DB.orders.find(x => x.orderNo === orderNo);
  if (!o) throw err(404, "Захиалга олдсонгүй");
  const now = new Date().toISOString();
  if (patch.status) {
    if (!PROD.STATUSES.includes(patch.status)) throw err(400, "Хүчингүй захиалгын төлөв");
    if (o.status !== patch.status) {
      o.status = patch.status;
      o.statusHistory.push({ status: patch.status, at: now, by: actor });
      if (patch.status === "Буцаалт хийгдсэн" && o.paymentStatus === "Төлбөр баталгаажсан") {
        o.paymentStatus = "Төлбөр буцаагдсан";
        o.payments.push({ at: now, status: o.paymentStatus, source: "server", note: "Буцаалтын дагуу төлбөр хасагдлаа" });
      }
      audit(actor, "төлөв өөрчлөх", `${orderNo} → ${patch.status}`);
    }
  }
  if (patch.paymentStatus) {
    if (!PROD.PAY_STATUSES.includes(patch.paymentStatus)) throw err(400, "Хүчингүй төлбөрийн төлөв");
    if (o.paymentStatus !== patch.paymentStatus) {
      o.paymentStatus = patch.paymentStatus;
      o.payments.push({ at: now, status: patch.paymentStatus, source: "server", note: patch.note || "" });
      audit(actor, "төлбөрийн төлөв", `${orderNo} → ${patch.paymentStatus}`);
    }
  }
  safeSave();
  return o;
}

/* ---------- Бүтээгдэхүүн ---------- */
function maxProductId() {
  let mx = 1000;
  for (const p of DB._base) mx = Math.max(mx, Number(p.id) || 0);
  for (const p of DB.customProducts) mx = Math.max(mx, Number(p.id) || 0);
  return mx;
}

/* ============================================================
   Нээлттэй хүсэлтүүд
   ============================================================ */
async function handleRegister(req, res) {
  const b = await readBody(req);
  const firstName = String(b.firstName || "").trim();
  const lastName = String(b.lastName || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const phone = String(b.phone || "").replace(/[\s-]/g, "");
  const pass = String(b.pass || "");
  if (!firstName || !lastName) throw err(400, "Овог болон нэр шаардлагатай");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, "И-мэйл хүчингүй байна");
  if (!/^\+?\d{8,15}$/.test(phone)) throw err(400, "Утасны дугаар хүчингүй байна");
  if (pass.length < 6) throw err(400, "Нууц үг дор хаяж 6 тэмдэгт байх ёстой");
  if (DB.users.some(u => (u.email || "").toLowerCase() === email)) throw err(409, "Энэ и-мэйл хаягтай данс аль хэдийн бүртгэгдсэн");
  const { salt, passHash } = hashPass(pass);
  const user = {
    id: "u" + crypto.randomBytes(8).toString("hex"),
    firstName, lastName, name: (lastName + " " + firstName).trim(), email, phone,
    salt, passHash,
    joinedAt: new Date().toISOString(), role: "user",
    addresses: [], avatar: "", notif: { deals: true, drops: true, status: true }, scentFav: []
  };
  DB.users.push(user);
  audit("систем", "хэрэглэгч бүртгүүлэх", `${email} (${user.id})`);
  await safeSave();
  const token = createSession(user.id, "user", user.id);
  return json(res, 201, { ok: true, token, user: publicUser(user) });
}

async function handleUserLogin(req, res) {
  const b = await readBody(req);
  const email = String(b.email || "").trim().toLowerCase();
  const pass = String(b.pass || "");
  const user = DB.users.find(u => (u.email || "").toLowerCase() === email);
  if (!user || !user.passHash || !verifyPassword(pass, user.salt, user.passHash)) {
    audit(email, "хэрэглэгч нэвтрэх оролдлого", "амжилтгүй");
    safeSave();
    throw err(401, "И-мэйл эсвэл нууц үг буруу байна");
  }
  audit(user.id, "хэрэглэгч нэвтрэлт", "амжилттай");
  safeSave();
  const token = createSession(user.id, "user", user.id);
  return json(res, 200, { ok: true, token, user: publicUser(user) });
}

async function handleCreateOrder(req, res) {
  const b = await readBody(req);
  const order = createOrder(b);
  return json(res, 201, {
    ok: true,
    order: { orderNo: order.orderNo, total: order.total, status: order.status, paymentStatus: order.paymentStatus }
  });
}

/* Хэрэглэгчийн өөрийн профайл — зөвхөн өөрийн бичлэгийг өөрчилнө */
async function handleMe(req, res) {
  const sess = requireSelf(req);
  const { user } = selfUserFromSession(sess);
  if (req.method === "GET") return json(res, 200, { ok: true, user: publicUser(user) });

  const b = await readBody(req);
  if (b.pass !== undefined) {
    const currentPass = String(b.currentPass || "");
    const nw = String(b.pass || "");
    if (!user.passHash || !verifyPassword(currentPass, user.salt, user.passHash)) throw err(400, "Одоогийн нууц үг буруу байна");
    if (nw.length < 6) throw err(400, "Шинэ нууц үг дор хаяж 6 тэмдэгт байх ёстой");
    const { salt, passHash } = hashPass(nw);
    user.salt = salt; user.passHash = passHash;
    audit(user.id, "нууц үг солих", user.email);
  }
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, "И-мэйл хүчингүй");
    if (DB.users.some(x => x.email === email && x.id !== user.id)) throw err(409, "Энэ и-мэйл ашиглагдсан байна");
    user.email = email;
  }
  if (b.phone !== undefined) {
    const phone = String(b.phone).replace(/[\s-]/g, "");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw err(400, "Утасны дугаар хүчингүй");
    user.phone = phone;
  }
  if (b.firstName !== undefined) user.firstName = String(b.firstName).trim().slice(0, 80);
  if (b.lastName !== undefined) user.lastName = String(b.lastName).trim().slice(0, 80);
  user.name = ((user.lastName || "") + " " + (user.firstName || "")).trim();
  if (Array.isArray(b.addresses)) user.addresses = b.addresses.slice(0, 20);
  if (typeof b.avatar === "string") user.avatar = b.avatar.slice(0, 300000);
  if (b.notif && typeof b.notif === "object") user.notif = { ...user.notif, ...b.notif };
  if (Array.isArray(b.scentFav)) user.scentFav = b.scentFav.slice(0, 10);
  audit(user.id, "профайл шинэчлэх", Object.keys(b).join(", ").slice(0, 200));
  safeSave();
  return json(res, 200, { ok: true, user: publicUser(user) });
}

/* Хэрэглэгчийн өөрийн захиалгууд (админ захиалгын бүх жагсаалтыг харахгүй) */
async function handleMeOrders(req, res) {
  const sess = requireSelf(req);
  const { user } = selfUserFromSession(sess);
  const mine = DB.orders.filter(o =>
    o.userId === user.id || (o.customer && o.customer.email && o.customer.email === user.email)
  );
  return json(res, 200, { ok: true, orders: mine });
}

function selfUserFromSession(sess) {
  const user = DB.users.find(u => u.id === sess.userId);
  if (!user) throw err(401, "Нэвтрэх шаардлагатай");
  return { user };
}

async function handleAdminLogin(req, res) {
  const b = await readBody(req);
  const email = String(b.email || "").trim().toLowerCase();
  const pass = String(b.pass || "");
  const admin = DB.admins.find(a => a.email === email);
  if (!admin || !verifyPassword(pass, admin.salt, admin.passHash)) {
    audit(email, "админ нэвтрэх оролдлого", "амжилтгүй");
    safeSave();
    throw err(401, "Админ нэвтрэх мэдээлэл буруу байна");
  }
  const token = createSession(admin.name, "admin", null);
  audit(admin.name, "админ нэвтрэлт", "амжилттай");
  await safeSave();
  return json(res, 200, {
    ok: true, token, actor: admin.name, role: "admin",
    settings: DB.settings
  });
}

/* ============================================================
   Админ хамгаалсан замууд
   ============================================================ */
const ADMIN_API = {
  "GET /api/admin/me": () => ({ ok: true, role: "admin" }),

  "POST /api/admin/logout": (act, body, sess) => {
    SESSIONS.delete(sess.token);
    return { ok: true };
  },

  "GET /api/orders": () => ({ ok: true, orders: DB.orders, settings: DB.settings }),
  "PATCH /api/orders/:orderNo": (act, body) => ({ ok: true, order: changeOrder(body._orderNo, body, act) }),

  "GET /api/users": () => ({ ok: true, users: DB.users.map(publicUser) }),
  "PATCH /api/users/:id": (act, body) => updateUser(act, body._id, body),
  "DELETE /api/users/:id": (act, body) => deleteUser(act, body._id),

  "GET /api/products": () => ({ ok: true, overrides: DB.productOverrides, custom: DB.customProducts, synced: DB.catalogSynced }),
  "POST /api/products/sync": (act, body) => {
    if (!Array.isArray(body.products) || body.products.length < 50) throw err(400, "Бүтээгдэхүүний тоо бага байна");
    DB._base = body.products.map(p => ({ ...p }));
    DB.catalogSynced = true;
    audit(act, "каталог синхрончлол", `${body.products.length} бүтээгдэхүүн`);
    safeSave();
    return { ok: true, count: body.products.length };
  },
  "POST /api/products": (act, body) => addProduct(act, body),
  "PATCH /api/products/:id": (act, body) => updateProduct(act, body._id, body),

  "GET /api/settings": () => ({ ok: true, settings: DB.settings }),
  "PATCH /api/settings": (act, body) => {
    for (const k of ["orderPrefix", "orderNext"]) if (body[k] !== undefined) DB.settings[k] = body[k];
    if (body.shipping && typeof body.shipping === "object") {
      DB.settings.shipping = {
        normal: Math.max(0, Number(body.shipping.normal) || 0),
        express: Math.max(0, Number(body.shipping.express) || 0)
      };
    }
    if (Array.isArray(body.paymentMethods)) {
      const allowed = Object.keys(PROD.PAY_METHODS);
      DB.settings.paymentMethods = body.paymentMethods.filter(x => allowed.includes(x));
    }
    if (body.banks && typeof body.banks === "object") DB.settings.banks = body.banks;
    audit(act, "тохиргоо шинэчлэх", Object.keys(body).join(", ").slice(0, 200));
    safeSave();
    return { ok: true, settings: DB.settings };
  },

  "GET /api/brands/info": () => ({ ok: true, brands: DB.brandsInfo }),
  "PATCH /api/brands/:name": (act, body) => {
    const name = String(body._name || "").trim();
    if (!name) throw err(400, "Брэндийн нэр дутуу");
    let b = DB.brandsInfo.find(x => x.name === name);
    if (!b) { b = { name }; DB.brandsInfo.push(b); }
    for (const k of ["description", "logo", "website"]) if (body[k] !== undefined) b[k] = String(body[k]).slice(0, 500);
    audit(act, "брэнд шинэчлэх", name);
    safeSave();
    return { ok: true, brand: b };
  },

  "GET /api/audit": () => ({ ok: true, audit: DB.audit.slice(-300).reverse() }),

  "POST /api/import": (act, body) => {
    backupDB("pre-import");
    let movedOrders = 0, movedUsers = 0;
    if (Array.isArray(body.orders)) {
      for (const o of body.orders) {
        if (!o || !Array.isArray(o.items) || !o.items.length) continue;
        const orderNo = String(o.id || "").trim() || nextOrderNo();
        if (DB.orders.some(x => x.orderNo === orderNo)) continue;
        const items = validateItems(o.items.map(it => ({
          productId: it.id, name: it.name, brand: it.brand, size: it.size, qty: it.qty,
          unitPrice: Number.isFinite(Number(it.price)) ? Number(it.price) : 0
        })));
        if (!items) continue;
        const subtotal = items.reduce((a, it) => a + it.lineTotal, 0);
        const created = String(o.date || new Date().toISOString());
        DB.orders.push({
          orderNo, createdAt: created, userId: null,
          customer: {
            firstName: String(o.delivery?.name || ""), lastName: "",
            phone: String(o.delivery?.phone || ""), email: String(o.email || "").toLowerCase()
          },
          items, subtotal,
          shippingFee: Number(o.shipping) || 0,
          total: Number(o.total) || (subtotal + (Number(o.shipping) || 0)),
          delivery: {
            type: "normal",
            city: String(o.delivery?.city || ""), district: String(o.delivery?.district || ""),
            khoroo: String(o.delivery?.khoroo || ""), apartment: String(o.delivery?.apartment || "")
          },
          customerNote: String(o.delivery?.note || ""),
          paymentMethod: "bank",
          paymentMethodLabel: String(o.payment || "Мэдэгдэхгүй"),
          /* Импортын хуучин захиалгыг төлөгдсөн гэж тооцахгүй — админ шалгаад баталгаажуулна */
          payments: [{ at: created, status: "Төлбөр хүлээж байна", source: "import", note: "Импортын бүртгэл" }],
          status: PROD.STATUSES.includes(o.status) ? o.status : "Шинэ захиалга",
          statusHistory: [{ status: PROD.STATUSES.includes(o.status) ? o.status : "Шинэ захиалга", at: created, by: "импорт" }]
        });
        movedOrders++;
      }
    }
    if (Array.isArray(body.users)) {
      for (const u of body.users) {
        const email = String(u.email || "").trim().toLowerCase();
        if (!email || DB.users.some(x => x.email === email)) continue;
        DB.users.push({
          id: "u" + crypto.randomBytes(8).toString("hex"),
          firstName: u.firstName || String(u.name || "").split(" ").slice(-1)[0] || "",
          lastName: u.lastName || String(u.name || "").split(" ").slice(0, -1).join(" "),
          name: u.name || "", email, phone: u.phone || "",
          salt: "", passHash: "",               /* нууц үг импортдохгүй — хэрэглэгч сэргээнэ */
          joinedAt: u.joined || new Date().toISOString(), role: "user",
          addresses: Array.isArray(u.addresses) ? u.addresses : [], avatar: u.avatar || "",
          notif: u.notif || { deals: true, drops: true, status: true }, scentFav: u.scentFav || [],
          legacy: true
        });
        movedUsers++;
      }
    }
    audit(act, "импорт", `${movedOrders} захиалга, ${movedUsers} хэрэглэгч`);
    safeSave();
    return { ok: true, movedOrders, movedUsers };
  }
};

function updateUser(actor, id, patch) {
  const u = DB.users.find(x => x.id === id);
  if (!u) throw err(404, "Хэрэглэгч олдсонгүй");
  if (patch.email !== undefined) {
    const email = String(patch.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, "И-мэйл хүчингүй");
    if (DB.users.some(x => x.email === email && x.id !== id)) throw err(409, "Энэ и-мэйл ашиглагдсан байна");
    u.email = email;
  }
  if (patch.phone !== undefined) {
    const phone = String(patch.phone).replace(/[\s-]/g, "");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw err(400, "Утасны дугаар хүчингүй");
    u.phone = phone;
  }
  if (patch.firstName !== undefined) u.firstName = String(patch.firstName).trim().slice(0, 80);
  if (patch.lastName !== undefined) u.lastName = String(patch.lastName).trim().slice(0, 80);
  if (patch.firstName !== undefined || patch.lastName !== undefined) {
    u.name = ((u.lastName || "") + " " + (u.firstName || "")).trim();
  }
  if (Array.isArray(patch.addresses)) u.addresses = patch.addresses;
  audit(actor, "хэрэглэгч засах", `${u.email}`);
  safeSave();
  return { ok: true, user: publicUser(u) };
}

function deleteUser(actor, id) {
  const idx = DB.users.findIndex(u => u.id === id);
  if (idx < 0) throw err(404, "Хэрэглэгч олдсонгүй");
  const [removed] = DB.users.splice(idx, 1);
  audit(actor, "хэрэглэгч устгах", `${removed.email} (${removed.id})`);
  safeSave();
  return { ok: true };
}

function addProduct(actor, body) {
  const name = String(body.name || "").trim();
  const brand = String(body.brand || "").trim();
  const price = Number(body.basePrice);
  if (!name || !brand) throw err(400, "Нэр болон брэнд шаардлагатай");
  if (!Number.isFinite(price) || price < 1000) throw err(400, "Үнэ дор хаяж 1000₮ байх ёстой");
  /* Давхар бүтээгдэхүүнээс хамгаалах: ижил нэр + брэнд */
  const dup = [...DB._base, ...DB.customProducts].some(
    p => p.name === name && p.brand === brand && !p.deletedFlag
  );
  if (dup) throw err(409, "Ижил нэртэй, ижил брэндтэй бүтээгдэхүүн аль хэдийн байна");
  const id = maxProductId() + 1;
  const rec = { ...body, id };
  DB.customProducts.push(rec);
  audit(actor, "бүтээгдэхүүн нэмэх", `${brand} — ${name} (id=${id})`);
  safeSave();
  return { ok: true, product: rec };
}

function updateProduct(actor, id, patch) {
  const key = String(id);
  const custom = DB.customProducts.find(x => String(x.id) === key);
  if (custom) {
    Object.assign(custom, patch, { id: custom.id });
  } else {
    DB.productOverrides[key] = { ...(DB.productOverrides[key] || {}), ...patch };
  }
  audit(actor, "бүтээгдэхүүн засах", `id=${id} · ${Object.keys(patch).join(", ")}`);
  safeSave();
  return { ok: true };
}

/* URL загварыг тохирох админ замын handler-оор шийднэ */
const matchRoute = (method, pathname) => {
  for (const key of Object.keys(ADMIN_API)) {
    const [m, pattern] = key.split(" ");
    if (m !== method) continue;
    const seg = pattern.split("/");
    const act = pathname.split("/");
    if (seg.length !== act.length) continue;
    let matched = true;
    const params = {};
    for (let i = 0; i < seg.length; i++) {
      if (seg[i].startsWith(":")) { params[seg[i].slice(1)] = decodeURIComponent(act[i]); continue; }
      if (seg[i] !== act[i]) { matched = false; break; }
    }
    if (matched) return { fn: ADMIN_API[key], params };
  }
  return null;
};

const json = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

/* ---------- Статик файл ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json"
};

function serveStatic(req, res, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { res.writeHead(400); return res.end("Хүчингүй зам"); }
  if (p === "/" || p === "") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Хориглосон"); }
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<h1>Хуудас олдсонгүй (404)</h1>");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- HTTP Router ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  try {
    if (pathname === "/api/health" && method === "GET") {
      return json(res, 200, { ok: true, backend: true, now: new Date().toISOString() });
    }

    /* Статик файлууд */
    if (!pathname.startsWith("/api/")) {
      if (method === "GET" || method === "HEAD") return serveStatic(req, res, pathname);
      return json(res, 404, { ok: false, error: "Олдсонгүй" });
    }

    /* Нээлттэй API */
    if (pathname === "/api/users/register" && method === "POST") return await handleRegister(req, res);
    if (pathname === "/api/users/login" && method === "POST") return await handleUserLogin(req, res);
    if (pathname === "/api/orders" && method === "POST") return await handleCreateOrder(req, res);
    if (pathname === "/api/admin/login" && method === "POST") return await handleAdminLogin(req, res);

    /* Нэвтэрсэн хэрэглэгчийн өөрийн мэдээлэл (налаар хамгаалсан) */
    if (pathname === "/api/me" && (method === "GET" || method === "PATCH")) return await handleMe(req, res);
    if (pathname === "/api/me/orders" && method === "GET") return await handleMeOrders(req, res);

    /* Админ хамгаалсан замууд — URL загварły Handler сайт бүслэх */
    const match = matchRoute(method, pathname);
    if (match) {
      const sess = requireAuth(req);          /* Эрх шалгалт — сервер талд */
      let body = {};
      if (method !== "GET") body = await readBody(req);
      /* URL-ын динамик хэсгийг body-д нэмж дамжуулна */
      if (match.params.orderNo) body._orderNo = match.params.orderNo;
      if (match.params.id) body._id = match.params.id;
      if (match.params.name) body._name = match.params.name;
      const data = await match.fn(sess.actor, body, sess);
      return json(res, 200, data);
    }

    return json(res, 404, { ok: false, error: "Зам олдсонгүй" });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || "Серверийн дотоод алдаа";
    if (status >= 500) console.error(`[${req.method} ${pathname}] ERRORED`, e);
    else console.warn(`[${req.method} ${pathname}] ${status} — ${message}`);
    json(res, status, { ok: false, error: message });
  }
});

/* ---------- Өгөгдлийн санг ачаалах / эхлүүлэх ---------- */
(function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      const dflt = defaultDB();
      if (!DB.settings) DB.settings = dflt.settings;
      for (const k of Object.keys(dflt.settings)) if (DB.settings[k] === undefined) DB.settings[k] = dflt.settings[k];
      if (!Array.isArray(DB.admins) || !DB.admins.length) DB.admins = dflt.admins;
      for (const k of ["users", "orders", "customProducts", "brandsInfo", "audit", "_base"]) if (!Array.isArray(DB[k])) DB[k] = [];
      if (!DB.productOverrides || typeof DB.productOverrides !== "object") DB.productOverrides = {};
      if (!DB.meta) DB.meta = dflt.meta;
      console.log(` Өгөгдлийн сан: ${DB.orders.length} захиалга, ${DB.users.length} хэрэглэгч бүртгэгдсэн`);
      return;
    } catch (e) {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, "corrupted-" + Date.now() + ".json"));
      console.error("db.json буруу тэгшитгэлтэй байна — нөөц болгож шинэ үүсгэлээ");
    }
  }
  DB = defaultDB();
  saveDB();
  console.log(" Шинэ өгөгдлийн сан үүсгэгдлээ:", DB_FILE);
})();

server.listen(PORT, () => {
  console.log("\n===========================================");
  console.log(` НорВэ сервер ажиллаж байна →  http://localhost:${PORT}`);
  console.log(` Өгөгдлийн сан файл: ${DB_FILE}`);
  console.log(` Админ нэвтрэлт: ${DB.admins[0].email} (анхдагч нууц үг хувьсагчаар тохируулна: ADMIN_PASSWORD)`);
  console.log("===========================================\n");
});
