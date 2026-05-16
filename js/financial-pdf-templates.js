/* =====================================================================
   js/financial-pdf-templates.js  —  Phase 19c.4k
   ---------------------------------------------------------------------
   HTML/CSS templates for invoice, receipt and paycheque PDFs.
   Matches the premium design language already shipped in the React
   Native app (src/helpers/invoiceTemplates.js + salesReceiptTemplates.js).

   Each builder returns a fully self-contained HTML string ready to be
   rendered to PDF by financial-pdf.js (which uses html2canvas + jsPDF
   under the hood).

   Design language at a glance:
   • A4 white page (794×1100+ px) with subtle outer shadow
   • Cinzel serif watermark "PRIVATE MENTORSHIP" diagonally
   • Header: 3 angular blue/cyan geometric shapes (clip-path triangles)
     + the brand RecLogo + Cinzel "INVOICE/RECEIPT/PAYCHEQUE" title
   • Dark slate status card spanning the page width with stat groups +
     coloured status pill
   • Two-column content grid: Billed-To card + Details card
   • Card-style line items (8px gap, white pills on grey)
   • Right-aligned totals card with big "Amount Due" in 28px
   • Customer notes + terms sections with leading-dot section heads
   • Authorized signature image (only when status='paid')
   • Dark slate footer bar at bottom

   Public surface (mounted on window.pmPDFTemplates):
     buildInvoiceHtml(payload)   → string
     buildReceiptHtml(payload)   → string
     buildPaychequeHtml(payload) → string
   ===================================================================== */
