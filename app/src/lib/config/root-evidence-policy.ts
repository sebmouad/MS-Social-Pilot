/** Operator-adjustable ceilings for private platform publication evidence. */
export const ROOT_EVIDENCE_POLICY = {
  providerIdCharacters: 100,
  operationIdCharacters: 200,
  resultCap: 1000,
  actionIdCharacters: 100,
  identifierCharacters: 2048,
  confirmationCharacters: 400,
  metadataTitleCharacters: 200,
  metadataDescriptionCharacters: 1000,
  columnCount: 100,
  actionCount: 1000,
  columnKeyCharacters: 64,
  labelCharacters: 120,
  actionDescriptionCharacters: 1000,
  acknowledgmentCharacters: 240,
  messageCharacters: 500,
  contextCount: 8,
  fieldCount: 8,
  fieldKeyCharacters: 64,
  fieldDescriptionCharacters: 500,
  fieldValueCharacters: 2048,
  choiceOptionCount: 20,
  choiceValueCharacters: 100
} as const;

export type RootEvidencePolicy = { [K in keyof typeof ROOT_EVIDENCE_POLICY]: number };
