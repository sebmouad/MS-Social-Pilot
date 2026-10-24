/** Safe, serializable creation metadata. Providers own choices; shared forms own interaction. */
type CreationUi = {
  title: string;
  description: string;
  nameLabel: string;
  nameMaxLength: number;
  actionLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  options: readonly { value: string; label: string }[];
  defaultOption: string;
  confirmationTemplate: string;
};

export type AdsUiSchema = {
  campaign?: CreationUi & { optionLabel: string };
  adSet?: CreationUi & { budgetLabel: string; countryLabel: string; goalLabel: string };
};

/** Reject incomplete module metadata rather than silently sending an invalid confirmation. */
export function fillAdsTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_match, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Missing Ads template value: ${key}.`);
    return values[key]!;
  });
}
