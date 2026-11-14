// Один SVG и одна шкала времени для передачи на бумаге и отправки PDF.
// load получает персонажей из ComicPeople, данные документа и способ передачи.
// Подписи и источники хранятся у маршрута, который показывает сцену.
window.DocumentTransferScene = (() => {
  const duration = 8400;
  const channelPreviewTime = 6100;
  let stageCount = 0;
  const artwork = `
    <defs>
      <pattern id="transfer-grain" width="31" height="29" patternUnits="userSpaceOnUse">
        <path d="M2 9h1m14 9h1M5 27h1m18-24h1m3 26h1M8 5h1" stroke="#254867" stroke-width=".8" stroke-linecap="round" opacity=".15"/>
      </pattern>
    </defs>
    <g data-part="room">
      <rect x="-1000" y="-1000" width="3000" height="3000" fill="#d3e4f6"/>
      <rect width="960" height="460" fill="url(#transfer-grain)"/>
      <path d="M79 351L328 36h86L176 351zm124 0L425 36h23L241 351z" fill="#f6f4ec" opacity=".68"/>
      <g transform="translate(86 44)">
        <rect x="5" y="7" width="224" height="195" rx="97" fill="#a3ccee"/>
        <rect width="224" height="195" rx="97" fill="#faf4e7"/>
        <rect x="10" y="10" width="204" height="175" rx="87" fill="#a3ccee"/>
        <circle cx="167" cy="57" r="23" fill="#f7a823"/>
        <path d="M17 126q38-15 83 0t106-1m-177 18q28-8 71 3t93 0" fill="none" stroke="#d3e4f6" stroke-width="2"/>
        <path d="M111 9v177M10 96h204M15 182h194" stroke="#faf4e7" stroke-width="6" stroke-linecap="round"/>
      </g>
      <g transform="translate(768 52)">
        <rect x="4" y="5" width="112" height="100" rx="4" fill="#b0cbe0"/>
        <rect width="112" height="100" rx="4" fill="#467faa"/>
        <rect x="6" y="6" width="100" height="88" fill="#f4f0e7"/>
        <circle cx="66" cy="39" r="18" fill="#f7a823"/>
        <path d="M14 85V72q17-31 43 0v13zm42 0V76q19-23 41-5v14z" fill="#6e9abc"/>
      </g>
      <g transform="translate(63 285)">
        <path d="M19 54Q16 17-8 8m26 45Q32 22 43 18M19 54Q22 18 19 2" fill="none" stroke="#3f737a" stroke-width="2.6"/>
        <path d="M3 22q-20-2-21-18 19-3 21 18m29 13q-1-19 19-23 1 16-19 23M20 20Q7 8 18-4q11 5 2 24" fill="#679596"/>
        <path d="M0 49h38l-7 37H7z" fill="#cd8666"/><path d="M0 49h38v6H0z" fill="#e1a78c"/>
      </g>
      <image data-part="sender" x="142" y="45" width="314" height="310" preserveAspectRatio="xMidYMax meet"/>
      <image data-part="recipient" x="596" y="107" width="230" height="240" preserveAspectRatio="xMidYMax meet"/>
      <rect y="344" width="960" height="116" fill="#d6af94"/>
      <rect y="357" width="960" height="103" fill="#e1bea6"/>
      <rect y="357" width="960" height="103" fill="url(#transfer-grain)"/>
      <path d="M0 449h960v11H0z" fill="#bd947f"/>
      <g data-part="laptop" transform="translate(574 188)">
        <ellipse cx="120" cy="193" rx="126" ry="10" fill="#916b60" opacity=".19"/>
        <rect width="224" height="163" rx="9" fill="#30435d"/>
        <rect x="9" y="9" width="206" height="141" rx="5" fill="#91bce0"/>
        <rect x="34" y="29" width="158" height="97" rx="7" fill="#f4f6f7"/>
        <path d="M34 47h158M47 63h27m-27 15h27m-27 15h27m10-29h94m-94 15h84m-84 15h64" stroke="#a1bcd4" stroke-width="3" stroke-linecap="round"/>
        <path d="M0 162h224l27 23q3 5-4 6H-23q-7-1-4-6z" fill="#506a82"/>
        <path d="M25 167h174l11 10H14z" fill="#9eb4c7"/>
        <path d="M90 181h44l4 5H86z" fill="#7c97b0"/>
      </g>
      <g transform="translate(864 346)">
        <ellipse cx="22" cy="53" rx="34" ry="7" fill="#916b60" opacity=".2"/>
        <path d="M40 16h9q16 0 13 13-3 9-18 10" fill="none" stroke="#709bbd" stroke-width="6"/>
        <path d="M0 7h46l-6 37q-2 7-17 7T6 44z" fill="#a3ccee"/>
        <ellipse cx="23" cy="7" rx="23" ry="7" fill="#d3e4f6"/><ellipse cx="23" cy="8" rx="18" ry="4.4" fill="#76554b"/>
      </g>
      <g data-part="left-arm">
        <path data-part="sleeve" d="M354 281q27 9 31 36l17 17-12 19-25-16q-18-10-26-39z"
          data-paper-d="M354 281q24 7 33 25l19 11-8 19-26-9q-21-9-33-28z"/>
        <path data-part="hand" d="M399 331l13 3q7-6 11-2 2 3-5 6l10 5q7 3 2 7-6 4-19 0l-22-2z"
          data-paper-d="M404 315l11 3q7-7 11-3 3 3-4 7l11 3q6 2 3 6-5 6-18 3l-20-3z"/>
      </g>
      <g data-part="right-arm">
        <path data-part="receiver-sleeve" d="M661 288q-23 10-29 28l-19 8 6 19 27-8q19-8 29-28z"/>
        <path data-part="receiver-hand" d="M614 322l-12 3q-8-6-11-2-2 3 4 6l-12 4q-6 3-2 7 6 4 20 0l18-2z"/>
      </g>
    </g>
    <g data-part="desk">
      <rect width="960" height="460" fill="#dec0a8"/>
      <rect width="960" height="460" fill="url(#transfer-grain)"/>
      <path d="M0 78q248-13 471 1t489 0M0 404q234 15 472 0t488 0" fill="none" stroke="#aa8274" stroke-width="2" opacity=".45"/>
      <path d="M32 50l171-51 77 260-171 51z" fill="#7ea9cd"/>
      <path d="M38 49l7-2 75 254-7 2z" fill="#638db4"/>
      <path d="M53 68l136-41m-130 60l136-41" stroke="#afcce3" stroke-width="2"/>
      <circle cx="779" cy="94" r="60" fill="#efdbc5"/>
      <circle cx="779" cy="94" r="43" fill="#a3ccee"/>
      <path d="M813 87h19a7 7 0 0 1 0 14h-19z" fill="#a3ccee"/>
      <circle cx="779" cy="94" r="35" fill="#77584c"/>
      <path d="M752 99q5 17 22 21" fill="none" stroke="#b99177" stroke-width="3" stroke-linecap="round"/>
      <path d="M779 377l48-173q3-6 9-5 5 1 4 8l-47 175-12 11z" fill="#40647d"/>
      <path d="M779 377l14 5-12 11z" fill="#e8d3b5"/>
    </g>
    <g data-part="mail">
      <rect width="960" height="460" fill="#a3ccee"/>
      <rect width="960" height="460" fill="url(#transfer-grain)"/>
      <circle cx="820" cy="434" r="208" fill="none" stroke="#d3e4f6" stroke-width="2"/>
      <circle cx="820" cy="434" r="237" fill="none" stroke="#d3e4f6" stroke-width="2"/>
      <rect x="218" y="56" width="534" height="350" rx="19" fill="#5f87a6" opacity=".28"/>
      <rect x="211" y="48" width="534" height="350" rx="19" fill="#f9faf8"/>
      <path d="M230 48h496a19 19 0 0 1 19 19v33H211V67a19 19 0 0 1 19-19z" fill="#d3e4f6"/>
      <circle cx="241" cy="74" r="4" fill="#f7a823"/><circle cx="255" cy="74" r="4" fill="#93b9d9"/><circle cx="269" cy="74" r="4" fill="#93b9d9"/>
      <text x="505" y="80" text-anchor="middle" font-size="22" font-weight="700" fill="#0069b4" data-part="channel-title" data-fit="428"/>
      <path d="M240 160h475m-475 50h475" stroke="#cad9e5"/>
      <text x="241" y="138" font-size="17" fill="#4a6277">Кому</text>
      <text x="313" y="138" font-size="21" fill="#15436a" font-weight="700" data-part="address" data-fit="390"/>
      <text x="241" y="188" font-size="17" fill="#4a6277">Тема</text>
      <text x="313" y="188" font-size="21" fill="#15436a" data-part="subject" data-fit="390"/>
      <text x="241" y="239" font-size="17" fill="#4a6277" data-part="message-label"/>
      <g data-part="portal-fields">
        <rect x="241" y="253" width="434" height="63" rx="10" fill="#eef4f9"/>
        <text x="255" y="290" font-size="19" fill="#344c64" data-part="description" data-fit="405"/>
      </g>
      <rect data-part="send-button" x="241" y="337" width="145" height="41" rx="9" fill="#0069b4"/>
      <text x="259" y="363" font-size="16" font-weight="700" fill="#fff">Отправить</text>
      <path d="M360 357h11m-4-4 4 4-4 4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g data-part="packet">
      <rect data-part="shadow" x="5" y="7" width="300" height="188" rx="10" fill="#715b53" opacity=".2"/>
      <rect data-part="paper" width="300" height="188" rx="8" fill="#fff9ec"/>
      <g data-part="document">
        <path d="M300 29h-29V0z" fill="#bfd5e9"/><path d="M271 0h21q8 0 8 8v21z" fill="#d9e7f4"/>
        <rect x="23" y="25" width="31" height="4" rx="2" fill="#f7a823"/>
        <image data-part="document-object" x="231" y="30" width="39" height="39"/>
        <text x="23" y="62" font-size="27" font-weight="700" fill="#0069b4" data-part="document-title" data-fit="204"/>
        <text x="24" y="85" font-size="15" fill="#344c64" data-part="document-line" data-fit="245"/>
        <path d="M24 105h250m-250 12h219m-219 12h237" stroke="#bacbda" stroke-width="2" stroke-linecap="round"/>
        <path d="M24 163h250" stroke="#c2d1df"/>
        <text x="24" y="153" font-size="12" fill="#4a6277" data-part="document-status" data-fit="250"/>
        <path data-part="document-signature" d="M181 151q18-20 21-14-3 8-14 15 20-10 24-9l-6 7q13-8 22-5l-2 5q14-5 25-3" fill="none" stroke="#39688f" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <g data-part="attachment">
        <rect x="10" y="10" width="40" height="39" rx="8" fill="#d3e4f6"/>
        <path data-part="attachment-default" d="M23 18h12l5 5v17H23zm12 0v6h5" fill="none" stroke="#0069b4" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        <image data-part="attachment-object" x="15" y="15" width="29" height="29"/>
        <text x="63" y="28" font-size="17" font-weight="700" fill="#15436a" data-part="filename" data-fit="202"/>
        <text x="63" y="45" font-size="12" fill="#4a6277" data-part="attachment-note" data-fit="200"/>
        <text x="270" y="35" font-size="12" font-weight="700" fill="#0069b4" data-part="attachment-format">PDF</text>
      </g>
    </g>
    <g data-part="cursor"><path d="M0 0l6 26 5-10 10-4z" fill="#22476a" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></g>
    <g data-part="done">
      <rect width="960" height="460" fill="#173550" opacity=".15"/>
      <rect x="234" y="124" width="500" height="181" rx="20" fill="#244966" opacity=".21"/>
      <rect x="230" y="117" width="500" height="181" rx="20" fill="#f8faf9"/>
      <circle cx="480" cy="168" r="23" fill="#d3e4f6"/>
      <path d="M469 168l8 7 14-15" fill="none" stroke="#0069b4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="480" y="218" text-anchor="middle" font-size="25" font-weight="700" fill="#0069b4" data-part="result-title" data-fit="435"/>
      <text x="480" y="250" text-anchor="middle" font-size="17" fill="#344c64" data-part="result-recipient" data-fit="435"/>
    </g>`;

  function mix(from, to, t) {
    return from + (to - from) * t;
  }

  function eased(time, start, end) {
    const t = Math.max(0, Math.min(1, (time - start) / (end - start)));
    return t * t * (3 - 2 * t);
  }

  function create(stage, resolvePortrait) {
    stage.setAttribute('viewBox', '0 0 960 460');
    stage.innerHTML = artwork.replaceAll('transfer-grain', 'transfer-grain-' + ++stageCount);
    const parts = Object.fromEntries(Array.from(stage.querySelectorAll('[data-part]'), node => [node.dataset.part, node]));
    const senderArm = ['sleeve', 'hand'].map(part => ({
      part, mailPath: parts[part].getAttribute('d'), paperPath: parts[part].dataset.paperD
    }));
    let digital = false;
    let portal = false;
    let messageOnly = false;

    function attr(part, key, value) {
      parts[part].setAttribute(key, value);
    }

    function opacity(part, value) {
      attr(part, 'opacity', value);
    }

    function load(config) {
      portal = config.channel === 'portal';
      digital = portal || config.channel === 'email';
      const { sender, recipient, document, result } = config;
      messageOnly = config.channel === 'email' && document.attachment === false;
      attr('sender', 'href', resolvePortrait(sender.portrait));
      opacity('attachment-default', config.art ? 0 : 1);
      for (const icon of ['document-object', 'attachment-object']) {
        if (config.art) attr(icon, 'href', config.art);
        else parts[icon].removeAttribute('href');
      }
      for (const { part, mailPath, paperPath } of senderArm) attr(part, 'd', digital ? mailPath : paperPath);
      attr('sleeve', 'fill', sender.sleeve);
      attr('hand', 'fill', sender.skin);
      if (recipient.portrait) {
        attr('recipient', 'href', resolvePortrait(recipient.portrait));
        attr('receiver-sleeve', 'fill', recipient.sleeve);
        attr('receiver-hand', 'fill', recipient.skin);
      }
      opacity('recipient', digital ? 0 : 1);
      opacity('laptop', digital ? 1 : 0);
      opacity('portal-fields', portal || messageOnly ? 1 : 0);
      const signedDocument = !portal && /^подписан/iu.test(document.status || '');
      opacity('document-signature', signedDocument ? 1 : 0);
      attr('channel-title', 'x', portal ? 505 : 478);
      parts['channel-title'].dataset.fit = portal ? 428 : 380;
      parts['document-status'].dataset.fit = signedDocument ? 145 : 250;
      for (const [part, value] of Object.entries({
        'channel-title': portal ? recipient.address || 'Система заявок' : 'Новое письмо',
        'message-label': portal ? 'Описание' : messageOnly ? 'Сообщение' : 'Вложение',
        description: document.status || 'Описание обращения заполнено',
        address: portal ? recipient.label : recipient.address || '',
        subject: document.subject || '',
        'document-title': document.title,
        'document-line': document.subtitle,
        'document-status': portal ? (document.ticket === false ? 'Документ к отправке' : 'Черновик обращения') : document.status,
        filename: document.filename || '',
        'attachment-format': document.format ?? 'PDF',
        'attachment-note': document.status,
        'result-title': result,
        'result-recipient': recipient.label
      })) {
        parts[part].textContent = value;
      }
      // long titles: smaller type first, then squeeze, so text never leaves its card
      for (const text of stage.querySelectorAll('[data-fit]')) {
        const fit = Number(text.dataset.fit);
        text.dataset.size ??= text.getAttribute('font-size');
        text.setAttribute('font-size', text.dataset.size);
        text.removeAttribute('textLength');
        const length = text.getComputedTextLength();
        if (length <= fit) continue;
        const size = Math.max(text.dataset.size * fit / length, text.dataset.size * 0.72);
        text.setAttribute('font-size', size.toFixed(1));
        if (text.getComputedTextLength() > fit) {
          text.setAttribute('textLength', fit);
          text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
      render(0);
    }

    function render(time) {
      const zoom = eased(time, 820, 2600);
      const move = eased(time, 3540, 6380);
      const mail = digital ? eased(time, 3550, 4870) : 0;
      const desk = eased(time, 1250, 2550) * (1 - (digital ? mail : eased(time, 3500, 4750)));
      const hasAttachment = digital && !portal && !messageOnly;
      const fold = hasAttachment ? eased(time, 4070, 6200) : 0;
      const click = eased(time, 6150, 6870);
      const done = eased(time, 6910, 7460);

      const nearX = mix(393, 296, zoom);
      const nearY = mix(320, 111, zoom);
      const camera = mix(1, 2.1, zoom * (1 - move));
      const cameraX = mix(nearX, 393, move);
      const cameraY = mix(nearY, 320, move);
      attr('room', 'transform', 'translate(' + (cameraX - 393 * camera) + ' ' + (cameraY - 320 * camera) + ') scale(' + camera + ')');
      opacity('desk', desk);
      opacity('mail', mail);
      opacity('left-arm', 1 - move);
      opacity('right-arm', digital ? 0 : eased(time, 4000, 6080));
      attr('right-arm', 'transform', 'translate(' + mix(32, 0, move) + ' 0)');

      const x = mix(nearX, digital ? 241 : 600, move);
      const y = mix(nearY, digital ? 256 : 302, move);
      const scale = mix(mix(.47, 1.22, zoom), digital ? 1 : .55, move);
      const angle = mix(mix(-8, 0, zoom), digital ? 0 : 6, move);
      attr('packet', 'transform', 'translate(' + x + ' ' + y + ') rotate(' + angle + ') scale(' + scale + ')');
      for (const surface of ['paper', 'shadow']) {
        attr(surface, 'width', mix(300, 310, fold));
        attr(surface, 'height', mix(188, 59, fold));
      }
      attr('paper', 'fill', fold > .72 ? '#ebf4fb' : '#fff9ec');
      opacity('shadow', .2 * (1 - fold));
      opacity('packet', portal || messageOnly ? 1 - mail : 1);
      opacity('document', digital ? 1 - eased(time, 4110, 4750) : 1);
      opacity('attachment', hasAttachment ? eased(time, 5220, 6060) : 0);
      opacity('cursor', digital ? eased(time, 6160, 6400) * (1 - done) : 0);
      attr('cursor', 'transform', 'translate(' + mix(477, 347, click) + ' ' + mix(409, 358, click) + ')');
      attr('send-button', 'fill', time >= 6790 ? '#00467f' : '#0069b4');
      opacity('done', done);
    }

    return { load, render };
  }

  return { create, duration, channelPreviewTime };
})();
