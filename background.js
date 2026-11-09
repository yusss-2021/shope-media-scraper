// ============================================================
//  Shopee Affiliate Scraper - Background Service Worker (v2.1)
//  Fitur: Tab management, ekstraksi data produk (JSON-LD + DOM),
//         anti-bot handler, dan pengunduh gambar galeri.
// ============================================================

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const info = (tabId, text) => {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: "info", text }).catch(() => {});
};

// Klik ikon extension di toolbar browser = toggle panel
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
});

// Listener pesan dari content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabAsal = sender.tab?.id;
  if (msg?.type === "scrape") {
    ambilProduk(msg.url, msg.opsi, tabAsal)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // respon async
  }
  if (msg?.type === "dl-images") {
    unduhGambar(msg.daftar, tabAsal);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "dl-videos") {
    unduhVideo(msg.daftar, tabAsal);
    sendResponse({ ok: true });
    return false;
  }
});

/**
 * Menunggu tab selesai dimuat secara lengkap
 */
function tungguMuat(tabId, batas = 45000) {
  return new Promise((resolve, reject) => {
    let timer;
    const fn = (id, ch, t) => {
      if (id === tabId && ch.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    };
    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      reject(new Error("Halaman produk terlalu lama dimuat (timeout)"));
    }, batas);

    chrome.tabs.onUpdated.addListener(fn);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete" && t.url && t.url.startsWith("http")) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    }).catch(() => {});
  });
}

/**
 * Suntikkan fungsi ekstrak ke dalam halaman produk
 */
async function jalankan(tabId, opsi) {
  const [h] = await chrome.scripting.executeScript({
    target: { tabId },
    func: ekstrakProduk,
    args: [opsi],
  });
  return h?.result;
}

/**
 * Mengambil data produk dengan membuka tab, ekstrak, lalu tutup
 */
async function ambilProduk(url, opsi, tabAsal) {
  let tab;
  const keepalive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  const aktif = !opsi.latar || opsi.ulasan || opsi.gambarUlasan;
  let ambilFokus = aktif;
  try {
    tab = await chrome.tabs.create({ url, active: aktif });
    await tungguMuat(tab.id, 45000);

    // Beri jeda 1 detik agar SPA / React hydration Shopee selesai
    await tidur(1200);

    let hasil = await jalankan(tab.id, opsi);

    // Deteksi jika Shopee meminta verifikasi puzzle / login
    if (hasil?.diblokir) {
      info(tabAsal, "⚠️ Shopee minta verifikasi/captcha. Selesaikan di tab yang muncul (maks 3 menit)...");
      ambilFokus = true;
      await chrome.tabs.update(tab.id, { active: true });
      const batas = Date.now() + 180000;
      while (Date.now() < batas) {
        await tidur(3000);
        hasil = await jalankan(tab.id, opsi).catch(() => null);
        if (hasil && !hasil.diblokir) break;
      }
      if (!hasil || hasil.diblokir) {
        return { ok: false, error: "Verifikasi/login tidak diselesaikan dalam batas waktu" };
      }
    }

    if (hasil?.error) return { ok: false, error: hasil.error };
    return { ok: true, data: hasil };
  } finally {
    clearInterval(keepalive);
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    if (ambilFokus && tabAsal) chrome.tabs.update(tabAsal, { active: true }).catch(() => {});
  }
}

/**
 * Unduh daftar gambar produk ke folder Downloads pengguna
 */
