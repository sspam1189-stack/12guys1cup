for (const th of document.querySelectorAll('table.sortable th')) {
  th.addEventListener('click', () => {
    const table = th.closest('table');
    const tbody = table.tBodies[0];
    const idx = [...th.parentNode.children].indexOf(th);
    const asc = th.dataset.asc !== 'true';
    for (const h of th.parentNode.children) delete h.dataset.asc;
    th.dataset.asc = asc;
    const rows = [...tbody.rows];
    rows.sort((a, b) => {
      const av = a.cells[idx].dataset.v ?? a.cells[idx].textContent.trim();
      const bv = b.cells[idx].dataset.v ?? b.cells[idx].textContent.trim();
      const an = parseFloat(av), bn = parseFloat(bv);
      const cmp = Number.isNaN(an) || Number.isNaN(bn)
        ? String(av).localeCompare(String(bv))
        : an - bn;
      return asc ? cmp : -cmp;
    });
    tbody.append(...rows);
  });
}
