// POST /api/submit-order
// Validate against the catalog -> price server-side -> atomically consume inventory
// -> store order -> generate date-based invoice number + link. No messaging, no processor.
// The invoice link is returned so it can be texted to the customer directly (outside this app).

import { createClient } from '@supabase/supabase-js';
import { findProduct, findKit, unitsConsumed, linePrice } from './catalog-data.js';
import { findRep } from './reps.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function nextInvoiceNumber(){
  const today = new Date().toISOString().slice(0,10);
  const { count } = await supabase.from('orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today + 'T00:00:00Z');
  return `${today}-${String((count||0)+1).padStart(2,'0')}`;
}

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { rep, name, phone, paymentMethod, venmoHandle, notes, items } = req.body || {};

  const repObj = findRep(rep);
  if(!repObj) return res.status(400).json({ error: 'Invalid or missing rep.' });
  if(!name || !phone) return res.status(400).json({ error: 'Missing name or phone.' });
  if(!['cash','venmo'].includes(paymentMethod)) return res.status(400).json({ error: 'Invalid payment method.' });
  if(paymentMethod === 'venmo' && !venmoHandle) return res.status(400).json({ error: 'Venmo username required.' });
  if(!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items in order.' });

  // --- validate each line against the catalog and build server-side priced lines ---
  const lines = [];
  const consumption = {};
  for(const raw of items){
    const qty = parseInt(raw.qty) || 0;
    if(qty < 1) continue;
    let line;
    if(raw.type === 'product'){
      const p = findProduct(raw.sku);
      const v = p?.variants.find(v => v.label === raw.variant);
      if(!p || !v) return res.status(400).json({ error: `Unknown product/variant: ${raw.sku} ${raw.variant}` });
      line = { type:'product', sku:p.sku, name:p.name, variant:v.label, qty, lineTotal: linePrice({type:'product',sku:p.sku,variant:v.label,qty}) };
    } else if(raw.type === 'kit'){
      const k = findKit(raw.sku);
      if(!k) return res.status(400).json({ error: `Unknown kit: ${raw.sku}` });
      if(qty > k.maxQty) return res.status(400).json({ error: `${k.name} max qty is ${k.maxQty}` });
      line = { type:'kit', sku:k.sku, name:k.name, variant:null, qty, lineTotal: linePrice({type:'kit',sku:k.sku,qty}) };
    } else {
      return res.status(400).json({ error: 'Unknown line type.' });
    }
    lines.push(line);
    const u = unitsConsumed(line);
    for(const s in u) consumption[s] = (consumption[s]||0) + u[s];
  }
  if(lines.length === 0) return res.status(400).json({ error: 'No valid items.' });

  const serverTotal = lines.reduce((s,l) => s + l.lineTotal, 0);

  try{
    // --- atomically decrement inventory; rejects if anything is short ---
    const { error: invErr } = await supabase.rpc('consume_inventory', { consumption });
    if(invErr) return res.status(409).json({ error: invErr.message });

    const invoiceNumber = await nextInvoiceNumber();
    const { data: order, error: dbErr } = await supabase.from('orders').insert({
      invoice_number: invoiceNumber, rep: repObj.id, customer_name: name, phone,
      payment_method: paymentMethod, venmo_handle: venmoHandle || null,
      notes: notes || null, items: lines, units_consumed: consumption,
      total: serverTotal, status: 'pending'
    }).select().single();
    if(dbErr) throw new Error('Could not save order: ' + dbErr.message);

    const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const invoiceUrl = `${base}/api/invoice?id=${order.id}`;
    await supabase.from('orders').update({ invoice_url: invoiceUrl }).eq('id', order.id);

    // --- best-effort Discord alert to the business (never blocks the order) ---
    await notifyBusiness({ order, repObj, name, serverTotal, paymentMethod, invoiceNumber, lines, invoiceUrl });

    return res.status(200).json({ ok:true, invoiceNumber, invoiceUrl });
  }catch(err){
    return res.status(500).json({ error: err.message });
  }
}

// Sends a new-order SMS to the rep the order was directed to, via Twilio's REST API.
// Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and a
// per-rep destination number: REP_SMS_DENNIS / REP_SMS_RYAN / REP_SMS_MIKE (E.164, e.g. +12085551234).
// If credentials or this rep's number are missing, or the send fails, it logs and returns
// quietly — the order still succeeds.
async function notifyBusiness({ order, repObj, name, serverTotal, paymentMethod, invoiceNumber, lines, invoiceUrl }){
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  // pick the destination number for THIS order's rep, e.g. REP_SMS_DENNIS
  const to = process.env['REP_SMS_' + repObj.id.toUpperCase()];
  if(!sid || !token || !from){ console.error('Twilio not configured'); return; }
  if(!to){ console.error('No SMS number set for rep:', repObj.id); return; }

  const itemList = lines.map(l => {
    const label = l.type === 'kit' ? `${l.name} (kit)` : `${l.name} ${l.variant}`;
    return `${label} x${l.qty}`;
  }).join('; ');

  const body =
    `New order ${invoiceNumber} (${repObj.name})\n` +
    `${name}\n${itemList}\n` +
    `$${serverTotal.toFixed(2)} · ${paymentMethod}\n${invoiceUrl}`;

  try{
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
    });
    if(!resp.ok){ console.error('Twilio SMS failed:', resp.status, await resp.text()); }
  }catch(e){
    console.error('Twilio SMS error:', e.message);
  }
}
