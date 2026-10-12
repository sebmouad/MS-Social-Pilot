import { describe, expect, it } from 'vitest';

import { buildCaption, daysUntil, durationMinutes, parseStructuredData, templatesFor, type CaptionFormat } from '../src/lib/structured-data';

/** NEXT_PHASES H3: schema.org JSON-LD from any niche, turned into captions. */

const ld = (...blocks: unknown[]) =>
  `<html><head><title>x</title>${blocks.map((block) => `<script type="application/ld+json">${typeof block === 'string' ? block : JSON.stringify(block)}</script>`).join('')}</head><body></body></html>`;

const format: CaptionFormat = {
  label: (key) => key,
  date: (iso) => iso.slice(0, 10),
  money: (money) => `${money.min}${money.max ? `-${money.max}` : ''} ${money.currency ?? ''}${money.unit ? `/${money.unit}` : ''}`.trim(),
  availability: (code) => code,
  minutes: (minutes) => `${minutes} min`,
  rating: (rating, count) => `${rating}/5${count ? ` (${count})` : ''}`,
  countdown: (days) => `In ${days} days`,
  ingredients: 'Ingredients',
  steps: 'Steps',
};

describe('parseStructuredData', () => {
  it('reads a product with its offer, brand and rating, images made absolute', () => {
    const [item] = parseStructuredData(
      ld({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Desk lamp &amp; shade',
        description: '<p>A lamp.</p>',
        image: ['/img/a.jpg', { '@type': 'ImageObject', url: 'https://cdn.example.com/b.jpg' }],
        brand: { '@type': 'Brand', name: 'Client A' },
        offers: { '@type': 'Offer', price: '49.90', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
        aggregateRating: { ratingValue: '4.6', reviewCount: 12 },
      }),
      'https://shop.example.com/p/lamp',
    );
    expect(item).toMatchObject({ kind: 'product', name: 'Desk lamp & shade', description: 'A lamp.' });
    expect(item!.images).toEqual(['https://shop.example.com/img/a.jpg', 'https://cdn.example.com/b.jpg']);
    expect(item!.facts).toEqual([
      { key: 'price', value: { money: { min: 49.9, max: null, currency: 'EUR', unit: null } } },
      { key: 'availability', value: { availability: 'InStock' } },
      { key: 'brand', value: { text: 'Client A' } },
      { key: 'rating', value: { rating: 4.6, count: 12 } },
    ]);
  });

  it('walks @graph, ignores broken blocks and plain organisations, and puts the specific item first', () => {
    const items = parseStructuredData(
      ld('{ not json', {
        '@graph': [
          { '@type': 'Organization', name: 'Client A' },
          { '@type': 'BlogPosting', headline: 'Product launch', author: { name: 'Sam' }, datePublished: '2026-10-01' },
          { '@type': ['Event', 'MusicEvent'], name: 'Launch night', startDate: '2026-11-05T19:00:00+01:00', location: { '@type': 'Place', name: 'Hall B', address: { streetAddress: '1 Main St', addressLocality: 'Springfield' } } },
        ],
      }),
      'https://example.com/',
    );
    expect(items.map((item) => item.kind)).toEqual(['event', 'article']);
    expect(items[0]!.facts).toContainEqual({ key: 'place', value: { text: 'Hall B, 1 Main St, Springfield' } });
    expect(items[1]!.facts).toEqual([
      { key: 'author', value: { text: 'Sam' } },
      { key: 'published', value: { date: '2026-10-01' } },
    ]);
  });

  it('reads recipe ingredients, sectioned steps and step pictures', () => {
    const [item] = parseStructuredData(
      ld({
        '@type': 'Recipe',
        name: 'Soup',
        totalTime: 'PT1H15M',
        recipeYield: ['4', '4 bowls'],
        recipeIngredient: ['2 carrots', '1 onion'],
        recipeInstructions: [
          { '@type': 'HowToSection', name: 'Prep', itemListElement: [{ '@type': 'HowToStep', text: 'Chop.', image: '/s1.jpg' }] },
          { '@type': 'HowToStep', text: 'Simmer.' },
        ],
      }),
      'https://example.com/soup',
    );
    expect(item).toMatchObject({ kind: 'recipe', ingredients: ['2 carrots', '1 onion'], steps: ['Chop.', 'Simmer.'], images: ['https://example.com/s1.jpg'] });
    expect(item!.facts).toEqual([
      { key: 'totalTime', value: { minutes: 75 } },
      { key: 'servings', value: { text: '4' } },
    ]);
  });

  it('reads a job posting with a salary range', () => {
    const [item] = parseStructuredData(
      ld({
        '@type': 'JobPosting',
        title: 'Support agent',
        hiringOrganization: { name: 'Client A' },
        employmentType: 'FULL_TIME',
        jobLocation: { address: { addressLocality: 'Springfield' } },
        baseSalary: { currency: 'USD', value: { minValue: 30000, maxValue: 40000, unitText: 'YEAR' } },
        validThrough: '2026-12-01',
      }),
      'https://example.com/jobs/1',
    );
    expect(item!.kind).toBe('job');
    expect(item!.facts).toContainEqual({ key: 'salary', value: { money: { min: 30000, max: 40000, currency: 'USD', unit: 'YEAR' } } });
    expect(item!.facts).toContainEqual({ key: 'employmentType', value: { text: 'full time' } });
  });

  it('finds nothing on a page without JSON-LD', () => {
    expect(parseStructuredData('<html><head><title>Hi</title></head></html>', 'https://example.com')).toEqual([]);
  });
});

describe('captions', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const [event] = parseStructuredData(
    ld({ '@type': 'Event', name: 'Launch night', startDate: '2026-11-05T19:00:00Z', location: 'Hall B', offers: { price: 10, priceCurrency: 'EUR' } }),
    'https://example.com/e',
  );

  it('offers the templates that fit', () => {
    expect(templatesFor(event!, now)).toEqual(['facts', 'offer', 'countdown']);
    expect(templatesFor(event!, new Date('2026-12-01T00:00:00Z'))).toEqual(['facts', 'offer']);
  });

  it('builds key facts, offer and countdown captions', () => {
    expect(buildCaption(event!, 'facts', format, now, 'https://example.com/e')).toBe(
      'Launch night\n\n• starts: 2026-11-05\n• place: Hall B\n• price: 10 EUR\n\nhttps://example.com/e',
    );
    expect(buildCaption(event!, 'offer', format, now, null)).toBe('Launch night\n\nprice: 10 EUR');
    expect(buildCaption(event!, 'countdown', format, now, null)).toBe('In 4 days: Launch night\n\n2026-11-05 · Hall B');
  });

  it('counts days by calendar date and stops once started', () => {
    expect(daysUntil('2026-11-01T23:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-10-31T23:00:00Z', now)).toBeNull();
    expect(durationMinutes('P1DT2H')).toBe(1560);
    expect(durationMinutes('soon')).toBeNull();
  });
});
