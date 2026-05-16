/* =====================================================================
   js/financial-pdf.js  —  Phase 19c.4a
   ---------------------------------------------------------------------
   Branded, CRA-audit-grade PDF generator for invoices / receipts /
   paycheques.  Uses jsPDF (loaded lazily on first call) so it adds
   zero weight to admin pages that never touch the financials screen.

   Public surface, mounted on `window.pmPDF`:
     pmPDF.renderInvoice(invoiceObj)   → Promise<{ blob, dataUrl, filename }>
     pmPDF.renderReceipt(receiptObj)   → Promise<{ blob, dataUrl, filename }>
     pmPDF.renderPaycheque(paychequeObj) → Promise<{ blob, dataUrl, filename }>
     pmPDF.downloadDoc(docDescriptor)  → downloads a freshly-rendered PDF
       where docDescriptor = { docType: 'invoice'|'receipt'|'paycheque', docId, prefetched? }

   Shape contract (what each render function expects):
     invoice   = result of pmHiring.adminGetInvoice(invoiceId)
     receipt   = result of pmHiring.adminGetReceipt(receiptId)
     paycheque = result of pmHiring.adminGetPaycheque(paychequeId)

   Notes:
   - All money formatting locked to en-CA / CAD by default; the doc's
     currency field is honoured when present.
   - The PDF is drawn with native jsPDF primitives (not html2canvas) so
     output is crisp text, deterministic across browsers, and small
     enough to e-mail as an attachment.
   - The PM logo is loaded once and cached; failure falls back to a
     text-only wordmark so the PDF still renders if the asset is gone.
   ===================================================================== */
