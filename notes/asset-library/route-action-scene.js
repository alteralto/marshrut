// Shared desk scene: people stay seated while props and records change on the table.
window.RouteActionScene = (() => {
  const duration = 6600;
  const artwork = `
    <rect width="960" height="460" fill="#dce6f1"/>
    <circle cx="116" cy="108" r="79" fill="#f9f7ee"/>
    <circle cx="116" cy="108" r="70" fill="#b4cadf"/>
    <circle cx="141" cy="83" r="20" fill="#eac695"/>
    <path d="M46 108h140M116 38v140" stroke="#f9f7ee" stroke-width="5"/>
    <path d="m37 244 146-136h66L114 244z" fill="#fff" opacity=".22"/>
    <path d="M0 323h960v137H0z" fill="#e9dfd4"/>
    <path d="M0 323h960M0 383h960m-810-60-52 137m274-137-17 137m274-137 20 137m222-137 54 137" stroke="#d6c7b9" stroke-width="2"/>
    <g data-part="office">
      <rect x="762" y="66" width="140" height="148" rx="8" fill="#c4b7a9"/>
      <path d="M774 78h116v58H774zm0 70h116v54H774z" fill="#e8dfd3"/>
      <path d="M789 91v39m14-43v43m17-35v35m16-45v45" stroke="#8b9caa" stroke-width="10"/>
      <path d="M790 163v33m16-37v37m16-30v30" stroke="#b88c80" stroke-width="10"/>
      <rect x="851" y="175" width="27" height="23" rx="4" fill="#f9f7ee"/>
      <path d="M865 174v-26m0 15q-23-16-19-26 19 0 19 26m0-5q20-18 23-6-3 12-23 13" fill="#7e9b87"/>
    </g>
    <g data-part="hall">
      <path d="M0 0h42v245q47-56 50-245zm960 0h-42v245q-47-56-50-245z" fill="#b88c99"/>
      <path d="M400 65h160v70H400z" fill="#f9f7ee"/>
      <path d="M429 105v-20m0 15 19-4v-18m-19 27c-13-7-19 10-6 10 6 0 8-4 6-10m19-5c-13-7-19 10-6 10 6 0 8-4 6-10" fill="#877d9b"/>
      <path data-part="lights" d="m470 85 12 12 30-20m-8 27 12 12 30-20" fill="none" stroke="#eac695" stroke-width="5"/>
    </g>
    <g data-part="left-chair">
      <rect x="81" y="160" width="192" height="148" rx="28" fill="#9eacba"/>
      <path d="M98 295v59m158-59v59" stroke="#7e8a98" stroke-width="9"/>
    </g>
    <g data-part="right-chair">
      <rect x="687" y="160" width="192" height="148" rx="28" fill="#9eacba"/>
      <path d="M704 295v59m158-59v59" stroke="#7e8a98" stroke-width="9"/>
    </g>
    <g data-part="left-person">
      <image data-part="left-art" x="63" y="37" width="228" height="238" preserveAspectRatio="xMidYMax meet"/>
    </g>
    <g data-part="right-person">
      <image data-part="right-art" x="669" y="37" width="228" height="238" preserveAspectRatio="xMidYMax meet"/>
    </g>
    <path d="M61 352v96h19l13-96m774 0v96h19l13-96" fill="#af8d80"/>
    <path d="M48 246h864l30 109H18z" fill="#e3c6b0"/>
    <path d="M18 355h924v17H18z" fill="#c4a18c"/>
    <path d="M70 259h820" stroke="#f1d9c2" stroke-width="3"/>
    <g data-part="left-rest">
      <path data-part="left-rest-sleeve" d="M119 213Q102 228 102 254Q100 271 132 276" fill="none" stroke="#7e8a98" stroke-width="25" stroke-linecap="round"/>
      <path data-part="left-rest-hand" d="M130 267l12 2q6-6 10-3 2 2-4 6l13 3q8 2 5 6-4 6-18 4l-18-4z" fill="#e8ac86"/>
    </g>
    <g data-part="right-rest" transform="translate(960 0) scale(-1 1)">
      <path data-part="right-rest-sleeve" d="M119 213Q102 228 102 254Q100 271 132 276" fill="none" stroke="#7e8a98" stroke-width="25" stroke-linecap="round"/>
      <path data-part="right-rest-hand" d="M130 267l12 2q6-6 10-3 2 2-4 6l13 3q8 2 5 6-4 6-18 4l-18-4z" fill="#f3c39f"/>
    </g>
    <g data-part="left-arm">
      <path data-part="left-sleeve" d="M234 213Q252 228 252 250Q252 268 275 279" fill="none" stroke="#7e8a98" stroke-width="25" stroke-linecap="round"/>
      <path data-part="left-hand" d="M272 271l13 5q7-7 11-3 1 2-4 6l13 4q6 2 4 6-4 6-18 2l-19-6z" fill="#e8ac86"/>
    </g>
    <g data-part="right-arm">
      <g transform="translate(960 0) scale(-1 1)">
        <path data-part="right-sleeve" d="M234 213Q252 228 252 250Q252 268 275 279" fill="none" stroke="#7e8a98" stroke-width="25" stroke-linecap="round"/>
        <path data-part="right-hand" d="M272 271l13 5q7-7 11-3 1 2-4 6l13 4q6 2 4 6-4 6-18 2l-19-6z" fill="#f3c39f"/>
      </g>
    </g>
    <g data-part="monitor" transform="translate(72 14) scale(.85)">
      <ellipse cx="480" cy="347" rx="87" ry="9" fill="#8e685a" opacity=".25"/>
      <rect x="343" y="76" width="274" height="242" rx="17" fill="#8195a8"/>
      <rect x="356" y="89" width="248" height="216" rx="9" fill="#fbfcfe"/>
      <path d="M467 315h26l7 22h40q8 0 8 10H412q0-10 8-10h40z" fill="#63798b"/>
      <circle cx="480" cy="311" r="3" fill="#dce6f1"/>
    </g>
    <g transform="translate(-24 184) scale(1.05 .58)" data-part="target">
      <rect x="359" y="93" width="242" height="218" rx="28" fill="#fff8ef"/>
      <g data-part="calendar">
        <path d="M382 158h196m-196 44h196m-196 44h196m-147-115v148m49-148v148m49-148v148" fill="none" stroke="#dbd1e1" stroke-width="3"/>
        <rect data-part="slot" x="483" y="205" width="43" height="38" rx="8" fill="#72ac8a"/>
        <path data-part="slot-tick" d="m493 222 8 8 16-17" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g data-part="registry">
        <path d="M382 144h196m-196 50h196m-196 50h196" stroke="#ded7e4" stroke-width="3"/>
        <g data-part="registry-row">
          <rect x="378" y="199" width="204" height="41" rx="10" fill="#dceee6"/>
          <path d="m392 219 7 7 15-15m18 3h124m-124 10h95" fill="none" stroke="#488268" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
    </g>
    <g data-part="schedule" opacity="0">
      <rect x="326" y="131" width="308" height="203" rx="18" fill="#fbf8f1" stroke="#a9bbca" stroke-width="3"/>
      <path d="M327 149q0-17 17-17h272q17 0 17 17v33H327z" fill="#dce7f0"/>
      <text x="480" y="164" text-anchor="middle" font-size="23" font-weight="700" fill="#22364e" data-part="schedule-title"/>
      <g data-part="schedule-days">
        <rect x="351" y="200" width="57" height="47" rx="8" fill="#e9e3df"/>
        <rect x="418" y="200" width="57" height="47" rx="8" fill="#e9e3df"/>
        <rect x="485" y="200" width="57" height="47" rx="8" fill="#fff" stroke="#8b9cae" stroke-width="2"/>
        <rect x="552" y="200" width="57" height="47" rx="8" fill="#e9e3df"/>
        <path d="M366 223h27m40 0h27m107 0h27" stroke="#aaa099" stroke-width="3" stroke-linecap="round"/>
        <g data-part="schedule-free">
          <rect x="485" y="200" width="57" height="47" rx="8" fill="#dfe9f3" stroke="#4c6e8a" stroke-width="2"/>
          <circle cx="514" cy="224" r="10" fill="none" stroke="#4c6e8a" stroke-width="3"/>
        </g>
        <g data-part="schedule-record">
          <rect x="485" y="200" width="57" height="47" rx="8" fill="#477861"/>
          <path d="m502 224 8 8 15-16" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
      <g data-part="schedule-conversation">
        <rect x="374" y="188" width="174" height="34" rx="12" fill="#e3edf5"/>
        <text x="461" y="211" text-anchor="middle" font-size="18" font-weight="650" fill="#22364e">Предлагаю дату</text>
        <g data-part="schedule-reply">
          <rect x="441" y="230" width="157" height="34" rx="12" fill="#dfede4"/>
          <text x="519" y="253" text-anchor="middle" font-size="18" font-weight="650" fill="#294d3d">Подходит</text>
        </g>
      </g>
      <text x="480" y="301" text-anchor="middle" font-size="23" font-weight="700" data-part="schedule-status"/>
    </g>
    <g data-part="review-document">
      <rect x="296" y="93" width="392" height="254" rx="20" fill="#67584e" opacity=".16"/>
      <rect x="284" y="80" width="392" height="254" rx="20" fill="#f9f8f4" stroke="#b7c7d6" stroke-width="2"/>
      <path d="M285 101a20 20 0 0 1 20-20h350a20 20 0 0 1 20 20v57H285Z" fill="#e3ebf3"/>
      <image data-part="review-art" x="305" y="99" width="39" height="39"/>
      <text x="360" y="113" font-size="22" font-weight="700" data-part="review-title" fill="#22364e" data-fit="291"/>
      <text x="360" y="137" font-size="17" data-part="review-mode" fill="#435b73"/>
      <g data-part="review-checks" font-size="21" fill="#293f53">
        <rect x="306" y="173" width="348" height="39" rx="9" fill="#eef1f3"/>
        <rect x="306" y="220" width="348" height="39" rx="9" fill="#eef1f3"/>
        <text x="357" y="199">Проект документа</text>
        <text x="357" y="246">Требования к документу</text>
        <rect x="320" y="183" width="18" height="18" rx="4" fill="#fff" stroke="#8da0b2" stroke-width="2"/>
        <rect x="320" y="230" width="18" height="18" rx="4" fill="#fff" stroke="#8da0b2" stroke-width="2"/>
        <path data-part="review-first-tick" d="m324 192 4 4 7-9" fill="none" stroke="#32644e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path data-part="review-second-tick" d="m324 239 4 4 7-9" fill="none" stroke="#32644e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g data-part="review-electronic">
        <rect x="306" y="176" width="348" height="79" rx="12" fill="#ebeff9"/>
        <path d="M329 190h28v25h-28Z" stroke="#485b86" stroke-width="2" fill="none" stroke-linejoin="round"/>
        <path d="M335 197h16m-16 6h12" stroke="#485b86" stroke-width="2" stroke-linecap="round"/>
        <circle cx="350" cy="215" r="6" fill="#485b86"/>
        <text x="375" y="207" font-size="21" font-weight="650" fill="#394870">Электронная подпись</text>
        <text x="375" y="232" font-size="17" data-part="review-certificate" fill="#435b73"/>
      </g>
      <g data-part="review-paper">
        <text x="314" y="243" font-size="20" fill="#435b73" data-part="review-paper-label"/>
        <path d="M484 249h170" stroke="#9c90aa" stroke-width="2"/>
        <path data-part="signature" pathLength="1" d="M492 238q28-40 35-23 6 12-24 25 31-17 45-15l-6 12q22-9 36-4l-3 5 36-3" fill="none" stroke="#5a4b8f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g data-part="review-outcome">
        <rect data-part="review-badge" x="306" y="277" width="348" height="40" rx="10"/>
        <text x="480" y="304" text-anchor="middle" data-part="review-status" font-size="22" font-weight="700"/>
      </g>
    </g>
    <g transform="translate(72 14) scale(.85)" data-part="account">
      <text x="480" y="140" text-anchor="middle" font-size="21" font-weight="700" fill="#4e3856" data-part="account-name"/>
      <rect x="385" y="164" width="190" height="28" rx="14" fill="#efe6ee"/>
      <rect data-part="account-fill" x="385" y="164" width="0" height="28" rx="14" fill="#72ac8a"/>
      <text x="480" y="232" text-anchor="middle" font-size="19" fill="#6a5a6c" data-part="account-note"/>
      <g data-part="account-return">
        <path d="M420 270h112m0 0-12-9m12 9-12 9" fill="none" stroke="#b07b47" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" transform="rotate(180 476 270)"/>
        <text x="480" y="300" text-anchor="middle" font-size="20" font-weight="650" fill="#8a5d34" data-fit="210">Возврат по графику</text>
      </g>
    </g>
    <g transform="translate(-24 130) scale(1.05 .8)" data-part="interview" opacity="0">
      <g data-part="interview-question" transform="translate(0 -100)">
        <path d="M294 135h150a18 18 0 0 1 18 18v40a18 18 0 0 1-18 18H334l-24 17v-17h-16a18 18 0 0 1-18-18v-40a18 18 0 0 1 18-18Z" fill="#fbf1da"/>
        <text x="369" y="181" text-anchor="middle" font-size="24" font-weight="700" fill="#524153">Вопрос</text>
      </g>
      <g data-part="interview-answer" transform="translate(0 -100)">
        <path d="M516 135h150a18 18 0 0 1 18 18v40a18 18 0 0 1-18 18h-16v17l-24-17H516a18 18 0 0 1-18-18v-40a18 18 0 0 1 18-18Z" fill="#e2eef8"/>
        <text x="591" y="181" text-anchor="middle" font-size="24" font-weight="700" fill="#37495f">Ответ</text>
      </g>
      <g data-part="interview-notes">
        <rect x="413" y="133" width="134" height="125" rx="20" fill="#edf4e4"/>
        <path d="M438 168h80m-80 18h64m-64 18h80m-80 18h55" stroke="#638561" stroke-width="5" stroke-linecap="round"/>
      </g>
    </g>
    <g transform="translate(-24 111) scale(1.05 .8)" data-part="branch">
      <path data-part="branch-lines" fill="none" stroke="#e9bed7" stroke-width="4"/>
      <g data-part="branch-cards"/>
    </g>
    <g data-part="followup">
      <rect x="302" y="109" width="356" height="211" rx="20" fill="#687f96" opacity=".2"/>
      <rect x="296" y="102" width="368" height="211" rx="20" fill="#fbfcfe" stroke="#aebfce" stroke-width="2"/>
      <path d="M316 103h328a19 19 0 0 1 19 19v37H297v-37a19 19 0 0 1 19-19z" fill="#e4edf6"/>
      <image data-part="followup-icon" x="310" y="117" width="28" height="28"/>
      <text x="350" y="137" font-size="20" font-weight="700" fill="#22364e" data-part="followup-title" data-fit="292"/>
      <rect x="312" y="177" width="304" height="43" rx="12" fill="#eaf2fc"/>
      <text x="327" y="204" font-size="19" font-weight="650" fill="#244968" data-part="followup-message" data-fit="272"/>
      <g data-part="followup-response">
        <rect x="343" y="237" width="305" height="49" rx="12" fill="#e4efe9"/>
        <path d="m359 260 5 5 9-11" fill="none" stroke="#397358" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="383" y="268" font-size="19" font-weight="650" fill="#27543f" data-part="followup-reply" data-fit="250"/>
      </g>
    </g>
    <g data-part="prop">
      <ellipse cx="0" cy="49" rx="58" ry="10" fill="#ac8b83" opacity=".22"/>
      <image data-part="icon" x="-56" y="-56" width="112" height="112"/>
    </g>
    <rect x="32" y="380" width="272" height="30" rx="10" fill="#f9f7ee"/>
    <text data-part="left-name" x="168" y="401" fill="#22364e" text-anchor="middle" font-size="20" font-weight="650"/>
    <g data-part="right-caption">
      <rect x="656" y="380" width="272" height="30" rx="10" fill="#f9f7ee"/>
      <text data-part="right-name" x="792" y="401" fill="#22364e" text-anchor="middle" font-size="20" font-weight="650"/>
    </g>
    <text data-part="object-name" x="480" y="399" fill="#4e3856" text-anchor="middle" font-size="20" font-weight="650"/>
    <g data-part="result">
      <rect x="240" y="417" width="480" height="36" rx="18" fill="#f8ece6"/>
      <circle data-part="indicator" cx="263" cy="435" r="10" fill="#b080a0"/>
      <path data-part="tick" d="m257 434 4 4 8-9" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text data-part="label" x="492" y="443" fill="#322741" text-anchor="middle" font-size="24" font-weight="700"/>
    </g>
    <g data-part="timeline" opacity="0">
      <rect x="76" y="51" width="808" height="309" rx="28" fill="#f9f7ee" stroke="#b5c8d9" stroke-width="3"/>
      <text data-part="timeline-term" x="480" y="116" text-anchor="middle" font-size="33" font-weight="750" fill="#22364e"/>
      <path d="M157 239H803m-15-11 15 11-15 11" fill="none" stroke="#92a6b7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <g data-part="timeline-cells"/>
      <text data-part="timeline-event" y="306" text-anchor="middle" font-size="23" font-weight="700" fill="#815b42"/>
      <text data-part="timeline-deadline" y="306" text-anchor="middle" font-size="23" font-weight="700" fill="#234e3d">Крайний срок</text>
    </g>`;

  function ease(time, from, to) {
    const t = Math.max(0, Math.min(1, (time - from) / (to - from)));
    return t * t * (3 - 2 * t);
  }
  const mix = (a, b, t) => a + (b - a) * t;

  function create(stage) {
    stage.setAttribute('viewBox', '0 0 960 460');
    stage.setAttribute('font-family', 'system-ui, sans-serif');
    stage.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    stage.innerHTML = artwork;
    const parts = Object.fromEntries([...stage.querySelectorAll('[data-part]')].map(node => [node.dataset.part, node]));
    const attr = (part, name, value) => parts[part].setAttribute(name, value);
    const fade = (part, value) => attr(part, 'opacity', value);
    const label = (part, value) => { if (parts[part].textContent !== value) parts[part].textContent = value; };
    let data;
    let cells = [];
    let timeline = null;
    const ns = 'http://www.w3.org/2000/svg';

    function load(config) {
      data = config;
      const [left, right] = data.cast;
      attr('left-art', 'href', left.art);
      label('left-name', left.label);
      if (right) {
        attr('right-art', 'href', right.art);
        label('right-name', right.label);
      }
      if (!right) label('right-name', '');
      fade('right-person', right ? 1 : 0);
      attr('icon', 'href', data.art);
      attr('review-art', 'href', data.art);
      label('object-name', data.objectLabel || '');
      if (data.effect === 'followup') {
        const [message, reply] = {
          clarify: ['Нужны дополнительные сведения', 'Автор добавил сведения'],
          escalate: ['Материалы по обращению', 'Передано специалистам'],
          confirm: ['Проверьте результат работ', 'Автор подтвердил результат'],
        }[data.layout];
        attr('followup-icon', 'href', data.art);
        label('followup-title', data.objectLabel || 'Обращение');
        label('followup-message', data.message || message);
        label('followup-reply', data.reply || reply);
      }
      const clothes = {
        employee: ['#7a9689', '#e8ac86'], specialist: ['#946b86', '#f6c7a9'],
        director: ['#5c607c', '#f1bb9c'], finance: ['#9a714f', '#f0bd9c'],
        student: ['#687eaa', '#f4bf9e'], secretary: ['#b95745', '#f6bb9e'],
        'member-one': ['#779396', '#e8ab86'], 'member-two': ['#735981', '#f2bb9d'],
      };
      for (const side of ['left', 'right']) {
        const actor = side === 'left' ? left : right;
        fade(side + '-chair', actor ? 1 : 0);
        fade(side + '-arm', actor ? 1 : 0);
        fade(side + '-rest', actor ? 1 : 0);
        const [coat, skin] = clothes[actor?.art.split('#').pop()] || ['#7e8a98', '#e8ac86'];
        for (const part of ['', '-rest']) {
          attr(side + part + '-sleeve', 'stroke', coat);
          attr(side + part + '-hand', 'fill', skin);
        }
      }
      fade('right-caption', right ? 1 : 0);
      const hall = data.setting === 'concert';
      fade('hall', hall ? 1 : 0);
      fade('office', hall ? 0 : 1);
      fade('registry', data.layout === 'list' ? 1 : 0);
      attr('slot', 'fill', data.effect === 'availability' ? '#a77ea9' : '#72ac8a');
      const approval = data.effect === 'approve';
      const electronic = data.effect === 'sign' && data.layout === 'electronic';
      const acceptance = data.layout === 'acceptance';
      label('review-title', data.objectLabel || 'Документ');
      label('review-mode', approval ? 'Согласование' : acceptance ? 'Передача под роспись' : 'Подписание');
      label('review-paper-label', acceptance ? 'Подпись получателя' : 'Подпись');
      label('review-status', approval ? 'Согласовано' : electronic ? 'Подписано ЭП' : acceptance ? 'Принято под роспись' : 'Подписано');
      attr('review-badge', 'fill', approval ? '#dceee6' : '#e0e6f7');
      attr('review-status', 'fill', approval ? '#234e3d' : '#394870');
      fade('review-checks', approval ? 1 : 0);
      fade('review-electronic', electronic ? 1 : 0);
      fade('review-paper', !approval && !electronic ? 1 : 0);
      const agreement = data.layout === 'agreement';
      const record = data.layout === 'record';
      label('schedule-title', agreement ? 'Предложенная дата' : 'График');
      label('schedule-status', agreement ? 'Дата согласована' : record ? 'Запись внесена' : 'Свободное время найдено');
      attr('schedule-status', 'fill', agreement || record ? '#294d3d' : '#395873');
      fade('schedule-days', agreement ? 0 : 1);
      fade('schedule-conversation', agreement ? 1 : 0);
      const branches = data.branches || [];
      const centers = branches.length === 3 ? [310, 480, 650] : [380, 580];
      const branchWidth = branches.length === 3 ? 156 : 184;
      parts['branch-cards'].replaceChildren();
      attr('branch-lines', 'd', 'M480 146v44' + centers.map(x => ' M480 190H' + x + 'v37').join(''));
      branches.forEach((branch, index) => {
        const box = document.createElementNS(ns, 'rect');
        box.setAttribute('x', centers[index] - branchWidth / 2);
        box.setAttribute('y', '227');
        box.setAttribute('width', branchWidth);
        box.setAttribute('height', '68');
        box.setAttribute('rx', '15');
        box.setAttribute('fill', index % 2 ? '#ece1f5' : '#fff2de');
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', centers[index]);
        text.setAttribute('y', '269');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#4e3856');
        text.setAttribute('font-size', '22');
        text.setAttribute('font-weight', '700');
        text.dataset.fit = branchWidth - 16;
        text.textContent = branch;
        parts['branch-cards'].append(box, text);
      });
      fade('monitor', data.effect === 'pay' ? 1 : 0);
      fade('account', 0);
      fade('timeline', 0);
      fade('account-return', 0);
      label('account-name', data.account || 'Лицевой счёт');
      label('account-note', data.layout === 'refund' ? 'Возврат остатка' : 'Перечисление средств');
      // Short periods in days show individual marks. Other periods show their endpoints.
      const cellsGroup = parts['timeline-cells'];
      cellsGroup.replaceChildren();
      if (data.effect === 'deadline') {
        const before = data.layout !== 'after';
        const dayCount = Number(data.term?.match(/(\d+)\s*(?:(?:рабочих|раб\.|календарных)\s*)?(?:дней|дня|день)/iu)?.[1]);
        const span = dayCount > 0 && dayCount <= 8 ? dayCount : 1;
        const eventIndex = before ? span : 0;
        const deadlineIndex = before ? 0 : span;
        const cx = index => 210 + index * 540 / span;
        cells = [];
        for (let i = 0; i <= span; i += 1) {
          const cell = document.createElementNS(ns, 'circle');
          cell.setAttribute('cx', cx(i));
          cell.setAttribute('cy', 239);
          cell.setAttribute('r', i === eventIndex || i === deadlineIndex ? 22 : 11);
          cell.setAttribute('fill', i === eventIndex ? '#e7b36d' : '#f9f7ee');
          cell.setAttribute('stroke', '#92a6b7');
          cell.setAttribute('stroke-width', '2');
          cellsGroup.append(cell);
          cells.push(cell);
        }
        timeline = { eventIndex, deadlineIndex, span };
        label('timeline-term', data.term || 'Срок по регламенту');
        attr('timeline-event', 'x', cx(eventIndex));
        label('timeline-event', data.eventLabel || 'Событие');
        attr('timeline-deadline', 'x', cx(deadlineIndex));
      }
      render(0);
      fitLabels();
    }

    function fitLabels() {
      const widths = {
        'object-name': 328, 'left-name': 252, 'right-name': 252, label: 385,
        'account-name': 210, 'account-note': 210, 'timeline-term': 660,
        'timeline-event': 244, 'timeline-deadline': 244,
      };
      for (const [name, width] of Object.entries(widths)) parts[name].dataset.fit = width;
      for (const text of stage.querySelectorAll('[data-fit]')) {
        text.removeAttribute('textLength');
        if (text.getComputedTextLength() > Number(text.dataset.fit)) {
          text.setAttribute('textLength', text.dataset.fit);
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
    }

    function render(time) {
      const arrive = ease(time, 600, 2400);
      const finishAt = data.effect === 'deadline' ? Math.max(5100, 3850 + timeline.span * 260) : 5100;
      const finish = ease(time, 3550, finishAt);
      const closeup = ease(time, 2480, 3350);
      const focus = ['register', 'availability', 'sign', 'approve', 'pay'].includes(data.effect);
      const reviewing = data.effect === 'approve' || data.effect === 'sign';
      const schedule = data.effect === 'schedule';
      const deadline = data.effect === 'deadline';
      const branches = data.effect === 'branch';
      const interview = data.effect === 'interview';
      const followup = data.effect === 'followup';
      const [, right] = data.cast;
      // Props slide along the desktop; the endpoints meet the actors' hands.
      const to = right && !focus && !schedule && !branches && data.effect !== 'light' ? 663 : 480;
      const x = mix(mix(294, 480, arrive), to, finish);
      attr('prop', 'transform', 'translate(' + x + ' 310) scale(.72)');
      fade('prop', focus || schedule || interview || branches || deadline || followup ? 1 - closeup : 1);
      fade('followup', followup ? closeup : 0);
      fade('followup-response', ease(time, 4000, 4650));
      if (followup) {
        const shift = data.layout === 'escalate' ? mix(-36, 40, finish) : 0;
        attr('followup', 'transform', 'translate(' + shift + ' 0)');
      }
      fade('schedule', schedule ? closeup : 0);
      if (schedule) {
        fade('schedule-free', data.layout === 'availability' ? finish : 0);
        fade('schedule-reply', ease(time, 3380, 4750));
        fade('schedule-record', data.layout === 'record' ? finish : 0);
        fade('schedule-status', ease(time, 4630, 5250));
      }
      fade('interview', interview ? closeup : 0);
      if (interview) {
        fade('interview-question', 1 - finish);
        fade('interview-answer', ease(time, 2800, 3650) * (1 - finish));
        fade('interview-notes', finish);
      }
      fade('target', focus && !reviewing && data.effect !== 'pay' ? closeup : 0);
      fade('calendar', focus && (data.effect === 'availability' || data.layout === 'calendar') ? 1 : 0);
      // the card contents appear together with the card, not before it
      fade('account', data.effect === 'pay' ? closeup : 0);
      if (data.effect === 'pay') {
        const share = finish;
        attr('account-fill', 'width', 190 * share);
        attr('account-fill', 'fill', data.layout === 'refund' ? '#b07b47' : '#72ac8a');
        fade('account-return', data.layout === 'loan' ? ease(time, 4700, 5500) : 0);
      }
      if (deadline) {
        fade('timeline', closeup);
        const { eventIndex, deadlineIndex } = timeline;
        const { span } = timeline;
        cells.forEach((cell, i) => {
          if (i === eventIndex) return;
          // the days between the event and the deadline light up one by one, from the event
          const order = Math.abs(i - eventIndex);
          const lit = ease(time, 3550 + (order - 1) * 260, 3550 + order * 260) > .5;
          cell.setAttribute('fill', lit ? (i === deadlineIndex ? '#72ac8a' : '#b4cadf') : '#f9f7ee');
        });
        fade('timeline-deadline', ease(time, 3550 + span * 260 - 200, 3550 + span * 260 + 200));
      }
      fade('branch', branches ? closeup : 0);
      fade('slot', finish);
      fade('slot-tick', data.effect === 'availability' ? 0 : ease(time, 4550, 5140));
      fade('review-document', reviewing ? closeup : 0);
      if (reviewing) {
        fade('review-first-tick', ease(time, 3350, 3900));
        fade('review-second-tick', ease(time, 4150, 4750));
        attr('signature', 'stroke-dasharray', '1');
        attr('signature', 'stroke-dashoffset', 1 - finish);
        label('review-certificate', time < 4750 ? 'Подпись подтверждается' : 'Подпись применена');
        fade('review-outcome', ease(time, 4750, 5300));
      }
      fade('registry-row', finish);
      fade('lights', ['light', 'show'].includes(data.effect) ? .18 + .82 * finish : .32);
      const nod = Math.sin(Math.PI * closeup) * 3;
      attr('left-person', 'transform', 'rotate(' + nod + ' 177 260)');
      attr('right-person', 'transform', 'rotate(' + (-nod) + ' 783 260)');
      const passes = data.effect === 'pass';
      attr('left-arm', 'transform', 'rotate(' + (passes ? -5 * Math.sin(Math.PI * arrive) : 0) + ' 234 213)');
      attr('right-arm', 'transform', 'rotate(' + (passes ? 5 * Math.sin(Math.PI * finish) : 0) + ' 726 213)');
      const state = time < 2400 ? 0 : time < finishAt ? 1 : 2;
      if (parts.label.textContent !== data.labels[state]) {
        label('label', data.labels[state]);
        parts.label.removeAttribute('textLength');
        if (parts.label.getComputedTextLength() > 385) {
          attr('label', 'textLength', 385);
          attr('label', 'lengthAdjust', 'spacingAndGlyphs');
        }
      }
      attr('indicator', 'fill', state === 2 ? '#488268' : '#9a6c96');
      fade('tick', state === 2 ? 1 : 0);
    }
    return { load, render };
  }
  return { create, duration };
})();
