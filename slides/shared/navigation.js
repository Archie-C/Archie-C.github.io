/* Native links handle navigation; close the contents menu after a jump. */
(() => {
  const menu = document.querySelector('.deck-contents');
  if (!menu) return;
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
})();
