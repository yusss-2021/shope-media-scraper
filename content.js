// ============================================================
//  Shopee Affiliate Scraper - Content Script (v2.4 Ultra)
//  Fitur: Deep-Recursive React Fiber Scanner (Zero-Class-Name Dependency),
//  Dual XHR & Fetch Interceptor, Auto-Link Resolver & Progress Bar.
// ============================================================
(() => {
  if (document.getElementById("sas-host")) return;

  // ---------- Injeksi Main-World Bridge (Akses React & API Shopee) ----------
  (() => {
    const script = document.createElement("script");
    script.textContent = `
    (() => {
      // 1. Helper Universal: Cari objek produk secara rekursif di dalam props/state React
      // Tidak membutuhkan nama class CSS sama sekali!
      function cariObjekProduk(obj, depth = 0) {
        if (!obj || typeof obj !== "object" || depth > 5) return null;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const res = cariObjekProduk(item, depth + 1);
            if (res) return res;
          }
          return null;
        }

        // Cek apakah objek ini adalah produk Shopee
        // Karakteristik produk Shopee: memiliki ID (itemId / item_id / id) dan nama / harga / gambar
        const rawId = obj.item_id || obj.itemId || obj.itemid || obj.goodsId || obj.productId || (obj.id && String(obj.id).length >= 6 ? obj.id : null);
        const rawName = obj.item_name || obj.itemName || obj.name || obj.title;
        const rawPrice = obj.price || obj.display_price || obj.displayPrice || obj.priceStr;
        const rawImg = obj.image_url || obj.imageUrl || obj.image || obj.thumb || obj.cover_image;

        if (rawId && (rawName || rawPrice || rawImg)) {
          const itemId = String(rawId);
          const shopId = String(obj.shop_id || obj.shopId || obj.shopid || obj.seller_id || obj.sellerId || "0");
          return {
            itemId,
            shopId,
            url: "https://shopee.co.id/product/" + shopId + "/" + itemId,
            nama: String(rawName || "").trim(),
            harga: rawPrice ? (String(rawPrice).startsWith("Rp") ? String(rawPrice) : "Rp " + Number(rawPrice).toLocaleString("id-ID")) : "",
            thumb: String(rawImg || ""),
            komisi: obj.commission_rate || obj.commissionRate ? "Komisi " + ((obj.commission_rate || obj.commissionRate) * 100).toFixed(1) + "%" : (obj.commission || "")
          };
        }

        // Cari rekursif ke dalam properti
        for (const k of Object.keys(obj)) {
          if (k === "children" || k === "parent" || k === "fiber" || k.startsWith("__")) continue;
          try {
            const res = cariObjekProduk(obj[k], depth + 1);
            if (res) return res;
          } catch(e) {}
        }
        return null;
      }

      // 2. Ekstrak data dari elemen DOM manapun via React Fiber
      function ekstrakDariElemen(el) {
        if (!el) return null;
        const key = Object.keys(el).find(
          (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps") || k.startsWith("__reactInternalInstance")
        );
        if (!key) return null;
        let fiber = el[key];
        for (let i = 0; i < 30 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props) {
            const res = cariObjekProduk(props);
            if (res) return res;
          }
          const state = fiber.memoizedState;
          if (state) {
            const res = cariObjekProduk(state);
            if (res) return res;
          }
          fiber = fiber.return;
        }
        return null;
      }

      // 3. Scanner Utama: Scan semua tombol "Buat Link", kartu, & gambar
      window.__sasScanProduk = function() {
        try {
          const hasil = [];
          const seen = new Set();

          // A. Scan dari semua elemen yang memiliki teks "Buat Link" (sangat spesifik ke kartu produk)
          document.querySelectorAll("*").forEach((el) => {
            const t = (el.innerText || "").trim();
            if (t === "Buat Link" || t === "Dapatkan Tautan" || t === "Salin Link") {
              // Cek elemen itu sendiri dan parentnya ke atas
              let target = el;
              for (let k = 0; k < 6 && target; k++) {
                const d = ekstrakDariElemen(target);
                if (d && d.itemId && !seen.has(d.itemId)) {
                  seen.add(d.itemId);
                  hasil.push(d);
                  break;
                }
                target = target.parentElement;
              }
            }
          });

          // B. Scan dari semua elemen gambar produk Shopee
          document.querySelectorAll("img").forEach((im) => {
            const src = im.src || im.currentSrc || im.getAttribute("data-src") || "";
            if (/susercontent\.com|cf\.shopee\.co\.id|\/file\//.test(src)) {
              let target = im;
              for (let k = 0; k < 6 && target; k++) {
                const d = ekstrakDariElemen(target);
                if (d && d.itemId && !seen.has(d.itemId)) {
                  seen.add(d.itemId);
                  // Pastikan thumb terisi
                  if (!d.thumb) d.thumb = src;
                  hasil.push(d);
                  break;
                }
                target = target.parentElement;
              }
            }
          });

          // C. Scan sisa elemen jika belum dapat banyak
          if (hasil.length < 5) {
            document.querySelectorAll("div, li, tr, section").forEach((el) => {
              const d = ekstrakDariElemen(el);
              if (d && d.itemId && !seen.has(d.itemId)) {
                seen.add(d.itemId);
                hasil.push(d);
              }
            });
          }

          if (hasil.length) {
            window.dispatchEvent(new CustomEvent("SAS_MAIN_DATA", { detail: hasil }));
          }
        } catch(e) {}
      };

      // 4. Dual Interceptor: Intercept FETCH & XMLHttpRequest untuk menangkap JSON produk Shopee
      // A. Intercept FETCH
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        try {
          const url = String(args[0]?.url || args[0] || "");
          if (url.includes("offer") || url.includes("product") || url.includes("item")) {
            res.clone().json().then((json) => {
              prosesDataApiShopee(json);
            }).catch(() => {});
          }
        } catch(e) {}
        return res;
      };

      // B. Intercept XHR (axios/XMLHttpRequest)
      const origXhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__sasUrl = String(url || "");
        return origXhrOpen.apply(this, arguments);
      };
      const origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener("load", function() {
          try {
            if (this.__sasUrl && (this.__sasUrl.includes("offer") || this.__sasUrl.includes("product") || this.__sasUrl.includes("item"))) {
              const json = JSON.parse(this.responseText);
              prosesDataApiShopee(json);
            }
          } catch(e) {}
        });
        return origXhrSend.apply(this, arguments);
      };

      function prosesDataApiShopee(json) {
        if (!json) return;
        const listRaw = json?.data?.list || json?.data?.items || json?.data?.products || (Array.isArray(json?.data) ? json.data : []);
        if (Array.isArray(listRaw) && listRaw.length) {
          const hasil = listRaw.map((it) => {
            const rawId = it.itemId || it.item_id || it.id;
            const rawShop = it.shopId || it.shop_id || it.shopid || "0";
            if (!rawId) return null;
            return {
              itemId: String(rawId),
              shopId: String(rawShop),
              url: "https://shopee.co.id/product/" + rawShop + "/" + rawId,
              nama: it.itemName || it.name || it.title || "",
              harga: it.price ? "Rp " + Number(it.price).toLocaleString("id-ID") : (it.displayPrice || ""),
              thumb: it.imageUrl || it.image || it.thumb || "",
              komisi: it.commissionRate ? "Komisi " + (it.commissionRate * 100).toFixed(1) + "%" : ""
            };
          }).filter(Boolean);

          if (hasil.length) {
            window.dispatchEvent(new CustomEvent("SAS_MAIN_DATA", { detail: hasil }));
          }
        }
      }

      // Scan otomatis saat halaman baru dibuka
      setTimeout(window.__sasScanProduk, 800);
      setTimeout(window.__sasScanProduk, 2500);
    })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  })();

  // ---------- Default State ----------
  const DEF = {
    target: 50,
    jedaMin: 5,
    jedaMax: 10,
    istirahatTiap: 15,
    istirahatDetik: 25,
    deskripsi: true,
    gambar: true,
    video: true,
    ulasan: false,
    gambarUlasan: false,
    maksGambarUlasan: 30,
    spesifikasi: false,
    maksGambar: 6,
    latar: false,
  };

  let set = { ...DEF };
  let items = [];
  let csvHeadersOriginal = null;
  let mode = "idle"; // idle | kumpul | ambil | massal
  let jeda = false;
  let stop = false;
  let statusTeks = "Siap untuk mulai.";
  let countdownTeks = "";
  let siklus = [];

  // ---------- Style (Shadow DOM) ----------
  const CSS = `
  *, *::before, *::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  
  .kartu {
    width: 380px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    background: #ffffff;
    color: #212529;
    border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.25), 0 3px 10px rgba(0,0,0,0.1);
    overflow: hidden;
    font-size: 12px;
    border: 1px solid rgba(0,0,0,0.1);
  }
  .kartu.kecil { width: 260px; }
  .kartu.kecil .isi { display: none; }
  
  .kepala {
    background: linear-gradient(135deg, #ee4d2d 0%, #ff5722 100%);
    color: #fff;
    padding: 10px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    user-select: none;
  }
  .kepala .judul {
    font-weight: 700;
    font-size: 13.5px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kepala .aksi-header { display: flex; align-items: center; gap: 6px; }
  .kepala button {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    border: 0;
    border-radius: 6px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kepala button:hover { background: rgba(255, 255, 255, 0.35); }

  .isi {
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: calc(92vh - 46px);
  }

  .tabs {
    display: flex;
    gap: 4px;
    background: #f1f3f5;
    border-radius: 8px;
    padding: 3px;
  }
  .tab {
    flex: 1;
    border: 0;
    background: transparent;
    padding: 6px 4px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 11.5px;
    color: #495057;
    text-align: center;
  }
  .tab:hover { color: #ee4d2d; }
  .tab.aktif {
    background: #ffffff;
    color: #ee4d2d;
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }

  .kotak-utama {
    background: #fff8f6;
    border: 1px solid #ffd8cf;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .status-baris {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    font-weight: 600;
    color: #d9480f;
    margin-bottom: 6px;
  }
  .bar {
    height: 10px;
    background: #e9ecef;
    border-radius: 99px;
    overflow: hidden;
  }
  .bar > i {
    display: block;
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #ee4d2d, #ff922b);
    transition: width 0.3s ease;
  }
  .progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #6c757d;
    margin-top: 4px;
    font-weight: 500;
  }
  .status-teks {
    font-size: 12px;
    font-weight: 600;
    color: #212529;
    margin-top: 6px;
    word-break: break-word;
  }
  .countdown-teks {
    font-size: 11.5px;
    font-weight: 600;
    color: #e8590c;
    margin-top: 2px;
  }

  .btn-group {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .btn {
    border: 0;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 600;
    font-size: 11.5px;
    background: #e9ecef;
    color: #343a40;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: all 0.15s;
    user-select: none;
  }
  .btn:hover { filter: brightness(0.95); }
  .btn.utama {
    background: #ee4d2d;
    color: #ffffff;
    font-size: 13px;
    padding: 10px 14px;
  }
  .btn.utama:hover { background: #d73211; }
  .btn.hijau { background: #0ca678; color: #ffffff; }
  .btn.hijau:hover { background: #099268; }
  .btn.biru { background: #1c7ed6; color: #ffffff; }
  .btn.biru:hover { background: #1971c2; }
  .btn.abu { background: #495057; color: #ffffff; }
  .btn.kuning { background: #f59f00; color: #ffffff; }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .penuh { width: 100%; }
  .baris { display: flex; gap: 6px; margin-top: 6px; }
  .baris .btn { flex: 1; }

  details {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 6px 10px;
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 11.5px;
    color: #495057;
    user-select: none;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 76px;
    gap: 6px 10px;
    align-items: center;
    margin-top: 8px;
  }
  .grid label { color: #495057; font-size: 11.5px; }
  input[type="number"] {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid #ced4da;
    border-radius: 6px;
    font-size: 11.5px;
    text-align: right;
  }
  .cek {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
    color: #495057;
    cursor: pointer;
    font-size: 11.5px;
  }
  .cek input { accent-color: #ee4d2d; }

  .daftar-wadah {
    border: 1px solid #dee2e6;
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
  }
  .daftar-header {
    background: #f1f3f5;
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 700;
    color: #495057;
    display: flex;
    justify-content: space-between;
  }
  .daftar {
    max-height: 180px;
    overflow-y: auto;
  }
  .item {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid #f1f3f5;
    font-size: 11px;
  }
  .item:last-child { border-bottom: 0; }
  .item img {
    width: 34px;
    height: 34px;
    object-fit: cover;
    border-radius: 5px;
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    flex: none;
  }
  .item .tx { flex: 1; min-width: 0; }
  .item .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: #212529;
  }
  .item .mt {
    color: #868e96;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }
  .pil {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 99px;
    white-space: nowrap;
    flex: none;
    font-weight: 600;
  }
  .antri { background: #f1f3f5; color: #495057; }
  .proses { background: #fff3bf; color: #d9480f; }
  .ok { background: #d3f9d8; color: #2b8a3e; }
  .gagal { background: #ffe3e3; color: #c92a2a; }
  .nolink { background: #e7f5ff; color: #1c7ed6; }

  .log {
    max-height: 70px;
    overflow-y: auto;
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 10px;
    color: #495057;
    font-family: monospace;
    line-height: 1.4;
  }

  textarea {
    width: 100%;
    padding: 6px;
    border: 1px solid #ced4da;
    border-radius: 6px;
    margin: 6px 0;
    resize: vertical;
    font-size: 11px;
    font-family: monospace;
  }
  .kecilteks {
    font-size: 10.5px;
    color: #868e96;
    margin-top: 4px;
    line-height: 1.4;
  }
  [hidden] { display: none !important; }
  `;

  // ---------- Markup Panel ----------
  const HTML = `
  <div class="kartu" id="kartu">
    <div class="kepala" id="kepala">
      <div class="judul" style="display: flex; align-items: center; gap: 6px;">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <span>Shopee Scraper</span>
      </div>
      <div class="aksi-header">
        <button id="min" title="Kecilkan / besarkan panel">–</button>
        <button id="tutup" title="Sembunyikan panel">✕</button>
      </div>
    </div>

    <div class="isi">
      <div class="tabs">
        <button class="tab aktif" data-tab="scraper">Scraper Produk</button>
        <button class="tab" data-tab="ekspor">Hasil &amp; Unduh</button>
        <button class="tab" data-tab="massal">Link Massal</button>
      </div>

      <!-- TAB 1: SCRAPER PRODUK -->
      <section id="tab-scraper">
        <!-- ACTION ZONE: TOMBOL UTAMA & PROGRESS BAR (DI ATAS) -->
        <div class="kotak-utama">
          <div class="status-baris">
            <span>PROGRES SCRAPING</span>
            <span id="persen">0% (0 / 0)</span>
          </div>
          <div class="bar"><i id="barisi"></i></div>
          <div class="progress-info">
            <span id="counter">Total: 0 produk</span>
            <span id="eta">ETA: –</span>
          </div>
          <div class="status-teks" id="status">Siap. Klik tombol di bawah untuk mulai.</div>
          <div class="countdown-teks" id="countdown"></div>

          <!-- KONTROL RUNTIME -->
          <div class="btn-group" style="margin-top: 10px;">
            <button class="btn hijau" style="flex:1; padding: 9px;" id="kumpulSaja" title="Kumpulkan produk di halaman web ini">
              🔍 Kumpulkan Produk
            </button>
            <button class="btn utama" style="flex:1; padding: 9px;" id="ambilSaja" title="Mulai scrape data produk di antrian">
              ▶ Mulai Ambil Data
            </button>
            <button class="btn abu" id="jeda" disabled>⏸ Jeda</button>
            <button class="btn" id="stop" disabled>⏹ Stop</button>
          </div>
        </div>

        <!-- OPSI DATA YANG DIAMBIL -->
        <div class="opsi-data-box" style="margin-top: 8px; background: #ffffff; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px 12px;">
          <div style="font-size: 11px; font-weight: 700; color: #495057; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>DATA YANG DIAMBIL:</span>
            <span style="font-size: 10px; color: #868e96; font-weight: normal;">(Centang sesuai kebutuhan)</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px;">
            <label class="cek" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #343a40; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="gambar" checked style="cursor: pointer;">
              <span>4 - 6 Gambar HD</span>
            </label>
            <label class="cek" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #343a40; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="video" checked style="cursor: pointer;">
              <span>Video Asli (.mp4)</span>
            </label>
            <label class="cek" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #343a40; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="deskripsi" checked style="cursor: pointer;">
              <span>Deskripsi Lengkap</span>
            </label>
            <label class="cek" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #495057; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="ulasan" style="cursor: pointer;">
              <span>Komentar / Ulasan</span>
            </label>
          </div>
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #edf2f7; display: flex; flex-direction: column; gap: 6px;">
            <label class="cek" style="margin: 0; font-size: 11.5px; font-weight: 600; color: #e03131; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="gambarUlasan" style="cursor: pointer;">
              <span>📸 Gambar dari Ulasan (Maks 30 Foto)</span>
            </label>
            <label class="cek" style="margin: 0; font-size: 11px; color: #6c757d; display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="spesifikasi" style="cursor: pointer;">
              <span>Kategori Produk (Niche) / Spesifikasi</span>
            </label>
          </div>
        </div>

        <!-- IMPORT CSV & INPUT LINK -->
        <details id="detImport" style="margin-top: 6px;" open>
          <summary>📥 Import CSV / Tempel Link Affiliate</summary>
          <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
            <input type="file" id="fileCsv" accept=".csv,text/csv,text/plain" style="display:none">
            <button class="btn hijau penuh" id="btnPilihCsv" style="padding: 9px; font-weight: 700;">
              📁 Upload / Import File CSV Shopee
            </button>
            <div class="kecilteks" style="margin-top: -2px; font-size: 10px; color: #6c757d;">
              *Mendukung file CSV resmi Shopee Affiliate (otomatis deteksi kolom link/shortlink &amp; nama).
            </div>
            <textarea id="linkmanual" rows="2" placeholder="Atau tempel link manual di sini (bisa s.shopee.co.id / shope.ee)..."></textarea>
            <button class="btn penuh" id="tambahManual">➕ Tambahkan Link Manual ke Antrian</button>
          </div>
        </details>

        <!-- DAFTAR PRODUK -->
        <div class="daftar-wadah" style="margin-top: 8px;">
          <div class="daftar-header">
            <span>DAFTAR PRODUK DI ANTRIAN</span>
            <span id="labelAntrian">0 item</span>
          </div>
          <div class="daftar" id="daftar"></div>
        </div>
      </section>

      <!-- TAB 2: EKSPOR -->
      <section id="tab-ekspor" hidden>
        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px;">
          <h4 style="margin:0 0 8px; color:#ee4d2d; font-size:12px;">EKSPOR CSV BARU (LENGKAP DENGAN LINK MEDIA)</h4>
          <div style="margin-bottom: 8px;">
            <button class="btn utama penuh" id="csv" style="padding: 10px; font-size: 12.5px; font-weight: 700;">
              📊 Unduh CSV Baru (+ Link Video, Gambar &amp; Deskripsi)
            </button>
          </div>
          <div class="baris">
            <button class="btn hijau" id="json">💾 Unduh JSON</button>
            <button class="btn kuning" id="salinFormat">📋 Salin Format Bot</button>
          </div>
          <div class="baris" style="margin-top: 10px;">
            <button class="btn abu penuh" id="hapus">🗑️ Bersihkan Data Antrian</button>
          </div>
          <div class="kecilteks" style="margin-top: 8px; line-height: 1.45;">
            • <b>CSV Baru</b>: Menyisipkan kolom <b>Link Video (.mp4)</b>, <b>Link Gambar 1 - 6</b>, dan <b>Deskripsi Lengkap</b> langsung ke kolom CSV asli Shopee Affiliate.<br>
            • <b>Super Cepat &amp; Hemat Kuota</b>: Bot hanya mengambil tautan langsung CDN tanpa perlu download file bergiga-giga ke laptop.
          </div>
          <details style="margin-top: 8px;">
            <summary style="font-size:10.5px; color:#868e96; cursor:pointer;">📥 Opsi Unduh File Fisik ke Laptop (Opsional)</summary>
            <div class="baris" style="margin-top: 6px;">
              <button class="btn biru" id="img" style="font-size:10.5px; padding:5px;">🖼️ Unduh File Gambar</button>
              <button class="btn biru" id="btnUnduhVideo" style="font-size:10.5px; padding:5px;">🎬 Unduh File Video</button>
            </div>
          </details>
        </div>
      </section>

      <!-- TAB 3: LINK MASSAL -->
      <section id="tab-massal" hidden>
        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 10px;">
          <h4 style="margin:0 0 8px; color:#ee4d2d; font-size:12px;">BUAT LINK MASSAL AFFILIATE</h4>
          <div class="grid">
            <label>Target produk (maks 100)</label>
            <input id="targetMassal" type="number" min="1" max="100" value="100">
          </div>
          <div class="baris">
            <button class="btn utama" id="mulaiMassal">Mulai Pilih Otomatis</button>
            <button class="btn abu" id="stopMassal" disabled>Stop</button>
          </div>
          <div class="kecilteks">Otomatis mencentang produk di halaman affiliate lalu menekan tombol 'Buat Link Massal' Shopee.</div>
        </div>
      </section>

      <!-- LOG BOX -->
      <div class="log" id="log"></div>
    </div>
  </div>
  `;

  // ---------- Inisialisasi Shadow DOM ----------
  const host = document.createElement("div");
  host.id = "sas-host";
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style>${HTML}`;
  document.body.appendChild(host);

  const $ = (s) => root.querySelector(s);

  // ---------- Dragging Panel ----------
  (() => {
    const kepala = $("#kepala");
    let isDragging = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    kepala.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = host.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      host.style.right = "auto";
      host.style.bottom = "auto";
      host.style.left = `${initialLeft}px`;
      host.style.top = `${initialTop}px`;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - 300, initialLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - 80, initialTop + dy));
        host.style.left = `${newLeft}px`;
        host.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  })();

  // ---------- Helper Umum ----------
  const sleep = (min, max = min) =>
    new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  const fmtWaktu = (detik) => {
    detik = Math.max(0, Math.round(detik));
    const j = Math.floor(detik / 3600);
    const m = Math.floor((detik % 3600) / 60);
    const s = detik % 60;
    return (j ? j + "j " : "") + (m || j ? m + "m " : "") + s + "d";
  };

  const logEl = $("#log");
  const log = (t) => {
    const d = document.createElement("div");
    d.textContent = `${new Date().toLocaleTimeString("id-ID")}  ${t}`;
    logEl.appendChild(d);
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const setStatus = (t) => {
    statusTeks = t;
    $("#status").textContent = t;
  };

  const setCountdown = (t) => {
    countdownTeks = t;
    $("#countdown").textContent = t;
  };

  // ---------- Penyimpanan Storage ----------
  let timerSimpan = null;
  const simpan = () => {
    clearTimeout(timerSimpan);
    timerSimpan = setTimeout(() => {
      try {
        chrome.storage.local.set({
          sas_items: items,
          sas_setelan: set,
          sas_csv_header: csvHeadersOriginal,
        });
      } catch (e) {}
    }, 250);
  };

  const muat = async () => {
    try {
      const d = await chrome.storage.local.get(["sas_items", "sas_setelan", "sas_csv_header"]);
      if (Array.isArray(d.sas_items)) {
        items = d.sas_items.map((i) =>
          i.status === "proses" ? { ...i, status: "antri" } : i
        );
      }
      if (d.sas_setelan) {
        set = { ...DEF, ...d.sas_setelan };
        if (d.sas_setelan.maksGambar === 1 || d.sas_setelan.maksGambar === 4) {
          set.maksGambar = 6;
        }
      }
      if (d.sas_csv_header) csvHeadersOriginal = d.sas_csv_header;
    } catch (e) {}
  };

  // ---------- Sinkronisasi Form ----------
  const angkaKeys = ["target", "jedaMin", "jedaMax", "istirahatTiap", "istirahatDetik", "maksGambar", "maksGambarUlasan"];
  const cekKeys = ["deskripsi", "gambar", "latar", "video", "ulasan", "gambarUlasan", "spesifikasi"];

  const isiForm = () => {
    angkaKeys.forEach((k) => {
      const el = $("#" + k);
      if (el) el.value = set[k];
    });
    cekKeys.forEach((k) => {
      const el = $("#" + k);
      if (el) el.checked = !!set[k];
    });
  };

  const bacaForm = () => {
    angkaKeys.forEach((k) => {
      const el = $("#" + k);
      if (el) {
        const v = parseInt(el.value, 10);
        set[k] = Number.isFinite(v) && v >= 0 ? v : DEF[k];
      }
    });
    cekKeys.forEach((k) => {
      const el = $("#" + k);
      if (el) set[k] = el.checked;
    });

    if (set.jedaMin < 2) set.jedaMin = 2;
    if (set.jedaMax < set.jedaMin) set.jedaMax = set.jedaMin;
    simpan();
  };

  [...angkaKeys, ...cekKeys].forEach((k) => {
    const el = $("#" + k);
    if (el) el.addEventListener("change", () => { bacaForm(); isiForm(); });
  });

  // ---------- Render Status & Progress ----------
  const hitung = () => {
    const c = { total: items.length, antri: 0, proses: 0, ok: 0, gagal: 0, nolink: 0 };
    items.forEach((i) => {
      if (i.status === "nolink") c.nolink++;
      else if (c[i.status] !== undefined) c[i.status]++;
    });
    return c;
  };

  const render = () => {
    const c = hitung();
    const bisa = c.total - c.nolink;
    const selesai = c.ok + c.gagal;
    const persen = bisa > 0 ? Math.round((selesai / bisa) * 100) : 0;

    $("#barisi").style.width = `${persen}%`;
    $("#persen").textContent = `${persen}% (${selesai} / ${bisa})`;
    $("#counter").textContent = `Total: ${c.total} • ✅ ${c.ok} • ❌ ${c.gagal} • ⏳ ${c.antri + c.proses}` + (c.nolink ? ` • ⚠️ Tanpa Link: ${c.nolink}` : "");
    $("#labelAntrian").textContent = `${c.total} item`;

    let etaTeks = "–";
    if (mode === "ambil" && siklus.length) {
      const rata = siklus.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, siklus.length);
      const sisaDetik = ((c.antri + c.proses) * rata) / 1000;
      etaTeks = `± ${fmtWaktu(sisaDetik)}`;
    }
    $("#eta").textContent = `ETA: ${etaTeks}`;

    if ($("#kartu").classList.contains("kecil")) {
      $("#kepala .judul").innerHTML = `Shopee Scraper [${selesai}/${bisa}] (${persen}%)`;
    } else {
      $("#kepala .judul").innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>Shopee Scraper`;
    }

    const label = { antri: "Antri", proses: "Proses…", ok: "Sukses", gagal: "Gagal", nolink: "Tanpa Link" };
    $("#daftar").innerHTML =
      items
        .map((i) => {
          const deskInfo = i.deskripsi ? `📝 ${i.deskripsi.length} huruf` : "⚠ tanpa deskripsi";
          const gbrInfo = `📷 ${i.gambar ? i.gambar.length : 0} gbr`;
          const vidInfo = i.video ? `🎬 Video` : `🎬 –`;
          const rateInfo = i.rating ? `⭐ ${i.rating}` : `⭐ –`;
          const revInfo = (i.ulasan && i.ulasan.length) ? `💬 ${i.ulasan.length} Ulasan` : (i.reviewKritis ? `💬 Ada Ulasan` : `💬 –`);
          const gbrUlasanInfo = (i.gambarUlasan && i.gambarUlasan.length) ? ` • 📸 ${i.gambarUlasan.length} foto ulasan` : "";
          const meta =
            i.status === "ok"
              ? `${rateInfo} • ${revInfo} • ${vidInfo} • ${gbrInfo}${gbrUlasanInfo}`
              : esc(i.error || i.harga || i.komisi || (i.url ? "Siap diambil" : "Link produk tidak terbaca"));
          return `
          <div class="item">
            ${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy">` : `<img alt="">`}
            <div class="tx">
              <div class="nm" title="${esc(i.nama)}">${esc(i.nama || i.url || "(tanpa judul)")}</div>
              <div class="mt">${meta}</div>
            </div>
            <span class="pil ${i.status}">${label[i.status] || i.status}</span>
          </div>`;
        })
        .join("") ||
      `<div class="item" style="color:#868e96;justify-content:center;padding:16px;">Belum ada produk di antrian. Klik 'Kumpulkan Produk' atau 'Import CSV'!</div>`;

    const sibuk = mode !== "idle";
    if ($("#mulaiSemua")) $("#mulaiSemua").disabled = sibuk;
    $("#kumpulSaja").disabled = sibuk;
    $("#ambilSaja").disabled = sibuk || !items.some((i) => i.status === "antri" && i.url);
    $("#jeda").disabled = mode !== "ambil";
    $("#jeda").textContent = jeda ? "▶ Lanjut" : "⏸ Jeda";
    $("#stop").disabled = !sibuk;
    $("#csv").disabled = $("#json").disabled = $("#img").disabled = $("#salinFormat").disabled = !items.length;
    if ($("#btnUnduhVideo")) {
      $("#btnUnduhVideo").disabled = !items.some((i) => i.status === "ok" && i.video);
    }
    $("#hapus").disabled = sibuk || !items.length;
  };

  // ---------- Penerima Data Main-World (React & API Shopee) ----------
  window.addEventListener("SAS_MAIN_DATA", (ev) => {
    const list = ev.detail;
    if (!Array.isArray(list) || !list.length) return;

    let diperbaiki = 0;
    let baru = 0;

    list.forEach((p) => {
      if (!p || !p.itemId) return;
      const url = p.url || `https://shopee.co.id/product/${p.shopId || "0"}/${p.itemId}`;

      // Cek apakah item ini sudah ada di antrian (cocokkan via itemId, nama, atau thumb)
      const itemAda = items.find(
        (it) =>
          it.key === p.itemId ||
          it.id === p.itemId ||
          (p.nama && it.nama && (it.nama.includes(p.nama.slice(0, 20)) || p.nama.includes(it.nama.slice(0, 20)))) ||
          (p.thumb && it.thumb && (it.thumb.includes(p.thumb.slice(-25)) || p.thumb.includes(it.thumb.slice(-25))))
      );

      if (itemAda) {
        if (!itemAda.url || itemAda.status === "nolink") {
          itemAda.id = p.itemId;
          itemAda.shopId = p.shopId || itemAda.shopId || "0";
          itemAda.url = url;
          itemAda.nama = itemAda.nama || p.nama;
          itemAda.harga = itemAda.harga || p.harga;
          itemAda.thumb = itemAda.thumb || p.thumb;
          itemAda.komisi = itemAda.komisi || p.komisi;
          itemAda.status = "antri";
          itemAda.error = "";
          diperbaiki++;
        }
      } else {
        items.push({
          key: p.itemId,
          id: p.itemId,
          shopId: p.shopId || "0",
          url: url,
          nama: p.nama,
          harga: p.harga,
          komisi: p.komisi,
          terjual: "",
          thumb: p.thumb,
          status: "antri",
          deskripsi: "",
          gambar: [],
          video: "",
          rating: "",
          error: "",
          gambarUlasan: [],
        });
        baru++;
      }
    });

    if (diperbaiki > 0 || baru > 0) {
      log(`⚡ React Scan: ${diperbaiki} link berhasil diperbaiki, ${baru} produk baru ditambahkan.`);
      render();
      simpan();
    }
  });

  function picuScanReact() {
    const s = document.createElement("script");
    s.textContent = `if (window.__sasScanProduk) window.__sasScanProduk();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  // ---------- Parser Link & Item ID ----------
  function parseProduk(teks) {
    if (!teks) return null;
    let s = String(teks);
    try { s = decodeURIComponent(s); } catch (e) {}

    let m = s.match(/shopee\.co\.id\/product\/(\d+)\/(\d+)/i);
    if (m) return { shopId: m[1], itemId: m[2], url: `https://shopee.co.id/product/${m[1]}/${m[2]}` };

    m = s.match(/-i\.(\d+)\.(\d+)/i);
    if (m) return { shopId: m[1], itemId: m[2], url: `https://shopee.co.id/product/${m[1]}/${m[2]}` };

    m = s.match(/\/product\/(\d+)\/(\d+)/i);
    if (m) return { shopId: m[1], itemId: m[2], url: `https://shopee.co.id/product/${m[1]}/${m[2]}` };

    const mItem = s.match(/[?&](?:item_id|itemId|itemid)=(\d+)/i);
    const mShop = s.match(/[?&](?:shop_id|shopId|shopid)=(\d+)/i);
    if (mItem) {
      const itemId = mItem[1];
      const shopId = mShop ? mShop[1] : "0";
      return { shopId, itemId, url: `https://shopee.co.id/product/${shopId}/${itemId}` };
    }

    const mShort = s.match(/https?:\/\/(?:s\.shopee\.co\.id|shope\.ee)\/[a-zA-Z0-9_-]+/i);
    if (mShort) return { shopId: "", itemId: mShort[0], url: mShort[0] };

    const mAttr = s.match(/(?:item_id|itemId|data-item-id|data-key)["':=\s]+(\d{6,})/i);
    if (mAttr) {
      const itemId = mAttr[1];
      const mShopAttr = s.match(/(?:shop_id|shopId|data-shop-id)["':=\s]+(\d+)/i);
      const shopId = mShopAttr ? mShopAttr[1] : "0";
      return { shopId, itemId, url: `https://shopee.co.id/product/${shopId}/${itemId}` };
    }

    return null;
  }

  // ---------- Scroll Helper ----------
  async function scrollSemua(aktif) {
    const wadah = [document.scrollingElement || document.documentElement];
    document.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 60) {
        wadah.push(el);
      }
    });
    for (let i = 0; i < 4 && aktif(); i++) {
      wadah.forEach((el) => el.scrollBy({ top: 600, behavior: "smooth" }));
      await sleep(500, 800);
    }
  }

  // ---------- Deteksi & Pengumpulan Kartu Produk ----------
  function urlGambarDariKartu(kartu) {
    const imgs = Array.from(kartu.querySelectorAll("img"))
      .map((im) => ({
        u: im.currentSrc || im.src || im.getAttribute("data-src") || (im.srcset || "").split(" ")[0] || "",
        luas: (im.naturalWidth || im.clientWidth || 0) * (im.naturalHeight || im.clientHeight || 0),
      }))
      .filter((x) => /^https?:/.test(x.u))
      .sort((x, y) => y.luas - x.luas);

    if (imgs.length && imgs[0].luas >= 3000) return imgs[0].u;

    let terbaik = "", luasMax = 0;
    kartu.querySelectorAll("*").forEach((el) => {
      const m = (getComputedStyle(el).backgroundImage || "").match(/url\(["']?(https?:[^"')]+)["']?\)/);
      if (m) {
        const luas = el.clientWidth * el.clientHeight;
        if (luas > luasMax) {
          luasMax = luas;
          terbaik = m[1];
        }
      }
    });
    return terbaik || (imgs[0] ? imgs[0].u : "");
  }

  function kumpulSemuaProdukHalaman() {
    let baru = 0;
    const ada = new Set(items.map((i) => i.key));

    // Picu scan React di main world
    picuScanReact();

    const imgs = Array.from(document.querySelectorAll("img")).filter((im) => {
      const src = im.currentSrc || im.src || im.getAttribute("data-src") || "";
      return /img\.susercontent\.com|cf\.shopee\.co\.id|\/file\//.test(src);
    });

    imgs.forEach((im) => {
      let kartu = im.parentElement;
      let depth = 0;
      while (kartu && depth < 8) {
        const teks = kartu.innerText || "";
        const adaHarga = /Rp\s?[\d.]+/i.test(teks);
        const adaJudul = teks.length > 15;
        if (adaHarga && adaJudul) break;
        kartu = kartu.parentElement;
        depth++;
      }
      if (!kartu) return;

      let p = null;
      let wadah = kartu;
      for (let k = 0; k < 3 && wadah && !p; k++) {
        const hrefs = Array.from(wadah.querySelectorAll("a[href]")).map((a) => a.href);
        for (const h of hrefs) {
          p = parseProduk(h);
          if (p) break;
        }
        if (!p && wadah.closest("a[href]")) {
          p = parseProduk(wadah.closest("a[href]").href);
        }
        if (!p) {
          p = parseProduk(wadah.outerHTML);
        }
        wadah = wadah.parentElement;
      }

      const thumb = urlGambarDariKartu(kartu).split("?")[0].replace(/_tn$/, "");
      const baris = (kartu.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
      const nama =
        baris
          .filter(
            (x) =>
              x.length > 8 &&
              !/^Rp/i.test(x) &&
              !/komisi/i.test(x) &&
              !/terjual/i.test(x) &&
              !/buat link|dapatkan|salin|pilih semua/i.test(x)
          )
          .sort((x, y) => y.length - x.length)[0] || "";

      const harga = baris.find((x) => /^Rp/i.test(x)) || "";
      const iKom = baris.findIndex((x) => /komisi/i.test(x));
      const komisi =
        iKom >= 0 ? (/\d/.test(baris[iKom]) ? baris[iKom] : `${baris[iKom]} ${baris[iKom + 1] || ""}`).trim() : "";
      const terjual = baris.find((x) => /terjual/i.test(x)) || "";

      const key = p ? p.itemId : thumb || nama;
      if (!key || ada.has(key)) return;
      ada.add(key);

      items.push({
        key,
        id: p?.itemId || "",
        shopId: p?.shopId || "",
        url: p?.url || (p?.itemId ? `https://shopee.co.id/product/${p.shopId || "0"}/${p.itemId}` : ""),
        nama,
        harga,
        komisi,
        terjual,
        thumb,
        status: p ? "antri" : "nolink",
        deskripsi: "",
        gambar: [],
        rating: "",
        error: p ? "" : "Menunggu link produk...",
      });
      baru++;
    });

    log(`Produk ditemukan: ${baru} kartu.`);
    return baru;
  }

  function halamanBerikutnya() {
    const sel = [
      "li.ant-pagination-next:not(.ant-pagination-disabled)",
      "li.ant-pagination-next:not(.ant-pagination-disabled) button",
      ".ant-pagination-next:not(.ant-pagination-disabled)",
      "button.shopee-pager__button-next",
      ".shopee-icon-button--right",
      '[aria-label="Next"]',
      '[aria-label="next"]',
      '[aria-label="Halaman berikutnya"]',
      ".shopee-mini-page-controller__next-btn",
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (
        el &&
        !el.disabled &&
        !el.classList.contains("disabled") &&
        el.getAttribute("aria-disabled") !== "true"
      ) {
        return el;
      }
    }
    return null;
  }

  async function kumpulkan(otomatis = false) {
    if (mode !== "idle") return;
    bacaForm();
    mode = "kumpul";
    stop = false;
    render();
    setStatus(`🔍 Mengumpulkan produk (Target: ${set.target})...`);
    log(`Mulai mengumpulkan produk (target ${set.target})…`);

    for (let hal = 1; hal <= 40 && !stop; hal++) {
      setStatus(`Halaman ${hal}: Membaca produk...`);
      await scrollSemua(() => !stop);
      await sleep(600, 1000);
      if (stop) break;

      kumpulSemuaProdukHalaman();
      render();
      simpan();

      await sleep(1000);
      render();

      if (items.filter((i) => i.url).length >= set.target) break;

      const next = halamanBerikutnya();
      if (!next) {
        log("Halaman terakhir tercapai.");
        break;
      }
      next.click();
      await sleep(2000, 3500);
    }

    if (items.length > set.target) items.length = set.target;
    mode = "idle";
    render();
    simpan();

    const siapAmbil = items.filter((i) => i.url).length;
    if (!siapAmbil) {
      setStatus("⚠️ Link produk belum terbaca. Coba klik 'Scan Ulang' atau scroll halaman.");
      log("Menunggu link produk terisi dari Shopee.");
    } else {
      setStatus(`✅ Selesai: ${siapAmbil} produk siap diekstrak.`);
      log(`Total ${siapAmbil} produk siap diproses.`);
    }
  }

  function tambahDariLink() {
    const baris = $("#linkmanual")
      .value.split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x));

    const ada = new Set(items.map((i) => i.key));
    let baru = 0;

    baris.forEach((u) => {
      const p = parseProduk(u);
      const key = p ? p.itemId : u;
      if (ada.has(key)) return;
      ada.add(key);
      items.push({
        key,
        id: p?.itemId || "",
        shopId: p?.shopId || "",
        url: p ? p.url : u,
        nama: "",
        harga: "",
        komisi: "",
        terjual: "",
        thumb: "",
        status: "antri",
        deskripsi: "",
        gambar: [],
        video: "",
        rating: "",
        error: "",
        gambarUlasan: [],
      });
      baru++;
    });

    $("#linkmanual").value = "";
    log(`${baru} tautan ditambahkan ke antrian.`);
    render();
    simpan();
  }

  // ---------- Import File CSV Shopee Affiliate ----------
  function parseCsvKeBaris(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const firstLine = text.split(/\r?\n/)[0] || "";
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";

    const rows = [];
    let curRow = [];
    let curCell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"') {
        if (inQuotes && next === '"') {
          curCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        curRow.push(curCell.trim());
        curCell = "";
      } else if ((c === "\r" || c === "\n") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        curRow.push(curCell.trim());
        if (curRow.some((cell) => cell.length > 0)) {
          rows.push(curRow);
        }
        curRow = [];
        curCell = "";
      } else {
        curCell += c;
      }
    }
    if (curCell.length > 0 || curRow.length > 0) {
      curRow.push(curCell.trim());
      if (curRow.some((cell) => cell.length > 0)) {
        rows.push(curRow);
      }
    }
    return rows;
  }

  function imporDataDariTeksCsv(rawText, fileName) {
    const rows = parseCsvKeBaris(rawText);
    if (!rows.length) {
      alert("File CSV tidak memiliki isi / kosong.");
      return;
    }

    const header = rows[0].map((h) => h.toLowerCase());
    let urlIdx = -1, nameIdx = -1, priceIdx = -1, commIdx = -1, idIdx = -1;

    header.forEach((h, idx) => {
      if (/link|url|tautan|shortlink|offer/i.test(h) && urlIdx === -1) urlIdx = idx;
      if (/name|nama|judul|title|product/i.test(h) && nameIdx === -1) nameIdx = idx;
      if (/price|harga/i.test(h) && priceIdx === -1) priceIdx = idx;
      if (/commission|komisi/i.test(h) && commIdx === -1) commIdx = idx;
      if (/item_id|itemid|goods_id|product_id/i.test(h) && idIdx === -1) idIdx = idx;
    });

    const startRow = (urlIdx !== -1 || nameIdx !== -1) ? 1 : 0;
    if (startRow === 1) {
      csvHeadersOriginal = rows[0];
    }
    let ditambah = 0;
    let diduplikasi = 0;

    const regexUrl = /https?:\/\/(?:[a-zA-Z0-9-]+\.)?shopee\.co\.id\/[^\s"',;]+|https?:\/\/(?:s\.shopee\.co\.id|shope\.ee)\/[a-zA-Z0-9_-]+/gi;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      let targetUrl = "";
      let targetNama = nameIdx !== -1 ? row[nameIdx] : "";
      let targetHarga = priceIdx !== -1 ? row[priceIdx] : "";
      let targetKomisi = commIdx !== -1 ? row[commIdx] : "";
      let targetId = idIdx !== -1 ? row[idIdx] : "";

      if (urlIdx !== -1 && row[urlIdx]) {
        const m = row[urlIdx].match(regexUrl);
        if (m) targetUrl = m[0];
        else if (row[urlIdx].startsWith("http")) targetUrl = row[urlIdx];
      }

      if (!targetUrl) {
        for (const cell of row) {
          const m = String(cell || "").match(regexUrl);
          if (m) {
            targetUrl = m[0];
            break;
          }
        }
      }

      if (!targetUrl) continue;

      const p = parseProduk(targetUrl);
      const key = (p && p.itemId) ? p.itemId : targetUrl;

      const sudahAda = items.some((it) => it.key === key || it.url === targetUrl);
      if (sudahAda) {
        diduplikasi++;
        continue;
      }

      items.push({
        key,
        id: (p && p.itemId) ? p.itemId : targetId,
        shopId: (p && p.shopId) ? p.shopId : "0",
        url: targetUrl,
        nama: targetNama,
        harga: targetHarga,
        komisi: targetKomisi,
        terjual: "",
        thumb: "",
        status: "antri",
        deskripsi: "",
        gambar: [],
        video: "",
        rating: "",
        error: "",
        originalRow: [...row],
        gambarUlasan: [],
      });
      ditambah++;
    }

    if (ditambah === 0) {
      alert(`Tidak ada link produk baru yang ditemukan dari ${fileName}.${diduplikasi > 0 ? ` (${diduplikasi} produk sudah ada di antrian).` : ""}`);
    } else {
      log(`📥 Berhasil import ${ditambah} link produk dari CSV (${fileName})!${diduplikasi > 0 ? ` (${diduplikasi} duplikat diabaikan)` : ""}`);
      setStatus(`Import CSV Berhasil: ${ditambah} produk ditambahkan ke antrian.`);
      render();
      simpan();
    }
  }

  function prosesImportCsv(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (!text || typeof text !== "string") {
          alert("File CSV kosong atau tidak terbaca.");
          return;
        }
        imporDataDariTeksCsv(text, file.name);
      } catch (err) {
        alert("Gagal membaca file CSV: " + err.message);
      }
    };
    reader.onerror = () => alert("Gagal membuka file.");
    reader.readAsText(file, "UTF-8");
  }

  // ---------- Ekstraksi Detail Produk ----------
  const kirimBackground = async (pesan) => {
    try {
      return await chrome.runtime.sendMessage(pesan);
    } catch (e) {
      return { ok: false, error: "Koneksi ke ekstensi putus. Silakan refresh halaman (F5)." };
    }
  };

  async function tungguDenganCountdown(detik, label) {
    for (let s = Math.ceil(detik); s > 0; s--) {
      if (stop) return;
      while (jeda && !stop) {
        setStatus("⏸ Sedang Dijeda");
        setCountdown("Klik ▶ Lanjut untuk meneruskan...");
        await sleep(300);
      }
      if (stop) return;
      setCountdown(`⏳ ${label} ${s} detik...`);
      await sleep(1000);
    }
    setCountdown("");
  }

  async function mulaiAmbil() {
    if (mode !== "idle") return;
    bacaForm();

    if (!set.deskripsi && !set.gambar && !set.video) {
      alert("Centang minimal salah satu: Deskripsi, Gambar, atau Video.");
      return;
    }

    picuScanReact();
    await sleep(600);

    const antrian = items.filter((i) => i.status !== "ok" && i.url);
    if (!antrian.length) {
      setStatus("Belum ada link produk yang siap. Klik '1-Klik Scrape' atau 'Import CSV'!");
      log("Antrian kosong atau link belum terisi. Jalankan kumpulkan ulang atau import CSV.");
      return;
    }

    mode = "ambil";
    stop = false;
    jeda = false;
    siklus = [];
    log(`Mulai ekstraksi detail ${antrian.length} produk (Jeda: ${set.jedaMin}-${set.jedaMax} dtk)...`);

    const opsi = {
      deskripsi: set.deskripsi,
      gambar: set.gambar,
      video: set.video,
      ulasan: set.ulasan,
      gambarUlasan: set.gambarUlasan,
      maksGambarUlasan: set.maksGambarUlasan || 30,
      spesifikasi: set.spesifikasi,
      maksGambar: set.maksGambar,
      latar: set.latar,
    };

    let n = 0;

    for (const it of antrian) {
      if (stop) break;
      const t0 = Date.now();
      it.status = "proses";
      it.error = "";

      setStatus(`Mengambil (${n + 1}/${antrian.length}): ${(it.nama || it.url).slice(0, 40)}`);
      render();

      const r = await kirimBackground({ type: "scrape", url: it.url, opsi });
      if (r?.ok && r.data) {
        const d = r.data;
        it.nama = d.nama || it.nama;
        it.harga = d.harga || it.harga;
        it.terjual = d.terjual || it.terjual;
        it.rating = d.rating || it.rating;
        it.deskripsi = d.deskripsi || "";
        it.gambar = d.gambar || [];
        it.video = d.video || it.video || "";
        it.reviewKritis = d.reviewKritis || "";
        it.reviewPositif = d.reviewPositif || "";
        it.ulasan = d.ulasan || [];
        it.gambarUlasan = d.gambarUlasan || [];
        it.spesifikasi = d.spesifikasi || "";

        const p = parseProduk(d.urlAkhir);
        if (p) {
          it.id = p.itemId;
          it.shopId = p.shopId;
        }
        if (!it.thumb && it.gambar[0]) it.thumb = it.gambar[0] + "_tn";

        const dapatDeskripsi = set.deskripsi ? !!it.deskripsi : true;
        const dapatGambar = set.gambar ? it.gambar.length > 0 : true;
        const dapatVideo = set.video ? !!it.video : true;

        if (!dapatDeskripsi && !dapatGambar && !dapatVideo) {
          it.status = "gagal";
          it.error = "Data kosong (coba matikan opsi tab latar belakang)";
        } else {
          it.status = "ok";
          const catatan = [];
          if (set.deskripsi && !it.deskripsi) catatan.push("tanpa deskripsi");
          if (set.gambar && !it.gambar.length) catatan.push("tanpa gambar");
          if (set.video && !it.video) catatan.push("tanpa video");
          if (catatan.length) it.error = catatan.join(", ");
        }
      } else {
        it.status = "gagal";
        it.error = r?.error || "Gagal membuka tab produk";
      }

      if (it.status === "gagal") {
        log(`❌ Gagal: ${(it.nama || it.url).slice(0, 35)} — ${it.error}`);
      } else {
        const jmlUlasan = (it.ulasan && it.ulasan.length) ? `${it.ulasan.length} ulasan` : (it.reviewKritis ? 'ada ulasan' : 'tanpa ulasan');
        const infoGbrUlasan = (it.gambarUlasan && it.gambarUlasan.length) ? `, 📸 ${it.gambarUlasan.length} foto ulasan` : '';
        log(`✅ Sukses: ${(it.nama || it.url).slice(0, 30)} (⭐${it.rating || '-'}, ${jmlUlasan}${infoGbrUlasan}, ${it.video ? '1 video' : 'tanpa vid'})`);
      }

      n++;
      siklus.push(Date.now() - t0);
      simpan();
      render();

      if (stop) break;

      const sisaAntri = items.some((i) => i.status === "antri" && i.url);
      if (sisaAntri) {
        if (set.istirahatTiap > 0 && n % set.istirahatTiap === 0 && set.istirahatDetik > 0) {
          log(`Istirahat santai ${set.istirahatDetik} detik (sudah ${n} produk)...`);
          await tungguDenganCountdown(set.istirahatDetik, "Istirahat santai berkala:");
        }

        const delayDetik = set.jedaMin + Math.random() * (set.jedaMax - set.jedaMin);
        await tungguDenganCountdown(delayDetik, "Jeda santai sebelum produk berikutnya:");
      }
    }

    items.forEach((i) => {
      if (i.status === "proses") i.status = "antri";
    });

    const c = hitung();
    setStatus(stop ? "Dihentikan oleh pengguna." : `Selesai: ${c.ok} sukses, ${c.gagal} gagal.`);
    setCountdown("");
    log(stop ? "Ekstraksi dihentikan." : "Semua antrian selesai diproses.");
    mode = "idle";
    jeda = false;
    stop = false;
    render();
    simpan();
  }

  // 1-KLIK GABUNGAN: KUMPULKAN LALU LANGSUNG AMBIL
  async function jalankan1Klik() {
    if (mode !== "idle") return;
    await kumpulkan(true);
    picuScanReact();
    await sleep(1200);
    if (items.some((i) => i.status === "antri" && i.url)) {
      await mulaiAmbil();
    }
  }

  // ---------- Ekspor Data ----------
  const unduhBlob = (isi, nama, tipe) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([isi], { type: tipe }));
    a.download = nama;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const capWaktu = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

  function unduhCsv() {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const baris = [];

    // Jika antrian berasal dari import CSV Shopee Affiliate:
    // Kolom asli tetap dipertahankan utuh + ditambah Link Video, Link Gambar 1-6, Deskripsi, Rating, Terjual, Ulasan, Spesifikasi
    if (csvHeadersOriginal && Array.isArray(csvHeadersOriginal) && csvHeadersOriginal.length > 0) {
      const kepalaBaru = [
        ...csvHeadersOriginal,
        "Link Video",
        "Link Gambar 1",
        "Link Gambar 2",
        "Link Gambar 3",
        "Link Gambar 4",
        "Link Gambar 5",
        "Link Gambar 6",
        "Deskripsi Lengkap",
        "Rating",
        "Terjual",
        "Review Kritis (Bintang 3-4)",
        "Review Bukti (Bintang 5)",
        "Spesifikasi",
        "Gambar Ulasan (JSON)"
      ];
      baris.push(kepalaBaru.map(q).join(","));

      items.forEach((i) => {
        const rowAsli = Array.isArray(i.originalRow) ? [...i.originalRow] : [];
        while (rowAsli.length < csvHeadersOriginal.length) rowAsli.push("");

        const vidLink = i.video || "";
        const imgLink1 = (i.gambar && i.gambar[0]) || "";
        const imgLink2 = (i.gambar && i.gambar[1]) || "";
        const imgLink3 = (i.gambar && i.gambar[2]) || "";
        const imgLink4 = (i.gambar && i.gambar[3]) || "";
        const imgLink5 = (i.gambar && i.gambar[4]) || "";
        const imgLink6 = (i.gambar && i.gambar[5]) || "";
        const desk = i.deskripsi || "";
        const rating = i.rating || "";
        const terjual = i.terjual || "";
        const revKritis = i.reviewKritis || "";
        const revPositif = i.reviewPositif || "";
        const spek = i.spesifikasi || "";
        const gbrUlasanJson = JSON.stringify(i.gambarUlasan || []);

        baris.push([...rowAsli, vidLink, imgLink1, imgLink2, imgLink3, imgLink4, imgLink5, imgLink6, desk, rating, terjual, revKritis, revPositif, spek, gbrUlasanJson].map(q).join(","));
      });
    } else {
      // Jika diinput manual tanpa CSV awal
      const kepala = [
        "No",
        "ID Produk",
        "Nama Produk",
        "Harga",
        "Rating",
        "Terjual",
        "Komisi",
        "Link Produk",
        "Link Video",
        "Link Gambar 1",
        "Link Gambar 2",
        "Link Gambar 3",
        "Link Gambar 4",
        "Link Gambar 5",
        "Link Gambar 6",
        "Review Kritis (Bintang 3-4)",
        "Review Bukti (Bintang 5)",
        "Spesifikasi",
        "Deskripsi Lengkap",
        "Status",
        "Gambar Ulasan (JSON)",
      ];
      baris.push(kepala.map(q).join(","));

      items.forEach((i, idx) => {
        baris.push(
          [
            idx + 1,
            i.id || "",
            i.nama || "",
            i.harga || "",
            i.rating || "",
            i.terjual || "",
            i.komisi || "",
            i.url || "",
            i.video || "",
            (i.gambar && i.gambar[0]) || "",
            (i.gambar && i.gambar[1]) || "",
            (i.gambar && i.gambar[2]) || "",
            (i.gambar && i.gambar[3]) || "",
            (i.gambar && i.gambar[4]) || "",
            (i.gambar && i.gambar[5]) || "",
            i.reviewKritis || "",
            i.reviewPositif || "",
            i.spesifikasi || "",
            i.deskripsi || "",
            i.status || "",
            JSON.stringify(i.gambarUlasan || []),
          ]
            .map(q)
            .join(",")
        );
      });
    }

    unduhBlob("\ufeff" + baris.join("\r\n"), `produk_shopee_enriched_${capWaktu()}.csv`, "text/csv;charset=utf-8");
    log(`CSV Baru diunduh (${items.length} baris dengan Video, Gambar, Ulasan & Spesifikasi).`);
  }

  function unduhJson() {
    unduhBlob(JSON.stringify(items, null, 2), `produk_shopee_${capWaktu()}.json`, "application/json");
    log(`JSON diunduh (${items.length} produk).`);
  }

  async function unduhSemuaGambar() {
    const bersihkanNama = (s) =>
      String(s || "")
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 40) || "produk";

    const daftar = [];
    items
      .filter((i) => i.status === "ok")
      .forEach((i) => {
        const folder = `ShopeeAffiliate/${i.id || i.key}_${bersihkanNama(i.nama)}`;
        i.gambar.forEach((u, idx) => {
          daftar.push({
            url: u,
            filename: `${folder}/${String(idx + 1).padStart(2, "0")}.jpg`,
          });
        });
      });

    if (!daftar.length) {
      alert("Belum ada produk dengan status Sukses yang memiliki gambar.");
      return;
    }

    if (!confirm(`Unduh ${daftar.length} gambar ke folder Downloads/ShopeeAffiliate ?`)) return;
    log(`Mengunduh ${daftar.length} gambar di latar belakang...`);
    await kirimBackground({ type: "dl-images", daftar });
  }

  async function unduhSemuaVideo() {
    const bersihkanNama = (s) =>
      String(s || "")
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 40) || "produk";

    const daftar = [];
    items
      .filter((i) => i.status === "ok" && i.video)
      .forEach((i) => {
        const folder = `ShopeeAffiliate/${i.id || i.key}_${bersihkanNama(i.nama)}`;
        daftar.push({
          url: i.video,
          filename: `${folder}/video.mp4`,
        });
      });

    if (!daftar.length) {
      alert("Belum ada produk berstatus Sukses yang memiliki video.");
      return;
    }

    if (!confirm(`Unduh ${daftar.length} video produk ke folder Downloads/ShopeeAffiliate ?`)) return;
    log(`Mengunduh ${daftar.length} video produk di latar belakang...`);
    await kirimBackground({ type: "dl-videos", daftar });
  }

  function salinFormatBot() {
    const sukses = items.filter((i) => i.status === "ok");
    if (!sukses.length) {
      alert("Belum ada produk yang berstatus Sukses.");
      return;
    }

    const teks = sukses
      .map((i, idx) => {
        return `[PRODUK ${idx + 1}]
Judul: ${i.nama}
Harga: ${i.harga}
Rating: ${i.rating || "-"} | Terjual: ${i.terjual || "-"}
Link: ${i.url}

Review Kritis (Bahan Hook & Batasan Masalah):
${i.reviewKritis || "-"}

Review Bukti (Bahan Solusi & Testimoni):
${i.reviewPositif || "-"}

Spesifikasi:
${i.spesifikasi || "-"}

Deskripsi:
${i.deskripsi ? i.deskripsi.slice(0, 400) + (i.deskripsi.length > 400 ? "..." : "") : "-"}

Video Asli:
${i.video || "-"}

Gambar Katalog:
${(i.gambar && i.gambar.length ? i.gambar.slice(0, 6) : []).join("\n") || "-"}

Foto Ulasan Pembeli (UGC):
${i.gambarUlasan && i.gambarUlasan.length ? `${i.gambarUlasan.length} foto ulasan tersimpan di CSV` : "-"}
----------------------------------------`;
      })
      .join("\n\n");

    navigator.clipboard.writeText(teks).then(() => {
      alert(`Berhasil menyalin ${sukses.length} produk ke clipboard! Siap ditempel di bot/sosmed.`);
      log(`${sukses.length} produk disalin ke clipboard.`);
    }).catch(() => {
      log("Gagal menyalin ke clipboard.");
    });
  }

  // ---------- Fitur Tab Link Massal ----------
  function cariTeks(teksTarget, selector = "*") {
    const hasil = [];
    document.querySelectorAll(selector).forEach((el) => {
      const t = (el.innerText || "").trim();
      if (t && t.includes(teksTarget)) hasil.push(el);
    });
    return hasil.filter((el) => !hasil.some((o) => o !== el && el.contains(o)))[0] || null;
  }

  const bacaJumlahMassal = () => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*(\d+)\s*Tinjauan/i);
    return m ? { dipilih: parseInt(m[1], 10), maks: parseInt(m[2], 10) } : null;
  };

  function klikPilihSemua() {
    const label = cariTeks("Pilih semua produk di halaman ini");
    if (!label) return false;
    const kotak =
      label.querySelector('input[type="checkbox"]') ||
      label.closest("label")?.querySelector('input[type="checkbox"]') ||
      label.parentElement?.querySelector('input[type="checkbox"]');
    if (kotak) {
      if (!kotak.checked) kotak.click();
      return true;
    }
    label.click();
    return true;
  }

  function klikBuatLinkMassal() {
    const el = cariTeks("Buat Link Massal", "button, div, span");
    if (!el) return false;
    (el.closest("button") || el).click();
    return true;
  }

  async function mulaiMassal() {
    if (mode !== "idle") return;
    mode = "massal";
    stop = false;
    render();
    const target = Math.min(100, parseInt($("#targetMassal").value, 10) || 100);
    log(`Pilih massal otomatis: target ${target} produk.`);

    for (let hal = 1; !stop && hal <= 30; hal++) {
      log(`Halaman ${hal}: memuat produk…`);
      await scrollSemua(() => !stop);
      await sleep(1000, 2000);
      if (stop) break;

      const sebelum = bacaJumlahMassal()?.dipilih ?? 0;
      if (!klikPilihSemua()) {
        log("Tombol 'Pilih semua' tidak ditemukan. Berhenti.");
        break;
      }
      await sleep(1200, 2500);

      const sesudah = bacaJumlahMassal();
      if (!sesudah) {
        log("Counter tidak terbaca. Berhenti.");
        break;
      }
      log(`Terpilih: ${sesudah.dipilih} / ${sesudah.maks}`);
      if (sesudah.dipilih >= target) break;
      if (sesudah.dipilih === sebelum) {
        log("Jumlah tidak bertambah, lanjut buat link.");
        break;
      }

      const next = halamanBerikutnya();
      if (!next) {
        log("Tidak ada halaman berikutnya.");
        break;
      }
      next.click();
      await sleep(2000, 4000);
    }

    if (!stop) {
      await sleep(1000, 2000);
      log(
        klikBuatLinkMassal()
          ? "Tombol Buat Link Massal diklik. Lanjutkan di popup Shopee."
          : "Tombol Buat Link Massal tidak ditemukan / belum aktif."
      );
    } else {
      log("Dihentikan.");
    }
    mode = "idle";
    stop = false;
    render();
  }

  // ---------- Event Listeners ----------
  root.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      root.querySelectorAll(".tab").forEach((x) => x.classList.toggle("aktif", x === b));
      $("#tab-scraper").hidden = b.dataset.tab !== "scraper";
      $("#tab-ekspor").hidden = b.dataset.tab !== "ekspor";
      $("#tab-massal").hidden = b.dataset.tab !== "massal";
    })
  );

  $("#min").onclick = () => {
    $("#kartu").classList.toggle("kecil");
    render();
  };
  $("#tutup").onclick = () => {
    host.style.display = "none";
  };

  if ($("#mulaiSemua")) $("#mulaiSemua").onclick = jalankan1Klik;
  $("#kumpulSaja").onclick = () => kumpulkan(false);
  $("#ambilSaja").onclick = mulaiAmbil;
  $("#tambahManual").onclick = tambahDariLink;

  $("#jeda").onclick = () => {
    jeda = !jeda;
    if (!jeda) setStatus("Melanjutkan ekstraksi…");
    render();
  };
  $("#stop").onclick = () => {
    stop = true;
    jeda = false;
    setStatus("Menghentikan antrian…");
  };

  $("#csv").onclick = unduhCsv;
  $("#json").onclick = unduhJson;
  $("#img").onclick = unduhSemuaGambar;
  if ($("#btnUnduhVideo")) $("#btnUnduhVideo").onclick = unduhSemuaVideo;
  if ($("#btnPilihCsv")) $("#btnPilihCsv").onclick = () => $("#fileCsv").click();
  if ($("#fileCsv")) {
    $("#fileCsv").onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) {
        prosesImportCsv(f);
        e.target.value = "";
      }
    };
  }
  $("#salinFormat").onclick = salinFormatBot;
  $("#hapus").onclick = () => {
    if (!confirm("Hapus semua data produk yang ada di antrian?")) return;
    items = [];
    csvHeadersOriginal = null;
    siklus = [];
    setStatus("Data dibersihkan.");
    render();
    simpan();
  };

  $("#mulaiMassal").onclick = mulaiMassal;
  $("#stopMassal").onclick = () => {
    stop = true;
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggle") {
      host.style.display = host.style.display === "none" ? "" : "none";
    }
    if (msg?.type === "info") {
      log(msg.text);
    }
  });

  // ---------- Mulai Pertama Kali ----------
  muat().then(() => {
    isiForm();
    render();
    if (items.length) {
      log(`Data tersimpan: ${items.length} produk. Memperbaiki link via React...`);
      picuScanReact();
    }
  });
})();
