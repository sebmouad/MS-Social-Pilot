import { z } from 'zod';
export const appearanceCopy = {
  en: {
    title: 'Appearance', description: 'Choose the colors that make your workspace feel right.',
    panel: 'Your theme', panelDetail: 'Your theme and display mode are saved to your account.',
    note: 'Theme colors keep text, controls, and focus indicators easy to see.',
    group: 'Choose a theme', current: 'Current', mode: 'Display mode', save: 'Save appearance', saving: 'Saving…', saved: 'Appearance saved.', failed: 'Appearance could not be saved. Try again.',
    vivid: 'Vivid', vividDescription: 'Deep indigo navigation with colorful modules.', meta: 'Meta blue', metaDescription: 'Light navigation with a blue accent.', warm: 'Warm', warmDescription: 'Cream and coral, rounded and friendly.', clean: 'Clean', cleanDescription: 'Crisp gray with color in icons and charts.',
    light: 'Light', dark: 'Dark', system: 'Match device',
  },
  fr: {
    title: 'Apparence', description: 'Choisissez les couleurs qui conviennent à votre espace.',
    panel: 'Votre thème', panelDetail: 'Votre thème et votre mode d’affichage sont enregistrés dans votre compte.',
    note: 'Les couleurs gardent le texte, les commandes et les indicateurs de focus faciles à voir.',
    group: 'Choisir un thème', current: 'Actuel', mode: 'Mode d’affichage', save: 'Enregistrer l’apparence', saving: 'Enregistrement…', saved: 'Apparence enregistrée.', failed: 'Impossible d’enregistrer l’apparence. Réessayez.',
    vivid: 'Vif', vividDescription: 'Navigation indigo et modules colorés.', meta: 'Bleu Meta', metaDescription: 'Navigation claire avec un accent bleu.', warm: 'Chaleureux', warmDescription: 'Crème et corail aux formes arrondies.', clean: 'Épuré', cleanDescription: 'Gris net et couleurs dans les icônes et graphiques.',
    light: 'Clair', dark: 'Sombre', system: 'Selon l’appareil',
  },
};
export const appearanceCopySchema = z.object({ en: z.object(Object.fromEntries(Object.keys(appearanceCopy.en).map(key => [key, z.string().trim().min(1)]))).strict(), fr: z.object(Object.fromEntries(Object.keys(appearanceCopy.fr).map(key => [key, z.string().trim().min(1)]))).strict() }).strict();
export type AppearanceCopy = typeof appearanceCopy.en;
