/* =====================================================================
   js/financial-pdf-templates.js  —  Phase 19c.4n (Etsy-minimal rebuild)
   ---------------------------------------------------------------------
   100% match for the reference design Caleb dropped:
   /Users/calebbrandt/Downloads/il_1588xN.4597881323_jq8m.avif

   LAYOUT
     Two-column. Light-grey sidebar on the LEFT (~28%) holds the logo
     mark + meta stack (no., dates, payment methods). White main area
     on the RIGHT holds the big thin "INVOICE" headline, parties row,
     line-items table, right-aligned totals stack with a grey highlight
     bar on AMOUNT DUE, and a centered large light "THANK YOU" at the
     bottom.

   PALETTE
     Sidebar grey    #ececec
     Page bg         #ffffff
     Ink             #2b2b2b
     Soft ink        #6e6e6e
     Mute            #9a9a9a
     Hairline        #e2e2e2
     Highlight bar   #e9e9e9   (AMOUNT DUE background)
     Stamp red       #b91c1c   (VOID corner stamp)
     Stamp navy      #0d2240   (PAID / ISSUED corner stamp)

   TYPOGRAPHY
     Inter 200 / 300       — big "INVOICE" / "THANK YOU" headlines
     Inter 400-600         — body, line items, money
     Inter 600 / tracked   — uppercase labels

   Public surface (window.pmPDFTemplates):
     buildInvoiceHtml(payload)   → string
     buildReceiptHtml(payload)   → string
     buildPaychequeHtml(payload) → string
   ===================================================================== */
