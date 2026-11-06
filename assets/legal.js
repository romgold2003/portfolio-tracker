// Legal pages: fold the contents on small screens, and mark the section being read.
(() => {
  const side = document.querySelector('.side');
  const small = matchMedia('(max-width: 900px)');
  const fit = () => { if (side) side.open = !small.matches; };
  fit();
  small.addEventListener('change', fit);

  // On a phone, picking a section folds the contents away again.
  side?.addEventListener('click', (e) => { if (e.target.closest('a') && small.matches) side.open = false; });
  // On a wide screen the contents stay open.
  side?.querySelector('summary')?.addEventListener('click', (e) => { if (!small.matches) e.preventDefault(); });

  const links = [...document.querySelectorAll('.toc a')];
  const heads = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  if (!heads.length) return;
  let ticking = false;
  const mark = () => {
    ticking = false;
    let current = null;
    for (const h of heads) if (h.getBoundingClientRect().top < 140) current = h;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = heads[heads.length - 1];
    links.forEach((a) => a.classList.toggle('active', !!current && a.hash === `#${current.id}`));
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, { passive: true });
  mark();
})();
