export type AssistantAnswerCard = {
  id: string;
  question: string;
  answer: string;
  keywords: string;
};

export function normalizeAssistantQuestion(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

export function isAssistantAccountRequest(text: string) {
  return /预报|认领|合箱|集运|充值|付款|支付|余额|多少钱|查物流|仓库地址|打开/.test(text);
}

function phrases(card: AssistantAnswerCard) {
  return [card.question, ...card.keywords.split(/[\n,，;；|]/)]
    .map((item) => item.normalize("NFKC").trim().toLowerCase())
    .filter((item) => item.length >= 2);
}

function ranked(query: string, cards: AssistantAnswerCard[]) {
  const haystack = query.normalize("NFKC").toLowerCase();
  return cards
    .map((card) => {
      const matched = phrases(card).filter((phrase) => haystack.includes(phrase));
      return { card, score: matched.reduce((sum, phrase) => sum + phrase.length, 0) };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

export function selectAssistantAnswers(query: string, cards: AssistantAnswerCard[], limit = 3) {
  const matches = ranked(query, cards);
  const best = matches[0];
  const second = matches[1]?.score ?? 0;
  const leading = best && !isAssistantAccountRequest(query) && (second === 0 || best.score >= second * 2) ? best.card : null;
  return { matches: matches.slice(0, limit).map((item) => item.card), leading };
}

export function matchAssistantAnswers(query: string, cards: AssistantAnswerCard[], limit = 3) {
  return selectAssistantAnswers(query, cards, limit).matches;
}

export function leadingAssistantAnswer(query: string, cards: AssistantAnswerCard[]) {
  return selectAssistantAnswers(query, cards).leading;
}
