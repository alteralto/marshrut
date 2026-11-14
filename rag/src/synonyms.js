'use strict';
// Colloquial -> regulation vocabulary. Employees write "потерял пропуск",
// "академ", "за свой счёт"; regulations say "утрата", "академический отпуск",
// "без сохранения заработной платы". Stemming cannot bridge that, so the query
// is expanded with these words (at reduced weight).
//
// Format: [triggers, expansion]. Triggers: a string of words (each matched by
// stem, so any inflection works) or an array whose items may be phrases
// (matched as whole words in the normalized question). Expansion is plain
// text; it is tokenized and stemmed.
//
// The list is generic office/university Russian. Corpus-specific additions go
// to a JSON file with the same shape: [["слово другое", "расширение"],
// [["целая фраза"], "расширение"], ...] or {"фраза": "расширение"},
// passed as opts.synonymsFile or RAG_SYNONYMS, or placed next to the index as
// synonyms.json. Do not map words of topics the corpus lacks onto words it has
// ("декрет" -> "отпуск"): that turns honest "не найдено" into a wrong answer.

const fs = require('node:fs');
const path = require('node:path');
const { normalize, words, tokens, stem } = require('./text');

const BASE = [
  ['потерял потеряла потеряли потерять потеря утерял утеряла утерять утеря пропал пропала посеял', 'утрата утеря'],
  ['сломал сломался сломался испортил испортился', 'порча'],
  ['академ академка академку академке академа', 'академический отпуск'],
  ['отпускные отпускных', 'оплата отпуска'],
  ['командировочные командировочных', 'командировочные расходы аванс'],
  ['гость гостя гостю гости гостей', 'посетитель'],
  ['пустить пропустить провести пускают', 'доступ пропуск'],
  ['платят заплатят выплатят выплачивают оплатят компенсируют компенсация', 'выплачиваются возмещаются оплата'],
  ['деньги денег', 'средства выплата'],
  ['отчитаться отчитываться', 'отчет'],
  ['вернулся вернулась вернулись приехал приехала', 'возвращение'],
  ['поездка поездку поехать съездить еду едем лечу', 'командировка'],
  ['курсы курсов', 'обучение повышение квалификации'],
  ['визирует визировать виза завизировать подписывает', 'согласование согласующий'],
  ['гостиница гостиницу гостинице отель отеля отеле проживание', 'наем жилого помещения'],
  ['зарплата зарплату зарплаты зп', 'заработная плата'],
  [['в какие часы', 'во сколько', 'часы работы', 'время работы', 'график работы', 'режим работы', 'часы приема', 'часы приёма'], 'рабочие дни рабочее время прием перерыв'],
  ['указать укажите указал указала', 'указывает указываются указывать'],
  ['бэкап бэкапы бэкапов бэкапа', 'резервное копирование резервные копии'],
  ['физлицо физлица физлицами физлицом физлиц', 'физическое лицо физических лиц физическими лицами'],
  ['студент студента студенту студенты студентка студентов', 'обучающийся'],
  ['сотрудник сотрудника сотруднику сотрудники', 'работник'],
  ['начальник начальника начальнику руководство', 'руководитель'],
  ['кадры кадровик кадровики кадровикам кадровиков', 'отдел кадров'],
  ['бухгалтер бухгалтеру бухгалтера бухгалтеров', 'бухгалтерия'],
  ['контракт контракта', 'договор'],
  ['родился родилась родила рождение', 'рождение ребенка'],
  ['болезнь болезни заболел заболела болею', 'медицинские показания'],
  ['армия армию армии призвали', 'военная служба призыв'],
  ['перенести перенести переносить', 'перенос'],
  ['поставщику поставщику поставщик', 'поставщик'],
  [['за свой счет', 'свой счет'], 'без сохранения заработной платы'],
  [['дубликат', 'дубль', 'новый пропуск'], 'дубликат восстановление'],
  [['сдать документы', 'сдавать документы'], 'представляет прилагаются'],
  ['нанять нанимать', 'подбор персонала вакансия кандидат'],
  [['принять на работу', 'взять на работу', 'нового человека', 'нового работника'], 'подбор персонала вакансия кандидат'],
  ['компьютер ноутбук принтер интернет вайфай', 'техническая поддержка обращение'],
  [['дата центр', 'дата центре', 'дата центра', 'датацентр', 'серверная', 'серверной'], 'центр обработки данных'],
  ['общага общагу общаге общаги', 'общежитие'],
  ['перевестись переводиться перевожусь переведусь', 'перевод'],
  ['заселиться поселиться заселение заселить вселиться', 'поселение'],
  ['уволиться увольняться увольняюсь', 'увольнение'],
  ['отчислиться отчислят отчислили', 'отчисление'],
  ['восстановиться восстанавливаться', 'восстановление'],
  ['заем займ заема займа', 'заимствование'],
  ['бронь брони', 'бронирование'],
  ['служебка служебку служебки', 'служебная записка'],
  ['ущерб ущерба ущербу', 'вред порча'],
  ['билет билета билеты билетов', 'проездной документ'],
  [['за границу', 'за границей', 'за рубеж', 'за рубежом'], 'иностранное государство заграничный зарубежный'],
  ['отвечает отвечают отвечать', 'ответственность ответственный'],
  // a request to a service is "заявка" in speech and "обращение" in its regulation
  ['заявка заявку заявке заявки заявок', 'обращение'],
  ['ниокр ниоктр нир окр', 'научно-исследовательские опытно-конструкторские технологические работы'],
];

