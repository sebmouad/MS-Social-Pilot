/** Customer copy for reviews in the Inbox, English and French. Mirrors the moderation copy catalog. */
export const reviewCopy = {
  en: {
    review: 'Review', reviews: 'Reviews', reviewBy: 'Review by {name}', reviewHistory: 'Review',
    stars: '{count} out of 5 stars', recommends: 'Recommends your page', notRecommends: 'Does not recommend your page',
    noRating: 'No rating available', noText: 'No written review.',
    replyUnavailable: 'Replying to reviews is not available for this channel. Answer it on the platform.',
    note: 'Reviews are read from the platform and stored here. Edits made on the platform appear after the next sync.',
    syncedReviews: '{count} reviews', openReview: 'Open review',
  },
  fr: {
    review: 'Avis', reviews: 'Avis', reviewBy: 'Avis de {name}', reviewHistory: 'Avis',
    stars: '{count} étoiles sur 5', recommends: 'Recommande votre page', notRecommends: 'Ne recommande pas votre page',
    noRating: 'Note non disponible', noText: 'Aucun commentaire écrit.',
    replyUnavailable: 'Répondre aux avis n’est pas possible pour ce canal. Répondez-y sur la plateforme.',
    note: 'Les avis sont lus sur la plateforme puis enregistrés ici. Les modifications faites sur la plateforme apparaissent après la prochaine synchronisation.',
    syncedReviews: '{count} avis', openReview: 'Ouvrir l’avis',
  },
} as const;
export type ReviewLocale = keyof typeof reviewCopy;
export type ReviewCopyKey = keyof typeof reviewCopy.en;
export function reviewText(locale: ReviewLocale, key: ReviewCopyKey, values: Record<string, string | number> = {}): string {
  return (reviewCopy[locale][key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => name in values ? String(values[name]) : whole);
}

/** One line describing what a reviewer left; missing data is stated, never shown as zero stars. */
export function reviewSummary(locale: ReviewLocale, review: { rating: number | null; recommendation: 'positive' | 'negative' | null }): string {
  if (review.rating !== null) return reviewText(locale, 'stars', { count: review.rating });
  if (review.recommendation === 'positive') return reviewText(locale, 'recommends');
  if (review.recommendation === 'negative') return reviewText(locale, 'notRecommends');
  return reviewText(locale, 'noRating');
}
