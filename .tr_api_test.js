/* Серверийн API бүгдийг автоматаар туршиж, үр дүнг PASS/FAIL хэвлэх */
const BASE = "http://localhost:8787";
const TS = Date.now();
const EMAIL_NARAN = "naran-" + TS + "@test.mn";
const EMAIL_TUVSHIN = "tuvshin-" + TS + "@test.mn"; /* runs давхардахаас хамгаална */
let TOKEN = "";
const results = [];
const check = (name, ok, extra = "") => results.push({ name, ok: !!ok, extra });

async function req(method, path, body, auth = true) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (auth && TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* no-body */ }
  return { status: r.status, j };
}

(async () => {
  /* --- эрх шалгалт --- */
  let r = await req("GET", "/api/orders", null, false);
  check("Токенгүй /api/orders → 401", r.status === 401);

  /* --- админ нэвтрэлт --- */
  r = await req("POST", "/api/admin/login", { email: "admin@norve.mn", pass: "NorveAdmin2026!" }, false);
  check("Админ нэвтрэлт → token", r.status === 200 && !!r.j.token);
  TOKEN = r.j.token;
  r = await req("POST", "/api/admin/login", { email: "admin@norve.mn", pass: "buruu" }, false);
  check("Буруу нууц үг → 401", r.status === 401);

  /* --- захиалга үүсгэх --- */
  r = await req("POST", "/api/orders", {
    customer: { firstName: "Саран", lastName: "Төмөр", phone: "99112233", email: "" },
    items: [{ productId: 5, name: "Аква ди Жио", brand: "Армани", size: 30, qty: 3, unitPrice: 89000, image: "x" }],
    shippingFee: 15000,
    delivery: { type: "express", city: "Улаанбаатар", district: "Хан-Уул", khoroo: "11" },
    paymentMethod: "qpay", customerNote: ""
  }, false);
  check("Шинэ захиалга үүсгэх", r.status === 201 && !!r.j.order.orderNo);
  const no = r.j.order.orderNo;

  /* Төлбөр төлөгдөөгүй — төлбөрийн төлөв хүлээлт байх ёстой */
  const ordersR = (await req("GET", "/api/orders")).j.orders;
  const neo = ordersR.find(o => o.orderNo === no);
  check("Шинэ захиалгын төлөв = «Шинэ захиалга»", neo && neo.status === "Шинэ захиалга", JSON.stringify(neo?.status));
  check("Шинэ захиалгын төлөв = «Шинэ захиалга» биш цааш", neo.status !== "Баталгаажсан");
  check("QPay захиалгын төлбөрийн төлөв = «Төлбөр хүлээж байна»", neo.paymentStatus === "Төлбөр хүлээж байна");
  check("Нийт дүн = нэгж*тоо + хүргэлт", neo.total === 89000 * 3 + 15000, String(neo.total));

  /* --- Дутуу захиалга (алдаатай) --- */
  r = await req("POST", "/api/orders", { customer: { firstName: "X" }, items: [] }, false);
  check("Дутуу захиалга → 400 ( 半 хадгалагдахгүй)", r.status === 400);
  r = await req("POST", "/api/orders", {
    customer: { firstName: "Y", lastName: "Z", phone: "99112233", email: "" },
    items: [{ productId: 1, name: "", size: 50, qty: 1, unitPrice: 100 }], shippingFee: 0,
    delivery: { city: "УБ", district: "СД" }, paymentMethod: "bank"
  }, false);
  check("Нэр байхгүй item → 400", r.status === 400);

  /* --- төлвийн шилжилт ба түүх --- */
  for (const s of ["Баталгаажсан", "Бэлтгэж байгаа", "Хүргэлтэд гарсан"]) {
    r = await req("PATCH", "/api/orders/" + no, { status: s, paymentStatus: "Төлбөр баталгаажсан" });
  }
  check("3 үе шат шилжилт амжилттай", r.status === 200 && r.j.order.status === "Хүргэлтэд гарсан");
  check("Төлбөр баталгаажсан бүртгэгдсэн", r.j.order.paymentStatus === "Төлбөр баталгаажсан");
  check("statusHistory 4 мөр (анх+3)", r.j.order.statusHistory.length === 4, String(r.j.order.statusHistory.length));

  /* Цуцлалт дарагдсан: буцаалт → төлбөр автоматаар буцаагдана */
  r = await req("PATCH", "/api/orders/" + no, { status: "Буцаалт хийгдсэн" });
  check("Буцаалт → төлбөр авто буцаагдана", r.j.order.paymentStatus === "Төлбөр буцаагдсан");
  check("Буцаалт төлбөрийн бүртгэл нэмэгдсэн", r.j.order.payments.some(p => p.status === "Төлбөр буцаагдсан"));

  /* Хүчингүй төлөв */
  r = await req("PATCH", "/api/orders/" + no, { status: "Гаруй төлөв" });
  check("Хүчингүй төлөв → 400", r.status === 400);

  /* --- хэрэглэгч: бүртгүүлэх / нэвтрэх --- */
  r = await req("POST", "/api/users/register", { firstName: "Наран", lastName: "Ганбат", email: EMAIL_NARAN, phone: "99000011", pass: "nuuts1234" }, false);
  check("Хэрэглэгч бүртгүүлэх", r.status === 201 && !!r.j.user.id && r.j.user.passHash === undefined && r.j.user.salt === undefined);
  const uid = r.j.user.id;
  r = await req("POST", "/api/users/register", { firstName: "Наран", lastName: "Ганбат", email: EMAIL_NARAN, phone: "99000011", pass: "nuuts1234" }, false);
  check("Зөрчилдсөн и-мэйл → 409", r.status === 409);
  r = await req("POST", "/api/users/register", { firstName: "А", lastName: "Б", email: "ab@test.mn", phone: "99000012", pass: "123" }, false);
  check("Богино нууц үг → 400", r.status === 400);
  r = await req("POST", "/api/users/login", { email: EMAIL_NARAN, pass: "nuuts1234" }, false);
  check("Хэрэглэгч нэвтрэх (зөв)", r.status === 200 && r.j.user.email === EMAIL_NARAN);
  r = await req("POST", "/api/users/login", { email: EMAIL_NARAN, pass: "buruu" }, false);
  check("Хэрэглэгч нэвтрэх (буруу нууц үг) → 401", r.status === 401);
  /* сервер crash болохгүй */
  r = await req("GET", "/api/health", null, false);
  check("Сервер 401-д crash болохгүй", r.status === 200);

  /* --- хэрэглэгч админ апдат / устгах --- */
  r = await req("PATCH", "/api/users/" + uid, { phone: "99000099" });
  check("Хэрэглэгч утас засах", r.status === 200 && r.j.user.phone === "99000099");
  r = await req("PATCH", "/api/users/nonexistid", { phone: "99000099" });
  check("Байхгүй хэрэглэгч засах → 404", r.status === 404);  /* захиалгын хэрэглэгч холбох: захиалгын и-мэйлтай тэнцэх хэрэглэгч бүртгүүлсэн */
  r = await req("POST", "/api/orders", {
    customer: { firstName: "Наран", lastName: "Ганбат", phone: "99000011", email: EMAIL_NARAN },
    items: [{ productId: 2, name: "Саваж", brand: "Диор", size: 30, qty: 1, unitPrice: 118000, image: "" }],
    shippingFee: 10000, delivery: { city: "УБ", district: "СД" }, paymentMethod: "card"
  }, false);
  const link = (await req("GET", "/api/orders")).j.orders.find(o => o.orderNo === r.j.order.orderNo);
  check("Захиалга → userId автоматаар холбогдсон", link.userId === uid);

  /* Дуудмал бид нохой: өмнө захиалга үүсээд шалгаж амана
     нийт захиалгын то ЗАХИН шалгадаг: NRV-100001, NRV-100002, NRV-100003 (naran card) */
  const all = (await req("GET", "/api/orders")).j.orders;
  const uniq = new Set(all.map(o => o.orderNo));
  check("Давтагдашгүй захиалгын дугаар", uniq.size === all.length, `${all.length} захиалга / ${uniq.size} давхардтай`);

  /* --- бүтээгдэхүүн sync/add/update --- */
  r = await req("POST", "/api/products/sync", { products: [{ id: 1, name: "Блю де Шанель", brand: "Шанель" }, { id: 2, name: "Саваж", brand: "Диор" }] });
  check("Каталог sync — бага тоо rejection", r.status === 400);
  const hundred = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: "Бүтээгдэхүүн " + (i + 1), brand: "Брэнд" }));
  r = await req("POST", "/api/products/sync", { products: hundred });
  check("Каталог sync 100", r.status === 200 && r.j.count === 100);
  r = await req("PATCH", "/api/products/5", { basePrice: 95000 });
  check("Бүтээгдэхүүний үнэ засах", r.status === 200);
  r = await req("POST", "/api/products", { name: "Бүтээгдэхүүн 7", brand: "Брэнд", basePrice: 50000 });
  check("Давхар бүтээгдэхүүн → 409", r.status === 409);
  r = await req("POST", "/api/products", { name: "Гуччи Зайрмаг", brand: "Гуччи", basePrice: 50000 });
  check("Шинэ бүтээгдэхүүн нэмэгдлээ (давхаргүй id)", r.status === 200 && Number(r.j.product.id) > 100, String(r.j.product?.id));

  /* --- тохиргоо --- */
  r = await req("PATCH", "/api/settings", { shipping: { normal: 12000, express: 18000 } });
  check("Тохиргоо хадгалах", r.status === 200 && r.j.settings.shipping.normal === 12000);

  /* --- аудит --- */
  const auds = (await req("GET", "/api/audit")).j.audit;
  check("Аудитын бүртгэл > 10", auds.length > 10, String(auds.length));

  /* --- нэвтэрсэн хэрэглэгчийн өөрийн мэдээлэл (/api/me) + эрхийн тусгаарлалт --- */
  r = await req("POST", "/api/users/register", { firstName: "Түвшин", lastName: "Болд", email: EMAIL_TUVSHIN, phone: "99000055", pass: "nuuts555" }, false);
  check("Бүртгүүлэлт → хэрэглэгчийн token", r.status === 201 && !!r.j.token);
  const userTok = r.j.token;
  const meReq = (method, path, body) => fetch(BASE + path, {
    method, headers: { "Content-Type": "application/json; charset=utf-8", "Authorization": "Bearer " + userTok },
    body: body ? JSON.stringify(body) : undefined
  }).then(async x => ({ status: x.status, j: await x.json().catch(() => ({})) }));

  r = await meReq("GET", "/api/me", null);
  check("Хэрэглэгч өөрийн профайл харах (/api/me)", r.status === 200 && r.j.user.email === EMAIL_TUVSHIN && r.j.user.passHash === undefined);
  r = await meReq("GET", "/api/orders", null);
  check("ХЭРЭГЛЭГЧИЙН token админ захиалга харах → 401", r.status === 401);
  r = await meReq("PATCH", "/api/me", { phone: "99000077", firstName: "Түвшин", lastName: "Болд" });
  check("Хэрэглэгч өөрийн утас засах (/api/me)", r.status === 200 && r.j.user.phone === "99000077");
  r = await meReq("PATCH", "/api/users/" + uid, { phone: "00000000" });
  check("Хэрэглэгч өөр хүний бүртгэл засах чадахгүй (админ зам хориглоно) → 401", r.status === 401);
  r = await meReq("PATCH", "/api/me", { pass: "nuuts9999", currentPass: "buruu" });
  check("Буруу одоогийн нууц үгээр солих → 400", r.status === 400);
  r = await meReq("PATCH", "/api/me", { pass: "nuuts9999", currentPass: "nuuts555" });
  check("Нууц үг амжилттай солих", r.status === 200);
  r = await req("POST", "/api/users/login", { email: EMAIL_TUVSHIN, pass: "nuuts9999" }, false);
  check("Шинэ нууц үгээр нэвтэрнэ", r.status === 200 && r.j.token);

  /* tuvshin-ын захиалга үүсгээд /api/me/orders-д зөвхөн өөрийнх нь орсон эсэх */
  r = await req("POST", "/api/orders", {
    customer: { firstName: "Түвшин", lastName: "Болд", phone: "99000077", email: EMAIL_TUVSHIN },
    items: [{ productId: 3, name: "Блэк Опиум", brand: "Ив Сен Лоран", size: 50, qty: 1, unitPrice: 128000, image: "" }],
    shippingFee: 10000, delivery: { city: "УБ", district: "БГД" }, paymentMethod: "cash"
  }, false);
  check("Зочин захиалга (cash) үүсгэх", r.status === 201);
  const guestNo = r.j.order.orderNo;
  r = await meReq("GET", "/api/me/orders", null);
  const mine = r.j.orders || [];
  check("Хэрэглэгч зөвхөн ӨӨРИЙН захиалгыг хардаг (админ бус зарим нь харагдахгүй)", r.status === 200 && mine.length === 1 && mine[0].orderNo === guestNo, JSON.stringify(mine.map(x => x.orderNo)));
  const cashO = (await req("GET", "/api/orders")).j.orders.find(o => o.orderNo === guestNo);
  check("Бэлэн мөнгөөр захиалга → «Хүргэлтэд төлнө»", cashO.paymentStatus === "Хүргэлтэд төлнө");

  /* --- дүгнэлт --- */
  let pass = 0, fail = 0;
  for (const res of results) {
    if (res.ok) pass++; else fail++;
    console.log((res.ok ? "PASS " : "FAIL ") + res.name + (res.extra ? "  [" + res.extra + "]" : ""));
  }
  console.log("Нийт: " + (pass + fail) + " · Амжилт: " + pass + " · Амжилтгүй: " + fail);
  process.exit(fail ? 1 : 0);
})();
