'use strict';

window.RouteGuide = (() => {
  const terms = window.RouteTerms || [];

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  let termCount = 0;
  let active;
  let closeTimer;

  function termLink(entry) {
    const link = node('a', entry.source);
    link.href = entry.href;
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  function annotate(target, text, docs) {
    const entries = terms.filter(({ doc, contexts }) => doc === 'mipt-'
      ? docs.some(id => id.startsWith(doc))
      : docs.some(id => id === doc || contexts?.includes(id)));
    if (!entries.length) {
      target.textContent = text;
      return;
    }
    const words = new Map(entries.flatMap(entry => [entry.term, ...(entry.aliases || [])]
      .map(word => [word.toLocaleLowerCase('ru'), entry])));
    const alternatives = [...words.keys()].sort((a, b) => b.length - a.length)
      .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp('(?<![\\p{L}\\p{N}])(' + alternatives.join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
    target.replaceChildren(...text.split(pattern).map(part => {
      const entry = words.get(part.toLocaleLowerCase('ru'));
      return entry ? termCard(entry, part) : part;
    }));
  }

  function termCard(entry, matchedText) {
    const wrap = node('span', null, 'wiki-term');
    const trigger = node('button', matchedText, 'wiki-term-trigger');
    trigger.type = 'button';
    const card = node('span', null, 'wiki-term-card');
    const definition = node('span', entry.definition, 'wiki-term-definition');
    card.id = 'wiki-term-' + ++termCount;
    definition.id = card.id + '-definition';
    card.setAttribute('popover', 'auto');
    card.append(node('strong', entry.term), definition);
    if (!entry.href.startsWith('/') || location.protocol !== 'file:') card.append(termLink(entry));
    trigger.setAttribute('popovertarget', card.id);
    trigger.setAttribute('aria-controls', card.id);
    trigger.setAttribute('aria-describedby', definition.id);
    trigger.setAttribute('aria-expanded', 'false');
    wrap.append(trigger, card);

    let pinned = false;
    function open() {
      clearTimeout(closeTimer);
      if (active === card && card.matches(':popover-open')) return;
      if (active?.matches(':popover-open')) active.hidePopover();
      card.showPopover();
      active = card;
      trigger.setAttribute('aria-expanded', 'true');
      const bounds = trigger.getBoundingClientRect();
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const top = bounds.bottom + height + 14 <= window.innerHeight
        ? bounds.bottom + 6 : Math.max(8, bounds.top - height - 6);
      card.style.left = left + 'px';
      card.style.top = top + 'px';
    }
    function closeSoon() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (!pinned && !wrap.matches(':focus-within') && card.matches(':popover-open')) card.hidePopover();
      }, 180);
    }
    trigger.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') open(); });
    trigger.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') closeSoon(); });
    trigger.addEventListener('focus', () => { if (trigger.matches(':focus-visible')) open(); });
    trigger.addEventListener('click', event => {
      event.preventDefault();
      if (pinned && card.matches(':popover-open')) {
        card.hidePopover();
        return;
      }
      open();
      pinned = true;
    });
    card.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    card.addEventListener('pointerleave', closeSoon);
    wrap.addEventListener('focusout', closeSoon);
    card.addEventListener('toggle', () => {
      if (card.matches(':popover-open')) return;
      if (active === card) active = null;
      pinned = false;
      trigger.setAttribute('aria-expanded', 'false');
    });
    return wrap;
  }

  function glossaryList(list, query = '') {
    const value = query.trim().toLocaleLowerCase('ru');
    const matches = terms.filter(entry => [entry.term, entry.definition, ...(entry.aliases || [])]
      .some(text => text.toLocaleLowerCase('ru').includes(value)))
      .sort((a, b) => a.term.localeCompare(b.term, 'ru'));
    list.replaceChildren(...matches.map(entry => {
      const item = node('div', null, 'glossary-entry');
      const description = node('dd', entry.definition);
      description.append(termLink(entry));
      item.append(node('dt', entry.term), description);
      return item;
    }));
    return matches.length;
  }

  function transition({ before, after, when }, docs) {
    const block = node('div', null, 'route-transition');
    block.setAttribute('aria-label', 'Что меняется на этапе');
    if (when) block.append(node('span', when, 'route-condition'));
    const flow = node('dl');
    const start = node('div');
    const beforeText = node('dd');
    annotate(beforeText, before, docs);
    start.append(node('dt', 'До этапа'), beforeText);
    const arrow = node('div', '→', 'route-transition-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    const end = node('div');
    const afterText = node('dd');
    annotate(afterText, after, docs);
    end.append(node('dt', 'После этапа'), afterText);
    flow.append(start, arrow, end);
    block.append(flow);
    return block;
  }

  return { annotate, glossaryList, transition };
})();
