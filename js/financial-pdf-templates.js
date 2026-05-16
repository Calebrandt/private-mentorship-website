/* =====================================================================
   js/financial-pdf-templates.js  —  Phase 19c.4l (heritage redesign)
   ---------------------------------------------------------------------
   HTML/CSS templates for invoice / receipt / paycheque PDFs.

   DESIGN PHILOSOPHY
   Heritage / law-firm aesthetic — the kind of document a chartered
   accountant produces: confident wordmark, generous whitespace,
   hairline rules instead of colored cards, monumental serif type for
   the brand, a real rotated rubber-stamp for PAID, and the signature
   block flush-right with the totals column the way a contract is
   signed.

   No cards, no pills, no shadows. The document signals quality through
   typography and restraint, not chrome.

   PALETTE
     Ink         #111111   (body text, headings)
     Soft ink    #525252   (labels, secondary)
     Mute        #8a8a8a   (footer text)
     Hairline    #d4d4d4   (rules, table dividers)
     Accent      #0d2240   (deep navy — section labels, key figures)
     Stamp red   #b91c1c   (PAID/VOID rubber stamp)
     Stamp grey  #525252   (REISSUED stamp)
     Paper       #ffffff
     Paper soft  #fbfaf7   (subtle warm paper tone behind line items)

   TYPOGRAPHY
     Cinzel 700           — wordmark, doc title, stamp ("PRIVATE MENTORSHIP", "INVOICE", "PAID")
     Cormorant Garamond   — section labels (Bill to, Description, Notes)
     Inter 400-700        — body, numbers, line items

   Public surface (window.pmPDFTemplates):
     buildInvoiceHtml(payload)   → string
     buildReceiptHtml(payload)   → string
     buildPaychequeHtml(payload) → string
   ===================================================================== */
