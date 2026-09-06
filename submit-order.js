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

    return res.status(200).json({ ok:true, invoiceNumber, invoiceUrl });
  }catch(err){
    return res.status(500).json({ error: err.message });
  }
}
