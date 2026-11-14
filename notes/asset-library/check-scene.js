// The same checklist animation accepts a portrait and a sample set of documents.
// Each item describes presence in the example, not approval or document validity.
window.DocumentCheckScene = (() => {
  const duration = 7200;
  const ns = 'http://www.w3.org/2000/svg';
  const artwork = `
    <rect width="960" height="460" fill="#e1e9f2"/>
    <g data-part="room">
      <path d="M0 367 275 15h91L123 367zm145 0L422 15h27L201 367z" fill="#faf6ee" opacity=".64"/>
      <g transform="translate(76 55)">
        <rect x="6" y="6" width="206" height="184" rx="92" fill="#b8cadb"/>
        <rect width="206" height="184" rx="92" fill="#faf8f1"/>
        <rect x="9" y="9" width="188" height="166" rx="83" fill="#b7cce0"/>
        <circle cx="146" cy="53" r="22" fill="#edc797"/>
        <path d="M17 122q36-12 77 0t94-3m-161 23q37-8 67 0t83-1" fill="none" stroke="#e4edf5" stroke-width="2"/>
        <path d="M103 8v167M9 92h188M12 172h182" stroke="#faf8f1" stroke-width="6" stroke-linecap="round"/>
      </g>
      <path d="M133 350v-62q0-32 32-32h98v94z" fill="#7b91a8"/>
      <image data-part="person" x="129" y="69" width="297" height="289" preserveAspectRatio="xMidYMax meet"/>
      <rect y="350" width="960" height="110" fill="#c5a292"/>
      <rect y="362" width="960" height="98" fill="#dfc3ad"/>
      <path d="M0 450h960v10H0z" fill="#c2a090"/>
      <g transform="translate(69 331)">
        <path d="M18 32Q14 13-7 7m25 25Q29 11 40 7M18 32Q20 10 17-4" fill="none" stroke="#608780" stroke-width="2.5"/>
        <path d="M0 13Q-14 12-17 1-4 0 0 13m29 7q0-12 14-15 1 12-14 15M17 9Q7 3 16-8q9 7 1 17" fill="#83a59b"/>
        <path d="M1 27h35l-6 25H7z" fill="#c58e7b"/><path d="M1 27h35v5H1z" fill="#d7a18c"/>
      </g>
      <g transform="translate(318 373)">
        <ellipse cx="24" cy="49" rx="37" ry="7" fill="#956f66" opacity=".2"/>
        <path d="M42 15h10q14 0 11 12-3 10-17 10" fill="none" stroke="#7f9db7" stroke-width="6"/>
        <path d="M0 6h48l-6 36q-2 7-17 7T6 42z" fill="#a9bed1"/>
        <ellipse cx="24" cy="6" rx="24" ry="7" fill="#dae5ee"/>
        <ellipse cx="24" cy="7" rx="18" ry="4" fill="#76594f"/>
      </g>
    </g>
    <g data-part="closeup" opacity="0">
      <rect width="960" height="460" fill="#dce6f1"/>
      <circle cx="793" cy="388" r="180" fill="none" stroke="#edf3f9" stroke-width="2"/>
      <circle cx="793" cy="388" r="213" fill="none" stroke="#edf3f9" stroke-width="2"/>
    </g>
    <g data-part="card">
      <rect data-part="shadow" x="5" y="8" width="428" height="304" rx="23" fill="#546b83" opacity=".17"/>
      <rect data-part="paper" width="428" height="304" rx="23" fill="#fcfdff"/>
      <path d="M23 0h382a23 23 0 0 1 23 23v52H0V23A23 23 0 0 1 23 0z" fill="#f0f4f9"/>
      <path d="M0 75h428" stroke="#e1e7ee"/>
      <rect x="21" y="20" width="36" height="36" rx="9" fill="#e2eeff"/>
      <path d="M28 34h8l3 3h12v12H28zm0 0v-4h9l3 4h10v3" data-part="default-object" fill="none" stroke="#0066cc" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
      <image data-part="chosen-object" x="26" y="25" width="26" height="26"/> 
      <text x="70" y="35" font-size="20" font-weight="680" fill="#1d2a3b" data-part="title" data-fit="335"/>
      <text x="70" y="55" font-size="13" fill="#516478" data-part="subtitle" data-fit="335"/>
      <g data-part="rows"/>
      <g data-part="outcome" opacity="0">
        <rect data-part="outcome-fill" x="21" width="386" height="39" rx="9"/>
        <text x="35" y="25" font-size="14" font-weight="660" data-part="outcome-text" data-fit="340"/>
      </g>
    </g>`;

  function svg(tag, attributes, text) {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function buildRow(container, item, index, criteria) {
    const group = svg('g', { transform: 'translate(21 ' + (88 + index * 52) + ')' });
    const background = svg('rect', { width: 386, height: 43, rx: 8, fill: '#f5f7fa', stroke: '#e6ebf1' });
    const iconBackground = svg('circle', { cx: 21, cy: 21.5, r: 10, fill: '#e4e9ef' });
    const icon = svg('path', {
      fill: 'none', 'stroke-width': 1.65, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    const label = svg('text', { x: item.art ? 72 : 42, y: 26, 'font-size': 14, 'font-weight': 590, fill: '#263a50', 'data-fit': item.art ? 222 : 250 }, item.label);
    const status = svg('text', { x: 374, y: 26, 'font-size': 12, 'text-anchor': 'end', 'font-weight': 650 });
    group.append(background, iconBackground, icon);
    if (item.art) group.append(svg('image', { x: 40, y: 10, width: 23, height: 23, href: item.art }));
    group.append(label, status);
    container.append(group);
    return { background, iconBackground, icon, status, present: item.present, criteria, phase: null };
  }

  function setRow(row, phase) {
    if (phase === row.phase) return;
    row.phase = phase;
    const checked = phase === 'checked';
    const missing = checked && !row.present;
    const color = missing ? '#864600' : checked ? '#236448' : '#718397';
    row.background.setAttribute('stroke', phase === 'active' ? '#88baff' : '#e6ebf1');
    row.background.setAttribute('fill', phase === 'active' ? '#f0f7ff' : '#f5f7fa');
    row.iconBackground.setAttribute('fill', missing ? '#f9e8cb' : checked ? '#ddefe7' : '#e4e9ef');
    row.icon.setAttribute('stroke', color);
    row.icon.setAttribute('d', missing ? 'M21 17v5m0 3h.01' : checked ? 'M17 22l3 3 5-6' : 'M18 22h6');
    row.status.setAttribute('fill', color);
    row.status.textContent = checked ? (row.present ? (row.criteria ? 'Сверено' : 'Есть') : 'Не хватает') : '';
  }

  function ease(time, start, end) {
    const ratio = Math.min(1, Math.max(0, (time - start) / (end - start)));
    return ratio * ratio * (3 - 2 * ratio);
  }

  function create(stage, portraitUrl) {
    stage.setAttribute('viewBox', '0 0 960 460');
    stage.innerHTML = artwork;
    const parts = Object.fromEntries([...stage.querySelectorAll('[data-part]')].map(node => [node.dataset.part, node]));
    let rows = [];
    let height = 304;

    function render(time) {
      const focus = ease(time, 540, 1570);
      const scale = .88 + .28 * focus;
      const x = 464 - 233 * focus;
      const y = (460 - height * scale) / 2 - 21 * (1 - focus);
      parts.card.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + scale + ')');
      parts.closeup.setAttribute('opacity', .91 * focus);
      for (const [index, row] of rows.entries()) {
        const start = 1630 + index * (2600 / rows.length);
        const end = start + 620;
        setRow(row, time < start ? 'pending' : time < end ? 'active' : 'checked');
      }
      parts.outcome.setAttribute('opacity', ease(time, 4740, 5400));
    }

    function load(config) {
      if (config.items.length < 1 || config.items.length > 4) {
        throw new RangeError('The checklist scene supports one to four items.');
      }
      parts.person.setAttribute('href', portraitUrl(config.actor));
      parts['default-object'].style.display = config.art ? 'none' : '';
      if (config.art) parts['chosen-object'].setAttribute('href', config.art);
      else parts['chosen-object'].removeAttribute('href');
      parts.title.textContent = config.title;
      parts.subtitle.textContent = config.subtitle;
      const firstMissing = config.items.find(item => !item.present);
      parts['outcome-text'].textContent = firstMissing ? config.missingMessage : (config.completeMessage || 'Комплект собран');
      parts['outcome-text'].setAttribute('fill', firstMissing ? '#804900' : '#215941');
      parts['outcome-fill'].setAttribute('fill', firstMissing ? '#fcf0da' : '#e6f4ed');
      const outcomeY = 92 + config.items.length * 52;
      height = outcomeY + 56;
      parts.outcome.setAttribute('transform', 'translate(0 ' + outcomeY + ')');
      for (const part of [parts.paper, parts.shadow]) part.setAttribute('height', height);
      parts.rows.replaceChildren();
      rows = config.items.map((item, index) => buildRow(parts.rows, item, index, config.criteria));
      for (const text of stage.querySelectorAll('[data-fit]')) {
        text.removeAttribute('textLength');
        if (text.getComputedTextLength() > Number(text.dataset.fit)) {
          text.setAttribute('textLength', text.dataset.fit);
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
      render(0);
    }

    return { load, render };
  }

  return { create, duration };
})();