(function () {
  'use strict';

  // ─── Brand assets (reused from the Supabase storage the app uses) ─
  const LOGO_URL =
    'https://llkicgphkvciumfzhbkk.supabase.co/storage/v1/object/public/branding/RecLogo.png';
  const SIGNATURE_URL =
    'https://llkicgphkvciumfzhbkk.supabase.co/storage/v1/object/public/receipt-assets/caleb_brandt_signature_transparent.png';

  const COMPANY_NAME    = 'Private Mentorship';
  const COMPANY_TAGLINE = 'Family-first academic & life mentorship';
  const COMPANY_ADDR_1  = 'Richmond, British Columbia';
  const COMPANY_ADDR_2  = 'Canada';
  const COMPANY_EMAIL   = 'billing@private-mentorship.com';
  const COMPANY_WEB     = 'private-mentorship.com';

  // ─── Helpers ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(c, ccy) {
    const n = (Number(c) || 0) / 100;
    return n.toLocaleString('en-CA', {
      style: 'currency', currency: (ccy || 'CAD').toUpperCase(),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function fmtDate(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    if (isNaN(dt)) return '';
    return dt.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtDateShort(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    if (isNaN(dt)) return '';
    return dt.toLocaleDateString('en-CA', { month: 'short', day: '2-digit', year: '2-digit' }).toUpperCase();
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ─── Stamp pack: what to show, what colour ────────────────────────
  function stampFor(status, docType) {
    const s = String(status || '').toLowerCase();
    if (s === 'paid') return { label: 'PAID',     color: '#0d2240', show: true };
    if (s === 'void') return { label: 'VOID',     color: '#b91c1c', show: true };
    if (s === 'reissued') return { label: 'REISSUED', color: '#525252', show: true };
    if (docType === 'receipt')   return { label: 'PAID', color: '#0d2240', show: true };
    if (docType === 'paycheque' && (s === 'issued' || s === 'paid')) return { label: 'ISSUED', color: '#0d2240', show: true };
    return { label: '', color: '', show: false };
  }

  // ─── Shared CSS — heritage typographic style ──────────────────────
  function sharedCss() {
    return `
    * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
    body { margin: 0; padding: 0;
           font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
           background: #f3f1ec; color: #111111; font-size: 12.5px; line-height: 1.5; }

    .page {
      width: 794px; min-height: 1100px; margin: 0 auto;
      background: #ffffff; position: relative;
      padding: 64px 72px 130px 72px;   /* generous margins, room for footer */
    }

    /* ── Top band: wordmark on left, invoice meta on right ───────── */
    .doc-top {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 36px; padding-bottom: 32px;
      border-bottom: 1px solid #d4d4d4;
    }
    .brand-block { flex: 1; }
    .brand-mark {
      display: flex; align-items: center; gap: 14px; margin-bottom: 14px;
    }
    .brand-mark img { height: 46px; width: auto; display: block; }
    .brand-name {
      font-family: 'Cinzel', 'Times New Roman', serif;
      font-weight: 700; font-size: 24px; letter-spacing: 0.14em;
      color: #111111; text-transform: uppercase; line-height: 1;
    }
    .brand-tagline {
      font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
      font-style: italic; font-size: 13px; color: #525252;
      margin-top: 4px; letter-spacing: 0.01em;
    }
    .brand-address {
      font-size: 11px; color: #525252; line-height: 1.55; margin-top: 12px;
    }

    .doc-id {
      text-align: right; min-width: 280px;
    }
    .doc-id-label {
      font-family: 'Cinzel', serif; font-weight: 700;
      font-size: 28px; letter-spacing: 0.14em;
      color: #111111; line-height: 1; margin-bottom: 18px;
    }
    .doc-id-table { width: 100%; border-collapse: collapse; }
    .doc-id-table td {
      font-size: 11.5px; padding: 4px 0; vertical-align: top;
      border-bottom: 1px solid #ececec;
    }
    .doc-id-table tr:last-child td { border-bottom: none; }
    .doc-id-table td:first-child {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-style: italic; font-size: 12px; color: #525252;
      text-align: left; padding-right: 16px;
    }
    .doc-id-table td:last-child {
      text-align: right; font-weight: 600; color: #111111;
      font-variant-numeric: tabular-nums; letter-spacing: 0.005em;
    }

    /* ── Bill to / parties section ───────────────────────────────── */
    .parties {
      display: flex; gap: 60px; padding-top: 28px; padding-bottom: 28px;
    }
    .party-col { flex: 1; }
    .party-label {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-weight: 700; font-style: italic;
      font-size: 13px; color: #0d2240; letter-spacing: 0.02em;
      margin-bottom: 8px;
    }
    .party-name {
      font-size: 17px; font-weight: 600; color: #111111; letter-spacing: -0.005em;
      margin-bottom: 4px;
    }
    .party-meta { font-size: 11.5px; color: #525252; line-height: 1.55; }

    /* ── Subject / terms inline strip ─────────────────────────────── */
    .doc-meta-strip {
      border-top: 1px solid #d4d4d4; border-bottom: 1px solid #d4d4d4;
      padding: 14px 0; display: flex; gap: 40px;
    }
    .doc-meta-cell { display: flex; gap: 10px; align-items: baseline; }
    .doc-meta-key {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-style: italic; font-size: 12px; color: #525252;
      text-transform: lowercase; letter-spacing: 0.04em;
    }
    .doc-meta-key::after { content: '·'; margin-left: 6px; color: #c4c4c4; }
    .doc-meta-val {
      font-size: 12.5px; font-weight: 500; color: #111111;
    }

    /* ── Items table — hairlines only, no cards ──────────────────── */
    .items {
      width: 100%; border-collapse: collapse; margin-top: 28px;
    }
    .items thead th {
      text-align: left;
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-weight: 700; font-style: italic; font-size: 12.5px;
      color: #0d2240; letter-spacing: 0.02em;
      padding: 0 0 10px 0;
      border-bottom: 1.5px solid #0d2240;
    }
    .items thead th.right { text-align: right; }
    .items thead th.center { text-align: center; }
    .items tbody td {
      padding: 14px 8px 14px 0;
      border-bottom: 1px solid #ececec;
      vertical-align: top;
      font-size: 12.5px;
    }
    .items tbody tr:last-child td { border-bottom: 1.5px solid #0d2240; }
    .items td.right { text-align: right; font-variant-numeric: tabular-nums; }
    .items td.center { text-align: center; }
    .items .it-desc { font-weight: 500; color: #111111; }
    .items .it-amt {
      font-weight: 600; color: #111111;
    }
    .it-idx { color: #8a8a8a; font-variant-numeric: tabular-nums;
              font-family: 'Inter', sans-serif; font-size: 11px; }
    .it-rate { color: #525252; font-variant-numeric: tabular-nums; }

    /* ── Totals block — right-aligned bank-statement stack ───────── */
    .totals-row {
      display: flex; justify-content: flex-end;
      margin-top: 22px;
    }
    .totals {
      min-width: 320px;
    }
    .totals .t-line {
      display: flex; justify-content: space-between;
      padding: 7px 0; font-size: 12.5px;
    }
    .totals .t-line.is-sub { border-bottom: 1px solid #ececec; }
    .totals .t-line .label {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-style: italic; font-size: 13px; color: #525252;
    }
    .totals .t-line .val {
      font-weight: 500; font-variant-numeric: tabular-nums; color: #111111;
    }
    .totals .t-line.is-total {
      border-top: 2px solid #0d2240;
      border-bottom: 1px solid #ececec;
      padding: 12px 0;
    }
    .totals .t-line.is-total .label {
      font-family: 'Cinzel', serif; font-style: normal;
      font-weight: 700; font-size: 13px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #0d2240;
    }
    .totals .t-line.is-total .val {
      font-size: 18px; font-weight: 700; color: #0d2240;
    }
    .totals .t-line.is-paid .val { color: #15803d; }
    .totals .t-line.is-balance {
      border-top: 1px solid #ececec;
      padding-top: 12px; margin-top: 4px;
    }
    .totals .t-line.is-balance .label {
      font-family: 'Cinzel', serif; font-style: normal;
      font-weight: 700; font-size: 12px; letter-spacing: 0.1em;
      text-transform: uppercase; color: #111111;
    }
    .totals .t-line.is-balance .val {
      font-size: 17px; font-weight: 700;
    }

    /* ── Notes + signature row ───────────────────────────────────── */
    .closure {
      display: flex; gap: 60px; align-items: flex-start;
      margin-top: 56px; padding-top: 28px;
      border-top: 1px solid #d4d4d4;
    }
    .closure-notes { flex: 1; }
    .closure-sig {
      width: 280px; text-align: center;
    }
    .closure-label {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-weight: 700; font-style: italic; font-size: 13px;
      color: #0d2240; letter-spacing: 0.02em;
      margin-bottom: 8px;
    }
    .closure-body {
      font-size: 11.5px; line-height: 1.6; color: #525252;
      white-space: pre-line;
    }
    .closure-body + .closure-label { margin-top: 20px; }

    .sig-line {
      border-bottom: 1px solid #111111;
      height: 64px; margin-bottom: 8px;
      display: flex; align-items: flex-end; justify-content: center;
      padding-bottom: 4px;
    }
    .sig-img {
      height: 58px; width: auto; mix-blend-mode: multiply;
      object-fit: contain; margin-bottom: -8px;
    }
    .sig-name {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 14px; font-style: italic; color: #111111;
      margin-bottom: 2px;
    }
    .sig-role {
      font-size: 9.5px; text-transform: uppercase;
      letter-spacing: 0.18em; color: #525252; font-weight: 600;
    }

    /* ── PAID / VOID rubber stamp ────────────────────────────────── */
    .stamp {
      position: absolute;
      bottom: 230px; right: 90px;
      transform: rotate(-10deg);
      border: 4px double currentColor;
      padding: 12px 28px 10px 28px;
      font-family: 'Cinzel', serif; font-weight: 700;
      font-size: 30px; letter-spacing: 0.18em;
      text-align: center; line-height: 1;
      opacity: 0.78;
      pointer-events: none;
    }
    .stamp small {
      display: block;
      font-size: 9.5px; letter-spacing: 0.25em; font-weight: 700;
      margin-top: 6px; opacity: 0.85;
    }

    /* ── Footer ──────────────────────────────────────────────────── */
    .doc-footer {
      position: absolute; left: 72px; right: 72px; bottom: 36px;
      padding-top: 16px; border-top: 1px solid #d4d4d4;
      display: flex; justify-content: space-between;
      font-size: 10px; color: #8a8a8a;
      font-family: 'Inter', sans-serif; letter-spacing: 0.02em;
    }
    .doc-footer .footer-r { text-align: right; }
    `;
  }

  // ─── Shared chunks ────────────────────────────────────────────────
  function renderTopBand(opts) {
    // opts: { docTitle, statKey, statValue, dates: [{k,v},...] }
    const dateRows = opts.dates.map(d =>
      `<tr><td>${escapeHtml(d.k)}</td><td>${escapeHtml(d.v || '—')}</td></tr>`
    ).join('');
    return `
    <div class="doc-top">
      <div class="brand-block">
        <div class="brand-mark">
          <img src="${LOGO_URL}" alt="Private Mentorship" crossorigin="anonymous" />
          <div>
            <div class="brand-name">${escapeHtml(COMPANY_NAME)}</div>
            <div class="brand-tagline">${escapeHtml(COMPANY_TAGLINE)}</div>
          </div>
        </div>
        <div class="brand-address">
          ${escapeHtml(COMPANY_ADDR_1)} · ${escapeHtml(COMPANY_ADDR_2)}<br/>
          ${escapeHtml(COMPANY_EMAIL)} · ${escapeHtml(COMPANY_WEB)}
        </div>
      </div>
      <div class="doc-id">
        <div class="doc-id-label">${escapeHtml(opts.docTitle)}</div>
        <table class="doc-id-table">
          <tr><td>${escapeHtml(opts.statKey)}</td><td>${escapeHtml(opts.statValue || '—')}</td></tr>
          ${dateRows}
        </table>
      </div>
    </div>`;
  }

  function renderStamp(stamp) {
    if (!stamp || !stamp.show) return '';
    return `<div class="stamp" style="color:${stamp.color};">${escapeHtml(stamp.label)}<small>PRIVATE&nbsp;MENTORSHIP</small></div>`;
  }

  function renderFooter(docNumber) {
    return `<div class="doc-footer">
      <div>${escapeHtml(COMPANY_NAME)}  ·  ${escapeHtml(COMPANY_EMAIL)}</div>
      <div class="footer-r">${escapeHtml(docNumber || '')}  ·  ${escapeHtml(COMPANY_WEB)}</div>
    </div>`;
  }

  function fontsLink() {
    return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:ital,wght@0,500;0,700;1,400;1,500;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />`;
  }

  // ─── INVOICE template ─────────────────────────────────────────────
  function buildInvoiceHtml(inv) {
    if (!inv) throw new Error('buildInvoiceHtml: missing invoice payload');

    const ccy = (inv.currency || 'CAD').toUpperCase();
    const stamp = stampFor(inv.status, 'invoice');

    const client = inv.clients || {};
    const clientName = client.full_name || inv.party_name || '—';
    const clientEmail = client.email || '';

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const qty = Number(l.quantity) || 0;
      const unitCents = Number(l.unit_price_cents) || 0;
      const totalCents = Number(l.line_total_cents) || Math.round(qty * unitCents);
      return `<tr>
        <td class="it-idx">${String(idx + 1).padStart(2, '0')}</td>
        <td class="it-desc">${escapeHtml(l.description || '—')}</td>
        <td class="center">${qty}</td>
        <td class="right it-rate">${fmtMoney(unitCents, ccy)}</td>
        <td class="right it-amt">${fmtMoney(totalCents, ccy)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#8a8a8a;">No line items recorded.</td></tr>`;

    const totalCents   = Number(inv.total_cents)        || 0;
    const paidCents    = Number(inv.amount_paid_cents)  || 0;
    const balanceCents = Number(inv.balance_due_cents)  || (totalCents - paidCents);

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Invoice ${escapeHtml(inv.invoice_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${renderTopBand({
          docTitle: 'INVOICE',
          statKey: 'No.',
          statValue: inv.invoice_number || '',
          dates: [
            { k: 'Issued', v: fmtDate(inv.invoice_date) },
            { k: 'Due',    v: fmtDate(inv.due_date) },
          ],
        })}

        <div class="parties">
          <div class="party-col">
            <div class="party-label">Billed to</div>
            <div class="party-name">${escapeHtml(clientName)}</div>
            ${clientEmail ? `<div class="party-meta">${escapeHtml(clientEmail)}</div>` : ''}
          </div>
          <div class="party-col">
            <div class="party-label">For services</div>
            <div class="party-name" style="font-size:14px;font-weight:500;line-height:1.4;">${escapeHtml(inv.subject || 'Mentorship services')}</div>
          </div>
        </div>

        <div class="doc-meta-strip">
          <div class="doc-meta-cell">
            <span class="doc-meta-key">terms</span>
            <span class="doc-meta-val">${escapeHtml(inv.terms || 'Due on receipt')}</span>
          </div>
          <div class="doc-meta-cell">
            <span class="doc-meta-key">currency</span>
            <span class="doc-meta-val">${escapeHtml(ccy)}</span>
          </div>
        </div>

        <table class="items">
          <thead><tr>
            <th style="width:6%;">#</th>
            <th>Description</th>
            <th class="center" style="width:10%;">Qty</th>
            <th class="right" style="width:18%;">Rate</th>
            <th class="right" style="width:18%;">Amount</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="totals-row">
          <div class="totals">
            <div class="t-line is-sub"><span class="label">Subtotal</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
            <div class="t-line is-sub"><span class="label">Tax (0%)</span><span class="val">${fmtMoney(0, ccy)}</span></div>
            <div class="t-line is-total"><span class="label">Total</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
            <div class="t-line is-paid"><span class="label">Amount paid</span><span class="val">${fmtMoney(paidCents, ccy)}</span></div>
            <div class="t-line is-balance">
              <span class="label">Balance due</span>
              <span class="val" style="color:${balanceCents <= 0 ? '#15803d' : '#0d2240'};">${fmtMoney(balanceCents, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="closure">
          <div class="closure-notes">
            <div class="closure-label">Notes</div>
            <div class="closure-body">${escapeHtml(inv.customer_notes || 'Thank you for your continued partnership with Private Mentorship.')}</div>
            <div class="closure-label">Terms &amp; conditions</div>
            <div class="closure-body">${escapeHtml(inv.terms_conditions || inv.terms || 'Due on receipt. Reserved hours roll over only by written agreement. Late payment may pause active scheduling.')}</div>
          </div>
          <div class="closure-sig">
            <div class="sig-line">
              <img class="sig-img" src="${SIGNATURE_URL}" alt="Caleb Brandt signature" crossorigin="anonymous" />
            </div>
            <div class="sig-name">Caleb Brandt</div>
            <div class="sig-role">Authorized signature</div>
          </div>
        </div>

        ${renderStamp(stamp)}
        ${renderFooter('No. ' + (inv.invoice_number || ''))}
      </div>
    </body></html>`;
  }

  // ─── RECEIPT template ─────────────────────────────────────────────
  function buildReceiptHtml(rec) {
    if (!rec) throw new Error('buildReceiptHtml: missing receipt payload');

    const ccy = 'CAD';
    const stamp = rec.voided_at ? stampFor('void', 'receipt') : stampFor('paid', 'receipt');

    const client = rec.clients || {};
    const invoice = rec.invoices || {};

    const lines = Array.isArray(rec.lines) ? rec.lines : [];
    // sales_receipt_lines stores prices as numeric dollars (not _cents)
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const qty = Number(l.quantity) || 1;
      const unit = Number(l.unit_price) || 0;
      const total = Number(l.line_total != null ? l.line_total : qty * unit) || 0;
      return `<tr>
        <td class="it-idx">${String(idx + 1).padStart(2, '0')}</td>
        <td class="it-desc">${escapeHtml(l.description || 'Payment received on invoice')}</td>
        <td class="center">${qty}</td>
        <td class="right it-rate">${fmtMoney(Math.round(unit * 100), ccy)}</td>
        <td class="right it-amt">${fmtMoney(Math.round(total * 100), ccy)}</td>
      </tr>`;
    }).join('') : `<tr>
      <td class="it-idx">01</td>
      <td class="it-desc">Payment received${invoice.invoice_number ? ' on invoice ' + escapeHtml(invoice.invoice_number) : ''}</td>
      <td class="center">1</td>
      <td class="right it-rate">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
      <td class="right it-amt">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
    </tr>`;

    const totalCents = Math.round(Number(rec.total_amount || 0) * 100);

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Receipt ${escapeHtml(rec.receipt_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${renderTopBand({
          docTitle: 'RECEIPT',
          statKey: 'No.',
          statValue: rec.receipt_number || '',
          dates: [
            { k: 'Received',  v: fmtDate(rec.receipt_date) },
            { k: 'Invoice',   v: invoice.invoice_number || '—' },
          ],
        })}

        <div class="parties">
          <div class="party-col">
            <div class="party-label">Received from</div>
            <div class="party-name">${escapeHtml(client.full_name || '—')}</div>
            ${client.email ? `<div class="party-meta">${escapeHtml(client.email)}</div>` : ''}
          </div>
          <div class="party-col">
            <div class="party-label">Payment details</div>
            <div class="party-meta">
              <strong style="color:#111;">${escapeHtml(titleCase(rec.payment_mode || 'Cash'))}</strong>
              ${rec.reference ? `<br/>Ref: ${escapeHtml(rec.reference)}` : ''}
            </div>
          </div>
        </div>

        <div class="doc-meta-strip">
          <div class="doc-meta-cell">
            <span class="doc-meta-key">amount received</span>
            <span class="doc-meta-val" style="color:#15803d;font-weight:700;">${fmtMoney(totalCents, ccy)}</span>
          </div>
          <div class="doc-meta-cell">
            <span class="doc-meta-key">currency</span>
            <span class="doc-meta-val">${escapeHtml(ccy)}</span>
          </div>
        </div>

        <table class="items">
          <thead><tr>
            <th style="width:6%;">#</th>
            <th>Description</th>
            <th class="center" style="width:10%;">Qty</th>
            <th class="right" style="width:18%;">Rate</th>
            <th class="right" style="width:18%;">Amount</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="totals-row">
          <div class="totals">
            <div class="t-line is-sub"><span class="label">Subtotal</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
            <div class="t-line is-total"><span class="label">Received</span><span class="val" style="color:#15803d;">${fmtMoney(totalCents, ccy)}</span></div>
          </div>
        </div>

        <div class="closure">
          <div class="closure-notes">
            <div class="closure-label">Notes</div>
            <div class="closure-body">${escapeHtml(rec.customer_notes || 'Thank you for your payment. This receipt confirms the amount above was received in full.')}</div>
            ${rec.notes ? `<div class="closure-label">Internal note</div><div class="closure-body">${escapeHtml(rec.notes)}</div>` : ''}
          </div>
          <div class="closure-sig">
            <div class="sig-line">
              <img class="sig-img" src="${SIGNATURE_URL}" alt="Caleb Brandt signature" crossorigin="anonymous" />
            </div>
            <div class="sig-name">Caleb Brandt</div>
            <div class="sig-role">Authorized signature</div>
          </div>
        </div>

        ${renderStamp(stamp)}
        ${renderFooter('No. ' + (rec.receipt_number || ''))}
      </div>
    </body></html>`;
  }

  // ─── PAYCHEQUE template ───────────────────────────────────────────
  function buildPaychequeHtml(pay) {
    if (!pay) throw new Error('buildPaychequeHtml: missing paycheque payload');

    const ccy = (pay.currency || 'CAD').toUpperCase();
    const stamp = stampFor(pay.status || 'issued', 'paycheque');

    const lines = Array.isArray(pay.lines) ? pay.lines : [];
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const hrs = Number(l.hours) || 0;
      const rateCents = Number(l.hourly_rate_cents) || 0;
      const totalCents = Number(l.line_total_cents) || 0;
      return `<tr>
        <td class="it-idx">${String(idx + 1).padStart(2, '0')}</td>
        <td class="it-desc">${escapeHtml(l.description || '—')}</td>
        <td class="center">${hrs.toFixed(2)}</td>
        <td class="right it-rate">${fmtMoney(rateCents, ccy)}</td>
        <td class="right it-amt">${fmtMoney(totalCents, ccy)}</td>
      </tr>`;
    }).join('') : `<tr>
      <td class="it-idx">01</td>
      <td class="it-desc">Wages</td>
      <td class="center">${(Number(pay.hours_worked) || 0).toFixed(2)}</td>
      <td class="right it-rate">${fmtMoney(Number(pay.hourly_rate_cents) || 0, ccy)}</td>
      <td class="right it-amt">${fmtMoney(Number(pay.gross_cents) || 0, ccy)}</td>
    </tr>`;

    const gross = Number(pay.gross_cents) || 0;
    const ded   = Number(pay.deductions_cents) || 0;
    const net   = Number(pay.net_cents) || (gross - ded);

    const periodStr = (pay.period_start || pay.period_end)
      ? (fmtDateShort(pay.period_start) + '  →  ' + fmtDateShort(pay.period_end))
      : '—';

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Paycheque ${escapeHtml(pay.paycheque_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${renderTopBand({
          docTitle: 'PAYCHEQUE',
          statKey: 'No.',
          statValue: pay.paycheque_number || '',
          dates: [
            { k: 'Pay date', v: fmtDate(pay.pay_date) },
            { k: 'Period',   v: periodStr },
          ],
        })}

        <div class="parties">
          <div class="party-col">
            <div class="party-label">Paid to</div>
            <div class="party-name">${escapeHtml(pay.assistant_name || 'Assistant')}</div>
            <div class="party-meta">Contractor</div>
          </div>
          <div class="party-col">
            <div class="party-label">Payment details</div>
            <div class="party-meta">
              <strong style="color:#111;">${escapeHtml(titleCase(pay.payment_mode || 'E-transfer'))}</strong>
              ${pay.reference ? `<br/>Ref: ${escapeHtml(pay.reference)}` : ''}
            </div>
          </div>
        </div>

        <div class="doc-meta-strip">
          <div class="doc-meta-cell">
            <span class="doc-meta-key">net pay</span>
            <span class="doc-meta-val" style="color:#15803d;font-weight:700;">${fmtMoney(net, ccy)}</span>
          </div>
          <div class="doc-meta-cell">
            <span class="doc-meta-key">currency</span>
            <span class="doc-meta-val">${escapeHtml(ccy)}</span>
          </div>
        </div>

        <table class="items">
          <thead><tr>
            <th style="width:6%;">#</th>
            <th>Description</th>
            <th class="center" style="width:10%;">Hours</th>
            <th class="right" style="width:18%;">Rate</th>
            <th class="right" style="width:18%;">Amount</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <div class="totals-row">
          <div class="totals">
            <div class="t-line is-sub"><span class="label">Gross pay</span><span class="val">${fmtMoney(gross, ccy)}</span></div>
            <div class="t-line is-sub"><span class="label">Deductions</span><span class="val">${fmtMoney(ded, ccy)}</span></div>
            <div class="t-line is-total"><span class="label">Net pay</span><span class="val" style="color:#15803d;">${fmtMoney(net, ccy)}</span></div>
          </div>
        </div>

        <div class="closure">
          <div class="closure-notes">
            <div class="closure-label">Notes</div>
            <div class="closure-body">${escapeHtml(pay.notes || 'Thank you for your work. Please retain this paycheque for your records — T4A slips are issued annually in February.')}</div>
          </div>
          <div class="closure-sig">
            <div class="sig-line">
              <img class="sig-img" src="${SIGNATURE_URL}" alt="Caleb Brandt signature" crossorigin="anonymous" />
            </div>
            <div class="sig-name">Caleb Brandt</div>
            <div class="sig-role">Authorized signature</div>
          </div>
        </div>

        ${renderStamp(stamp)}
        ${renderFooter('No. ' + (pay.paycheque_number || ''))}
      </div>
    </body></html>`;
  }

  // ─── Export ───────────────────────────────────────────────────────
  window.pmPDFTemplates = {
    buildInvoiceHtml,
    buildReceiptHtml,
    buildPaychequeHtml,
    LOGO_URL, SIGNATURE_URL,
    COMPANY_NAME, COMPANY_EMAIL, COMPANY_WEB,
  };
})();
