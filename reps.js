// Fixed set of reps an order can be directed to.
export const REPS = {
  dennis: { id: 'dennis', name: 'Dennis' },
  ryan:   { id: 'ryan',   name: 'Ryan'   },
  mike:   { id: 'mike',   name: 'Mike'   }
};
export function findRep(id){ return REPS[String(id || '').toLowerCase()] || null; }
