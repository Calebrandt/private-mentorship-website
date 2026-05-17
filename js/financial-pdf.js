/* =====================================================================
   js/financial-pdf.js  —  Phase 19c.4k (rebuild)
   ---------------------------------------------------------------------
   Renders branded, CRA-audit-grade PDFs for invoices, receipts, and
   paycheques. Templates live in financial-pdf-templates.js (window.pmPDFTemplates).

   PIPELINE
   1. Build the HTML for the doc (premium app-matching template).
   2. Mount it offscreen so html2canvas can capture it pixel-perfect.
   3. Wait for fonts (Cinzel + Inter) and assets (logo + signature) to
      load so the capture doesn't snap a half-rendered frame.
   4. html2canvas → high-DPI bitmap.
   5. jsPDF → A4 page, embed the bitmap, output Blob.

   Public surface (mounted on window.pmPDF):
     pmPDF.renderInvoice(invoiceObj)   → Promise<{ blob, dataUrl, filename }>
     pmPDF.renderReceipt(receiptObj)   → ...
     pmPDF.renderPaycheque(paychequeObj) → ...
     pmPDF.buildDoc({docType, docId, prefetched?}) → { blob, dataUrl, filename, payload }
     pmPDF.downloadDoc(desc)   → triggers a browser download
     pmPDF.openDoc(desc)       → opens PDF in a new tab

   Notes:
   - Output is bitmap-text PDF (not vector). Slightly larger file but
     pixel-perfect to the premium HTML template. Trade chosen consciously.
   - Each render is ~120-300 KB (well under the 10 MB email cap).
   - html2canvas, jsPDF, and the Google Fonts CSS are lazy-loaded on
     first call so admin pages that never open Financials pay nothing.
   ===================================================================== */
