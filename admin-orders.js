// GET  /api/admin-orders?rep=&status=   -> list orders (optionally filtered)
// PATCH /api/admin-orders               -> { id, status } update an order's status
// Auth: shared password via 'x-admin-token' header, checked against ADMIN_PASSWORD.

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const STATUSES = ['pending', 'paid', 'fulfilled', 'closed'];

function authed(req){
  const token = req.headers['x-admin-token'];
  return token && token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res){
  if(!authed(req)) return res.status(401).json({ error: 'Unauthorized' });

  if(req.method === 'GET'){
    const { rep, status } = req.query;
    let q = supabase.from('orders').select('*').order('created_at', { ascending: false });
    if(rep) q = q.eq('rep', rep);
    if(status) q = q.eq('status', status);
    const { data, error } = await q;
    if(error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ orders: data });
  }

  if(req.method === 'PATCH'){
    const { id, status } = req.body || {};
    if(!id || !STATUSES.includes(status)) return res.status(400).json({ error: 'Bad id or status.' });
    const patch = { status };
    if(status === 'paid') patch.paid_at = new Date().toISOString();
    if(status === 'fulfilled') patch.fulfilled_at = new Date().toISOString();
    if(status === 'closed') patch.closed_at = new Date().toISOString();
    const { data, error } = await supabase.from('orders').update(patch).eq('id', id).select().single();
    if(error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ order: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
