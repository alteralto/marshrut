// The shared commission scene can change the cast and the case file.
window.CommissionScene = (() => {
  const duration = 5400;
  const artwork = `
    <rect width="960" height="460" fill="#e2eaf2"/>
    <path d="M0 302h960v158H0z" fill="#d1dce5"/>
    <g transform="translate(45 52)">
      <rect width="158" height="162" rx="20" fill="#f6f7f3"/>
      <rect x="7" y="7" width="144" height="148" rx="15" fill="#bbd2e5"/>
      <circle cx="110" cy="49" r="20" fill="#ebc895"/>
      <path d="M12 117q32-12 66 0t68-1" fill="none" stroke="#e5edf5" stroke-width="3"/>
      <path d="M79 7v148M7 81h144" stroke="#f6f7f3" stroke-width="4"/>
    </g>
    <g transform="translate(820 84)">
      <rect width="92" height="112" rx="12" fill="#b4c4d1"/>
      <rect x="7" y="7" width="78" height="98" rx="8" fill="#f6f7f3"/>
      <path d="m19 83 18-30 13 12 13-23 13 41z" fill="#a0b8cc"/>
      <circle cx="33" cy="34" r="9" fill="#e6c291"/>
    </g>
    <g class="reviewers">
      <g fill="#96a9ba" stroke="#8095a8" stroke-width="2">
        <rect x="142" y="178" width="142" height="115" rx="25"/>
        <rect x="321" y="164" width="142" height="129" rx="25"/>
        <rect x="499" y="164" width="142" height="129" rx="25"/>
        <rect x="678" y="178" width="142" height="115" rx="25"/>
      </g>
      <image data-person="0" x="128" y="104" width="170" height="190" preserveAspectRatio="xMidYMax meet"/>
      <image data-person="1" x="307" y="91" width="170" height="203" preserveAspectRatio="xMidYMax meet"/>
      <image data-person="2" x="482" y="98" width="179" height="211" preserveAspectRatio="xMidYMax meet"/>
      <image data-person="3" x="664" y="104" width="170" height="190" preserveAspectRatio="xMidYMax meet"/>
    </g>
    <path d="M94 404h772l-15 56H109z" fill="#b48d78"/>
    <path d="M108 280h744l56 111H52z" fill="#e3c6b0"/>
    <path d="M52 391h856v19H52z" fill="#c29c85"/>
    <path d="M130 291h700" stroke="#f3dac4" stroke-width="3" stroke-linecap="round"/>
    <path d="m720 308 69 1 11 26-75-1z" fill="#b9a088" opacity=".32"/>
    <path d="m716 303 69 1 12 25-75-1z" fill="#f5ece0"/>
    <path d="m729 312 41 1m-39 6 38 1" stroke="#afbdd0" stroke-width="2" stroke-linecap="round"/>
    <g class="discussion">
      <rect x="314" y="29" width="332" height="46" rx="23" fill="#f6f9fc" stroke="#bbcbd9"/>
      <path d="M335 44h19v12h-6l-5 4v-4h-8z" fill="none" stroke="#486784" stroke-width="2" stroke-linejoin="round"/>
      <text x="371" y="58" font-size="19" font-weight="650" fill="#314c66">Комиссия обсуждает материалы</text>
    </g>
    <g class="decision">
      <rect x="349" y="29" width="262" height="46" rx="23" fill="#e4f1e9" stroke="#a7c5b6"/>
      <path d="m370 52 5 5 9-11" fill="none" stroke="#32644e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="400" y="58" font-size="19" font-weight="650" fill="#254d3d">Решение принято</text>
    </g>
    <g class="packet">
      <rect x="308" y="321" width="356" height="66" rx="13" fill="#947868" opacity=".23"/>
      <rect x="302" y="314" width="356" height="66" rx="13" fill="#fbfcfe"/>
      <rect x="316" y="327" width="40" height="40" rx="10" fill="#e2eeff"/>
      <image data-part="object" x="321" y="332" width="30" height="30"/>
      <text x="371" y="344" font-size="20" fill="#22364e" font-weight="650" data-part="title" data-fit="267"/>
      <text x="371" y="365" font-size="15" fill="#526378" data-part="subtitle" data-fit="267"/>
    </g>
    <g class="protocol">
      <rect x="308" y="321" width="356" height="66" rx="13" fill="#947868" opacity=".23"/>
      <rect x="302" y="314" width="356" height="66" rx="13" fill="#fbfcfe"/>
      <rect x="316" y="327" width="40" height="40" rx="10" fill="#e1eee6"/>
      <path d="M329 334h14v24h-14zm3 6h8m-8 5h8m-8 5h6" fill="none" stroke="#32644e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="371" y="344" font-size="21" fill="#22364e" font-weight="700" data-part="result" data-fit="267">Протокол</text>
      <text x="371" y="365" font-size="15" fill="#526378" data-part="result-caption">Решение комиссии</text>
    </g>
`;

  function ease(time, start, end) {
    const progress = Math.min(1, Math.max(0, (time - start) / (end - start)));
    return progress * progress * (3 - 2 * progress);
  }

  function create(stage, portraitUrl) {
    stage.setAttribute('viewBox', '0 0 960 460');
    stage.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    stage.setAttribute('font-family', 'system-ui, sans-serif');
    stage.innerHTML = artwork;
    const part = name => stage.querySelector('[data-part="' + name + '"]');
    const packet = stage.querySelector('.packet');
    const discussion = stage.querySelector('.discussion');
    const decision = stage.querySelector('.decision');
    const protocol = stage.querySelector('.protocol');
    let meetingOnly;
    function load(config) {
      meetingOnly = config.meetingOnly;
      for (const image of stage.querySelectorAll('[data-person]')) {
        image.setAttribute('href', portraitUrl(config.portraits[Number(image.dataset.person)]));
      }
      part('title').textContent = config.document;
      part('subtitle').textContent = config.subtitle || 'Материалы к заседанию';
      part('result').textContent = config.outcome || 'Протокол';
      part('result-caption').textContent = meetingOnly ? 'Заседание комиссии' : 'Решение комиссии';
      part('object').setAttribute('href', config.art);
      for (const text of stage.querySelectorAll('[data-fit]')) {
        text.removeAttribute('textLength');
        if (text.getComputedTextLength() > Number(text.dataset.fit)) {
          text.setAttribute('textLength', text.dataset.fit);
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
      render(0);
    }

    function render(time) {
      const pass = ease(time, 650, 2050);
      const finish = ease(time, 4350, 4910);
      const discuss = ease(time, 1850, 2220) * (1 - ease(time, 3020, 3290));
      const decide = ease(time, 3300, 3570) * (1 - ease(time, 4630, 5050));
      packet.setAttribute('transform', 'translate(' + (-145 * (1 - pass)) + ' 0)');
      packet.setAttribute('opacity', 1 - ease(time, 4020, 4350));
      discussion.setAttribute('opacity', discuss);
      decision.setAttribute('opacity', meetingOnly ? 0 : decide);
      protocol.setAttribute('opacity', finish);
    }
    return { load, render };
  }

  return { create, duration };
})();