(function () {
  'use strict';

  // ─── Brand assets — reused from the app's Supabase storage ────────
  const LOGO_URL =
    'https://llkicgphkvciumfzhbkk.supabase.co/storage/v1/object/public/branding/RecLogo.png';
  const SIGNATURE_URL =
    'https://llkicgphkvciumfzhbkk.supabase.co/storage/v1/object/public/receipt-assets/caleb_brandt_signature_transparent.png';

  const BRAND_PRIMARY = '#0f172a'; // slate 900
  const BRAND_ACCENT  = '#2563eb'; // blue 600

  const COMPANY_NAME    = 'Private Mentorship';
  const COMPANY_ADDR    = 'Richmond, British Columbia, Canada';
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
    return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function titleCase(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Status pill colour packs (matches app's logic)
  function statusPack(status) {
    const s = String(status || 'open').toLowerCase();
    if (s === 'paid')     return { label: 'PAID',     dot: '#22c55e', bg: 'rgba(34,197,94,0.18)',  border: 'rgba(34,197,94,0.45)' };
    if (s === 'void')     return { label: 'VOID',     dot: '#ef4444', bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.45)' };
    if (s === 'reissued') return { label: 'REISSUED', dot: '#94a3b8', bg: 'rgba(148,163,184,0.18)', border: 'rgba(148,163,184,0.45)' };
    if (s === 'issued')   return { label: 'ISSUED',   dot: '#ffffff', bg: 'rgba(255,255,255,0.15)', border: 'rgba(255,255,255,0.5)' };
    return                    { label: 'OPEN',     dot: '#ffffff', bg: 'rgba(255,255,255,0.15)', border: 'rgba(255,255,255,0.5)' };
  }

  // ─── Shared CSS — every template inlines this verbatim ────────────
  // Keep things html2canvas-safe: no @import (we load fonts via <link>
  // when needed; html2canvas would otherwise capture before fonts arrive
  // — see financial-pdf.js where we wait for document.fonts.ready).
  function sharedCss(showSignature) {
    return `
    * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
    body { margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
           background: #e2e8f0; color: #334155; font-size: 13px; }

    .page { width: 794px; min-height: 1100px; margin: 0 auto; background: #ffffff;
            position: relative; overflow: hidden;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15); padding-bottom: 80px; }

    .page-watermark {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      pointer-events: none; font-family: 'Cinzel', serif; font-size: 80px; font-weight: 700;
      letter-spacing: 0.3em; text-transform: uppercase; color: ${BRAND_PRIMARY};
      opacity: 0.04; z-index: 0; text-align: center; padding: 0 60px;
      transform: translateX(310px);
    }

    .header-wrapper {
      position: relative; height: 160px; background: #ffffff; color: #111827;
      padding: 30px 50px; display: flex; justify-content: space-between;
      align-items: flex-start; overflow: hidden;
    }
    .header-strip-bottom {
      position: absolute; left: 0; right: 0; bottom: 0; height: 40px;
      background: linear-gradient(90deg, #0f7490, #0284c7, #0f172a); z-index: 1;
    }
    .header-geo-main {
      position: absolute; left: 0; bottom: 40px; width: 260px; height: 140px;
      background: #0b4c6f; clip-path: polygon(0 0, 65% 0, 100% 100%, 0% 100%); z-index: 1;
    }
    .header-geo-light {
      position: absolute; left: 90px; bottom: 40px; width: 200px; height: 120px;
      background: #1fb8e0; clip-path: polygon(0 100%, 60% 0, 100% 100%); z-index: 2;
    }
    .header-geo-dark {
      position: absolute; left: 230px; bottom: 40px; width: 120px; height: 80px;
      background: #03213a; clip-path: polygon(0 100%, 100% 0, 100% 100%); z-index: 3;
    }

    .header-left-col {
      z-index: 10; display: flex; flex-direction: column; justify-content: center; gap: 10px;
    }
    .logo-box img { height: 240px; width: auto; display: block; margin-left: -10px; margin-top: -70px; }
    .company-details-block { font-size: 11px; opacity: 0.85; line-height: 1.5; color: #334155; margin-left: 4px; }
    .company-details-block strong { color: ${BRAND_PRIMARY}; }

    .header-right { z-index: 10; display: flex; flex-direction: column; align-items: flex-end;
                    text-align: right; padding-top: 10px; }
    .doc-title { font-family: 'Cinzel', serif; font-size: 42px; letter-spacing: 0.06em;
                 color: ${BRAND_PRIMARY}; margin: 0; line-height: 1; }
    .doc-subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em;
                    margin-top: 6px; color: #0f7490; font-weight: 700; }

    .status-bar-container { margin-top: -30px; padding: 0 50px; position: relative; z-index: 20; }
    .status-card {
      background: ${BRAND_PRIMARY}; color: #ffffff; border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
      padding: 20px 30px; display: flex; align-items: center; justify-content: space-between;
    }
    .status-info { display: flex; gap: 40px; }
    .stat-group { display: flex; flex-direction: column; }
    .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
                  color: rgba(255,255,255,0.8); font-weight: 600; margin-bottom: 4px; }
    .stat-value { font-size: 15px; font-weight: 700; color: #ffffff; }
    .status-badge {
      padding: 8px 24px; border-radius: 50px; font-weight: 800; text-transform: uppercase;
      font-size: 12px; letter-spacing: 0.1em; display: flex; align-items: center; gap: 8px;
      color: #ffffff;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }

    .content-grid { padding: 30px 50px 20px 50px; display: flex; gap: 40px; }
    .client-card { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0;
                   border-radius: 8px; padding: 20px; }
    .card-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em;
                  color: #64748b; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0;
                  padding-bottom: 8px; display: block; }
    .client-name { font-size: 18px; font-weight: 700; color: ${BRAND_PRIMARY}; margin-bottom: 6px; }
    .client-meta { font-size: 13px; color: #64748b; line-height: 1.5; }
    .details-card { width: 320px; background: #fff; border: 1px solid #e2e8f0;
                    border-radius: 8px; padding: 20px; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 12px;
                  border-bottom: 1px dashed #e2e8f0; padding-bottom: 4px; }
    .detail-key { font-size: 12px; color: #64748b; }
    .detail-val { font-size: 13px; font-weight: 600; color: #334155; text-align: right; }

    .table-container { padding: 0 50px; margin-bottom: 20px; }
    table.fancy-table { width: 100%; border-collapse: separate; border-spacing: 0 8px; }
    table.fancy-table th { text-align: left; font-size: 10px; text-transform: uppercase;
                          letter-spacing: 0.1em; color: #64748b; padding: 0 15px 10px 15px;
                          font-weight: 700; }
    table.fancy-table th.right { text-align: right; }
    table.fancy-table th.center { text-align: center; }
    .item-row td { background: #ffffff; padding: 16px 15px; border-top: 1px solid #e2e8f0;
                   border-bottom: 1px solid #e2e8f0; }
    .item-row td:first-child { border-left: 1px solid #e2e8f0; border-radius: 8px 0 0 8px; }
    .item-row td:last-child  { border-right: 1px solid #e2e8f0; border-radius: 0 8px 8px 0; }
    .col-idx { width: 5%; text-align: center; color: #64748b; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 600; }
    .col-desc { width: 45%; }
    .col-qty { width: 10%; text-align: center; font-weight: 600; }
    .col-price { width: 20%; text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; color: #64748b; }
    .col-total { width: 20%; text-align: right; font-weight: 700; color: ${BRAND_PRIMARY}; font-size: 14px; }
    .item-title { font-weight: 600; color: #334155; }

    .totals-area { padding: 0 50px; display: flex; justify-content: flex-end; margin-bottom: 10px; }
    .totals-wrapper { width: 350px; background: #f8fafc; border-radius: 12px; padding: 20px;
                      border: 1px solid #e2e8f0; }
    .t-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 13px; }
    .t-label { color: #64748b; }
    .t-val { font-weight: 600; color: #334155; }
    .t-divider { height: 1px; background: #cbd5e1; margin: 15px 0; }
    .t-total-row { display: flex; justify-content: space-between; align-items: flex-end; }
    .t-total-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
                     font-weight: 700; color: ${BRAND_PRIMARY}; padding-bottom: 4px; }
    .t-total-val { font-size: 28px; font-weight: 700; color: ${BRAND_PRIMARY}; line-height: 1; }

    .notes-section { padding: 20px 50px 10px 50px; }
    .section-head {
      font-size: 11px; font-weight: 700; text-transform: uppercase; color: ${BRAND_PRIMARY};
      margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
    }
    .section-head::before { content: ''; display: block; width: 4px; height: 4px; background: ${BRAND_ACCENT}; }
    .notes-text {
      font-size: 11px; line-height: 1.55; color: #475569; background: #fdfdfd;
      border-left: 3px solid #e2e8f0; padding: 10px 15px; margin-bottom: 15px;
      white-space: pre-line;
    }

    .signature-row {
      display: ${showSignature ? 'flex' : 'none'};
      justify-content: center; align-items: flex-end; padding: 10px 50px 24px 50px;
    }
    .sign-box-center { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
    .sign-line {
      border-bottom: 1px solid #334155; width: 220px; height: 60px; margin-bottom: 6px;
      display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px;
    }
    .sign-img { height: 55px; width: auto; mix-blend-mode: multiply; object-fit: contain; margin-bottom: -10px; }
    .sign-label { font-size: 10px; text-transform: uppercase; color: #1e1e1e; letter-spacing: 0.5px; }

    .footer-bar {
      position: absolute; left: 0; right: 0; bottom: 0; height: 30px;
      background: ${BRAND_PRIMARY}; color: rgba(255,255,255,0.55);
      font-size: 9px; display: flex; justify-content: center; align-items: center;
      letter-spacing: 0.05em;
    }
    `;
  }

  // ─── Reusable header HTML (logo + geo shapes + doc title) ─────────
  function headerHtml(docTitle, subtitle) {
    return `
    <div class="header-wrapper">
      <div class="header-strip-bottom"></div>
      <div class="header-geo-main"></div>
      <div class="header-geo-light"></div>
      <div class="header-geo-dark"></div>
      <div class="header-left-col">
        <div class="logo-box"><img src="${LOGO_URL}" alt="PM Logo" crossorigin="anonymous" /></div>
        <div class="company-details-block">
          <strong>${COMPANY_NAME}</strong><br/>
          ${escapeHtml(COMPANY_ADDR)}
        </div>
      </div>
      <div class="header-right">
        <h1 class="doc-title">${escapeHtml(docTitle)}</h1>
        <div class="doc-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    </div>`;
  }

  function statusCardHtml(stats, pack) {
    const statsHtml = stats.map(s => `
      <div class="stat-group">
        <span class="stat-label">${escapeHtml(s.label)}</span>
        <span class="stat-value">${escapeHtml(s.value || '—')}</span>
      </div>`).join('');
    return `
    <div class="status-bar-container">
      <div class="status-card">
        <div class="status-info">${statsHtml}</div>
        <div class="status-badge" style="background:${pack.bg}; border:1px solid ${pack.border};">
          <span class="status-dot" style="background:${pack.dot};"></span>
          ${escapeHtml(pack.label)}
        </div>
      </div>
    </div>`;
  }

  function footerHtml(docNumber) {
    return `<div class="footer-bar">${escapeHtml(COMPANY_NAME)} · ${escapeHtml(COMPANY_WEB)} · ${escapeHtml(COMPANY_EMAIL)} · ${escapeHtml(docNumber || '')}</div>`;
  }

  // ─── INVOICE template ─────────────────────────────────────────────
  function buildInvoiceHtml(inv) {
    if (!inv) throw new Error('buildInvoiceHtml: missing invoice payload');

    const ccy = (inv.currency || 'CAD').toUpperCase();
    const pack = statusPack(inv.status);
    const showSignature = String(inv.status || '').toLowerCase() === 'paid';

    const client = inv.clients || {};
    const clientName = client.full_name || inv.party_name || '—';
    const clientEmail = client.email || '';

    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const qty = Number(l.quantity) || 0;
      const unitCents = Number(l.unit_price_cents) || 0;
      const totalCents = Number(l.line_total_cents) || Math.round(qty * unitCents);
      return `
        <tr class="item-row">
          <td class="col-idx">${String(idx + 1).padStart(2, '0')}</td>
          <td class="col-desc"><div class="item-title">${escapeHtml(l.description || '—')}</div></td>
          <td class="col-qty">${qty}</td>
          <td class="col-price">${fmtMoney(unitCents, ccy)}</td>
          <td class="col-total">${fmtMoney(totalCents, ccy)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="5" style="padding:20px;text-align:center;color:#94a3b8;">No line items recorded.</td></tr>`;

    const totalCents   = Number(inv.total_cents)        || 0;
    const paidCents    = Number(inv.amount_paid_cents)  || 0;
    const balanceCents = Number(inv.balance_due_cents)  || (totalCents - paidCents);
    const subtotalCents = totalCents;

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Invoice ${escapeHtml(inv.invoice_number || '')}</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>${sharedCss(showSignature)}</style></head><body>
      <div class="page">
        <div class="page-watermark">PRIVATE&nbsp;MENTORSHIP</div>
        ${headerHtml('INVOICE', 'Official Billing Statement')}
        ${statusCardHtml([
          { label: 'Invoice No', value: '#' + (inv.invoice_number || '') },
          { label: 'Issued',     value: fmtDate(inv.invoice_date) },
          { label: 'Due',        value: fmtDate(inv.due_date) || '—' },
        ], pack)}

        <div class="content-grid">
          <div class="client-card">
            <span class="card-label">Billed To</span>
            <div class="client-name">${escapeHtml(clientName)}</div>
            <div class="client-meta">
              ${clientEmail ? `Email: ${escapeHtml(clientEmail)}<br/>` : ''}
              Client Information
            </div>
          </div>
          <div class="details-card">
            <span class="card-label">Invoice Details</span>
            <div class="detail-row">
              <span class="detail-key">Terms</span>
              <span class="detail-val">${escapeHtml(inv.terms || 'Due on receipt')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Subject</span>
              <span class="detail-val">${escapeHtml(inv.subject || '—')}</span>
            </div>
            <div class="detail-row" style="border-bottom:none;">
              <span class="detail-key">Balance Due</span>
              <span class="detail-val" style="color:${balanceCents <= 0 ? '#22c55e' : BRAND_ACCENT};">
                ${fmtMoney(balanceCents, ccy)}
              </span>
            </div>
          </div>
        </div>

        <div class="table-container">
          <table class="fancy-table">
            <thead><tr>
              <th class="center">#</th>
              <th>Description</th>
              <th class="center">Qty</th>
              <th class="right">Unit Price</th>
              <th class="right">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="totals-area">
          <div class="totals-wrapper">
            <div class="t-row"><span class="t-label">Subtotal</span><span class="t-val">${fmtMoney(subtotalCents, ccy)}</span></div>
            <div class="t-row"><span class="t-label">Amount Paid</span><span class="t-val">${fmtMoney(paidCents, ccy)}</span></div>
            <div class="t-row"><span class="t-label">GST/HST (0%)</span><span class="t-val">${fmtMoney(0, ccy)}</span></div>
            <div class="t-divider"></div>
            <div class="t-total-row">
              <span class="t-total-label">Amount Due</span>
              <span class="t-total-val" style="color:${balanceCents <= 0 ? '#16a34a' : BRAND_PRIMARY};">${fmtMoney(balanceCents, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="notes-section">
          <div class="section-head">Customer Notes</div>
          <div class="notes-text">${escapeHtml(inv.customer_notes || 'Thanks for your business.')}</div>
          <div class="section-head">Terms &amp; Conditions</div>
          <div class="notes-text" style="font-size:10px;">${escapeHtml(inv.terms_conditions || inv.terms || 'Due on receipt.')}</div>
        </div>

        <div class="signature-row">
          <div class="sign-box-center">
            <div class="sign-line"><img src="${SIGNATURE_URL}" class="sign-img" alt="Signature" crossorigin="anonymous" /></div>
            <div class="sign-label">Authorized Signature</div>
          </div>
        </div>

        ${footerHtml(inv.invoice_number)}
      </div>
    </body></html>`;
  }

  // ─── RECEIPT template ─────────────────────────────────────────────
  function buildReceiptHtml(rec) {
    if (!rec) throw new Error('buildReceiptHtml: missing receipt payload');

    const ccy = 'CAD';
    const pack = rec.voided_at ? statusPack('void') : statusPack('paid');
    const showSignature = !rec.voided_at;

    const client = rec.clients || {};
    const invoice = rec.invoices || {};

    const lines = Array.isArray(rec.lines) ? rec.lines : [];
    // sales_receipt_lines uses numeric DOLLAR columns, not _cents
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const qty = Number(l.quantity) || 1;
      const unit = Number(l.unit_price) || 0;
      const total = Number(l.line_total != null ? l.line_total : qty * unit) || 0;
      return `
        <tr class="item-row">
          <td class="col-idx">${String(idx + 1).padStart(2, '0')}</td>
          <td class="col-desc"><div class="item-title">${escapeHtml(l.description || 'Payment received on invoice')}</div></td>
          <td class="col-qty">${qty}</td>
          <td class="col-price">${fmtMoney(Math.round(unit * 100), ccy)}</td>
          <td class="col-total">${fmtMoney(Math.round(total * 100), ccy)}</td>
        </tr>`;
    }).join('') : `<tr class="item-row">
      <td class="col-idx">01</td>
      <td class="col-desc"><div class="item-title">Payment received on invoice${invoice.invoice_number ? ' ' + escapeHtml(invoice.invoice_number) : ''}</div></td>
      <td class="col-qty">1</td>
      <td class="col-price">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
      <td class="col-total">${fmtMoney(Math.round(Number(rec.total_amount || 0) * 100), ccy)}</td>
    </tr>`;

    const totalCents = Math.round(Number(rec.total_amount || 0) * 100);

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Receipt ${escapeHtml(rec.receipt_number || '')}</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>${sharedCss(showSignature)}</style></head><body>
      <div class="page">
        <div class="page-watermark">PRIVATE&nbsp;MENTORSHIP</div>
        ${headerHtml('RECEIPT', 'Payment Confirmation')}
        ${statusCardHtml([
          { label: 'Receipt No', value: '#' + (rec.receipt_number || '') },
          { label: 'Received',   value: fmtDate(rec.receipt_date) },
          { label: 'Invoice',    value: invoice.invoice_number ? '#' + invoice.invoice_number : '—' },
        ], pack)}

        <div class="content-grid">
          <div class="client-card">
            <span class="card-label">Received From</span>
            <div class="client-name">${escapeHtml(client.full_name || '—')}</div>
            <div class="client-meta">
              ${client.email ? `Email: ${escapeHtml(client.email)}<br/>` : ''}
              Client Information
            </div>
          </div>
          <div class="details-card">
            <span class="card-label">Payment Details</span>
            <div class="detail-row">
              <span class="detail-key">Method</span>
              <span class="detail-val">${escapeHtml(titleCase(rec.payment_mode || 'Cash'))}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Reference</span>
              <span class="detail-val">${escapeHtml(rec.reference || '—')}</span>
            </div>
            <div class="detail-row" style="border-bottom:none;">
              <span class="detail-key">Amount Received</span>
              <span class="detail-val" style="color:#22c55e;">${fmtMoney(totalCents, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="table-container">
          <table class="fancy-table">
            <thead><tr>
              <th class="center">#</th>
              <th>Description</th>
              <th class="center">Qty</th>
              <th class="right">Unit Price</th>
              <th class="right">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="totals-area">
          <div class="totals-wrapper">
            <div class="t-row"><span class="t-label">Subtotal</span><span class="t-val">${fmtMoney(totalCents, ccy)}</span></div>
            <div class="t-divider"></div>
            <div class="t-total-row">
              <span class="t-total-label">Amount Received</span>
              <span class="t-total-val" style="color:#16a34a;">${fmtMoney(totalCents, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="notes-section">
          <div class="section-head">Customer Notes</div>
          <div class="notes-text">${escapeHtml(rec.customer_notes || 'Thank you for your payment.')}</div>
          ${rec.notes ? `<div class="section-head">Internal Notes</div><div class="notes-text">${escapeHtml(rec.notes)}</div>` : ''}
        </div>

        <div class="signature-row">
          <div class="sign-box-center">
            <div class="sign-line"><img src="${SIGNATURE_URL}" class="sign-img" alt="Signature" crossorigin="anonymous" /></div>
            <div class="sign-label">Authorized Signature</div>
          </div>
        </div>

        ${footerHtml(rec.receipt_number)}
      </div>
    </body></html>`;
  }

  // ─── PAYCHEQUE template ───────────────────────────────────────────
  function buildPaychequeHtml(pay) {
    if (!pay) throw new Error('buildPaychequeHtml: missing paycheque payload');

    const ccy = (pay.currency || 'CAD').toUpperCase();
    const pack = statusPack(pay.status || 'issued');
    const showSignature = String(pay.status || '').toLowerCase() === 'paid' || String(pay.status || '').toLowerCase() === 'issued';

    const lines = Array.isArray(pay.lines) ? pay.lines : [];
    const rowsHtml = lines.length ? lines.map((l, idx) => {
      const hrs = Number(l.hours) || 0;
      const rateCents = Number(l.hourly_rate_cents) || 0;
      const totalCents = Number(l.line_total_cents) || 0;
      return `
        <tr class="item-row">
          <td class="col-idx">${String(idx + 1).padStart(2, '0')}</td>
          <td class="col-desc"><div class="item-title">${escapeHtml(l.description || '—')}</div></td>
          <td class="col-qty">${hrs.toFixed(2)}</td>
          <td class="col-price">${fmtMoney(rateCents, ccy)}</td>
          <td class="col-total">${fmtMoney(totalCents, ccy)}</td>
        </tr>`;
    }).join('') : `<tr class="item-row">
      <td class="col-idx">01</td>
      <td class="col-desc"><div class="item-title">Wages</div></td>
      <td class="col-qty">${(Number(pay.hours_worked) || 0).toFixed(2)}</td>
      <td class="col-price">${fmtMoney(Number(pay.hourly_rate_cents) || 0, ccy)}</td>
      <td class="col-total">${fmtMoney(Number(pay.gross_cents) || 0, ccy)}</td>
    </tr>`;

    const gross = Number(pay.gross_cents) || 0;
    const ded   = Number(pay.deductions_cents) || 0;
    const net   = Number(pay.net_cents) || (gross - ded);

    return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Paycheque ${escapeHtml(pay.paycheque_number || '')}</title>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>${sharedCss(showSignature)}</style></head><body>
      <div class="page">
        <div class="page-watermark">PRIVATE&nbsp;MENTORSHIP</div>
        ${headerHtml('PAYCHEQUE', 'Contractor Payment')}
        ${statusCardHtml([
          { label: 'Paycheque No', value: '#' + (pay.paycheque_number || '') },
          { label: 'Pay Date',     value: fmtDate(pay.pay_date) },
          { label: 'Period',       value: (pay.period_start || pay.period_end) ? (fmtDate(pay.period_start) + '  →  ' + fmtDate(pay.period_end)) : '—' },
        ], pack)}

        <div class="content-grid">
          <div class="client-card">
            <span class="card-label">Paid To</span>
            <div class="client-name">${escapeHtml(pay.assistant_name || 'Assistant')}</div>
            <div class="client-meta">Contractor</div>
          </div>
          <div class="details-card">
            <span class="card-label">Payment Details</span>
            <div class="detail-row">
              <span class="detail-key">Method</span>
              <span class="detail-val">${escapeHtml(titleCase(pay.payment_mode || 'E-transfer'))}</span>
            </div>
            <div class="detail-row">
              <span class="detail-key">Reference</span>
              <span class="detail-val">${escapeHtml(pay.reference || '—')}</span>
            </div>
            <div class="detail-row" style="border-bottom:none;">
              <span class="detail-key">Net Pay</span>
              <span class="detail-val" style="color:#22c55e;">${fmtMoney(net, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="table-container">
          <table class="fancy-table">
            <thead><tr>
              <th class="center">#</th>
              <th>Description</th>
              <th class="center">Hours</th>
              <th class="right">Rate / hr</th>
              <th class="right">Total</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="totals-area">
          <div class="totals-wrapper">
            <div class="t-row"><span class="t-label">Gross Pay</span><span class="t-val">${fmtMoney(gross, ccy)}</span></div>
            <div class="t-row"><span class="t-label">Deductions</span><span class="t-val">${fmtMoney(ded, ccy)}</span></div>
            <div class="t-divider"></div>
            <div class="t-total-row">
              <span class="t-total-label">Net Pay</span>
              <span class="t-total-val" style="color:#16a34a;">${fmtMoney(net, ccy)}</span>
            </div>
          </div>
        </div>

        <div class="notes-section">
          <div class="section-head">Notes</div>
          <div class="notes-text">${escapeHtml(pay.notes || 'Thank you for your work. Please retain this paycheque for your records — T4A slips are issued annually in February.')}</div>
        </div>

        <div class="signature-row">
          <div class="sign-box-center">
            <div class="sign-line"><img src="${SIGNATURE_URL}" class="sign-img" alt="Signature" crossorigin="anonymous" /></div>
            <div class="sign-label">Authorized Signature</div>
          </div>
        </div>

        ${footerHtml(pay.paycheque_number)}
      </div>
    </body></html>`;
  }

  // ─── Export ───────────────────────────────────────────────────────
  window.pmPDFTemplates = {
    buildInvoiceHtml,
    buildReceiptHtml,
    buildPaychequeHtml,
    // expose constants for the email composer that might want them
    BRAND_PRIMARY, BRAND_ACCENT,
    COMPANY_NAME, COMPANY_EMAIL, COMPANY_WEB,
    LOGO_URL,
  };
})();
