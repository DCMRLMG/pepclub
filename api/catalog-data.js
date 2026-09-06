// Neutral product catalog + inventory.
// Single items sell by "pack" variants; kits are bundles that draw down component stock.
// Stock is tracked per base SKU (the physical unit on hand).

export const CATALOG = {
  // --- single products: each sells as a 5-pack or 10-pack of the base unit ---
  products: [
    { sku: 'BEAN-ETH', name: 'Ethiopia Roast', unit: '250g bag',
      variants: [ { label: '5-pack', packQty: 5, price: 60 }, { label: '10-pack', packQty: 10, price: 110 } ] },
    { sku: 'BEAN-COL', name: 'Colombia Roast', unit: '250g bag',
      variants: [ { label: '5-pack', packQty: 5, price: 55 }, { label: '10-pack', packQty: 10, price: 100 } ] },
    { sku: 'BEAN-SUM', name: 'Sumatra Roast', unit: '250g bag',
      variants: [ { label: '5-pack', packQty: 5, price: 58 }, { label: '10-pack', packQty: 10, price: 105 } ] },
    { sku: 'BEAN-KEN', name: 'Kenya Roast', unit: '250g bag',
      variants: [ { label: '5-pack', packQty: 5, price: 62 }, { label: '10-pack', packQty: 10, price: 115 } ] },
    { sku: 'BEAN-GTM', name: 'Guatemala Roast', unit: '250g bag',
      variants: [ { label: '5-pack', packQty: 5, price: 57 }, { label: '10-pack', packQty: 10, price: 103 } ] }
  ],

  // --- kits: a single line item, qty 1..10, that consumes component SKUs from stock ---
  kits: [
    { sku: 'KIT-1', name: 'Sampler Kit 1', price: 95, maxQty: 10,
      components: [ { sku: 'BEAN-ETH', qty: 2 }, { sku: 'BEAN-COL', qty: 2 }, { sku: 'BEAN-SUM', qty: 2 }, { sku: 'BEAN-KEN', qty: 1 } ] },
    { sku: 'KIT-2', name: 'Sampler Kit 2', price: 95, maxQty: 10,
      components: [ { sku: 'BEAN-ETH', qty: 2 }, { sku: 'BEAN-COL', qty: 2 }, { sku: 'BEAN-SUM', qty: 2 }, { sku: 'BEAN-GTM', qty: 1 } ] }
  ]
};

// Flat lookup by SKU (used to price/label and to resolve kit components).
export function findProduct(sku){ return CATALOG.products.find(p => p.sku === sku); }
export function findKit(sku){ return CATALOG.kits.find(k => k.sku === sku); }

// Given an order line, return the base-SKU units it consumes: { SKU: units, ... }
// - product line: packQty * lineQty of its own SKU
// - kit line: for each component, component.qty * lineQty of that component SKU
export function unitsConsumed(line){
  const out = {};
  if(line.type === 'product'){
    const p = findProduct(line.sku);
    const v = p?.variants.find(v => v.label === line.variant);
    if(p && v) out[p.sku] = v.packQty * line.qty;
  } else if(line.type === 'kit'){
    const k = findKit(line.sku);
    if(k) for(const c of k.components) out[c.sku] = (out[c.sku] || 0) + c.qty * line.qty;
  }
  return out;
}

// Price of a single order line.
export function linePrice(line){
  if(line.type === 'product'){
    const v = findProduct(line.sku)?.variants.find(v => v.label === line.variant);
    return v ? v.price * line.qty : 0;
  }
  if(line.type === 'kit'){
    const k = findKit(line.sku);
    return k ? k.price * line.qty : 0;
  }
  return 0;
}
