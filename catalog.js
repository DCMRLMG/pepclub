// GET /api/catalog
// Serves the catalog to the browser as JSON, so the form has a single source of truth.
// Only the display fields the form needs are sent (names, variants, prices, kit qty caps) —
// kit component recipes stay server-side.

import { CATALOG } from './catalog-data.js';

export default function handler(req, res){
  const payload = {
    products: CATALOG.products.map(p => ({
      sku: p.sku, name: p.name, unit: p.unit,
      variants: p.variants.map(v => ({ label: v.label, price: v.price }))
    })),
    kits: CATALOG.kits.map(k => ({
      sku: k.sku, name: k.name, price: k.price, maxQty: k.maxQty
    }))
  };
  res.setHeader('Cache-Control', 'public, max-age=60'); // brief cache; edits show within a minute
  return res.status(200).json(payload);
}
