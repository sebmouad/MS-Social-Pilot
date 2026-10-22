import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { catalogFor, toolErrorCopySchema, type Locale, type ToolErrorCopy } from './tool-kit';

const catalog = z.object({ en: toolErrorCopySchema, fr: toolErrorCopySchema });
export const TOOL_ERROR_COPY = {
  en: { invalid_request: 'Check what you entered and try again.', unauthorized: 'Sign in to an authorized workspace to continue.', forbidden: 'You do not have access to this in the current workspace.', not_found: 'We could not find that item.', unavailable: 'This is not available right now.', reconnect_required: 'Reconnect the channel and try again.', conflict: 'This changed or reached a limit. Review it and try again.', upstream_failure: 'This could not be completed. Your input is still here. Try again.' },
  fr: { invalid_request: 'Vérifiez votre saisie et réessayez.', unauthorized: 'Connectez-vous à un espace de travail autorisé pour continuer.', forbidden: 'Vous n’avez pas accès à cette fonction dans cet espace de travail.', not_found: 'Élément introuvable.', unavailable: 'Cette fonction n’est pas disponible pour le moment.', reconnect_required: 'Reconnectez le canal puis réessayez.', conflict: 'Cet élément a changé ou une limite est atteinte. Vérifiez puis réessayez.', upstream_failure: 'Cette action n’a pas abouti. Votre saisie est conservée. Réessayez.' },
} as const;
export const AI_TOOL_ERROR_CONFIG = [
  entry({ key: 'ai.toolErrorCopy', group: 'AI · Composer tools', label: 'Composer tool failure messages (English / French)', description: 'Safe customer sentences for AI videos, translated posts, caption tests and link tools. Never include provider text.', kind: 'json', defaultValue: TOOL_ERROR_COPY, schema: catalog, consumption: 'active' }),
] as const;
export const toolErrorCopy = (locale: Locale): Promise<ToolErrorCopy> => catalogFor('ai.toolErrorCopy', catalog, locale);
