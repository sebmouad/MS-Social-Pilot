import type { PublishingFormatDescriptor } from '@/platforms/types';

export type DestinationFormatTarget = {
  id: string;
  name: string;
  publishingFormats?: readonly PublishingFormatDescriptor[];
  defaultPublishingFormatId?: string;
};

/** Value the destination will use: explicit choice (even if unknown), else the module default. */
export function effectiveDestinationFormat(target: DestinationFormatTarget, values: Record<string, string>): string | undefined {
  if (Object.hasOwn(values, target.id)) return values[target.id];
  return target.defaultPublishingFormatId;
}

/**
 * Per-destination format choices for selected destinations only. Provider-neutral: labels and
 * options come from module descriptors. The parent owns form serialization.
 */
export function DestinationFormats({ targets, selectedIds, values, onChange, formId, disabled }: {
  targets: readonly DestinationFormatTarget[];
  selectedIds: readonly string[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  formId?: string;
  disabled?: boolean;
}) {
  const rows = targets.filter(target => selectedIds.includes(target.id) && target.publishingFormats?.length);
  if (!rows.length) return null;
  return <>
    {rows.map(target => {
      const formats = target.publishingFormats!;
      const value = effectiveDestinationFormat(target, values) ?? '';
      const known = formats.find(format => format.id === value);
      const selectId = `destination-format-${formId ?? "controls"}-${target.id}`;
      if (formats.length === 1 && known) {
        return <div key={target.id} className="ui-field">
          <span>Format for {target.name}</span>
          <strong>{known.label}</strong>
        </div>;
      }
      return <div key={target.id} className="ui-field">
        <label htmlFor={selectId}>Format for {target.name}</label>
        <select
          id={selectId}
          name={`destinationFormat-${target.id}`}
          form={formId}
          className="ui-input"
          value={value}
          disabled={disabled}
          aria-invalid={known ? undefined : true}
          aria-describedby={known ? undefined : `${selectId}-note`}
          onChange={event => onChange(target.id, event.currentTarget.value)}
        >
          {!known && <option value={value}>Unavailable format (saved)</option>}
          {formats.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
        </select>
        {!known && <span id={`${selectId}-note`} className="ui-field-error">The saved format is no longer available for this destination. Choose another format before scheduling.</span>}
      </div>;
    })}
  </>;
}