(function () {
  'use strict';

  const JSPDF_URL       = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const HTML2CANVAS_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const FONTS_HREF      =
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Montserrat:wght@300;400;500;600;700&display=swap';

  let _jspdfPromise = null;
  let _h2cPromise   = null;
  let _fontsPromise = null;

  // ─── Lazy loaders ─────────────────────────────────────────────────
  function _injectScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  function loadJsPDF() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (_jspdfPromise) return _jspdfPromise;
    _jspdfPromise = _injectScript(JSPDF_URL).then(() => {
      if (!window.jspdf?.jsPDF) throw new Error('jsPDF loaded but global missing');
      return window.jspdf.jsPDF;
    });
    return _jspdfPromise;
  }
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = _injectScript(HTML2CANVAS_URL).then(() => {
      if (!window.html2canvas) throw new Error('html2canvas loaded but global missing');
      return window.html2canvas;
    });
    return _h2cPromise;
  }
  function loadFonts() {
    if (_fontsPromise) return _fontsPromise;
    _fontsPromise = new Promise((resolve) => {
      // Inject the Google Fonts stylesheet once
      if (!document.querySelector(`link[href="${FONTS_HREF}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = FONTS_HREF;
        document.head.appendChild(l);
      }
      // Wait for the FontFaceSet to settle — falls back to a 1s nap
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => resolve()).catch(() => resolve());
      } else {
        setTimeout(resolve, 1000);
      }
    });
    return _fontsPromise;
  }

  // ─── Render any HTML string to a PDF Blob ─────────────────────────
  async function renderHtmlToPdf(html, filename) {
    const [jsPDFCtor, h2c] = await Promise.all([loadJsPDF(), loadHtml2Canvas(), loadFonts()]);

    // Mount the HTML offscreen
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;';
    // We need just the <body> contents — strip the surrounding html doc so
    // the page CSS doesn't conflict with the admin shell.
    const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyInner = m ? m[1] : html;
    // We also need the inline <style> block — copy it into the host
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (styleMatch) {
      const styleEl = document.createElement('style');
      // Scope nothing — the host is offscreen and contains only our markup
      styleEl.textContent = styleMatch[1];
      host.appendChild(styleEl);
    }
    const content = document.createElement('div');
    content.innerHTML = bodyInner;
    host.appendChild(content);
    document.body.appendChild(host);

    try {
      // Pre-load images so html2canvas captures them
      const imgs = Array.from(host.querySelectorAll('img'));
      await Promise.all(imgs.map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load',  resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          // Safety timeout — never block forever
          setTimeout(resolve, 4000);
        });
      }));

      // Capture the rendered .page element
      const pageEl = host.querySelector('.page') || content;

      const canvas = await h2c(pageEl, {
        scale: 2,                       // 2x for crisp output
        useCORS: true,                  // honor crossorigin="anonymous" on logo + signature
        allowTaint: false,
        backgroundColor: '#ffffff',
        windowWidth: 794,
        logging: false,
      });

      // Compose the PDF — A4 portrait. We scale the captured bitmap to
      // fit the page width exactly so margins look identical to the design.
      const pdf = new jsPDFCtor({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();  // 595.28pt
      const pageH = pdf.internal.pageSize.getHeight(); // 841.89pt

      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;

      // If the captured doc is taller than one A4 page, paginate.
      let y = 0;
      let remaining = imgH;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      if (imgH <= pageH) {
        pdf.addImage(dataUrl, 'JPEG', 0, 0, imgW, imgH, undefined, 'FAST');
      } else {
        // Multi-page: re-slice the bitmap and add multiple pages
        // (rare for our docs — A4 is generous — but defensive)
        const sliceH = (pageH * canvas.width) / imgW; // source-pixel height per page
        let srcY = 0;
        while (srcY < canvas.height) {
          const thisSliceH = Math.min(sliceH, canvas.height - srcY);
          const tmp = document.createElement('canvas');
          tmp.width = canvas.width;
          tmp.height = thisSliceH;
          tmp.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, thisSliceH, 0, 0, canvas.width, thisSliceH);
          const sliceData = tmp.toDataURL('image/jpeg', 0.92);
          if (srcY > 0) pdf.addPage();
          pdf.addImage(sliceData, 'JPEG', 0, 0, imgW, (thisSliceH * imgW) / canvas.width, undefined, 'FAST');
          srcY += thisSliceH;
        }
      }

      const blob = pdf.output('blob');
      const outDataUrl = pdf.output('datauristring');
      return { blob, dataUrl: outDataUrl, filename };
    } finally {
      // Always clean up — host is offscreen but takes DOM space
      document.body.removeChild(host);
    }
  }

  // ─── Per-doc-type render helpers ──────────────────────────────────
  async function renderInvoice(inv) {
    if (!inv) throw new Error('renderInvoice: missing invoice');
    if (!window.pmPDFTemplates) throw new Error('pmPDFTemplates not loaded — include js/financial-pdf-templates.js');
    const html = window.pmPDFTemplates.buildInvoiceHtml(inv);
    const filename = `${inv.invoice_number || 'invoice'}.pdf`;
    return renderHtmlToPdf(html, filename);
  }
  async function renderReceipt(rec) {
    if (!rec) throw new Error('renderReceipt: missing receipt');
    if (!window.pmPDFTemplates) throw new Error('pmPDFTemplates not loaded — include js/financial-pdf-templates.js');
    const html = window.pmPDFTemplates.buildReceiptHtml(rec);
    const filename = `${rec.receipt_number || 'receipt'}.pdf`;
    return renderHtmlToPdf(html, filename);
  }
  async function renderPaycheque(pay) {
    if (!pay) throw new Error('renderPaycheque: missing paycheque');
    if (!window.pmPDFTemplates) throw new Error('pmPDFTemplates not loaded — include js/financial-pdf-templates.js');
    const html = window.pmPDFTemplates.buildPaychequeHtml(pay);
    const filename = `${pay.paycheque_number || 'paycheque'}.pdf`;
    return renderHtmlToPdf(html, filename);
  }
  async function renderStatement(stmt) {
    if (!stmt) throw new Error('renderStatement: missing statement');
    if (!window.pmPDFTemplates) throw new Error('pmPDFTemplates not loaded — include js/financial-pdf-templates.js');
    const html = window.pmPDFTemplates.buildStatementHtml(stmt);
    const safeName = (stmt.client?.full_name || 'client').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const dateStr = (stmt.generated_at || new Date().toISOString()).slice(0, 10);
    const filename = `statement_${safeName}_${dateStr}.pdf`;
    return renderHtmlToPdf(html, filename);
  }

  // ─── Convenience: fetch + build + return blob/payload ─────────────
  async function buildDoc(desc) {
    const { docType, docId, prefetched } = desc || {};
    if (!docType || !docId) throw new Error('buildDoc: docType and docId required');

    let payload = prefetched;
    if (!payload) {
      if (docType === 'invoice')        payload = await window.pmHiring.adminGetInvoice(docId);
      else if (docType === 'receipt')   payload = await window.pmHiring.adminGetReceipt(docId);
      else if (docType === 'paycheque') payload = await window.pmHiring.adminGetPaycheque(docId);
      else if (docType === 'statement') payload = await window.pmHiring.adminGetClientStatement(docId, desc.statementOpts || {});
      else throw new Error('buildDoc: unknown docType ' + docType);
    }
    if (!payload) throw new Error('buildDoc: document not found');

    let out;
    if (docType === 'invoice')        out = await renderInvoice(payload);
    else if (docType === 'receipt')   out = await renderReceipt(payload);
    else if (docType === 'statement') out = await renderStatement(payload);
    else                              out = await renderPaycheque(payload);
    return { ...out, payload };
  }

  async function downloadDoc(desc) {
    const out = await buildDoc(desc);
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url; a.download = out.filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    return out;
  }
  async function openDoc(desc) {
    const out = await buildDoc(desc);
    const url = URL.createObjectURL(out.blob);
    window.open(url, '_blank', 'noopener');
    return out;
  }

  // ─── Export ───────────────────────────────────────────────────────
  window.pmPDF = {
    renderInvoice, renderReceipt, renderPaycheque, renderStatement,
    buildDoc, downloadDoc, openDoc,
    // For backwards-compatibility with the previous version's BIZ export
    BIZ: {
      name:    'Private Mentorship',
      email:   'billing@private-mentorship.com',
      web:     'privatementorship.ca',
    },
  };
})();