function compile(list) {
  const byStem = new Map(); // stem -> Set(expansion stems)
  const phrases = []; // [normalized phrase, Set(expansion stems)]
  for (const entry of list) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [trig, exp] = entry;
    const expStems = new Set(tokens(String(exp)));
    if (!expStems.size) continue;
    // A string is a list of words; an array is a list of words or phrases.
    const items = Array.isArray(trig) ? trig : String(trig).split(/\s+/);
    for (const raw of items) {
      const t = normalize(raw).trim();
      if (!t) continue;
      if (/\s/.test(t)) phrases.push([t, expStems]);
      else {
        const s = stem(t);
        if (!byStem.has(s)) byStem.set(s, new Set());
        for (const e of expStems) if (e !== s) byStem.get(s).add(e);
      }
    }
  }
  return { byStem, phrases };
}

const cache = new Map();

function loadExtra(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(json)) return json;
    if (json && typeof json === 'object') return Object.entries(json).map(([k, v]) => [[k], String(v)]);
  } catch (e) {
    console.warn(`[rag] synonyms file ${file} ignored: ${e.message}`);
  }
  return [];
}

// opts.synonymsFile | RAG_SYNONYMS | <indexDir>/synonyms.json; opts.synonyms
// (array, same format) is appended; opts.synonyms === false disables all.
function getSynonyms(opts = {}) {
  if (opts.synonyms === false) return { byStem: new Map(), phrases: [] };
  const file = opts.synonymsFile || process.env.RAG_SYNONYMS
    || (opts.indexPath ? path.join(path.dirname(path.resolve(opts.indexPath)), 'synonyms.json') : null);
  const key = `${file || ''}|${Array.isArray(opts.synonyms) ? JSON.stringify(opts.synonyms) : ''}`;
  if (cache.has(key)) return cache.get(key);
  const list = [...BASE, ...loadExtra(file), ...(Array.isArray(opts.synonyms) ? opts.synonyms : [])];
  const compiled = compile(list);
  cache.set(key, compiled);
  return compiled;
}

// Returns Map queryStem -> Set(expansion stems). Phrase hits are attached to
// the stems of the phrase's own words that survived query filtering, or to a
// pseudo-term named after the phrase.
function synonymExpansions(question, qTerms, syn) {
  const out = new Map();
  const add = (k, set) => {
    if (!out.has(k)) out.set(k, new Set());
    for (const e of set) out.get(k).add(e);
  };
  for (const t of qTerms) if (syn.byStem.has(t)) add(t, syn.byStem.get(t));
  const norm = ` ${words(question).join(' ')} `;
  for (const [phrase, exp] of syn.phrases) {
    if (!norm.includes(` ${phrase} `)) continue;
    const own = tokens(phrase).filter((s) => qTerms.includes(s));
    if (own.length) for (const s of own) add(s, exp);
    else add(`«${phrase}»`, exp);
  }
  return out;
}

module.exports = { getSynonyms, synonymExpansions, compile, BASE };
