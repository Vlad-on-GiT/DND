// ══ ТУЛТИПЫ — глобальные функции вне ES-модуля ══
function _ttPos(tt, el) {
  tt.style.visibility = 'hidden';
  tt.style.display = 'block';
  var r  = el.getBoundingClientRect();
  var tw = tt.offsetWidth  || 150;
  var th = tt.offsetHeight || 60;
  var left = r.left + r.width / 2 - tw / 2;
  var top  = r.top - th - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  if (top < 8) top = r.bottom + 6;
  tt.style.left = left + 'px';
  tt.style.top  = top  + 'px';
  tt.style.visibility = 'visible';
}
function showGlobalTooltip(el, name, stat) {
  if (!name || name === 'Пусто') return;
  var tt = document.getElementById('global-tooltip');
  if (!tt) return;
  document.getElementById('gt-name').textContent = name;
  document.getElementById('gt-stat').textContent = stat || '';
  _ttPos(tt, el);
  tt.classList.add('visible');
}
function hideGlobalTooltip() {
  var tt = document.getElementById('global-tooltip');
  if (tt) { tt.classList.remove('visible'); tt.style.display = 'none'; }
}
function showItemTooltip(el, name, desc) {
  if (!name) return;
  var tt = document.getElementById('global-item-tooltip');
  if (!tt) return;
  document.getElementById('git-name').textContent = name;
  document.getElementById('git-desc').textContent = desc || '';
  _ttPos(tt, el);
  tt.classList.add('visible');
}
function hideItemTooltip() {
  var tt = document.getElementById('global-item-tooltip');
  if (tt) { tt.classList.remove('visible'); tt.style.display = 'none'; }
}
document.addEventListener('mouseover', function(e) {
  var slot = e.target.closest('[data-has-tip]');
  if (slot) showGlobalTooltip(slot, slot.dataset.tipName, slot.dataset.tipStat);
  var cell = e.target.closest('[data-item-name]');
  if (cell) showItemTooltip(cell, cell.dataset.itemName, cell.dataset.itemDesc);
});
document.addEventListener('mouseout', function(e) {
  var rt = e.relatedTarget;
  if (!rt || !rt.closest('[data-has-tip]'))  hideGlobalTooltip();
  if (!rt || !rt.closest('[data-item-name]')) hideItemTooltip();
});
