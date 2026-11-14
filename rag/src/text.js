'use strict';
const { stem } = require('./stemmer');

// Snowball Russian stop list, minus words that carry meaning in regulations
// ("нельзя", "не" is handled separately by the verifier's negation check).
const STOP = new Set(`и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по
только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был
него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы
тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого
какой совсем ним здесь этом почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при
наконец об другой хоть после над больше тот через эти нас про всего них какая много разве эту моя
впрочем хорошо свою этой перед иногда лучше чуть том такой им более всегда конечно всю между
также либо который которая которое которые которых которым которой является являются данный данного
данной данных случае случаях иной иных ином пункт пункта пунктом пунктами подпункт настоящий настоящего
настоящим настоящей настоящему`.split(/\s+/).filter(Boolean));

// Words that describe the act of asking rather than the task itself. Dropped from
// queries only, so "как мне оформить ..." is scored on the meaningful part.
const QUERY_STOP = new Set(`нужно необходимо надо хочу хочет хотят хочется хотел хотела хотим хотелось подскажите пожалуйста
скажите расскажите объясните сделать делать сделал каким образом какие каков какова каковы каком какую
мои моё мое моего моей мою наш наша наше наши мне я мы нам нас вопрос вопросу порядок порядке процедура
процедуру процедуры алгоритм шаг шаги шагов инструкция инструкцию регламент регламенту регламенте
регламента правила правилам документ документа документу какому который действовать поступить что-то
вообще именно очень сейчас сегодня завтра сколько свой своя свое свои своего своей своих своим своем
пару пара несколько бывает ко другого другой другом другую другие других просто полностью всё весь вся
что-нибудь кое-что ему ей им него неё нее`.split(/\s+/).filter(Boolean));

function normalize(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/ /g, ' ');
}

const WORD_RE = /[a-zа-я]+|\d+/g;

function words(s) {
  return normalize(s).match(WORD_RE) || [];
}

const stemCache = new Map();
function cachedStem(w) {
  let s = stemCache.get(w);
  if (s === undefined) {
    s = stem(w);
    if (stemCache.size > 200000) stemCache.clear();
    stemCache.set(w, s);
  }
  return s;
}

// Index-side tokens: stop words removed, stemmed. Single letters are dropped
// except digits (clause numbers, terms in days).
function tokens(s) {
  const out = [];
  for (const w of words(s)) {
    if (STOP.has(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(cachedStem(w));
  }
  return out;
}

// Query-side tokens: additionally drops the "how do I" words.
function queryTokens(s) {
  const out = [];
  for (const w of words(s)) {
    if (STOP.has(w) || QUERY_STOP.has(w)) continue;
    if (w.length < 2) continue;
    out.push(cachedStem(w));
  }
  return out;
}

// Verb-looking surface forms: infinitive, past tense, imperative, common
// present-tense endings. In a task description the verb is often colloquial
// ("потерял", "съездить", "пустит") while the nouns name the topic, so verbs
// get less weight. Endings like -ут/-ит are left out on purpose: "институт",
// "лимит", "кредит" are nouns.
const VERB_RE = /(?:[аяеиоуы]ть|ться|тись|чь|[аяеиы]л|[аяеиы]ла|[аяеиы]ли|[аяеиы]ло|[аяеиы]лся|[аяеиы]лась|[аяеиы]лись|айте|яйте|ите|йте|ешь|ишь|йти|ает|яет|еет|ует|оит|ают|яют|еют|уют|ят|дет|дут|ется|ится|ются|ятся|ает|утся)$/;

function isVerbLike(w) {
  return w.length >= 5 && VERB_RE.test(w);
}

// Full adjective / participle endings ("декретный", "парковочное").
const ADJ_RE = /(?:[ыи]й|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ую|юю|ыми|ими)$/;

function isAdjLike(w) {
  return w.length >= 6 && ADJ_RE.test(w) && !isVerbLike(w);
}

// Query terms deduplicated by stem, with flags: verb, adj, num (digits), and
// `next` = stem of the following content word (for "adjective + noun" pairs).
function queryTerms(s) {
  const out = new Map();
  let prev = null;
  for (const w of words(s)) {
    if (STOP.has(w) || QUERY_STOP.has(w) || w.length < 2) { prev = null; continue; }
    const t = cachedStem(w);
    const verb = isVerbLike(w);
    const adj = isAdjLike(w);
    if (prev && prev.next == null && prev.t !== t) prev.next = t;
    if (out.has(t)) {
      const e = out.get(t);
      e.verb = e.verb && verb;
      e.adj = e.adj && adj;
      prev = e;
    } else {
      const e = { t, w, verb, adj, num: /^\d+$/.test(w), next: null };
      out.set(t, e);
      prev = e;
    }
  }
  return [...out.values()];
}

module.exports = { normalize, words, tokens, queryTokens, queryTerms, isVerbLike, isAdjLike, stem: cachedStem, STOP, QUERY_STOP };
