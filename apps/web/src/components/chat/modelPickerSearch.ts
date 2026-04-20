import { type ProviderKind, PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

type ModelPickerSearchableModel = {
  provider: ProviderKind;
  name: string;
  shortName?: string;
  subProvider?: string;
  isFavorite?: boolean;
};

const MODEL_PICKER_FAVORITE_SCORE_BOOST = 8;

function normalizeSearchQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isSubsequenceMatch(value: string, query: string): boolean {
  let valueIndex = 0;
  let queryIndex = 0;

  while (valueIndex < value.length && queryIndex < query.length) {
    if (value[valueIndex] === query[queryIndex]) {
      queryIndex += 1;
    }
    valueIndex += 1;
  }

  return queryIndex === query.length;
}

function getModelPickerSearchFields(model: ModelPickerSearchableModel): string[] {
  return [
    normalizeSearchQuery(model.name),
    ...(model.shortName ? [normalizeSearchQuery(model.shortName)] : []),
    ...(model.subProvider ? [normalizeSearchQuery(model.subProvider)] : []),
    normalizeSearchQuery(model.provider),
    normalizeSearchQuery(PROVIDER_DISPLAY_NAMES[model.provider]),
    buildModelPickerSearchText(model),
  ];
}

function scoreModelPickerSearchToken(
  field: string,
  token: string,
  fieldBase: number,
): number | null {
  if (field === token) {
    return fieldBase;
  }
  if (field.startsWith(token)) {
    return fieldBase + 2;
  }
  if (field.includes(token)) {
    return fieldBase + 6;
  }
  if (token.length >= 3 && isSubsequenceMatch(field, token)) {
    return fieldBase + 20;
  }
  return null;
}

export function buildModelPickerSearchText(model: ModelPickerSearchableModel): string {
  return normalizeSearchQuery(
    [
      model.name,
      model.shortName,
      model.subProvider,
      model.provider,
      PROVIDER_DISPLAY_NAMES[model.provider],
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" "),
  );
}

export function scoreModelPickerSearch(
  model: ModelPickerSearchableModel,
  query: string,
): number | null {
  const tokens = normalizeSearchQuery(query)
    .split(/\s+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return 0;
  }

  const fields = getModelPickerSearchFields(model);
  let score = 0;

  for (const token of tokens) {
    const tokenScores = fields
      .map((field, index) => scoreModelPickerSearchToken(field, token, index * 10))
      .filter((fieldScore): fieldScore is number => fieldScore !== null);

    if (tokenScores.length === 0) {
      return null;
    }

    score += Math.min(...tokenScores);
  }

  return model.isFavorite ? score - MODEL_PICKER_FAVORITE_SCORE_BOOST : score;
}
