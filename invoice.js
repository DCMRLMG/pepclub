// GET /api/invoice?id=123 — hosted custom invoice page (no payment processor).

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function money(n){ return '$' + Number(n).toFixed(2); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

export default async function handler(req, res){
  const { id } = req.query;
  const { data: o, error } = await supabase.from('orders').select('*').eq('id', id).single();
  res.setHeader('Content-Type', 'text/html');
  if(error || !o) return res.status(404).send('<h1>Invoice not found</h1>');

  const rows = (o.items || []).map(i => {
    const desc = i.type === 'kit' ? `${esc(i.name)} (kit)` : `${esc(i.name)} — ${esc(i.variant)}`;
    return `<tr><td>${desc}</td><td class="r">${i.qty}</td><td class="r">${money(i.lineTotal)}</td></tr>`;
  }).join('');

  const payInstructions = o.payment_method === 'venmo'
    ? `Pay by <strong>Venmo</strong> to <strong>${esc(process.env.BUSINESS_VENMO || '@your-business')}</strong>. Include invoice <strong>${esc(o.invoice_number)}</strong> in the note.`
    : `Pay in <strong>cash</strong> on delivery or pickup.`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Invoice ${esc(o.invoice_number)}</title>
<style>
  body{margin:0;background:#faf7f2;color:#141b1e;font-family:"Iowan Old Style",Georgia,serif;line-height:1.5}
  .wrap{max-width:600px;margin:0 auto;padding:48px 24px}
  .card{background:#fff;border:1px solid #d8cfc2;border-radius:2px;padding:36px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}
  .biz{font-size:20px;font-weight:600}
  .inv-no{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#6b6459;text-align:right}
  h1{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#6b6459;margin:0 0 4px}
  .to{font-size:17px;font-weight:600;margin:0 0 24px}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6459;border-bottom:1px solid #d8cfc2;padding:8px 0}
  td{padding:10px 0;border-bottom:1px solid #efe9e0}.r{text-align:right}
  .total{display:flex;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:2px solid #141b1e;font-size:20px;font-weight:600}
  .pay{margin-top:28px;padding:16px;background:#eaf3ef;border:1px solid #1f6f5c;border-radius:2px;font-size:14px}
  .notes{margin-top:20px;font-size:13px;color:#6b6459}.meta{font-size:12px;color:#6b6459;margin-top:24px}
</style></head><body>
<div class="wrap"><div class="card">
  <div class="top">
    <div class="biz">${esc(process.env.BUSINESS_NAME || 'Your Business')}</div>
    <div class="inv-no">INVOICE<br>${esc(o.invoice_number)}<br>${new Date(o.created_at).toLocaleDateString()}</div>
  </div>
  <h1>Bill to</h1>
  <p class="to">${esc(o.customer_name)}<br><span style="font-weight:400;font-size:14px;color:#6b6459">${esc(o.phone)}</span></p>
  <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total"><span>Total due</span><span>${money(o.total)}</span></div>
  <div class="pay">${payInstructions}</div>
  ${o.notes ? `<p class="notes"><strong>Notes:</strong> ${esc(o.notes)}</p>` : ''}
  <p class="meta">Status: ${esc(o.status)}</p>
</div></div></body></html>`;
  return res.status(200).send(html);
}