(function () {
  'use strict';

  // ─── CDN endpoints (kept here so they're easy to bump) ────────────
  const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  const LOGO_URL  = 'assets/logos/pm-logo.png';

  // ─── Business identity (single source of truth for the brand bar) ─
  const BIZ = {
    name:    'Private Mentorship',
    tagline: 'Family-first academic & life mentorship',
    email:   'caleb@privatementorship.com',
    web:     'privatementorship.ca',
    addr1:   'Vancouver, British Columbia',
    addr2:   'Canada',
  };

  // ─── Brand palette (matches admin UI tokens) ──────────────────────
  const COLOR = {
    ink:    [17, 24, 39],     // #111827
    ink2:   [31, 41, 55],     // #1f2937
    mute:   [107, 114, 128],  // #6b7280
    tert:   [156, 163, 175],  // #9ca3af
    line:   [229, 231, 235],  // #e5e7eb
    soft:   [243, 244, 246],  // #f3f4f6
    brand:  [37, 99, 235],    // #2563eb
    paid:   [22, 163, 74],    // #16a34a
    danger: [220, 38, 38],    // #dc2626
    amber:  [217, 119, 6],    // #d97706
  };

  let _jspdfPromise = null;
  let _logoPromise  = null;

  // ─────────────────────────────────────────────────────────────────
  // Lazy loaders
  // ─────────────────────────────────────────────────────────────────
  function loadJsPDF() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (_jspdfPromise) return _jspdfPromise;
    _jspdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.async = true;
      s.onload  = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF loaded but global missing'));
      s.onerror = () => reject(new Error('Failed to load jsPDF from CDN'));
      document.head.appendChild(s);
    });
    return _jspdfPromise;
  }

  function loadLogoDataUrl() {
    if (_logoPromise) return _logoPromise;
    _logoPromise = fetch(LOGO_URL, { cache: 'force-cache' })
      .then(r => r.ok ? r.blob() : Promise.reject(new Error('logo fetch ' + r.status)))
      .then(blob => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(fr.result);
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      }))
      .catch(err => { console.warn('[financial-pdf] logo unavailable:', err); return null; });
    return _logoPromise;
  }

  // ─────────────────────────────────────────────────────────────────
  // Money + date helpers (treat numeric and *_cents columns uniformly)
  // ─────────────────────────────────────────────────────────────────
  function cents(n) { return Math.round((Number(n) || 0)); }
  function dollarsToCents(n) { return Math.round((Number(n) || 0) * 100); }
  function fmtMoney(c, ccy) {
    const n = (Number(c) || 0) / 100;
    return n.toLocaleString('en-CA', {
      style: 'currency', currency: (ccy || 'CAD').toUpperCase(),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function fmtDate(v) {
    if (!v) return '—';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    const dt = new Date(v);
    if (isNaN(dt)) return '—';
    return dt.toLocaleString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ─────────────────────────────────────────────────────────────────
  // Low-level page-painter (shared across all 3 templates)
  // ─────────────────────────────────────────────────────────────────
  function makeCanvas(jsPDFCtor) {
    // Letter size (US/CA standard), portrait, points (1pt = 1/72in)
    // 8.5" × 11"  =>  612 × 792 pt
    const doc = new jsPDFCtor({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    return doc;
  }

  function setFill(doc, rgb)   { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
  function setStroke(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
  function setText(doc, rgb)   { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

  async function paintHeader(doc, kind, docNumber, statusLabel, statusColor) {
    // Brand bar (white card with subtle bottom rule)
    const W = doc.internal.pageSize.getWidth();
    const logoData = await loadLogoDataUrl();

    // Logo block (44pt square) — top-left
    if (logoData) {
      try { doc.addImage(logoData, 'PNG', 48, 44, 44, 44); }
      catch (e) { console.warn('addImage failed', e); }
    }

    // Business name & tagline
    setText(doc, COLOR.ink2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(BIZ.name, 104, 60);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLOR.mute);
    doc.text(BIZ.tagline, 104, 74);
    doc.text(BIZ.web + ' · ' + BIZ.email, 104, 86);

    // Doc-kind block (top-right)
    setText(doc, COLOR.ink2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    const kindLabel = String(kind || '').toUpperCase();
    const kindW = doc.getTextWidth(kindLabel);
    doc.text(kindLabel, W - 48 - kindW, 62);

    // Doc number (monospaced look via helvetica + tight tracking)
    setText(doc, COLOR.mute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const numStr = '# ' + (docNumber || '—');
    const numW = doc.getTextWidth(numStr);
    doc.text(numStr, W - 48 - numW, 80);

    // Status pill
    if (statusLabel) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      const pillText = String(statusLabel).toUpperCase();
      const pillTextW = doc.getTextWidth(pillText);
      const pillW = pillTextW + 16;
      const pillH = 16;
      const pillX = W - 48 - pillW;
      const pillY = 90;
      setFill(doc, statusColor || COLOR.brand);
      doc.roundedRect(pillX, pillY, pillW, pillH, 4, 4, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(pillText, pillX + 8, pillY + 11);
    }

    // Hairline under header
    setStroke(doc, COLOR.line);
    doc.setLineWidth(0.5);
    doc.line(48, 122, W - 48, 122);
  }

  function paintFooter(doc, docNumber) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    setStroke(doc, COLOR.line);
    doc.setLineWidth(0.5);
    doc.line(48, H - 60, W - 48, H - 60);

    setText(doc, COLOR.tert);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const leftLine  = `${BIZ.name}  ·  ${BIZ.email}  ·  ${BIZ.web}`;
    const rightLine = `${docNumber || ''}  ·  Generated ${fmtDateTime(new Date())}`;
    doc.text(leftLine, 48, H - 44);
    const rightW = doc.getTextWidth(rightLine);
    doc.text(rightLine, W - 48 - rightW, H - 44);
    doc.text('CRA-compliant business record  ·  Retain for tax purposes', 48, H - 30);
  }

  // Two-column party block
  function paintParties(doc, leftLabel, leftLines, rightLabel, rightLines, yStart) {
    const W = doc.internal.pageSize.getWidth();
    let y = yStart;

    // Left column label
    setText(doc, COLOR.tert);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(leftLabel.toUpperCase(), 48, y);

    // Right column label
    setText(doc, COLOR.tert);
    doc.text(rightLabel.toUpperCase(), W / 2 + 24, y);

    y += 14;

    // Left column content
    setText(doc, COLOR.ink2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(leftLines[0] || '—', 48, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setText(doc, COLOR.mute);
    let ly = y + 14;
    for (let i = 1; i < leftLines.length; i++) {
      if (leftLines[i]) { doc.text(String(leftLines[i]), 48, ly); ly += 12; }
    }

    // Right column content
    setText(doc, COLOR.ink2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(rightLines[0] || '—', W / 2 + 24, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setText(doc, COLOR.mute);
    let ry = y + 14;
    for (let i = 1; i < rightLines.length; i++) {
      if (rightLines[i]) { doc.text(String(rightLines[i]), W / 2 + 24, ry); ry += 12; }
    }

    return Math.max(ly, ry) + 8;
  }

  // Line-item table.  cols: [{ key, label, w, align?, monetary? }]
  // rows: array of objects keyed by `key`
  function paintTable(doc, cols, rows, yStart, opts = {}) {
    const W = doc.internal.pageSize.getWidth();
    const x0 = 48;
    const innerW = W - 96;
    const padX = 10;
    const headH = 22;
    const rowH = 22;

    // Compute absolute column x positions
    const widths = cols.map(c => Math.round(innerW * c.w));
    // Round-off correction so last col reaches the right edge
    widths[widths.length - 1] = innerW - widths.slice(0, -1).reduce((a, b) => a + b, 0);

    // Header bar
    setFill(doc, COLOR.soft);
    doc.rect(x0, yStart, innerW, headH, 'F');
    setStroke(doc, COLOR.line);
    doc.setLineWidth(0.5);
    doc.rect(x0, yStart, innerW, headH, 'S');

    setText(doc, COLOR.tert);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    let cx = x0;
    cols.forEach((c, i) => {
      const label = c.label.toUpperCase();
      if (c.align === 'right') {
        const tw = doc.getTextWidth(label);
        doc.text(label, cx + widths[i] - padX - tw, yStart + 14);
      } else {
        doc.text(label, cx + padX, yStart + 14);
      }
      cx += widths[i];
    });

    // Rows
    let y = yStart + headH;
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    rows.forEach((row, ri) => {
      // Alternating subtle band (off by default; line-only is cleaner)
      // Row bottom rule
      setStroke(doc, COLOR.line);
      doc.setLineWidth(0.3);
      cx = x0;
      cols.forEach((c, i) => {
        let v = row[c.key];
        if (c.monetary) v = fmtMoney(v, row._ccy || 'CAD');
        if (v == null) v = '';
        v = String(v);
        // Truncate over-long description
        if (c.align !== 'right' && v.length > 60) v = v.slice(0, 57) + '…';
        if (c.align === 'right') {
          setText(doc, c.bold ? COLOR.ink2 : COLOR.ink);
          if (c.bold) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal');
          const tw = doc.getTextWidth(v);
          doc.text(v, cx + widths[i] - padX - tw, y + 14);
          doc.setFont('helvetica', 'normal');
          setText(doc, COLOR.ink);
        } else {
          doc.text(v, cx + padX, y + 14);
        }
        cx += widths[i];
      });
      y += rowH;
      doc.line(x0, y, x0 + innerW, y);
    });

    return y + 4;
  }

  // Right-aligned totals stack
  function paintTotals(doc, rows, yStart) {
    const W = doc.internal.pageSize.getWidth();
    const labelX = W - 48 - 200;
    const valueX = W - 48;
    let y = yStart + 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    rows.forEach((r, i) => {
      const isLast = i === rows.length - 1;
      const bold = isLast || r.bold;

      // Hairline above the final total
      if (isLast) {
        setStroke(doc, COLOR.line);
        doc.setLineWidth(0.5);
        doc.line(labelX, y - 6, valueX, y - 6);
      }

      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      setText(doc, bold ? COLOR.ink2 : COLOR.mute);
      doc.text(r.label, labelX, y + 6);

      setText(doc, r.color || (bold ? COLOR.ink2 : COLOR.ink));
      const v = r.monetary ? fmtMoney(r.value, r.ccy) : String(r.value);
      const tw = doc.getTextWidth(v);
      doc.text(v, valueX - tw, y + 6);
      y += 16;
    });

    return y + 6;
  }

  // Notes block (label + body, soft-card background)
  function paintNotesBlock(doc, label, body, yStart) {
    if (!body) return yStart;
    const W = doc.internal.pageSize.getWidth();
    const innerW = W - 96;
    const padX = 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setText(doc, COLOR.ink);
    const lines = doc.splitTextToSize(String(body), innerW - padX * 2);
    const h = 24 + lines.length * 12 + 8;

    setFill(doc, COLOR.soft);
    doc.roundedRect(48, yStart, innerW, h, 6, 6, 'F');

    setText(doc, COLOR.tert);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), 48 + padX, yStart + 16);

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(lines, 48 + padX, yStart + 32);

    return yStart + h + 10;
  }

  // ─────────────────────────────────────────────────────────────────
  // Template: Invoice
  // ─────────────────────────────────────────────────────────────────
  async function renderInvoice(inv) {
    if (!inv) throw new Error('renderInvoice: missing invoice');
    const jsPDFCtor = await loadJsPDF();
    const doc = makeCanvas(jsPDFCtor);

    const ccy = (inv.currency || 'CAD').toUpperCase();
    const status = String(inv.status || 'open').toLowerCase();
    const statusColor =
      status === 'paid'  ? COLOR.paid  :
      status === 'void'  ? COLOR.danger :
      status === 'open'  ? COLOR.amber  : COLOR.brand;

    await paintHeader(doc, 'Invoice', inv.invoice_number, status, statusColor);

    // Bill-to + dates
    const client = inv.clients || {};
    const partyName = client.full_name || inv.party_name || '—';
    const dueY = paintParties(doc,
      'Bill to',
      [partyName, client.email || '', ''],
      'Details',
      [
        '',
        'Issued:    ' + fmtDate(inv.invoice_date),
        'Due:       ' + fmtDate(inv.due_date),
        inv.subject ? 'Subject:   ' + inv.subject : null,
      ].filter(Boolean),
      150
    );

    // Lines table
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const lineRows = lines.length ? lines.map(l => ({
      _ccy: ccy,
      description: l.description || '—',
      qty: (Number(l.quantity) || 0).toFixed(Number.isInteger(+l.quantity) ? 0 : 2),
      unit: dollarsToCents(l.unit_price),
      total: dollarsToCents(l.line_total != null ? l.line_total : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)),
    })) : [{ _ccy: ccy, description: '(no line items recorded)', qty: '', unit: 0, total: 0 }];

    const afterTable = paintTable(doc, [
      { key: 'description', label: 'Description', w: 0.58 },
      { key: 'qty',         label: 'Qty',         w: 0.10, align: 'right' },
      { key: 'unit',        label: 'Unit price',  w: 0.16, align: 'right', monetary: true },
      { key: 'total',       label: 'Line total',  w: 0.16, align: 'right', monetary: true, bold: true },
    ], lineRows, dueY + 6);

    // Totals — invoice columns are in cents already
    const total   = Number(inv.total_cents)        || 0;
    const paid    = Number(inv.amount_paid_cents)  || 0;
    const balance = Number(inv.balance_due_cents)  || (total - paid);
    const subtotal = total; // taxes not modelled yet

    const afterTotals = paintTotals(doc, [
      { label: 'Subtotal',   value: subtotal, ccy, monetary: true },
      { label: 'Amount paid', value: paid,    ccy, monetary: true },
      { label: 'Balance due', value: balance, ccy, monetary: true,
        color: balance > 0 ? COLOR.danger : COLOR.paid },
    ], afterTable + 4);

    // Customer-facing notes
    let nextY = afterTotals + 6;
    if (inv.customer_notes) nextY = paintNotesBlock(doc, 'Notes to customer', inv.customer_notes, nextY);
    if (inv.terms)          nextY = paintNotesBlock(doc, 'Terms',            inv.terms,          nextY);

    // Receipts ledger (if any payments recorded)
    if (Array.isArray(inv.receipts) && inv.receipts.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      setText(doc, COLOR.tert);
      doc.text('PAYMENTS APPLIED', 48, nextY + 14);
      nextY += 20;
      nextY = paintTable(doc, [
        { key: 'num',  label: 'Receipt',  w: 0.22 },
        { key: 'date', label: 'Date',     w: 0.22 },
        { key: 'mode', label: 'Method',   w: 0.22 },
        { key: 'ref',  label: 'Reference', w: 0.18 },
        { key: 'amt',  label: 'Amount',   w: 0.16, align: 'right', monetary: true, bold: true },
      ], inv.receipts.map(r => ({
        _ccy: ccy,
        num: r.receipt_number || '—',
        date: fmtDate(r.receipt_date),
        mode: titleCase(r.payment_mode || '—'),
        ref:  r.reference || '—',
        amt:  dollarsToCents(r.total_amount),
      })), nextY);
    }

    // Pay-by block (only if there's still a balance)
    if (balance > 0 && status !== 'void') {
      const payH = 56;
      const W = doc.internal.pageSize.getWidth();
      const innerW = W - 96;
      const payY = nextY + 6;
      setFill(doc, [239, 246, 255]); // soft blue
      doc.roundedRect(48, payY, innerW, payH, 8, 8, 'F');
      setText(doc, COLOR.brand);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('HOW TO PAY', 60, payY + 16);
      setText(doc, COLOR.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('E-transfer to ' + BIZ.email, 60, payY + 32);
      doc.text('Auto-deposit enabled — no security question required.', 60, payY + 46);
    }

    paintFooter(doc, inv.invoice_number);

    const blob = doc.output('blob');
    const dataUrl = doc.output('datauristring');
    return { blob, dataUrl, filename: `${inv.invoice_number || 'invoice'}.pdf` };
  }

  // ─────────────────────────────────────────────────────────────────
  // Template: Receipt
  // ─────────────────────────────────────────────────────────────────
  async function renderReceipt(rec) {
    if (!rec) throw new Error('renderReceipt: missing receipt');
    const jsPDFCtor = await loadJsPDF();
    const doc = makeCanvas(jsPDFCtor);

    const ccy = 'CAD'; // sales_receipts has no currency column; assume CAD
    const status = rec.voided_at ? 'void' : 'paid';
    const statusColor = rec.voided_at ? COLOR.danger : COLOR.paid;

    await paintHeader(doc, 'Receipt', rec.receipt_number, status, statusColor);

    const client = rec.clients || {};
    const invoice = rec.invoices || {};
    const dueY = paintParties(doc,
      'Received from',
      [client.full_name || '—', client.email || '', ''],
      'Details',
      [
        '',
        'Received: ' + fmtDate(rec.receipt_date),
        invoice.invoice_number ? 'Invoice:  ' + invoice.invoice_number : null,
        rec.payment_mode ? 'Method:   ' + titleCase(rec.payment_mode) : null,
        rec.reference   ? 'Ref:      ' + rec.reference : null,
      ].filter(Boolean),
      150
    );

    const lines = Array.isArray(rec.lines) ? rec.lines : [];
    const rows = lines.length ? lines.map(l => ({
      _ccy: ccy,
      description: l.description || '—',
      qty: (Number(l.quantity) || 0).toFixed(Number.isInteger(+l.quantity) ? 0 : 2),
      unit: dollarsToCents(l.unit_price),
      total: dollarsToCents(l.line_total != null ? l.line_total : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)),
    })) : [{ _ccy: ccy, description: 'Payment received on invoice', qty: '1', unit: dollarsToCents(rec.total_amount), total: dollarsToCents(rec.total_amount) }];

    const afterTable = paintTable(doc, [
      { key: 'description', label: 'Description', w: 0.58 },
      { key: 'qty',         label: 'Qty',         w: 0.10, align: 'right' },
      { key: 'unit',        label: 'Unit price',  w: 0.16, align: 'right', monetary: true },
      { key: 'total',       label: 'Line total',  w: 0.16, align: 'right', monetary: true, bold: true },
    ], rows, dueY + 6);

    const total = dollarsToCents(rec.total_amount);
    const afterTotals = paintTotals(doc, [
      { label: 'Subtotal',      value: total, ccy, monetary: true },
      { label: 'Amount received', value: total, ccy, monetary: true, color: COLOR.paid },
    ], afterTable + 4);

    let nextY = afterTotals + 6;
    if (rec.customer_notes) nextY = paintNotesBlock(doc, 'Notes to customer', rec.customer_notes, nextY);
    if (rec.notes)          nextY = paintNotesBlock(doc, 'Internal notes',    rec.notes,          nextY);

    // Thank-you block
    const W = doc.internal.pageSize.getWidth();
    const innerW = W - 96;
    const thankY = nextY + 6;
    setFill(doc, [240, 253, 244]); // soft green
    doc.roundedRect(48, thankY, innerW, 44, 8, 8, 'F');
    setText(doc, COLOR.paid);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Thank you for your payment.', 60, thankY + 20);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('This receipt confirms the amount above was received in full.', 60, thankY + 34);

    paintFooter(doc, rec.receipt_number);
    const blob = doc.output('blob');
    const dataUrl = doc.output('datauristring');
    return { blob, dataUrl, filename: `${rec.receipt_number || 'receipt'}.pdf` };
  }

  // ─────────────────────────────────────────────────────────────────
  // Template: Paycheque
  // ─────────────────────────────────────────────────────────────────
  async function renderPaycheque(pay) {
    if (!pay) throw new Error('renderPaycheque: missing paycheque');
    const jsPDFCtor = await loadJsPDF();
    const doc = makeCanvas(jsPDFCtor);

    const ccy = (pay.currency || 'CAD').toUpperCase();
    const status = String(pay.status || 'issued').toLowerCase();
    const statusColor =
      status === 'paid'     ? COLOR.paid   :
      status === 'void'     ? COLOR.danger :
      status === 'reissued' ? COLOR.mute   : COLOR.brand;

    await paintHeader(doc, 'Paycheque', pay.paycheque_number, status, statusColor);

    const dueY = paintParties(doc,
      'Paid to',
      [pay.assistant_name || 'Assistant', '', ''],
      'Pay period',
      [
        '',
        'Pay date:    ' + fmtDate(pay.pay_date),
        (pay.period_start || pay.period_end) ? 'Period:      ' + fmtDate(pay.period_start) + '  →  ' + fmtDate(pay.period_end) : null,
        pay.payment_mode ? 'Method:      ' + titleCase(pay.payment_mode) : null,
        pay.reference    ? 'Ref:         ' + pay.reference : null,
      ].filter(Boolean),
      150
    );

    const lines = Array.isArray(pay.lines) ? pay.lines : [];
    const rows = lines.length ? lines.map(l => ({
      _ccy: ccy,
      description: l.description || '—',
      hours: (Number(l.hours) || 0).toFixed(2),
      rate:  Number(l.hourly_rate_cents) || 0,
      total: Number(l.line_total_cents)  || 0,
    })) : [{
      _ccy: ccy,
      description: 'Wages',
      hours: (Number(pay.hours_worked) || 0).toFixed(2),
      rate: Number(pay.hourly_rate_cents) || 0,
      total: Number(pay.gross_cents) || 0,
    }];

    const afterTable = paintTable(doc, [
      { key: 'description', label: 'Description', w: 0.56 },
      { key: 'hours',       label: 'Hours',       w: 0.12, align: 'right' },
      { key: 'rate',        label: 'Rate / hr',   w: 0.16, align: 'right', monetary: true },
      { key: 'total',       label: 'Line total',  w: 0.16, align: 'right', monetary: true, bold: true },
    ], rows, dueY + 6);

    const gross = Number(pay.gross_cents) || 0;
    const ded   = Number(pay.deductions_cents) || 0;
    const net   = Number(pay.net_cents) || (gross - ded);

    const afterTotals = paintTotals(doc, [
      { label: 'Gross pay',  value: gross, ccy, monetary: true },
      { label: 'Deductions', value: ded,   ccy, monetary: true },
      { label: 'Net pay',    value: net,   ccy, monetary: true, color: COLOR.paid },
    ], afterTable + 4);

    let nextY = afterTotals + 6;
    if (pay.notes) nextY = paintNotesBlock(doc, 'Notes', pay.notes, nextY);

    // T4A reminder block
    const W = doc.internal.pageSize.getWidth();
    const innerW = W - 96;
    const tY = nextY + 6;
    setFill(doc, [254, 252, 232]); // soft amber
    doc.roundedRect(48, tY, innerW, 46, 8, 8, 'F');
    setText(doc, COLOR.amber);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TAX RECORD', 60, tY + 18);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Retain this paycheque for your records. T4A slips are issued annually in February.', 60, tY + 34);

    paintFooter(doc, pay.paycheque_number);
    const blob = doc.output('blob');
    const dataUrl = doc.output('datauristring');
    return { blob, dataUrl, filename: `${pay.paycheque_number || 'paycheque'}.pdf` };
  }

  // ─────────────────────────────────────────────────────────────────
  // Convenience: download a single document by descriptor
  // ─────────────────────────────────────────────────────────────────
  async function downloadDoc(desc) {
    const { docType, docId, prefetched } = desc || {};
    if (!docType || !docId) throw new Error('downloadDoc: docType and docId required');

    let payload = prefetched;
    if (!payload) {
      if (docType === 'invoice')   payload = await window.pmHiring.adminGetInvoice(docId);
      else if (docType === 'receipt')   payload = await window.pmHiring.adminGetReceipt(docId);
      else if (docType === 'paycheque') payload = await window.pmHiring.adminGetPaycheque(docId);
      else throw new Error('downloadDoc: unknown docType ' + docType);
    }
    if (!payload) throw new Error('downloadDoc: document not found');

    let out;
    if (docType === 'invoice')        out = await renderInvoice(payload);
    else if (docType === 'receipt')   out = await renderReceipt(payload);
    else                              out = await renderPaycheque(payload);

    // Trigger browser download
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  // Convenience: open a fresh PDF in a new tab (used by Preview)
  // ─────────────────────────────────────────────────────────────────
  async function openDoc(desc) {
    const out = await buildDoc(desc);
    const url = URL.createObjectURL(out.blob);
    window.open(url, '_blank', 'noopener');
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  // Convenience: build a PDF and return { blob, dataUrl, filename, payload }
  // (used by both the preview modal and the email composer)
  // ─────────────────────────────────────────────────────────────────
  async function buildDoc(desc) {
    const { docType, docId, prefetched } = desc || {};
    if (!docType || !docId) throw new Error('buildDoc: docType and docId required');

    let payload = prefetched;
    if (!payload) {
      if (docType === 'invoice')        payload = await window.pmHiring.adminGetInvoice(docId);
      else if (docType === 'receipt')   payload = await window.pmHiring.adminGetReceipt(docId);
      else if (docType === 'paycheque') payload = await window.pmHiring.adminGetPaycheque(docId);
      else throw new Error('buildDoc: unknown docType ' + docType);
    }
    if (!payload) throw new Error('buildDoc: document not found');

    let out;
    if (docType === 'invoice')        out = await renderInvoice(payload);
    else if (docType === 'receipt')   out = await renderReceipt(payload);
    else                              out = await renderPaycheque(payload);
    return { ...out, payload };
  }

  // ─── Export ────────────────────────────────────────────────────────
  window.pmPDF = {
    renderInvoice, renderReceipt, renderPaycheque,
    buildDoc, downloadDoc, openDoc,
    // Exposed for the composer modal
    BIZ,
  };
})();
