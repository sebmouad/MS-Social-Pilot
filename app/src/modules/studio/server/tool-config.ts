import { catalogFor, type Locale, type ToolErrorCopy } from './tool-kit';
import { toolErrorCatalog } from '../config';

export const toolErrorCopy = (locale: Locale): Promise<ToolErrorCopy> => catalogFor('ai.toolErrorCopy', toolErrorCatalog, locale);