async function unduhGambar(daftar, tabAsal) {
  let ok = 0, gagal = 0;
  for (const d of daftar) {
    try {
      // Bersihkan nama file dari karakter ilegal Windows
      const amanFilename = d.filename.replace(/[<>:"|?*]/g, "");
      await chrome.downloads.download({
        url: d.url,
        filename: amanFilename,
        conflictAction: "uniquify",
      });
      ok++;
    } catch (e) {
      gagal++;
    }
    await tidur(300);
  }
  info(tabAsal, `Unduh gambar selesai: ${ok} berhasil, ${gagal} gagal. Cek folder Downloads/ShopeeAffiliate.`);
}

/**
 * Unduh daftar video asli (.mp4) produk ke folder Downloads pengguna
 */
async function unduhVideo(daftar, tabAsal) {
  let ok = 0, gagal = 0;
  for (const d of daftar) {
    try {
      const amanFilename = d.filename.replace(/[<>:"|?*]/g, "");
      await chrome.downloads.download({
        url: d.url,
        filename: amanFilename,
        conflictAction: "uniquify",
      });
      ok++;
    } catch (e) {
      gagal++;
    }
    await tidur(500);
  }
  info(tabAsal, `Unduh video selesai: ${ok} berhasil, ${gagal} gagal. Cek folder Downloads/ShopeeAffiliate.`);
}

// ============================================================
// FUNGSI INI DISUNTIKKAN KE HALAMAN PRODUK SHOPEE
// Wajib berdiri sendiri (tidak boleh mengakses variabel luar)
// ============================================================
async function ekstrakProduk(opsi) {
  const tidurX = (ms) => new Promise((r) => setTimeout(r, ms));
  const teks = (el) => ((el && (el.innerText || el.textContent)) || "").trim();
  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || "";

  // 1. Deteksi blokir / captcha
  const diblokir = () => {
    if (/\/verify\/|\/buyer\/login|\/user\/login|captcha/i.test(location.href)) return true;
    const t = teks(document.body);
    const adaPuzzle = /verifikasi|captcha|slide to|geser puzzle|geser untuk menyelesaikan/i.test(t);
    const adaKonten = document.querySelector('script[type="application/ld+json"]') || document.querySelector("h1, .WBVL_7, ._44qnta");
    return t.length < 1600 && adaPuzzle && !adaKonten;
  };

  // 2. Deteksi kesiapan halaman
  const siap = () => {
    // Cek JSON-LD Product
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript) {
      try {
        const d = JSON.parse(ldScript.textContent || "{}");
        if (d["@type"] === "Product" && d.name) return true;
      } catch (e) {}
    }
    // Cek elemen judul di DOM
    const elJudul = document.querySelector('h1, [class*="product-briefing"] span, .WBVL_7, ._44qnta, .attV6k, [class*="item-title"], [class*="product_name"]');
    if (elJudul && teks(elJudul).length > 3) return true;

    // Cek meta title Shopee
    const ogTitle = meta("og:title");
    if (ogTitle && ogTitle.length > 5 && !/^Shopee\s*$/i.test(ogTitle)) return true;

    // Cek tombol beli / keranjang
    if (document.querySelector('button[aria-label*="keranjang" i], button[aria-label*="cart" i], .btn-solid-primary')) return true;

    return false;
  };

  // Tunggu halaman siap hingga maksimal 20 detik
  const mulai = Date.now();
  while (Date.now() - mulai < 20000) {
    if (diblokir()) return { diblokir: true };
    if (siap()) break;
    await tidurX(500);
  }
  if (diblokir()) return { diblokir: true };

  const badan = teks(document.body);
  if (!siap() && /produk (ini )?(tidak tersedia|tidak ditemukan)|halaman tidak ditemukan/i.test(badan.slice(0, 1500))) {
    return { error: "Produk tidak tersedia / sudah dihapus oleh penjual" };
  }

  // 3. Baca Data JSON-LD (Schema.org) jika ada
  let jsonLd = null;
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      const data = JSON.parse(s.textContent || "{}");
      if (data["@type"] === "Product") {
        jsonLd = data;
        break;
      }
    }
  } catch (e) {}

  // 4. Nama Produk
  let nama = "";
  if (jsonLd?.name) nama = String(jsonLd.name).trim();
  if (!nama) {
    const elJudul = document.querySelector('h1, [class*="product-briefing"] span, .WBVL_7, ._44qnta, .attV6k, [class*="item-title"]');
    if (elJudul) nama = teks(elJudul);
  }
  if (!nama) nama = meta("og:title").replace(/\s*\|\s*Shopee.*$/i, "").trim();
  if (!nama) nama = document.title.replace(/\s*\|\s*Shopee.*$/i, "").trim();

  // 5. Harga Produk
  let harga = "";
  const elHarga = Array.from(document.querySelectorAll("div, span")).find(
    (e) =>
      e.children.length === 0 &&
      /^Rp\s?[\d.]+(\s*-\s*Rp\s?[\d.]+)?$/.test(teks(e)) &&
      e.getBoundingClientRect().top + window.scrollY < 1200
  );
  if (elHarga) {
    harga = teks(elHarga);
  } else if (jsonLd?.offers) {
    const o = jsonLd.offers;
    if (o.price) {
      harga = `Rp ${Number(o.price).toLocaleString("id-ID")}`;
    } else if (o.lowPrice && o.highPrice && o.lowPrice !== o.highPrice) {
      harga = `Rp ${Number(o.lowPrice).toLocaleString("id-ID")} - Rp ${Number(o.highPrice).toLocaleString("id-ID")}`;
    } else if (o.lowPrice) {
      harga = `Rp ${Number(o.lowPrice).toLocaleString("id-ID")}`;
    }
  }

  // 6. Terjual & Rating
  const terjual = (badan.match(/([\d.,]+\s*(?:rb|jt)?\+?)\s*Terjual/i) || [])[1] || "";
  let rating = (badan.match(/(\d(?:[.,]\d)?)\s*[\n ]+\s*[\d.,]+\s*(?:rb|jt)?\+?\s*[\n ]*Penilaian/i) || [])[1] || "";
  if (!rating && jsonLd?.aggregateRating?.ratingValue) {
    rating = String(jsonLd.aggregateRating.ratingValue);
  }

  // 7. Gambar Galeri Resolusi Tinggi (Target maksimal 6 gambar, min 4 jika tersedia)
  const gambar = [];
  const normalisasiUrl = (u) => {
    if (!u || typeof u !== "string") return "";
    let clean = u.trim().split("?")[0].split("@")[0];
    clean = clean.replace(/_(tn|xxs|xs|s|m)(\.[a-zA-Z0-9]+)?$/, "").replace(/_tn$/, "").replace(/_m$/, "");
    return clean;
  };
  const tambahGambar = (u) => {
    if (!u) return;
    const clean = normalisasiUrl(u);
    if (!/^https?:/.test(clean)) return;
    if (!/img\.susercontent\.com|cf\.shopee\.co\.id|\/file\//.test(clean)) return;
    if (!gambar.includes(clean)) gambar.push(clean);
  };

  if (opsi.gambar) {
    // A. Ambil langsung dari JSON-LD (Shopee menyediakan array resolusi tinggi asli)
    if (jsonLd?.image) {
      const list = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
      list.forEach(tambahGambar);
    }
    // B. Ambil meta og:image
    tambahGambar(meta("og:image"));

    // C. Pemicu klik / hover panah carousel galeri agar thumbnail ke-5, ke-6, dst. muncul di DOM
    try {
      const panahNext = document.querySelectorAll(
        '.product-carousel__arrow--next, [aria-label*="next" i], button[class*="arrow-right"], button[class*="next"], [class*="carousel"] button'
      );
      panahNext.forEach((btn) => {
        try {
          btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          btn.click();
        } catch (e) {}
      });
    } catch (e) {}

    // D. Ambil dari elemen thumbnail galeri di DOM
    document.querySelectorAll("img").forEach((im) => {
      const src = im.currentSrc || im.src || im.getAttribute("data-src") || "";
      const r = im.getBoundingClientRect();
      const y = r.top + window.scrollY;
      if (y < 1200 && r.width >= 24 && r.height >= 24) {
        tambahGambar(src);
      }
    });

    // E. Ambil dari background image galeri
    document.querySelectorAll('[style*="background-image"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top + window.scrollY < 1200 && r.width >= 24) {
        const m = (el.style.backgroundImage || "").match(/url\(["']?(https?:[^"')]+)["']?\)/);
        if (m) tambahGambar(m[1]);
      }
    });

    // F. Ambil dari Script Tags (Shopee JSON state yang menyimpan array gambar lengkap)
    try {
      document.querySelectorAll("script").forEach((s) => {
        const t = s.textContent || "";
        if (t.includes('"images":') || t.includes('"image_list":')) {
          const m = t.match(/"images"\s*:\s*\[([^\]]+)\]/);
          if (m && m[1]) {
            const hashes = m[1].match(/"([a-zA-Z0-9_-]{16,64})"/g);
            if (hashes) {
              hashes.forEach((h) => {
                const cleanHash = h.replace(/"/g, "");
                tambahGambar(`https://down-id.img.susercontent.com/file/${cleanHash}`);
              });
            }
          }
        }
      });
    } catch (e) {}

    // G. Scan React Fiber galeri untuk ekstraksi array images / image_list lengkap
    try {
      const galeriEls = [
        document.querySelector('[class*="product-briefing"]'),
        document.querySelector('[class*="gallery"]'),
        document.querySelector('[class*="carousel"]'),
        document.querySelector("#main"),
        document.body,
      ];

      function cariGambarObj(obj, depth = 0) {
        if (!obj || typeof obj !== "object" || depth > 6) return;
        if (Array.isArray(obj)) {
          for (const item of obj) cariGambarObj(item, depth + 1);
          return;
        }
        if (Array.isArray(obj.images)) {
          obj.images.forEach((imgId) => {
            if (typeof imgId === "string") {
              if (/^https?:/.test(imgId)) tambahGambar(imgId);
              else if (/^[a-zA-Z0-9_-]{16,64}$/.test(imgId)) {
                tambahGambar(`https://down-id.img.susercontent.com/file/${imgId}`);
              }
            }
          });
        }
        if (Array.isArray(obj.image_list)) {
          obj.image_list.forEach((imgId) => {
            if (typeof imgId === "string") {
              if (/^https?:/.test(imgId)) tambahGambar(imgId);
              else if (/^[a-zA-Z0-9_-]{16,64}$/.test(imgId)) {
                tambahGambar(`https://down-id.img.susercontent.com/file/${imgId}`);
              }
            }
          });
        }
        for (const k of Object.keys(obj)) {
          if (k === "children" || k === "parent" || k === "fiber" || k.startsWith("__")) continue;
          try {
            cariGambarObj(obj[k], depth + 1);
          } catch (e) {}
        }
      }

      for (const el of galeriEls) {
        if (!el) continue;
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
        if (!key) continue;
        let fiber = el[key];
        for (let i = 0; i < 20 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props) cariGambarObj(props);
          const state = fiber.memoizedState;
          if (state) cariGambarObj(state);
          fiber = fiber.return;
        }
      }
    } catch (e) {}
  }

  // 8. Deskripsi Lengkap Produk
  let deskripsi = "";
  if (opsi.deskripsi) {
    // A. Cek dari JSON-LD dulu
    if (jsonLd?.description) {
      deskripsi = String(jsonLd.description).trim();
    }

    // B. Ambil dari DOM dengan scroll bertahap + klik "Lihat Selengkapnya"
    const cariDeskripsiDOM = () => {
      // Klik tombol ekspansi deskripsi jika ada
      const tombolLebih = Array.from(document.querySelectorAll("button, div, span, a")).find((el) => {
        const t = (el.innerText || el.textContent || "").trim().toLowerCase();
        return (
          el.children.length === 0 &&
          /^(lihat lainnya|lihat selengkapnya|tampilkan lebih banyak|show more|selengkapnya|baca selengkapnya)$/i.test(t)
        );
      });
      if (tombolLebih) {
        try { tombolLebih.click(); } catch (e) {}
      }

      // Cari heading 'Deskripsi Produk'
      const headers = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span, section"));
      const hDesk = headers.find((el) => {
        const t = (el.innerText || el.textContent || "").trim();
        return el.children.length <= 1 && /^deskripsi produk$/i.test(t);
      });

      if (hDesk) {
        let parent = hDesk.parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          const calon = Array.from(parent.querySelectorAll("div, p, span, pre")).filter((el) => {
            const st = window.getComputedStyle(el);
            const isi = (el.innerText || "").trim();
            return isi.length > 30 && (st.whiteSpace === "pre-wrap" || st.whiteSpace === "pre-line" || isi.includes("\n"));
          });
          if (calon.length) {
            calon.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length);
            const res = (calon[0].innerText || "").trim();
            if (res.length > 20) return res;
          }
          parent = parent.parentElement;
        }
      }

      // Selector umum Shopee
      const selectors = [
        'div[class*="product-detail"] div[class*="content"]',
        'p[class*="irIKAp"]',
        "div.f7VU2S",
        "div.e8duaM",
        "div._3yZnxr",
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && (el.innerText || "").trim().length > 20) {
          return (el.innerText || "").trim();
        }
      }
      return "";
    };

    // Scroll 3-4 kali untuk memicu pemuatan lazy load section deskripsi
    for (let i = 0; i < 4; i++) {
      const domText = cariDeskripsiDOM();
      if (domText && domText.length > deskripsi.length) {
        deskripsi = domText;
        break;
      }
      window.scrollBy(0, Math.round(window.innerHeight * 0.75));
      await tidurX(400);
    }

    // C. Fallback terakhir ke meta description
    if (!deskripsi) {
      deskripsi = meta("og:description") || meta("description") || "";
    }
  }

  // 9. Ambil ID Produk & Toko untuk API, Video, Spesifikasi, & Ulasan Kritis
  let shopId = "", itemId = "";
  const mUrl = location.href.match(/-i\.(\d+)\.(\d+)/) || location.href.match(/\/product\/(\d+)\/(\d+)/);
  if (mUrl) { shopId = mUrl[1]; itemId = mUrl[2]; }
  if (!itemId) {
    const mItem = location.search.match(/[?&]item_?id=(\d+)/i);
    const mShop = location.search.match(/[?&]shop_?id=(\d+)/i);
    if (mItem) itemId = mItem[1];
    if (mShop) shopId = mShop[1] || "0";
  }

  let video = "";
  let spesifikasi = "";
  let reviewKritis = "";
  let reviewPositif = "";
  let ulasanList = [];
  let gambarUlasan = [];

  // 10. Ambil Data Internal Shopee (API Same-Origin PDP & Video)
  if (itemId && shopId) {
    try {
      const endpoints = [
        `https://shopee.co.id/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
        `https://shopee.co.id/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}`,
        `https://shopee.co.id/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`
      ];
      let dataPdp = null;
      for (const ep of endpoints) {
        const res = await fetch(ep, {
          headers: {
            "Accept": "application/json",
            "x-api-source": "pc"
          }
        }).catch(() => null);
        if (res && res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.data || json?.item) {
            dataPdp = json.data || json.item;
            break;
          }
        }
      }

      if (dataPdp) {
        const itemObj = dataPdp.item || dataPdp;

        // A. Video dari API
        if (opsi.video) {
          const vList = itemObj.video_info_list || dataPdp.video_info_list;
          if (Array.isArray(vList) && vList.length > 0) {
            const v0 = vList[0];
            const u = v0.default_format?.url || (v0.formats && v0.formats[0]?.url) || v0.url;
            if (u && typeof u === "string") video = u;
          }
        }

        // B. Rating & Terjual Akurat
        if (!rating) {
          const rVal = itemObj.item_rating?.rating_star;
          if (rVal) rating = Number(rVal).toFixed(1);
        }
        if (!terjual) {
          const soldVal = itemObj.historical_sold || itemObj.sold;
          if (soldVal) {
            terjual = soldVal >= 1000 ? (soldVal / 1000).toFixed(1) + "rb+" : String(soldVal);
          }
        }

        // C. Spesifikasi Produk (Bahan, Ukuran, Model, dll)
        if (opsi.spesifikasi) {
          const attrs = itemObj.attributes || dataPdp.attributes;
          if (Array.isArray(attrs) && attrs.length > 0) {
            const barisAttrs = [];
            attrs.forEach((a) => {
              const k = String(a.name || "").trim();
              const v = String(a.value || "").trim();
              if (k && v) barisAttrs.push(`${k}: ${v}`);
            });
            if (barisAttrs.length > 0) {
              spesifikasi = barisAttrs.slice(0, 10).join(" | ");
            }
          }
        }
      }
    } catch (e) {}
  }

  // 11. Scroll ke Area Detail & Penilaian Produk (Pemicu Lazy Load React Shopee)
  try {
    const targetEl = document.querySelector('.page-product__detail, [class*="product-rating"], .product-ratings') ||
      Array.from(document.querySelectorAll('h1, h2, h3, h4, div, span')).find(el => {
        const t = (el.innerText || '').trim();
        return el.children.length === 0 && /^penilaian produk$/i.test(t);
      });

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    } else {
      window.scrollTo(0, Math.round(document.body.scrollHeight * 0.55));
    }
    await tidurX(800);
  } catch(e) {}

  // 12. Ekstraksi Spesifikasi dari DOM (Tabel Atribut Produk Shopee)
  if (opsi.spesifikasi && !spesifikasi) {
    try {
      const elPdpDetail = document.querySelector('.page-product__detail, [class*="product-detail"], div[class*="sections"]');
      if (elPdpDetail) {
        const rows = [];
        const labels = elPdpDetail.querySelectorAll('label, [class*="label"], dt, [class*="title"]');
        labels.forEach((lbl) => {
          const k = (lbl.innerText || lbl.textContent || '').trim();
          if (k && k.length < 35 && !/kategori|dikirim dari|merek|deskripsi|asal|garansi|ongkir/i.test(k)) {
            const valEl = lbl.nextElementSibling || lbl.parentElement.querySelector('div:not(:first-child), span:not(:first-child)');
            const v = (valEl?.innerText || valEl?.textContent || '').trim();
            if (v && v.length < 80 && !rows.some(r => r.startsWith(k))) {
              rows.push(`${k}: ${v}`);
            }
          }
        });
        if (rows.length > 0) {
          spesifikasi = rows.slice(0, 8).join(" | ");
        }
      }
    } catch (e) {}
  }

  // 13. Ekstraksi Rating dari DOM / Tampilan Halaman
  if (!rating) {
    const elScore = document.querySelector('.product-rating-overview__rating-score, [class*="rating-score"]');
    if (elScore && /^[\d.]+$/.test(teks(elScore))) {
      rating = teks(elScore);
    }
  }
  if (!rating) {
    const mDari = document.body.innerText.match(/(\d(?:[.,]\d)?)\s*dari\s*5/i);
    if (mDari) rating = mDari[1].replace(',', '.');
  }
  if (!rating) {
    const mTop = document.body.innerText.match(/(\d[.,]\d)\s*(?:rb|jt)?\+?\s*(?:penilaian|rating)/i);
    if (mTop) rating = mTop[1].replace(',', '.');
  }
  if (!rating && jsonLd?.aggregateRating?.ratingValue) {
    rating = String(jsonLd.aggregateRating.ratingValue);
  }

  // 14. ULASAN (v2.8): parser teks kartu + tunggu-sampai + pagination
  if (opsi.ulasan) {
    try {
      // Batas ulasan per bintang. Ubah sesuai kebutuhan.
      const batas = opsi.ulasanPerBintang || { 3: 60, 4: 60, 2: 30, 1: 30, 5: 10 };

      // --- helper: tunggu sampai kondisi terpenuhi ---
      const tungguSampai = async (fn, maks = 12000, langkah = 300) => {
        const t0 = Date.now();
        while (Date.now() - t0 < maks) {
          try { const r = fn(); if (r) return r; } catch (e) {}
          await tidurX(langkah);
        }
        return null;
      };

      // --- helper: cari kartu review ---
      // Dari DevTools (3 Nov 2026): tiap kartu = div[data-cmtid] di dalam
      // .shopee-product-comment-list (dibungkus div.product-ratings__list).
      // Cadangan: jangkar teks "Laporkan Ulasan Ini" kalau struktur berubah.
      const POLA_TGL = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/;
      const cariKartu = () => {
        const utama = Array.from(document.querySelectorAll(
          ".shopee-product-comment-list [data-cmtid], .product-ratings__list [data-cmtid]"
        ));
        if (utama.length) return Array.from(new Set(utama));
        const jangkar = Array.from(document.querySelectorAll("div, span, button, a"))
          .filter((e) => e.children.length === 0 && /Laporkan Ulasan Ini/i.test(e.textContent || ""));
        const hasil = [];
        for (const j of jangkar) {
          let p = j;
          for (let i = 0; i < 10 && p.parentElement; i++) {
            p = p.parentElement;
            if (POLA_TGL.test(p.innerText || "")) {
              if (!hasil.includes(p)) hasil.push(p);
              break;
            }
          }
        }
        return hasil;
      };

      // --- helper: urai teks satu kartu ---
      const urai = (teksKartu) => {
        const baris = teksKartu.split("\n").map((s) => s.trim()).filter(Boolean);
        const iTgl = baris.findIndex((b) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(b));
        if (iTgl < 0) return null;
        const mVar = baris[iTgl].match(/Variasi:\s*(.+)$/i);
        const atribut = {};
        const bebas = [];
        for (let i = iTgl + 1; i < baris.length; i++) {
          const b = baris[i];
          if (/^Respon Penjual/i.test(b) || /Laporkan Ulasan Ini/i.test(b)) break;
          if (/^\d+$/.test(b)) continue;            // angka "membantu"
          if (/^\d{1,2}:\d{2}$/.test(b)) continue;  // durasi video (0:53)
          const m = b.match(/^([A-Za-zÀ-ÿ ]{2,25}):\s*(.+)$/);
          if (m && bebas.length === 0) { atribut[m[1].trim()] = m[2].trim(); continue; }
          bebas.push(b);
        }
        return {
          tanggal: baris[iTgl].slice(0, 16),
          variasi: mVar ? mVar[1].trim() : "",
          atribut,
          teks: bebas.join(" "),
        };
      };

      // --- helper: klik tab bintang lalu tunggu kartu berganti ---
      const klikTab = async (regex) => {
        // Dari DevTools: tab bintang = div.product-rating-overview__filter
        const kandidatTab = Array.from(document.querySelectorAll(".product-rating-overview__filter"));
        const btn = kandidatTab.find((el) => {
          const t = (el.innerText || "").trim();
          return regex.test(t) && !/\(0\)/.test(t);
        }) || Array.from(document.querySelectorAll("button, div, span")).find((el) => {
          const t = (el.innerText || "").trim();
          return t.length < 30 && regex.test(t) && /\(\d/.test(t) && !/\(0\)/.test(t) && el.children.length <= 1;
        });
        if (!btn) return false;
        const sebelum = (cariKartu()[0]?.innerText || "");
        btn.click();
        await tungguSampai(() => {
          const k = cariKartu();
          return k.length > 0 && (k[0].innerText || "") !== sebelum;
        }, 12000);
        await tidurX(500);
        return true;
      };

      // --- helper: halaman berikutnya ---
      // Dari DevTools: nav.shopee-page-controller.product-ratings__page-controller
      // berisi button.shopee-icon-button--left, tombol angka, dan button.shopee-icon-button--right.
      const cariTombolNext = () => {
        const nav = document.querySelector("nav.product-ratings__page-controller, nav.shopee-page-controller");
        if (!nav) return null;
        const btn = nav.querySelector("button.shopee-icon-button--right");
        if (!btn) return null;
        const nonaktif = btn.disabled || /disabled/i.test(String(btn.className)) || btn.getAttribute("aria-disabled") === "true";
        return nonaktif ? null : btn;
      };
      const halamanBerikutnya = async () => {
        const btn = cariTombolNext();
        if (!btn) return false;
        const sebelum = (cariKartu()[0]?.innerText || "");
        btn.click();
        const berubah = await tungguSampai(() => {
          const k = cariKartu();
          return k.length > 0 && (k[0].innerText || "") !== sebelum;
        }, 10000);
        return !!berubah;
      };

      // --- mulai: scroll ke Penilaian Produk, tunggu kartu pertama ---
      const elPenilaian = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span")).find((el) =>
        el.children.length === 0 && /^penilaian produk$/i.test((el.innerText || "").trim())
      );
      if (elPenilaian) elPenilaian.scrollIntoView({ behavior: "instant", block: "start" });
      await tungguSampai(() => cariKartu().length > 0, 15000);

      // --- loop per bintang ---
      for (const bintang of [3, 4, 2, 1, 5]) {
        const maks = batas[bintang] || 0;
        if (!maks) continue;
        if (!(await klikTab(new RegExp("^" + bintang + "\\s*bintang", "i")))) continue;

        const terkumpul = [];
        const lihat = new Set();
        let halaman = 0;
        while (terkumpul.length < maks && halaman < 40) {
          for (const k of cariKartu()) {
            const r = urai(k.innerText || "");
            if (!r) continue;
            const kunci = k.getAttribute("data-cmtid") ||
              [r.tanggal, r.variasi, r.teks.slice(0, 40), JSON.stringify(r.atribut).slice(0, 40)].join("|");
            if (lihat.has(kunci)) continue;
            lihat.add(kunci);
            if (r.teks.length >= 10 || Object.keys(r.atribut).length) terkumpul.push({ bintang, ...r });
          }
          if (terkumpul.length >= maks) break;
          if (!(await halamanBerikutnya())) break;
          halaman++;
          await tidurX(1200 + Math.random() * 1500);   // jeda acak antar halaman
        }
        ulasanList.push(...terkumpul.slice(0, maks));
      }

      // --- kompatibilitas format lama (kolom CSV) ---
      const kritis = ulasanList.filter((u) => u.bintang >= 2 && u.bintang <= 4 && u.teks.length >= 15);
      reviewKritis = kritis.slice(0, 5).map((r) => `[★${r.bintang}] "${r.teks}"`).join(" || ");
      const positif = ulasanList.filter((u) => u.bintang === 5 && u.teks.length >= 20)
        .sort((a, b) => b.teks.length - a.teks.length);
      reviewPositif = positif.slice(0, 2).map((r) => `[★5] "${r.teks}"`).join(" || ");
    } catch (e) {
      console.warn("SAS: Gagal ekstraksi ulasan teks:", e);
    }
  }

  // 15. GAMBAR ULASAN (v2.8.2 UGC): Ambil foto ulasan pembeli (bintang 4 & 5)
  if (opsi.gambarUlasan) {
    try {
      const maksFoto = Math.min(60, Math.max(1, Number(opsi.maksGambarUlasan) || 30));
      const waktuMulai = Date.now();
      const batasWaktuTotal = 30000; // batas total 30 detik agar tidak macet

      const tungguSampai = async (fn, maks = 12000, langkah = 300) => {
        const t0 = Date.now();
        while (Date.now() - t0 < maks) {
          try { const r = fn(); if (r) return r; } catch (e) {}
          await tidurX(langkah);
        }
        return null;
      };

      const POLA_TGL = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/;
      const cariKartu = () => {
        const utama = Array.from(document.querySelectorAll(
          ".shopee-product-comment-list [data-cmtid], .product-ratings__list [data-cmtid]"
        ));
        if (utama.length) return Array.from(new Set(utama));
        const jangkar = Array.from(document.querySelectorAll("div, span, button, a"))
          .filter((e) => e.children.length === 0 && /Laporkan Ulasan Ini/i.test(e.textContent || ""));
        const hasil = [];
        for (const j of jangkar) {
          let p = j;
          for (let i = 0; i < 10 && p.parentElement; i++) {
            p = p.parentElement;
            if (POLA_TGL.test(p.innerText || "")) {
              if (!hasil.includes(p)) hasil.push(p);
              break;
            }
          }
        }
        return hasil;
      };

      const klikTabMedia = async () => {
        const kandidatTab = Array.from(document.querySelectorAll(".product-rating-overview__filter"));
        const regexMedia = /(?:dengan\s*media|with\s*media)/i;
        const btn = kandidatTab.find((el) => {
          const t = (el.innerText || "").trim();
          return regexMedia.test(t) && !/\(0\)/.test(t);
        }) || Array.from(document.querySelectorAll("button, div, span")).find((el) => {
          const t = (el.innerText || "").trim();
          return t.length < 35 && regexMedia.test(t) && /\(\d/.test(t) && !/\(0\)/.test(t) && el.children.length <= 2;
        });
        if (!btn) return false;
        const sebelum = (cariKartu()[0]?.innerText || "");
        btn.click();
        await tungguSampai(() => {
          const k = cariKartu();
          return k.length > 0 && (k[0].innerText || "") !== sebelum;
        }, 12000);
        await tidurX(600);
        return true;
      };

      const cariTombolNext = () => {
        const nav = document.querySelector("nav.product-ratings__page-controller, nav.shopee-page-controller");
        if (!nav) return null;
        const btn = nav.querySelector("button.shopee-icon-button--right");
        if (!btn) return null;
        const nonaktif = btn.disabled || /disabled/i.test(String(btn.className)) || btn.getAttribute("aria-disabled") === "true";
        return nonaktif ? null : btn;
      };

      const halamanBerikutnya = async () => {
        const btn = cariTombolNext();
        if (!btn) return false;
        const sebelum = (cariKartu()[0]?.innerText || "");
        btn.click();
        const berubah = await tungguSampai(() => {
          const k = cariKartu();
          return k.length > 0 && (k[0].innerText || "") !== sebelum;
        }, 10000);
        return !!berubah;
      };

      // 1. Scroll ke Penilaian Produk jika belum
      const elPenilaian = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span")).find((el) =>
        el.children.length === 0 && /^penilaian produk$/i.test((el.innerText || "").trim())
      );
      if (elPenilaian) elPenilaian.scrollIntoView({ behavior: "instant", block: "start" });
      await tungguSampai(() => cariKartu().length > 0, 15000);

      // 2. Klik tab "Dengan Media"
      await klikTabMedia();

      // 3. Kumpulkan foto ulasan
      const urlSeen = new Set();
      let halaman = 0;

      while (gambarUlasan.length < maksFoto && halaman < 25 && (Date.now() - waktuMulai < batasWaktuTotal)) {
        const kartuList = cariKartu();
        for (const k of kartuList) {
          if (gambarUlasan.length >= maksFoto) break;

          // Bintang ulasan
          let ratingBintang = 5;
          const solidStars = k.querySelectorAll(".icon-rating-solid, [class*='rating-solid'], svg[class*='star']");
          if (solidStars.length > 0 && solidStars.length <= 5) {
            ratingBintang = solidStars.length;
          }

          // Filter: Hanya bintang 4 dan 5
          if (ratingBintang < 4) continue;

          // Urai cuplikan teks
          const teksKartu = (k.innerText || "");
          const baris = teksKartu.split("\n").map((s) => s.trim()).filter(Boolean);
          const iTgl = baris.findIndex((b) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(b));
          let variasi = "";
          let teksReview = "";
          let membantu = 0;

          if (iTgl >= 0) {
            const mVar = baris[iTgl].match(/Variasi:\s*(.+)$/i);
            if (mVar) variasi = mVar[1].trim();
            const cuplikan = [];
            for (let i = iTgl + 1; i < baris.length; i++) {
              const b = baris[i];
              if (/^Respon Penjual/i.test(b) || /Laporkan Ulasan Ini/i.test(b)) break;
              if (/^\d+$/.test(b)) { membantu = parseInt(b, 10) || 0; continue; }
              if (/^\d{1,2}:\d{2}$/.test(b)) continue;
              if (/^[A-Za-zÀ-ÿ ]{2,25}:/.test(b)) continue;
              cuplikan.push(b);
            }
            teksReview = cuplikan.join(" ").replace(/\r?\n|\r/g, " ").trim();
          }

          // Target container media ulasan (menggunakan class dari inspeksi pengguna)
          const mediaWrappers = k.querySelectorAll(
            ".rating-media-list__image-wrapper--container, [class*='rating-media-list__image-wrapper'], [class*='shopee-rating-media-list-image']"
          );

          for (const wrap of mediaWrappers) {
            if (gambarUlasan.length >= maksFoto) break;

            // Lewati jika ini video (ada durasi atau icon play)
            if (wrap.querySelector('[class*="video"], [class*="play"]') || /:\d{2}/.test(wrap.innerText || "")) {
              continue;
            }

            const imgEl = wrap.querySelector("img");
            let rawUrl = imgEl ? (imgEl.currentSrc || imgEl.src || imgEl.getAttribute("data-src") || "") : "";
            if (!rawUrl) {
              const bgMatch = (wrap.style?.backgroundImage || getComputedStyle(wrap)?.backgroundImage || "").match(/url\(["']?(https?:[^"')]+)["']?\)/);
              if (bgMatch) rawUrl = bgMatch[1];
            }

            if (!rawUrl || !/susercontent\.com|shopee\.co\.id/.test(rawUrl)) continue;

            // Bersihkan format resolusi tinggi
            const cleanUrl = rawUrl
              .split("?")[0]
              .replace(/_(tn|m|xxs|xs|s)(\.[a-zA-Z0-9]+)?$/i, "")
              .replace(/_tn$/i, "")
              .replace(/@resize[^\s"']+/i, "");

            if (!cleanUrl || urlSeen.has(cleanUrl)) continue;
            urlSeen.add(cleanUrl);

            gambarUlasan.push({
              url: cleanUrl,
              bintang: ratingBintang,
              membantu: membantu || 0,
              teks: teksReview.slice(0, 150),
              variasi: variasi || ""
            });
          }
        }

        if (gambarUlasan.length >= maksFoto) break;
        if (Date.now() - waktuMulai >= batasWaktuTotal) break;
        if (!(await halamanBerikutnya())) break;
        halaman++;
        await tidurX(1200 + Math.random() * 1500);
      }
    } catch (e) {
      console.warn("SAS: Ekstraksi gambar ulasan gagal / dilewati:", e);
    }
  }

  // 12. Fallback Video Asli Produk jika API belum menangkap
  if (opsi.video && !video) {

    // B. Cari dari Script Tags (Shopee SSR & Embedded JSON State)
    if (!video) {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        const t = s.textContent || "";
        if (t.includes("vod.susercontent.com") || t.includes(".default.mp4") || t.includes("video_info_list")) {
          const m = t.match(/https?:(?:\\\/\\\/|\/\/)[^\s"'\\]+vod\.susercontent\.com[^\s"'\\]+\.mp4/i);
          if (m) {
            video = m[0].replace(/\\\//g, "/");
            break;
          }
        }
      }
    }

    // C. Cek elemen DOM <video> langsung
    if (!video) {
      const vidEls = Array.from(document.querySelectorAll("video"));
      for (const v of vidEls) {
        const src = v.currentSrc || v.src || v.querySelector("source")?.src || "";
        if (src && /^https?:\/\//i.test(src) && !src.startsWith("blob:")) {
          video = src;
          break;
        }
      }
    }

    // D. Pemicu klik / hover thumbnail video galeri untuk memuat player
    if (!video) {
      const tombolPlay = document.querySelector('[class*="play"], [aria-label*="play" i], [class*="video"]');
      if (tombolPlay) {
        try { tombolPlay.click(); } catch (e) {}
        await tidurX(800);
        const vEl = document.querySelector("video");
        if (vEl) {
          const s = vEl.currentSrc || vEl.src || vEl.querySelector("source")?.src || "";
          if (s && /^https?:\/\//i.test(s) && !s.startsWith("blob:")) {
            video = s;
          }
        }
      }
    }

    // E. Cari dari Performance Resource Timing
    if (!video) {
      try {
        const res = window.performance?.getEntriesByType?.("resource") || [];
        for (let i = res.length - 1; i >= 0; i--) {
          const u = res[i].name || "";
          if (/vod\.susercontent\.com|cvf\.shopee\.co\.id|\.mp4(\?|$)/i.test(u) && !u.startsWith("blob:") && !/preview|thumb|cover/i.test(u)) {
            video = u;
            break;
          }
        }
      } catch (e) {}
    }

    // F. Cari via React Fiber Scanner pada galeri produk
    if (!video) {
      function cariVideoObj(obj, depth = 0) {
        if (!obj || typeof obj !== "object" || depth > 6) return null;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const r = cariVideoObj(item, depth + 1);
            if (r) return r;
          }
          return null;
        }
        if (obj.video_info_list && Array.isArray(obj.video_info_list) && obj.video_info_list.length) {
          const v0 = obj.video_info_list[0];
          const u = v0.default_format?.url || (v0.formats && v0.formats[0]?.url) || v0.url;
          if (u && typeof u === "string") return u;
        }
        if (obj.default_format?.url) return obj.default_format.url;
        if (obj.video_url && typeof obj.video_url === "string") return obj.video_url;
        if (obj.videoUrl && typeof obj.videoUrl === "string") return obj.videoUrl;

        for (const k of Object.keys(obj)) {
          if (k === "children" || k === "parent" || k === "fiber" || k.startsWith("__")) continue;
          try {
            const r = cariVideoObj(obj[k], depth + 1);
            if (r) return r;
          } catch (e) {}
        }
        return null;
      }

      const galeriEls = [
        document.querySelector('[class*="product-briefing"]'),
        document.querySelector('[class*="gallery"]'),
        document.querySelector('[class*="carousel"]'),
        document.querySelector('video')?.parentElement,
        document.querySelector('#main'),
        document.body
      ];

      for (const el of galeriEls) {
        if (!el) continue;
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
        if (!key) continue;
        let fiber = el[key];
        for (let i = 0; i < 25 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          const v = cariVideoObj(props);
          if (v) { video = v; break; }
          const state = fiber.memoizedState;
          const vs = cariVideoObj(state);
          if (vs) { video = vs; break; }
          fiber = fiber.return;
        }
        if (video) break;
      }
    }
  }

  return {
    nama,
    harga,
    terjual: terjual || "",
    rating: rating || "",
    deskripsi,
    gambar: gambar.slice(0, Math.max(1, opsi.maksGambar || 6)),
    video: video || "",
    reviewKritis: reviewKritis || "",
    reviewPositif: reviewPositif || "",
    ulasan: ulasanList,
    gambarUlasan: gambarUlasan || [],
    spesifikasi: spesifikasi || "",
    urlAkhir: location.href,
  };
}