(function () {
  'use strict';

  // ─── Brand assets ─────────────────────────────────────────────────
  // pm-monogram.png is a pre-cropped 700×550 image of just the PM
  // mark — no wordmark, no excess padding. Lets us drop the mark
  // straight into the circle without any clip math.
  const LOGO_URL = 'assets/logos/pm-monogram.png';

  const COMPANY_NAME    = 'Private Mentorship';
  const COMPANY_ADDR_1  = 'Richmond, British Columbia';
  const COMPANY_ADDR_2  = 'Canada';
  const COMPANY_EMAIL   = 'billing@private-mentorship.com';
  const COMPANY_WEB     = 'private-mentorship.com';
  const PAYMENT_HANDLE  = 'billing@private-mentorship.com';

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
  function fmtDateSlash(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    return `${m[2]}/${m[3]}/${m[1]}`;
  }
  function fmtDateLong(v) {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    if (isNaN(dt)) return '';
    return dt.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // Stamps only fire for void/reissued docs — paid invoices use a subtle
  // text line instead (an invoice is a request for payment; stamping
  // "PAID" on it is redundant when the body already shows balance = 0).
  // Receipts are inherently "paid" — the doc title says so.
  function stampFor(status /*, docType */) {
    const s = String(status || '').toLowerCase();
    if (s === 'void')     return { label: 'VOID',     color: '#b91c1c', show: true };
    if (s === 'reissued') return { label: 'REISSUED', color: '#6e6e6e', show: true };
    return { label: '', color: '', show: false };
  }

  // ─── Shared CSS ───────────────────────────────────────────────────
  function sharedCss() {
    return `
    * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
    body { margin: 0; padding: 0;
           font-family: 'Montserrat', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
           background: #ffffff; color: #1f1f1f; font-size: 10.5px; line-height: 1.5;
           font-weight: 300;
    }

    .page {
      width: 794px; min-height: 1100px; margin: 0 auto;
      background: #ffffff; position: relative; overflow: hidden;
      display: flex; align-items: stretch;
    }

    /* ── Sidebar ────────────────────────────────────────────────── */
    .sidebar {
      width: 235px; flex-shrink: 0; background: #ececec;
      padding: 56px 30px 56px 38px;
      display: flex; flex-direction: column;
    }
    /* Logo: drop the circle frame, just show the PM monogram clean.
       Fighting the circle crop wasn't worth it — a plain logo at a
       confident size on the sidebar reads as more premium anyway. */
    .brand-logo {
      display: block;
      width: 132px;
      height: auto;
      margin: 0 0 56px 0;
    }
    .meta-block { margin-bottom: 28px; }
    .meta-block.last { flex: 1; }
    .meta-label {
      font-size: 8.5px; font-weight: 600;
      letter-spacing: 0.28em;
      text-transform: uppercase; color: #1f1f1f;
      margin-bottom: 7px;
    }
    .meta-value {
      font-size: 10.5px; color: #4b4b4b; font-weight: 300;
      letter-spacing: 0.04em; line-height: 1.55; word-break: break-word;
    }
    .meta-block.payment .meta-value-row {
      margin-bottom: 14px;
    }
    .meta-sub-label {
      font-size: 8.5px; font-weight: 600; letter-spacing: 0.28em;
      text-transform: uppercase; color: #1f1f1f; margin-bottom: 4px;
    }

    /* ── Main right column ──────────────────────────────────────── */
    .main {
      flex: 1; padding: 56px 60px 56px 56px;
      display: flex; flex-direction: column;
      position: relative;
    }

    .doc-headline {
      font-family: 'Montserrat', 'Inter', sans-serif;
      font-weight: 200; font-size: 78px; line-height: 0.95;
      letter-spacing: 0.16em; color: #1f1f1f;
      text-transform: uppercase;
      margin: 0 0 44px -2px;
    }

    .parties {
      display: flex; gap: 50px; margin-bottom: 44px;
    }
    .party-col { flex: 1; }
    .party-label {
      font-size: 9px; font-weight: 600;
      letter-spacing: 0.28em;
      text-transform: uppercase; color: #1f1f1f;
      margin-bottom: 8px;
    }
    .party-name {
      font-size: 10.5px; color: #4b4b4b; font-weight: 300;
      letter-spacing: 0.04em; line-height: 1.6; word-break: break-word;
    }

    /* ── Items table ───────────────────────────────────────────── */
    .items {
      width: 100%; border-collapse: collapse; margin-bottom: 36px;
    }
    .items thead th {
      text-align: left;
      font-size: 9px; font-weight: 600;
      letter-spacing: 0.24em;
      text-transform: uppercase; color: #1f1f1f;
      padding: 12px 4px; border-bottom: 1px solid #1f1f1f;
    }
    .items thead th.center { text-align: center; }
    .items thead th.right { text-align: right; }
    .items tbody td {
      padding: 18px 4px;
      border-bottom: 1px solid #e2e2e2;
      vertical-align: top; font-size: 10.5px; color: #4b4b4b;
      font-weight: 300; letter-spacing: 0.02em;
    }
    .items td.center { text-align: center; }
    .items td.right { text-align: right;
      font-variant-numeric: tabular-nums; font-weight: 300;
    }
    .items .it-desc { font-weight: 400; color: #1f1f1f; }

    /* ── Totals stack — right-aligned with grey highlight on Amount Due */
    .totals-row { display: flex; justify-content: flex-end; margin-top: 6px; }
    .totals { min-width: 290px; }
    .totals .t-line {
      display: flex; justify-content: space-between; align-items: center;
      padding: 9px 14px; font-size: 10.5px; color: #1f1f1f;
    }
    .totals .t-line .label {
      font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase;
      font-size: 9.5px; color: #4b4b4b;
    }
    .totals .t-line .val {
      font-weight: 300; font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em; color: #1f1f1f;
    }
    .totals .t-line.is-amount-due {
      background: #d8d8d8;
      margin-top: 6px;
    }
    .totals .t-line.is-amount-due .label,
    .totals .t-line.is-amount-due .val {
      font-weight: 700; color: #1f1f1f; font-size: 10.5px;
    }

    /* ── Thank you ─────────────────────────────────────────────── */
    .thank-you {
      margin-top: auto; padding-top: 72px; padding-bottom: 12px;
      text-align: center;
      font-family: 'Montserrat', 'Inter', sans-serif;
      font-weight: 200; font-size: 46px;
      letter-spacing: 0.42em;
      text-transform: uppercase; color: #1f1f1f;
      padding-left: 0.42em;  /* compensate visually for the trailing track */
    }

    /* ── Stamp (only used for VOID / REISSUED) ─────────────────────
       Positioned in the lower-right area, above THANK YOU, big enough
       to read like an accountant slammed it down on the doc. */
    .stamp {
      position: absolute;
      bottom: 170px; right: 90px;
      transform: rotate(-9deg);
      border: 4px double currentColor;
      padding: 14px 30px 10px 30px;
      font-family: 'Montserrat', sans-serif; font-weight: 700;
      font-size: 34px; letter-spacing: 0.22em;
      text-align: center; line-height: 1;
      opacity: 0.82;
      pointer-events: none;
    }
    .stamp small {
      display: block; font-size: 8px; letter-spacing: 0.32em;
      font-weight: 600; margin-top: 6px; opacity: 0.85;
    }

    /* ── Subtle "Paid in full" line under totals (invoice when paid) */
    .paid-note {
      margin-top: 10px; text-align: right;
      font-family: 'Montserrat', sans-serif; font-weight: 500;
      font-size: 9px; letter-spacing: 0.28em;
      text-transform: uppercase; color: #1f1f1f;
      padding-right: 14px;
    }
    .paid-note .dot { color: #b4b4b4; padding: 0 6px; }
    `;
  }

  function fontsLink() {
    return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />`;
  }

  // ─── Sidebar builder (varies by doc type) ─────────────────────────
  // metaRows = [{ label, value }] above the payment block
  // paymentRows = [{ subLabel, value }] inside the PAYMENT METHODS block
  function renderSidebar(metaRows, paymentRows) {
    const metaHtml = metaRows.map(r => `
      <div class="meta-block">
        <div class="meta-label">${escapeHtml(r.label)}</div>
        <div class="meta-value">${escapeHtml(r.value || '—')}</div>
      </div>`).join('');
    const payHtml = (paymentRows || []).map(p => `
      <div class="meta-value-row">
        <div class="meta-sub-label">${escapeHtml(p.subLabel)}</div>
        <div class="meta-value">${escapeHtml(p.value)}</div>
      </div>`).join('');

    return `
    <aside class="sidebar">
      <img class="brand-logo" src="${LOGO_URL}" alt="${escapeHtml(COMPANY_NAME)}" />
      ${metaHtml}
      ${paymentRows && paymentRows.length ? `
        <div class="meta-block payment last">
          <div class="meta-label">Payment Methods</div>
          ${payHtml}
        </div>` : ''}
    </aside>`;
  }

  function renderStamp(stamp) {
    if (!stamp || !stamp.show) return '';
    return `<div class="stamp" style="color:${stamp.color};">${escapeHtml(stamp.label)}<small>PRIVATE&nbsp;MENTORSHIP</small></div>`;
  }

  // ─── INVOICE ──────────────────────────────────────────────────────
  function buildInvoiceHtml(inv) {
    if (!inv) throw new Error('buildInvoiceHtml: missing invoice payload');

    const ccy = (inv.currency || 'CAD').toUpperCase();
    const stamp = stampFor(inv.status);
    const isPaid = String(inv.status || '').toLowerCase() === 'paid';

    const client = inv.clients || {};
    const clientName = client.full_name || inv.party_name || '—';
    const clientEmail = client.email || '';

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const rowsHtml = lines.length ? lines.map(l => {
      const qty = Number(l.quantity) || 0;
      const unitCents = Number(l.unit_price_cents) || 0;
      const totalCents = Number(l.line_total_cents) || Math.round(qty * unitCents);
      return `<tr>
        <td class="it-desc">${escapeHtml(l.description || '—')}</td>
        <td class="center">${qty}</td>
        <td class="right">${fmtMoney(unitCents, ccy)}</td>
        <td class="right">${fmtMoney(totalCents, ccy)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" style="padding:24px;text-align:center;color:#9a9a9a;">No line items recorded.</td></tr>`;

    const totalCents   = Number(inv.total_cents)        || 0;
    const paidCents    = Number(inv.amount_paid_cents)  || 0;
    const balanceCents = Number(inv.balance_due_cents)  || (totalCents - paidCents);

    const sidebar = renderSidebar(
      [
        { label: 'Invoice No.',   value: inv.invoice_number || '' },
        { label: 'Invoice Date',  value: fmtDateSlash(inv.invoice_date) },
        { label: 'Due Date',      value: fmtDateSlash(inv.due_date) },
      ],
      [
        { subLabel: 'E-Transfer', value: PAYMENT_HANDLE },
      ]
    );

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Invoice ${escapeHtml(inv.invoice_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${sidebar}
        <main class="main">
          ${renderStamp(stamp)}
          <h1 class="doc-headline">Invoice</h1>

          <div class="parties">
            <div class="party-col">
              <div class="party-label">Your Business</div>
              <div class="party-name">
                ${escapeHtml(COMPANY_NAME)}<br/>
                ${escapeHtml(COMPANY_ADDR_1)}<br/>
                ${escapeHtml(COMPANY_ADDR_2)}<br/>
                ${escapeHtml(COMPANY_EMAIL)}<br/>
                ${escapeHtml(COMPANY_WEB)}
              </div>
            </div>
            <div class="party-col">
              <div class="party-label">Billed To</div>
              <div class="party-name">
                ${escapeHtml(clientName)}<br/>
                ${clientEmail ? escapeHtml(clientEmail) + '<br/>' : ''}
                ${inv.subject ? '<span style="color:#6e6e6e;">For: ' + escapeHtml(inv.subject) + '</span>' : ''}
              </div>
            </div>
          </div>

          <table class="items">
            <thead><tr>
              <th>Product / Service</th>
              <th class="center" style="width:14%;">Qty</th>
              <th class="right" style="width:20%;">Unit Price</th>
              <th class="right" style="width:20%;">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div class="totals-row">
            <div class="totals">
              <div class="t-line"><span class="label">Subtotal</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
              <div class="t-line"><span class="label">Amount Paid</span><span class="val">${fmtMoney(paidCents, ccy)}</span></div>
              <div class="t-line"><span class="label">Tax (0%)</span><span class="val">${fmtMoney(0, ccy)}</span></div>
              <div class="t-line is-amount-due"><span class="label">Amount Due</span><span class="val">${fmtMoney(balanceCents, ccy)}</span></div>
              ${isPaid ? `<div class="paid-note">Paid in full<span class="dot">·</span>${escapeHtml(fmtDateLong(inv.invoice_date))}</div>` : ''}
            </div>
          </div>

          <div class="thank-you">Thank You</div>
        </main>
      </div>
    </body></html>`;
  }

  // ─── RECEIPT ──────────────────────────────────────────────────────
  function buildReceiptHtml(rec) {
    if (!rec) throw new Error('buildReceiptHtml: missing receipt payload');

    const ccy = 'CAD';
    const stamp = rec.voided_at ? stampFor('void') : stampFor('');

    const client = rec.clients || {};
    const invoice = rec.invoices || {};

    const lines = Array.isArray(rec.lines) ? rec.lines : [];
    const rowsHtml = lines.length ? lines.map(l => {
      const qty = Number(l.quantity) || 1;
      const unit = Number(l.unit_price) || 0;
      const total = Number(l.line_total != null ? l.line_total : qty * unit) || 0;
      return `<tr>
        <td class="it-desc">${escapeHtml(l.description || 'Payment received on invoice')}</td>
        <td class="center">${qty}</td>
        <td class="right">${fmtMoney(Math.round(unit * 100), ccy)}</td>
        <td class="right">${fmtMoney(Math.round(total * 100), ccy)}</td>
      </tr>`;
    }).join('') : `<tr>
      <td class="it-desc">Payment received${invoice.invoice_number ? ' on invoice ' + escapeHtml(invoice.invoice_number) : ''}</td>
      <td class="center">1</td>
      <td class="right">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
      <td class="right">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
    </tr>`;

    const totalCents = Math.round(Number(rec.total_amount || 0) * 100);

    const sidebar = renderSidebar(
      [
        { label: 'Receipt No.',   value: rec.receipt_number || '' },
        { label: 'Receipt Date',  value: fmtDateSlash(rec.receipt_date) },
        { label: 'For Invoice',   value: invoice.invoice_number || '—' },
      ],
      [
        { subLabel: titleCase(rec.payment_mode || 'Cash'), value: rec.reference || PAYMENT_HANDLE },
      ]
    );

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Receipt ${escapeHtml(rec.receipt_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${sidebar}
        <main class="main">
          ${renderStamp(stamp)}
          <h1 class="doc-headline">Receipt</h1>

          <div class="parties">
            <div class="party-col">
              <div class="party-label">Your Business</div>
              <div class="party-name">
                ${escapeHtml(COMPANY_NAME)}<br/>
                ${escapeHtml(COMPANY_ADDR_1)}<br/>
                ${escapeHtml(COMPANY_ADDR_2)}<br/>
                ${escapeHtml(COMPANY_EMAIL)}<br/>
                ${escapeHtml(COMPANY_WEB)}
              </div>
            </div>
            <div class="party-col">
              <div class="party-label">Received From</div>
              <div class="party-name">
                ${escapeHtml(client.full_name || '—')}<br/>
                ${client.email ? escapeHtml(client.email) + '<br/>' : ''}
              </div>
            </div>
          </div>

          <table class="items">
            <thead><tr>
              <th>Product / Service</th>
              <th class="center" style="width:14%;">Qty</th>
              <th class="right" style="width:20%;">Unit Price</th>
              <th class="right" style="width:20%;">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div class="totals-row">
            <div class="totals">
              <div class="t-line"><span class="label">Subtotal</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
              <div class="t-line is-amount-due"><span class="label">Amount Paid</span><span class="val">${fmtMoney(totalCents, ccy)}</span></div>
            </div>
          </div>

          <div class="thank-you">Thank You</div>
        </main>
      </div>
    </body></html>`;
  }

  // ─── PAYCHEQUE ────────────────────────────────────────────────────
  function buildPaychequeHtml(pay) {
    if (!pay) throw new Error('buildPaychequeHtml: missing paycheque payload');

    const ccy = (pay.currency || 'CAD').toUpperCase();
    const stamp = stampFor(pay.status || 'issued');

    const lines = Array.isArray(pay.lines) ? pay.lines : [];
    const rowsHtml = lines.length ? lines.map(l => {
      const hrs = Number(l.hours) || 0;
      const rateCents = Number(l.hourly_rate_cents) || 0;
      const totalCents = Number(l.line_total_cents) || 0;
      return `<tr>
        <td class="it-desc">${escapeHtml(l.description || '—')}</td>
        <td class="center">${hrs.toFixed(2)}</td>
        <td class="right">${fmtMoney(rateCents, ccy)}</td>
        <td class="right">${fmtMoney(totalCents, ccy)}</td>
      </tr>`;
    }).join('') : `<tr>
      <td class="it-desc">Wages</td>
      <td class="center">${(Number(pay.hours_worked) || 0).toFixed(2)}</td>
      <td class="right">${fmtMoney(Number(pay.hourly_rate_cents) || 0, ccy)}</td>
      <td class="right">${fmtMoney(Number(pay.gross_cents) || 0, ccy)}</td>
    </tr>`;

    const gross = Number(pay.gross_cents) || 0;
    const ded   = Number(pay.deductions_cents) || 0;
    const net   = Number(pay.net_cents) || (gross - ded);

    const sidebar = renderSidebar(
      [
        { label: 'Paycheque No.', value: pay.paycheque_number || '' },
        { label: 'Pay Date',      value: fmtDateSlash(pay.pay_date) },
        { label: 'Period Start',  value: fmtDateSlash(pay.period_start) },
        { label: 'Period End',    value: fmtDateSlash(pay.period_end) },
      ],
      [
        { subLabel: titleCase(pay.payment_mode || 'E-Transfer'), value: pay.reference || PAYMENT_HANDLE },
      ]
    );

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Paycheque ${escapeHtml(pay.paycheque_number || '')}</title>
    ${fontsLink()}
    <style>${sharedCss()}</style></head><body>
      <div class="page">
        ${sidebar}
        <main class="main">
          ${renderStamp(stamp)}
          <h1 class="doc-headline">Paycheque</h1>

          <div class="parties">
            <div class="party-col">
              <div class="party-label">Issued By</div>
              <div class="party-name">
                ${escapeHtml(COMPANY_NAME)}<br/>
                ${escapeHtml(COMPANY_ADDR_1)}<br/>
                ${escapeHtml(COMPANY_ADDR_2)}<br/>
                ${escapeHtml(COMPANY_EMAIL)}
              </div>
            </div>
            <div class="party-col">
              <div class="party-label">Paid To</div>
              <div class="party-name">
                ${escapeHtml(pay.assistant_name || 'Assistant')}<br/>
                <span style="color:#6e6e6e;">Contractor</span>
              </div>
            </div>
          </div>

          <table class="items">
            <thead><tr>
              <th>Description</th>
              <th class="center" style="width:14%;">Hours</th>
              <th class="right" style="width:20%;">Rate / hr</th>
              <th class="right" style="width:20%;">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div class="totals-row">
            <div class="totals">
              <div class="t-line"><span class="label">Gross Pay</span><span class="val">${fmtMoney(gross, ccy)}</span></div>
              <div class="t-line"><span class="label">Deductions</span><span class="val">${fmtMoney(ded, ccy)}</span></div>
              <div class="t-line is-amount-due"><span class="label">Net Pay</span><span class="val">${fmtMoney(net, ccy)}</span></div>
            </div>
          </div>

          <div class="thank-you">Thank You</div>
        </main>
      </div>
    </body></html>`;
  }

  // ─── Export ───────────────────────────────────────────────────────
  window.pmPDFTemplates = {
    buildInvoiceHtml, buildReceiptHtml, buildPaychequeHtml,
    LOGO_URL, COMPANY_NAME, COMPANY_EMAIL, COMPANY_WEB,
  };
})();
