// Shared SVG scene for preparing a form. Examples supply the portrait,
// document name, one to four fields and an attachment; the same animation renders both.
window.DocumentPreparationScene = (() => {
  const duration = 7900;
  const ns = 'http://www.w3.org/2000/svg';
  let instance = 0;
  const artwork = `
    <defs>
      <pattern id="prepare-grain" width="33" height="31" patternUnits="userSpaceOnUse">
        <path d="M2 8h1m17 9h1M6 26h1m19-23h1" stroke="#516479" stroke-width=".8" stroke-linecap="round" opacity=".14"/>
      </pattern>
    </defs>
    <rect width="960" height="460" fill="#e3eaf2"/>
    <rect width="960" height="460" fill="url(#prepare-grain)"/>
    <g data-part="room">
      <path d="M16 357 268 22h112L133 357z" fill="#f4f4f0" opacity=".72"/>
      <g transform="translate(58 49)">
        <rect x="5" y="6" width="227" height="193" rx="95" fill="#bac9d9"/>
        <rect width="227" height="193" rx="95" fill="#faf8f2"/>
        <rect x="9" y="9" width="209" height="175" rx="87" fill="#b9cce0"/>
        <circle cx="153" cy="59" r="23" fill="#edc595"/>
        <path d="M18 130q33-13 75 0t111-2m-174 20q40-7 76 2t90 0" fill="none" stroke="#e6edf4" stroke-width="2"/>
        <path d="M112 8v177M9 96h209M14 182h199" stroke="#faf8f2" stroke-width="6" stroke-linecap="round"/>
      </g>
      <g transform="translate(846 67)">
        <rect x="4" y="5" width="70" height="83" rx="4" fill="#b8c9dc"/>
        <rect width="70" height="83" rx="4" fill="#839bb6"/>
        <rect x="5" y="5" width="60" height="73" fill="#faf5ec"/>
        <circle cx="43" cy="29" r="12" fill="#e8bf92"/>
        <path d="M11 69V57q12-21 28 0v12zm26 0V61q11-17 22-4v12z" fill="#91a6bd"/>
      </g>
      <g transform="translate(65 303)">
        <path d="M18 54Q14 24-9 15m27 38Q34 24 43 15M18 54Q19 24 16 3" fill="none" stroke="#547d79" stroke-width="2.5"/>
        <path d="M1 22q-20-2-21-18 19-3 21 18m30 11q-1-19 19-23 1 16-19 23M17 20Q5 8 16-4q11 5 1 24" fill="#789c97"/>
        <path d="M0 49h38l-7 36H7z" fill="#c48876"/><path d="M0 49h38v6H0z" fill="#dba38f"/>
      </g>
      <path d="M126 355v-58q0-35 36-35h113v93z" fill="#6a819a"/>
      <image data-part="person" x="118" y="71" width="318" height="290" preserveAspectRatio="xMidYMax meet"/>
      <rect y="352" width="960" height="108" fill="#c8a595"/>
      <rect y="363" width="960" height="97" fill="#dfc1ae"/>
      <rect y="363" width="960" height="97" fill="url(#prepare-grain)"/>
      <path d="M0 451h960v9H0z" fill="#c4a394"/>
      <g transform="translate(121 373)">
        <path d="M0 31l110-15 40 24L29 53z" fill="#a1807a" opacity=".24"/>
        <path d="M0 22 110 7l40 24L29 44z" fill="#f6ede2"/>
        <path d="M0 18 110 3l40 24L29 40z" fill="#91a7c2"/>
        <path d="m12 21 99-14m-87 20 101-14" stroke="#afc0d5" stroke-width="2"/>
      </g>
      <g transform="translate(381 355)">
        <ellipse cx="22" cy="53" rx="34" ry="7" fill="#916b60" opacity=".2"/>
        <path d="M40 16h9q16 0 13 13-3 9-18 10" fill="none" stroke="#7c95b0" stroke-width="6"/>
        <path d="M0 7h46l-6 37q-2 7-17 7T6 44z" fill="#a9bccf"/>
        <ellipse cx="23" cy="7" rx="23" ry="7" fill="#dce5ef"/><ellipse cx="23" cy="8" rx="18" ry="4.4" fill="#76554b"/>
      </g>
    </g>
    <g data-part="backdrop" opacity="0">
      <rect width="960" height="460" fill="#dce6f1"/>
      <rect width="960" height="460" fill="url(#prepare-grain)"/>
      <circle cx="815" cy="410" r="200" fill="none" stroke="#eef3f8" stroke-width="2"/>
      <circle cx="815" cy="410" r="229" fill="none" stroke="#eef3f8" stroke-width="2"/>
    </g>
    <g data-part="form" transform="translate(473 55) scale(.89)">
      <rect data-part="shadow" x="5" y="9" width="430" height="326" rx="23" fill="#526880" opacity=".18"/>
      <rect data-part="paper" width="430" height="326" rx="23" fill="#fbfcfe"/>
      <path d="M23 0h384a23 23 0 0 1 23 23v51H0V23A23 23 0 0 1 23 0z" fill="#f0f4f8"/>
      <path d="M0 74h430" stroke="#e1e7ee"/>
      <rect x="20" y="19" width="36" height="36" rx="9" fill="#e2eeff"/>
      <path d="M32 27h9l5 5v16H32zm9 0v5h5m-10 5h6m-6 4h6" data-part="default-object" fill="none" stroke="#0066cc" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
      <image data-part="chosen-object" x="25" y="24" width="26" height="26"/> 
      <text x="68" y="36" font-size="20" font-weight="690" fill="#1d2a3b" data-part="title" data-fit="345"/>
      <text x="68" y="56" font-size="13" fill="#516478" data-part="subtitle" data-fit="345"/>
      <g data-part="fields"/>
      <g data-part="attachment" opacity="0">
        <rect x="20" y="267" width="390" height="40" rx="10" fill="#e9f2fd"/>
        <path d="M44 280l-8 9a4 4 0 0 0 6 6l10-11a6 6 0 0 0-8-8l-9 10m12-4-8 9" fill="none" stroke="#0066cc" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="63" y="292" font-size="13.5" font-weight="650" fill="#245481" data-part="attachment-label"/>
        <circle cx="385" cy="287" r="10" fill="#d6e8fc"/>
        <path d="M380 287l3 3 6-6" fill="none" stroke="#0066cc" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </g>`;

  function node(tag, attributes, text) {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function field(parent, id, y, data) {
    const row = node('g', { transform: 'translate(20 ' + y + ')' });
    const outline = node('rect', { width: 390, height: 37, rx: 8, fill: '#f5f7fa', stroke: '#e1e7ee' });
    const title = node('text', { x: 12, y: 14, 'font-size': 10.5, fill: '#516478' }, data.label);
    const clip = node('clipPath', { id });
    const reveal = node('rect', { x: 11, y: 16, width: 0, height: 17 });
    const value = node('text', { x: 12, y: 29, 'font-size': 13.5, fill: '#223951', 'font-weight': 620, 'clip-path': 'url(#' + id + ')' }, data.value);
    const caret = node('rect', { x: 12, y: 19, width: 1.5, height: 12, fill: '#0066cc', opacity: 0 });
    clip.append(reveal);
    row.append(outline, title, clip, value, caret);
    parent.append(row);
    return { outline, width: Math.min(366, value.getComputedTextLength()), reveal, caret };
  }

  function ease(time, start, end) {
    const t = Math.min(1, Math.max(0, (time - start) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function mix(from, to, ratio) {
    return from + (to - from) * ratio;
  }

  function create(stage, portraitUrl) {
    const prefix = 'prepare-' + ++instance;
    stage.setAttribute('viewBox', '0 0 960 460');
    stage.innerHTML = artwork.replaceAll('prepare-grain', prefix + '-grain');
    const parts = Object.fromEntries([...stage.querySelectorAll('[data-part]')].map(item => [item.dataset.part, item]));
    let fields = [];
    let shorter = 0;

    function load(config) {
      if (config.fields.length < 1 || config.fields.length > 4) {
        throw new RangeError('The form scene supports one to four fields.');
      }
      parts.person.setAttribute('href', portraitUrl(config.actor));
      parts['default-object'].style.display = config.art ? 'none' : '';
      if (config.art) parts['chosen-object'].setAttribute('href', config.art);
      else parts['chosen-object'].removeAttribute('href');
      parts.title.textContent = config.document.title;
      parts.subtitle.textContent = config.document.subtitle;
      parts['attachment-label'].textContent = config.attachment || '';
      parts.attachment.style.display = config.attachment ? '' : 'none';
      parts.fields.replaceChildren();
      shorter = (4 - config.fields.length) * 42;
      for (const part of [parts.paper, parts.shadow]) part.setAttribute('height', 326 - shorter);
      fields = config.fields.map((data, index) => field(parts.fields, prefix + '-field-' + index, 91 + index * 42, data));
      render(0);
    }

    function render(time) {
      const zoom = ease(time, 650, 2080);
      const settle = ease(time, 6500, 7540);
      const focus = zoom * (1 - .2 * settle);
      const x = mix(473, 233, focus);
      const y = mix(55 + shorter * .43, 42 + shorter * .55, focus);
      const scale = mix(.89, 1.15, focus);
      parts.form.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + scale + ')');
      parts.room.setAttribute('opacity', 1 - .82 * zoom);
      parts.backdrop.setAttribute('opacity', .91 * zoom);

      for (const [index, row] of fields.entries()) {
        const start = 2290 + index * (2400 / fields.length);
        const end = start + Math.min(750, 2250 / fields.length);
        const active = time >= start && time < end;
        const width = row.width * ease(time, start, end);
        row.reveal.setAttribute('width', width + (time >= end ? 3 : 0));
        row.caret.setAttribute('x', 12 + width);
        row.caret.setAttribute('opacity', active ? 1 : 0);
        row.outline.setAttribute('stroke', active ? '#8bbcff' : '#e1e7ee');
        row.outline.setAttribute('fill', active ? '#f1f7ff' : '#f5f7fa');
      }
      const attachment = ease(time, 5350, 6350);
      parts.attachment.setAttribute('opacity', attachment);
      parts.attachment.setAttribute('transform', 'translate(0 ' + (mix(12, 0, attachment) - shorter) + ')');
    }

    return { load, render };
  }

  return { create, duration };
})();
